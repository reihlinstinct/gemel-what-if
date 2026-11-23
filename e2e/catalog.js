// Synthetic failure/default/context cases, shared by Chromium and WebKit.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { serve } = require("./shared");
const catalog = require("../docs/i18n/strings.json");
async function verify(browser) {
  const {server,base} = await serve({offline:true});
  const evidence = process.env.E2E_SCREENSHOT_DIR || path.join(require("node:os").tmpdir(), "gemel-pension-"+browser.browserType().name());
  fs.mkdirSync(evidence,{recursive:true});
  try {
    for (const [name,status,body] of [["404-json",404,"[]"],["503-nonjson",503,"Unavailable"],["200-invalid",200,"{}"],["200-empty",200,"[]"]]) {
      const page = await browser.newPage({viewport:{width:390,height:844}});
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.route("**/data/pension.json",r=>r.fulfill({status,body,contentType:"application/json"}));
      await page.goto(base);
      await page.waitForFunction(()=>document.querySelector("#run").disabled);
      assert((await page.locator("#error").innerText()).length > 0);
      assert.equal(await page.locator("#timeline .card").count(),0);
      assert.equal(await page.locator("#result").innerText(),"");
      assert.equal(await page.locator("#data-info").innerText(),"");
      assert.equal(await page.locator("#import").isDisabled(),true);
      assert.deepEqual(errors,[]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(name==="503-nonjson") {
        const dir=evidence;
        if(dir) {fs.mkdirSync(dir,{recursive:true});await page.locator("#load-error").screenshot({path:path.join(dir,"catalog-failure-390.png")});await page.screenshot({path:path.join(dir,"catalog-failure-page-390.png"),fullPage:true});}
      }
      await page.close();
    }
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await page.goto(base);await page.waitForSelector("#timeline .card");
    assert.equal(await page.locator("#end").inputValue(),"2026-09-01");
    const picker=page.locator('#timeline .fundpick').first();
    await picker.locator('input').fill('כלל');
    assert.equal(await picker.getAttribute('data-fund'),'');
    assert.equal(await picker.locator('select').inputValue(),'');
    const choices=await picker.locator('option').allTextContents();
    assert(choices.length>1);
    assert(choices.every(text=>/(^|[^\p{L}])כלל([^\p{L}]|$)/u.test(text)));
    if(evidence) {
      fs.mkdirSync(evidence,{recursive:true});
      await picker.screenshot({path:path.join(evidence,'ambiguous-company-picker-390.png')});
    }
    await page.locator('#run').click();
    assert((await page.locator('#error').innerText()).length>0);
    await picker.locator('input').fill('p:2155');
    assert.equal(await picker.getAttribute('data-fund'),'p:2155');
    // Browser AI-paste path uses the original story, not fabricated model keys.
    await page.locator('#ai-section summary').first().click();
    await page.locator('#ai-section details.adv summary').click();
    await page.locator('#story-text').fill('כלל');
    await page.locator('#ai-reply').fill(JSON.stringify({end:'2026-06',events:[{type:'start',date:'2026-01',fundKey:'p:2009',amount:1000}]}));
    await page.locator('#load-reply').click();
    assert(!(await page.locator('#timeline .fundpick').first().getAttribute('data-fund')));
    await page.locator('#story-text').fill('מיטב פנסיה מקיפה לבני 50 ומטה');
    await page.locator('#ai-reply').fill(JSON.stringify({end:'2026-06',events:[{type:'start',date:'2026-01',fundName:'מיטב פנסיה מקיפה לבני 50 ומטה',amount:1000}]}));
    await page.locator('#load-reply').click();
    assert.equal(await page.locator('#timeline .fundpick').first().getAttribute('data-fund'),'p:2155');
    await page.locator('#story-text').fill('אינפיניטי השתלמות כללי');
    await page.locator('#ai-reply').fill(JSON.stringify({end:'2026-06',events:[{type:'start',date:'2026-01',fundKey:'g:1083',fundName:'אינפיניטי השתלמות כללי',amount:1000}]}));
    await page.locator('#load-reply').click();
    assert(!(await page.locator('#timeline .fundpick').first().getAttribute('data-fund')));
    if(evidence) await page.locator('#timeline .fundpick').first().screenshot({path:path.join(evidence,'sibling-name-unselected-390.png')});
    const legacy={events:[{type:"start",date:"2026-09",fundKey:"g:103",amount:1000},{type:"monthly",from:"2026-09",amount:100}]};
    await page.locator("#import").setInputFiles({name:"legacy.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(legacy))});
    await page.waitForSelector('#timeline .fundpick[data-fund="g:103"]');
    assert.equal(await page.locator("#end").inputValue(),"2026-09-01");
    await page.locator("#run").click();await page.waitForSelector("#result table");
    assert((await page.locator("#result").innerText()).includes("1,100"));
    const story={end:"2026-06",context:{label:"Synthetic local note",statementBalance:1000},events:[{type:"start",date:"2026-01",fundKey:"p:2155",amount:1000}]};
    await page.locator("#import").setInputFiles({name:"unmarked.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(story))});
    await page.waitForSelector('#timeline .fundpick[data-fund="p:2155"]');
    assert.equal(await page.locator("#end").inputValue(),"2026-06-01");
    const before=page.url();
    const primary=Object.keys(catalog.languages).find(c=>catalog.languages[c].default);
    const other=Object.keys(catalog.languages).find(c=>c!==primary);
    await page.locator("#lang").selectOption(other);
    assert.equal(page.url(),before);
    assert(!page.url().includes("story="));
    assert((await page.locator("#error").innerText()).length>0);
    if(evidence) await page.locator("#error").screenshot({path:path.join(evidence,"context-no-reencoding-390.png")});
    const download=page.waitForEvent("download");await page.locator("#export").click();
    const dl=await download;assert.equal(JSON.parse(fs.readFileSync(await dl.path())).private,true);
    await page.close();
    // A context-bearing link already shared is still readable, not access controlled.
    const linked=await browser.newPage();
    const fragment=Buffer.from(JSON.stringify(story)).toString("base64url");
    await linked.goto(base+"#story="+fragment);await linked.waitForSelector('#timeline .fundpick[data-fund="p:2155"]');
    await linked.locator("#run").click();await linked.waitForSelector("#statement-reference");
    assert((await linked.locator("#statement-reference").innerText()).includes(story.context.label));
    assert.equal(new URL(linked.url()).hash,"#story="+fragment);
    const linkedBefore=linked.url();await linked.locator("#lang").selectOption(other);assert.equal(linked.url(),linkedBefore);
    await linked.close();
    console.log("Checked catalog failures, legacy UI endpoint, unmarked local context and pre-existing readable URL passed");
  } finally {server.close();}
}
module.exports={verify};
