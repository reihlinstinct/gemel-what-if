// Shared plumbing for the e2e smoke flows: a static server for docs/, the in-page
// DOM probe, and the assertions over its payload. Used by smoke.js (headless Chrome)
// and webkit.js (Playwright WebKit), so both engines run exactly the same checks.
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../docs");

// Synthetic example story (fictional companies, dates and amounts; see CONTRIBUTING).
const story = {
  end: "2010-12",
  events: [
    { type: "start", date: "2005-06", fundKey: "i:259012" },
    { type: "monthly", from: "2005-06", to: "2009-06", amount: 750 },
  ],
};
const fragment = Buffer.from(JSON.stringify(story)).toString("base64url");

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml" };

function check(cond, msg) {
  if (!cond) { console.error("FAIL: " + msg); process.exitCode = 1; } else console.log("ok: " + msg);
}

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split("?")[0].split("#")[0]).replace(/\/$/, "/index.html"));
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, base: "http://localhost:" + server.address().port + "/" })));
}

// Runs inside the app page, in any engine. Drives the collapsed AI section, the
// paste-JSON fallback, the official fee defaults and a full calculation, and returns
// a compact payload string for assertResult. Must stay free of outer references so it
// can be serialized into the Chrome harness and into page.evaluate for WebKit.
function domProbe(d) {
  d = d || document;
  const q = (s) => d.querySelector(s);
  const aiSection = q("#ai-section");
  const aiClosedDefault = aiSection.open === false;
  aiSection.querySelector("summary").click();
  const aiOpensOnDemand = aiSection.open === true;
  q("#ai-reply").value = 'ok {"events":[{"type":"start","date":"2005-01-01","fundName":"הראל קרן"},{"type":"monthly","from":"2005-01-01","to":"2005-12-01","amount":500}]} thanks';
  q("#load-reply").click();
  const aiCards = d.querySelectorAll(".card").length;
  const aiStatus = q("#ai-status").textContent;
  const sel = q(".card .fundpick select");
  sel.dispatchEvent(new Event("change"));
  const feeVal = (q(".card .feeadj") || {}).value || "";
  const feeHint = ((q(".card .feeavg") || {}).textContent || "");
  let depVal = (q(".card .pdepfee") || {}).value || "";
  if (depVal === "") {
    const inp = q(".card .fundpick input");
    inp.value = "כלל תמר";
    inp.dispatchEvent(new Event("input"));
    for (const o of sel.options) {
      sel.value = o.value;
      sel.dispatchEvent(new Event("change"));
      const v = (q(".card .pdepfee") || {}).value || "";
      if (v !== "") { depVal = v; break; }
    }
  }
  const depHint = ((q(".card .feeavg") || {}).textContent || "");
  const depKind = depHint.includes("מהפקדה ממוצעים רשמיים") ? "depavg" : (depHint.includes("אין נתון דמי ניהול מהפקדה") ? "depnone" : "depmissing");
  q("#ai-reply").value = 'ok {"events":[{"type":"start","date":"2005-01-01","fundName":"הראל קרן","depositFeePct":0.7},{"type":"monthly","from":"2005-01-01","to":"2005-12-01","amount":500}]} thanks';
  q("#load-reply").click();
  const depRestored = (q(".card .pdepfee") || {}).value || "";
  const depManual = (q(".card .pdepfee") || {}).dataset.manual || "";
  q("#story-text").value = "x";
  q("#run").click();
  const unnamed = [...d.querySelectorAll("input,select,textarea")].filter((e) => !(e.closest("label") || e.getAttribute("aria-label") || (e.id && d.querySelector('label[for="' + e.id + '"]')))).length;
  return unnamed + "#" + q("#error").textContent + "|" + aiCards + "|" + aiStatus.slice(0, 5) + "|" + q("#result").innerText.replace(/\s+/g, " ") + "|" + [...d.querySelectorAll("#result a")].map((x) => x.getAttribute("href")).join(",") + "@" + d.querySelectorAll("#result .offv").length + "^" + feeVal + "^" + feeHint.slice(0, 30) + "^" + depVal + "^" + depKind + "^" + depRestored + "^" + depManual + "~" + aiClosedDefault + "~" + aiOpensOnDemand;
}

// Parses the probe payload out of a page dump ("RESULT:...") and checks every expectation.
function assertResult(dom) {
  const m = /RESULT:([^<]*)/.exec(dom);
  check(m, "page produced a result");
  if (!m) return;
  const [unnamed, rest] = m[1].split("#");
  const [err, cards, aiStatus, text, linksAndOffv] = rest.split("|");
  const [links, offv] = (linksAndOffv || "").split("@");
  const [offvCount, feeVal, feeHint, depVal, depKind, depRestored, depManual, aiClosed, aiOpens] = (offv || "").split(/[\^~]/);
  check(unnamed === "0", "every form control has an accessible name (" + unnamed + " without)");
  check(err === "", "no error shown");
  check(cards === "2", "pasted AI reply replaced the timeline (2 cards)");
  check(aiStatus === "נטען.", "AI reply resolved the fund name");
  check(/6,000/.test(text) && /רווח כולל/.test(text), "result shows deposits and total profit");
  check(/בדיקה מול גמל-נט וביטוח-נט/.test(text) && /01\/2005 - /.test(text), "result ends with per-track verification rows");
  check(/cma\.gov\.il/.test(links || ""), "verification rows link to the official comparison system");
  check(offvCount === "1", "one live official-data placeholder per verification row (got " + offvCount + ")");
  check(/טוען נתונים רשמיים|data.gov.il|לא ניתן למשוך/.test(text), "live official-data check renders in the result");
  check(feeVal !== "" && feeVal !== "0", "selecting a track prefills its official average fee (got \"" + feeVal + "\")");
  check(/ממוצע/.test(feeHint || ""), "fee hint shows the official average with its source period (got \"" + feeHint + "\")");
  check(depKind === "depavg", "scanning the track list finds one with an official deposit average (got \"" + depKind + "\")");
  check((depKind === "depavg") === (depVal !== ""), "deposit fee prefilled exactly when the track has an official deposit average (kind " + depKind + ", value \"" + depVal + "\")");
  check(depRestored === "0.7" && depManual === "1", "a restored story keeps its deposit fee as a manual value (got \"" + depRestored + "\", manual=" + depManual + ")");
  check(aiClosed === "true", "AI story section is collapsed by default");
  check(aiOpens === "true", "AI story section opens on demand");
}

// Static checks on the shipped files (markup essentials and required assets).
function staticChecks() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  check(/<html lang="he" dir="rtl">/.test(html), "html lang/dir set");
  check(/og:image/.test(html) && /rel="icon"/.test(html) && /name="description"/.test(html), "preview, icon and description meta present");
  for (const f of ["og.png", "favicon.svg", "robots.txt", "sitemap.xml", ".well-known/security.txt", "data/funds.json"]) check(fs.existsSync(path.join(root, f)), f + " exists");
}

module.exports = { root, story, fragment, check, serve, domProbe, assertResult, staticChecks };
