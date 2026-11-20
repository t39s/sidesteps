const test=require('node:test'),assert=require('node:assert/strict'),M=require('../model.js');
const fixture=name=>require('./fixtures/'+name+'.json');
const fields=['athletes','workouts','attempts','archived','incomplete','childSessions'];
function two(){return M.migrateV5ToV6(fixture('v5-multiple'),'athlete-default');}
function history(s,aid=s.baseProfileId){return M.addArchived(s,aid,'2026-11-01',2000).state;}
test('v6 base is mandatory, unique reference; v5 source unchanged',()=>{const v=fixture('v5-single'),before=JSON.stringify(v),s=M.migrateV5ToV6(v);assert.equal(s.baseProfileId,v.athletes[0].id);assert.equal(JSON.stringify(v),before);assert.throws(()=>M.validate({...s,baseProfileId:'missing'}));});
test('multi migration requires explicit base and preserves all history',()=>{for(const name of ['v5-multiple','v5-running','v5-session']){const v=fixture(name),bytes=JSON.stringify(v);assert.throws(()=>M.migrateV5ToV6(v));const aid=v.athletes.at(-1).id,s=M.migrateV5ToV6(v,aid);assert.equal(s.baseProfileId,aid);for(const k of fields)assert.deepEqual(s[k],v[k]);assert.equal(JSON.stringify(v),bytes);assert.equal(s.device.trainerActivated,false);}});
test('recovery runs after conversion, preserving attempt facts and session order',()=>{for(const name of ['v5-running','v5-session']){const v=fixture(name),s=M.migrateV5ToV6(v,v.athletes[0].id),r=M.recover(s).state;assert.deepEqual(r.childSessions,s.childSessions);assert.ok(r.attempts.every(a=>a.status!=='running'));assert.equal(JSON.stringify(v),JSON.stringify(fixture(name)));}});
test('rename and rebase preserve IDs and histories; rebase needs permission',()=>{let s=history(two()),aid=s.athletes[1].id;assert.throws(()=>M.setBaseProfile(s,aid));s=M.renameAthlete(s,aid,'Другое имя').state;const before=M.clone(s);s=M.setBaseProfile(s,aid,true).state;for(const k of fields)assert.deepEqual(s[k],before[k]);assert.equal(s.baseProfileId,aid);});
test('new solo workouts are restricted to the base, existing RC4 additional solo can resume with PIN',()=>{
 const s=two(),aid=s.athletes[1].id;
 assert.throws(()=>M.startSolo(s,aid,1,true),/базовому/);
 const old=M.mutation(s,n=>{const w=M.newWorkout(n,aid,1);n.device.activeWorkoutId=w.id;return w;});
 assert.throws(()=>M.startAttempt(old.state,old.value.id,'stopwatch',1));
 const resumed=M.startAttempt(old.state,old.value.id,'stopwatch',1,M.iso(),true);
 assert.equal(resumed.value.athleteId,aid);
});
test('delete last, base without replacement, active solo or participant is rejected immutably',()=>{assert.throws(()=>M.deleteProfileAndRebase(M.blank(),'athlete-default',null,true));let s=two(),bytes=JSON.stringify(s);assert.throws(()=>M.deleteProfileAndRebase(s,s.baseProfileId,null,true));assert.equal(JSON.stringify(s),bytes);let r=M.startSolo(s,s.baseProfileId,2);assert.throws(()=>M.deleteProfileAndRebase(r.state,s.baseProfileId,s.athletes[1].id,true));s=M.startChild(s,s.athletes.map(a=>a.id),2).state;assert.throws(()=>M.deleteProfileAndRebase(s,s.baseProfileId,s.athletes[1].id,true));assert.throws(()=>M.setBaseProfile(s,s.athletes[1].id,true));});
test('atomic delete and rebase retains other participant history and valid historical session',()=>{let s=two(),ids=s.athletes.map(a=>a.id);s=M.startChild(s,ids,1).state;for(let i=0;i<2;i++){const t=M.nextTurn(s),a=M.startAttempt(s,t.workoutId,'stopwatch',1);s=M.finishAttempt(a.state,a.value.id,2000,[]).state;}const survivor=s.attempts.find(a=>a.athleteId===ids[1]),rev=s.revision;s=M.deleteProfileAndRebase(s,ids[0],ids[1],true).state;assert.equal(s.revision,rev+1);assert.equal(s.baseProfileId,ids[1]);assert.deepEqual(s.attempts,[survivor]);assert.equal(s.childSessions.length,1);M.validate(s);});
test('import identical archive idempotently, key order and collection order irrelevant',()=>{let s=history(history(two()));const incoming=M.clone(s);incoming.archived.reverse();incoming.athletes=incoming.athletes.map(a=>({name:a.name,id:a.id}));let n=M.evaluateImport(s,incoming,true).state;for(const k of fields)assert.deepEqual(n[k],s[k]);assert.equal(n.baseProfileId,s.baseProfileId);});
for(const kind of ['name','history','disjoint','record'])test('import rejects entire '+kind+' conflict',()=>{const s=history(two()),incoming=M.clone(s),bytes=JSON.stringify(s);if(kind==='name')incoming.athletes[0].name='Новое';if(kind==='history')incoming.archived=[];if(kind==='disjoint')incoming.archived[0].id='different';if(kind==='record')incoming.archived[0].bestMs=3000;assert.throws(()=>M.evaluateImport(s,incoming,true),/Конфликт/);assert.equal(JSON.stringify(s),bytes);});
test('independent athlete-default histories never merge by ID/name',()=>{const a=history(M.blank()),b=history(M.blank());assert.throws(()=>M.evaluateImport(a,b),/Конфликт/);});
test('different ID, same name added only with PIN; local base and device retained',()=>{const s=history(M.blank()),incoming=history(M.blank());incoming.athletes[0].id='other';incoming.baseProfileId='other';incoming.archived[0].athleteId='other';incoming.device.selectedAthleteId='other';incoming.device.trainerAthleteId='other';incoming.device.trainerActivated=true;assert.throws(()=>M.evaluateImport(s,incoming));const n=M.evaluateImport(s,incoming,true).state;assert.equal(n.athletes.length,2);assert.equal(n.baseProfileId,s.baseProfileId);assert.equal(n.device.trainerActivated,false);});
test('fresh placeholder replaced once; multiple profiles require explicit PIN and base',()=>{let incoming=history(two()),aid=incoming.athletes[1].id;assert.throws(()=>M.evaluateImport(M.blank(),incoming));assert.throws(()=>M.evaluateImport(M.blank(),incoming,true));let n=M.evaluateImport(M.blank(),incoming,true,aid).state;assert.equal(n.baseProfileId,aid);assert.deepEqual(n.archived,incoming.archived);const single=M.clone(history(M.blank()));single.athletes[0].id='new';single.archived[0].athleteId='new';single.baseProfileId='new';single.device.selectedAthleteId='new';single.device.trainerAthleteId='new';n=M.evaluateImport(M.blank(),single).state;assert.equal(n.athletes.length,1);assert.equal(n.baseProfileId,'new');});
test('incomplete history prevents placeholder replacement; malformed links rejected',()=>{const s=M.blank();s.incomplete=[{id:'x',athleteId:s.baseProfileId}];assert.equal(M.isPlaceholder(s),false);assert.throws(()=>M.validate({...s,incomplete:[{id:'x',athleteId:'missing'}]}));});
test('legacy pending conversion remains available without altering original',()=>{const old={version:4,target:1,mode:'stopwatch',athletes:[{id:'x',name:'X'}],sessions:[{id:'old',athleteId:'x',target:1,createdAt:M.iso(),status:'pending',exercises:[{mode:'stopwatch',startedAt:M.iso(),endedAt:M.iso(),totalMs:1200,intervals:[]}]}]};const bytes=JSON.stringify(old),n=M.normalizeImport(old);assert.equal(n.workouts[0].status,'legacy_pending');assert.equal(n.baseProfileId,'x');assert.equal(JSON.stringify(old),bytes);});
test('new profile cannot reuse an existing result ID with other contents',()=>{const s=history(M.blank()),incoming=history(M.blank());incoming.athletes[0].id='new';incoming.baseProfileId='new';incoming.device.selectedAthleteId='new';incoming.device.trainerAthleteId='new';incoming.archived[0].athleteId='new';incoming.archived[0].id=s.archived[0].id;const bytes=JSON.stringify(s);assert.throws(()=>M.evaluateImport(s,incoming,true),/Конфликт/);assert.equal(JSON.stringify(s),bytes);});
test('deleting one historical participant workout retains the other participant result',()=>{let s=two();s=M.startChild(s,s.athletes.map(a=>a.id),1).state;for(let i=0;i<2;i++){let a=M.startAttempt(s,M.nextTurn(s).workoutId,'stopwatch',1);s=M.finishAttempt(a.state,a.value.id,1000,[]).state;}const second=s.attempts[1];s=M.deleteRecord(s,'workout',s.workouts[0].id,true).state;assert.deepEqual(s.attempts,[second]);assert.equal(s.childSessions[0].athleteIds.length,1);M.validate(s);});
test('malformed dated history and duplicated session turns are rejected before import',()=>{let s=M.startSolo(M.blank(),'athlete-default',1).state;const bad=M.clone(s);bad.workouts[0].createdAt=null;assert.throws(()=>M.evaluateImport(M.blank(),bad),/Некорректная тренировка/);s=two();s=M.startChild(s,s.athletes.map(a=>a.id),2).state;const c=M.clone(s);c.childSessions[0].sequence[1]={...c.childSessions[0].sequence[0]};assert.throws(()=>M.validate(c),/порядок/);});
test('v5 deleted workout keeps closed session facts and surviving results during migration',()=>{const v=fixture('v5-deleted-session-workout'),bytes=JSON.stringify(v),n=M.migrateV5ToV6(v,v.athletes[1].id);for(const k of fields.filter(k=>k!=='childSessions'))assert.deepEqual(n[k],v[k]);const c=n.childSessions[0],{unavailableWorkoutIds,...original}=c;assert.deepEqual(original,v.childSessions[0]);assert.deepEqual(unavailableWorkoutIds,[v.childSessions[0].workoutIds[0]]);assert.equal(JSON.stringify(v),bytes);assert.equal(n.baseProfileId,v.athletes[1].id);M.validate(M.recover(n).state);});
test('all old session workouts may be absent without dropping the session or inventing results',()=>{const v=M.clone(fixture('v5-deleted-session-workout'));v.workouts=[];v.attempts=[];const n=M.migrateV5ToV6(v,v.athletes[0].id);assert.equal(n.childSessions.length,1);assert.deepEqual(n.childSessions[0].unavailableWorkoutIds,v.childSessions[0].workoutIds);assert.equal(n.workouts.length+n.attempts.length,0);M.validate(n);});
test('active session missing links and conflicting surviving workout ownership remain rejected',()=>{const v=M.clone(fixture('v5-deleted-session-workout'));v.childSessions[0].status='active';v.device.activeChildSessionId=v.childSessions[0].id;assert.throws(()=>M.migrateV5ToV6(v,v.athletes[0].id));const closed=M.clone(fixture('v5-deleted-session-workout'));closed.childSessions[0].workoutIds.reverse();assert.throws(()=>M.migrateV5ToV6(closed,closed.athletes[0].id),/связь занятия/);const n=M.migrateV5ToV6(fixture('v5-deleted-session-workout'),'athlete-default');n.childSessions[0].unavailableWorkoutIds.push(n.workouts[0].id);assert.throws(()=>M.validate(n),/отсутствующие/);});
test('migrated historical snapshots survive export/import round trip and later record deletion',()=>{const v=fixture('v5-deleted-session-workout'),n=M.migrateV5ToV6(v,v.athletes[0].id);assert.deepEqual(M.evaluateImport(n,M.clone(n),true).state.childSessions,n.childSessions);const d=M.deleteRecord(n,'workout',n.workouts[0].id,true).state;assert.equal(d.attempts.length,0);M.validate(d);});
test('delete either migrated profile retains the other historical participant and valid base',()=>{const v=fixture('v5-deleted-session-workout');for(const aid of v.athletes.map(a=>a.id)){const other=v.athletes.find(a=>a.id!==aid).id,n=M.migrateV5ToV6(v,v.athletes[0].id),d=M.deleteProfileAndRebase(n,aid,other,true).state;assert.equal(d.baseProfileId,other);assert.deepEqual(d.attempts,v.attempts.filter(a=>a.athleteId===other));assert.deepEqual(d.childSessions[0].athleteIds,[other]);M.validate(d);}});

