const test = require("node:test");
const assert = require("node:assert");
const W = require("../docs/whatif.js");

const fund = (id, start, y) => ({ id, start, y, name: "f" + id });
const funds = new Map([
  [1, fund(1, 200201, [1, 1, 1, 1])],
  [2, fund(2, 200201, [2, null, 2, 2])],
]);

test("lump sum compounds monthly", () => {
  const r = W.simulate(
    { start: "2002-01", end: "2002-03", deposits: [{ date: "2002-01", amount: 1000 }], phases: [{ from: "2002-01", fundId: 1 }] },
    funds
  );
  assert.ok(Math.abs(r.final - 1000 * 1.01 ** 3) < 1e-9);
  assert.strictEqual(r.paid, 1000);
  assert.ok(Math.abs(r.annualized - (1.01 ** 12 - 1)) < 1e-6);
});

test("monthly deposits and paid-up phase switch", () => {
  const r = W.simulate(
    {
      start: "2002-01",
      end: "2002-04",
      deposits: [{ from: "2002-01", to: "2002-02", monthly: 100 }],
      phases: [{ from: "2002-01", fundId: 1 }, { from: "2002-03", fundId: 2 }],
    },
    funds
  );
  const m1 = 100 * 1.01;
  const m2 = (m1 + 100) * 1.01;
  const m3 = m2 * 1.02; // fund 2 month 3 = 2%
  assert.ok(Math.abs(r.final - m3 * 1.02) < 1e-9);
  assert.strictEqual(r.paid, 200);
});

test("missing months count as 0% and are reported", () => {
  const r = W.simulate(
    { start: "2002-01", end: "2002-02", deposits: [{ date: "2002-01", amount: 100 }], phases: [{ from: "2002-01", fundId: 2 }] },
    funds
  );
  assert.strictEqual(r.warnings.missingMonths, 1);
});

test("unknown fund and uncovered start are flagged or rejected", () => {
  const r = W.simulate(
    { start: "2002-01", end: "2002-01", deposits: [{ date: "2002-01", amount: 1 }], phases: [{ from: "2002-01", fundId: 9 }] },
    funds
  );
  assert.deepStrictEqual(r.warnings.unknownFunds, [9]);
  assert.throws(() => W.simulate({ start: "2002-01", phases: [{ from: "2003-01", fundId: 1 }] }, funds, 200203));
});

test("withFund replaces all phases", () => {
  const s = W.withFund({ start: "2002-01", phases: [{ from: "2002-01", fundId: 1 }, { from: "2002-03", fundId: 2 }] }, 2);
  assert.strictEqual(s.phases.length, 1);
  assert.strictEqual(s.phases[0].fundId, 2);
});

test("search by name and id", () => {
  const data = { funds: [{ id: 7215, name: "מיטב גמל לבני 50 ומטה", corp: "מיטב", end: 202609 }, { id: 5, name: "other", end: 202001 }] };
  assert.strictEqual(W.searchFunds(data, "מיטב 50").length, 1);
  assert.strictEqual(W.searchFunds(data, "7215")[0].id, 7215);
});

test("switch events build phases and validate from-track", () => {
  const ph = W.phasesFromSwitches("2002-01", 1, [{ date: "2002-03", from: 1, to: 2 }]);
  assert.deepStrictEqual(ph.map((p) => [p.from, p.fundId]), [["2002-01", 1], ["2002-03", 2]]);
  assert.throws(() => W.phasesFromSwitches("2002-01", 1, [{ date: "2002-03", from: 2, to: 1 }]));
});

test("compare: staying in the better fund beats the switch", () => {
  const base = { start: "2002-01", end: "2002-04", deposits: [{ date: "2002-01", amount: 100 }] };
  const actual = W.phasesFromSwitches("2002-01", 1, [{ date: "2002-03", to: 2 }]);
  const alt = W.phasesFromSwitches("2002-01", 1, []);
  const c = W.compare(base, actual, alt, funds, 200204);
  assert.strictEqual(c.actual.paid, c.whatIf.paid);
  assert.ok(c.diff < 0);
});

const insFund = { id: 1, key: "i:1", src: "insurance", start: 200201, y: [1, 1, 1, 1] };
const gemFund = { id: 1, key: "g:1", src: "gemel", start: 200201, y: [1, 1, 1, 1] };
const mixed = W.indexFunds({ funds: [insFund, gemFund] });

test("keys separate products with the same id", () => {
  assert.strictEqual(mixed.get("i:1").src, "insurance");
  assert.strictEqual(mixed.get("g:1").src, "gemel");
});

