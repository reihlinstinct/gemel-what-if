const WORKER_URL = "https://gemel-what-if.reihlinstinct.workers.dev";
(function () {
  "use strict";
  const W = window.WhatIf;
  let data = null;
  let L = null; // catalog helpers for the active language (docs/i18n.js)
  const t = (k, p) => L.t(k, p);
  let funds = null;
  const $ = (s, r) => (r || document).querySelector(s);
  const fmt = (n) => Math.round(n).toLocaleString(L.locale());
  const pct = (n) => (n === null || n === undefined ? "-" : (n * 100).toFixed(2) + "%");

  const TYPES = {
    deposit: "event.deposit",
    monthly: "event.monthly",
    withdraw: "event.withdraw",
    transfer: "event.transfer",
    product: "event.product",
    track: "event.track",
    fees: "event.fees",
  };
  const SWITCHES = ["transfer", "product", "track"];
  const typeLabel = (k) => t(TYPES[k]);

  /** Fund picker: search box + select; the chosen key is kept in el.dataset.fund. */
  function fundPicker(el, label) {
    el.innerHTML = "";
    el.classList.add("fundpick");
    const lab = document.createElement("span");
    lab.className = "lbl";
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "search";
    input.setAttribute("aria-label", t("fund.search_aria"));
    input.placeholder = t("fund.search_placeholder");
    const select = document.createElement("select");
    select.setAttribute("aria-label", t("fund.select_aria"));
    const chosen = document.createElement("div");
    chosen.className = "chosen";
    chosen.setAttribute("role", "status");
    el.append(lab, input, select, chosen);
    const show = () => {
      select.innerHTML = "";
      for (const f of W.searchFunds(data, input.value, 40)) {
        const o = document.createElement("option");
        o.value = f.key;
        o.textContent = (f.src === "insurance" ? t("fund.src_insurance") : t("fund.src_gemel")) + " " + f.id + " | " + f.name + " | " + (f.corp || "") + " (" + f.start + "-" + f.end + ")";
        select.append(o);
      }
    };
    const feePeriod = (f) => String(f.end).replace(/^(\d{4})(\d{2})$/, "$2/$1");
    const choose = (fromUser) => {
      el.dataset.fund = select.value || "";
      const f = funds.get(select.value);
      chosen.textContent = f ? t("fund.chosen", { name: f.name }) : "";
      const card = el.closest(".card");
      const hint = card && card.querySelector(".feeavg");
      if (hint) {
        if (!f) hint.textContent = "";
        else {
          const ds = (W.OFFICIAL_SOURCES[f.src] || W.OFFICIAL_SOURCES.gemel).dataset;
          const annual = f.fee === null || f.fee === undefined
            ? t("fee.annual_none")
            : t("fee.annual_avg", { fee: f.fee, period: feePeriod(f), href: ds });
          const deposit = f.dfee === null || f.dfee === undefined
            ? t("fee.deposit_none")
            : t("fee.deposit_avg", { fee: f.dfee });
          hint.innerHTML = t("fee.current_note", { annual, deposit });
        }
      }
      const feeIn = card && card.querySelector(".feeadj");
      if (fromUser && feeIn && !feeIn.dataset.manual && f && f.fee !== null && f.fee !== undefined) feeIn.value = f.fee;
      const depIn = card && card.querySelector(".pdepfee");
      if (fromUser && depIn && !depIn.dataset.manual && f && f.dfee !== null && f.dfee !== undefined) depIn.value = f.dfee;
    };
    input.addEventListener("input", () => { show(); choose(true); });
    select.addEventListener("change", () => choose(true));
    el.setFund = (key) => {
      const f = funds.get(key);
      if (!f) return;
      input.value = f.key;
      show();
      select.value = f.key;
      choose();
    };
  }

  const fld = (label, html, cls) => '<label class="f' + (cls ? " " + cls : "") + '"><span>' + label + "</span>" + html + "</label>";
  const dateIn = (c) => '<input type="date" class="' + c + '">';
  const num = (c, extra) => '<input type="number" inputmode="decimal" class="' + c + '" ' + (extra || "") + ">";

  function fieldsFor(type) {
    const grid = (x) => '<div class="grid">' + x + "</div>";
    if (type === "start") return grid(fld(t("field.open_date"), dateIn("date")) + fld(t("field.open_amount"), num("amount", 'min="0"')) + fld(t("field.fee_savings"), num("feeadj", 'min="0" step="0.01" placeholder="0"')) + fld(t("field.fee_deposit"), num("pdepfee", 'min="0" step="0.01" placeholder="0"'))) + '<div class="fundpick"></div><div class="feeavg" role="status"></div>';
    if (type === "deposit" || type === "withdraw") return grid(fld(t("field.date"), dateIn("date")) + fld(t("field.amount"), num("amount", 'min="0"')));
    if (type === "fees") return grid(fld(t("field.from"), dateIn("date")) + fld(t("field.fee_deposit"), num("depfee", 'min="0" step="0.01" placeholder="0"')) + fld(t("field.fee_savings"), num("savfee", 'min="0" step="0.01" placeholder="0"')));
    if (type === "monthly") return grid(fld(t("field.from"), dateIn("from")) + fld(t("field.to"), dateIn("to")) + fld(t("field.monthly_amount"), num("amount", 'min="0"')));
    return grid(fld(t("field.date"), dateIn("date")) + fld(t("field.exit_cost"), num("exit", 'min="0" step="0.1" placeholder="0"')) + fld(t("field.fee_savings"), num("feeadj", 'min="0" step="0.01" placeholder="0"')) + fld(t("field.fee_deposit"), num("pdepfee", 'min="0" step="0.01" placeholder="0"'))) + '<div class="fundpick"></div><div class="feeavg" role="status"></div>';
  }

  function place(card, scope) {
    const target = scope === "actual" ? "#col-actual" : scope === "whatif" ? "#col-whatif" : "#timeline";
    if (target !== "#timeline") $("#fork").hidden = false;
    $(target).append(card);
    syncFork();
  }
  function syncFork() {
    const forked = !$("#fork").hidden;
    $("#fork-btn").hidden = forked;
    $("#add-event").hidden = forked;
    $("#unfork-btn").hidden = !forked;
    for (const c of document.querySelectorAll("#timeline .card:not(.start) .split")) c.hidden = forked;
  }
  function allCards() {
    return [...document.querySelectorAll("#timeline .card, #col-actual .card, #col-whatif .card")];
  }
  function forkFrom(card) {
    const shared = [...document.querySelectorAll("#timeline .card")];
    const from = card ? shared.indexOf(card) : shared.length;
    const moved = shared.slice(from);
    for (const c of moved) {
      const ev = readEvent(c);
      c.remove();
      addCard(ev.type, Object.assign({}, ev, { scope: "actual" }));
      addCard(ev.type, Object.assign({}, ev, { scope: "whatif" }));
    }
    $("#fork").hidden = false;
    syncFork();
    $("#parallel-status").textContent = t("status.forked");
  }
  function unfork() {
    for (const c of [...document.querySelectorAll("#col-whatif .card")]) c.remove();
    for (const c of [...document.querySelectorAll("#col-actual .card")]) {
      const ev = readEvent(c);
      c.remove();
      addCard(ev.type, Object.assign({}, ev, { scope: "both" }));
    }
    $("#fork").hidden = true;
    syncFork();
    $("#parallel-status").textContent = t("status.unforked");
  }

  function addCard(type, values) {
    const card = document.createElement("div");
    card.className = "card" + (type === "start" ? " start" : "");
    card.dataset.type = type;
    let head;
    const scopeSel = '<select class="scope" aria-label="' + t("scope.label") + '"><option value="both">' + t("scope.both") + '</option><option value="actual">' + t("scope.actual_only") + '</option><option value="whatif">' + t("scope.whatif_only") + "</option></select>";
    if (type === "start") {
      head = '<h3>' + t("event.start_title") + ' <span class="badge"></span> <label class="scope-l scope-start" hidden>' + t("scope.label") + " " + scopeSel + "</label></h3>";
    } else {
      const options = Object.keys(TYPES).map((k) => '<option value="' + k + '"' + (k === type ? " selected" : "") + ">" + typeLabel(k) + "</option>").join("");
      head = '<h3><select class="type" aria-label="' + t("event.type_aria") + '">' + options + '</select> <span class="badge"></span> <label class="scope-l">' + t("scope.label") + " " + scopeSel + '</label> <button type="button" class="split">' + t("event.split") + '</button> <button type="button" class="rm">' + t("event.remove") + "</button></h3>";
    }
    card.innerHTML = head + '<div class="body"></div>';
    const wantScope = (values && values.scope) || "both";
    place(card, wantScope);
    const render = (ty, v) => {
      card.dataset.type = ty;
      $(".body", card).innerHTML = fieldsFor(ty);
      const fp = $(".fundpick", card);
      if (fp) fundPicker(fp, t("fund.label"));
      for (const sel of [".feeadj", ".pdepfee"]) {
        const feeIn = $(sel, card);
        if (feeIn) feeIn.addEventListener("input", () => { feeIn.dataset.manual = "1"; });
      }
      if (v) fill(card, v);
    };
    render(type, values);
    const sc = $(".scope", card);
    const BADGES = { both: "", actual: t("scope.actual"), whatif: t("scope.whatif") };
    const paint = () => {
      card.dataset.scope = sc.value;
      if (card.parentNode && card.parentNode.id !== ({ both: "timeline", actual: "col-actual", whatif: "col-whatif" })[sc.value]) place(card, sc.value);
      $(".badge", card).textContent = BADGES[sc.value];
      if (type === "start" && sc.value !== "both") $(".scope-start", card).hidden = false;
    };
    if (values && values.scope) sc.value = values.scope;
    sc.addEventListener("change", paint);
    paint();
    if (type !== "start") {
      $(".type", card).addEventListener("change", (e) => render(e.target.value, null));
      $(".rm", card).addEventListener("click", () => card.remove());
      $(".split", card).addEventListener("click", () => forkFrom(card));
    }
    return card;
  }

  function fill(card, v) {
    const pad = (x) => (typeof x === "string" && /^\d{4}-\d{2}$/.test(x) ? x + "-01" : x);
    const set = (sel, val) => { const el = $(sel, card); if (el && val !== undefined && val !== null) el.value = pad(val); };
    set(".date", v.date); set(".from", v.from); set(".to", v.to); set(".amount", v.amount);
    set(".depfee", v.depositPct || ""); set(".savfee", v.savingsPct || ""); set(".exit", v.exitCostPct || ""); set(".feeadj", v.feeAdjPct || ""); set(".pdepfee", v.depositFeePct || "");
    if (v.feeAdjPct) { const fe = $(".feeadj", card); if (fe) fe.dataset.manual = "1"; }
    if (v.depositFeePct) { const pd = $(".pdepfee", card); if (pd) pd.dataset.manual = "1"; }
    const fp = $(".fundpick", card);
    if (fp && v.fundKey) fp.setFund(v.fundKey);
  }

  function readEvent(card) {
    const type = card.dataset.type;
    const num = (s) => Number($(s, card).value) || 0;
    const e = { type };
    e.scope = $(".scope", card).value;
    if (type === "monthly") { e.from = $(".from", card).value; e.to = $(".to", card).value || undefined; e.amount = num(".amount"); }
    else { e.date = $(".date", card).value; }
    if (type === "start" || type === "deposit" || type === "withdraw") e.amount = num(".amount");
    if (type === "start" || SWITCHES.includes(type)) e.fundKey = $(".fundpick", card).dataset.fund || "";
    if (SWITCHES.includes(type)) { e.exitCostPct = num(".exit"); e.feeAdjPct = num(".feeadj"); e.depositFeePct = num(".pdepfee"); }
    if (type === "start") { e.feeAdjPct = num(".feeadj"); e.depositFeePct = num(".pdepfee"); }
    if (type === "fees") { e.depositPct = num(".depfee"); e.savingsPct = num(".savfee"); }
    return e;
  }

  function readTimeline() {
    const events = [...document.querySelectorAll("#timeline .card, #col-actual .card, #col-whatif .card")].map(readEvent);
    for (const e of events) {
      if (e.type === "monthly" ? !e.from || !e.amount : !e.date) throw new Error(t("error.missing_date"));
      if ((e.type === "start" || SWITCHES.includes(e.type)) && !e.fundKey) throw new Error(t("error.missing_fund", { type: TYPES[e.type] ? typeLabel(e.type) : undefined }));
      if (["deposit", "monthly", "withdraw"].includes(e.type) && !e.amount) throw new Error(t("error.missing_amount"));
    }
    return { end: $("#end").value || undefined, events, annuity: annuityInputs() };
  }

  function annuityInputs() {
    return { guaranteed: $("#coef-guar").value, market: $("#coef-market").value, months: $("#months-ret").value, rate: $("#ret-rate").value };
  }
  function annuityOptions() {
    const a = annuityInputs();
    const market = Number(a.market) || 0;
    if (!market && !(Number(a.guaranteed) > 0)) return null;
    return { guaranteedCoeff: Number(a.guaranteed) || 0, marketCoeff: market, monthsToRetirement: Number(a.months) || 0, assumedAnnualPct: Number(a.rate) || 0 };
  }

  function chart(a, b) {
    const w = 800, h = 260, pad = 10;
    const max = Math.max(...a.series.concat(b.series).map((p) => p.balance), 1);
    const n = a.series.length;
    const pts = (s) => s.map((p, i) => (pad + (i / Math.max(n - 1, 1)) * (w - 2 * pad)).toFixed(1) + "," + (h - pad - (p.balance / max) * (h - 2 * pad)).toFixed(1)).join(" ");
    return '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + t("chart.aria") + '"><polyline fill="none" stroke="#777" stroke-width="2" points="' + pts(a.series) + '"/><polyline fill="none" stroke="#1b5fd1" stroke-width="2" points="' + pts(b.series) + '"/></svg><p><span style="color:#666">━ ' + t("scope.actual") + '</span> &nbsp; <span style="color:#1b5fd1">━ ' + t("scope.whatif") + "</span></p>";
  }


  // Official comparison systems cannot replay a sequence of track switches and their reports are
  // session-bound (no deep links into a fund+period report), so the bottom of the result lists one
  // row per track+period with the exact fund and period to select there. Verified 2026-10-23:
  // gemelTsuot.aspx ignores query-string parameters and renders via a session ReportViewer.
  const VERIFY_SITES = {
    gemel: { name: "verify.site_gemel", url: "https://gemelnet.cma.gov.il/views/gemelTsuot.aspx" },
    insurance: { name: "verify.site_insurance", url: "https://bituachnet.cma.gov.il/bituachTsuotUI/Tsuot/UI/bituachTsuotUI.aspx" },
  };

  const mmYYYY = (label) => label.slice(5, 7) + "/" + label.slice(0, 4);

  function verifyRows(periods) {
    return periods.map((p) => {
      const f = funds.get(p.fundId);
      const period = '<span dir="ltr">' + mmYYYY(p.from) + " - " + mmYYYY(p.to) + "</span>";
      if (!f) return "<li>" + t("verify.not_found", { fund: p.fundId, period }) + "</li>";
      const site = VERIFY_SITES[f.src] || VERIFY_SITES.gemel;
      const idPart = f.src === "gemel" ? t("verify.fund_id", { id: f.id }) : "";
      const meta = f.src === "insurance" ? " (" + (f.corp || "") + ", " + (f.cls || "") + ")" : "";
      const shortNote = f.src === "gemel" && p.months < 12 ? t("verify.short_note") : "";
      const offv = ' <span class="offv" data-key="' + p.fundId + '" data-from="' + p.from + '" data-to="' + p.to + '">' + t("official.loading") + "</span>";
      return '<li><a href="' + site.url + '" target="_blank" rel="noopener">' + t(site.name) + "</a>: " + idPart + f.name + meta + ", " + period + shortNote + offv + "</li>";
    });
  }

  function verifyHtml(c) {
    const endLabel = W.toLabel(W.toIndex($("#end").value || data.latest));
    const periodsA = W.phasePeriods(c.phasesActual, endLabel);
    const periodsB = W.phasePeriods(c.phasesWhatIf, endLabel);
    const same = JSON.stringify(periodsA) === JSON.stringify(periodsB);
    const head =
      "<h3>" + t("verify.title") + "</h3>" +
      '<p class="hint">' + t("verify.hint_manual") + "</p>" +
      '<p class="hint">' + t("verify.hint_live") + "</p>";
    const block = (label, periods) => {
      const rows = verifyRows(periods);
      if (!rows.length) return "";
      return (label ? "<h4>" + label + "</h4>" : "") + "<ul>" + rows.join("") + "</ul>";
    };
    if (same) return head + block("", periodsA);
    return head + block(t("scope.actual"), periodsA) + block(t("scope.whatif"), periodsB);
  }


  // Live consistency check against the official monthly data (data.gov.il). Only the public fund
  // number is sent; the story itself never leaves the browser. Rows are paginated, de-duplicated
  // by report month, and a "match" is shown only on full month coverage of the period.
  const offCache = new Map();
  async function fetchOfficialRows(src, resourceId, fundId) {
    const site = W.OFFICIAL_SOURCES[src] || W.OFFICIAL_SOURCES.gemel;
    const rows = new Map(); // YYYYMM (number) -> monthly yield (%), null when unreported
    let offset = 0;
    for (;;) {
      const url = site.api + "?resource_id=" + resourceId + "&limit=1000&offset=" + offset + "&filters=" + encodeURIComponent(JSON.stringify({ FUND_ID: String(fundId) }));
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("data.gov.il HTTP " + resp.status);
      const j = await resp.json();
      const recs = (j.result && j.result.records) || [];
      for (const r of recs) rows.set(Number(r.REPORT_PERIOD), r.MONTHLY_YIELD === null || r.MONTHLY_YIELD === undefined ? null : Number(r.MONTHLY_YIELD));
      offset += recs.length;
      if (!recs.length || offset >= ((j.result && j.result.total) || 0)) break;
    }
    return rows;
  }

  async function enhanceOfficial() {
    for (const sp of document.querySelectorAll("#result .offv")) {
      const f = funds.get(sp.dataset.key);
      const src = (f && f.src) || "gemel";
      const fundId = f ? f.id : sp.dataset.key.split(":")[1] || "";
      try {
        const a = W.toIndex(sp.dataset.from);
        const b = W.toIndex(sp.dataset.to);
        const rids = W.officialResources(src, sp.dataset.from, sp.dataset.to);
        const rows = new Map();
        for (const rid of rids) {
          const ck = src + "|" + rid + "|" + fundId;
          if (!offCache.has(ck)) offCache.set(ck, fetchOfficialRows(src, rid, fundId));
          const part = await offCache.get(ck);
          for (const [period, y] of part) rows.set(period, y);
        }
        const yields = [];
        for (let i = a; i <= b; i++) {
          const y = rows.get(W.periodOf(i));
          if (y !== null && y !== undefined) yields.push(y);
        }
        const total = b - a + 1;
        const official = W.cumulativeYield(yields);
        const links = rids
          .map((rid, ix) => '<a href="' + W.officialRowsUrl(src, rid, fundId) + '" target="_blank" rel="noopener">' + t("official.rows") + (rids.length > 1 ? " " + (ix + 1) : "") + "</a>")
          .join(" ");
        if (yields.length < total) {
          sp.innerHTML = t("official.partial", { found: yields.length, total, cum: pct(official), links });
          continue;
        }
        const local = f ? W.localCumulative(f, a, b) : null;
        const match = local && local.missing === 0 && Math.abs(official - local.value) < 1e-4;
        let tail = "";
        if (match) tail = t("official.match");
        else if (local) tail = t("official.differs", { reason: local.missing ? t("official.local_missing", { n: local.missing }) : "." });
        sp.innerHTML = t("official.live", { official: pct(official), local: local ? pct(local.value) : "-", tail, links });
      } catch (e) {
        sp.textContent = t("official.failed");
      }
    }
  }

  function run() {
    $("#error").textContent = "";
    try {
      const tl = readTimeline();
      const c = W.runTimeline(tl, funds, data.latest);
      const warn = c.actual.warnings.missingMonths + c.whatIf.warnings.missingMonths;
      const cls = c.diff >= 0 ? "pos" : "neg";
      const ann = annuityOptions();
      const aA = ann && W.annuityEstimate(c.actual, funds, ann);
      const aB = ann && W.annuityEstimate(c.whatIf, funds, ann);
      const head2 = "<table><tr><th></th><th>" + t("scope.actual") + "</th><th>" + t("scope.whatif") + "</th></tr>";
      const notes = W.productChangeNotes(c.phasesActual, funds).concat(W.productChangeNotes(c.phasesWhatIf, funds));
      const label = (a) => (a.basis === "guaranteed" ? t("annuity.basis_guaranteed") : t("annuity.basis_market"));
      const annuityHtml = aA && aB
        ? "<h3>" + t("annuity.title") + "</h3>" + head2 +
          "<tr><td>" + t("annuity.balance") + "</td><td>" + fmt(aA.balance) + " ₪</td><td>" + fmt(aB.balance) + " ₪</td></tr>" +
          "<tr><td>" + t("annuity.coefficient") + "</td><td>" + aA.coefficient + " (" + label(aA) + ")</td><td>" + aB.coefficient + " (" + label(aB) + ")</td></tr>" +
          "<tr><td>" + t("annuity.monthly") + "</td><td>" + fmt(aA.monthly) + " ₪</td><td>" + fmt(aB.monthly) + " ₪</td></tr></table>" +
          '<p class="warn">' + t("annuity.warn") + "</p>"
        : "";
      const notesHtml = notes.length
        ? '<div class="warn"><b>' + t("notes.title") + "</b><ul>" + [1, 2, 3, 4].map((n) => "<li>" + t("notes.item" + n) + "</li>").join("") + "</ul></div>"
        : "";
      $("#result").innerHTML =
        head2 +
        "<tr><td>" + t("result.paid") + "</td><td>" + fmt(c.actual.paid) + " ₪</td><td>" + fmt(c.whatIf.paid) + " ₪</td></tr>" +
        "<tr><td>" + t("result.withdrawn") + "</td><td>" + fmt(c.actual.withdrawn) + " ₪</td><td>" + fmt(c.whatIf.withdrawn) + " ₪</td></tr>" +
        "<tr><td>" + t("result.final") + "</td><td>" + fmt(c.actual.final) + " ₪</td><td>" + fmt(c.whatIf.final) + " ₪</td></tr>" +
        "<tr><td><b>" + t("result.gain") + "</b></td><td><b>" + fmt(c.actual.gain) + " ₪</b></td><td><b>" + fmt(c.whatIf.gain) + " ₪</b></td></tr>" +
        "<tr><td>" + t("result.annualized") + "</td><td>" + pct(c.actual.annualized) + "</td><td>" + pct(c.whatIf.annualized) + "</td></tr></table>" +
        '<p class="' + cls + '">' + t("result.diff", { diff: fmt(c.diff), pct: c.diffPercent === null ? "" : " (" + c.diffPercent.toFixed(1) + "%)" }) + "</p>" +
        chart(c.actual, c.whatIf) + annuityHtml + notesHtml +
        (warn ? '<p class="warn">' + t("result.missing_months", { n: warn }) + "</p>" : "") +
        verifyHtml(c);
        enhanceOfficial();
    } catch (e) {
      $("#error").textContent = e.message;
    }
  }

  const EXAMPLE = {
    end: "2020-12-01",
    events: [
      { type: "start", date: "2005-06-01", fundKey: "i:259012", scope: "both" },
      { type: "monthly", from: "2005-06-01", to: "2011-06-01", amount: 750, scope: "both" },
      { type: "product", date: "2015-03-01", fundKey: "g:761", scope: "whatif" },
    ],
  };

  function loadTimeline(tl) {
    for (const id of ["#timeline", "#col-actual", "#col-whatif"]) $(id).innerHTML = "";
    $("#fork").hidden = true;
    $("#end").value = /^\d{4}-\d{2}$/.test(tl.end || "") ? tl.end + "-01" : tl.end || "";
    for (const e of tl.events) addCard(e.type, e);
    const a = tl.annuity || {};
    $("#coef-guar").value = a.guaranteed || "";
    $("#coef-market").value = a.market || "";
    $("#months-ret").value = a.months || "";
    $("#ret-rate").value = a.rate || "";
  }

  function exportStory() {
    const blob = new Blob([JSON.stringify(readTimeline(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "story.json";
    a.click();
  }

  function fromFragment() {
    const m = /^#story=(.+)$/.exec(location.hash);
    if (!m) return null;
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  // A caught error shows the catalog text when it carries a key (docs/prompt.js), else its message.
  const errText = (e) => (e && e.i18nKey ? t(e.i18nKey) : e.message);
  // The Worker answers {error, code, params}; the page shows its own catalog text for a known code.
  const workerError = (body) => (body.code && L.has("worker." + body.code) ? t("worker." + body.code, body.params) : body.error);
  const toFragment = (obj) => {
    let s = "";
    for (const b of new TextEncoder().encode(JSON.stringify(obj))) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  // Switching language reloads with ?lang=<code>; the story rides along in the fragment (never sent).
  const pickLanguage = (code) => {
    let hash = location.hash;
    try { hash = "#story=" + toFragment(readTimeline()); } catch (e) { /* incomplete story: keep the current fragment */ }
    const q = new URLSearchParams(location.search);
    q.set("lang", code);
    location.href = location.pathname + "?" + q + hash;
  };

  Promise.all([fetch("i18n/strings.json").then((r) => r.json()), fetch("data/funds.json").then((r) => r.json())]).then(([catalog, d]) => {
    L = I18n.create(catalog, I18n.langFromSearch(catalog, location.search));
    I18n.apply(L, document, pickLanguage);
    data = d;
    funds = W.indexFunds(d);
    $("#end").value = W.toLabel(W.toIndex(d.latest)) + "-01";
    $("#data-info").textContent = t("data.info", { latest: W.toLabel(W.toIndex(d.latest)), count: d.funds.length });
    let loaded = false;
    try {
      const tl = fromFragment();
      if (tl && Array.isArray(tl.events)) { loadTimeline(tl); loaded = true; }
    } catch (e) {
      $("#error").textContent = t("error.bad_link", { msg: errText(e) });
    }
    if (!loaded) addCard("start");
    $("#add-event").onclick = () => addCard("deposit");
    $("#fork-btn").onclick = () => forkFrom(null);
    $("#unfork-btn").onclick = unfork;
    $("#add-actual").onclick = () => addCard("deposit", { scope: "actual" });
    $("#add-whatif").onclick = () => addCard("deposit", { scope: "whatif" });
    $("#load-example").onclick = () => {
      loadTimeline(EXAMPLE);
      $("#parallel-status").textContent = t("status.example_loaded");
    };
    $("#run").onclick = run;
    $("#build-ai").onclick = async () => {
      const text = $("#story-text").value.trim();
      if (!text) { $("#ai-status").textContent = t("ai.need_text"); return; }
      $("#ai-status").textContent = t("ai.building");
      $("#build-ai").disabled = true;
      try {
        const res = await fetch(WORKER_URL + "/api/story", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
        const body = await res.json();
        if (!res.ok) throw new Error(workerError(body) || t("ai.http_error", { status: res.status }));
        loadTimeline(body.story);
        $("#ai-status").textContent = t("ai.loaded", { notes: (body.warnings || []).length ? t("ai.notes", { list: body.warnings.join("; ") }) : "" });
        $("#error").textContent = "";
      } catch (e) { $("#ai-status").textContent = t("ai.failed", { msg: errText(e) }); }
      $("#build-ai").disabled = false;
    };
    $("#copy-prompt").onclick = () => {
      const text = StoryPrompt.buildPrompt($("#story-text").value);
      const done = () => { $("#ai-status").textContent = t("prompt.copied"); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => { $("#ai-reply").value = text; $("#ai-status").textContent = t("prompt.blocked"); });
      else { $("#ai-reply").value = text; $("#ai-status").textContent = t("prompt.manual"); }
    };
    $("#load-reply").onclick = () => {
      try {
        const r = StoryPrompt.resolveFunds(StoryPrompt.extractJson($("#ai-reply").value), (name) => W.searchFunds(data, name, 3));
        loadTimeline(r.story);
        const lines = r.resolved.map((x) => "\"" + x.asked + "\" -> " + x.got);
        $("#ai-status").textContent = t("reply.loaded", { lines: lines.join("; ") || "-", missing: r.missing.length ? t("reply.missing", { list: r.missing.join(", ") }) : "" });
        $("#error").textContent = "";
      } catch (e) { $("#ai-status").textContent = t("reply.failed", { msg: errText(e) }); }
    };
    $("#export").onclick = () => { try { exportStory(); } catch (e) { $("#error").textContent = e.message; } };
    $("#import").onchange = (e) => e.target.files[0] && e.target.files[0].text().then((txt) => loadTimeline(JSON.parse(txt))).catch((x) => { $("#error").textContent = t("error.bad_file", { msg: errText(x) }); });
  });
})();
