import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { createHandler } from "../src/handler.js";

const data = JSON.parse(fs.readFileSync(new URL("../../docs/data/funds.json", import.meta.url)));
const ORIGIN = "https://reihlinstinct.github.io";
const GOOD = { end: "2010-12-01", events: [{ type: "start", date: "2002-01-01", fundKey: "i:14012" }, { type: "monthly", from: "2002-01-01", to: "2008-12-01", amount: 1000 }] };
const post = (path, body, headers = {}) => new Request("https://w.test" + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("remote MCP: tools/list and compute_story over HTTP", async () => {
  const h = createHandler({ data, ai: null });
  const list = await (await h(post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }))).json();
  assert.strictEqual(list.result.tools.length, 4);
  const call = await (await h(post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "compute_story", arguments: { story: GOOD } } }))).json();
  assert.ok(JSON.parse(call.result.content[0].text).actual.finalValue > 0);
  const note = await h(post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }));
  assert.strictEqual(note.status, 202);
});

test("AI endpoint: tool-calling loop, then final JSON validated", async () => {
  const replies = [
    { tool_calls: [{ name: "search_tracks", arguments: { query: "כלל קרן" } }] },
    { response: "```json\n" + JSON.stringify(GOOD) + "\n```" },
  ];
  const seen = [];
  const ai = { run: async (_m, req) => { seen.push(req.messages.length); return replies.shift(); } };
  const h = createHandler({ data, ai });
  const res = await h(post("/api/story", { text: "פתחתי ב-2002" }, { origin: ORIGIN }));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual((await res.json()).story.events[0].fundKey, "i:14012");
  assert.ok(seen[1] > seen[0], "tool result was fed back to the model");
});

test("AI endpoint retries with validation errors, then gives up", async () => {
  let calls = 0;
  const ai = { run: async () => { calls++; return { response: JSON.stringify({ events: [{ type: "start", date: "bad", fundKey: "nope" }] }) }; } };
  const res = await createHandler({ data, ai })(post("/api/story", { text: "x" }, { origin: ORIGIN }));
  assert.strictEqual(res.status, 502);
  assert.strictEqual(calls, 3);
});

test("AI endpoint: origin check, size limit, rate limit", async () => {
  const ai = { run: async () => ({ response: JSON.stringify(GOOD) }) };
  const h = createHandler({ data, ai });
  assert.strictEqual((await h(post("/api/story", { text: "x" }, { origin: "https://evil.test" }))).status, 403);
  assert.strictEqual((await h(post("/api/story", { text: "x".repeat(3000) }, { origin: ORIGIN }))).status, 400);
  let last;
  for (let i = 0; i < 11; i++) last = await h(post("/api/story", { text: "x" }, { origin: ORIGIN, "cf-connecting-ip": "1.1.1.1" }));
  assert.strictEqual(last.status, 429);
});

test("AI endpoint understands OpenAI chat-completion shaped replies", async () => {
  const replies = [
    { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_tracks", arguments: "{\"query\":\"כלל\"}" } }] } }] },
    { choices: [{ message: { content: JSON.stringify(GOOD) } }] },
  ];
  const ai = { run: async () => replies.shift() };
  const res = await createHandler({ data, ai })(post("/api/story", { text: "x" }, { origin: ORIGIN }));
  assert.strictEqual(res.status, 200);
});

test("Gemini path: function call, final JSON, daily cap, fallback to Workers AI", async () => {
  const store = new Map();
  const caps = { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) };
  const seq = [
    { candidates: [{ content: { parts: [{ functionCall: { name: "search_tracks", args: { query: "כלל" } } }] } }] },
    { candidates: [{ content: { parts: [{ text: JSON.stringify(GOOD) }] } }] },
  ];
  let geminiCalls = 0;
  const fetchImpl = async () => { geminiCalls++; const b = seq.shift(); return b ? new Response(JSON.stringify(b)) : new Response("x", { status: 500 }); };
  const ai = { run: async () => ({ response: JSON.stringify(GOOD) }) };
  const h = createHandler({ data, ai, gemini: "k", caps, fetchImpl });
  const r1 = await h(post("/api/story", { text: "x" }, { origin: ORIGIN, "cf-connecting-ip": "2.2.2.2" }));
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(geminiCalls, 2);
  // Gemini failing (500) falls back to Workers AI
  const r2 = await h(post("/api/story", { text: "x" }, { origin: ORIGIN, "cf-connecting-ip": "3.3.3.3" }));
  assert.strictEqual(r2.status, 200);
  // cap reached: Gemini is not called at all
  store.set("gemini:" + new Date().toISOString().slice(0, 10), "100");
  const before = geminiCalls;
  const r3 = await h(post("/api/story", { text: "x" }, { origin: ORIGIN, "cf-connecting-ip": "4.4.4.4" }));
  assert.strictEqual(r3.status, 200);
  assert.strictEqual(geminiCalls, before);
});
