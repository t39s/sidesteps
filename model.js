/* sidesteps 2.0: deterministic domain logic. No DOM or network. */
(function(root, factory) { const m = factory(); if (typeof module !== 'undefined' && module.exports) module.exports = m; else root.ILModel = m; })(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const KEY = 'interval-lab:data:v6', LEGACY_KEY = 'interval-lab:data:v1', V5_KEY = 'interval-lab:data:v5';
  const iso = () => new Date().toISOString();
  const id = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const assert = (ok,msg) => { if(!ok) throw Error(msg); };
  const validMs = x => Number.isSafeInteger(x) && x > 0 && x <= 86400000;
  const fmt = ms => (ms/1000).toFixed(3).replace('.',',') + ' с';
  const mins = ms => { ms=Math.max(0,Math.ceil(ms/1000)); return String(Math.floor(ms/60)).padStart(2,'0')+':'+String(ms%60).padStart(2,'0'); };
  const date = s => new Date(s).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
  const datetime = s => new Date(s).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const blank = () => ({schemaVersion:6,baseProfileId:'athlete-default',revision:0,athletes:[{id:'athlete-default',name:'Спортсмен'}],workouts:[],attempts:[],childSessions:[],archived:[],incomplete:[],device:{lastInterface:'athlete',trainerActivated:false,soundEnabled:false,selectedAthleteId:'athlete-default',trainerAthleteId:'athlete-default',activeWorkoutId:null,activeChildSessionId:null,childParticipants:[],viewAthleteId:null,measurementMode:'intervals',soloPlannedAttempts:2,soloMeasurementMode:'intervals'}});
  const ensureUnique = (items,n) => { assert(Array.isArray(items),n+' не является массивом');const ids=items.map(x=>x.id);assert(ids.every(x=>typeof x==='string' && x.length>0) && new Set(ids).size===ids.length,'Повторяющиеся ID '+n); };
  function validateV5(s) {
    assert(s && s.schemaVersion===5,'Несовместимая версия данных');
    ['athletes','workouts','attempts','childSessions','archived','incomplete'].forEach(n=>ensureUnique(s[n],n));
    assert(s.athletes.length>=1 && s.athletes.length<=100,'Число спортсменов вне диапазона');
    const ids=new Set(s.athletes.map(x=>x.id));
    assert(s.athletes.every(a=>typeof a.name==='string' && a.name.trim().length>0 && a.name.length<=50),'Некорректный профиль');
    assert(s.attempts.every(a=>ids.has(a.athleteId) && ['completed','interrupted','running'].includes(a.status) && ['intervals','stopwatch'].includes(a.mode) && (a.status!=='completed' || validMs(a.totalMs))),'Некорректные попытки');
    assert(s.workouts.every(w=>ids.has(w.athleteId) && [1,2].includes(w.plannedAttempts) && ['pending','completed','legacy_pending'].includes(w.status) && Array.isArray(w.attemptIds)),'Некорректные тренировки');
    const am=new Map(s.attempts.map(a=>[a.id,a]));
    const wm=new Map(s.workouts.map(w=>[w.id,w]));
    for(const a of s.attempts){const w=wm.get(a.workoutId);assert(w&&w.athleteId===a.athleteId&&w.attemptIds.filter(x=>x===a.id).length===1,'Попытка без связанной тренировки');if(a.status==='completed'&&a.mode==='intervals')assert(Array.isArray(a.intervalsMs)&&a.intervalsMs.length===a.targetIntervals&&a.intervalsMs.every(x=>Number.isSafeInteger(x)&&x>=0)&&a.intervalsMs.reduce((x,y)=>x+y,0)===a.totalMs,'Несогласованные интервалы');}
    for(const w of s.workouts){assert(w.attemptIds.every(x=>am.has(x)&&am.get(x).workoutId===w.id&&am.get(x).athleteId===w.athleteId),'Нарушена связь попытки и тренировки');const count=w.attemptIds.filter(x=>am.get(x).status==='completed').length;assert(count<=2,'Более двух попыток');if(w.status==='completed')assert(count>0,'Завершённая тренировка без результата');}
    assert(s.archived.every(x=>ids.has(x.athleteId)&&validMs(x.bestMs)),'Некорректный архив');
    for(const c of s.childSessions){assert(c.nextIndex>=0&&c.nextIndex<=c.sequence.length,'Некорректный индекс занятия');if(c.status==='active')assert(c.sequence.every(t=>wm.has(t.workoutId)&&c.athleteIds.includes(t.athleteId)),'Некорректная очередь занятия');}
    assert(s.childSessions.every(c=>[1,2].includes(c.athleteIds?.length) && c.athleteIds.every(x=>ids.has(x)) && new Set(c.athleteIds).size===c.athleteIds.length && [1,2].includes(c.plannedAttempts) && ['active','completed','force_closed'].includes(c.status) && Array.isArray(c.sequence) && Number.isSafeInteger(c.nextIndex)),'Некорректное занятие');
    assert(s.device && ['athlete','child','trainer'].includes(s.device.lastInterface),'Некорректный интерфейс');
    assert(Number.isSafeInteger(s.revision) && s.revision>=0,'Некорректная ревизия');
    return s;
  }
  const workoutCommentFields=['athleteComment','trainerComment'];
  function validate(s){
    assert(s?.schemaVersion===6,'Несовместимая версия данных');
    validateV5({...s,schemaVersion:5});
    const ids=new Set(s.athletes.map(a=>a.id)), wm=new Map(s.workouts.map(w=>[w.id,w])), am=new Map(s.attempts.map(a=>[a.id,a]));
    assert(ids.has(s.baseProfileId),'Не назначен базовый профиль');
    assert(s.incomplete.every(a=>ids.has(a.athleteId)),'Неполная попытка без профиля');
    for(const k of ['selectedAthleteId','trainerAthleteId','viewAthleteId'])assert(s.device[k]==null||ids.has(s.device[k]),'Некорректный указатель профиля');
    assert(Array.isArray(s.device.childParticipants)&&s.device.childParticipants.every(id=>ids.has(id)),'Некорректные участники');
    assert(!s.device.activeWorkoutId||wm.has(s.device.activeWorkoutId),'Нет активной тренировки');
    assert(!s.device.activeChildSessionId||s.childSessions.some(c=>c.id===s.device.activeChildSessionId&&c.status==='active'),'Нет активного занятия');
    const timestamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
    for(const a of s.attempts){
      assert(timestamp(a.startedAt)&&(a.endedAt==null||timestamp(a.endedAt)),'Некорректная дата попытки');
      assert(Number.isInteger(a.ordinal)&&a.ordinal>=1&&a.ordinal<=wm.get(a.workoutId).plannedAttempts,'Некорректный номер попытки');
      assert(Array.isArray(a.intervalsMs)&&a.intervalsMs.every(x=>Number.isSafeInteger(x)&&x>=0),'Некорректные отсечки');
      assert(a.mode==='stopwatch'?a.intervalsMs.length===0:Number.isInteger(a.targetIntervals)&&a.targetIntervals>=1&&a.targetIntervals<=200,'Некорректный режим попытки');
    }
    for(const w of s.workouts){
      for(const field of workoutCommentFields)assert(!Object.hasOwn(w,field)||typeof w[field]==='string','Некорректный комментарий тренировки');
      assert(new Set(w.attemptIds).size===w.attemptIds.length,'Повтор попытки');
      assert(timestamp(w.createdAt)&&['solo','child','legacy'].includes(w.kind),'Некорректная тренировка');
      const done=w.attemptIds.map(id=>am.get(id)).filter(a=>a.status==='completed');
      assert(done.length<=w.plannedAttempts&&new Set(done.map(a=>a.ordinal)).size===done.length,'Некорректное число зачётных попыток');
    }
    for(const c of s.childSessions){
      assert(Array.isArray(c.workoutIds)&&c.workoutIds.length===c.athleteIds.length&&new Set(c.workoutIds).size===c.workoutIds.length,'Некорректные тренировки занятия');
      const unavailable=c.unavailableWorkoutIds??[];
      assert(Array.isArray(unavailable)&&new Set(unavailable).size===unavailable.length&&unavailable.every(id=>typeof id==='string'&&c.workoutIds.includes(id)&&!wm.has(id))&&(c.status!=='active'||!unavailable.length),'Некорректные отсутствующие тренировки занятия');
      assert(c.workoutIds.every((id,i)=>wm.has(id)?wm.get(id).athleteId===c.athleteIds[i]:unavailable.includes(id)),'Нарушена связь занятия');
      assert(c.sequence.length===c.athleteIds.length*c.plannedAttempts&&c.sequence.every((t,i)=>t.athleteId===c.athleteIds[i%c.athleteIds.length]&&t.ordinal===Math.floor(i/c.athleteIds.length)+1),'Нарушен порядок занятия');
      assert(c.sequence.every(t=>c.workoutIds.includes(t.workoutId)&&(wm.has(t.workoutId)?wm.get(t.workoutId).athleteId===t.athleteId:unavailable.includes(t.workoutId)&&c.athleteIds[c.workoutIds.indexOf(t.workoutId)]===t.athleteId)&&Number.isInteger(t.ordinal)&&t.ordinal>=1&&t.ordinal<=c.plannedAttempts),'Некорректная очередь');
    }
    return s;
  }
  function migrateV5ToV6(source,selectedBaseId){
    validateV5(source);
    const n=clone(source);n.schemaVersion=6;
    n.baseProfileId=source.athletes.length===1?source.athletes[0].id:selectedBaseId;
    n.device.trainerActivated=false;n.device.selectedAthleteId=n.baseProfileId;
    // v5 deletion removed results but retained closed session snapshots. Keep those facts,
    // marking unavailable historical workouts without fabricating results or changing v5.
    const existing=new Set(n.workouts.map(w=>w.id));
    for(const c of n.childSessions)if(c.status!=='active'&&Array.isArray(c.workoutIds)){
      const unavailable=c.workoutIds.filter(id=>!existing.has(id));
      if(unavailable.length)c.unavailableWorkoutIds=unavailable;
    }
    return validate(n);
  }
  function setBaseProfile(s,aid,authorized=false){assert(authorized,'Требуется PIN Тренера');return mutation(s,n=>{
    assert(!n.device.activeWorkoutId&&!currentChild(n),'Сначала завершите тренировку или занятие');
    assert(n.athletes.some(a=>a.id===aid),'Профиль не найден');n.baseProfileId=aid;n.device.selectedAthleteId=aid;return aid;
  });}
  const clone = s => structuredClone(s);
  const completed = (s,w) => w.attemptIds.map(id=>s.attempts.find(a=>a.id===id)).filter(a=>a && a.status==='completed');
  const best = (s,w) => {let a=completed(s,w);return a.length?Math.min(...a.map(x=>x.totalMs)):null;};
  const baseline = (s,athleteId,excludeWorkoutId=null) => {const a=s.attempts.filter(x=>x.status==='completed' && x.athleteId===athleteId && x.workoutId!==excludeWorkoutId).map(x=>x.totalMs);const old=s.archived.filter(x=>x.athleteId===athleteId).map(x=>x.bestMs);const xs=a.concat(old);return xs.length?Math.min(...xs):null;};
  const publicWorkouts = (s,athleteId) => s.workouts.filter(w=>w.athleteId===athleteId && w.status==='completed' && best(s,w)!==null).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const workoutOf = (s,id) => s.workouts.find(w=>w.id===id);
  const attemptOf = (s,id) => s.attempts.find(a=>a.id===id);
  const currentChild = s => s.childSessions.find(c=>c.id===s.device.activeChildSessionId && c.status==='active')||null;
  function mutation(s,fn){const next=clone(s);const val=fn(next);next.revision++;validate(next);return {state:next,value:val};}
  function athleteName(name){
    const trimmed=typeof name==='string'?name.trim():'';
    assert(trimmed.length>0&&trimmed.length<=50,'Имя: от 1 до 50 символов');
    return trimmed;
  }
  function addAthlete(s,name){return mutation(s,n=>{const cleanName=athleteName(name);assert(n.athletes.length<100,'Слишком много спортсменов');const a={id:id(),name:cleanName};n.athletes.push(a);return a;});}
  function renameAthlete(s,athleteId,name){
    return mutation(s,state=>{
      const profile=state.athletes.find(a=>a.id===athleteId);
      assert(profile,'Спортсмен не найден');
      profile.name=athleteName(name);
      return profile;
    });
  }
  function newWorkout(n,athleteId,plannedAttempts,kind='solo'){assert(n.athletes.some(a=>a.id===athleteId),'Нет такого спортсмена');assert([1,2].includes(plannedAttempts),'Число попыток 1 или 2');const w={id:id(),athleteId,plannedAttempts,kind,status:'pending',createdAt:iso(),completedAt:null,closeReason:null,attemptIds:[],baselineExistsAtStart:baseline(n,athleteId)!==null,firstStartedAt:null,firstEndedAt:null};n.workouts.push(w);return w;}
  function addArchived(s,athleteId,dateString,bestMs){return mutation(s,n=>{assert(n.athletes.some(a=>a.id===athleteId),'Неизвестный спортсмен');assert(/^\d{4}-\d{2}-\d{2}$/.test(dateString)&&!Number.isNaN(Date.parse(dateString+'T00:00:00Z')),'Некорректная дата');assert(validMs(bestMs),'Некорректное время');const item={id:id(),athleteId,date:dateString,bestMs};n.archived.push(item);return item;});}
  function startSolo(s,athleteId,plannedAttempts){assert(athleteId===s.baseProfileId,'Самостоятельная тренировка доступна только базовому профилю');return mutation(s,n=>{assert(!currentChild(n),'Сначала завершите занятие');assert(!n.device.activeWorkoutId,'Уже есть активная тренировка');const w=newWorkout(n,athleteId,plannedAttempts);n.device.activeWorkoutId=w.id;return w;});}
  function startChild(s,athleteIds,plannedAttempts){return mutation(s,n=>{assert(!currentChild(n),'Занятие уже началось');assert(!n.device.activeWorkoutId,'Активна личная тренировка');assert(Array.isArray(athleteIds) && [1,2].includes(athleteIds.length) && new Set(athleteIds).size===athleteIds.length,'Выберите одного или двух разных участников');const ws=athleteIds.map(athleteId=>newWorkout(n,athleteId,plannedAttempts,'child'));const sequence=[];for(let ordinal=1;ordinal<=plannedAttempts;ordinal++)for(let j=0;j<athleteIds.length;j++)sequence.push({athleteId:athleteIds[j],workoutId:ws[j].id,ordinal});const c={id:id(),athleteIds:[...athleteIds],workoutIds:ws.map(w=>w.id),plannedAttempts,sequence,nextIndex:0,status:'active',startedAt:iso(),endedAt:null,closeReason:null};n.childSessions.push(c);n.device.activeChildSessionId=c.id;n.device.childParticipants=[...athleteIds];n.device.viewAthleteId=athleteIds[0];n.device.lastInterface='child';return c;});}
  function nextTurn(s){const c=currentChild(s);return c?c.sequence[c.nextIndex]||null:null;}
  function startAttempt(s,workoutId,mode,target,when=iso(),authorized=false){const w0=workoutOf(s,workoutId);assert(currentChild(s)||authorized||w0?.athleteId===s.baseProfileId,'Требуется PIN Тренера');return mutation(s,n=>{const w=workoutOf(n,workoutId);assert(w&&['pending','legacy_pending'].includes(w.status)&&w.closeReason!=='early_end','Тренировка завершена');assert(['intervals','stopwatch'].includes(mode),'Неизвестный режим');assert(Number.isInteger(target)&&target>=1&&target<=200,'Некорректное число интервалов');const c=currentChild(n);if(c){const t=c.sequence[c.nextIndex];assert(t && t.workoutId===w.id,'Не очередь данного спортсмена');}else assert(n.device.activeWorkoutId===w.id,'Тренировка не активна');assert(!n.attempts.some(a=>a.workoutId===w.id && a.status==='running'),'Измерение уже запущено');const ordinal=completed(n,w).length+1;assert(ordinal<=w.plannedAttempts,'Попытки исчерпаны');const a={id:id(),workoutId:w.id,athleteId:w.athleteId,ordinal,mode,status:'running',startedAt:when,endedAt:null,totalMs:null,intervalsMs:[],targetIntervals:mode==='intervals'?target:null,recordEvent:false,previousRecordMs:null};n.attempts.push(a);w.attemptIds.push(a.id);if(!w.firstStartedAt)w.firstStartedAt=when;return a;});}
  function finishAttempt(s,attemptId,totalMs,intervalsMs=[],end=iso()){return mutation(s,n=>{let a=attemptOf(n,attemptId);assert(a&&a.status==='running','Попытка уже завершена');assert(validMs(totalMs),'Некорректная длительность');assert(Array.isArray(intervalsMs) && intervalsMs.every(x=>Number.isSafeInteger(x)&&x>=0),'Некорректные интервалы');if(a.mode==='intervals'){assert(intervalsMs.length===a.targetIntervals,'Неверное число интервалов');assert(intervalsMs.reduce((x,y)=>x+y,0)===totalMs,'Не совпадает сумма интервалов');}else assert(intervalsMs.length===0,'Старт–Стоп не содержит отсечек');const w=workoutOf(n,a.workoutId);const old=baseline(n,a.athleteId,a.workoutId);const priorInWorkout=completed(n,w).map(x=>x.totalMs);const recordBaseline=priorInWorkout.length?Math.min(old??Infinity,...priorInWorkout):old;a.recordEvent=w.baselineExistsAtStart && recordBaseline!==null && a.totalMs!==0 && totalMs<recordBaseline;a.previousRecordMs=a.recordEvent?recordBaseline:null;a.status='completed';a.totalMs=totalMs;a.intervalsMs=[...intervalsMs];a.endedAt=end;if(a.ordinal===1)w.firstEndedAt=end;const count=completed(n,w).length;
    if(count>=w.plannedAttempts){w.status='completed';w.completedAt=end;w.closeReason='all_attempts';if(n.device.activeWorkoutId===w.id)n.device.activeWorkoutId=null;}
    const c=currentChild(n);let hasNext=false;if(c){const turn=c.sequence[c.nextIndex];assert(turn && turn.workoutId===w.id && turn.ordinal===a.ordinal,'Неверное продвижение очереди');c.nextIndex++;advanceChild(n,c,end);hasNext=c.status==='active';if(!hasNext){c.status='completed';c.endedAt=end;n.device.activeChildSessionId=null;n.device.viewAthleteId=c.athleteIds.at(-1);}}
    return {attempt:a,workout:w,sessionDone:!!c&&!hasNext,nextTurn:hasNext?c.sequence[c.nextIndex]:null};});}
  // Event facts live on attempts/workouts; eventLog is a derived view, not a second store.
  function savePartial(a,elapsedMs,intervalsMs){
    assert(Number.isSafeInteger(elapsedMs)&&elapsedMs>=0,'Некорректное прошедшее время');
    assert(Array.isArray(intervalsMs)&&intervalsMs.every(x=>Number.isSafeInteger(x)&&x>=0),'Некорректные отсечки');
    assert(a.mode==='intervals'?intervalsMs.length<a.targetIntervals:intervalsMs.length===0,'Некорректные отсечки');
    assert(intervalsMs.reduce((x,y)=>x+y,0)<=elapsedMs,'Отсечки превышают прошедшее время');
    a.elapsedMs=elapsedMs;a.intervalsMs=[...intervalsMs];
  }
  function checkpointAttempt(s,attemptId,elapsedMs,intervalsMs,at=iso()){
    return mutation(s,n=>{const a=attemptOf(n,attemptId);assert(a?.status==='running','Нет работающей попытки');savePartial(a,elapsedMs,intervalsMs);a.lastObservedAt=at;return a;});
  }
  function cancelAttempt(s,attemptId,elapsedMs,intervalsMs,windowSec,end=iso()){
    return mutation(s,n=>{
      const a=attemptOf(n,attemptId);assert(a?.status==='running','Нет работающей попытки');
      assert(Number.isSafeInteger(windowSec)&&windowSec>0&&elapsedMs<windowSec*1000,'Время отмены запуска истекло');
      savePartial(a,elapsedMs,intervalsMs);a.status='interrupted';a.endedAt=end;a.interruptionReason='start_cancelled';return a;
    });
  }
  function openChildWorkout(n,wid){const w=workoutOf(n,wid);return w?.status==='pending'&&w.closeReason!=='early_end';}
  function advanceChild(n,c,at){
    while(c.nextIndex<c.sequence.length&&!openChildWorkout(n,c.sequence[c.nextIndex].workoutId))c.nextIndex++;
    if(c.nextIndex===c.sequence.length){c.status='completed';c.endedAt=at;c.closeReason=c.workoutIds.some(wid=>workoutOf(n,wid)?.closeReason==='early_end')?'early_end':'all_attempts';n.device.activeChildSessionId=null;}
  }
  function endWorkoutInPlace(n,w,at){
    assert(w,'Нет тренировки');
    if(!['pending','legacy_pending'].includes(w.status)||w.closeReason==='early_end')return w;
    for(const a of n.attempts.filter(a=>a.workoutId===w.id&&a.status==='running')){
      a.status='interrupted';a.endedAt=at;a.interruptionReason='early_end';
    }
    w.status=completed(n,w).length?'completed':'pending';w.completedAt=at;w.closeReason='early_end';
    if(n.device.activeWorkoutId===w.id)n.device.activeWorkoutId=null;
    return w;
  }
  function endWorkout(s,workoutId,at=iso()){
    return mutation(s,n=>{
      const w=endWorkoutInPlace(n,workoutOf(n,workoutId),at),c=currentChild(n);
      if(c){assert(c.workoutIds.includes(w.id),'Тренировка не входит в занятие');advanceChild(n,c,at);}
      return w;
    });
  }
  function eventLog(s,athleteId=null){
    const events=[];
    for(const a of s.attempts.filter(a=>!athleteId||a.athleteId===athleteId)){
      const common={attemptId:a.id,workoutId:a.workoutId,athleteId:a.athleteId,ordinal:a.ordinal,mode:a.mode,targetIntervals:a.targetIntervals};
      events.push({...common,type:'attempt_started',at:a.startedAt});
      if(a.status==='completed')events.push({...common,type:'attempt_completed',at:a.endedAt,totalMs:a.totalMs,intervalsMs:[...a.intervalsMs]});
      else if(a.status==='interrupted')events.push({...common,type:a.interruptionReason||'interrupted',at:a.detectedAt||a.endedAt,endedAt:a.endedAt,elapsedMs:a.elapsedMs??null,intervalsMs:[...a.intervalsMs],lastObservedAt:a.lastObservedAt??null});
    }
    for(const w of s.workouts.filter(w=>(!athleteId||w.athleteId===athleteId)&&w.attemptIds.length&&w.closeReason==='early_end'))events.push({type:'workout_ended_early',at:w.completedAt,workoutId:w.id,athleteId:w.athleteId});
    return events.sort((a,b)=>(a.at||'').localeCompare(b.at||''));
  }
  function interruptAttempt(s,attemptId,end=iso()){return mutation(s,n=>{const a=attemptOf(n,attemptId);assert(a && a.status==='running','Нет работающей попытки');a.status='interrupted';a.endedAt=end;return a;});}
  const deadline=(w)=> {if(!w || !w.firstStartedAt || !w.firstEndedAt || w.plannedAttempts!==2)return null;return Math.min(Date.parse(w.firstEndedAt)+5*60000,Date.parse(w.firstStartedAt)+10*60000);};
  function closeWorkout(s,workoutId,reason='timeout',at=iso()){return mutation(s,n=>{const w=workoutOf(n,workoutId);assert(w&&w.status!=='completed','Нет открытой тренировки');assert(completed(n,w).length>0,'Нет зачётной попытки');assert(!n.attempts.some(a=>a.workoutId===w.id&&a.status==='running'),'Нельзя прервать работающий секундомер');w.status='completed';w.completedAt=at;w.closeReason=reason;if(n.device.activeWorkoutId===w.id)n.device.activeWorkoutId=null;return w;});}
  function expireSolo(s,now=Date.now()){const w=workoutOf(s,s.device.activeWorkoutId);if(!w||w.kind!=='solo'||w.status==='completed'||completed(s,w).length!==1||!deadline(w)||now<deadline(w))return null;if(s.attempts.some(a=>a.workoutId===w.id&&a.status==='running'))return null;return closeWorkout(s,w.id,'timeout',new Date(now).toISOString());}
  function forceCloseChild(s,now=iso()){return mutation(s,n=>{const c=currentChild(n);assert(c,'Нет активного занятия');for(const wid of c.workoutIds)endWorkoutInPlace(n,workoutOf(n,wid),now);c.status='force_closed';c.closeReason='trainer';c.endedAt=now;n.device.activeChildSessionId=null;n.device.viewAthleteId=c.athleteIds.at(-1);return c;});}
  function recover(s,now=Date.now()){return mutation(s,n=>{for(const a of n.attempts.filter(a=>a.status==='running')){a.status='interrupted';a.endedAt=null;a.detectedAt=new Date(now).toISOString();a.interruptionReason='interruption_detected';}const w=workoutOf(n,n.device.activeWorkoutId);if(w&&w.kind==='solo'&&w.status!=='completed'&&completed(n,w).length===1&&deadline(w)!==null&&now>=deadline(w)){w.status='completed';w.completedAt=new Date(now).toISOString();w.closeReason='timeout';n.device.activeWorkoutId=null;}if(n.device.activeChildSessionId&&!currentChild(n))n.device.activeChildSessionId=null;return true;});}
  function pruneHistoricalSessions(n){
    n.childSessions=n.childSessions.filter(c=>{
      if(c.status==='active')return true;
      const valid=c.workoutIds.filter(id=>n.workouts.some(w=>w.id===id));
      const removed=c.sequence.slice(0,c.nextIndex).filter(t=>!valid.includes(t.workoutId)).length;
      c.sequence=c.sequence.filter(t=>valid.includes(t.workoutId));c.nextIndex-=removed;
      delete c.unavailableWorkoutIds;
      c.workoutIds=valid;c.athleteIds=valid.map(id=>workoutOf(n,id).athleteId);return valid.length;
    });
  }
  function deleteRecord(s,type,entryId,trainer=false){
    return mutation(s,n=>{
      if(type==='athlete'){
        assert(trainer,'Требуется PIN Тренера');
        return deleteProfileInPlace(n,entryId,null);
      }
      const collection={attempt:'attempts',workout:'workouts',archived:'archived',incomplete:'incomplete'}[type];
      assert(collection,'Неизвестный тип записи');
      const entry=n[collection].find(x=>x.id===entryId);
      assert(entry,'Запись не найдена');
      assert(trainer||entry.athleteId===n.baseProfileId,'Доступен только базовый профиль');
      if(type==='attempt'||type==='workout'){
        const w=type==='workout'?entry:workoutOf(n,entry.workoutId);
        assert(!currentChild(n)||!currentChild(n).workoutIds.includes(w.id),'Завершите занятие');
        if(!trainer&&(type==='workout'||entry.status==='completed')){
          assert(w.status==='completed'&&n.device.activeWorkoutId!==w.id,'Сначала завершите тренировку');
        }
        if(type==='attempt'){
          assert(entry.status!=='running','Сначала завершите попытку');
          n.attempts=n.attempts.filter(x=>x.id!==entryId);
          w.attemptIds=w.attemptIds.filter(id=>id!==entryId);
          if(completed(n,w).length){
            if(w.status==='completed')w.closeReason='deleted_attempt';
            return true;
          }
          if(entry.status==='interrupted'&&w.attemptIds.length)return true;
        }
        n.attempts=n.attempts.filter(a=>a.workoutId!==w.id);
        n.workouts=n.workouts.filter(x=>x.id!==w.id);
        if(n.device.activeWorkoutId===w.id)n.device.activeWorkoutId=null;
        pruneHistoricalSessions(n);
        return true;
      }
      n[collection]=n[collection].filter(x=>x.id!==entryId);
      return true;
    });
  }
  function deleteProfileInPlace(n,aid,replacementId){
    assert(n.athletes.length>1,'Нельзя удалить последний профиль');assert(n.athletes.some(a=>a.id===aid),'Нет профиля');
    assert(workoutOf(n,n.device.activeWorkoutId)?.athleteId!==aid&& !currentChild(n)?.athleteIds.includes(aid),'Сначала завершите тренировку или занятие');
    if(n.baseProfileId===aid){assert(replacementId!==aid&&n.athletes.some(a=>a.id===replacementId),'Выберите замену базового профиля');n.baseProfileId=replacementId;}
    n.athletes=n.athletes.filter(a=>a.id!==aid);
    for(const k of ['workouts','attempts','archived','incomplete'])n[k]=n[k].filter(x=>x.athleteId!==aid);
    // Retain other participants' results and project the historical session onto them.
    n.childSessions=n.childSessions.filter(c=>{const removed=c.sequence.slice(0,c.nextIndex).filter(t=>t.athleteId===aid).length;
      c.workoutIds=c.workoutIds.filter((id,i)=>c.athleteIds[i]!==aid);
      if(c.unavailableWorkoutIds){c.unavailableWorkoutIds=c.unavailableWorkoutIds.filter(id=>c.workoutIds.includes(id));if(!c.unavailableWorkoutIds.length)delete c.unavailableWorkoutIds;}
      c.athleteIds=c.athleteIds.filter(id=>id!==aid);
      c.sequence=c.sequence.filter(t=>t.athleteId!==aid);c.nextIndex-=removed;return c.athleteIds.length;});
    n.device.childParticipants=n.device.childParticipants.filter(id=>id!==aid);
    for(const k of ['selectedAthleteId','trainerAthleteId','viewAthleteId'])if(n.device[k]===aid)n.device[k]=n.baseProfileId;
    return true;
  }
  function deleteProfileAndRebase(s,aid,replacementId,authorized=false){assert(authorized,'Требуется PIN Тренера');return mutation(s,n=>deleteProfileInPlace(n,aid,replacementId));}
  function migrateV4(old){assert(old&&[1,2,3,4].includes(old.version),'Некорректный формат v1–v4');const n=blank();n.schemaVersion=5;delete n.baseProfileId;assert(Array.isArray(old.sessions)&&Number.isInteger(old.target),'Некорректный архив');if(old.version===1){n.athletes=[{id:'athlete-default',name:'Спортсмен'}];}else {assert(Array.isArray(old.athletes)&&old.athletes.length>0,'Нет спортсменов');n.athletes=old.athletes.map(a=>({id:a.id,name:a.name}));}n.device.selectedAthleteId=old.selectedAthleteId&&n.athletes.some(a=>a.id===old.selectedAthleteId)?old.selectedAthleteId:n.athletes[0].id;n.device.trainerAthleteId=n.device.selectedAthleteId;n.device.measurementMode=old.mode==='stopwatch'?'stopwatch':'intervals';
    for(const s of old.sessions){assert(s&&Array.isArray(s.exercises)&&s.exercises.length>=1&&s.exercises.length<=2,'Некорректная серия');const athleteId=old.version===1?'athlete-default':s.athleteId;assert(n.athletes.some(a=>a.id===athleteId),'Серия без спортсмена');const count=s.exercises.length,closed=old.version>=4?s.status==='closed':count===2;const wid='legacy-workout:'+s.id;const w={id:wid,athleteId,plannedAttempts:2,kind:'legacy',status:closed?'completed':'legacy_pending',createdAt:s.createdAt,completedAt:closed?s.exercises.at(-1).endedAt:null,closeReason:closed?'legacy':null,attemptIds:[],baselineExistsAtStart:false,firstStartedAt:s.exercises[0].startedAt,firstEndedAt:s.exercises[0].endedAt};for(let i=0;i<count;i++){const ex=s.exercises[i],mode=old.version>=3?ex.mode:'intervals';assert(['intervals','stopwatch'].includes(mode),'Некорректный режим');const intervals=mode==='intervals'?ex.intervals.map(x=>Math.round(x)):[];const total=mode==='intervals'?intervals.reduce((x,y)=>x+y,0):Math.round(ex.totalMs);assert(validMs(total),'Некорректный результат');const aid='legacy-attempt:'+s.id+':'+(i+1);w.attemptIds.push(aid);n.attempts.push({id:aid,athleteId,workoutId:wid,ordinal:i+1,status:'completed',mode,startedAt:ex.startedAt,endedAt:ex.endedAt,totalMs:total,intervalsMs:intervals,targetIntervals:mode==='intervals'?s.target:null,recordEvent:false,previousRecordMs:null});}n.workouts.push(w);}
    n.archived=(old.archived||[]).map(a=>({id:'legacy-archive:'+a.id,athleteId:a.athleteId,date:a.date,bestMs:a.bestMs}));n.incomplete=(old.incomplete||[]).map(a=>({...a,id:'legacy-incomplete:'+a.id}));validateV5(n);return n;}
  function canEditWorkoutComment(s,w,field,trainer=false){
    return w?.status==='completed'&&workoutCommentFields.includes(field)&&
      (trainer||(field==='athleteComment'&&w.athleteId===s.baseProfileId&&['solo','legacy'].includes(w.kind)));
  }
  function saveWorkoutComments(s,workoutId,comments,trainer=false){
    return mutation(s,n=>{
      const w=workoutOf(n,workoutId);
      for(const [field,text] of Object.entries(comments)){
        assert(canEditWorkoutComment(n,w,field,trainer),'Нет доступа к редактированию комментария');
        assert(typeof text==='string','Некорректный комментарий тренировки');
        if(text.trim())w[field]=text.replace(/\r\n?/g,'\n');
        else delete w[field];
      }
      return w;
    });
  }
  function comparableWorkout(w){
    const result={...w};
    for(const field of workoutCommentFields){
      if(!result[field]?.trim())delete result[field];
      else result[field]=result[field].replace(/\r\n?/g,'\n');
    }
    return result;
  }
  const fields=['workouts','attempts','archived','incomplete','childSessions'];
  function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
  const equivalent=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const sorted=xs=>[...xs].sort((a,b)=>a.id.localeCompare(b.id));
  function profileProjection(s,aid){return {profile:s.athletes.find(a=>a.id===aid),...Object.fromEntries(fields.map(k=>[k,sorted(s[k].filter(x=>k==='childSessions'?x.athleteIds.includes(aid):x.athleteId===aid)).map(x=>k==='workouts'?comparableWorkout(x):x)]))};}
  function isPlaceholder(s){return s.athletes.length===1&&s.athletes[0].id==='athlete-default'&&s.athletes[0].name==='Спортсмен'&&fields.every(k=>!s[k].length)&&!s.device.activeWorkoutId&&!s.device.activeChildSessionId;}
  function normalizeImport(raw,baseId){return raw.schemaVersion===6?validate(clone(raw)):migrateV5ToV6(raw.schemaVersion===5?raw:migrateV4(raw),baseId);}
  function selectProfile(s,aid){
    validate(s);
    assert(s.athletes.some(a=>a.id===aid),'Выберите профиль');
    const n=clone(s);
    n.athletes=n.athletes.filter(a=>a.id===aid);
    n.baseProfileId=aid;
    for(const field of ['workouts','attempts','archived','incomplete']){
      n[field]=n[field].filter(x=>x.athleteId===aid);
    }
    n.childSessions=n.childSessions.filter(c=>c.athleteIds.includes(aid)).map(c=>{
      const index=c.athleteIds.indexOf(aid);
      const workoutId=c.workoutIds[index];
      const nextIndex=c.sequence.slice(0,c.nextIndex).filter(t=>t.athleteId===aid).length;
      c.athleteIds=[aid];
      c.workoutIds=[workoutId];
      c.sequence=c.sequence.filter(t=>t.athleteId===aid);
      c.nextIndex=nextIndex;
      if(c.unavailableWorkoutIds)c.unavailableWorkoutIds=c.unavailableWorkoutIds.filter(id=>id===workoutId);
      return c;
    });
    n.device={...n.device,trainerActivated:false,lastInterface:'athlete',
      selectedAthleteId:aid,trainerAthleteId:aid,viewAthleteId:aid,
      activeWorkoutId:n.workouts.some(w=>w.id===n.device.activeWorkoutId)?n.device.activeWorkoutId:null,
      activeChildSessionId:null,childParticipants:[]};
    return validate(n);
  }
  function evaluatePersonalImport(s,raw,aid){
    validate(s);
    assert(!s.device.activeWorkoutId&&!currentChild(s),'Сначала завершите тренировку или занятие');
    const incoming=selectProfile(normalizeImport(raw,aid),aid);
    if(isPlaceholder(s))return evaluateImport(s,incoming,false);
    assert(aid===s.baseProfileId,'Доступен только базовый профиль');
    assert(equivalent(profileProjection(selectProfile(s,aid),aid),profileProjection(incoming,aid)),
      'Конфликт профиля или истории: '+incoming.athletes[0].name);
    return mutation(s,n=>{n.device.trainerActivated=false;return true;});
  }
  function merge(s,imported){validate(s);validate(imported);
    for(const a of imported.athletes)if(s.athletes.some(x=>x.id===a.id))assert(equivalent(profileProjection(s,a.id),profileProjection(imported,a.id)),'Конфликт профиля или истории: '+a.name);
    return mutation(s,n=>{for(const field of ['athletes',...fields]){const existing=new Map(n[field].map(x=>[x.id,x]));for(const x of imported[field]){const old=existing.get(x.id);if(!old)n[field].push(clone(x));else assert(field==='workouts'?equivalent(comparableWorkout(old),comparableWorkout(x)):equivalent(old,x),'Конфликт при импорте: '+x.id);}}return true;});
  }
  function evaluateImport(s,raw,authorized=false,baseId){
    validate(s);assert(!s.device.activeWorkoutId&&!currentChild(s),'Сначала завершите тренировку или занятие');
    const source=raw.schemaVersion?raw:migrateV4(raw);
    // Imported base assignment is never authority; only a fresh multi-profile set needs a choice.
    const fresh=isPlaceholder(s),count=source.athletes?.length;
    assert(authorized||count===1,'Для нескольких профилей требуется PIN Тренера');
    const chosen=fresh?(count===1?source.athletes[0].id:baseId):(source.baseProfileId||source.athletes?.[0]?.id);
    if(fresh&&count>1)assert(baseId&&source.athletes.some(a=>a.id===baseId),'Выберите базовый профиль');
    const incoming=normalizeImport(source,chosen);
    assert(authorized||fresh||incoming.athletes.every(a=>a.id===s.baseProfileId),'Требуется PIN Тренера');
    let r;
    if(fresh){const n=clone(incoming);n.baseProfileId=chosen;n.revision=s.revision+1;n.device={...s.device,selectedAthleteId:chosen,trainerAthleteId:chosen,viewAthleteId:chosen,activeWorkoutId:null,activeChildSessionId:null,childParticipants:[]};r={state:validate(n),value:true};}
    else r=merge(s,incoming);
    r.state.device.trainerActivated=false;return r;
  }
  function renderChartData(s,athleteId){const ws=publicWorkouts(s,athleteId);return ws.map(w=>({id:w.id,when:w.createdAt,ms:best(s,w)}));}
  return {canEditWorkoutComment,saveWorkoutComments,KEY,LEGACY_KEY,V5_KEY,validateV5,migrateV5ToV6,setBaseProfile,deleteProfileAndRebase,normalizeImport,evaluateImport,selectProfile,evaluatePersonalImport,isPlaceholder,profileProjection,equivalent,id,iso,fmt,mins,date,datetime,blank,validate,clone,mutation,addAthlete,renameAthlete,addArchived,newWorkout,startSolo,startChild,startAttempt,finishAttempt,interruptAttempt,closeWorkout,expireSolo,forceCloseChild,recover,checkpointAttempt,cancelAttempt,endWorkout,eventLog,deleteRecord,migrateV4,merge,completed,best,baseline,publicWorkouts,workoutOf,attemptOf,currentChild,nextTurn,deadline,renderChartData};
});
