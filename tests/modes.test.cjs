const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../model.js'),config=require('../config.json');
const aid='athlete-default';
const chunks=(ms,n)=>Array.from({length:n},(_,i)=>Math.floor(ms/n)+(i<ms%n?1:0));
function workout(state,mode,target,times,plan=null){
  const w=M.startSolo(state,aid,times.length,plan);state=w.state;
  let clock=Date.UTC(2026,10,1)+state.workouts.length*1000000;
  w.value.createdAt=new Date(clock).toISOString();
  for(const ms of times){const a=M.startAttempt(state,w.value.id,mode,target,new Date(clock).toISOString());state=M.finishAttempt(a.state,a.value.id,ms,mode==='intervals'?chunks(ms,target):[],new Date(clock+ms).toISOString()).state;clock+=ms+1000;}
  return {state,w:M.workoutOf(state,w.value.id)};
}
test('trainer defaults are separate, existing installations fix 20 and fresh setups permit one choice',()=>{
  const fresh=M.defaultTrainerSettings(config,false),existing=M.defaultTrainerSettings(config,true);
  assert.equal(fresh.workingCountLocked,false);assert.equal(existing.workingCountLocked,true);
  assert.equal(existing.workingIntervalCount,20);
  assert.throws(()=>M.changeTrainerSettings(fresh,{workingIntervalCount:30}),/PIN/);
  const chosen=M.changeTrainerSettings(fresh,{workingIntervalCount:30,testIntervalCount:3,workRestDurationSec:90,testRestDurationSec:15},true);
  assert.equal(chosen.workingCountLocked,true);assert.equal(chosen.workingIntervalCount,30);
  assert.throws(()=>M.changeTrainerSettings(chosen,{workingIntervalCount:20},true),/зафиксировано/);
  const updated=M.changeTrainerSettings(chosen,{testIntervalCount:5,testRestDurationSec:30},true);
  assert.equal(updated.workRestDurationSec,90);assert.equal(updated.testRestDurationSec,30);
  assert.equal(chosen.testIntervalCount,3);
});
test('invalid permanent settings are rejected without altering the existing settings',()=>{
  const t=M.defaultTrainerSettings(config,true),before=JSON.stringify(t);
  for(const patch of [{testIntervalCount:0},{testIntervalCount:201},{testIntervalCount:3.5},{workRestDurationSec:-1},{testRestDurationSec:601}])assert.throws(()=>M.changeTrainerSettings(t,patch,true));
  assert.equal(JSON.stringify(t),before);
});
test('test and working purposes remain distinct even with the same number of intervals',()=>{
  const t=M.changeTrainerSettings(M.defaultTrainerSettings(config,false),{testIntervalCount:20},true);
  const plan=M.measurementPlan('test-intervals',t);
  const r=workout(M.blank(),'intervals',20,[1000],plan);
  assert.equal(M.baseline(r.state,aid),null);assert.deepEqual(M.renderChartData(r.state,aid),[]);
  assert.equal(M.archivedWorkouts(r.state,aid)[0].id,r.w.id);
});
test('record and average use only working attempts and one best result per finished workout',()=>{
  let s=M.blank();
  s=workout(s,'intervals',20,[6000,5000]).state;
  s=workout(s,'intervals',20,[8000,7000]).state;
  s=workout(s,'intervals',4,[400]).state;
  s=workout(s,'stopwatch',1,[300]).state;
  s=M.addArchived(s,aid,'2026-11-01',200).state;
  const before=JSON.stringify(s),points=M.renderChartData(s,aid);
  assert.deepEqual(points.map(x=>x.ms),[5000,7000]);
  assert.equal(points.reduce((n,p)=>n+p.ms,0)/points.length,6000);
  assert.equal(M.baseline(s,aid),5000);assert.equal(M.archivedWorkouts(s,aid).length,2);
  assert.equal(JSON.stringify(s),before);
});
test('legacy classification retains IDs and all original data, including unknown counts and comments',()=>{
  let s=workout(M.blank(),'intervals',30,[3000]).state;
  s=workout(s,'stopwatch',1,[2000]).state;
  s=workout(s,'intervals',4,[1000]).state;
  s.workouts[0].athleteComment='Старый комментарий';s.attempts[0].recordEvent=true;
  const before=JSON.stringify(s);M.validate(s);
  assert.equal(M.publicWorkouts(s,aid).length,0);assert.equal(M.archivedWorkouts(s,aid).length,3);
  assert.ok(s.attempts.every(a=>!M.recordInfo(s,a).recordEvent));
  const imported=M.evaluatePersonalImport(M.blank(),JSON.parse(before),aid).state;
  for(const k of ['workouts','attempts','archived'])assert.deepEqual(imported[k],s[k]);
  assert.equal(JSON.stringify(s),before);
});
test('new working count 30 is eligible while a legacy 30 result stays archived',()=>{
  let s=workout(M.blank(),'intervals',30,[300]).state;
  const t=M.changeTrainerSettings(M.defaultTrainerSettings(config,false),{workingIntervalCount:30},true);
  s=workout(s,'intervals',30,[3000],M.measurementPlan('intervals',t)).state;
  assert.equal(M.baseline(s,aid),3000);assert.deepEqual(M.renderChartData(s,aid).map(p=>p.ms),[3000]);
});
test('workout snapshot survives configuration changes, recovery and an attempted mode switch',()=>{
  const original=M.defaultTrainerSettings(config,false),plan=M.measurementPlan('test-intervals',original);
  let r=M.startSolo(M.blank(),aid,2,plan),s=r.state;
  let a=M.startAttempt(s,r.value.id,'intervals',4);s=M.finishAttempt(a.state,a.value.id,4000,[1000,1000,1000,1000]).state;
  const changed=M.changeTrainerSettings(original,{testIntervalCount:3,testRestDurationSec:2},true);
  s=M.recover(s).state;
  assert.deepEqual(M.workoutPlan(s,s.workouts[0],changed),plan);
  a=M.startAttempt(s,r.value.id,'stopwatch',3);
  assert.equal(a.value.mode,'intervals');assert.equal(a.value.targetIntervals,4);
  assert.equal(M.workoutOf(a.state,r.value.id).measurementPlan.restDurationSec,20);
});
test('paired session snapshots apply to both participants and keep the queue intact',()=>{
  let s=M.addAthlete(M.blank(),'Б').state;
  const plan=M.measurementPlan('stopwatch',M.defaultTrainerSettings(config,false));
  s=M.startChild(s,s.athletes.map(a=>a.id),2,plan).state;
  const next=M.nextTurn(s);
  assert.ok(s.workouts.every(w=>M.equivalent(w.measurementPlan,plan)));
  const a=M.startAttempt(s,next.workoutId,'intervals',20);
  assert.equal(a.value.mode,'stopwatch');assert.equal(a.value.targetIntervals,null);
  s=M.finishAttempt(a.state,a.value.id,1000).state;
  assert.equal(M.nextTurn(s).athleteId,s.athletes[1].id);
});
test('mixed legacy workout uses only its working attempt in chart and remains visible in archive',()=>{
  let r=M.startSolo(M.blank(),aid,2),a=M.startAttempt(r.state,r.value.id,'intervals',20);
  let s=M.finishAttempt(a.state,a.value.id,2000,Array(20).fill(100)).state;
  a=M.startAttempt(s,r.value.id,'stopwatch',1);s=M.finishAttempt(a.state,a.value.id,1000).state;
  assert.equal(M.best(s,s.workouts[0]),1000);assert.equal(M.workingBest(s,s.workouts[0]),2000);
  assert.equal(M.renderChartData(s,aid)[0].ms,2000);assert.equal(M.archivedWorkouts(s,aid).length,1);
});
test('working record interpretation ignores old archive-dependent flags without rewriting them',()=>{
  let s=workout(M.blank(),'intervals',20,[3000]).state;
  s=workout(s,'intervals',20,[2000]).state;
  s.attempts[1].recordEvent=false;s.attempts[1].previousRecordMs=null;
  const before=JSON.stringify(s);
  assert.equal(M.recordInfo(s,s.attempts[1]).recordEvent,true);
  assert.equal(M.recordInfo(s,s.attempts[1]).previousRecordMs,3000);
  assert.equal(JSON.stringify(s),before);
});

