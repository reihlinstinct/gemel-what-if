const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../docs/statement.js");
const W = require("../docs/whatif.js");
const fs = require("node:fs");
test("statement reference does not calibrate or mutate either result", () => {
  const result = {actual:{final:1000},whatIf:{final:1100}};
  assert.deepEqual(S.summarize({statementBalance:987,endAdjustment:-10},result),
    {statement:987,adjustment:-10,actual:990,whatIf:1090,difference:100,residual:3});
  assert.equal(result.actual.final,1000);
});
test("only finite numeric fields and bounded plain strings survive", () => {
  const c = S.normalize({label:"<img src=x>", notes:["plain", 9],statementBalance:NaN,endAdjustment:"10",secret:"no"});
  assert.deepEqual(c,{label:"<img src=x>",notes:["plain"]});
  assert.equal(S.summarize(c,{}),null);
  assert.equal(S.normalize(null),null);
});
test("pension source is namespaced and has every official resource boundary", () => {
  assert.equal(W.officialResources("pension","2022-12","2023-01").length,2);
  assert.equal(W.officialResources("pension","2024-01","2024-02")[0],"6d47d6b5-cb08-488b-b333-f1e717b1e1bd");
  const data=JSON.parse(fs.readFileSync("docs/data/funds.json"));
  data.funds = data.funds.concat(JSON.parse(fs.readFileSync("docs/data/pension.json")));
  const pens=data.funds.filter(x=>x.src==="pension");
  assert.ok(pens.length>100);
  for(const f of pens) assert.equal(f.key,"p:"+f.id);
  assert.equal(new Set(data.funds.map(x=>x.key)).size,data.funds.length);
});
test("synthetic pension comparison does not resolve to overlapping gemel ID", () => {
  const data={funds:[{key:"g:1",start:202001,y:[99]},{key:"p:1",start:202001,y:[1]},{key:"p:2",start:202001,y:[2]}]};
  const r=W.runTimeline({end:"2020-01",events:[{type:"start",date:"2020-01",fundKey:"p:1",amount:100},{type:"track",date:"2020-01",fundKey:"p:2",scope:"whatif"}]},W.indexFunds(data),202001);
  assert.equal(r.actual.final,101);assert.equal(r.whatIf.final,102);assert.equal(r.diff,1);
});
