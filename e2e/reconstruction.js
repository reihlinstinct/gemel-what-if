const assert=require('node:assert/strict'),fs=require('node:fs');
const {serve}=require('./shared');
async function verify(browser){
 const{server,base}=await serve({offline:true});
 try{
  const p=await browser.newPage({viewport:{width:390,height:844}});
  const story={end:'2026-06',events:[{type:'start',date:'2026-01',fundKey:'p:2155',amount:1000,aiGenerated:true,selectionReviewRequired:true},{type:'track',date:'2026-02',fundKey:'p:2105',aiGenerated:true,selectionReviewRequired:true}]};
  const importStory=async s=>{await p.locator('#import').setInputFiles({name:Math.random()+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(s))});};
  const confirm=async()=>{for(const x of await p.locator('.selection-review input').all())await x.check();};
  const blocked=async()=>{await p.locator('#run').click();assert.equal(await p.locator('#result table').count(),0);assert((await p.locator('#error').innerText()).length>0);};
  await p.goto(base);await p.waitForSelector('#timeline .card');await importStory(story);await confirm();
  const d=p.waitForEvent('download');await p.locator('#export').click();const dl=await d;const saved=JSON.parse(fs.readFileSync(await dl.path()));assert(saved.events.every(e=>e.aiGenerated===true&&e.selectionReviewRequired===false));
  const W=require('../docs/whatif.js');
  const data=require('../docs/catalog.js').assemble(require('../docs/data/funds.json'),require('../docs/data/pension.json'));
  assert(W.runTimeline(saved,W.indexFunds(data),data.latest).actual.final>0);
  const edited=JSON.parse(JSON.stringify(saved));edited.events[0].date='2026-02-01';
  assert.throws(()=>W.runTimeline(edited,W.indexFunds(data),data.latest),/Confirm each AI/);
  await importStory(saved);assert.equal(await p.locator('.selection-review input').count(),2);await p.locator('.card.start .date').fill('2026-01-02');await blocked();await confirm();
  // Unfork and fork reconstruct cards from readEvent; provenance must survive.
  await p.locator('#fork-btn').click();await p.locator('#unfork-btn').click();
  await p.locator('.card:not(.start) .split').click();
  assert.equal(await p.locator('.selection-review input').count(),3);
  await confirm();await p.locator('#col-actual .date').fill('2026-02-02');await blocked();
  await p.locator('#unfork-btn').click();assert.equal(await p.locator('.selection-review input').count(),2);await confirm();
  // A language reload rehydrates the confirmed marked story, not a manual story.
  const other=await p.locator('#lang option').evaluateAll(xs=>xs.find(x=>!x.selected).value);
  await p.locator('#lang').selectOption(other);await p.waitForURL(u=>u.searchParams.has('lang'));await p.waitForSelector('.selection-review input');await p.waitForFunction(()=>document.querySelectorAll('.selection-review input').length===2&&document.querySelectorAll('.selection-review input:checked').length===0);
  assert.equal(await p.locator('.selection-review input:checked').count(),0);await p.locator('.card.start .date').fill('2026-01-03');await blocked();
  // A direct manual story retains no additional burden.
  await importStory({end:story.end,events:story.events.map(e=>{const x={...e};delete x.aiGenerated;delete x.selectionReviewRequired;return x;})});
  await p.waitForFunction(()=>document.querySelectorAll('.selection-review input').length===0);assert.equal(await p.locator('.selection-review input').count(),0);await p.locator('#run').click();assert.equal(await p.locator('#result table').count(),1);
  await p.close();console.log('Confirmed AI provenance survives export/import, fork/unfork and language reload; later edits block, manual stories unchanged');
 }finally{server.close();}
}
module.exports={verify};
