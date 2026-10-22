#!/usr/bin/env node
// Link checker: every absolute http(s) link in docs/index.html and README.md must answer < 400.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const files = [path.join(__dirname, "../docs/index.html"), path.join(__dirname, "../README.md")];
const urls = new Set();
for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) urls.add(m[0].replace(/[.,;]+$/, ""));
(async () => {
  let bad = 0;
  for (const u of urls) {
    if (/localhost|workers\.dev\/(mcp|api)|data\.gov\.il/.test(u)) continue; // data.gov.il answers 403 to scripts
    try {
      let r = await fetch(u, { method: "HEAD", redirect: "follow" });
      if (r.status >= 400) r = await fetch(u, { redirect: "follow" });
      console.log((r.status < 400 ? "ok   " : "FAIL ") + r.status + " " + u);
      if (r.status >= 400) bad++;
    } catch (e) { console.log("FAIL " + u + " " + e.message); bad++; }
  }
  process.exit(bad ? 1 : 0);
})();
