import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { createHandler } from "../src/handler.js";

const data = JSON.parse(fs.readFileSync(new URL("../../docs/data/funds.json", import.meta.url)));
const ORIGIN = "https://reihlinstinct.github.io";
const GOOD = { end: "2010-12-01", events: [{ type: "start", date: "2005-06-01", fundKey: "i:259012" }, { type: "monthly", from: "2005-06-01", to: "2011-06-01", amount: 750 }] };
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
    { tool_calls: [{ name: "search_tracks", arguments: { query: "הראל קרן" } }] },
    { response: "```json\n" + JSON.stringify(GOOD) + "\n```" },
  ];
  const seen = [];
  const ai = { run: async (_m, req) => { seen.push(req.messages.length); return replies.shift(); } };
  const h = createHandler({ data, ai });
  const res = await h(post("/api/story", { text: "פתחתי ב-2005" }, { origin: ORIGIN }));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual((await res.json()).story.events[0].fundKey, "i:259012");
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
