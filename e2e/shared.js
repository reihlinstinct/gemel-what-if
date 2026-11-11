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

// Synthetic data for the Hebrew UI tour (fictional funds, companies and yields; see CONTRIBUTING). Served in
// place of docs/data/funds.json so the tour's text does not move when the real data is refreshed.
const fixtureMonths = (start, end) => (Math.floor(end / 100) - Math.floor(start / 100)) * 12 + (end % 100) - (start % 100) + 1;
const fixtureFund = (key, src, id, name, corp, cls, fee, dfee, start, end, pct) =>
  ({ key, src, id, name, cls, corp, spec: null, sub: null, pop: null, fee, dfee, assets: 1, start, end, y: Array(fixtureMonths(start, end)).fill(pct) });
const fixtureData = {
  sources: { gemel: "https://data.gov.il/dataset/gemelnet", insurance: "https://data.gov.il/dataset/insurance" },
  latest: 202012,
  funds: [
    fixtureFund("g:9001", "gemel", 9001, "בדיקה מסלול כללי", "חברה בדיונית א", "תגמולים", 0.5, 0.1, 201801, 202012, 0.5),
    fixtureFund("g:9002", "gemel", 9002, "בדיקה מסלול מניות", "חברה בדיונית א", "תגמולים", null, null, 201801, 202012, 1),
    fixtureFund("i:9003", "insurance", 9003, "בדיקה פוליסה ותיקה", "חברה בדיונית ב", "פוליסות בדיוניות", 1.1, null, 201907, 202012, 0.3),
  ],
};
const fixtureStory = {
  end: "2020-12",
  events: [
    { type: "start", date: "2018-01", fundKey: "g:9001", amount: 1000 },
    { type: "monthly", from: "2018-01", to: "2019-12", amount: 500 },
    { type: "withdraw", date: "2020-06", amount: 200, scope: "actual" },
    { type: "product", date: "2019-03", fundKey: "i:9003", scope: "whatif" },
    { type: "track", date: "2020-06", fundKey: "g:9002", scope: "actual" },
  ],
};
const fixtureFragment = Buffer.from(JSON.stringify(fixtureStory)).toString("base64url");

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml" };

function check(cond, msg) {
  if (!cond) { console.error("FAIL: " + msg); process.exitCode = 1; } else console.log("ok: " + msg);
}

// Serves docs/. Under /fixture/ the same files are served, except data/funds.json, which is fixtureData
// (same origin, so the harness can drive the page).
function serve({ offline = false, port = 0 } = {}) {
  const server = http.createServer((req, res) => {
    let url = req.url.split("?")[0].split("#")[0];
    if (url.startsWith("/fixture/")) {
      url = url.slice("/fixture".length);
      if (url === "/data/funds.json") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(fixtureData));
      }
    }
    if (offline && url === "/__a11y_official") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ success: true, result: { records: [], total: 0 } }));
    }
    const file = path.join(root, decodeURIComponent(url).replace(/\/$/, "/index.html"));
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    let content = fs.readFileSync(file);
    // Synthetic accessibility previews exclude only analytics, never UI assets.
    if (offline && path.extname(file) === ".html") {
      content = content.toString("utf8").replace(/<script[^>]+src=['"]https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js['"][^>]*><\/script>/g, "");
    }
    if (offline && path.extname(file) === ".js") {
      content = content.toString("utf8").replaceAll("https://data.gov.il/api/3/action/datastore_search", "/__a11y_official");
    }
    res.end(content);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, base: "http://localhost:" + server.address().port + "/" })));
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

