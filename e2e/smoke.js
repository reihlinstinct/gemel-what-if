#!/usr/bin/env node
// End-to-end smoke test in headless Chrome: serves docs/ locally, opens the page with a
// story in the URL fragment, runs the shared DOM probe and checks the result, the
// SEO/meta tags and the static files. The same probe also runs in WebKit (webkit.js).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { root, fragment, serve, domProbe, assertResult, staticChecks } = require("./shared");
const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26, timeout: 60000 }, (e, out) => (e ? no(e) : ok(out))));

(async () => {
  const { server, base } = await serve();
  const harness = path.join(root, "__e2e.html");
  fs.writeFileSync(harness, `<!doctype html><meta charset=utf-8><div id=o></div><iframe id=f width=900 height=1200></iframe><script>
const probe=${domProbe.toString()};
const f=document.getElementById('f');f.src='${base}index.html#story=${fragment}';
f.onload=()=>setTimeout(()=>{document.getElementById('o').textContent='RESULT:'+probe(f.contentDocument);},1500);</script>`);
  try {
    const chrome = process.env.CHROME || "google-chrome";
    const dom = await run(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=10000", "--dump-dom", base + "__e2e.html"]);
    assertResult(dom);
  } finally {
    fs.unlinkSync(harness);
    staticChecks();
    server.close();
  }
})();
