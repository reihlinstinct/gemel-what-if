(function () {
  "use strict";
  const W = window.WhatIf;
  let data = null;
  let funds = null;
  const $ = (s, r) => (r || document).querySelector(s);
  const fmt = (n) => Math.round(n).toLocaleString("he-IL");
  const pct = (n) => (n === null || n === undefined ? "-" : (n * 100).toFixed(2) + "%");

  /** Fund picker: search box + select. Stores the chosen id on el.dataset.fund. */
  function fundPicker(el, label) {
    el.innerHTML = "";
    const lab = document.createElement("span");
    lab.textContent = label + " ";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "חיפוש: שם מסלול, חברה או מספר קופה";
    const select = document.createElement("select");
    const chosen = document.createElement("span");
    chosen.className = "chosen";
    el.append(lab, input, select, chosen);
    const show = () => {
      select.innerHTML = "";
      for (const f of W.searchFunds(data, input.value, 40)) {
        const o = document.createElement("option");
        o.value = f.key;
        o.textContent = (f.src === "insurance" ? "ביטוח" : "גמל") + " " + f.id + " | " + f.name + " | " + (f.corp || "") + " | " + (f.cls || "") + " (" + f.start + "-" + f.end + ")";
        select.append(o);
      }
    };
    const choose = () => {
      el.dataset.fund = select.value || "";
      const f = funds.get(select.value);
      chosen.textContent = f ? " ✓ " + f.name : "";
    };
    input.addEventListener("input", () => { show(); choose(); });
    select.addEventListener("change", choose);
    el.setFund = (key) => {
      const f = funds.get(key);
      if (!f) return;
      input.value = f.key;
      show();
      select.value = f.key;
      choose();
    };
  }

  function addRow(container, html) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = html + ' <button type="button" class="rm">הסר</button>';
    $(".rm", row).addEventListener("click", () => row.remove());
    container.append(row);
    return row;
  }

  function addMonthly(v) {
    const r = addRow($("#deposits"), 'הפקדה חודשית <input type="number" class="amt" min="0" step="1"> ₪ מ-<input type="month" class="from"> עד <input type="month" class="to">');
    if (v) { $(".amt", r).value = v.monthly; $(".from", r).value = v.from; $(".to", r).value = v.to || ""; }
    r.dataset.kind = "monthly";
  }
  function addLump(v) {
    const r = addRow($("#deposits"), 'הפקדה חד-פעמית <input type="number" class="amt" min="0" step="1"> ₪ ב-<input type="month" class="from">');
    if (v) { $(".amt", r).value = v.amount; $(".from", r).value = v.date; }
    r.dataset.kind = "lump";
  }
  function addSwitch(container, v) {
    const r = addRow(container, 'ב-<input type="month" class="date"> מעבר למסלול: <span class="fundpick"></span> עלות חד-פעמית <input type="number" class="exit" min="0" step="0.1" placeholder="0"> % ושינוי דמי ניהול שנתיים <input type="number" class="feeadj" step="0.1" placeholder="0"> נק\' אחוז');
    fundPicker($(".fundpick", r), "");
    if (v) {
      $(".date", r).value = v.date;
      $(".fundpick", r).setFund(v.to);
      $(".exit", r).value = v.exitCostPct || "";
      $(".feeadj", r).value = v.feeAdjPct || "";
    }
  }

  function readDeposits() {
    const out = [];
    for (const r of document.querySelectorAll("#deposits .row")) {
      const amt = Number($(".amt", r).value);
      const from = $(".from", r).value;
      if (!amt || !from) continue;
      if (r.dataset.kind === "monthly") out.push({ monthly: amt, from, to: $(".to", r).value || undefined });
      else out.push({ amount: amt, date: from });
    }
    return out;
  }
  function readSwitches(container) {
    return [...container.querySelectorAll(".row")]
      .map((r) => ({
        date: $(".date", r).value,
        to: $(".fundpick", r).dataset.fund,
        exitCostPct: Number($(".exit", r).value) || 0,
        feeAdjPct: Number($(".feeadj", r).value) || 0,
      }))
      .filter((s) => s.date && s.to);
  }
  const startFund = (id) => $('.fundpick[data-id="' + id + '"]').dataset.fund || "";

  function readStory() {
    const start = $("#start").value;
    const end = $("#end").value;
    const deposits = readDeposits();
    const s0 = startFund("actual-start");
    if (!start || !deposits.length) throw new Error("חסרים תאריך התחלה או הפקדות");
    if (!s0) throw new Error("בחרו מסלול התחלתי");
    const same = $("#same-start").checked;
    const a0 = same ? s0 : startFund("alt-start");
    if (!a0) throw new Error("בחרו מסלול התחלתי לתרחיש 'אילו'");
    return {
      base: { start, end: end || undefined, deposits },
      actual: { start: s0, switches: readSwitches($("#actual-switches")) },
      alt: { start: a0, switches: readSwitches($("#alt-switches")) },
      same,
      annuity: {
        guaranteed: $("#coef-guar").value,
        market: $("#coef-market").value,
        months: $("#months-ret").value,
        rate: $("#ret-rate").value,
      },
    };
  }

  function readAnnuityOptions() {
    const marketCoeff = Number($("#coef-market").value) || 0;
    if (!marketCoeff && !(Number($("#coef-guar").value) > 0)) return null;
    return {
      guaranteedCoeff: Number($("#coef-guar").value) || 0,
      marketCoeff,
      monthsToRetirement: Number($("#months-ret").value) || 0,
      assumedAnnualPct: Number($("#ret-rate").value) || 0,
    };
  }

  function chart(a, b) {
    const w = 800, h = 260, pad = 10;
    const all = a.series.concat(b.series);
    const max = Math.max(...all.map((p) => p.balance), 1);
    const n = a.series.length;
    const pts = (s) => s.map((p, i) => (pad + (i / Math.max(n - 1, 1)) * (w - 2 * pad)).toFixed(1) + "," + (h - pad - (p.balance / max) * (h - 2 * pad)).toFixed(1)).join(" ");
    return '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="גרף יתרה"><polyline fill="none" stroke="#777" stroke-width="2" points="' + pts(a.series) + '"/><polyline fill="none" stroke="#1b5fd1" stroke-width="2" points="' + pts(b.series) + '"/></svg><p><span style="color:#777">━ בפועל</span> &nbsp; <span style="color:#1b5fd1">━ אילו</span></p>';
  }

  function run() {
    $("#error").textContent = "";
    try {
      const s = readStory();
      const actualPhases = W.phasesFromSwitches(s.base.start, s.actual.start, s.actual.switches);
      const altPhases = W.phasesFromSwitches(s.base.start, s.alt.start, s.alt.switches);
      const c = W.compare(s.base, actualPhases, altPhases, funds, data.latest);
      const warn = c.actual.warnings.missingMonths + c.whatIf.warnings.missingMonths;
      const cls = c.diff >= 0 ? "pos" : "neg";
      const ann = readAnnuityOptions();
      const aA = ann && W.annuityEstimate(c.actual, funds, ann);
      const aB = ann && W.annuityEstimate(c.whatIf, funds, ann);
      const notes = W.productChangeNotes(actualPhases, funds).concat(W.productChangeNotes(altPhases, funds));
      const basisLabel = (a) => (a.basis === "guaranteed" ? "מקדם מובטח" : "מקדם שוק");
      const annuityHtml = aA && aB
        ? "<h3>הערכת קצבה חודשית (הערכה בלבד)</h3><table><tr><th></th><th>בפועל</th><th>אילו</th></tr>" +
          "<tr><td>יתרה בפרישה</td><td>" + fmt(aA.balance) + " ₪</td><td>" + fmt(aB.balance) + " ₪</td></tr>" +
          "<tr><td>מקדם (הון ל-1 ₪ קצבה)</td><td>" + aA.coefficient + " (" + basisLabel(aA) + ")</td><td>" + aB.coefficient + " (" + basisLabel(aB) + ")</td></tr>" +
          "<tr><td>קצבה חודשית משוערת</td><td>" + fmt(aA.monthly) + " ₪</td><td>" + fmt(aB.monthly) + " ₪</td></tr></table>" +
          "<p class=\"warn\">ההערכה תלויה במקדמים ובתשואה שהוזנו. המקדם המובטח נלקח ממסמכי הפוליסה שלכם ואינו מאומת. כספים במסלול ביטוח מקבלים את המקדם המובטח (אם הוזן), ואחרת מקדם שוק.</p>"
        : "";
      const notesHtml = notes.length
        ? "<div class=\"warn\"><b>מה לא מחושב במעבר בין מוצרים:</b><ul><li>מקדם קצבה מובטח בפוליסה עלול ללכת לאיבוד (ראו הערכת קצבה למעלה, אם הוזנו מקדמים)</li><li>כיסויים ביטוחיים (נכות, שארים) שנגרעים או משתנים</li><li>דמי ניהול חוזיים: אפשר להזין אותם בשדה שינוי דמי ניהול ועלות חד-פעמית</li><li>מסים, וגיל וזכויות ייחודיות שבפוליסה</li></ul></div>"
        : "";
      $("#result").innerHTML =
        "<table><tr><th></th><th>בפועל</th><th>אילו</th></tr>" +
        "<tr><td>סך הפקדות</td><td>" + fmt(c.actual.paid) + " ₪</td><td>" + fmt(c.whatIf.paid) + " ₪</td></tr>" +
        "<tr><td>שווי סופי</td><td>" + fmt(c.actual.final) + " ₪</td><td>" + fmt(c.whatIf.final) + " ₪</td></tr>" +
        "<tr><td>רווח</td><td>" + fmt(c.actual.gain) + " ₪</td><td>" + fmt(c.whatIf.gain) + " ₪</td></tr>" +
        "<tr><td>תשואה שנתית משוקללת</td><td>" + pct(c.actual.annualized) + "</td><td>" + pct(c.whatIf.annualized) + "</td></tr></table>" +
        '<p class="' + cls + '">ההפרש: ' + fmt(c.diff) + " ₪" + (c.diffPercent === null ? "" : " (" + c.diffPercent.toFixed(1) + "%)") + "</p>" +
        chart(c.actual, c.whatIf) + annuityHtml + notesHtml +
        (warn ? "<p class=\"warn\">ב-" + warn + " חודשים (במצטבר) לא היה דיווח תשואה למסלול (למשל לפני הקמתו), ולכן חושבה בהם תשואה 0%. כדאי לבדוק את תאריכי המעברים.</p>" : "");
    } catch (e) {
      $("#error").textContent = e.message;
    }
  }

  function exportStory() {
    const s = readStory();
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "story.json";
    a.click();
  }
  function importStory(file) {
    file.text().then((t) => {
      const s = JSON.parse(t);
      $("#start").value = s.base.start;
      $("#end").value = s.base.end || "";
      $("#deposits").innerHTML = "";
      for (const d of s.base.deposits) (d.monthly !== undefined ? addMonthly : addLump)(d);
      $('.fundpick[data-id="actual-start"]').setFund(s.actual.start);
      $("#actual-switches").innerHTML = "";
      s.actual.switches.forEach((x) => addSwitch($("#actual-switches"), x));
      $("#same-start").checked = !!s.same;
      $('.fundpick[data-id="alt-start"]').hidden = !!s.same;
      if (!s.same) $('.fundpick[data-id="alt-start"]').setFund(s.alt.start);
      $("#alt-switches").innerHTML = "";
      s.alt.switches.forEach((x) => addSwitch($("#alt-switches"), x));
      const an = s.annuity || {};
      $("#coef-guar").value = an.guaranteed || "";
      $("#coef-market").value = an.market || "";
      $("#months-ret").value = an.months || "";
      $("#ret-rate").value = an.rate || "";
    }).catch((e) => { $("#error").textContent = "קובץ לא תקין: " + e.message; });
  }

  fetch("data/funds.json").then((r) => r.json()).then((d) => {
    data = d;
    funds = W.indexFunds(d);
    $("#end").value = W.toLabel(W.toIndex(d.latest));
    $("#data-info").textContent = "נתונים עד " + W.toLabel(W.toIndex(d.latest)) + ", " + d.funds.length + " קופות ומסלולים.";
    fundPicker($('.fundpick[data-id="actual-start"]'), "מסלול התחלתי:");
    fundPicker($('.fundpick[data-id="alt-start"]'), "מסלול התחלתי (אילו):");
    addMonthly();
    $("#add-monthly").onclick = () => addMonthly();
    $("#add-lump").onclick = () => addLump();
    $("#add-actual").onclick = () => addSwitch($("#actual-switches"));
    $("#add-alt").onclick = () => addSwitch($("#alt-switches"));
    $("#same-start").onchange = (e) => { $('.fundpick[data-id="alt-start"]').hidden = e.target.checked; };
    $("#run").onclick = run;
    $("#export").onclick = () => { try { exportStory(); } catch (e) { $("#error").textContent = e.message; } };
    $("#import").onchange = (e) => e.target.files[0] && importStory(e.target.files[0]);
  });
})();
