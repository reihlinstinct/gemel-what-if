/* Core "what if" engine. Pure functions, no DOM, runs in browsers and Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WhatIf = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // "2012-03" | "2012-03-15" | 201203 -> months index (year*12 + month-1)
  function toIndex(value) {
    if (typeof value === "number") return Math.floor(value / 100) * 12 + (value % 100) - 1;
    const m = /^(\d{4})-(\d{2})/.exec(String(value));
    if (!m) throw new Error("Bad month: " + value);
    return Number(m[1]) * 12 + Number(m[2]) - 1;
  }

  function toLabel(index) {
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    return y + "-" + String(m).padStart(2, "0");
  }

  /** Monthly yield (%) of a fund in a month index, or undefined when not reported. */
  function yieldAt(fund, index) {
    const first = toIndex(fund.start);
    const value = fund.y[index - first];
    return value === null || value === undefined ? undefined : value;
  }

  function dataRange(fund) {
    return [toIndex(fund.start), toIndex(fund.start) + fund.y.length - 1];
  }

  /** Deposits per month index from a story. Deposits arrive at the start of the month. */
  function depositSchedule(story, endIndex) {
    const map = new Map();
    const add = (i, amount) => map.set(i, (map.get(i) || 0) + amount);
    for (const d of story.deposits || []) {
      if (d.monthly !== undefined) {
        const from = toIndex(d.from);
        const to = Math.min(d.to ? toIndex(d.to) : endIndex, endIndex);
        for (let i = from; i <= to; i++) add(i, d.monthly);
      } else if (d.amount !== undefined) {
        add(toIndex(d.date), d.amount);
      }
    }
    return map;
  }

  /**
   * Run a story.
   * story = {
   *   start: "2002-01", end?: "2026-09",
   *   deposits: [{from,to?,monthly} | {date,amount}],
   *   phases: [{from, fundId}]   // which fund holds the money from that month
   * }
   * funds: Map(id -> fund). Missing data in a month counts as 0% and is reported.
   */
  function simulate(story, funds, latest) {
    const startIndex = toIndex(story.start);
    const endIndex = toIndex(story.end || latest);
    if (endIndex < startIndex) throw new Error("end before start");
    const phases = (story.phases || [])
      .map((p) => ({
        from: toIndex(p.from),
        fundId: p.fundId,
        feeAdjPct: p.feeAdjPct || 0,
        exitCostPct: p.exitCostPct || 0,
      }))
      .sort((a, b) => a.from - b.from);
    if (!phases.length || phases[0].from > startIndex) {
      throw new Error("A phase must cover the start month");
    }
    const deposits = depositSchedule(story, endIndex);
    const series = [];
    const warnings = { missingMonths: 0, unknownFunds: [] };
    let balance = 0;
    let paid = 0;
    let withdrawn = 0;
    const flows = [];
    let previous = null;
    for (let i = startIndex; i <= endIndex; i++) {
      let phase = phases[0];
      for (const p of phases) if (p.from <= i) phase = p;
      const fund = funds.get(phase.fundId);
      if (previous && phase !== previous && phase.exitCostPct) {
        balance *= 1 - phase.exitCostPct / 100; // one-time cost of moving
      }
      previous = phase;
      const dep = deposits.get(i) || 0;
      balance += dep;
      if (dep >= 0) paid += dep;
      else withdrawn -= dep;
      if (dep) flows.push([i - startIndex, dep]);
      let y;
      if (!fund) {
        if (!warnings.unknownFunds.includes(phase.fundId)) warnings.unknownFunds.push(phase.fundId);
      } else {
        y = yieldAt(fund, i);
      }
      if (y === undefined) warnings.missingMonths++;
      // feeAdjPct is an extra yearly fee (percentage points, may be negative) spread over months.
      balance *= 1 + ((y || 0) - phase.feeAdjPct / 12) / 100;
      series.push({ month: toLabel(i), fundId: phase.fundId, balance, paid, withdrawn });
    }
    const months = endIndex - startIndex + 1;
    return {
      series,
      finalFundId: phase_last(phases, endIndex).fundId,
      final: balance,
      paid,
      withdrawn,
      gain: balance + withdrawn - paid,
      annualized: annualizedReturn(flows, balance, months),
      warnings,
    };
  }

  var SWITCH_TYPES = ["transfer", "product", "track"];

  /**
   * Turn an ordered timeline into a story for simulate().
   * timeline = { end?, events: [
   *   {type:"start", date, fundKey, amount?},
   *   {type:"deposit", date, amount},
   *   {type:"monthly", from, to?, amount},
   *   {type:"withdraw", date, amount},
   *   {type:"transfer"|"product"|"track", date, fundKey, exitCostPct?, feeAdjPct?}
   * ] }
   * Every event may carry scope: "both" (default), "actual" or "whatif".
   */
  function timelineToStory(timeline, scope) {
    const events = (timeline.events || []).filter((e) => !e.scope || e.scope === "both" || e.scope === scope);
    const start = events.find((e) => e.type === "start");
    if (!start) throw new Error("Missing start event");
    const deposits = [];
    const switches = [];
    if (start.amount > 0) deposits.push({ date: start.date, amount: Number(start.amount) });
    for (const e of events) {
      if (e.type === "deposit") deposits.push({ date: e.date, amount: Number(e.amount) });
      else if (e.type === "withdraw") deposits.push({ date: e.date, amount: -Number(e.amount) });
      else if (e.type === "monthly") deposits.push({ from: e.from, to: e.to || undefined, monthly: Number(e.amount) });
      else if (SWITCH_TYPES.includes(e.type)) {
        switches.push({ date: e.date, to: e.fundKey, exitCostPct: e.exitCostPct, feeAdjPct: e.feeAdjPct });
      }
    }
    if (!deposits.length) throw new Error("No deposits");
    return {
      start: start.date,
      end: timeline.end || undefined,
      deposits,
      phases: phasesFromSwitches(start.date, start.fundKey, switches),
    };
  }

  /** Run the whole timeline twice (actual / what-if scopes) and compare total profit. */
  function runTimeline(timeline, funds, latest) {
    const actual = simulate(timelineToStory(timeline, "actual"), funds, latest);
    const whatIf = simulate(timelineToStory(timeline, "whatif"), funds, latest);
    return {
      actual,
      whatIf,
      diff: whatIf.final - actual.final,
      diffPercent: actual.final ? (whatIf.final / actual.final - 1) * 100 : null,
      phasesActual: timelineToStory(timeline, "actual").phases,
      phasesWhatIf: timelineToStory(timeline, "whatif").phases,
    };
  }

  function phase_last(phases, index) {
    let phase = phases[0];
    for (const p of phases) if (p.from <= index) phase = p;
    return phase;
  }

  /** Money-weighted annual return (monthly IRR compounded), by bisection. null if undefined. */
  function annualizedReturn(flows, finalValue, months) {
    if (!flows.length) return null;
    // value at end of month `months` (balance already includes the last month's yield)
    const npv = (r) =>
      flows.reduce((s, [t, a]) => s + a * Math.pow(1 + r, months - t), 0) - finalValue;
    let lo = -0.5;
    let hi = 0.5;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid;
      else lo = mid;
    }
    const r = (lo + hi) / 2;
    return Math.pow(1 + r, 12) - 1;
  }

  /** Replace the fund of every phase and rerun: "what if it had been in X the whole time". */
  function withFund(story, fundId) {
    return Object.assign({}, story, {
      phases: [{ from: story.start, fundId }],
    });
  }

  /**
   * Build phases from a start track and switch events [{date, from?, to}].
   * If a switch names `from`, it must match the track held at that date.
   */
  function phasesFromSwitches(start, startFund, switches) {
    const phases = [{ from: start, fundId: startFund }];
    const sorted = (switches || []).slice().sort((a, b) => toIndex(a.date) - toIndex(b.date));
    let current = startFund;
    for (const sw of sorted) {
      if (sw.from !== undefined && sw.from !== null && sw.from !== current) {
        throw new Error("Switch on " + sw.date + " says from " + sw.from + " but track held is " + current);
      }
      phases.push({
        from: sw.date,
        fundId: sw.to,
        feeAdjPct: Number(sw.feeAdjPct) || 0,
        exitCostPct: Number(sw.exitCostPct) || 0,
      });
      current = sw.to;
    }
    return phases;
  }

  /** Run the actual path and a what-if path over the same deposits and compare. */
  function compare(base, actualPhases, whatIfPhases, funds, latest) {
    const actual = simulate(Object.assign({}, base, { phases: actualPhases }), funds, latest);
    const whatIf = simulate(Object.assign({}, base, { phases: whatIfPhases }), funds, latest);
    return {
      actual,
      whatIf,
      diff: whatIf.final - actual.final,
      diffPercent: actual.final ? (whatIf.final / actual.final - 1) * 100 : null,
    };
  }

  function indexFunds(data) {
    return new Map(data.funds.map((f) => [f.key !== undefined ? f.key : f.id, f]));
  }

  /** Grow a balance with no deposits at an assumed yearly return (percent) for N months. */
  function projectBalance(balance, months, annualPct) {
    if (!months || months <= 0) return balance;
    return balance * Math.pow(1 + (annualPct || 0) / 100, months / 12);
  }

  /**
   * Monthly annuity estimate = balance / coefficient. The coefficient is the capital needed
   * per 1 NIS of monthly annuity (for example 200). Money in an insurance-policy track is
   * assumed to keep the policy's guaranteed coefficient if one is given; money in any other
   * product gets the market coefficient. Returns null when no usable coefficient exists.
   */
  function annuityEstimate(result, funds, opts) {
    const fund = funds.get(result.finalFundId);
    const insurance = fund && fund.src === "insurance";
    const balance = projectBalance(result.final, opts.monthsToRetirement, opts.assumedAnnualPct);
    let coefficient = insurance && opts.guaranteedCoeff > 0 ? opts.guaranteedCoeff : opts.marketCoeff;
    let basis = insurance && opts.guaranteedCoeff > 0 ? "guaranteed" : "market";
    if (!(coefficient > 0)) return null;
    return { balance, coefficient, basis, monthly: balance / coefficient };
  }

  /** Plain-language list of things the model does not capture when the product changes. */
  function productChangeNotes(phases, funds) {
    const notes = [];
    const srcOf = (p) => (funds.get(p.fundId) || {}).src;
    for (let i = 1; i < phases.length; i++) {
      const a = srcOf(phases[i - 1]);
      const b = srcOf(phases[i]);
      if (a && b && a !== b) {
        notes.push({ date: String(phases[i].from), from: a, to: b });
      }
    }
    return notes;
  }

  /** Text search over fund id/name/corporation. */
  function searchFunds(data, query, limit) {
    const q = String(query).trim().toLowerCase();
    if (!q) return [];
    const parts = q.split(/\s+/);
    const hits = data.funds.filter((f) => {
      const hay = (f.id + " " + (f.key || "") + " " + f.name + " " + (f.corp || "") + " " + (f.cls || "")).toLowerCase();
      return parts.every((p) => hay.includes(p));
    });
    hits.sort((a, b) => (b.end - a.end) || ((b.assets || 0) - (a.assets || 0)));
    return hits.slice(0, limit || 30);
  }

  return { toIndex, toLabel, yieldAt, dataRange, simulate, annualizedReturn, withFund, phasesFromSwitches, compare, indexFunds, searchFunds, projectBalance, annuityEstimate, productChangeNotes, timelineToStory, runTimeline };
});
