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
  const s = { end: "2012-12-01", events: [{ type: "start", date: "2005-06-15", fundKey: "i:259012" }, { type: "monthly", from: "2005-06-15", to: "2011-06-30", amount: 750 }] };
  assert.deepStrictEqual(validate(s).errors, []);
});

test("fees event validates and lowers the computed result", () => {
  const withFees = { end: story.end, events: story.events.concat([{ type: "fees", date: "2005-06", depositPct: 1, savingsPct: 1 }]) };
  assert.deepStrictEqual(validate(withFees).errors, []);
  const run = (s) => JSON.parse(handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "compute_story", arguments: { story: s } } }).result.content[0].text);
  assert.ok(run(withFees).whatIf.finalValue < run(story).whatIf.finalValue);
});

test("private story link generation is rejected instead of encoding financial inputs", () => {
  const privateStory = { ...story, private: true };
  assert.throws(() => link(privateStory), /local file import/);
  const res = handle({ jsonrpc: "2.0", id: 90, method: "tools/call",
    params: { name: "build_story_link", arguments: { story: privateStory } } });
  assert.strictEqual(res.result.isError, true);
  const out = JSON.parse(res.result.content[0].text);
  assert.ok(out.errors[0].includes("local file import"));
  assert.strictEqual(out.url, undefined);
});


test("unmarked local context cannot enter either MCP story-link route", () => {
  const contextual = { ...story, context: { notes: ["Synthetic local note"] } };
  assert.throws(() => link(contextual), /local file import/);
  const res = handle({ jsonrpc: "2.0", id: 91, method: "tools/call", params: { name: "build_story_link", arguments: { story: contextual } } });
  assert.strictEqual(res.result.isError, true);
  assert.strictEqual(JSON.parse(res.result.content[0].text).url, undefined);
});

test("both link routes refuse every supplied context, including unsupported raw report fields", () => {
  for (const context of [{rawStatement:"SYNTHETIC_ONLY"},{nested:{raw:"SYNTHETIC_ONLY"}},["SYNTHETIC_ONLY"],"SYNTHETIC_ONLY",{},[],"",0,false]) {
    const candidate={...story,context};
    assert.throws(()=>link(candidate),/local file import/);
    const response=handle({jsonrpc:"2.0",id:201,method:"tools/call",params:{name:"build_story_link",arguments:{story:candidate}}});
    assert.strictEqual(response.result.isError,true);
    assert.strictEqual(JSON.parse(response.result.content[0].text).url,undefined);
  }
  for(const candidate of [story,{...story,context:null}])assert.ok(link(candidate).includes("#story="));
});