// Runs inside the app page (fixture data), in any engine. Walks the UI through a fixed, synchronous tour and
// returns every user-visible string it meets, in order: html lang/dir, title, meta texts, then for each step
// the visible text nodes (whitespace-collapsed) and the placeholder / aria-label / title values of visible
// elements. Hidden elements and the live official-data spans (network) are skipped. Compared with
// he-snapshot.js, which was recorded from the page before the i18n catalog existed, so the Hebrew output is
// byte-identical. Must stay free of outer references (serialized into the harness and page.evaluate).
function uiTour(d) {
  d = d || document;
  const q = (s) => d.querySelector(s);
  const out = [];
  let last = "start";
  const snap = (label, root) => {
    last = label;
    out.push("## " + label);
    const walk = (n) => {
      if (n.nodeType === 3) {
        const s = n.nodeValue.replace(/\s+/g, " ").trim();
        if (s) out.push(s);
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.hidden || n.tagName === "SCRIPT" || n.tagName === "STYLE" || n.classList.contains("offv") || n.classList.contains("lang-pick")) return;
      for (const a of ["placeholder", "aria-label", "title"]) if (n.hasAttribute(a)) out.push("@" + a + "=" + n.getAttribute(a));
      for (const c of n.childNodes) walk(c);
    };
    walk(root || d.body);
  };
  const click = (s) => {
    const el = q(s);
    if (!el) throw new Error("no " + s + " after step \"" + last + "\"");
    el.click();
  };
  const setVal = (el, v, ev) => { el.value = v; el.dispatchEvent(new Event(ev || "change")); };
  out.push("lang=" + d.documentElement.lang + " dir=" + d.documentElement.dir, "title=" + d.title);
  for (const m of d.querySelectorAll("meta[content]")) if (/description|og:title|og:description|og:locale/.test(m.getAttribute("name") + " " + m.getAttribute("property"))) out.push("meta=" + m.getAttribute("content"));
  snap("loaded story");
  click("#run");
  snap("result", q("#result"));
  setVal(q("#coef-guar"), "190", "input"); setVal(q("#coef-market"), "200", "input"); setVal(q("#months-ret"), "12", "input"); setVal(q("#ret-rate"), "3", "input");
  click("#run");
  snap("result with annuity", q("#result"));
  click("#unfork-btn");
  snap("unforked");
  click("#fork-btn");
  snap("forked");
  click("#unfork-btn");
  click("#add-event");
  const card = [...d.querySelectorAll("#timeline .card")].pop();
  for (const ty of ["deposit", "monthly", "withdraw", "transfer", "product", "track", "fees"]) {
    setVal(card.querySelector(".type"), ty);
    snap("new card: " + ty, card);
  }
  setVal(card.querySelector(".type"), "deposit");
  card.querySelector(".date").value = "2019-05-01";
  click("#run");
  snap("error: missing amount", q("#error"));
  card.querySelector(".date").value = "";
  click("#run");
  snap("error: missing date", q("#error"));
  card.querySelector(".rm").click();
  const start = q("#timeline .card.start");
  const inp = start.querySelector(".fundpick input");
  for (const term of ["בדיקה מניות", "בדיקה פוליסה", "בדיקה כללי"]) {
    setVal(inp, term, "input");
    snap("fund search: " + term, start);
  }
  setVal(inp, "zzz", "input");
  click("#run");
  snap("error: missing fund", q("#error"));
  click("#load-example");
  snap("example", q("#timeline-section"));
  click("#run");
  snap("example run error", q("#error"));
  click("#build-ai");
  snap("ai: empty", q("#ai-status"));
  setVal(q("#ai-reply"), "no json here");
  click("#load-reply");
  snap("reply: no json", q("#ai-status"));
  setVal(q("#ai-reply"), '{"events":[{"type":"start","date":"2018-01-01","fundName":"בדיקה כללי"},{"type":"track","date":"2019-01-01","fundName":"קרן שלא קיימת"}]}');
  click("#load-reply");
  snap("reply: loaded", q("#ai-status"));
  snap("final page");
  return out;
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

// The tour's strings must equal the snapshot exactly; on a difference, name the first one.
function assertTour(lines) {
  const want = require("./he-snapshot.js");
  check(Array.isArray(lines) && lines.length > 100, "Hebrew UI tour produced output (" + (lines ? lines.length : 0) + " strings)");
  if (!Array.isArray(lines)) return;
  let i = 0;
  while (i < want.length && i < lines.length && want[i] === lines[i]) i++;
  const same = i === want.length && i === lines.length;
  check(same, "Hebrew UI is byte-identical to he-snapshot.js (" + want.length + " strings)" + (same ? "" : "; first difference at " + i + ": got " + JSON.stringify(lines[i]) + ", want " + JSON.stringify(want[i])));
}

// Static checks on the shipped files (markup essentials and required assets).
function staticChecks() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cat = JSON.parse(fs.readFileSync(path.join(root, "i18n/strings.json"), "utf8"));
  const def = Object.keys(cat.languages).find((c) => cat.languages[c].default);
  check(html.includes('<html lang="' + def + '" dir="' + cat.languages[def].dir + '">'), "html lang/dir set (the catalog's default language)");
  check(/<select id="lang"><\/select>/.test(html), "language picker has no options of its own (they come from the catalog)");
  check(/og:image/.test(html) && /rel="icon"/.test(html) && /name="description"/.test(html), "preview, icon and description meta present");
  for (const f of ["og.png", "favicon.svg", "robots.txt", "sitemap.xml", ".well-known/security.txt", "data/funds.json"]) check(fs.existsSync(path.join(root, f)), f + " exists");
}

module.exports = { root, story, fragment, fixtureFragment, check, serve, domProbe, uiTour, assertResult, assertTour, staticChecks };
