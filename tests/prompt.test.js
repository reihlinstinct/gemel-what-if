const test = require("node:test");
const assert = require("node:assert");
const P = require("../docs/prompt.js");

test("buildPrompt includes instructions and the story", () => {
  const p = P.buildPrompt("  פתחתי ב-2002  ");
  assert.ok(p.includes("ONLY one JSON object") && p.endsWith("פתחתי ב-2002"));
});

test("extractJson handles fences and surrounding text, rejects junk", () => {
  assert.deepStrictEqual(P.extractJson('Here:\n```json\n{"events":[]}\n```'), { events: [] });
  assert.deepStrictEqual(P.extractJson('ok {"a":1} thanks'), { a: 1 });
  assert.throws(() => P.extractJson("no json"));
});

test("resolveFunds maps names to keys and reports misses", () => {
  const search = (n) => (n === "clal" ? [{ key: "i:1", name: "Clal 1" }] : []);
  const r = P.resolveFunds({ events: [{ type: "start", fundName: "clal" }, { type: "track", fundName: "zzz" }] }, search);
  assert.strictEqual(r.story.events[0].fundKey, "i:1");
  assert.deepStrictEqual(r.missing, ["zzz"]);
  assert.strictEqual(r.story.events[0].fundName, undefined);
});
