"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {serve}=require('./shared');
async function verify(browser){
 const {server,base}=await serve({offline:true});
 const evidence=process.env.E2E_SCREENSHOT_DIR||path.join(require('node:os').tmpdir(),'gemel-pension-'+browser.browserType().name());fs.mkdirSync(evidence,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const original='Started i:259012, then switched to p:2155';
  const reversed={end:'2026-06',events:[{type:'start',date:'2026-01',fundKey:'p:2155',amount:1000,selectionReviewRequired:false},{type:'track',date:'2026-02',fundKey:'i:259012',selectionReviewRequired:false}]};
  await page.goto(base);await page.waitForSelector('#timeline .card');
  await page.locator('#ai-section summary').first().click();await page.locator('#ai-section details.adv summary').click();
  await page.locator('#story-text').fill(original);await page.locator('#ai-reply').fill(JSON.stringify(reversed));await page.locator('#load-reply').click();
  const boxes=page.locator('.selection-review input');assert.equal(await boxes.count(),2);
  await page.locator('#run').click();assert.equal(await page.locator('#result table').count(),0);assert((await page.locator('#error').innerText()).length>0);
  await boxes.nth(0).check();await page.locator('#run').click();assert.equal(await page.locator('#result table').count(),0);
  const download=page.waitForEvent('download');await page.locator('#export').click();const dl=await download;const exported=JSON.parse(fs.readFileSync(await dl.path()));assert.equal(exported.events.filter(e=>e.selectionReviewRequired===true).length,1);
  await boxes.nth(1).check();await page.locator('#run').click();await page.waitForSelector('#result table');
  await page.locator('.card.start .date').fill('2026-01-02');assert.equal(await boxes.nth(0).isChecked(),false);
  await page.locator('#run').click();assert((await page.locator('#error').innerText()).length>0);
  await page.locator('.card.start').screenshot({path:path.join(evidence,'ai-event-confirmation-390.png')});
  // AI endpoint cannot omit its marker and bypass the browser's boundary.
  await page.route('**/api/story',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({story:reversed,warnings:[]})}));
  await page.locator('#build-ai').click();await page.waitForFunction(()=>document.querySelectorAll('.selection-review input').length===2&&[...document.querySelectorAll('.selection-review input')].every(x=>!x.checked));
  await page.locator('#run').click();assert.equal(await page.locator('#result table').count(),0);
  // A persisted pending proposal cannot become calculation-ready through local import.
  await page.locator('#import').setInputFiles({name:'proposal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await page.locator('#run').click();assert.equal(await page.locator('#result table').count(),0);
  await page.close();
  console.log('AI pasted/Worker event confirmations block calculation individually, survive export/import and reset on edit');
 }finally{server.close();}
}
module.exports={verify};
