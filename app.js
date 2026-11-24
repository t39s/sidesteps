(() => {
'use strict';
const M=window.ILModel,$=id=>document.getElementById(id),app=$('app');
let trainerSettingsState=null,savedSettingsBytes=null;
let pendingMigration=null,pendingImport=null,savedBytes=null,storageChanged=false;
let settingsFrom='athlete',settingsDraft=null,restWarningWorkout=null,pendingAttemptVoice=null;
let db=null,config=null,screen='boot',run=null,viewId=null,lastResultId=null,resultUntil=0,trainerUnlocked=false,returnFromHistory='athlete',returnFromPin=null,personalFlashTimer=null,voiceSerial=0,voicePending=0,voiceNow=null,voiceQueue=[],voiceWaiters=[],toastTimeout=null,renderError=null,restBypassedWorkout=null,wakeLock=null;
const expandedLists=new Set();
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=(tag,attrs='',body='')=>`<${tag} ${attrs}>${body}</${tag}>`;
const b=(label,act,cl='',attrs='')=>`<button type="button" class="${cl}" data-act="${act}" ${attrs}>${label}</button>`;
const card=(html,cl='')=>`<section class="panel ${cl}">${html}</section>`;
const muted=text=>`<div class="note">${text}</div>`;
const dateTime=x=>M.datetime(x);
const athlete=id=>db.athletes.find(x=>x.id===id)||{name:'Неизвестный спортсмен'};
const currentAthlete=()=>db.baseProfileId;
const activeSolo=()=>M.workoutOf(db,db.device.activeWorkoutId);
const additionalSolo=()=>activeSolo()&&activeSolo().athleteId!==db.baseProfileId;
const isChild=()=>db.device.lastInterface==='child';
const trainerMode=()=>['child','trainer'].includes(db.device.lastInterface);
const settingsUnavailable=()=>trainerMode()||screen==='pin'||screen==='settings';
const soundAvailable=()=>!renderError&&config?.audioPolicy==='user-controllable';
const sound=()=>soundAvailable()&&db.device.soundEnabled;
function beginSettingsDraft(){
  settingsDraft={history:personalHistoryScreen(settingsFrom), historyDelete:historyDeleteEnabled(),
    planLocked:Boolean(activeSolo()?.firstStartedAt||['result','rest'].includes(settingsFrom)),
    attempts:db.device.soloPlannedAttempts===1?1:2,
    mode:['test-intervals','stopwatch'].includes(db.device.soloMeasurementMode)?db.device.soloMeasurementMode:'intervals',
    animation:db.device.launchAnimation,animationChanged:false};
}
function captureSettingsDraft(){
  if(screen!=='settings'||!settingsDraft)return;
  if(settingsDraft.history){
    const toggle=$('show-history-delete');if(typeof toggle?.checked==='boolean')settingsDraft.historyDelete=toggle.checked;
    return;
  }
  if(settingsDraft.planLocked)return;
  const count=$('attempt-count');if(['1','2'].includes(count?.value))settingsDraft.attempts=Number(count.value);
  const mode=$('mode-select');if(['intervals','test-intervals','stopwatch'].includes(mode?.value))settingsDraft.mode=mode.value;
}
function personalHistoryScreen(target=screen){
  return db.device.lastInterface==='athlete'&&['history','athlete'].includes(target);
}
function boundedList(items,key,{limit=5,total=items.length,attempts=false}={}){
  const expanded=expandedLists.has(key);
  const control=items.length>limit?b(expanded?(attempts?'5 попыток':'5 тренировок'):(attempts?`Все попытки (${total})`:`Все тренировки (${total})`),
    'list-toggle','wide',`data-list-key="${esc(key)}" aria-expanded="${expanded}"`):'';
  return {items:expanded?items:items.slice(0,limit),control};
}
function speakerIcon(enabled){
  const paths=enabled
    ?`<path d="M12 4.5 7.1 8.5H4.7A1.7 1.7 0 0 0 3 10.2v3.6a1.7 1.7 0 0 0 1.7 1.7h2.4l4.9 4z"/>
  <path d="M15.5 8a5.7 5.7 0 0 1 0 8M18.6 4.8c2 2 3 4.5 3 7.2s-1 5.2-3 7.2"/>`
    :`<g transform="translate(3.650 0)">
    <path d="M12 4.5 7.1 8.5H4.7A1.7 1.7 0 0 0 3 10.2v3.6a1.7 1.7 0 0 0 1.7 1.7h2.4l4.9 4z"/>
  </g>
  <path stroke="#ff6868" d="M4.35 4.35 19.65 19.65"/>`;
  return `<svg class="speaker-glyph" viewBox="1 1 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
function soundControl(){
  const enabled=sound();
  return b(speakerIcon(enabled),'toggle-sound','header-icon',`aria-label="Звук" aria-pressed="${enabled}" ${soundAvailable()?'':'disabled'}`);
}
function message(s){const t=$('toast');t.textContent=s;t.style.display='block';clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.style.display='none',4300);}
function fail(e){console.error(e);message(e?.message||String(e));}
function commitState(next){
  if(storageChanged||localStorage.getItem(M.KEY)!==savedBytes)throw Error('Данные изменились в другой вкладке. Перезагрузите приложение.');
  M.validate(next);const bytes=JSON.stringify(next);localStorage.setItem(M.KEY,bytes);
  if(localStorage.getItem(M.KEY)!==bytes)throw Error('Не удалось подтвердить сохранение');
  savedBytes=bytes;db=next;
}
function operate(action){if(pendingMigration||renderError)throw Error('Сначала завершите открытие данных');const r=action(db);commitState(r.state);return r.value;}
function change(f){return operate(s=>M.mutation(s,f));}
function resetVoice(){pendingAttemptVoice=null;voiceSerial++;voiceQueue=[];voiceNow=null;voicePending=0;try{if('speechSynthesis'in window)speechSynthesis.cancel();}catch(e){}voiceWaiters.splice(0).forEach(f=>f());}
function speechDone(){return voicePending===0?Promise.resolve():new Promise(r=>voiceWaiters.push(r));}
function updateSpeechWaiters(){if(voicePending===0)voiceWaiters.splice(0).forEach(f=>f());}
function queueVoice(text){if(!sound()||!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return;const token=voiceSerial;voicePending++;voiceQueue.push({text,token});if(!voiceNow)drainSpeech();}
function drainSpeech(){if(voiceNow||!voiceQueue.length){updateSpeechWaiters();return;}const next=voiceQueue.shift();if(next.token!==voiceSerial){voicePending--;drainSpeech();return;}voiceNow=next;let finished=false;const u=new SpeechSynthesisUtterance(next.text);u.lang='ru-RU';u.rate=.95;const timer=setTimeout(done,8500);function done(){if(finished)return;finished=true;clearTimeout(timer);if(next.token!==voiceSerial)return;voiceNow=null;voicePending=Math.max(0,voicePending-1);updateSpeechWaiters();drainSpeech();}u.onend=done;u.onerror=done;try{if(speechSynthesis.paused)speechSynthesis.resume();speechSynthesis.speak(u);}catch(e){done();}}
async function acquireWakeLock(){if(!run||!navigator.wakeLock)return;try{wakeLock=await navigator.wakeLock.request('screen');}catch(e){}}
async function releaseWakeLock(){const w=wakeLock;wakeLock=null;if(w)try{await w.release();}catch(e){}}
const russianPlural=new Intl.PluralRules('ru');
const secondForms={one:'секунда',few:'секунды',many:'секунд',other:'секунды'};
function elapsedSeconds(ms,personal){
  const step=personal?100:10;
  return (Math.floor(Math.max(0,ms)/step)*step/1000).toFixed(personal?1:2).replace('.',',');
}
function sayAttempt(a){
  const seconds=Number((a.totalMs/1000).toFixed(1));
  const unit=secondForms[russianPlural.select(seconds)];
  queueVoice(`${String(seconds).replace('.',',')} ${unit}`);
  if(isRecord(a))queueVoice('Новый рекорд!');
}
function validateConfig(c){if(!c||c.minTapGapMs!==500)throw Error('minTapGapMs: требуется 500 мс');M.defaultTrainerSettings(c,false);if(!Number.isSafeInteger(c.attemptCancelWindowSec)||c.attemptCancelWindowSec<1||c.attemptCancelWindowSec>60)throw Error('attemptCancelWindowSec: целое 1–60');if(!Number.isSafeInteger(c.restDurationSec)||c.restDurationSec<0||c.restDurationSec>600)throw Error('restDurationSec: целое 0–600');if(![5,10,15].includes(c.resultDisplaySec))throw Error('resultDisplaySec: 5, 10 или 15');if(![5,10,15].includes(c.recordDisplaySec))throw Error('recordDisplaySec: 5, 10 или 15');if(!['off','user-controllable'].includes(c.audioPolicy))throw Error('audioPolicy: off или user-controllable');if(c.trainerAccess!==null&&c.trainerAccess!==undefined){let p=c.trainerAccess;if(p.algorithm!=='PBKDF2-SHA256'||!Number.isInteger(p.iterations)||p.iterations<100000||p.iterations>1000000||!p.saltB64||!p.verifierB64)throw Error('Недопустимый verifier PIN');}return c;}
function trainerSettings(){return trainerSettingsState||M.defaultTrainerSettings(config,false);}
function writeTrainerSettings(next){
  M.validateTrainerSettings(next);
  if(storageChanged||localStorage.getItem(M.SETTINGS_KEY)!==savedSettingsBytes)throw Error('Настройки изменены в другой вкладке. Перезагрузите приложение.');
  const bytes=JSON.stringify(next);localStorage.setItem(M.SETTINGS_KEY,bytes);
  if(localStorage.getItem(M.SETTINGS_KEY)!==bytes)throw Error('Не удалось подтвердить сохранение настроек');
  savedSettingsBytes=bytes;trainerSettingsState=next;
}
function initTrainerSettings(existing){
  savedSettingsBytes=localStorage.getItem(M.SETTINGS_KEY);
  trainerSettingsState=savedSettingsBytes?M.validateTrainerSettings(JSON.parse(savedSettingsBytes)):M.defaultTrainerSettings(config,existing);
  if(!savedSettingsBytes)writeTrainerSettings(trainerSettingsState);
}
function historySettingsKey(){
  return db.device.lastInterface==='trainer'?'showTrainerHistoryDelete':'showAthleteHistoryDelete';
}
function historyDeleteEnabled(){return trainerSettings()[historySettingsKey()]===true;}
function managedHistoryAthlete(){
  if(db.device.lastInterface==='athlete'&&['athlete','history'].includes(screen))return currentAthlete();
  if(db.device.lastInterface==='trainer'&&trainerUnlocked&&screen==='history')return trainerHistoryAthlete();
  return null;
}
function trainerHistoryAthlete(){
  return db.athletes.some(a=>a.id===db.device.viewAthleteId)?db.device.viewAthleteId:db.athletes[0].id;
}
function historyDeletionSettings(checked=historyDeleteEnabled()){
  return card('<h2>История</h2><label class="statistics-option"><input id="show-history-delete" type="checkbox" role="switch" '+(checked?'checked':'')+'>Показывать кнопки удаления в Истории</label>');
}
function historyDeleteButton(action,id,label='Удалить тренировку'){
  return b(label,action,'danger small',`data-id="${esc(id)}"`);
}
function workoutDeleteButton(workout){
  return historyDeleteButton('delete-workout',workout.id);
}
function lockWorkingCount(plan){
  if(plan.purpose!=='working')return;
  if(!trainerSettings().workingCountLocked)writeTrainerSettings({...trainerSettings(),workingCountLocked:true});
}
function selectedPlan(){return M.measurementPlan(soloMeasurementMode(),trainerSettings());}
function activePlan(w=currentTrainingWorkout()){
  return w?M.workoutPlan(db,w,trainerSettings()):selectedPlan();
}
function testNotice(plan){return plan.purpose==='test'?'<p class="note center test-mode">Тестовый режим · результат сохранится в архив</p>':'';}
function includeArchiveStats(){return trainerSettings().includeArchiveStats===true;}
function statsBest(workout){return includeArchiveStats()?M.best(db,workout):M.workingBest(db,workout);}
function statsPoints(aid){return M.renderChartData(db,aid,includeArchiveStats());}
function statsNote(){return '<p class="note statistics-scope">'+(includeArchiveStats()?'Рабочие, тестовые и архивные данные':'Только рабочие данные')+' · среднее по лучшим попыткам тренировок</p>';}
function isRecord(a){return M.recordInfo(db,a,includeArchiveStats()).recordEvent;}
function permanentTrainerSettings(){
  const t=trainerSettings();
  return card('<h2>Постоянные настройки</h2>'+ (t.workingCountLocked
    ?'<p>Рабочее число отсечек: <strong>'+t.workingIntervalCount+'</strong> · зафиксировано</p>'
    :'<label>Рабочее число отсечек<input id="working-count" type="number" min="1" max="200" value="'+t.workingIntervalCount+'"></label><p class="note">Выбирается один раз. После сохранения или начала тренировки изменить нельзя.</p>')+
    '<label>Тестовое число отсечек<input id="test-count" type="number" min="1" max="200" value="'+t.testIntervalCount+'"></label>'+
    '<label>Отдых рабочего режима, секунд<input id="work-rest" type="number" min="0" max="600" value="'+t.workRestDurationSec+'"></label>'+
    '<label>Отдых тестовых режимов, секунд<input id="test-rest" type="number" min="0" max="600" value="'+t.testRestDurationSec+'"></label>'+
    '<label class="statistics-option"><input id="include-archive-stats" type="checkbox" '+(t.includeArchiveStats===true?'checked':'')+'>Учитывать тестовые и архивные данные</label>'+
    '<p class="note">Пересчитывает рекорд, среднее и графики для всех профилей в обоих интерфейсах. Исходные результаты сохраняются.</p>'+
    '<p class="note">Для всех профилей устройства. Число отсечек и отдых действуют на новые тренировки. Настройки не входят в выгрузку данных.</p>'+b('Сохранить настройки','save-trainer-settings','primary wide'));
}
async function pinMatches(pin){if(!config.trainerAccess)return false;const p=config.trainerAccess;const bytes=str=>Uint8Array.from(atob(str),c=>c.charCodeAt(0));const enc=new TextEncoder().encode(pin);const key=await crypto.subtle.importKey('raw',enc,'PBKDF2',false,['deriveBits']);const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(p.saltB64),iterations:p.iterations,hash:'SHA-256'},key,256));const expected=bytes(p.verifierB64);if(bits.length!==expected.length)return false;let diff=0;for(let i=0;i<bits.length;i++)diff|=bits[i]^expected[i];return diff===0;}
async function init(){if(M.KEY!=='interval-lab:data:v6'||!M.migrateV5ToV6){db=M.blank();renderError='Несовместимый кэш приложения. Подключитесь к сети и перезагрузите страницу.';render();return;}let recoveredTimeoutId=null;try{let response=await fetch('./config.json',{cache:'no-store'});if(!response.ok)throw Error('Не удалось загрузить config.json');config=validateConfig(await response.json());}catch(e){renderError=e.message;}
  try{
    const migration=localStorage.getItem(M.KEY)||localStorage.getItem(M.V5_KEY)?{}:window.SideMigration.run(localStorage,M);
    if(migration.blocked)throw Error('Найдена история Interval Lab. Для выбора одного спортсмена откройте https://t39s.github.io/dev-sandbox/interval-lab/ и выполните перенос оттуда.');
    const current=localStorage.getItem(M.KEY);
    const existing=!!(current||localStorage.getItem(M.V5_KEY)||localStorage.getItem(M.LEGACY_KEY));
    if(current)db=M.validate(JSON.parse(current));
    else{
      const old=localStorage.getItem(M.V5_KEY);
      if(old){const source=M.validateV5(JSON.parse(old));if(source.athletes.length>1){pendingMigration={source,bytes:old};db=M.blank();screen='migration';render();return;}
        db=M.migrateV5ToV6(source);commitState(db);
      }else{db=M.blank();commitState(db);}
    }
    if(current)savedBytes=current;
    if(!renderError)initTrainerSettings(existing);
    const formerId=db.device.activeWorkoutId;
    const recovered=M.recover(db);
    const startup=M.mutation(recovered.state,state=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(state.device.launchAnimationFirstDay||''))state.device.launchAnimationFirstDay=localDay();
      state.device.trainerActivated=false;state.device.selectedAthleteId=state.baseProfileId;
      state.device.soundEnabled=false;
      state.device.soloPlannedAttempts=2;
      state.device.soloMeasurementMode='intervals';
      state.device.trainerMeasurementSelection='intervals';
      // The active workout keeps its measurement mode across recovery.
      if(!state.device.activeWorkoutId&&!M.currentChild(state))state.device.measurementMode='intervals';
    });
    commitState(startup.state);
    const former=M.workoutOf(db,formerId);
    if(former&&former.status==='completed'&&former.closeReason==='timeout')recoveredTimeoutId=former.id;
  }catch(e){renderError='Не удалось открыть историю: '+e.message+'. Данные не перезаписаны.';db=M.blank();}
  if(!renderError){if(db.device.lastInterface==='trainer'||(M.workoutOf(db,db.device.activeWorkoutId)?.athleteId&&M.workoutOf(db,db.device.activeWorkoutId).athleteId!==db.baseProfileId&&!M.currentChild(db))){screen='pin';}else if(db.device.lastInterface==='child'){const c=M.currentChild(db),turn=M.nextTurn(db),w=M.workoutOf(db,turn?.workoutId);screen=c?'child-ready':'child-final';if(c?.athleteIds.length===1 && turn?.ordinal===2 && w?.firstEndedAt && remainingRest(w)>0)screen='rest';if(!db.device.childParticipants.length)screen='athlete';}else{const w=M.workoutOf(db,db.device.activeWorkoutId);if(w&&w.status!=='completed'){screen=M.completed(db,w).length?'rest':'athlete-ready';}else screen='athlete';}if(recoveredTimeoutId&&db.device.lastInterface==='athlete'&&M.workoutOf(db,recoveredTimeoutId).athleteId===db.baseProfileId){viewId=recoveredTimeoutId;screen='final';}}
  render();if(recoveredTimeoutId&&screen==='final')message('Тренировка завершена. Сохранён результат первой попытки.');setInterval(tick,80);if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
function trainingContext(){
  let current=screen;
  if(current==='pin')current=returnFromPin;
  if(current==='settings')current=settingsFrom;
  return current;
}
function trainingScreen(){
  const current=trainingContext();
  return !renderError&&(['athlete-ready','child-ready','result','rest'].includes(current)||(db.device.lastInterface==='trainer'&&trainerUnlocked&&M.currentChild(db)));
}
function currentTrainingWorkout(){
  if(run)return M.workoutOf(db,M.attemptOf(db,run.id)?.workoutId);
  if(trainingContext()==='result')return M.workoutOf(db,M.attemptOf(db,lastResultId)?.workoutId);
  const c=M.currentChild(db);
  return M.workoutOf(db,c?M.nextTurn(db)?.workoutId:db.device.activeWorkoutId);
}
function cancelLaunchAvailable(){return !!run&&performance.now()-run.start<config.attemptCancelWindowSec*1000;}
function partialMeasurement(){return {elapsedMs:Math.max(0,Math.floor(performance.now()-run.start),run.intervals.reduce((x,y)=>x+y,0)),intervalsMs:[...run.intervals]};}
function header(context='',actions='',homeLink=false,belowBrand='',showControls=true){
  const gear=`<svg class="gear-glyph" viewBox="1 1 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9.99 4.98
      L10.25 3.78 L10.26 2.15 A10 10 0 0 1 13.74 2.15 L13.75 3.78 L14.01 4.98 A7.3 7.3 0 0 1 16.23 6.05
      L17.33 5.51 L18.62 4.50 A10 10 0 0 1 20.78 7.22 L19.51 8.24 L18.74 9.20 A7.3 7.3 0 0 1 19.29 11.60
      L20.40 12.13 L21.99 12.50 A10 10 0 0 1 21.21 15.88 L19.62 15.53 L18.39 15.52 A7.3 7.3 0 0 1 16.86 17.45
      L17.14 18.64 L17.84 20.12 A10 10 0 0 1 14.71 21.63 L13.99 20.16 L13.23 19.20 A7.3 7.3 0 0 1 10.77 19.20
      L10.01 20.16 L9.29 21.63 A10 10 0 0 1 6.16 20.12 L6.86 18.64 L7.14 17.45 A7.3 7.3 0 0 1 5.61 15.52
      L4.38 15.53 L2.79 15.88 A10 10 0 0 1 2.01 12.50 L3.60 12.13 L4.71 11.60 A7.3 7.3 0 0 1 5.26 9.20
      L4.49 8.24 L3.22 7.22 A10 10 0 0 1 5.38 4.50 L6.67 5.51 L7.77 6.05 A7.3 7.3 0 0 1 9.99 4.98 Z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;
  const settingsButton=screen==='settings'||screen==='data-exchange'?'':settingsUnavailable()
    ?b(gear,'settings','header-icon settings-icon','aria-label="Настройки" disabled')
    :b(gear,'settings','header-icon settings-icon','aria-label="Настройки"');
  const close=screen!=='settings'&&trainingScreen()?`<span class="header-icon-slot">${b('<svg class="close-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg>','end-training','header-icon close-training','aria-label="Завершить тренировку" title="Завершить тренировку"')}</span>`:'';
  const controls=showControls?`<div class="toolbar header-controls${close?' training-controls':''}"><span class="header-icon-slot">${soundControl()}</span>${settingsButton?`<span class="header-icon-slot">${settingsButton}</span>`:''}${close}</div>` : '';
  if(!renderError&&trainerUnlocked&&db.device.lastInterface!=='trainer'&&screen!=='pin'){
    belowBrand='<a href="#trainer" data-act="return-trainer" class="mode-tag header-login">К управлению занятием</a>';
  }
  if(!belowBrand&&db.device.lastInterface==='child'&&screen!=='pin'&&!(screen==='settings'&&settingsFrom==='pin'))belowBrand='<a href="#admin-login" data-act="pin" class="mode-tag header-login">Интерфейс тренера</a>';
  const label='Приставные шаги<br>на время';
  const brand=homeLink?`<a class="brand brand-home" href="./" data-act="final-home">${label}</a>`:`<div class="brand">${label}</div>`;
  return `<header class="app-head"><div>${brand}${context?`<div class="mode-tag">${esc(context)}</div>`:''}${belowBrand}</div>${controls}${actions?`<div class="toolbar header-actions">${actions}</div>`:''}</header>`;
}
function row(label,value){return `<div class="list-row"><span>${label}</span><strong>${value}</strong></div>`;}
function soloPlannedAttempts(){return screen==='settings'&&settingsDraft?settingsDraft.attempts:db.device.soloPlannedAttempts===1?1:2;}
function soloMeasurementMode(){return screen==='settings'&&settingsDraft?settingsDraft.mode:['test-intervals','stopwatch'].includes(db.device.soloMeasurementMode)?db.device.soloMeasurementMode:'intervals';}
function chooseAttempts(count=2){return `<label for="attempt-count">Попыток в тренировке</label><select id="attempt-count"><option value="2" ${count===2?'selected':''}>2 попытки (по умолчанию)</option><option value="1" ${count===1?'selected':''}>1 попытка</option></select>`;}
function chooseMode(mode=db.device.trainerMeasurementSelection||db.device.measurementMode){
  const t=trainerSettings();
  return `<label for="mode-select">Режим измерения</label><select id="mode-select">
    <option value="intervals" ${mode==='intervals'?'selected':''}>${intervalCountLabel(t.workingIntervalCount)}</option>
    <option value="test-intervals" ${mode==='test-intervals'?'selected':''}>${intervalCountLabel(t.testIntervalCount)} — тест</option>
    <option value="stopwatch" ${mode==='stopwatch'?'selected':''}>Старт–Стоп — тест</option></select>`;
}
function intervalCountLabel(count){
  const last=count%10;
  const teens=count%100>=11&&count%100<=14;
  const noun=teens?'отсечек':last===1?'отсечка':last>=2&&last<=4?'отсечки':'отсечек';
  return `${count} ${noun}`;
}
function adultHome(){
  return header()+`<div class="athlete-tabs" role="tablist" aria-label="Разделы приложения">
    <button type="button" role="tab" id="athlete-tab-history" aria-controls="athlete-panel-history" aria-selected="true" tabindex="0">История</button>
    <button type="button" role="tab" id="athlete-tab-exercise" aria-selected="false" tabindex="-1" data-act="open-exercise">Новая тренировка</button>
  </div>
  <section id="athlete-panel-history" role="tabpanel" aria-labelledby="athlete-tab-history" tabindex="0">
    ${historyContent(currentAthlete())}
    ${legacyResumeChoices()}
  </section>`;
}
function legacyResumeChoices(){const ids=[currentAthlete()];const pending=db.workouts.filter(w=>ids.includes(w.athleteId)&&w.status==='legacy_pending');return pending.length?card('<h2>Ранее незавершённые тренировки</h2>'+pending.map(w=>'<div class="list-row"><span>'+esc(M.datetime(w.createdAt))+'</span>'+b('Продолжить','resume-legacy','small',`data-id="${esc(w.id)}"`)+'</div>').join('')):'';}
function remainingRest(w){return Math.max(0,Date.parse(w.firstEndedAt)+activePlan(w).restDurationSec*1000-Date.now());}
function soloReady(){
  const workout=M.workoutOf(db,db.device.activeWorkoutId);
  const attempt=workout?M.completed(db,workout).length+1:1;
  const count=workout?.plannedAttempts??soloPlannedAttempts();
  const plan=activePlan(workout);
  const mode=plan.mode;
  return header()+
    card(`<h1 class="hero-title center">Попытка ${attempt} из ${count}</h1>`)+
    testNotice(plan)+measureSurface(true,mode);
}
function localDay(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function launchAnimation(){
  const chosen=screen==='settings'&&settingsDraft?settingsDraft.animation:db.device.launchAnimation;
  if(['glow','pulse','none'].includes(chosen))return chosen;
  return localDay()>(db.device.launchAnimationFirstDay||localDay())?'glow':'pulse';
}
function refreshLaunchAnimation(){
  const selected=launchAnimation(),glyph=app.querySelector('[data-launch-animation]');
  const className='counter counter-ready launch-'+selected;
  if(glyph&&glyph.className!==className)glyph.className=className;
  for(const input of app.querySelectorAll?.('input[name="launch-animation"]')||[])input.checked=input.value===selected;
}
function measureSurface(personal=false,mode=activePlan().mode){
  const running=!!run,intervals=running?run.intervals.length:0;
  const sec=elapsedSeconds(running?performance.now()-run.start:0,true);
  const play=`<div class="counter counter-ready launch-${launchAnimation()}" data-launch-animation aria-hidden="true"><span class="play-glyph"></span></div>`;
  const counter=!running?play:mode==='intervals'
    ?`<div class="counter" data-digits="${String(intervals).length}">${intervals}</div>`
    :`<div class="stopwatch-counter" data-elapsed>${sec} с</div>`;
  return `<div class="tap-surface personal-measure" data-tap="1" role="button" tabindex="0" aria-label="${running?(mode==='intervals'?'Отсечка или стоп':'Остановить измерение'):'Начать измерение'}">${counter}${mode==='intervals'?`<div class="secondary-display">${intervals} / ${run?run.target:activePlan().targetIntervals} интервалов</div>`:''}${mode==='intervals'||!running?`<div class="secondary-display" data-elapsed>${sec} с</div>`:''}</div>${cancelLaunchAvailable()?`<div class="buttons" data-cancel-launch>${b('Отменить запуск','cancel-launch','wide')}</div>`:''}`;
}

function childReady(){const c=M.currentChild(db);if(!c)return childFinal();const turn=M.nextTurn(db);if(!turn)return childFinal();const w=M.workoutOf(db,turn.workoutId);if(c.athleteIds.length===1&&turn.ordinal===2&&w?.firstEndedAt&&config){const restLeft=remainingRest(w);if(restLeft>0&&restBypassedWorkout!==w.id)return restScreen(true,w);}
  return header()+card(`<h1 class="hero-title center">Попытка ${turn.ordinal} из ${c.plannedAttempts}</h1><div class="center muted participant-name">${esc(athlete(turn.athleteId).name)}</div>`)+testNotice(activePlan(w))+measureSurface(true,activePlan(w).mode);
}

function personalRestCard(workout,compact=false){
  return card(`<div class="personal-rest-time">
    ${compact?'<div class="hero-title center" role="heading" aria-level="2">Отдых</div>':''}
    <div class="display" data-rest-clock>${M.mins(remainingRest(workout))}</div>
  </div>${b('Начать раньше','rest-early','primary wide')}`,compact?'personal-rest half-attempt':'personal-rest');
}
function resultScreen(){
  const a=M.attemptOf(db,lastResultId);
  if(!a)return screen==='result'?(isChild()?childReady():soloReady()):'';
  // Start perception time on the first actual display, including return from navigation.
  if(resultUntil===null){
    const duration=isRecord(a)?config.recordDisplaySec:config.resultDisplaySec;
    resultUntil=Date.now()+duration*1000;
  }
  const w=M.workoutOf(db,a.workoutId),c=M.currentChild(db);
  const rests=w.status==='pending'&&w.plannedAttempts===2;
  const participant=isChild()?`<div class="center muted participant-name">${esc(athlete(a.athleteId).name)}</div>`:'';
  const title=card(`<h1 class="hero-title center">Попытка ${a.ordinal}</h1>${participant}`);
  const result=card(`<div class="display">${M.fmt(a.totalMs)}</div>${isRecord(a)?'<div class="record">★ Новый рекорд!</div>':''}${M.isWorkingAttempt(db,a)?'':'<div class="note">Тестовый результат · сохранён в архив</div>'}`,'attempt-result half-attempt');
  const paired=c?.athleteIds.length===2;
  return header()+title+result+(paired?card('<div class="center muted">Следующий участник появится автоматически</div>'):rests?personalRestCard(w,true):'');
}
function restScreen(child,w){
  if(!w)return adultHome();
  return header()+card(`<h1 class="hero-title center">Отдых</h1>${child?`<div class="center muted participant-name">${esc(athlete(w.athleteId).name)}</div>`:''}`)+personalRestCard(w);
}

function latestChildSession(){const candidates=db.childSessions.filter(c=>c.status!=='active');return candidates.at(-1)||null;}
function athleteTabs(ids,selected,action){
  return `<div class="athlete-tabs participant-tabs" role="tablist" aria-label="Спортсмены">${ids.map(id=>`<button type="button" role="tab" id="profile-tab-${esc(id)}" aria-controls="profile-panel" aria-selected="${id===selected}" tabindex="${id===selected?0:-1}" data-act="${action}" data-id="${esc(id)}">${esc(athlete(id).name)}</button>`).join('')}</div>`;
}
function profilePanel(aid,html){return `<section id="profile-panel" role="tabpanel" aria-labelledby="profile-tab-${esc(aid)}" tabindex="0">${html}</section>`;}
function childFinal(){
  if(M.currentChild(db))return childReady();
  const allowed=db.device.childParticipants;
  if(!allowed.length)return header()+card('<h2>Сеанс не выбран</h2><p>Тренер должен выбрать участника.</p>');
  const aid=allowed.includes(db.device.viewAthleteId)?db.device.viewAthleteId:allowed.at(-1);
  const session=latestChildSession();
  const workout=session?.workoutIds.map(id=>M.workoutOf(db,id)).find(w=>w?.athleteId===aid);
  const summary=workout&&M.completed(db,workout).length?card(workoutSummary(aid,workout)+workoutDetails(workout,M.best(db,workout),true)):card('<p class="note">Сохранённых результатов этой тренировки нет.</p>');
  return header('','',false,'<a href="#admin-login" data-act="pin" class="mode-tag header-login">Интерфейс тренера</a>')+card('<h1 class="hero-title center">Тренировка завершена</h1>')+
    athleteTabs(allowed,aid,'child-view')+profilePanel(aid,
      summary+(workout&&(includeArchiveStats()?M.completed(db,workout):M.workingCompleted(db,workout)).length?card('<h2>Мой прогресс</h2>'+statsNote()+graphic(statsPoints(aid),false,recordAsOf(aid))):''))+
    `<div class="buttons">${b('История','history-child','wide nav-return')}</div>`;
}

function finalAdult(){
  const workout=M.workoutOf(db,viewId);
  if(!workout)return adultHome();
  const summary=workoutSummary(workout.athleteId,workout);
  const points=statsPoints(workout.athleteId);
  return header('','',true)+card('<h1 class="hero-title center">Тренировка завершена</h1>')+
    card(summary+workoutDetails(workout,M.best(db,workout),true))+
    ((includeArchiveStats()?M.completed(db,workout):M.workingCompleted(db,workout)).length?card('<h2>Мой прогресс</h2>'+statsNote()+graphic(points,false,recordAsOf(workout.athleteId))):'')+
    `<div class="buttons">${b('На главную','final-home','wide nav-return')}</div>`;
}
function initializeProgressScroll(){
  const plot=app.querySelector('.chart-scrollable:not([data-positioned])');
  if(!plot?.clientWidth)return;
  plot.scrollLeft=plot.scrollWidth;
  plot.dataset.positioned='true';
}
function graphic(points,scrollable=false,highlightMs=undefined){
  if(!points.length)return muted('Пока нет завершённых тренировок.');
  const visible=points.slice(scrollable?-100:-5);
  const average=scrollable?points.reduce((mean,p,i)=>mean+(p.ms-mean)/(i+1),0):null;
  const max=Math.max(average??0,...visible.map(p=>p.ms));
  const hi=Math.max(1000,Math.ceil(max*1.13/1000)*1000);
  const H=208,left=scrollable?0:40,right=8,top=21,bottom=37;
  const slot=scrollable?76:(300-left-right)/5;
  const W=scrollable?visible.length*slot+right:300;
  const floor=H-bottom,plot=H-top-bottom;
  const y=ms=>floor-(ms/hi)*plot;
  const best=highlightMs===undefined?Math.min(...visible.map(p=>p.ms)):highlightMs;
  const ticks=[0,.25,.5,.75,1].map(fr=>({
    y:y(hi*fr),
    label:(hi*fr/1000).toFixed(hi<20000?1:0).replace('.',',')
  }));
  const lines=ticks.map(tick=>`<line x1="${left}" y1="${tick.y}" x2="${W-right}" y2="${tick.y}" stroke="#38536b" stroke-width=".7"/>`).join('');
  const labels=ticks.map(tick=>`<text x="35" y="${tick.y+3}" text-anchor="end" class="svg-txt">${tick.label}</text>`).join('')+'<text x="8" y="12" class="svg-txt">с</text>';
  const bars=visible.map((p,i)=>{const x=left+slot*(i+.5),w=slot*.63,yy=y(p.ms),color=p.ms===best?'#ffd166':'#83def3';const label=(p.ms/1000).toFixed(1).replace('.',',');return `<g class="chart-bar"><title>${esc(p.dateOnly?p.when:M.datetime(p.when))}: ${esc(M.fmt(p.ms))}</title><rect x="${x-w/2}" y="${yy}" width="${w}" height="${Math.max(.8,floor-yy)}" rx="3" fill="${color}"/><text x="${x}" y="${Math.max(top+3,yy-5)}" text-anchor="middle" class="chart-value">${label}</text><text x="${x}" y="${H-15}" text-anchor="middle" class="chart-date">${esc(M.date(p.when))}</text></g>`;}).join('');
  const averageLine=average===null?'':`<line class="chart-average" x1="${left}" y1="${y(average)}" x2="${W-right}" y2="${y(average)}" stroke="#ffd166" stroke-width="1.4"><title>Среднее по всем тренировкам: ${esc(M.fmt(Math.round(average)))}</title></line>`;
  const chart=`<svg class="chart"${scrollable?` style="width:${W}px"`:''} viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Столбчатый график последних ${visible.length} завершённых тренировок, в секундах, ось от нуля${average===null?'':`, среднее по всем тренировкам ${esc(M.fmt(Math.round(average)))}`}">${lines}${averageLine}${bars}${scrollable?'':labels}</svg>`;
  if(scrollable)return `<div class="history-chart"><svg class="history-chart-axis" viewBox="0 0 40 ${H}" aria-hidden="true">${labels}</svg><div class="chart-scrollable" tabindex="0" role="region" aria-label="Диаграмма прогресса">${chart}</div></div>`;
  return `<div class="chart-wrap">${chart}</div>`;
}
function recordAsOf(athleteId){return M.baseline(db,athleteId,null,includeArchiveStats());}
function workoutSummary(athleteId,workout,heading=false){
  const workouts=M.publicWorkouts(db,athleteId);
  const record=recordAsOf(athleteId);
  const attempts=workout?M.completed(db,workout):[];
  const best=workout?(statsBest(workout)??M.best(db,workout)):null;
  const working=includeArchiveStats()||attempts.some(a=>M.isWorkingAttempt(db,a));
  const improvements=attempts.map(a=>({...a,...M.recordInfo(db,a,includeArchiveStats())})).filter(a=>a.recordEvent);
  const subtitle=workout?`Тренировка ${esc(M.datetime(workout.createdAt))}`:'Пока нет тренировок';
  const firstOnly=(includeArchiveStats()?statsPoints(athleteId).length:workouts.length)===1;
  const title=heading?`<h2>${subtitle}</h2>`:`<div class="muted">${subtitle}</div>`;
  if(workout&&!working)return `${title}<p class="note">${archiveSource(workout)} · сохранено в архив</p>${best!==null?row('Лучшее время',M.fmt(best)):''}`;
  return `${title}${best!==null&&best!==undefined?`<div class="metric"><span>Лучшее время</span><strong>${recordTime(best,athleteId,attempts.some(a=>isRecord(a)))}</strong></div>`:''}${attempts.some(a=>isRecord(a))?'<div class="record">★ Новый рекорд!</div>':''}${improvements.length?`<div class="note">Улучшение на ${M.fmt(Math.max(...improvements.map(a=>a.previousRecordMs-a.totalMs)))}</div>`:''}${record!==null?row(firstOnly?'Исходный результат':'Рекорд',M.fmt(record)):''}`;
}
function progress(athleteId,canDelete){
  const last=M.publicWorkouts(db,athleteId).at(-1);
  const points=statsPoints(athleteId);
  const summary=workoutSummary(athleteId,last,true);
  const chart=card('<h2>Мой прогресс</h2>'+statsNote()+graphic(points,true));
  const latest=card(last?`<div data-history-workout="${esc(last.id)}">${summary}${workoutDetails(last,statsBest(last),true,true,false,canDelete)}${canDelete?workoutDeleteButton(last):''}</div>`:summary);
  return (db.device.lastInterface==='athlete'?chart+latest:latest+chart)+card(historyItems(athleteId,canDelete))+archiveHistory(athleteId,canDelete);
}

function intervalDetails(a,sharedMax){if(a.mode!=='intervals'||!a.intervalsMs?.length)return '';const max=sharedMax??Math.max(...a.intervalsMs);return `<details><summary>Время каждого интервала (${a.intervalsMs.length})</summary><div class="stack">${a.intervalsMs.map((ms,i)=>`<div><div class="row between small"><span>Интервал ${i+1}</span><strong>${M.fmt(ms)}</strong></div><div style="height:8px;border-radius:4px;background:#0e2033;overflow:hidden"><div style="height:100%;background:#83def3;width:${(ms/Math.max(1,max)*100).toFixed(1)}%"></div></div></div>`).join('')}</div></details>`;}
function recordTime(ms,athleteId,wasRecord=false){
  const current=ms===recordAsOf(athleteId);
  return current||wasRecord
    ?`<span class="record">${M.fmt(ms)} <span aria-label="${current?'Личный рекорд':'Рекорд на момент попытки'}">★</span></span>`
    :M.fmt(ms);
}
function workoutComments(workout,editable){
  if(!trainerUnlocked){
    const visible=isChild()
      ?db.device.childParticipants.includes(workout.athleteId)&&latestChildSession()?.workoutIds.includes(workout.id)
      :workout.athleteId===db.baseProfileId;
    if(!visible)return '';
  }
  if(workout.status!=='completed')return '';
  const fields=[['athleteComment',db.device.lastInterface==='athlete'?'Комментарии':'Комментарий спортсмена'],['trainerComment','Комментарий тренера']];
  const canEdit=field=>editable&&M.canEditWorkoutComment(db,workout,field,trainerUnlocked)&&
    (trainerUnlocked||!isChild());
  const content=fields.map(([field,label])=>{
    const value=workout[field]??'';
    if(canEdit(field))return `<label>${label}<textarea name="${field}" rows="2">\n${esc(value)}</textarea></label>`;
    return value?`<p><span class="note">${label}</span><br><span class="comment-text">${esc(value)}</span></p>`:'';
  }).join('');
  return fields.some(([field])=>canEdit(field))
    ?`<form class="workout-comments" data-workout-id="${esc(workout.id)}">${content}<div class="buttons"><button type="submit" class="small">Сохранить комментарии</button></div></form>`:content;
}
function workoutDetails(workout,best,sharedScale,editable=false,archiveOnly=false,canDelete=false){
  const all=M.completed(db,workout);
  const attempts=archiveOnly?all.filter(a=>!M.isWorkingAttempt(db,a)):includeArchiveStats()?all:M.workingCompleted(db,workout).length?M.workingCompleted(db,workout):all;
  const intervals=sharedScale?attempts.flatMap(a=>a.mode==='intervals'?(a.intervalsMs??[]):[]):[];
  const sharedMax=sharedScale?Math.max(1,...intervals):undefined;
  const mayDeleteAttempt=canDelete&&(trainerUnlocked||all.length>1);
  const attemptAction=a=>mayDeleteAttempt&&(archiveOnly||M.isWorkingAttempt(db,a)||workout.status!=='completed')
    ?historyDeleteButton('delete-attempt',a.id,'Удалить попытку'):'';
  return `<details><summary>Подробнее</summary><div class="note">${esc(M.datetime(workout.createdAt))}</div>${attempts.map(a=>row(`Попытка ${a.ordinal}`,((includeArchiveStats()||M.isWorkingAttempt(db,a))?recordTime(a.totalMs,a.athleteId,isRecord(a)):M.fmt(a.totalMs))+(attempts.length>1&&a.totalMs===best&&!isRecord(a)&&a.totalMs!==recordAsOf(a.athleteId)?'<span aria-label="Лучшая попытка"> ★</span>':''))+attemptAction(a)+intervalDetails(a,sharedMax)).join('')}${workoutComments(workout,editable)}</details>`;
}
function archiveSource(w){
  const a=M.completed(db,w).find(a=>!M.isWorkingAttempt(db,a));
  if(a?.mode==='stopwatch')return 'Старт–Стоп · тест';
  return a?`${intervalCountLabel(a.targetIntervals)} · ${w.measurementPlan?.purpose==='test'||a.targetIntervals===4?'тест':'архив'}`:'Архив';
}
function archiveHistory(aid,canDelete=false){
  const entries=M.archivedWorkouts(db,aid).map(w=>({date:w.createdAt,id:w.id,
    html:`<div class="history-item" data-archive-workout="${esc(w.id)}"${M.workingBest(db,w)===null?` data-history-workout="${esc(w.id)}"`:''}><span>Тренировка ${esc(M.datetime(w.createdAt))}</span><p class="note">${archiveSource(w)}</p><strong>${includeArchiveStats()?recordTime(Math.min(...M.completed(db,w).filter(a=>!M.isWorkingAttempt(db,a)).map(a=>a.totalMs)),aid,M.completed(db,w).some(a=>!M.isWorkingAttempt(db,a)&&isRecord(a))):M.fmt(Math.min(...M.completed(db,w).filter(a=>!M.isWorkingAttempt(db,a)).map(a=>a.totalMs)))}</strong>${workoutDetails(w,M.best(db,w),true,true,true,canDelete)}${canDelete&&M.workingBest(db,w)===null?workoutDeleteButton(w):''}</div>`}));
  for(const a of db.archived.filter(a=>a.athleteId===aid))entries.push({date:a.date,id:a.id,
    html:`<div class="history-item" tabindex="-1" data-history-archive="${esc(a.id)}"><span>${esc(a.date)} · Ручной ввод · </span><strong>${includeArchiveStats()?recordTime(a.bestMs,aid):M.fmt(a.bestMs)}</strong>${canDelete?historyDeleteButton('delete-archived',a.id):''}</div>`});
  entries.sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  const key=`archive:${db.device.lastInterface}:${aid}`,list=boundedList(entries,key);
  const addResult=personalHistoryScreen()&&aid===currentAthlete()
    ?`<details class="archive-add"><summary>Добавить результат</summary>${archiveFields()}</details>`:'';
  return entries.length||addResult?card('<h2>Архивные тренировки</h2>'+addResult+'<div class="history-list" data-list-container="'+esc(key)+'">'+list.items.map(x=>x.html).join('')+list.control+'</div>','archive-history'):'';
}
function historyItems(aid,canDelete=false){
  const ordered=[...M.publicWorkouts(db,aid)].reverse(),total=ordered.length;
  ordered.shift();
  const personalView=db.device.lastInterface==='athlete';
  const key=`history:${db.device.lastInterface}:${aid}`,list=boundedList(ordered,key,{limit:4,total});
  return `<h2>${personalView?'Предыдущие тренировки':'Тренировки'}</h2>${!ordered.length?muted('Нет предыдущих тренировок'):''}
    <div class="history-list" data-list-container="${esc(key)}">${list.items.map(w=>{
      const bs=statsBest(w);
      return `<div class="history-item" data-history-workout="${esc(w.id)}"><div class="row between"><span class="muted">${esc(M.date(w.createdAt))}</span><strong>${recordTime(bs,aid,M.completed(db,w).some(a=>isRecord(a)))}</strong></div>${workoutDetails(w,bs,true,true,false,canDelete)}${canDelete?workoutDeleteButton(w):''}</div>`;
    }).join('')}${list.control}</div>`;
}
function historyScreen(){
  const mode=db.device.lastInterface;
  const aid=mode==='child'||mode==='trainer'?db.device.viewAthleteId:currentAthlete();
  const trainerHistory=mode==='child'||mode==='trainer';
  if(!trainerHistory)return header('',b('Назад','back-history','small'))+historyContent(aid);
  const ids=mode==='trainer'&&trainerUnlocked?db.athletes.map(a=>a.id):db.device.childParticipants;
  const selected=mode==='trainer'&&trainerUnlocked?trainerHistoryAthlete():ids.includes(aid)?aid:ids[0];
  return header('',b('Назад','back-history','small'))+
    athleteTabs(ids,selected,'history-profile')+profilePanel(selected,historyContent(selected,mode==='child',trainerUnlocked&&mode==='trainer'));
}
function historyContent(aid,child=false,trainer=false){
  const canManage=managedHistoryAthlete()===aid;
  const canDelete=canManage&&historyDeleteEnabled();
  return progress(aid,canDelete)+(canManage?interruptedAttempts(aid,canDelete):'')+
    (!child?legacyIncompleteList(aid,canDelete):'')+(trainer?unfinishedHistory(aid,canDelete):'')+
    (trainer&&canManage?archiveForm():'');
}

function interruptedAttempts(aid,canDelete=false){
  const interrupt=db.attempts.filter(a=>a.athleteId===aid&&a.status==='interrupted')
    .sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||b.id.localeCompare(a.id));
  if(!interrupt.length)return '';
  const key=`interrupted:${db.device.lastInterface}:${aid}`,list=boundedList(interrupt,key,{attempts:true});
  return card(`<h2>Прерванные попытки</h2><div data-list-container="${esc(key)}">${list.items.map(a=>`<div class="list-row"><span>${esc(M.datetime(a.startedAt))}</span>${canDelete&&!M.currentChild(db)?.workoutIds.includes(a.workoutId)?historyDeleteButton('delete-interrupted',a.id,'Удалить попытку'):''}</div>`).join('')}${list.control}</div>`);
}
function legacyIncompleteList(aid,canDelete=false){
  const items=db.incomplete.filter(a=>a.athleteId===aid).sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt))||b.id.localeCompare(a.id));
  if(!items.length)return '';
  const key=`incomplete:${db.device.lastInterface}:${aid}`,list=boundedList(items,key,{attempts:true});
  return card(`<h2>Ранее неполные попытки</h2><div data-list-container="${esc(key)}">${list.items.map(a=>`<div class="list-row"><span>${esc(M.datetime(a.startedAt))} · не зачтена</span>${canDelete?historyDeleteButton('delete-incomplete',a.id,'Удалить попытку'):''}</div>`).join('')}${list.control}</div>`);
}
function workoutOutsideActiveSession(id){return !M.currentChild(db)?.workoutIds.includes(id)&&db.device.activeWorkoutId!==id;}
function unfinishedHistory(aid,canDelete){
  const workouts=db.workouts.filter(w=>w.athleteId===aid&&w.status!=='completed')
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  if(!workouts.length)return '';
  const key=`unfinished:${aid}`,list=boundedList(workouts,key);
  return card(`<h2>Незавершённые тренировки</h2><div class="history-list" data-list-container="${esc(key)}">${list.items.map(w=>{
    const deletable=canDelete&&workoutOutsideActiveSession(w.id);
    return `<div class="history-item" data-history-workout="${esc(w.id)}"><span>Тренировка ${esc(M.datetime(w.createdAt))}</span>${M.completed(db,w).length?workoutDetails(w,M.best(db,w),true,false,false,deletable):''}${deletable?workoutDeleteButton(w):''}</div>`;
  }).join('')}${list.control}</div>`);
}
function animationSettings(){
  const selected=launchAnimation();
  return card('<h2 id="launch-animation-title">Анимация запуска</h2><div class="animation-options" role="group" aria-labelledby="launch-animation-title">'+
    [['glow','Сияние'],['pulse','Пульсация'],['none','Без анимации']].map(([value,label])=>
      `<label class="animation-option"><span class="animation-sample" aria-hidden="true"><span class="counter-ready launch-${value}"><span class="play-glyph"></span></span></span><span>${label}</span><input type="radio" name="launch-animation" value="${value}" ${value===selected?'checked':''}></label>`).join('')+'</div>');
}
function settingsActions(){
  return `<div class="buttons settings-actions">${b('Сохранить настройки','settings-save','primary')}${b('Не сохранять','settings-back','nav-return')}</div>`;
}
function appSettings(){
  if(!settingsDraft)beginSettingsDraft();
  const {history,planLocked,historyDelete}=settingsDraft;
  const title=history?'Настройки истории':'Настройки тренировки';
  const plan=planLocked
    ?'<p class="note">Режим и число попыток можно изменить перед следующей тренировкой.</p>'
    :card('<h2>Тренировка</h2>'+chooseAttempts(soloPlannedAttempts())+chooseMode(soloMeasurementMode()));
  const content=renderError?card(muted('Настройки недоступны, пока приложение не откроется.')):
    history?historyDeletionSettings(historyDelete):plan+animationSettings();
  return header()+`<h1 class="settings-title">${title}</h1>`+content+settingsActions();
}
function athleteHistoryMenu(){
  return `<details class="history-more"><summary>Ещё</summary><div class="history-more-links">
    <a href="#data-exchange" data-act="data-exchange">Обменяться данными</a>
    <a href="#admin-login" data-act="pin" title="Для Тренера">Интерфейс тренера</a>
    </div></details>`;
}
function dataExchangeScreen(){
  return header()+card('<h1>Обменяться данными</h1>'+
    '<label>Имя (указывается в файле выгрузки)<input id="profile-name" maxlength="50" value="'+esc(athlete(db.baseProfileId).name)+'"></label>'+
    '<div class="buttons">'+b('Сохранить','save-profile-name','small')+'</div>'+
    '<div class="buttons">'+b('Выгрузить','export-json','wide')+b('Загрузить','import-json','wide')+
    '</div><p class="note center">Данные хранятся на&nbsp;устройстве.</p><input type="file" id="file-import" accept=".json,application/json" hidden>')+
    b('Назад','data-exchange-back','wide nav-return');
}
function archiveFields(){
  return '<p class="note">Ручной ввод. '+(includeArchiveStats()?'Учитывается в рекорде, среднем и прогрессе.':'Не учитывается в рекорде, среднем и прогрессе.')+'</p>'+
    '<label class="archive-field" for="archive-date"><span>Дата</span><input type="date" id="archive-date"></label>'+
    '<label class="archive-field" for="archive-time"><span>Время, секунды</span><input type="text" id="archive-time" inputmode="decimal" placeholder="Например 23,567"></label>'+
    '<div class="buttons">'+b('Добавить в архив','add-archive',db.device.lastInterface==='trainer'?'primary wide':'primary')+'</div>';
}
function archiveForm(){
  return card('<h2>Добавить архивный результат</h2>'+archiveFields());
}
function trainerAthleteRow(profile){
  const id=esc(profile.id),name=esc(profile.name),attrs=`data-id="${id}"`;
  return `<div class="athlete-row">
    <div class="list-row athlete-row-controls">
      <span data-athlete-name>${name}</span>
      <div class="athlete-row-actions">
        ${id===esc(db.baseProfileId)?'<span class="note">Базовый профиль</span>':b('Сделать базовым','set-base','small',attrs)}
        ${b('История','trainer-history','small',attrs)}
        ${b('Переименовать','rename-athlete','small','aria-expanded="false"')}
        ${db.athletes.length>1?b('Удалить','delete-athlete','danger small',attrs):''}
      </div>
    </div>
    <form class="athlete-rename" data-athlete-id="${id}" hidden>
      <label>Имя спортсмена<input name="athlete-name" value="${name}" maxlength="50" required></label>
      <div class="buttons">
        <button type="submit" class="primary small">Сохранить</button>
        ${b('Отмена','cancel-athlete-rename','small')}
      </div>
    </form>
  </div>`;
}
function setAthleteRenameOpen(row,open){
  const form=row.querySelector('.athlete-rename');
  const renameButton=row.querySelector('[data-act="rename-athlete"]');
  form.hidden=!open;
  renameButton.setAttribute('aria-expanded',String(open));
  if(open){
    const field=form.elements['athlete-name'];
    field.value=row.querySelector('[data-athlete-name]').textContent;
    field.focus();
    field.select();
  }else renameButton.focus();
}
function trainerHome(){const c=M.currentChild(db),options=db.athletes.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');const title=header('Тренер',b('К занятию','go-child','small'))+`<h1 class="hero-title">Управление занятием</h1>`;if(c)return title+card(`<h2>Занятие идёт</h2><p>${c.athleteIds.map(id=>esc(athlete(id).name)).join(' → ')}</p><p>Следующая попытка: ${c.nextIndex+1} из ${c.sequence.length}</p>${b('Вернуться к занятию','go-child','primary wide')}<div class="buttons">${b('Принудительно завершить','force-child','danger wide')}</div>`);
  if(additionalSolo())return title+card('<h2>Незавершённая тренировка</h2><p>'+esc(athlete(activeSolo().athleteId).name)+'</p>'+b('Продолжить незавершённую тренировку','resume-additional-solo','wide'));
  return title+card(`<h2>Подготовить занятие</h2><label>Участник А<select id="trainer-a">${options}</select></label><label>Участник Б<select id="trainer-b"><option value="">Нет — один участник</option>${options}</select></label>${chooseAttempts()}${chooseMode()}<div class="buttons">${b('Начать занятие','start-child','primary wide')}</div>`)+card(`<h2>Спортсмены</h2>${db.athletes.map(trainerAthleteRow).join('')}<label>Добавить спортсмена<input id="new-athlete" maxlength="50" placeholder="Имя"></label><div class="buttons">${b('Добавить','add-athlete','primary')}</div>`)+permanentTrainerSettings()+historyDeletionSettings()+card(`<h2>Резервные копии</h2><div class="buttons backup-actions">${b('Выгрузить','export-json')} ${b('Загрузить','import-json')} ${b('Удалить все локальные данные','reset-all','danger wide')}</div><input id="file-import" type="file" accept=".json,application/json" hidden>`);
}
function baseChoice(source,action,personal=false){return card('<h1>'+(personal?'Выберите профиль для загрузки':'Выберите базовый профиль')+'</h1><label>Профиль<select id="base-choice">'+source.athletes.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${source.workouts.filter(w=>w.athleteId===a.id).length} тренировок · ${source.archived.filter(w=>w.athleteId===a.id).length} архивных результатов</option>`).join('')+'</select></label><p>'+(personal?'Будет загружен только выбранный профиль.':'Этот профиль будет доступен без PIN.')+'</p>'+b(personal?'Загрузить профиль':'Назначить базовым',action,'primary wide'));}
function pinScreen(){return header('','',false,'',false)+card(`<h2>Вход в интерфейс тренера</h2>${!config?.trainerAccess?`<div class="error">PIN пока не сконфигурирован. Разработчик должен записать проверочный хеш PIN, выбранного Тренером, в config.json.</div>`:`<label>PIN-код<input type="password" id="pin-input" inputmode="numeric" autocomplete="off" maxlength="32" placeholder="PIN"></label><div class="buttons">${b('Войти','pin-submit','primary wide')}</div>`}`)+b('Назад','pin-back','wide');}
function render(){if(!db)return;if(pendingMigration){app.innerHTML=`<main class="shell">${screen==='migration-select'&&trainerUnlocked?baseChoice(pendingMigration.source,'migration-confirm'):card('<h1>Выберите базовый профиль</h1><p>Исходная история сохранена. Для выбора базового профиля войдите как Тренер.</p>')+pinScreen()}</main>`;return;}if(pendingImport){app.innerHTML=`<main class="shell">${baseChoice(pendingImport.raw,'import-confirm',pendingImport.personal)}${b('Отмена','import-cancel','wide')}</main>`;return;}document.body?.classList.toggle('trainer-theme',['child','trainer'].includes(db.device.lastInterface));const previousPlot=app.querySelector('.chart-scrollable[data-positioned]');const plotOffset=previousPlot?.scrollLeft;let html='';if(screen==='settings')html=appSettings();else if(renderError)html=header()+card(`<div class="error">${esc(renderError)}</div>${renderError.includes('Interval Lab')||renderError.includes('перенос')?'<div class="buttons"><a class="primary wide" href="https://t39s.github.io/dev-sandbox/interval-lab/">Открыть Interval Lab для переноса</a></div>':`<div class="buttons">${b('Экспортировать текущие данные','export-json')}</div>`}`);else if(screen==='data-exchange')html=dataExchangeScreen();else if(screen==='pin')html=pinScreen();else if(screen==='trainer')html=trainerUnlocked?trainerHome():pinScreen();else if(screen==='athlete')html=adultHome();else if(screen==='athlete-ready')html=soloReady();else if(screen==='child-ready')html=childReady();else if(screen==='child-final')html=childFinal();else if(screen==='result')html=resultScreen();else if(screen==='rest'){const c=M.currentChild(db),turn=M.nextTurn(db);const w=c?M.workoutOf(db,turn?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);html=restScreen(!!c,w);}else if(screen==='final')html=finalAdult();else if(screen==='history')html=historyScreen();else html=adultHome();const showAthleteExit=trainerUnlocked&&!renderError&&['trainer','history','child-final'].includes(screen);const showHistoryMenu=!renderError&&personalHistoryScreen();app.innerHTML=`<main class="shell">${html}<footer class="nav-spacer app-footer athlete-footer"><span class="app-version">v. 0.3.5-rc.2</span>${showAthleteExit?'<a href="#exit" data-act="switch-athlete">Интерфейс спортсмена</a>':''}${showHistoryMenu?athleteHistoryMenu():''}</footer></main>`;
  const plot=app.querySelector('.chart-scrollable');
  if(plot?.clientWidth&&plotOffset!==undefined){
    plot.scrollLeft=plotOffset;
    plot.dataset.positioned='true';
  }
  initializeProgressScroll();
}
function go(newScreen,lastInterface=null){
  const previousScreen=screen;
  if(newScreen==='settings'){
    if(!settingsDraft)beginSettingsDraft();
  }else{
    settingsDraft=null;
  }
  if(lastInterface){change(n=>{n.device.lastInterface=lastInterface;});}
  if(newScreen==='child-ready'){
    const c=M.currentChild(db),turn=M.nextTurn(db),w=M.workoutOf(db,turn?.workoutId);
    if(c?.athleteIds.length===1 && turn?.ordinal===2 && w?.firstEndedAt && restBypassedWorkout!==w.id && remainingRest(w)>0)newScreen='rest';
  }
  screen=newScreen;
  render();
  if(screen!==previousScreen&&[screen,previousScreen].some(s=>['pin','trainer','data-exchange'].includes(s))){
    window.scrollTo?.(0,0);
  }
}
function bestPreviousBeforeAttempt(a){return isRecord(a);}
function afterFinished(result,personal,releasePointerId){lastResultId=result.attempt.id;viewId=result.workout.id;run=null;releaseWakeLock();screen='result';
  resultUntil=null;
  resetVoice();
  // A touch release can activate Safari speech; the measured time is already stored.
  if(releasePointerId!==null&&sound())pendingAttemptVoice={pointerId:releasePointerId,attempt:result.attempt};
  else sayAttempt(result.attempt);
  const showResult=()=>{if(screen==='result')render();};
  if(personal)setTimeout(showResult,200);
  else showResult();}
function startMeasurement(){
  if(!config||run)return;
  const child=isChild();
  const c=M.currentChild(db);
  const w=M.workoutOf(db,child?M.nextTurn(db)?.workoutId:db.device.activeWorkoutId);
  if(child&&!w)return;
  if(w?.plannedAttempts===2&&M.completed(db,w).length===1&&!c&&M.deadline(w)!==null&&Date.now()>=M.deadline(w)){
    try{operate(s=>M.closeWorkout(s,w.id,'timeout'));viewId=w.id;go('final');}catch(e){fail(e);}
    return;
  }
  const now=performance.now(),date=new Date().toISOString();
  try{
    lockWorkingCount(w?M.workoutPlan(db,w,trainerSettings()):selectedPlan());
    const a=operate(s=>{
      if(w){
        const plan=M.workoutPlan(s,w,trainerSettings());
        if(!w.measurementPlan&&!w.attemptIds.length){s=M.clone(s);M.workoutOf(s,w.id).measurementPlan=plan;}
        return M.startAttempt(s,w.id,plan.mode,plan.targetIntervals??1,date,trainerUnlocked);
      }
      const plan=selectedPlan();
      const workout=M.startSolo(s,currentAthlete(),soloPlannedAttempts(),plan);
      workout.state.device.measurementMode=plan.mode;
      return M.startAttempt(workout.state,workout.value.id,plan.mode,plan.targetIntervals??1,date,trainerUnlocked);
    });
    run={id:a.id,start:now,lastAccepted:now,intervals:[],mode:a.mode,target:a.targetIntervals,lastCheckpoint:now};
    resetVoice();
    acquireWakeLock();
    render();
  }catch(e){fail(e);}
}
function completeMeasurement(now,personal,releasePointerId){const dur=now-run.start;let intervals=[];let ms;if(run.mode==='intervals'){intervals=[...run.intervals];ms=intervals.reduce((x,y)=>x+y,0);}else ms=Math.max(1,Math.round(dur));const id=run.id;try{const v=operate(s=>M.finishAttempt(s,id,ms,intervals));afterFinished(v,personal,releasePointerId);}catch(e){fail(e);}}
function flashPersonalTap(){
  const zone=app.querySelector('.personal-measure');
  if(!zone)return;
  clearTimeout(personalFlashTimer);
  zone.classList.add('flash');
  personalFlashTimer=setTimeout(()=>zone.classList.remove('flash'),200);
}
function tap(releasePointerId=null){
  if(renderError||!config||!['athlete-ready','child-ready'].includes(screen))return;
  const personal=screen==='athlete-ready';
  const now=performance.now();
  if(!run){
    startMeasurement();
    if(run)flashPersonalTap();
    return;
  }
  if(now-run.lastAccepted<=config.minTapGapMs)return;
  const previousAccepted=run.lastAccepted,previousIntervals=[...run.intervals];
  run.lastAccepted=now;
  if(run.mode==='intervals'){
    const elapsed=run.intervals.reduce((total,ms)=>total+ms,0);
    run.intervals.push(Math.max(0,Math.round(now-run.start-elapsed)));
  }
  const finished=run.mode==='stopwatch'||run.intervals.length===run.target;
  if(!finished){
    try{const partial=partialMeasurement();operate(s=>M.checkpointAttempt(s,run.id,partial.elapsedMs,partial.intervalsMs));run.lastCheckpoint=now;}
    catch(e){run.lastAccepted=previousAccepted;run.intervals=previousIntervals;fail(e);return;}
  }
  if(!finished||(personal&&run.mode==='intervals'))render();
  flashPersonalTap();
  if(finished)completeMeasurement(now,personal,releasePointerId);
}
function resultProgress(){if(screen!=='result')return;const a=M.attemptOf(db,lastResultId);if(!a)return;const w=M.workoutOf(db,a.workoutId);
 if(resultUntil===null||Date.now()<resultUntil)return;const c=M.currentChild(db);if(c?.athleteIds.length===2){screen='child-ready';queueVoice(athlete(M.nextTurn(db).athleteId).name);render();return;}
 if(w.status==='completed'){screen=db.device.lastInterface==='child'?'child-final':'final';render();return;}if(remainingRest(w)<=0){screen=isChild()?'child-ready':'athlete-ready';if(isChild())queueVoice('Можно начинать');render();}else{screen='rest';render();}}
function tick(){
  if(renderError||!config)return;
  refreshLaunchAnimation();
  try{const closed=M.expireSolo(db,Date.now());if(closed){commitState(closed.state);if((!trainerUnlocked&&closed.value.athleteId!==db.baseProfileId)||['trainer','history','pin','data-exchange'].includes(screen))return;viewId=closed.value.id;run=null;if(screen==='settings'&&!settingsDraft?.history)settingsFrom='final';else if(screen!=='settings')screen='final';resetVoice();message('Тренировка завершена. Сохранён результат первой попытки.');render();return;}}catch(e){fail(e);}
  const activeScreen=screen==='settings'?settingsFrom:screen;
  if(db.device.lastInterface==='athlete'&&(activeScreen==='rest'||activeScreen==='result')){
    const workout=M.workoutOf(db,db.device.activeWorkoutId);
    const left=workout?.firstEndedAt?remainingRest(workout):0;
    if(left>0&&left<=10000&&sound()&&restWarningWorkout!==workout.id){
      restWarningWorkout=workout.id;
      // Keep the speech engine active: cancelling immediately before a timed
      // announcement can suppress it in mobile browsers.
      queueVoice('Пора начинать');
    }
  }
  if(screen==='result'){
    resultProgress();
  }else if(screen==='rest'){
    const c=M.currentChild(db),turn=M.nextTurn(db);
    const w=c?M.workoutOf(db,turn?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);
    if(!w){screen=c?'child-final':'final';render();return;}
    if(remainingRest(w)<=0&&(!c||voicePending===0)){screen=c?'child-ready':'athlete-ready';if(c)queueVoice('Можно начинать');render();return;}
  }else if(screen==='child-ready'&&!run){
    // A resumed single-child session may be waiting for rest on this screen.
    const c=M.currentChild(db),turn=M.nextTurn(db);
    const w=c?M.workoutOf(db,turn?.workoutId):null;
    if(c?.athleteIds.length===1 && turn?.ordinal===2 && w?.firstEndedAt && restBypassedWorkout!==w.id){
      if(remainingRest(w)>0 && app.querySelector('[data-rest-clock]')){screen='rest';}
      else if(app.querySelector('[data-rest-clock]')){queueVoice('Можно начинать');render();return;}
    }
  }
  // Update only text nodes: replacing the button mid-touch could lose the click.
  const clock=app.querySelector('[data-rest-clock]');
  if(clock){const c=M.currentChild(db),turn=M.nextTurn(db);const w=c?M.workoutOf(db,turn?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);if(w)clock.textContent=M.mins(remainingRest(w));}
  if(run){
    const cancel=app.querySelector('[data-cancel-launch]');if(cancel)cancel.hidden=!cancelLaunchAvailable();
    if(performance.now()-run.lastCheckpoint>=1000){
      run.lastCheckpoint=performance.now();
      try{const partial=partialMeasurement();operate(s=>M.checkpointAttempt(s,run.id,partial.elapsedMs,partial.intervalsMs));}catch(e){fail(e);}
    }
  }
  if(run && (screen==='athlete-ready'||screen==='child-ready')){
    const elapsed=app.querySelector('[data-elapsed]');
    if(elapsed)elapsed.textContent=elapsedSeconds(performance.now()-run.start,true)+' с';
  }
}
async function handleAction(name,button){try{
 if(renderError&&name!=='export-json')return;
 if(pendingMigration&&!['pin-submit','pin-back','migration-confirm'].includes(name))return;
 if(pendingImport&&!['import-confirm','import-cancel'].includes(name))return;
 switch(name){
 case 'cancel-launch':{
   if(!cancelLaunchAvailable())return;
   const partial=partialMeasurement(),a=operate(s=>M.cancelAttempt(s,run.id,partial.elapsedMs,partial.intervalsMs,config.attemptCancelWindowSec));
   run=null;releaseWakeLock();resetVoice();restBypassedWorkout=null;
   const w=M.workoutOf(db,a.workoutId),c=M.currentChild(db);
   go(w.firstEndedAt&&remainingRest(w)>0&&(!c||c.athleteIds.length===1)?'rest':c?'child-ready':'athlete-ready');return;
 }
 case 'end-training':{
   if(screen==='settings'||!trainingScreen())return;
   const all=trainerUnlocked&&db.device.lastInterface==='trainer'&&M.currentChild(db);
   if(run&&!window.confirm((all?'Завершить занятие?':'Завершить тренировку?')+' Текущая попытка будет прервана. Завершённые результаты сохранятся.'))return;
   const w=currentTrainingWorkout(),partial=run?partialMeasurement():null;
   if(all||w)operate(s=>{
     let state=s;
     if(run)state=M.checkpointAttempt(state,run.id,partial.elapsedMs,partial.intervalsMs).state;
     return all?M.forceCloseChild(state):M.endWorkout(state,w.id);
   });
   run=null;releaseWakeLock();resetVoice();restBypassedWorkout=null;resultUntil=0;lastResultId=null;viewId=null;
   if(all){go('trainer');return;}
   if(isChild()){
     if(M.currentChild(db)){go('child-ready');queueVoice(athlete(M.nextTurn(db).athleteId).name);}
     else{returnFromHistory='child-final';go('history');}
   }else go('athlete');
   return;
 }
 case 'settings':{
   if(settingsUnavailable())return;
   settingsFrom=screen;beginSettingsDraft();go('settings');return;
 }
 case 'settings-save':{
   if(screen!=='settings'||!settingsDraft||db.device.lastInterface!=='athlete')return;
   captureSettingsDraft();const draft={...settingsDraft};
   if(draft.history){
     if(draft.historyDelete!==historyDeleteEnabled())writeTrainerSettings({...trainerSettings(),[historySettingsKey()]:draft.historyDelete});
   }else if(!draft.planLocked||draft.animationChanged){
     change(n=>{
       if(!draft.planLocked){
         n.device.soloPlannedAttempts=draft.attempts;
         n.device.soloMeasurementMode=draft.mode;
       }
       if(draft.animationChanged)n.device.launchAnimation=draft.animation;
     });
   }
   message('Настройки сохранены');go(settingsFrom);return;
 }
 case 'data-exchange':{
   if(personalHistoryScreen())go('data-exchange');
   return;
 }
 case 'data-exchange-back':{
   if(screen==='data-exchange')go('athlete');
   return;
 }
 case 'save-profile-name':{
   if(screen!=='data-exchange'||db.device.lastInterface!=='athlete')return;
   const input=$('profile-name');
   const profile=operate(s=>M.renameAthlete(s,s.baseProfileId,input.value));
   input.value=profile.name;
   message('Имя сохранено');return;
 }
 case 'settings-back':{
   if(screen!=='settings')return;
   go(settingsFrom);app.querySelector('[data-act="settings"]')?.focus();return;
 }
 case 'list-toggle':{
   const key=button?.dataset.listKey;if(!key)return;
   captureSettingsDraft();
   if(expandedLists.has(key))expandedLists.delete(key);else expandedLists.add(key);
   render();
   Array.from(app.querySelectorAll?.('[data-act="list-toggle"]')||[]).find(node=>node.dataset.listKey===key)?.focus();
   return;
 }
 case 'toggle-sound':{
   if(!soundAvailable())return;
   change(n=>{n.device.soundEnabled=!n.device.soundEnabled;});
   const enabled=sound();
   if(!enabled)resetVoice();
   button.setAttribute('aria-pressed',String(enabled));
   button.innerHTML=speakerIcon(enabled);
   return;
 }
 case 'return-trainer':
   if(!trainerUnlocked)return;
   if(run&&!isChild()){message('Сначала завершите измерение');return;}
   go('trainer','trainer');return;
 case 'pin':if(trainerUnlocked){go('trainer','trainer');return;}returnFromPin=screen;go('pin');return;
 case 'pin-back':if(pendingMigration){trainerUnlocked=false;screen='migration';render();return;}if(returnFromPin){const previous=returnFromPin;returnFromPin=null;go(previous);return;}if(db.device.lastInterface==='trainer'&&!trainerUnlocked){if(M.currentChild(db))go('child-ready','child');else go('athlete','athlete');return;}go(db.device.lastInterface==='child'?(M.currentChild(db)?'child-ready':'child-final'):(db.device.lastInterface==='trainer'?'trainer':'athlete'));return;
 case 'pin-submit':{
   const input=$('pin-input');
   if(!input||(!pendingMigration&&screen!=='pin'))return;
   if(!await pinMatches(input.value)){message('Неверный PIN');return;}
   if(renderError||$('pin-input')!==input||(!pendingMigration&&screen!=='pin'))return;
   returnFromPin=null;
   if(pendingMigration){trainerUnlocked=true;screen='migration-select';render();return;}
   change(n=>{n.device.lastInterface='trainer';});
   trainerUnlocked=true;go('trainer');return;
 }
 case 'switch-athlete':{if(run){message('Сначала завершите измерение');return;}if(M.currentChild(db)||additionalSolo()){message('Сначала завершите текущую тренировку или занятие');return;}change(n=>{n.device.trainerActivated=false;n.device.selectedAthleteId=n.baseProfileId;n.device.lastInterface='athlete';});trainerUnlocked=false;go(activeSolo()?.firstEndedAt&&remainingRest(activeSolo())>0?'rest':activeSolo()?'athlete-ready':'athlete');return;}
 case 'go-child':{if(!trainerUnlocked||additionalSolo()||!db.device.childParticipants.length)return;change(n=>{n.device.lastInterface='child';});go(M.currentChild(db)?'child-ready':'child-final');return;}
 case 'open-exercise':if(M.currentChild(db))return;if(additionalSolo()){go(trainerUnlocked?'trainer':'pin');return;}go('athlete-ready');app.querySelector('[data-tap]')?.focus();return;
 case 'final-home':viewId=null;lastResultId=null;go('athlete');return;
 case 'resume-legacy':{if(db.device.activeWorkoutId||M.currentChild(db))return;const wid=button.dataset.id;const w=M.workoutOf(db,wid);if(!w||w.status!=='legacy_pending'||w.athleteId!==currentAthlete())return;change(n=>{n.device.activeWorkoutId=wid;});go('athlete-ready');return;}
 case 'start-child':{if(!trainerUnlocked||screen!=='trainer')return;const a=$('trainer-a').value,bb=$('trainer-b').value,ids=bb?[a,bb]:[a],count=Number($('attempt-count').value);const plan=M.measurementPlan($('mode-select').value,trainerSettings());lockWorkingCount(plan);operate(s=>{const result=M.startChild(s,ids,count,plan);result.state.device.measurementMode=plan.mode;return result;});go('child-ready');queueVoice(athlete(ids[0]).name);return;}
 case 'force-child':{if(!trainerUnlocked||(!run&&!window.confirm('Завершить занятие, сохранив выполненные попытки?')))return;await handleAction('end-training');return;}
 case 'rest-early':if(screen==='result'||screen==='rest'||screen==='child-ready'){const c=M.currentChild(db);const w=c?M.workoutOf(db,M.nextTurn(db)?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);restBypassedWorkout=w?.id||null;screen=c?'child-ready':'athlete-ready';resetVoice();render();}return;
 case 'history-athlete':returnFromHistory=screen;go('history');return;
 case 'history-child':returnFromHistory=screen;go('history');return;
 case 'back-history':go(returnFromHistory==='trainer'?'trainer':isChild()?'child-final':returnFromHistory);return;
 case 'history-profile':{const ids=trainerUnlocked&&db.device.lastInterface==='trainer'?db.athletes.map(a=>a.id):db.device.childParticipants;const aid=button.dataset.id;if(!ids.includes(aid))return;change(n=>{n.device.viewAthleteId=aid;});render();app.querySelector('[role="tab"][aria-selected="true"]')?.focus();return;}
 case 'child-view':{if(M.currentChild(db))return;let aid=button.dataset.id;if(!db.device.childParticipants.includes(aid))return;change(n=>{n.device.viewAthleteId=aid;});go('child-final');app.querySelector('[role="tab"][aria-selected="true"]')?.focus();return;}
 case 'trainer-history':{if(!trainerUnlocked)return;const aid=button.dataset.id;change(n=>{n.device.viewAthleteId=aid;});returnFromHistory='trainer';go('history');return;}
 case 'add-archive':{
   const aid=managedHistoryAthlete();if(!aid)return;
   const day=$('archive-date').value;
   const raw=$('archive-time').value.trim().replace(',','.');
   const num=Number(raw);
   if(!raw||!Number.isFinite(num)||num<=0)throw Error('Некорректное время архива');
   const entry=operate(s=>M.addArchived(s,aid,day,Math.round(num*1000)));
   if(personalHistoryScreen()){
     const date=entry.date;
     const newer=db.archived.filter(a=>a.athleteId===aid&&(a.date>date||(a.date===date&&a.id>entry.id))).length+
       M.archivedWorkouts(db,aid).filter(w=>w.createdAt>date).length;
     if(newer>=5)expandedLists.add(`archive:athlete:${aid}`);
     render();
     Array.from(app.querySelectorAll?.('[data-history-archive]')||[]).find(row=>row.dataset.historyArchive===entry.id)?.focus();
   }else render();
   return;
 }
 case 'save-trainer-settings':{
   if(!trainerUnlocked||screen!=='trainer')return;
   const t=trainerSettings();
   const patch={workingIntervalCount:t.workingCountLocked?t.workingIntervalCount:Number($('working-count').value),
     testIntervalCount:Number($('test-count').value),workRestDurationSec:Number($('work-rest').value),testRestDurationSec:Number($('test-rest').value),includeArchiveStats:Boolean($('include-archive-stats')?.checked)};
   writeTrainerSettings(M.changeTrainerSettings(t,patch,trainerUnlocked));
   message('Настройки сохранены');render();return;
 }
 case 'rename-athlete':
 case 'cancel-athlete-rename':{
   if(!trainerUnlocked||screen!=='trainer'||renderError)return;
   const row=button?.closest('.athlete-row');
   if(row)setAthleteRenameOpen(row,name==='rename-athlete');
   return;
 }
 case 'add-athlete':{if(!trainerUnlocked)return;const name=$('new-athlete').value;operate(s=>M.addAthlete(s,name));render();return;}
 case 'reset-all':{
   if(!trainerUnlocked||run||db.device.activeWorkoutId||M.currentChild(db))return;
   if(!window.confirm('Удалить все локальные данные, профили и постоянные настройки Тренера?')||
      !window.confirm('Подтвердите необратимый сброс. Сделайте экспорт перед удалением.'))return;
   if(storageChanged||localStorage.getItem(M.KEY)!==savedBytes)throw Error('Данные изменились в другой вкладке. Перезагрузите приложение.');
   const previousSettings=savedSettingsBytes;
   const cleared=M.blank();
   cleared.device.launchAnimationFirstDay=localDay();
   // Keep fresh defaults through reload, even though v6 already contains a blank profile.
   writeTrainerSettings(M.defaultTrainerSettings(config,false));
   try{commitState(cleared);}
   catch(error){
     if(previousSettings===null)localStorage.removeItem(M.SETTINGS_KEY);
     else localStorage.setItem(M.SETTINGS_KEY,previousSettings);
     savedSettingsBytes=previousSettings;
     trainerSettingsState=previousSettings===null?null:M.validateTrainerSettings(JSON.parse(previousSettings));
     throw error;
   }
   localStorage.removeItem(M.V5_KEY);
   localStorage.removeItem(M.LEGACY_KEY);
   trainerUnlocked=false;
   expandedLists.clear();
   resetVoice();go('athlete');return;
 }
 case 'migration-confirm':{if(!trainerUnlocked||!pendingMigration)return;if(localStorage.getItem(M.V5_KEY)!==pendingMigration.bytes||localStorage.getItem(M.KEY))throw Error('Исходные данные изменились. Перезагрузите приложение.');const next=M.migrateV5ToV6(pendingMigration.source,$('base-choice').value);commitState(next);pendingMigration=null;await init();return;}
 case 'import-cancel':pendingImport=null;render();return;
 case 'import-confirm':{
   if(!pendingImport||(!pendingImport.personal&&!trainerUnlocked))return;
   const aid=$('base-choice').value;
   const next=pendingImport.personal
     ?M.evaluatePersonalImport(db,pendingImport.raw,aid)
     :M.evaluateImport(db,pendingImport.raw,true,aid);
   commitState(next.state);pendingImport=null;
   message('Импорт завершён');render();return;
 }
 case 'set-base':{if(!trainerUnlocked)return;if(!window.confirm('Назначить этот профиль базовым? История останется у прежних ID.'))return;operate(s=>M.setBaseProfile(s,button.dataset.id,true));render();return;}
 case 'resume-additional-solo':{
   if(!trainerUnlocked||!additionalSolo()||M.currentChild(db))return;
   const w=activeSolo();
   go(w.firstEndedAt&&remainingRest(w)>0?'rest':'athlete-ready','athlete');
   return;
 }
 case 'delete-athlete':{if(!trainerUnlocked)return;const aid=button.dataset.id;let replacement=null;
   if(aid===db.baseProfileId){const choices=db.athletes.filter(a=>a.id!==aid);if(!choices.length)throw Error('Нельзя удалить последний профиль');
     const answer=window.prompt('Выберите замену базового профиля (номер):\n'+choices.map((a,i)=>`${i+1}. ${a.name}`).join('\n'));if(answer===null)return;replacement=choices[Number(answer)-1]?.id;if(!replacement)throw Error('Выберите номер профиля');}
   const counts=['workouts','attempts','archived','incomplete'].map(k=>`${k}: ${db[k].filter(x=>x.athleteId===aid).length}`).join(', ');
   if(!window.confirm('Удалить профиль и ВСЮ его историю? '+counts+(replacement?' Новый базовый: '+athlete(replacement).name:'')))return;
   operate(s=>M.deleteProfileAndRebase(s,aid,replacement,true));render();return;}
 case 'delete-incomplete':
 case 'delete-interrupted':
 case 'delete-attempt':
 case 'delete-workout':
 case 'delete-archived':{
   const aid=managedHistoryAthlete();
   if(!aid||!historyDeleteEnabled())return;
   const id=button.dataset.id;
   const type={'delete-incomplete':'incomplete','delete-interrupted':'attempt','delete-attempt':'attempt',
     'delete-workout':'workout','delete-archived':'archived'}[name];
   const collection={incomplete:db.incomplete,attempt:db.attempts,workout:db.workouts,archived:db.archived}[type];
   const entry=collection.find(item=>item.id===id&&item.athleteId===aid);
   if(!entry)return;
   const workout=type==='workout'?entry:type==='attempt'?M.workoutOf(db,entry.workoutId):null;
   if(workout&&M.currentChild(db)?.workoutIds.includes(workout.id))return;
   if(workout?.id===db.device.activeWorkoutId&&name!=='delete-interrupted')return;
   let question={
     'delete-incomplete':'Удалить неполную попытку?',
     'delete-interrupted':'Удалить прерванную попытку?',
     'delete-workout':'Удалить тренировку со всеми попытками и комментариями?',
     'delete-archived':'Удалить архивную тренировку с её попыткой?'
   }[name];
   if(name==='delete-interrupted'&&entry.status!=='interrupted')return;
   if(name==='delete-attempt'){
     if(entry.status!=='completed')return;
     const last=M.completed(db,workout).length===1;
     if(last&&!trainerUnlocked)return;
     question=last
       ?'Удалить последнюю завершённую попытку и тренировку со всеми связанными попытками и комментариями? Рекорды будут пересчитаны.'
       :'Удалить завершённую попытку? Рекорды будут пересчитаны.';
   }
   if(!window.confirm(question))return;
   operate(s=>M.deleteRecord(s,type,id,trainerUnlocked));
   render();return;
 }
 case 'export-json':{const data=JSON.stringify(exportSnapshot(),null,2);await download('sidesteps_backup_v6.json',data);return;}
 case 'import-json':$('file-import')?.click();return;
 default:return;
 }
 }catch(e){fail(e);}}
function exportSnapshot(){
  if(!(trainerUnlocked&&db.device.lastInterface==='trainer'))return M.selectProfile(db,db.baseProfileId);
  const n=M.clone(db);n.device.trainerActivated=false;n.device.lastInterface='athlete';return M.validate(n);
}
async function download(filename,content){
  const file=new File([content],filename,{type:'application/json'});
  const shareData={files:[file]};
  if(navigator.share&&navigator.canShare?.(shareData)){
    try{
      await navigator.share(shareData);
      return;
    }catch(error){
      if(error.name==='AbortError')return;
    }
  }

  const url=URL.createObjectURL(file);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.append(link);
  try{
    link.click();
  }finally{
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
}
async function importFile(file){if(!file)return;try{
  if(file.size>10*1024*1024)throw Error('Файл превышает 10 МБ');
  const bytes=await file.text();if(bytes.length>10*1024*1024)throw Error('Файл превышает 10 МБ');
  const raw=JSON.parse(bytes),source=raw.schemaVersion?raw:M.migrateV4(raw);
  const personal=db.device.lastInterface==='athlete';
  if(source.athletes?.length>1&&(personal||(trainerUnlocked&&M.isPlaceholder(db)))){
    M.normalizeImport(source,source.baseProfileId||source.athletes[0].id);
    pendingImport={raw:source,personal};render();return;
  }
  operate(s=>personal?M.evaluatePersonalImport(s,source,source.athletes?.[0]?.id):M.evaluateImport(s,source,trainerUnlocked));
  message('Импорт завершён');render();
}catch(e){fail(e);}}
app.addEventListener('pointerdown',e=>{
  if(!e.target.closest('[data-tap]')||e.button!==0||e.isPrimary===false)return;
  e.preventDefault();
  tap(e.pointerType==='touch'||e.pointerType==='pen'?e.pointerId:null);
});
document.addEventListener('pointerup',e=>{
  if(!pendingAttemptVoice||pendingAttemptVoice.pointerId!==e.pointerId)return;
  const {attempt}=pendingAttemptVoice;
  pendingAttemptVoice=null;
  sayAttempt(attempt);
},true);
document.addEventListener('pointercancel',e=>{
  if(pendingAttemptVoice?.pointerId===e.pointerId)pendingAttemptVoice=null;
},true);
app.addEventListener('keydown',e=>{
  const tab=e.target.closest('[role="tab"]');
  if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    e.preventDefault();
    const tabs=[...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
    const index=e.key==='Home'?0:e.key==='End'?tabs.length-1:
      (tabs.indexOf(tab)+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[index].focus();
  }
if((e.key===' '||e.key==='Enter')&&e.target.closest('[data-tap]')&&!e.repeat){e.preventDefault();tap();}if(e.key==='Enter'&&e.target.id==='pin-input'){e.preventDefault();handleAction('pin-submit');}});
app.addEventListener('click',e=>{const bt=e.target.closest('[data-act]');if(bt){if(bt.matches('a'))e.preventDefault();handleAction(bt.dataset.act,bt);}});
app.addEventListener('submit',e=>{
  const form=e.target;
  if(form.matches('.workout-comments')){
    e.preventDefault();
    if(run||renderError||!['athlete','history'].includes(screen)||(!trainerUnlocked&&isChild()))return;
    try{
      const comments={};
      for(const field of ['athleteComment','trainerComment']){
        const input=form.elements[field];
        if(input)comments[field]=input.value;
      }
      const workout=operate(s=>M.saveWorkoutComments(s,form.dataset.workoutId,comments,trainerUnlocked));
      for(const field of Object.keys(comments))form.elements[field].value=workout[field]??'';
      message('Комментарии сохранены');
    }catch(err){fail(err);}
    return;
  }
  if(!form.matches('.athlete-rename'))return;
  e.preventDefault();
  if(!trainerUnlocked||screen!=='trainer'||renderError||form.hidden)return;
  try{
    const row=form.closest('.athlete-row');
    const profile=operate(s=>M.renameAthlete(s,form.dataset.athleteId,form.elements['athlete-name'].value));
    row.querySelector('[data-athlete-name]').textContent=profile.name;
    const selectors='#trainer-a option,#trainer-b option';
    for(const option of app.querySelectorAll(selectors)){
      if(option.value===profile.id)option.textContent=profile.name;
    }
    setAthleteRenameOpen(row,false);
  }catch(err){fail(err);}
});
app.addEventListener('change',e=>{
  const {id,value}=e.target;
  try{
    if(id==='show-history-delete'){
      if(renderError)return;
      if(screen==='settings'&&settingsDraft?.history){
        settingsDraft.historyDelete=e.target.checked;
        return;
      }
      if(!(trainerUnlocked&&screen==='trainer'))return;
      const checked=e.target.checked;
      e.target.checked=historyDeleteEnabled();
      writeTrainerSettings({...trainerSettings(),[historySettingsKey()]:checked});
      e.target.checked=checked;
    }else if(screen==='settings'&&!settingsDraft?.history&&e.target.name==='launch-animation'){
      if(!settingsDraft)beginSettingsDraft();
      if(['glow','pulse','none'].includes(value)){settingsDraft.animation=value;settingsDraft.animationChanged=true;}
    }else if(screen==='settings'&&settingsDraft&&!settingsDraft.history&&!settingsDraft.planLocked&&id==='attempt-count'){
      if(!settingsDraft)beginSettingsDraft();
      if(['1','2'].includes(value))settingsDraft.attempts=Number(value);
    }else if(id==='mode-select'){
      if(screen!=='settings'&&!(trainerUnlocked&&screen==='trainer'))return;
      if(!['intervals','test-intervals','stopwatch'].includes(value))return;
      if(screen==='settings'){if(settingsDraft&&!settingsDraft.history&&!settingsDraft.planLocked)settingsDraft.mode=value;}
      else change(n=>{n.device.measurementMode=value;n.device.trainerMeasurementSelection=value;});
    }else if(id==='file-import'){
      importFile(e.target.files[0]);
    }
  }catch(err){fail(err);}
});
window.addEventListener('storage',e=>{if(e.key===M.KEY||e.key===M.V5_KEY||e.key===M.SETTINGS_KEY){storageChanged=true;message('Данные изменены в другой вкладке. Перезагрузите приложение.');renderError='Конфликт нескольких вкладок. Перезагрузите страницу и используйте одну вкладку для измерения.';render();}});
window.addEventListener('pagehide',()=>{resetVoice();releaseWakeLock();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&run)acquireWakeLock();});
function installArchiveViewportCheck(){
  const url=window.location;
  if(!url?.pathname.includes('/preview/')||new URLSearchParams(url.search).get('viewport-check')!=='1')return;

  const viewport=window.visualViewport;
  if(!viewport)return;

  let field=null,before=null,during=null,focused=false;
  const report=document.createElement('output');
  report.hidden=true;
  report.style.cssText='position:fixed;z-index:1000;top:env(safe-area-inset-top, 0px);left:4px;right:4px;padding:6px;background:#14273c;color:white;font:12px/1.35 monospace;white-space:pre-wrap;pointer-events:none';
  document.body.append(report);

  function measure(){
    const box=field.closest('.panel').getBoundingClientRect();
    return {
      scale:viewport.scale,width:viewport.width,height:viewport.height,
      layout:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
      clipped:Math.max(0,box.right-viewport.offsetLeft-viewport.width),
      font:getComputedStyle(field).fontSize,
    };
  }
  function sample(){
    if(!focused||!field?.isConnected)return;
    const current=measure();
    if(!during||current.width<during.width-0.5||
      (Math.abs(current.width-during.width)<=0.5&&current.height<during.height))during=current;
  }
  document.addEventListener('pointerdown',event=>{
    if(event.target.id!=='archive-time'||focused)return;
    field=event.target;
    before=measure();
    report.hidden=true;
  },true);
  document.addEventListener('focusin',event=>{
    if(event.target.id!=='archive-time')return;
    if(field!==event.target){field=event.target;before=measure();}
    focused=true;
    during=null;
    sample();
  });
  viewport.addEventListener('resize',sample);
  viewport.addEventListener('scroll',sample);
  document.addEventListener('focusout',event=>{
    if(event.target!==field||!focused)return;
    sample();
    focused=false;
    const format=m=>`×${m.scale.toFixed(2)}  ${Math.round(m.width)}×${Math.round(m.height)}  шир. ${m.layout}/${m.scroll}  срез ${Math.round(m.clipped)}`;
    report.textContent=`Время · шрифт ${during.font}\nДо:    ${format(before)}\nВвод:  ${format(during)}`;
    report.hidden=false;
  });
}
installArchiveViewportCheck();
init();
})();
