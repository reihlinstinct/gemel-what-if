const test=require('node:test');
const assert=require('node:assert/strict');
const W=require('../docs/whatif.js'),P=require('../docs/prompt.js');
const data=require('../docs/catalog.js').assemble(require('../docs/data/funds.json'),require('../docs/data/pension.json'));
const funds=W.indexFunds(data), core=require('../mcp/core.js').createCore(data);
test('conflicting genuine pension and insurance intent never produces a unique automatic selection',()=>{
 const synthetic={funds:[{key:'p:2',id:2,name:'הראל פנסיה',corp:'הראל',src:'pension',end:202610},{key:'i:1',id:1,name:'הראל ביטוח',corp:'הראל',src:'insurance',end:202609}]};
 for(const q of ['Harel pension insurance','הראל פנסיה ביטוח','הראל פנסיה פוליסה']) assert.deepEqual(W.searchFunds(synthetic,q,10),[]);
 assert.equal(W.searchFunds(synthetic,'Harel pension')[0].key,'p:2');
 assert.equal(W.searchFunds(synthetic,'Harel insurance')[0].key,'i:1');
 for(const key of ['p:2150','p:2151','p:2152','p:2153','p:2194'])assert(W.searchFunds(data,'איילון פנסיה מנהלים',1000).some(f=>f.key===key));
});
test('reversed AI assignments require per-event confirmation even when all keys were mentioned',()=>{
 const reversed={end:'2026-06',events:[{type:'start',date:'2026-01',fundKey:'p:2155',amount:1000},{type:'track',date:'2026-02',fundKey:'i:259012'}]};
 const grounded=P.groundGenerated(reversed,'Started i:259012, then switched to p:2155',funds);
 const proposal=P.requireSelectionReview(grounded);
 assert(proposal.events.every(e=>e.selectionReviewRequired===true));
 assert.throws(()=>W.runTimeline(proposal,funds,data.latest),/Confirm each AI/);
 assert(core.validate(proposal).errors.some(x=>x.includes('Confirm each AI')));
 assert.deepEqual(core.validateProposal(proposal).errors,[]);
 const forged={...reversed,events:reversed.events.map(e=>({...e,selectionReviewRequired:false}))};
 assert(P.requireSelectionReview(forged).events.every(e=>e.selectionReviewRequired===true));
 const onePending={...proposal,events:proposal.events.map((e,i)=>i?e:{...e,selectionReviewRequired:false})};
 assert.throws(()=>W.runTimeline(onePending,funds,data.latest),/Confirm each AI/);
 const confirmed={...proposal,events:proposal.events.map(e=>{const x={...e};x.selectionReviewRequired=false;x.selectionReviewedValues=W.selectionSnapshot(x);return x;})};
 assert.equal(W.runTimeline(confirmed,funds,data.latest).actual.final,W.runTimeline(reversed,funds,data.latest).actual.final);
});

test('AI origin survives confirmation and cannot lose its confirmation requirement through absent pending marker',()=>{
 const raw={end:'2026-06',events:[{type:'start',date:'2026-01',fundKey:'p:2155',amount:1000}]};
 const proposal=P.requireSelectionReview(raw);assert.equal(proposal.events[0].aiGenerated,true);
 assert.throws(()=>W.runTimeline({...raw,events:[{...raw.events[0],aiGenerated:true}]},funds,data.latest),/Confirm each AI/);
 const confirmed={...raw,events:[{...raw.events[0],aiGenerated:true,selectionReviewRequired:false}]};
 confirmed.events[0].selectionReviewedValues=W.selectionSnapshot(confirmed.events[0]);
 assert(W.runTimeline(confirmed,funds,data.latest).actual.final>0);
 assert.deepEqual(core.validateProposal(proposal).errors,[]);
});

test('ordinary MCP rejects stale confirmation after direct date/fund/fee/scope edits',()=>{
 const event={type:'start',date:'2026-01',fundKey:'p:2155',amount:1000,aiGenerated:true,selectionReviewRequired:false};
 event.selectionReviewedValues=W.selectionSnapshot(event);
 const story={end:'2026-06',events:[event]};
 assert.deepEqual(core.validate(story).errors,[]);
 assert(core.TOOLS.compute_story.run({story}).actual.finalValue>0);
 for(const change of [{date:'2026-02'},{fundKey:'p:2105'},{amount:2000},{depositFeePct:2},{scope:'actual'}]){
  const edited={...story,events:[{...event,...change}]};
  assert(core.validate(edited).errors.length>0);
  assert(core.TOOLS.compute_story.run({story:edited}).errors.length>0);
  assert.throws(()=>W.runTimeline(edited,funds,data.latest),/Confirm each AI/);
 }
});
