"use strict";
const assert = require("node:assert/strict");
const { serve } = require("./shared");
const fragment = story => "#story=" + Buffer.from(JSON.stringify(story)).toString("base64url");
const first = { end: "2020-12", events: [{ type: "start", date: "2018-01", fundKey: "g:9001", amount: 1000 }] };
const second = { end: "2019-12", context: { label: "Synthetic second story" }, events: [
  { type: "start", date: "2018-01", fundKey: "g:9002", amount: 2000 },
  { type: "monthly", from: "2018-01", to: "2019-12", amount: 100 }
] };
async function verify(browser) {
  const { server, base } = await serve({ offline: true });
  const page = await browser.newPage();
  try {
    await page.goto(base + "fixture/index.html" + fragment(first));
    await page.waitForSelector('#timeline .fundpick[data-fund="g:9001"]');
    await page.locator("#run").click();
    await page.waitForSelector("#result table");
    const original = await page.locator("#result").innerText();
    // Same document, as when opening another story link in an existing tab.
    await page.evaluate(hash => { location.hash = hash; }, fragment(second));
    await page.waitForSelector('#timeline .fundpick[data-fund="g:9002"]', { timeout: 2500 });
    assert.equal(await page.locator("#timeline .card").count(), 2);
    assert.equal(await page.locator("#end").inputValue(), "2019-12-01");
    assert.equal(await page.locator("#result").innerText(), "", "new story clears old result");
    await page.locator("#run").click();
    await page.waitForSelector("#statement-reference");
    assert.match(await page.locator("#statement-reference").innerText(), /Synthetic second story/);
    assert.notEqual(await page.locator("#result").innerText(), original);
    await page.goBack();
    await page.waitForSelector('#timeline .fundpick[data-fund="g:9001"]');
    assert.equal(await page.locator("#timeline .card").count(), 1);
    assert.equal(await page.locator("#result").innerText(), "");
    await page.goForward();
    await page.waitForSelector('#timeline .fundpick[data-fund="g:9002"]');
    await page.evaluate(() => { location.hash = "#story=not-valid-json"; });
    await page.waitForFunction(() => document.querySelector("#error").textContent.length > 0);
    assert.equal(await page.locator("#timeline .card").count(), 2, "malformed link preserves last valid timeline");
    await page.evaluate(hash => { location.hash = hash; }, fragment(first));
    await page.waitForSelector('#timeline .fundpick[data-fund="g:9001"]');
    assert.equal(await page.locator("#error").innerText(), "", "valid link clears link error");
    await page.evaluate(() => { location.hash = "#accessibility"; });
    assert.equal(await page.locator("#timeline .card").count(), 1, "unrelated fragments leave story intact");
    console.log("Same-page story links, history navigation, result clearing and malformed-link recovery pass");
  } finally { await page.close(); server.close(); }
}
module.exports = { verify };
