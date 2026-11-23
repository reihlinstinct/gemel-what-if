const test=require('node:test');
const assert=require('node:assert/strict');
const W=require('../docs/whatif.js');
const P=require('../docs/prompt.js');
const data=require('../docs/catalog.js').assemble(require('../docs/data/funds.json'),require('../docs/data/pension.json'));
const funds=W.indexFunds(data);
const resolve=q=>P.resolveFunds({events:[{type:'start',fundName:q}]},n=>W.searchFunds(data,n,3));
test('company terms cannot match a substring inside generic all-purpose track names',()=>{
 for(const q of ['כלל','Clal','כלל מניות']) {
  const hits=W.searchFunds(data,q,1000);assert(hits.length);
  for(const f of hits)assert(/(^|[^\p{L}])כלל([^\p{L}]|$)/u.test(f.name+' '+f.corp));
  assert.notEqual(hits[0].key,'p:2009');
 }
});
test('explicit insurance/gemel/hishtalmut/pension product constraints never relax away',()=>{
 for(const [q,src] of [['ביטוח מנהלים הראל','insurance'],['Harel managers insurance','insurance'],['מיטב גמל','gemel'],['מיטב השתלמות','gemel'],['מיטב פנסיה','pension']]){
  const hits=W.searchFunds(data,q,1000);assert(hits.length,q);assert(hits.every(f=>f.src===src),q);
 }
 assert.deepEqual(W.searchFunds(data,'ביטוח מנהלים חברהלאקיימת'),[]);
});
test('company-only and ambiguous equity queries do not resolve to the first ranked product',()=>{
 for(const q of ['מיטב','meitav','כלל','הראל','מיטב מניות']){
  const r=resolve(q);assert.equal(r.story.events[0].fundKey,undefined,q);assert.deepEqual(r.missing,[q]);
 }
});
test('unique exact pension track names and keys still resolve, supplied keys remain unchanged',()=>{
 for(const key of ['p:2155','p:2105','p:2158','p:2109']){
  const f=funds.get(key);assert.equal(resolve(f.name).story.events[0].fundKey,key);
  assert.equal(resolve(key).story.events[0].fundKey,key);
  assert.equal(P.resolveFunds({events:[{type:'start',fundKey:key}]},()=>[]).story.events[0].fundKey,key);
 }
});
test('model-proposed keys and invented full names cannot bypass original company/product ambiguity',()=>{
 const generated={events:[{type:'start',fundKey:'p:2009',fundName:'מנורה מבטחים פנסיה - כללי'}]};
 const grounded=P.groundGenerated(generated,'פתחתי בכלל',funds);
 assert.equal(grounded.events[0].fundKey,undefined);
 assert.equal(grounded.events[0].fundName,undefined);
 const original={events:[{type:'start',fundKey:'p:2155',fundName:'מיטב'}]};
 const r=P.resolveFunds(P.groundGenerated(original,'פתחתי מיטב',funds),n=>W.searchFunds(data,n,3));
 assert.equal(r.story.events[0].fundKey,undefined);
 assert.equal(P.groundGenerated(original,'פתחתי p:2155',funds).events[0].fundKey,'p:2155');
 assert.equal(P.groundGenerated(original,'p:21555',funds).events[0].fundKey,undefined);
});

test('IBI aliases normalize consistently without short-token matches to Ayalon',()=>{
 const expected=W.searchFunds(data,'ibi',1000).map(f=>f.key);
 assert(expected.length>1);
 for(const q of ['IBI','איי.בי.אי','איי בי אי','אי.בי.אי','אי.בי.אי.','איי.בי.איי','IBI גמל','איי.בי.אי גמל']){
  const hits=W.searchFunds(data,q,1000);
  assert.deepEqual(hits.map(f=>f.key),expected,q);
  assert(hits.every(f=>!/איילון/u.test(f.name+' '+f.corp)),q);
  assert(!hits.some(f=>['i:116','i:46012'].includes(f.key)),q);
  assert.equal(resolve(q).story.events[0].fundKey,undefined,q);
 }
 const synthetic={funds:[{key:'g:1',id:1,name:'איי.בי.אי כללי',corp:'איי.בי.אי',src:'gemel',end:202609},{key:'p:2',id:2,name:'איילון פנסיה כללי',corp:'איילון',src:'pension',end:202610}]};
 assert.deepEqual(W.searchFunds(synthetic,'ibi').map(f=>f.key),['g:1']);
});
