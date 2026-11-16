// Shared pinned axe tools + project-specific result-state regression. Synthetic only.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { serve, fixtureFragment } = require("./shared");
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/i18n/strings.json")));
const routes = Object.keys(catalog.languages).map(code => "/fixture/?lang=" + code);

(async () => {
  if (process.argv[2] === "preview") {
    await serve({ offline: true, port: 8765 });
    fs.writeFileSync(path.join(__dirname, "../.a11y-routes.json"), JSON.stringify({ version: 1, paths: routes }));
    console.log("Synthetic accessibility preview ready");
    return;
  }
  const tools = process.env.A11Y_TOOLS;
  if (!tools || !path.isAbsolute(tools)) throw new Error("tool path");
  const { scan, TAGS, summarize } = await import(pathToFileURL(path.join(tools, "scan.mjs")));
  const axe = require(path.join(tools, "node_modules/axe-core"));
  const { server, base } = await serve({ offline: true });
  const states = [];
  try {
    const initial = await scan(base, { version: 1, paths: routes }, { inspect: async (page, report) => {
      const origin = new URL(page.url()).origin;
      let failed = false;
      page.on("request", request => { if (new URL(request.url()).origin !== origin) failed = true; });
      page.on("pageerror", () => { failed = true; });
      page.on("response", response => { if (response.status() >= 400) failed = true; });
      await page.goto(page.url() + "#story=" + fixtureFragment);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("#timeline .card");
      await page.click("#run");
      await page.waitForSelector("#result table");
      await page.locator("#accessibility").evaluate(element => { element.open = true; });
      await page.addScriptTag({ content: axe.source });
      const result = await page.evaluate(tags => window.axe.run(document,
        { runOnly: { type: "tag", values: tags } }), TAGS);
      if (failed || new URL(page.url()).origin !== origin) throw new Error("interaction failed");
      states.push({ engine: report.engine, width: report.width, page: report.page,
        state: "results-and-statement", ...summarize(result) });
      if (process.env.A11Y_SCREENSHOT && report.engine === "chromium" && report.width === 390) {
        await page.locator("#result").screenshot({ path: process.env.A11Y_SCREENSHOT });
        await page.locator("#accessibility").screenshot({ path: process.env.A11Y_SCREENSHOT.replace(".png", "-statement.png") });
      }
    } });
    console.log(JSON.stringify({ scope: "automated-only", initial: initial.reports, states }));
    if (initial.status !== "pass" || states.some(state => state.violations)) process.exitCode = 1;
  } finally { server.close(); }
})().catch(() => {
  console.error("Accessibility regression tool/preview error");
  process.exitCode = 2;
});