test("exit cost and fee adjustment change the result", () => {
  const base = { start: "2002-01", end: "2002-04", deposits: [{ date: "2002-01", amount: 1000 }] };
  const plain = W.simulate(Object.assign({}, base, { phases: W.phasesFromSwitches("2002-01", "i:1", [{ date: "2002-03", to: "g:1" }]) }), mixed);
  const costly = W.simulate(Object.assign({}, base, { phases: W.phasesFromSwitches("2002-01", "i:1", [{ date: "2002-03", to: "g:1", exitCostPct: 1, feeAdjPct: 1.2 }]) }), mixed);
  const expected = 1000 * 1.01 ** 2 * 0.99 * (1 + (1 - 0.1) / 100) ** 2;
  assert.ok(Math.abs(costly.final - expected) < 1e-9);
  assert.ok(costly.final < plain.final);
});

test("product change notes flag a crossing from insurance to gemel only", () => {
  const cross = W.phasesFromSwitches("2002-01", "i:1", [{ date: "2002-03", to: "g:1" }]);
  assert.strictEqual(W.productChangeNotes(cross, mixed).length, 1);
  const same = W.phasesFromSwitches("2002-01", "g:1", [{ date: "2002-03", to: "g:1" }]);
  assert.strictEqual(W.productChangeNotes(same, mixed).length, 0);
});

test("annuity uses guaranteed coefficient for insurance, market otherwise", () => {
  const opts = { guaranteedCoeff: 150, marketCoeff: 200, monthsToRetirement: 0, assumedAnnualPct: 0 };
  const a = W.annuityEstimate({ final: 30000, finalFundId: "i:1" }, mixed, opts);
  const b = W.annuityEstimate({ final: 30000, finalFundId: "g:1" }, mixed, opts);
  assert.strictEqual(a.monthly, 200);
  assert.strictEqual(a.basis, "guaranteed");
  assert.strictEqual(b.monthly, 150);
  assert.strictEqual(b.basis, "market");
  assert.strictEqual(W.annuityEstimate({ final: 1, finalFundId: "g:1" }, mixed, { marketCoeff: 0 }), null);
});

test("projectBalance compounds yearly rate monthly-fractionally", () => {
  assert.ok(Math.abs(W.projectBalance(100, 12, 5) - 105) < 1e-9);
  assert.strictEqual(W.projectBalance(100, 0, 5), 100);
});

test("timeline: start, monthly deposits, withdrawal and a scoped transfer", () => {
  const tl = {
    end: "2002-04",
    events: [
      { type: "start", date: "2002-01", fundKey: 1, amount: 1000 },
      { type: "withdraw", date: "2002-02", amount: 100 },
      { type: "transfer", date: "2002-03", fundKey: 2, scope: "actual" },
    ],
  };
  const r = W.runTimeline(tl, funds, 200204);
  assert.strictEqual(r.actual.paid, 1000);
  assert.strictEqual(r.actual.withdrawn, 100);
  // profit counts withdrawn money as returned
  assert.ok(Math.abs(r.actual.gain - (r.actual.final + 100 - 1000)) < 1e-9);
  assert.strictEqual(r.phasesActual.length, 2);
  assert.strictEqual(r.phasesWhatIf.length, 1);
  assert.notStrictEqual(r.actual.final, r.whatIf.final);
});

test("timeline requires a start event and a deposit", () => {
  assert.throws(() => W.timelineToStory({ events: [] }, "actual"));
  assert.throws(() => W.timelineToStory({ events: [{ type: "start", date: "2002-01", fundKey: 1 }] }, "actual"));
});

test("management fees are off by default and reduce the result when set", () => {
  const funds = new Map([["f", { id: "f", start: "2020-01", y: new Array(24).fill(0) }]]);
  const base = { end: "2021-12", events: [{ type: "start", date: "2020-01", fundKey: "f" }, { type: "monthly", from: "2020-01", amount: 100 }] };
  const none = W.runTimeline(base, W.indexFunds ? funds : funds, "2021-12").actual;
  assert.strictEqual(none.final, 2400);
  const withFees = { end: base.end, events: base.events.concat([{ type: "fees", date: "2020-01", depositPct: 1, savingsPct: 1 }]) };
  const f = W.runTimeline(withFees, funds, "2021-12").actual;
  assert.ok(f.final < 2400 * 0.99 && f.gain < 0);
  assert.strictEqual(f.paid, 2400);
});

test("searchFunds understands English company aliases and falls back to the best partial match", () => {
  const data = { funds: [{ id: "1", key: "g:1", name: "מיטב השתלמות כללי", corp: "מיטב", cls: "", end: 202609 }, { id: "2", key: "i:2", name: "כלל-קרן", corp: "כלל חברה לביטוח", cls: "", end: 202609 }] };
  assert.strictEqual(W.searchFunds(data, "Meitav", 5)[0].key, "g:1");
  assert.strictEqual(W.searchFunds(data, "Clal managers insurance", 5)[0].key, "i:2");
});

