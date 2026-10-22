const test = require("node:test");
const assert = require("node:assert");
const { handle, validate, link } = require("../mcp/server.js");

const story = {
  end: "2010-12",
  events: [
    { type: "start", date: "2005-06", fundKey: "i:259012" },
    { type: "monthly", from: "2005-06", to: "2011-06", amount: 750 },
    { type: "product", date: "2009-01", fundKey: "g:416", scope: "actual" },
  ],
};

test("valid story passes, unknown fund and bad dates are errors", () => {
  assert.deepStrictEqual(validate(story).errors, []);
  assert.ok(validate({ events: [{ type: "start", date: "2002-13", fundKey: "x" }] }).errors.length >= 2);
  assert.ok(validate({ events: [] }).errors.length);
});

test("link keeps the story in the fragment and round-trips", () => {
  const url = link(story, "https://example.test/");
  assert.ok(url.startsWith("https://example.test/#story="));
  const b64 = url.split("#story=")[1].replace(/-/g, "+").replace(/_/g, "/");
  assert.deepStrictEqual(JSON.parse(Buffer.from(b64, "base64").toString("utf8")), story);
});

test("tools/list and tools/call work over the JSON-RPC handler", () => {
  assert.strictEqual(handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }).result.tools.length, 4);
  const res = handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "compute_story", arguments: { story } } });
  const out = JSON.parse(res.result.content[0].text);
  assert.ok(out.actual.finalValue > 0 && out.whatIf.finalValue > 0);
  const bad = handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "build_story_link", arguments: { story: { events: [] } } } });
  assert.strictEqual(bad.result.isError, true);
});

test("full dates (YYYY-MM-DD) from the date picker validate and run", () => {
  const s = { end: "2010-12-01", events: [{ type: "start", date: "2005-06-15", fundKey: "i:259012" }, { type: "monthly", from: "2005-06-15", to: "2011-06-30", amount: 750 }] };
  assert.deepStrictEqual(validate(s).errors, []);
});
