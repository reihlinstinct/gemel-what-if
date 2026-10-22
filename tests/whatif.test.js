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
  assert.deepStrictEqual(ph, [{ from: "2002-01", fundId: 1 }, { from: "2002-03", fundId: 2 }]);
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