test("phasePeriods splits a timeline into per-track periods and merges repeats", () => {
  const periods = W.phasePeriods(
    [{ from: "2002-01", fundId: 1 }, { from: "2008-06", fundId: 2 }, { from: "2012-01", fundId: 2 }],
    "2020-12"
  );
  assert.deepStrictEqual(periods, [
    { fundId: 1, from: "2002-01", to: "2008-05", months: 77 },
    { fundId: 2, from: "2008-06", to: "2020-12", months: 151 },
  ]);
});

test("phasePeriods sorts unsorted phases, accepts a numeric end and drops empty periods", () => {
  assert.deepStrictEqual(
    W.phasePeriods([{ from: "2010-01", fundId: 2 }, { from: "2002-01", fundId: 1 }], "2009-12"),
    [{ fundId: 1, from: "2002-01", to: "2009-12", months: 96 }]
  );
  assert.deepStrictEqual(W.phasePeriods([{ from: "2002-01", fundId: 1 }], 202609), [
    { fundId: 1, from: "2002-01", to: "2026-09", months: 297 },
  ]);
});

test("officialResources maps periods to the right source periods", () => {
  const one = W.officialResources("gemel", "2023-02", "2023-11");
  assert.deepStrictEqual(one, ["2016d770-f094-4a2e-983e-797c26479720"]);
  const span = W.officialResources("gemel", "2022-06", "2024-02");
  assert.deepStrictEqual(span, [
    "91c849ed-ddc4-472b-bd09-0f5486cea35c",
    "2016d770-f094-4a2e-983e-797c26479720",
    "a30dcbea-a1d2-482c-ae29-8f781f5025fb",
  ]);
  const ins = W.officialResources("insurance", "2024-01", "2024-05");
  assert.deepStrictEqual(ins, ["c6c62cc7-fe02-4b18-8f3e-813abfbb4647"]);
  assert.notDeepStrictEqual(W.officialResources("gemel", "2020-01", "2020-12"), W.officialResources("insurance", "2020-01", "2020-12"));
});

test("cumulativeYield compounds monthly percents", () => {
  assert.ok(Math.abs(W.cumulativeYield([10, -10]) - (1.1 * 0.9 - 1)) < 1e-12);
  assert.strictEqual(W.cumulativeYield([]), 0);
});

test("officialRowsUrl carries the resource and a FUND_ID filter", () => {
  const u = W.officialRowsUrl("gemel", "a30dcbea-a1d2-482c-ae29-8f781f5025fb", 880);
  assert.ok(u.startsWith("https://data.gov.il/api/3/action/datastore_search?resource_id=a30dcbea-a1d2-482c-ae29-8f781f5025fb"));
  assert.ok(decodeURIComponent(u).includes('{"FUND_ID":"880"}'));
});

test("localCumulative matches simulate's missing-months-as-zero rule", () => {
  const f = fund(3, 200201, [2, null, 2]);
  const r = W.localCumulative(f, "2002-01", "2002-03");
  assert.ok(Math.abs(r.value - (1.02 * 1 * 1.02 - 1)) < 1e-12);
  assert.strictEqual(r.missing, 1);
  assert.strictEqual(r.months, 3);
});

test("periodOf converts a month index to YYYYMM", () => {
  assert.strictEqual(W.periodOf(W.toIndex("2024-01")), 202401);
  assert.strictEqual(W.periodOf(W.toIndex("2024-12")), 202412);
});

test("phasesFromSwitches applies the start fee to the first phase", () => {
  const ph = W.phasesFromSwitches("2002-01", 1, [], 0.5);
  assert.strictEqual(ph[0].feeAdjPct, 0.5);
  assert.strictEqual(W.phasesFromSwitches("2002-01", 1, [])[0].feeAdjPct, 0);
});

test("timelineToStory carries the start event fee into the simulation", () => {
  const timeline = { end: "2002-04", events: [{ type: "start", date: "2002-01", fundKey: 1, amount: 1000, feeAdjPct: 1.2 }] };
  const story = W.timelineToStory(timeline, "actual");
  assert.strictEqual(story.phases[0].feeAdjPct, 1.2);
  const noFee = W.simulate(W.timelineToStory({ end: "2002-04", events: [{ type: "start", date: "2002-01", fundKey: 1, amount: 1000 }] }, "actual"), funds);
  const fee = W.simulate(story, funds);
  assert.ok(fee.final < noFee.final);
});