test('archive statistics setting is optional for old settings, false by default and PIN protected',()=>{
  const t=M.defaultTrainerSettings(config,true);assert.equal(t.includeArchiveStats,false);
  const old={...t};delete old.includeArchiveStats;const bytes=JSON.stringify(old);
  assert.equal(M.validateTrainerSettings(old),old);assert.equal(JSON.stringify(old),bytes);
  assert.throws(()=>M.changeTrainerSettings(t,{includeArchiveStats:true}),/PIN/);
  for(const value of [1,'true',null])assert.throws(()=>M.changeTrainerSettings(t,{includeArchiveStats:value},true));
  const enabled=M.changeTrainerSettings(old,{includeArchiveStats:true},true);
  assert.equal(enabled.includeArchiveStats,true);assert.equal(old.includeArchiveStats,undefined);
  assert.equal(M.changeTrainerSettings(enabled,{includeArchiveStats:false},true).includeArchiveStats,false);
});
test('combined statistics count best attempt per workout and each manual archive once, preserving source bytes',()=>{
  let s=workout(M.blank(),'intervals',20,[6000,5000]).state;
  s=workout(s,'intervals',4,[1000,800]).state;
  s=workout(s,'stopwatch',1,[900,600]).state;
  s=M.addArchived(s,aid,'2026-10-01',200).state;
  s=M.addAthlete(s,'Другой').state;
  s=M.addArchived(s,s.athletes[1].id,'2026-10-01',100).state;
  const bytes=JSON.stringify(s);
  assert.deepEqual(M.renderChartData(s,aid,true).map(p=>p.ms),[200,5000,800,600]);
  assert.equal(M.renderChartData(s,aid,true).reduce((sum,p)=>sum+p.ms,0)/4,1650);
  assert.equal(M.baseline(s,aid,null,true),200);
  assert.deepEqual(M.renderChartData(s,aid).map(p=>p.ms),[5000]);assert.equal(M.baseline(s,aid),5000);
  assert.deepEqual(M.renderChartData(s,s.athletes[1].id,true).map(p=>p.ms),[100]);
  assert.equal(JSON.stringify(s),bytes);
});
test('combined mixed workout produces one chart point and retains both original attempts',()=>{
  let r=M.startSolo(M.blank(),aid,2),a=M.startAttempt(r.state,r.value.id,'intervals',20);
  let s=M.finishAttempt(a.state,a.value.id,2000,Array(20).fill(100)).state;
  a=M.startAttempt(s,r.value.id,'stopwatch',1);s=M.finishAttempt(a.state,a.value.id,1000).state;
  const bytes=JSON.stringify(s);
  assert.deepEqual(M.renderChartData(s,aid,true).map(p=>p.ms),[1000]);
  assert.deepEqual(M.renderChartData(s,aid,false).map(p=>p.ms),[2000]);
  assert.equal(M.baseline(s,aid,null,true),1000);assert.equal(JSON.stringify(s),bytes);
});
test('combined record events use previous test/manual results without rewriting historical flags',()=>{
  let s=workout(M.blank(),'intervals',20,[5000]).state;
  s=workout(s,'intervals',4,[1000]).state;
  const testAttempt=s.attempts.at(-1);
  assert.equal(M.recordInfo(s,testAttempt).recordEvent,false);
  assert.deepEqual(M.recordInfo(s,testAttempt,true),{recordEvent:true,previousRecordMs:5000});
  s=workout(s,'intervals',20,[4000]).state;
  const working=s.attempts.at(-1);
  assert.equal(M.recordInfo(s,working).recordEvent,true);assert.equal(M.recordInfo(s,working,true).recordEvent,false);
  s=M.addArchived(s,aid,'2026-10-01',500).state;
  const bytes=JSON.stringify(s);
  assert.equal(M.recordInfo(s,testAttempt,true).recordEvent,false);
  assert.equal(M.recordInfo(s,working,true).recordEvent,false);
  assert.equal(JSON.stringify(s),bytes);
  let manualFirst=M.addArchived(M.blank(),aid,'2026-10-01',3000).state;
  manualFirst=workout(manualFirst,'stopwatch',1,[2000]).state;
  assert.deepEqual(M.recordInfo(manualFirst,manualFirst.attempts[0],true),{recordEvent:true,previousRecordMs:3000});
});
test('combined records include completed attempts of pending workouts but chart excludes interrupted and unfinished workouts',()=>{
  let s=workout(M.blank(),'intervals',20,[5000]).state;
  const w=M.startSolo(s,aid,2),a=M.startAttempt(w.state,w.value.id,'stopwatch',1);
  s=M.finishAttempt(a.state,a.value.id,500).state;
  const interrupted=M.startAttempt(s,w.value.id,'stopwatch',1);s=M.interruptAttempt(interrupted.state,interrupted.value.id).state;
  const bytes=JSON.stringify(s);
  assert.equal(M.baseline(s,aid,null,true),500);
  assert.deepEqual(M.renderChartData(s,aid,true).map(p=>p.ms),[5000]);
  assert.equal(M.baseline(s,aid),5000);assert.equal(JSON.stringify(s),bytes);
});
