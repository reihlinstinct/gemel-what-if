// Request handler for the Worker. Pure: data and the AI binding are injected, so it is testable offline.
// Privacy: no storage, no logging of request bodies. Rate limit is per isolate (best effort).
import core from "../../mcp/core.js";
import prompt from "../../docs/prompt.js";
import whatif from "../../docs/whatif.js";

const { createCore } = core;
const PAGES_ORIGIN = "https://reihlinstinct.github.io";
const MAX_TEXT = 2000;
const MAX_STEPS = 8;
const MAX_RETRIES = 2;
const HOURLY_LIMIT = 5;

const SYSTEM = [
  prompt.buildPrompt("").replace(/\n\nStory:\n$/, ""),
  "You have tools: search_tracks (find the real fundKey for a fund or track name), validate_story, build_story_link.",
  "Workflow: call search_tracks once per fund the person names, with a SHORT query: the company name in Hebrew (e.g. כלל, מיטב, מגדל) plus one track word at most. Use the returned fundKey in the events (g:... gemel, i:... insurance); if search finds nothing keep fundName. Use at most 4 tool calls, then answer with ONLY the final JSON object (no validate loop needed; the server validates).",
  'Example output: {"end":"2026-09-01","events":[{"type":"start","date":"2005-06-01","fundKey":"i:259012"},{"type":"monthly","from":"2005-06-01","to":"2011-06-01","amount":750},{"type":"product","date":"2015-03-01","fundKey":"g:761","scope":"actual"}]}',
].join("\n");

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_DAILY_CAP = 100;

