#!/usr/bin/env node
// End-to-end smoke test: serves docs/ locally, opens the page in headless Chrome with a story in the
// URL fragment, clicks run, and checks the result, the SEO/meta tags and the static files.
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26, timeout: 60000 }, (e, out) => (e ? no(e) : ok(out))));

const root = path.join(__dirname, "../docs");
const story = {
  end: "2010-12",
  events: [
    { type: "start", date: "2005-06", fundKey: "i:259012" },
    { type: "monthly", from: "2005-06", to: "2009-06", amount: 750 },
  ],
};
const fragment = Buffer.from(JSON.stringify(story)).toString("base64url");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml" };

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split("?")[0].split("#")[0]).replace(/\/$/, "/index.html"));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

function check(cond, msg) {
  if (!cond) { console.error("FAIL: " + msg); process.exitCode = 1; } else console.log("ok: " + msg);
}

server.listen(0, async () => {
  const port = server.address().port;
  const base = "http://localhost:" + port + "/";
  const harness = path.join(root, "__e2e.html");
  fs.writeFileSync(harness, `<!doctype html><meta charset=utf-8><div id=o></div><iframe id=f width=900 height=1200></iframe><script>
const f=document.getElementById('f');f.src='${base}index.html#story=${fragment}';
f.onload=()=>setTimeout(()=>{const d=f.contentDocument,q=s=>d.querySelector(s);d.querySelector('#ai-reply').value='ok {"events":[{"type":"start","date":"2005-01-01","fundName":"הראל קרן"},{"type":"monthly","from":"2005-01-01","to":"2005-12-01","amount":500}]} thanks';d.querySelector('#load-reply').click();const aiCards=d.querySelectorAll('.card').length;const aiStatus=d.querySelector('#ai-status').textContent;const sel=d.querySelector('.card .fundpick select');sel.dispatchEvent(new Event('change'));const feeVal=(d.querySelector('.card .feeadj')||{}).value||'';const feeHint=((d.querySelector('.card .feeavg')||{}).textContent||'');let depVal=(d.querySelector('.card .pdepfee')||{}).value||'';
if(depVal===''){const inp=d.querySelector('.card .fundpick input');inp.value='כלל תמר';inp.dispatchEvent(new Event('input'));for(const o of sel.options){sel.value=o.value;sel.dispatchEvent(new Event('change'));const v=(d.querySelector('.card .pdepfee')||{}).value||'';if(v!==''){depVal=v;break;}}}
const depHint=((d.querySelector('.card .feeavg')||{}).textContent||'');const depKind=depHint.includes('מהפקדה ממוצעים רשמיים')?'depavg':(depHint.includes('אין נתון דמי ניהול מהפקדה')?'depnone':'depmissing');
d.querySelector('#ai-reply').value='ok {"events":[{"type":"start","date":"2005-01-01","fundName":"הראל קרן","depositFeePct":0.7},{"type":"monthly","from":"2005-01-01","to":"2005-12-01","amount":500}]} thanks';d.querySelector('#load-reply').click();const depRestored=(d.querySelector('.card .pdepfee')||{}).value||'';const depManual=(d.querySelector('.card .pdepfee')||{}).dataset.manual||'';
d.querySelector('#story-text').value='x';q('#run').click();
const unnamed=[...d.querySelectorAll('input,select,textarea')].filter(e=>!(e.closest('label')||e.getAttribute('aria-label')||(e.id&&d.querySelector('label[for="'+e.id+'"]')))).length;document.getElementById('o').textContent='RESULT:'+unnamed+'#'+q('#error').textContent+'|'+aiCards+'|'+aiStatus.slice(0,5)+'|'+q('#result').innerText.replace(/\\s+/g,' ')+'|'+[...d.querySelectorAll('#result a')].map(x=>x.getAttribute('href')).join(',')+'@'+d.querySelectorAll('#result .offv').length+'^'+feeVal+'^'+feeHint.slice(0,30)+'^'+depVal+'^'+depKind+'^'+depRestored+'^'+depManual;},1500);</script>`);
  try {
    const chrome = process.env.CHROME || "google-chrome";
    const dom = await run(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=10000", "--dump-dom", base + "__e2e.html"]);
    const m = /RESULT:([^<]*)/.exec(dom);
    check(m, "page produced a result");
    if (m) {
      const [unnamed, rest] = m[1].split("#");
      const [err, cards, aiStatus, text, linksAndOffv] = rest.split("|");
      const [links, offv] = (linksAndOffv || "").split("@");
      const [offvCount, feeVal, feeHint, depVal, depKind, depRestored, depManual] = (offv || "").split("^");
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
    }
  } finally {
    fs.unlinkSync(harness);
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    check(/<html lang="he" dir="rtl">/.test(html), "html lang/dir set");
    check(/og:image/.test(html) && /rel="icon"/.test(html) && /name="description"/.test(html), "preview, icon and description meta present");
    for (const f of ["og.png", "favicon.svg", "robots.txt", "sitemap.xml", ".well-known/security.txt", "data/funds.json"]) check(fs.existsSync(path.join(root, f)), f + " exists");
    server.close();
  }
});
