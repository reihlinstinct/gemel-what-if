const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
const C = require("../docs/catalog.js");
const W = require("../docs/whatif.js");
const base = require("../docs/data/funds.json");
const pension = require("../docs/data/pension.json");
const manifest = require("../docs/data/catalog.json");
const merged = C.assemble(base, pension);
const copy = x => JSON.parse(JSON.stringify(x));
const text = name => fs.readFileSync(path.join(__dirname, "../docs/data", name), "utf8");
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => value });
const fetcher = overrides => async (url, options) => {
  assert.equal(options.cache, "no-cache");
  return overrides[url] || response(text(url.split("/").pop()));
};

test("catalog assembly preserves every public field, series, value, null and order", () => {
  assert.deepEqual(merged, { ...base, funds: base.funds.concat(pension) });
  assert.equal(merged.funds.length, manifest.count);
  assert.equal(merged.latest, manifest.latest);
  assert.ok(pension.length > 100);
});

test("checked browser loader verifies the exact generated snapshot", async () => {
  assert.deepEqual(await C.load(fetcher({}), webcrypto.subtle), merged);
});

test("catalog loader rejects HTTP errors before parsing even valid empty JSON", async () => {
  for (const status of [404, 503]) await assert.rejects(C.load(fetcher({"data/pension.json": response(status === 404 ? "[]" : "unavailable", status)}), webcrypto.subtle), /HTTP/);
});

test("catalog loader rejects missing, malformed and mixed-version shards", async () => {
  for (const body of ["[]", "not JSON", JSON.stringify(pension).replace(pension[0].name, "Synthetic changed name")]) {
    await assert.rejects(C.load(fetcher({"data/pension.json": response(body)}), webcrypto.subtle));
  }
  await assert.rejects(C.load(fetcher({"data/catalog.json":response("{}")}), webcrypto.subtle), /manifest/);
  await assert.rejects(C.load(fetcher({}), null), /digest/);
});

test("catalog assembly rejects partial shapes, wrong keys, invalid months, invalid yields and duplicates", () => {
  assert.throws(() => C.assemble(base, []), /Missing pension/);
  assert.throws(() => C.assemble([], pension), /shape/);
  for (const change of [
    p => { p[0].key = "g:" + p[0].id; },
    p => { p[0].start = 202613; },
    p => { p[0].y = []; },
    p => { p[0].y[0] = "1"; },
    p => { p[0].y[0] = Infinity; },
    p => { p.push(p[0]); },
  ]) { const p = copy(pension); change(p); assert.throws(() => C.assemble(base, p)); }
  assert.throws(() => C.assemble({...base,latest:202611}, pension), /latest/);
});

test("later pension month does not add a contribution or fee month to legacy stories", () => {
  const funds = W.indexFunds(merged);
  const story = { events: [{type:"start",date:"2026-09",fundKey:"g:103",amount:1000},{type:"monthly",from:"2026-09",amount:100}] };
  const result = W.runTimeline(story, funds, merged.latest);
  assert.equal(W.defaultEnd(story, funds, merged.latest), 202609);
  assert.equal(result.actual.paid, 1100);
  assert.equal(result.actual.final, 1100.33);
  assert.equal(result.actual.warnings.missingMonths, 0);
  const legacy = W.indexFunds(base);
  const dormant = base.funds.find(f => f.end < 202609);
  for (const fundKey of ["g:103", dormant.key, "i:1"]) {
    const s = {...story,events:[{...story.events[0],fundKey,feeAdjPct:0.7,depositFeePct:1},story.events[1]]};
    assert.deepEqual(W.runTimeline(s,funds,merged.latest), W.runTimeline(s,legacy,202609));
  }
});

test("pension/mixed defaults are explicit and explicit dates always win", () => {
  const funds = W.indexFunds(merged);
  const events = [{type:"start",date:"2026-09",fundKey:"p:2155",amount:1000}];
  assert.equal(W.defaultEnd({events},funds,merged.latest),202610);
  assert.equal(W.defaultEnd({events:events.concat({type:"track",date:"2026-09",fundKey:"g:103"})},funds,merged.latest),202609);
  for (const end of ["2026-06", "2026-10-31"]) assert.equal(W.defaultEnd({events,end},funds,merged.latest),end);
});