export function createHandler({ data, ai, gemini = null, caps = null, fetchImpl = fetch, model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast", now = () => Date.now() }) {
  const mcp = createCore(data);
  const hits = new Map();

  const json = (obj, status = 200, extra = {}) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

  function limited(ip) {
    const t = now();
    const recent = (hits.get(ip) || []).filter((x) => t - x < 3600000);
    if (recent.length >= HOURLY_LIMIT) { hits.set(ip, recent); return true; }
    recent.push(t);
    hits.set(ip, recent);
    return false;
  }

  const toolDefs = () =>
    ["search_tracks", "validate_story", "build_story_link"].map((name) => ({
      name,
      description: mcp.TOOLS[name].description,
      parameters: mcp.TOOLS[name].inputSchema,
    }));

  // Workers AI wants OpenAI-style tool_calls (id/type/function) when we echo them back, and tool_call_id on results.
  const normalize = (calls) =>
    calls.map((c, i) => {
      const name = c.name || (c.function && c.function.name);
      let args = c.arguments !== undefined ? c.arguments : c.function && c.function.arguments;
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
      return { id: c.id || "call_" + i, name, args: args || {} };
    });

  async function runTools(calls, messages) {
    for (const c of calls) {
      const args = c.args;
      const tool = mcp.TOOLS[c.name];
      let out;
      try { out = tool ? tool.run(args || {}) : { error: "unknown tool" }; } catch (e) { out = { error: String(e.message) }; }
      messages.push({ role: "tool", tool_call_id: c.id, name: c.name, content: JSON.stringify(out).slice(0, 6000) });
    }
  }

  // Global daily cap for the (possibly billed) Gemini key, kept in KV. Returns true if a call may be made.
  async function takeGeminiBudget() {
    if (!gemini || !caps) return false;
    const key = "gemini:" + new Date(now()).toISOString().slice(0, 10);
    const used = Number(await caps.get(key)) || 0;
    if (used >= GEMINI_DAILY_CAP) return false;
    await caps.put(key, String(used + 1), { expirationTtl: 172800 });
    return true;
  }

  const geminiTools = [{ functionDeclarations: [{ name: "search_tracks", description: mcp.TOOLS.search_tracks.description, parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, limit: { type: "NUMBER" } }, required: ["query"] } }] }];

  async function geminiCall(contents, withTools) {
    const body = { systemInstruction: { parts: [{ text: SYSTEM }] }, contents, generationConfig: { maxOutputTokens: 1500, temperature: 0.2 } };
    if (withTools) body.tools = geminiTools;
    const r = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent", { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": gemini }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("gemini " + r.status);
    const j = await r.json();
    const cand = j.candidates && j.candidates[0];
    return (cand && cand.content && cand.content.parts) || [];
  }

  // Same contract as the Workers AI loop: returns {response, tool_calls} per step.
  async function geminiStep(contents, withTools) {
    const parts = await geminiCall(contents, withTools);
    contents.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });
    const calls = parts.filter((p) => p.functionCall).map((p, i) => ({ id: "g" + i, name: p.functionCall.name, args: p.functionCall.args || {} }));
    return { text: parts.filter((p) => p.text).map((p) => p.text).join(""), calls };
  }

  async function storyViaGemini(text) {
    const contents = [{ role: "user", parts: [{ text }] }];
    let retries = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      const { text: out, calls } = await geminiStep(contents, step < 4);
      if (calls.length) {
        const parts = calls.map((c) => {
          const tool = mcp.TOOLS[c.name];
          let res;
          try { res = tool ? tool.run(c.args) : { error: "unknown tool" }; } catch (e) { res = { error: String(e.message) }; }
          return { functionResponse: { name: c.name, response: { result: JSON.stringify(res).slice(0, 6000) } } };
        });
        contents.push({ role: "user", parts });
        continue;
      }
      let story;
      try { story = prompt.resolveFunds(prompt.extractJson(out), (n) => whatif.searchFunds(data, n, 3)); } catch (e) {
        if (retries++ >= MAX_RETRIES) throw new Error("המודל לא החזיר JSON תקין");
        contents.push({ role: "user", parts: [{ text: "Invalid JSON: " + e.message + ". Reply with ONLY the JSON object." }] });
        continue;
      }
      const v = mcp.validate(story.story);
      if (!v.errors.length) return { story: story.story, resolved: story.resolved, warnings: v.warnings };
      if (retries++ >= MAX_RETRIES) throw new Error("הסיפור לא עבר אימות: " + v.errors.slice(0, 3).join("; "));
      contents.push({ role: "user", parts: [{ text: "Validation errors: " + v.errors.join("; ") + ". Fix them and reply with ONLY the corrected JSON object." }] });
    }
    throw new Error("המודל לא הגיע לתשובה סופית");
  }

  async function storyFromText(text) {
    if (await takeGeminiBudget().catch(() => false)) {
      try { return await storyViaGemini(text); } catch { /* fall back to Workers AI */ }
    }
    return storyViaWorkersAi(text);
  }

  async function storyViaWorkersAi(text) {
    const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: text }];
    let retries = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      const raw = await ai.run(model, Object.assign({ messages, max_tokens: 1200 }, step < 4 ? { tools: toolDefs() } : {}));
      // Newer Workers AI models answer in OpenAI chat-completion shape, older ones as {response, tool_calls}.
      const m = raw.choices && raw.choices[0] ? raw.choices[0].message || {} : { content: raw.response, tool_calls: raw.tool_calls };
      const res = { response: m.content || "", tool_calls: m.tool_calls || [] };
      if (res.tool_calls && res.tool_calls.length) {
        const calls = normalize(res.tool_calls);
        messages.push({ role: "assistant", content: res.response || "", tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
        await runTools(calls, messages);
        continue;
      }
      let story;
      try {
        story = prompt.resolveFunds(prompt.extractJson(res.response), (n) => whatif.searchFunds(data, n, 3));
      } catch (e) {
        if (retries++ >= MAX_RETRIES) throw new Error("המודל לא החזיר JSON תקין");
        messages.push({ role: "assistant", content: String(res.response || "") }, { role: "user", content: "Invalid JSON: " + e.message + ". Reply with ONLY the JSON object." });
        continue;
      }
      const v = mcp.validate(story.story);
      if (!v.errors.length) return { story: story.story, resolved: story.resolved, warnings: v.warnings };
      if (retries++ >= MAX_RETRIES) throw new Error("הסיפור לא עבר אימות: " + v.errors.slice(0, 3).join("; "));
      messages.push({ role: "assistant", content: JSON.stringify(story.story) }, { role: "user", content: "Validation errors: " + v.errors.join("; ") + ". Fix them and reply with ONLY the corrected JSON object." });
    }
    throw new Error("המודל לא הגיע לתשובה סופית");
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";
    if (url.pathname === "/mcp") {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id", "access-control-allow-methods": "POST, OPTIONS" };
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
      let msg;
      try { msg = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400, cors); }
      const res = Array.isArray(msg) ? msg.map((m) => mcp.handle(m)).filter(Boolean) : mcp.handle(msg);
      if (!res || (Array.isArray(res) && !res.length)) return new Response(null, { status: 202, headers: cors });
      return json(res, 200, cors);
    }
    if (url.pathname === "/api/story") {
      const cors = { "access-control-allow-origin": PAGES_ORIGIN, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" };
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
      if (origin !== PAGES_ORIGIN) return json({ error: "origin not allowed" }, 403, cors);
      if (limited(request.headers.get("cf-connecting-ip") || "unknown")) return json({ error: "יותר מדי בקשות, נסו שוב בעוד שעה" }, 429, cors);
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad request" }, 400, cors); }
      const text = String((body && body.text) || "").trim();
      if (!text || text.length > MAX_TEXT) return json({ error: "הטקסט ריק או ארוך מ-" + MAX_TEXT + " תווים" }, 400, cors);
      try {
        return json(await storyFromText(text), 200, cors);
      } catch (e) {
        return json({ error: String(e.message) }, 502, cors);
      }
    }
    return json({ name: "gemel-what-if worker", endpoints: ["POST /mcp", "POST /api/story"] }, 200);
  };
}
