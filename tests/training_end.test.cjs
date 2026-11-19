const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../model.js');
const at=ms=>new Date(Date.parse('2026-11-19T10:00:00Z')+ms).toISOString();
function started(mode='intervals',planned=2){
  const w=M.startSolo(M.blank(),'athlete-default',planned);
  const a=M.startAttempt(w.state,w.value.id,mode,4,at(0));
  return {s:a.state,w:w.value,id:a.value.id};
}
for(const mode of ['intervals','stopwatch']){
  test(`${mode}: cancelled launch has a distinct ID, same ordinal, no result`,()=>{
    const {s,w,id}=started(mode),intervals=mode==='intervals'?[800,900]:[];
    const cancelled=M.cancelAttempt(s,id,9999,intervals,10,at(9999));
    assert.equal(M.baseline(cancelled.state,'athlete-default'),null);
    assert.equal(M.publicWorkouts(cancelled.state,'athlete-default').length,0);
    assert.equal(cancelled.value.totalMs,null);assert.equal(cancelled.value.elapsedMs,9999);
    const retry=M.startAttempt(cancelled.state,w.id,mode,4,at(11000));
    assert.equal(retry.value.ordinal,1);assert.notEqual(retry.value.id,id);
    assert.equal(retry.value.intervalsMs.length,0);
    assert.equal(M.workoutOf(retry.state,w.id).firstStartedAt,at(0));
    assert.deepEqual(M.eventLog(retry.state).map(e=>e.type),['attempt_started','start_cancelled','attempt_started']);
  });
  test(`${mode}: exactly 10 seconds and later cannot cancel; completed attempts cannot cancel`,()=>{
    const {s,id}=started(mode);
    for(const elapsed of [10000,10001])assert.throws(()=>M.cancelAttempt(s,id,elapsed,[],10));
    const result=M.finishAttempt(s,id,4000,mode==='intervals'?[1000,1000,1000,1000]:[],at(4000));
    assert.throws(()=>M.cancelAttempt(result.state,id,4000,[],10));
    assert.deepEqual(M.eventLog(result.state).map(e=>e.type),['attempt_started','attempt_completed']);
    assert.equal(M.eventLog(result.state)[1].totalMs,4000);
  });
  test(`${mode}: early end retains partial measurement without inventing a result`,()=>{
    const {s,w,id}=started(mode),partial=mode==='intervals'?[1000,2000]:[];
    const saved=M.checkpointAttempt(s,id,3500,partial,at(3500));
    const ended=M.endWorkout(saved.state,w.id,at(3500));
    assert.equal(ended.value.closeReason,'early_end');assert.equal(ended.state.device.activeWorkoutId,null);
    const a=M.attemptOf(ended.state,id);
    assert.equal(a.interruptionReason,'early_end');assert.equal(a.elapsedMs,3500);assert.equal(a.totalMs,null);
    assert.deepEqual(a.intervalsMs,partial);assert.equal(M.baseline(ended.state,'athlete-default'),null);
    assert.throws(()=>M.startAttempt(ended.state,w.id,mode,4));
    assert.deepEqual(M.eventLog(ended.state).map(e=>e.type),['attempt_started','early_end','workout_ended_early']);
    assert.equal(M.eventLog(M.validate(JSON.parse(JSON.stringify(ended.state))))[1].elapsedMs,3500);
  });
}
test('closing before any launch produces neither history nor event entries',()=>{
  const w=M.startSolo(M.blank(),'athlete-default',2),ended=M.endWorkout(w.state,w.value.id);
  assert.deepEqual(M.eventLog(ended.state),[]);assert.deepEqual(M.publicWorkouts(ended.state,'athlete-default'),[]);
});
test('closing during second attempt preserves first result, record and original deadline',()=>{
  const {s,w,id}=started('stopwatch');
  const first=M.finishAttempt(s,id,8000,[],at(8000));
  const original=M.deadline(M.workoutOf(first.state,w.id));
  const second=M.startAttempt(first.state,w.id,'stopwatch',4,at(12000));
  const cancelled=M.cancelAttempt(second.state,second.value.id,1000,[],10,at(13000));
  assert.equal(M.deadline(M.workoutOf(cancelled.state,w.id)),original);
  const retry=M.startAttempt(cancelled.state,w.id,'stopwatch',4,at(15000));
  const ended=M.endWorkout(retry.state,w.id,at(17000));
  assert.equal(ended.value.status,'completed');assert.equal(M.best(ended.state,ended.value),8000);
  assert.equal(M.publicWorkouts(ended.state,'athlete-default').length,1);
  assert.equal(M.completed(ended.state,ended.value).length,1);
});
test('recovery retains last saved partial data and records detection time, not fictional finish time',()=>{
  const {s,id}=started();
  const partial=M.checkpointAttempt(s,id,5000,[1800,1900],at(5000));
  const rec=M.recover(partial.state,Date.parse(at(60000))).state,a=M.attemptOf(rec,id);
  assert.equal(a.endedAt,null);assert.equal(a.detectedAt,at(60000));
  assert.equal(a.elapsedMs,5000);assert.deepEqual(a.intervalsMs,[1800,1900]);
  assert.equal(M.eventLog(rec).at(-1).type,'interruption_detected');
  assert.equal(M.eventLog(M.recover(rec,Date.parse(at(70000))).state).length,2);
});
function pair(){const b=M.addAthlete(M.blank(),'Б');return M.startChild(b.state,['athlete-default',b.value.id],2).state;}
test('ending A before first start preserves B1 and skips A2, without erasing session sequence',()=>{
  let s=pair(),a=M.nextTurn(s);s=M.endWorkout(s,a.workoutId,at(0)).state;
  assert.equal(M.currentChild(s).sequence.length,4);assert.equal(M.nextTurn(s).ordinal,1);
  assert.notEqual(M.nextTurn(s).athleteId,a.athleteId);
  let turn=M.nextTurn(s),start=M.startAttempt(s,turn.workoutId,'stopwatch',4,at(1000));
  s=M.finishAttempt(start.state,start.value.id,4000,[],at(5000)).state;
  assert.equal(M.nextTurn(s).ordinal,2);assert.equal(M.nextTurn(s).athleteId,turn.athleteId);
  start=M.startAttempt(s,turn.workoutId,'stopwatch',4,at(10000));
  s=M.finishAttempt(start.state,start.value.id,4000,[],at(14000)).state;
  assert.equal(M.currentChild(s),null);assert.equal(s.childSessions[0].closeReason,'early_end');
});
test('closing A from its result screen does not cancel the upcoming B turn',()=>{
  let s=pair(),a=M.nextTurn(s),start=M.startAttempt(s,a.workoutId,'stopwatch',4,at(0));
  s=M.finishAttempt(start.state,start.value.id,4000,[],at(4000)).state;
  const b=M.nextTurn(s);s=M.endWorkout(s,a.workoutId,at(6000)).state;
  assert.deepEqual(M.nextTurn(s),b);assert.equal(M.workoutOf(s,b.workoutId).status,'pending');
});
test('coach can end whole session during measurement; existing results survive',()=>{
  let s=pair(),turn=M.nextTurn(s),a=M.startAttempt(s,turn.workoutId,'stopwatch',4,at(0));
  s=M.finishAttempt(a.state,a.value.id,4000,[],at(4000)).state;
  turn=M.nextTurn(s);a=M.startAttempt(s,turn.workoutId,'intervals',4,at(5000));
  s=M.checkpointAttempt(a.state,a.value.id,1500,[1000],at(6500)).state;
  s=M.forceCloseChild(s,at(6500)).state;
  assert.equal(M.currentChild(s),null);assert.equal(s.childSessions[0].status,'force_closed');
  assert.equal(M.baseline(s,'athlete-default'),4000);
  assert.equal(M.attemptOf(s,a.value.id).interruptionReason,'early_end');
  assert.equal(M.attemptOf(s,a.value.id).elapsedMs,1500);
});
