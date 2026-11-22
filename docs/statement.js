/* Optional local statement reference. It never changes the simulation or its rates. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StatementContext = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function normalize(value) {
    if (!value || typeof value !== "object") return null;
    const out = {};
    if (typeof value.label === "string") out.label = value.label.slice(0, 1000);
    if (Array.isArray(value.notes)) out.notes = value.notes.filter((n) => typeof n === "string").slice(0, 20).map((n) => n.slice(0, 2000));
    for (const key of ["statementBalance", "endAdjustment"]) {
      if (typeof value[key] === "number" && Number.isFinite(value[key])) out[key] = value[key];
    }
    return out;
  }
  function summarize(context, result) {
    const c = normalize(context);
    if (!c || !Number.isFinite(c.statementBalance)) return null;
    const adjustment = c.endAdjustment || 0;
    const actual = result.actual.final + adjustment;
    const whatIf = result.whatIf.final + adjustment;
    return { statement: c.statementBalance, adjustment, actual, whatIf,
      difference: whatIf - actual, residual: actual - c.statementBalance };
  }
  return { normalize, summarize };
});
