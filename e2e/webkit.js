#!/usr/bin/env node
// End-to-end smoke test in the WebKit engine (Playwright WebKit): the same DOM probe
// and assertions as the Chrome smoke test (smoke.js). This covers engine-level
// rendering and behavior close to Safari; it is not the Safari app on iOS/macOS
// itself (different chrome, fonts and platform features).
"use strict";
const { fragment, serve, domProbe, assertResult, staticChecks, check } = require("./shared");

(async () => {
  const { server, base } = await serve();
  let browser;
  try {
    const { webkit } = require("playwright-webkit");
    browser = await webkit.launch();
    const page = await browser.newPage();
    await page.goto(base + "index.html#story=" + fragment, { waitUntil: "load" });
    await page.waitForSelector("#timeline .card", { timeout: 15000 });
    const payload = await page.evaluate(domProbe);
    assertResult("RESULT:" + payload);
  } catch (e) {
    check(false, "WebKit run completed (" + e.message + ")");
  } finally {
    if (browser) await browser.close();
    staticChecks();
    server.close();
  }
})();