test('two workout comments preserve measurements, support independent edits, and enforce access',()=>{
  const base=two(), aid=base.baseProfileId;
  const solo=M.startSolo(base,aid,1);
  const active=M.startAttempt(solo.state,solo.value.id,'intervals',2);
  assert.throws(()=>M.saveWorkoutComments(active.state,solo.value.id,{athleteComment:'Рано'},true));
  const finished=M.finishAttempt(active.state,active.value.id,1900,[900,1000]).state;
  assert.throws(()=>M.saveWorkoutComments(finished,solo.value.id,{athleteComment:'Ок',trainerComment:'Недоступно'}));
  const personal=M.saveWorkoutComments(finished,solo.value.id,{athleteComment:'Слова спортсмена'}).state;
  const coached=M.saveWorkoutComments(personal,solo.value.id,{trainerComment:'Строка 1\r\nСтрока 2'},true).state;
  const cleared=M.saveWorkoutComments(coached,solo.value.id,{athleteComment:'  '},true).state;
  assert.equal(cleared.workouts[0].trainerComment,'Строка 1\nСтрока 2');
  assert.equal(Object.hasOwn(cleared.workouts[0],'athleteComment'),false);
  const {trainerComment,...w}=cleared.workouts[0];
  assert.deepEqual(w,finished.workouts[0]);
  assert.deepEqual(cleared.attempts,finished.attempts);
  const other=base.athletes[1].id;
  const rebased=M.setBaseProfile(M.renameAthlete(cleared,aid,'Новое имя').state,other,true).state;
  assert.deepEqual(rebased.workouts,cleared.workouts);
  assert.throws(()=>M.saveWorkoutComments(rebased,w.id,{athleteComment:'Нет доступа'}));
  const child=M.startChild(base,[aid,other],1);
  let s=child.state;
  for(let i=0;i<2;i++){const a=M.startAttempt(s,M.nextTurn(s).workoutId,'stopwatch',1);s=M.finishAttempt(a.state,a.value.id,1000+i,[]).state;}
  assert.throws(()=>M.saveWorkoutComments(s,s.workouts[0].id,{athleteComment:'Без PIN'}));
  const edited=M.saveWorkoutComments(s,s.workouts[1].id,{athleteComment:'Со слов',trainerComment:'Совет'},true).state;
  assert.deepEqual(edited.workouts[0],s.workouts[0]);
});

