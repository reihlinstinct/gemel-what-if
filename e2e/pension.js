#!/usr/bin/env node
// Synthetic pension file import, reference rendering and private-URL guard in Chrome.
"use strict";
const {serve,check} = require("./shared");
const {chromium} = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const catalog = require("../docs/i18n/strings.json");
const primary = Object.keys(catalog.languages).find(c=>catalog.languages[c].default);
const other = Object.keys(catalog.languages).find(c=>c!==primary);
const story={private:true,end:"2026-06",context:{label:"Synthetic reference <img src=x>",notes:["Conditional identity. Start-of-month timing."],statementBalance:1000,endAdjustment:-10},events:[{type:"start",date:"2026-01",fundKey:"p:2155",amount:1000},{type:"track",date:"2026-01",fundKey:"p:2105",scope:"whatif"}]};
async function verify(browser) {
 const {server,base}=await serve({offline:true});
 const page=await browser.newPage();
 const evidence=process.env.E2E_SCREENSHOT_DIR || path.join(os.tmpdir(),"gemel-pension-"+browser.browserType().name());
 fs.mkdirSync(evidence,{recursive:true});
 try {await page.goto(base+"index.html");
 await page.waitForSelector("#timeline .card");
 await page.locator("#import").setInputFiles({name:"synthetic.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(story))});
 await page.waitForSelector('#col-whatif .fundpick[data-fund="p:2105"]');
 await page.locator("#run").click();await page.waitForSelector("#statement-reference");
 check(await page.locator('.fundpick').first().getAttribute('data-fund')==="p:2155","pension namespace survives actual file import");
 check((await page.locator('.fundpick select').first().innerText()).includes("פנסיה"),"picker identifies pension product");
 check((await page.locator('#statement-reference').innerText()).includes("<img src=x>") && await page.locator('#statement-reference img').count()===0,"imported context uses inert text, not HTML");
 check((await page.locator('#statement-reference').innerText()).includes("פער"),"statement residual is shown separately");
 const before=page.url();await page.locator('#lang').selectOption(other);
 check(page.url()===before && await page.locator('#lang').inputValue()===primary && (await page.locator('#error').innerText()).length>0,"private language change cannot put financial inputs in URL");
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(evidence,'gemel-pension-'+width+'.png'),fullPage:true});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"pension page fits width "+width);
 }
 await page.locator("#import").setInputFiles({name:"second.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({...story,context:{label:"Second synthetic reference"}}))});
 await page.waitForFunction(()=>document.querySelector("#result").textContent==="");
 check(await page.locator("#statement-reference").count()===0,"a new import clears stale modeled results and prior statement reference");
 } finally { await page.close(); server.close(); }
 await require("./fragments.js").verify(browser);
 await require("./catalog.js").verify(browser);
 await require("./confirmation.js").verify(browser);
 await require("./reconstruction.js").verify(browser);
}
module.exports = {verify};
if(require.main===module) (async()=>{let browser;try {
 browser=await chromium.launch({executablePath:process.env.CHROME||"/usr/bin/google-chrome",args:["--no-sandbox"]});
 await verify(browser);
} catch(e){check(false,e.stack);}finally{if(browser)await browser.close();}})();
