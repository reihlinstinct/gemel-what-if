(function () {
  "use strict";
  const W = window.WhatIf;
  let data = null;
  let funds = null;
  const $ = (s, r) => (r || document).querySelector(s);
  const fmt = (n) => Math.round(n).toLocaleString("he-IL");
  const pct = (n) => (n === null || n === undefined ? "-" : (n * 100).toFixed(2) + "%");

  const TYPES = {
    deposit: "הפקדה חד-פעמית",
    monthly: "הפקדות חודשיות",
    withdraw: "משיכה",
    transfer: "מעבר קופה",
    product: "שינוי מוצר",
    track: "שינוי מסלול",
  };
  const SWITCHES = ["transfer", "product", "track"];

  /** Fund picker: search box + select; the chosen key is kept in el.dataset.fund. */
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
        o.textContent = (f.src === "insurance" ? "ביטוח" : "גמל") + " " + f.id + " | " + f.name + " | " + (f.corp || "") + " (" + f.start + "-" + f.end + ")";
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

  function fieldsFor(type) {
    if (type === "start") return 'פתיחה ב-<input type="month" class="date"> סכום פתיחה (אופציונלי) <input type="number" class="amount" min="0"> ₪<div class="fundpick"></div>';
    if (type === "deposit" || type === "withdraw") return 'ב-<input type="month" class="date"> סכום <input type="number" class="amount" min="0"> ₪';
    if (type === "monthly") return 'מ-<input type="month" class="from"> עד <input type="month" class="to"> סכום חודשי <input type="number" class="amount" min="0"> ₪';
    return 'ב-<input type="month" class="date"><div class="fundpick"></div>עלות חד-פעמית <input type="number" class="exit" min="0" step="0.1" placeholder="0"> % ושינוי דמי ניהול שנתיים <input type="number" class="feeadj" step="0.1" placeholder="0"> נק\' אחוז';
  }

  function addCard(type, values) {
    const card = document.createElement("div");
    card.className = "card" + (type === "start" ? " start" : "");
    card.dataset.type = type;
    let head;
    if (type === "start") {
      head = "<h3>אירוע התחלה: פתיחת קופה</h3>";
    } else {
      const options = Object.keys(TYPES).map((k) => '<option value="' + k + '"' + (k === type ? " selected" : "") + ">" + TYPES[k] + "</option>").join("");
      head = '<h3><select class="type">' + options + '</select> <label>חל על <select class="scope"><option value="both">שני התרחישים</option><option value="actual">בפועל בלבד</option><option value="whatif">אילו בלבד</option></select></label> <button type="button" class="rm">הסר</button></h3>';
    }
    card.innerHTML = head + '<div class="body"></div>';
    $("#timeline").append(card);
    const render = (t, v) => {
      card.dataset.type = t;
      $(".body", card).innerHTML = fieldsFor(t);
      const fp = $(".fundpick", card);
      if (fp) fundPicker(fp, "מסלול:");
      if (v) fill(card, v);
    };
    render(type, values);
    if (type !== "start") {
      $(".type", card).addEventListener("change", (e) => render(e.target.value, null));
      $(".rm", card).addEventListener("click", () => card.remove());
      if (values && values.scope) $(".scope", card).value = values.scope;
    }
    return card;
  }

  function fill(card, v) {
    const set = (sel, val) => { const el = $(sel, card); if (el && val !== undefined && val !== null) el.value = val; };
    set(".date", v.date); set(".from", v.from); set(".to", v.to); set(".amount", v.amount);
    set(".exit", v.exitCostPct || ""); set(".feeadj", v.feeAdjPct || "");
    const fp = $(".fundpick", card);
    if (fp && v.fundKey) fp.setFund(v.fundKey);
  }

  function readEvent(card) {
    const type = card.dataset.type;
    const num = (s) => Number($(s, card).value) || 0;
    const e = { type };
    if (type !== "start") e.scope = $(".scope", card).value;
    if (type === "monthly") { e.from = $(".from", card).value; e.to = $(".to", card).value || undefined; e.amount = num(".amount"); }
    else { e.date = $(".date", card).value; }
    if (type === "start" || type === "deposit" || type === "withdraw") e.amount = num(".amount");
    if (type === "start" || SWITCHES.includes(type)) e.fundKey = $(".fundpick", card).dataset.fund || "";
    if (SWITCHES.includes(type)) { e.exitCostPct = num(".exit"); e.feeAdjPct = num(".feeadj"); }
    return e;
  }

  function readTimeline() {
    const events = [...document.querySelectorAll("#timeline .card")].map(readEvent);
    for (const e of events) {
      if (e.type === "monthly" ? !e.from || !e.amount : !e.date) throw new Error("חסר תאריך באחד האירועים");
      if ((e.type === "start" || SWITCHES.includes(e.type)) && !e.fundKey) throw new Error("בחרו מסלול באירוע " + TYPES[e.type] || "ההתחלה");
      if (["deposit", "monthly", "withdraw"].includes(e.type) && !e.amount) throw new Error("חסר סכום באחד האירועים");
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
    return '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="גרף יתרה"><polyline fill="none" stroke="#777" stroke-width="2" points="' + pts(a.series) + '"/><polyline fill="none" stroke="#1b5fd1" stroke-width="2" points="' + pts(b.series) + '"/></svg><p><span style="color:#777">━ בפועל</span> &nbsp; <span style="color:#1b5fd1">━ אילו</span></p>';
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
      const notes = W.productChangeNotes(c.phasesActual, funds).concat(W.productChangeNotes(c.phasesWhatIf, funds));
      const label = (a) => (a.basis === "guaranteed" ? "מקדם מובטח" : "מקדם שוק");
      const annuityHtml = aA && aB
        ? "<h3>הערכת קצבה חודשית (הערכה בלבד)</h3><table><tr><th></th><th>בפועל</th><th>אילו</th></tr>" +
          "<tr><td>יתרה בפרישה</td><td>" + fmt(aA.balance) + " ₪</td><td>" + fmt(aB.balance) + " ₪</td></tr>" +
          "<tr><td>מקדם (הון ל-1 ₪ קצבה)</td><td>" + aA.coefficient + " (" + label(aA) + ")</td><td>" + aB.coefficient + " (" + label(aB) + ")</td></tr>" +
          "<tr><td>קצבה חודשית משוערת</td><td>" + fmt(aA.monthly) + " ₪</td><td>" + fmt(aB.monthly) + " ₪</td></tr></table>" +
          '<p class="warn">ההערכה תלויה במקדמים ובתשואה שהוזנו. המקדם המובטח נלקח ממסמכי הפוליסה שלכם ואינו מאומת. כספים במסלול ביטוח מקבלים את המקדם המובטח (אם הוזן), ואחרת מקדם שוק.</p>'
        : "";
      const notesHtml = notes.length
        ? '<div class="warn"><b>מה לא מחושב במעבר בין מוצרים:</b><ul><li>מקדם קצבה מובטח בפוליסה עלול ללכת לאיבוד</li><li>כיסויים ביטוחיים (נכות, שארים) שנגרעים או משתנים</li><li>דמי ניהול חוזיים: אפשר להזין אותם בעלות חד-פעמית ושינוי דמי ניהול</li><li>מסים וזכויות ייחודיות שבפוליסה</li></ul></div>'
        : "";
      $("#result").innerHTML =
        "<table><tr><th></th><th>בפועל</th><th>אילו</th></tr>" +
        "<tr><td>סך הפקדות</td><td>" + fmt(c.actual.paid) + " ₪</td><td>" + fmt(c.whatIf.paid) + " ₪</td></tr>" +
        "<tr><td>סך משיכות</td><td>" + fmt(c.actual.withdrawn) + " ₪</td><td>" + fmt(c.whatIf.withdrawn) + " ₪</td></tr>" +
        "<tr><td>שווי סופי</td><td>" + fmt(c.actual.final) + " ₪</td><td>" + fmt(c.whatIf.final) + " ₪</td></tr>" +
        "<tr><td><b>רווח כולל על כל ציר הזמן</b></td><td><b>" + fmt(c.actual.gain) + " ₪</b></td><td><b>" + fmt(c.whatIf.gain) + " ₪</b></td></tr>" +
        "<tr><td>תשואה שנתית משוקללת</td><td>" + pct(c.actual.annualized) + "</td><td>" + pct(c.whatIf.annualized) + "</td></tr></table>" +
        '<p class="' + cls + '">ההפרש בין התרחישים: ' + fmt(c.diff) + " ₪" + (c.diffPercent === null ? "" : " (" + c.diffPercent.toFixed(1) + "%)") + "</p>" +
        chart(c.actual, c.whatIf) + annuityHtml + notesHtml +
        (warn ? '<p class="warn">ב-' + warn + " חודשים (במצטבר) לא היה דיווח תשואה למסלול (למשל לפני הקמתו), ולכן חושבה בהם תשואה 0%. כדאי לבדוק את התאריכים.</p>" : "");
    } catch (e) {
      $("#error").textContent = e.message;
    }
  }

  function loadTimeline(tl) {
    $("#timeline").innerHTML = "";
    $("#end").value = tl.end || "";
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

  fetch("data/funds.json").then((r) => r.json()).then((d) => {
    data = d;
    funds = W.indexFunds(d);
    $("#end").value = W.toLabel(W.toIndex(d.latest));
    $("#data-info").textContent = "נתונים עד " + W.toLabel(W.toIndex(d.latest)) + ", " + d.funds.length + " מסלולים.";
    let loaded = false;
    try {
      const tl = fromFragment();
      if (tl && Array.isArray(tl.events)) { loadTimeline(tl); loaded = true; }
    } catch (e) {
      $("#error").textContent = "הסיפור בקישור אינו תקין: " + e.message;
    }
    if (!loaded) addCard("start");
    $("#add-event").onclick = () => addCard("deposit");
    $("#run").onclick = run;
    $("#export").onclick = () => { try { exportStory(); } catch (e) { $("#error").textContent = e.message; } };
    $("#import").onchange = (e) => e.target.files[0] && e.target.files[0].text().then((t) => loadTimeline(JSON.parse(t))).catch((x) => { $("#error").textContent = "קובץ לא תקין: " + x.message; });
  });
})();
