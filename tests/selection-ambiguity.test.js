const test=require('node:test');
const assert=require('node:assert/strict');
const W=require('../docs/whatif.js'),P=require('../docs/prompt.js');
const data=require('../docs/catalog.js').assemble(require('../docs/data/funds.json'),require('../docs/data/pension.json'));
const funds=W.indexFunds(data);
test('visually equivalent sibling names remain ambiguous regardless of exact whitespace spelling',()=>{
 const groups=new Map();for(const f of data.funds){const name=W.canonicalName(f.name);groups.set(name,[...(groups.get(name)||[]),f]);}
 let count=0;
 for(const pair of groups.values())if(pair.length>1){
  count++;
  for(const f of pair){
   const hits=W.searchFunds(data,f.name,1000);assert.equal(hits.length,pair.length,f.key);
   const r=P.resolveFunds({events:[{type:'start',fundName:f.name}]},q=>W.searchFunds(data,q,3));assert.equal(r.story.events[0].fundKey,undefined,f.key);
   const grounded=P.groundGenerated({events:[{fundKey:f.key}]},f.name,funds);assert.equal(grounded.events[0].fundKey,undefined,f.key);
   assert.equal(P.groundGenerated({events:[{fundKey:f.key}]},f.key,funds).events[0].fundKey,f.key);
   assert.equal(W.searchFunds(data,f.key,3)[0].key,f.key);
  }
 }
 assert(count>=16);
});
test('full names ground at later occurrences and with a single Hebrew attached prefix, not partial substrings',()=>{
 const f=funds.get('p:2155');
 for(const text of [f.name,'ב'+f.name,'ל'+f.name,'"'+f.name+'"']) assert.equal(P.groundGenerated({events:[{fundKey:f.key}]},text,funds).events[0].fundKey,f.key);
 assert.equal(P.groundGenerated({events:[{fundKey:'g:1'}]},'g:12 then g:1',funds).events[0].fundKey,'g:1');
 assert.equal(P.groundGenerated({events:[{fundKey:f.key}]},'אב'+f.name,funds).events[0].fundKey,undefined);
 assert.throws(()=>P.groundGenerated({events:{}},'',funds),/Invalid timeline/);
 assert.throws(()=>W.defaultEnd({events:[{fundKey:42}]},funds,data.latest),/Invalid timeline/);
});
test('unqualified company result windows expose all matching products without choosing one',()=>{
 for(const query of ['הראל','כלל','מיטב','מגדל','הפניקס']){
  const all=W.searchFunds(data,query,10000);
  for(const limit of [15,40]){
   const hits=W.searchFunds(data,query,limit);
   assert.deepEqual(new Set(hits.map(f=>f.src)),new Set(all.map(f=>f.src)),query);
  }
 }
});
test('punctuated and joined IBI aliases cannot leak individual-letter substring hits',()=>{
 const expected=W.searchFunds(data,'IBI',1000).map(f=>f.key);
 for(const q of ['איי-בי-אי','איי,בי,אי','איביאי','i.b.i','I.B.I','אי־בי־אי']) assert.deepEqual(W.searchFunds(data,q,1000).map(f=>f.key),expected,q);
});
test('explicit pension product wins over managers word in real pension track names',()=>{
 for(const key of ['p:2150','p:2151','p:2152','p:2153','p:2194']){
  const f=funds.get(key);assert(f);
  const hits=W.searchFunds(data,'איילון פנסיה מנהלים',1000);assert(hits.some(x=>x.key===key),key);
 }
});

test('all actual explicit fund keys still select their exact record',()=>{
 for(const f of data.funds)assert.deepEqual(W.searchFunds(data,f.key,3).map(x=>x.key),[f.key]);
});
