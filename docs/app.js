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
        o.value = f.id;
        o.textContent = f.id + " | " + f.name + " | " + (f.corp || "") + " | " + (f.cls || "") + " (" + f.start + "-" + f.end + ")";
        select.append(o);
      }
    };
    const choose = () => {
      el.dataset.fund = select.value || "";
      const f = funds.get(Number(select.value));
      chosen.textContent = f ? " ✓ " + f.id + " " + f.name : "";
    };
    input.addEventListener("input", () => { show(); choose(); });
    select.addEventListener("change", choose);
    el.setFund = (id) => {
      const f = funds.get(Number(id));
      if (!f) return;
      input.value = String(f.id);
      show();
      select.value = String(f.id);
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
    const r = addRow(container, 'ב-<input type="month" class="date"> מעבר למסלול: <span class="fundpick"></span>');
    fundPicker($(".fundpick", r), "");
    if (v) { $(".date", r).value = v.date; $(".fundpick", r).setFund(v.to); }
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
      .map((r) => ({ date: $(".date", r).value, to: Number($(".fundpick", r).dataset.fund) }))
      .filter((s) => s.date && s.to);
  }
  const startFund = (id) => Number($('.fundpick[data-id="' + id + '"]').dataset.fund);

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
      $("#result").innerHTML =
        "<table><tr><th></th><th>בפועל</th><th>אילו</th></tr>" +
        "<tr><td>סך הפקדות</td><td>" + fmt(c.actual.paid) + " ₪</td><td>" + fmt(c.whatIf.paid) + " ₪</td></tr>" +
        "<tr><td>שווי סופי</td><td>" + fmt(c.actual.final) + " ₪</td><td>" + fmt(c.whatIf.final) + " ₪</td></tr>" +
        "<tr><td>רווח</td><td>" + fmt(c.actual.gain) + " ₪</td><td>" + fmt(c.whatIf.gain) + " ₪</td></tr>" +
        "<tr><td>תשואה שנתית משוקללת</td><td>" + pct(c.actual.annualized) + "</td><td>" + pct(c.whatIf.annualized) + "</td></tr></table>" +
        '<p class="' + cls + '">ההפרש: ' + fmt(c.diff) + " ₪" + (c.diffPercent === null ? "" : " (" + c.diffPercent.toFixed(1) + "%)") + "</p>" +
        chart(c.actual, c.whatIf) +
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
