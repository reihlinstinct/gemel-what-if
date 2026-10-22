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
const HOURLY_LIMIT = 10;

const SYSTEM = [
  prompt.buildPrompt("").replace(/\n\nStory:\n$/, ""),
  "You have tools: search_tracks (find the real fundKey for a fund or track name), validate_story, build_story_link.",
  "Workflow: call search_tracks for each fund the person names, then use the returned fundKey in the events (g:... gemel, i:... insurance), call validate_story, fix errors, then answer with ONLY the final JSON object.",
  'Example output: {"end":"2026-09-01","events":[{"type":"start","date":"2005-06-01","fundKey":"i:259012"},{"type":"monthly","from":"2005-06-01","to":"2011-06-01","amount":750},{"type":"product","date":"2015-03-01","fundKey":"g:761","scope":"actual"}]}',
].join("\n");

export function createHandler({ data, ai, model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast", now = () => Date.now() }) {
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

  async function runTools(calls, messages) {
    for (const c of calls) {
      let args = c.arguments;
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
      const tool = mcp.TOOLS[c.name];
      let out;
      try { out = tool ? tool.run(args || {}) : { error: "unknown tool" }; } catch (e) { out = { error: String(e.message) }; }
      messages.push({ role: "tool", name: c.name, content: JSON.stringify(out).slice(0, 6000) });
    }
  }

  async function storyFromText(text) {
    const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: text }];
    let retries = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await ai.run(model, { messages, tools: toolDefs(), max_tokens: 1200 });
      if (res.tool_calls && res.tool_calls.length) {
        messages.push({ role: "assistant", content: res.response || "", tool_calls: res.tool_calls });
        await runTools(res.tool_calls, messages);
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
