#!/usr/bin/env node
// End-to-end smoke test in headless Chrome: serves docs/ locally, opens the page with a
// story in the URL fragment, runs the shared DOM probe and checks the result, the
// SEO/meta tags and the static files. The same probe also runs in WebKit (webkit.js).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { root, fragment, fixtureFragment, check, serve, domProbe, uiTour, assertResult, assertTour, staticChecks } = require("./shared");
// RECORD_HE_SNAPSHOT=1 rewrites e2e/he-snapshot.js from this run: only for a deliberate Hebrew wording change.
const recordTour = (lines) => fs.writeFileSync(path.join(__dirname, "he-snapshot.js"),
  "// Every user-visible string of the Hebrew UI tour (shared.js uiTour), recorded from the page before the i18n\n" +
  "// catalog existed. Re-record only for a deliberate Hebrew wording change: RECORD_HE_SNAPSHOT=1 npm run e2e\n" +
  '"use strict";\nmodule.exports = [\n' +
  lines.map((l) => (l.startsWith("## ") ? "  // Section: " + l.slice(3) + "\n" : "") + "  " + JSON.stringify(l) + ",\n").join("") + "];\n");
const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26, timeout: 60000 }, (e, out) => (e ? no(e) : ok(out))));

(async () => {
  const { server, base } = await serve();
  const harness = path.join(root, "__e2e.html");
  fs.writeFileSync(harness, `<!doctype html><meta charset=utf-8><div id=o></div><div id=t></div><iframe id=f width=900 height=1200></iframe><iframe id=g width=900 height=1200></iframe><script>
const probe=${domProbe.toString()};
const tour=${uiTour.toString()};
const f=document.getElementById('f');f.src='${base}index.html#story=${fragment}';
f.onload=()=>setTimeout(()=>{document.getElementById('o').textContent='RESULT:'+probe(f.contentDocument);},1500);
const g=document.getElementById('g');g.src='${base}fixture/index.html#story=${fixtureFragment}';
g.onload=()=>setTimeout(()=>{const t=document.getElementById('t');try{t.textContent='TOUR:'+encodeURIComponent(JSON.stringify(tour(g.contentDocument)));}catch(e){t.textContent='TOURERR:'+e.message;}},1500);</script>`);
  try {
    const chrome = process.env.CHROME || "google-chrome";
    const dom = await run(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=10000", "--dump-dom", base + "__e2e.html"]);
    assertResult(dom);
    let lines = null;
    const failed = /<div id="t">TOURERR:([^<]*)/.exec(dom);
    check(!failed, "Hebrew UI tour ran" + (failed ? " (" + failed[1] + ")" : ""));
    try { lines = JSON.parse(decodeURIComponent(/<div id="t">TOUR:([^<]*)/.exec(dom)[1])); } catch (e) { /* reported by assertTour */ }
    if (process.env.RECORD_HE_SNAPSHOT) recordTour(lines);
    else assertTour(lines);
  } finally {
    fs.unlinkSync(harness);
    staticChecks();
    server.close();
  }
})();