test('comment archive round trip treats empty and absent equally but rejects text conflicts atomically',()=>{
  const solo=M.startSolo(M.blank(),'athlete-default',1),a=M.startAttempt(solo.state,solo.value.id,'stopwatch',1);
  const old=M.finishAttempt(a.state,a.value.id,1900,[]).state;
  const empty=M.clone(old);empty.workouts[0].athleteComment=' \n';empty.workouts[0].trainerComment='';
  assert.deepEqual(M.evaluateImport(old,empty).state.workouts,old.workouts);
  const s=M.saveWorkoutComments(old,solo.value.id,{athleteComment:'Первая\nстрока',trainerComment:'Совет'},true).state;
  const exported=JSON.parse(JSON.stringify(s));exported.workouts[0].athleteComment='Первая\r\nстрока';
  assert.deepEqual(M.evaluateImport(s,exported).state.workouts,s.workouts);
  assert.deepEqual(M.evaluateImport(M.blank(),JSON.parse(JSON.stringify(s))).state.workouts,s.workouts);
  const before=JSON.stringify(s);exported.workouts[0].trainerComment='Иной совет';
  assert.throws(()=>M.evaluateImport(s,exported),/Конфликт/);
  assert.equal(JSON.stringify(s),before);
  exported.workouts[0].trainerComment=42;
  assert.throws(()=>M.evaluateImport(s,exported),/Некорректный комментарий/);
});
