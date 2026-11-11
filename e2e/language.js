#!/usr/bin/env node
// Synthetic local browser regression. Catalog language metadata is the only language list.
"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { serve, fixtureFragment } = require("./shared");
const catalog = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "../docs/i18n/strings.json"), "utf8"));

async function verify(browser, screenshot) {
  const { server, base } = await serve();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const codes = Object.keys(catalog.languages);
    const def = codes.find((code) => catalog.languages[code].default);
    const draft = codes.find((code) => catalog.languages[code].status === "machine-draft");
    assert.ok(draft, "a draft translation exists");
    await page.route("https://**", (route) => route.abort());
    await page.goto(base + "fixture/index.html#story=" + fixtureFragment);
    await page.waitForSelector("#timeline .card");
    assert.ok(await page.locator(".lang-pick").isVisible());
    assert.deepEqual(await page.locator("#lang option").evaluateAll((options) => options.map((o) => o.value)), codes);
    await page.selectOption("#lang", draft);
    await page.waitForURL((url) => url.searchParams.get("lang") === draft);
    await page.waitForSelector("#timeline .card");
    assert.equal(await page.locator("html").getAttribute("dir"), catalog.languages[draft].dir);
    assert.equal(await page.locator("html").getAttribute("lang"), draft);
    assert.equal(await page.locator("h1").textContent(), catalog.strings["page.heading"][draft]);
    assert.ok(await page.locator("#translation-draft").isVisible());
    assert.equal(await page.locator("#translation-draft").textContent(), catalog.strings["ui.machine_draft"][draft]);
    assert.ok(new URL(page.url()).hash.includes("story="), "story fragment survives language switch");
    await page.click("#run");
    await page.waitForSelector("#result table");
    assert.equal(await page.locator("#error").textContent(), "");
    assert.ok(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), "no mobile horizontal overflow");
    if (screenshot) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: screenshot, fullPage: false });
    }
    await page.selectOption("#lang", def);
    await page.waitForURL((url) => url.searchParams.get("lang") === def);
    await page.waitForSelector("#timeline .card");
    assert.equal(await page.locator("html").getAttribute("dir"), catalog.languages[def].dir);
    assert.equal(await page.locator("h1").textContent(), catalog.strings["page.heading"][def]);
    assert.equal(await page.locator("#translation-draft").isVisible(), false);
    console.log("Language picker, draft notice, calculation and return-to-default browser regression passed");
  } finally {
    await page.close();
    server.close();
  }
}

if (require.main === module) {
  (async () => {
    const { chromium } = require("playwright-webkit");
    const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
    try { await verify(browser, process.env.LANGUAGE_SCREENSHOT); }
    finally { await browser.close(); }
  })().catch(() => { console.error("Language browser regression failed"); process.exitCode = 1; });
}
module.exports = { verify };
