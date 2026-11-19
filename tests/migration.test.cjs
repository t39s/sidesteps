const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../model.js'),G=require('../migration.js');
const at=t=>new Date(Date.parse('2026-11-12T10:00:00Z')+t).toISOString();
const old=()=>({version:4,target:20,mode:'stopwatch',selectedAthleteId:'athlete-a',
  athletes:[{id:'athlete-a',name:'Анна'},{id:'athlete-b',name:'Борис'}],
  sessions:[
    {id:'session-a',athleteId:'athlete-a',createdAt:at(0),target:20,status:'closed',
      exercises:[{mode:'stopwatch',startedAt:at(0),endedAt:at(20000),intervals:[],totalMs:20000}]},
    {id:'session-b',athleteId:'athlete-b',createdAt:at(100000),target:20,status:'closed',
      exercises:[{mode:'stopwatch',startedAt:at(100000),endedAt:at(120000),intervals:[],totalMs:20000}]}
  ],
  archived:[{id:'archive-a',athleteId:'athlete-a',date:'2026-11-10',bestMs:18000}],
  incomplete:[{id:'incomplete-a',athleteId:'athlete-a',mode:'intervals',target:20,status:'incomplete',startedAt:at(0),endedAt:at(10000),intervals:[],elapsedMs:10000}]
});
function storage(content={}){const data=new Map(Object.entries(content));return {
  getItem:key=>data.has(key)?data.get(key):null,
  setItem:(key,val)=>data.set(key,String(val)),
  removeItem:key=>data.delete(key)
};}
const request=id=>JSON.stringify({version:1,athleteId:id});
test('only selected athlete transferred; other source profiles untouched',()=>{
  const source=JSON.stringify(old()),s=storage({[G.LEGACY]:source,[G.PENDING]:request('athlete-a')});
  assert.equal(G.run(s,M).migrated,true);
  assert.equal(s.getItem(G.LEGACY),source);
  const result=M.validateV5(JSON.parse(s.getItem(G.TARGET)));
  assert.deepEqual(result.athletes.map(a=>a.id),['athlete-a']);
  assert.equal(result.workouts.length,1);assert.equal(result.attempts.length,1);
  assert.equal(result.archived.length,1);assert.equal(result.incomplete.length,1);
  assert.equal(s.getItem(G.PENDING),null);assert.ok(s.getItem(G.DONE));
});
test('second profile has independent history and no unrelated records',()=>{
  const result=G.select(old(),'athlete-b',M);
  assert.deepEqual(result.athletes.map(a=>a.id),['athlete-b']);
  assert.equal(result.workouts.length,1);assert.equal(result.archived.length,0);
  assert.equal(result.incomplete.length,0);
});
test('repeated request is idempotent',()=>{
  const s=storage({[G.LEGACY]:JSON.stringify(old()),[G.PENDING]:request('athlete-b')});
  G.run(s,M);const initial=s.getItem(G.TARGET);
  s.setItem(G.PENDING,request('athlete-b'));G.run(s,M);
  assert.equal(s.getItem(G.TARGET),initial);
});
test('existing nonempty history is never replaced',()=>{
  const original=JSON.stringify(G.select(old(),'athlete-a',M));
  const s=storage({[G.LEGACY]:JSON.stringify(old()),[G.TARGET]:original,[G.PENDING]:request('athlete-b')});
  assert.throws(()=>G.run(s,M),/другая история/);
  assert.equal(s.getItem(G.TARGET),original);assert.equal(s.getItem(G.DONE),null);
  assert.ok(s.getItem(G.PENDING));
});
test('initial empty sidesteps placeholder can be replaced',()=>{
  const s=storage({[G.LEGACY]:JSON.stringify(old()),[G.TARGET]:JSON.stringify({...M.blank(),schemaVersion:5}),[G.PENDING]:request('athlete-a')});
  G.run(s,M);
  assert.equal(JSON.parse(s.getItem(G.TARGET)).athletes[0].id,'athlete-a');
});
test('old history never imported automatically without explicit profile choice',()=>{
  const s=storage({[G.LEGACY]:JSON.stringify(old())});
  assert.equal(G.run(s,M).blocked,true);assert.equal(s.getItem(G.TARGET),null);
});
test('invalid selected profile changes neither source nor destination',()=>{
  const source=JSON.stringify(old()),s=storage({[G.LEGACY]:source,[G.PENDING]:request('missing')});
  assert.throws(()=>G.run(s,M),/не найден/);
  assert.equal(s.getItem(G.LEGACY),source);assert.equal(s.getItem(G.TARGET),null);
});
