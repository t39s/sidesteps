(() => {
'use strict';
const M=window.ILModel,$=id=>document.getElementById(id),app=$('app');
let settingsFrom='athlete',settingsDraft=[],restWarningWorkout=null,pendingAttemptVoice=null;
let db=null,config=null,screen='boot',run=null,viewId=null,lastResultId=null,resultUntil=0,trainerUnlocked=false,returnFromHistory='athlete',returnFromPin=null,showAll=false,showAllPersonal=false,personalFlashTimer=null,voiceSerial=0,voicePending=0,voiceNow=null,voiceQueue=[],voiceWaiters=[],toastTimeout=null,renderError=null,restBypassedWorkout=null,wakeLock=null;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=(tag,attrs='',body='')=>`<${tag} ${attrs}>${body}</${tag}>`;
const b=(label,act,cl='',attrs='')=>`<button type="button" class="${cl}" data-act="${act}" ${attrs}>${label}</button>`;
const card=(html,cl='')=>`<section class="panel ${cl}">${html}</section>`;
const muted=text=>`<div class="note">${text}</div>`;
const dateTime=x=>M.datetime(x);
const athlete=id=>db.athletes.find(x=>x.id===id)||{name:'Неизвестный спортсмен'};
const currentAthlete=()=>db.device.trainerActivated?db.device.trainerAthleteId:db.device.selectedAthleteId;
const isChild=()=>db.device.lastInterface==='child';
const trainerMode=()=>['child','trainer'].includes(db.device.lastInterface);
const settingsUnavailable=()=>trainerMode()||screen==='pin';
const soundAvailable=()=>!renderError&&config?.audioPolicy==='user-controllable';
const sound=()=>soundAvailable()&&db.device.soundEnabled;
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
function operate(action){const r=action(db);localStorage.setItem(M.KEY,JSON.stringify(r.state));db=r.state;return r.value;}
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
  if(a.recordEvent)queueVoice('Новый рекорд!');
}
function validateConfig(c){if(!c||!Number.isSafeInteger(c.minTapGapMs)||c.minTapGapMs<0||c.minTapGapMs>60000)throw Error('minTapGapMs: целое 0–60000');if(!Number.isSafeInteger(c.intervalCount)||c.intervalCount<1||c.intervalCount>200)throw Error('intervalCount: целое 1–200');if(!Number.isSafeInteger(c.attemptCancelWindowSec)||c.attemptCancelWindowSec<1||c.attemptCancelWindowSec>60)throw Error('attemptCancelWindowSec: целое 1–60');if(!Number.isSafeInteger(c.restDurationSec)||c.restDurationSec<0||c.restDurationSec>600)throw Error('restDurationSec: целое 0–600');if(![5,10,15].includes(c.resultDisplaySec))throw Error('resultDisplaySec: 5, 10 или 15');if(![5,10,15].includes(c.recordDisplaySec))throw Error('recordDisplaySec: 5, 10 или 15');if(!['off','user-controllable'].includes(c.audioPolicy))throw Error('audioPolicy: off или user-controllable');if(c.trainerAccess!==null&&c.trainerAccess!==undefined){let p=c.trainerAccess;if(p.algorithm!=='PBKDF2-SHA256'||!Number.isInteger(p.iterations)||p.iterations<100000||p.iterations>1000000||!p.saltB64||!p.verifierB64)throw Error('Недопустимый verifier PIN');}return c;}
async function pinMatches(pin){if(!config.trainerAccess)return false;const p=config.trainerAccess;const bytes=str=>Uint8Array.from(atob(str),c=>c.charCodeAt(0));const enc=new TextEncoder().encode(pin);const key=await crypto.subtle.importKey('raw',enc,'PBKDF2',false,['deriveBits']);const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(p.saltB64),iterations:p.iterations,hash:'SHA-256'},key,256));const expected=bytes(p.verifierB64);if(bits.length!==expected.length)return false;let diff=0;for(let i=0;i<bits.length;i++)diff|=bits[i]^expected[i];return diff===0;}
async function init(){let recoveredTimeoutId=null;try{let response=await fetch('./config.json',{cache:'no-store'});if(!response.ok)throw Error('Не удалось загрузить config.json');config=validateConfig(await response.json());}catch(e){renderError=e.message;}
  try{
    const migration=window.SideMigration.run(localStorage,M);
    if(migration.blocked)throw Error('Найдена история Interval Lab. Для выбора одного спортсмена откройте https://t39s.github.io/dev-sandbox/interval-lab/ и выполните перенос оттуда.');
    const current=localStorage.getItem(M.KEY);
    if(current)db=M.validate(JSON.parse(current));
    else{db=M.blank();localStorage.setItem(M.KEY,JSON.stringify(db));}
    const formerId=db.device.activeWorkoutId;
    const recovered=M.recover(db);
    const startup=M.mutation(recovered.state,state=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(state.device.launchAnimationFirstDay||''))state.device.launchAnimationFirstDay=localDay();
      state.device.soundEnabled=false;
      state.device.soloPlannedAttempts=2;
      state.device.soloMeasurementMode='intervals';
      // The active workout keeps its measurement mode across recovery.
      if(!state.device.activeWorkoutId&&!M.currentChild(state))state.device.measurementMode='intervals';
    });
    localStorage.setItem(M.KEY,JSON.stringify(startup.state));
    db=startup.state;
    const former=M.workoutOf(db,formerId);
    if(former&&former.status==='completed'&&former.closeReason==='timeout')recoveredTimeoutId=former.id;
  }catch(e){renderError='Не удалось открыть историю: '+e.message+'. Данные не перезаписаны.';db=M.blank();}
  if(!renderError){if(db.device.lastInterface==='trainer'){screen='pin';}else if(db.device.lastInterface==='child'){const c=M.currentChild(db),turn=M.nextTurn(db),w=M.workoutOf(db,turn?.workoutId);screen=c?'child-ready':'child-final';if(c?.athleteIds.length===1 && turn?.ordinal===2 && w?.firstEndedAt && remainingRest(w)>0)screen='rest';if(!db.device.childParticipants.length)screen='athlete';}else{const w=M.workoutOf(db,db.device.activeWorkoutId);if(w&&w.status!=='completed'){screen=M.completed(db,w).length?'rest':'athlete-ready';}else screen='athlete';}if(recoveredTimeoutId&&db.device.lastInterface==='athlete'){viewId=recoveredTimeoutId;screen='final';}}
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
  return !renderError&&(['athlete-ready','child-ready','result','rest','final','child-final'].includes(current)||(db.device.lastInterface==='trainer'&&trainerUnlocked&&M.currentChild(db)));
}
function currentTrainingWorkout(){
  if(run)return M.workoutOf(db,M.attemptOf(db,run.id)?.workoutId);
  if(trainingContext()==='result')return M.workoutOf(db,M.attemptOf(db,lastResultId)?.workoutId);
  const c=M.currentChild(db);
  return M.workoutOf(db,c?M.nextTurn(db)?.workoutId:db.device.activeWorkoutId);
}
function cancelLaunchAvailable(){return !!run&&performance.now()-run.start<config.attemptCancelWindowSec*1000;}
function partialMeasurement(){return {elapsedMs:Math.max(0,Math.floor(performance.now()-run.start),run.intervals.reduce((x,y)=>x+y,0)),intervalsMs:[...run.intervals]};}
function header(context='',actions='',homeLink=false,belowBrand=''){
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
  const settingsButton=settingsUnavailable()
    ?b(gear,'settings','header-icon settings-icon','aria-label="Настройки" disabled')
    :screen==='settings'
    ?b(gear,'settings-back','header-icon settings-icon settings-return','aria-label="Назад из настроек"')
    :b(gear,'settings','header-icon settings-icon','aria-label="Настройки"');
  const close=trainingScreen()?`<span class="header-icon-slot">${b('<svg class="close-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg>','end-training','header-icon close-training','aria-label="Завершить тренировку" title="Завершить тренировку"')}</span>`:'';
  const controls=`<div class="toolbar header-controls${close?' training-controls':''}"><span class="header-icon-slot">${soundControl()}</span><span class="header-icon-slot">${settingsButton}</span>${close}</div>`;
  if(!belowBrand&&db.device.lastInterface==='child'&&screen!=='pin'&&!(screen==='settings'&&settingsFrom==='pin'))belowBrand='<a href="#admin-login" data-act="pin" class="mode-tag header-login">Войти</a>';
  const label='Приставные шаги<br>на время';
  const brand=homeLink?`<a class="brand brand-home" href="./" data-act="final-home">${label}</a>`:`<div class="brand">${label}</div>`;
  return `<header class="app-head"><div>${brand}${context?`<div class="mode-tag">${esc(context)}</div>`:''}${belowBrand}</div>${controls}${actions?`<div class="toolbar header-actions">${actions}</div>`:''}</header>`;
}
function row(label,value){return `<div class="list-row"><span>${label}</span><strong>${value}</strong></div>`;}
function soloPlannedAttempts(){return db.device.soloPlannedAttempts===1?1:2;}
function soloMeasurementMode(){return db.device.soloMeasurementMode==='stopwatch'?'stopwatch':'intervals';}
function chooseAttempts(count=2){return `<label for="attempt-count">Попыток в тренировке</label><select id="attempt-count"><option value="2" ${count===2?'selected':''}>2 попытки (по умолчанию)</option><option value="1" ${count===1?'selected':''}>1 попытка</option></select>`;}
function chooseMode(mode=db.device.measurementMode,intervalLabel='С отсечками'){return `<label for="mode-select">Режим измерения</label><select id="mode-select"><option value="intervals" ${mode==='intervals'?'selected':''}>${intervalLabel}</option><option value="stopwatch" ${mode==='stopwatch'?'selected':''}>Старт–Стоп</option></select>`;}
function intervalCountLabel(count){
  const last=count%10;
  const teens=count%100>=11&&count%100<=14;
  const noun=teens?'отсечек':last===1?'отсечка':last>=2&&last<=4?'отсечки':'отсечек';
  return `${count} ${noun} (по умолчанию)`;
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
function remainingRest(w){return Math.max(0,Date.parse(w.firstEndedAt)+config.restDurationSec*1000-Date.now());}
function soloReady(){
  const workout=M.workoutOf(db,db.device.activeWorkoutId);
  const attempt=workout?M.completed(db,workout).length+1:1;
  const count=workout?.plannedAttempts??soloPlannedAttempts();
  const mode=workout?db.device.measurementMode:soloMeasurementMode();
  return header()+
    card(`<h1 class="hero-title center">Попытка ${attempt} из ${count}</h1>`)+
    measureSurface(true,mode);
}
function localDay(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function launchAnimation(){
  if(['glow','pulse','none'].includes(db.device.launchAnimation))return db.device.launchAnimation;
  return localDay()>(db.device.launchAnimationFirstDay||localDay())?'glow':'pulse';
}
function refreshLaunchAnimation(){
  const selected=launchAnimation(),glyph=app.querySelector('[data-launch-animation]');
  const className='counter counter-ready launch-'+selected;
  if(glyph&&glyph.className!==className)glyph.className=className;
  for(const input of app.querySelectorAll?.('input[name="launch-animation"]')||[])input.checked=input.value===selected;
}
function measureSurface(personal=false,mode=db.device.measurementMode){
  const running=!!run,intervals=running?run.intervals.length:0;
  const sec=elapsedSeconds(running?performance.now()-run.start:0,true);
  const play=`<div class="counter counter-ready launch-${launchAnimation()}" data-launch-animation aria-hidden="true"><span class="play-glyph"></span></div>`;
  const counter=!running?play:mode==='intervals'
    ?`<div class="counter" data-digits="${String(intervals).length}">${intervals}</div>`
    :`<div class="stopwatch-counter" data-elapsed>${sec} с</div>`;
  return `<div class="tap-surface personal-measure" data-tap="1" role="button" tabindex="0" aria-label="${running?(mode==='intervals'?'Отсечка или стоп':'Остановить измерение'):'Начать измерение'}">${counter}${mode==='intervals'?`<div class="secondary-display">${intervals} / ${run?run.target:config.intervalCount} интервалов</div>`:''}${mode==='intervals'||!running?`<div class="secondary-display" data-elapsed>${sec} с</div>`:''}</div>${cancelLaunchAvailable()?`<div class="buttons" data-cancel-launch>${b('Отменить запуск','cancel-launch','wide')}</div>`:''}`;
}

function childReady(){const c=M.currentChild(db);if(!c)return childFinal();const turn=M.nextTurn(db);if(!turn)return childFinal();const w=M.workoutOf(db,turn.workoutId);if(c.athleteIds.length===1&&turn.ordinal===2&&w?.firstEndedAt&&config){const restLeft=remainingRest(w);if(restLeft>0&&restBypassedWorkout!==w.id)return restScreen(true,w);}
  return header()+card(`<h1 class="hero-title center">Попытка ${turn.ordinal} из ${c.plannedAttempts}</h1><div class="center muted participant-name">${esc(athlete(turn.athleteId).name)}</div>`)+measureSurface(true);
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
    const duration=a.recordEvent?config.recordDisplaySec:config.resultDisplaySec;
    resultUntil=Date.now()+duration*1000;
  }
  const w=M.workoutOf(db,a.workoutId),c=M.currentChild(db);
  const rests=w.status==='pending'&&w.plannedAttempts===2;
  const participant=isChild()?`<div class="center muted participant-name">${esc(athlete(a.athleteId).name)}</div>`:'';
  const title=card(`<h1 class="hero-title center">Попытка ${a.ordinal}</h1>${participant}`);
  const result=card(`<div class="display">${M.fmt(a.totalMs)}</div>${a.recordEvent?'<div class="record">★ Новый рекорд!</div>':''}`,'attempt-result half-attempt');
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
  if(!allowed.length)return header()+card('<h2>Сеанс не выбран</h2><p>Администратор должен выбрать участника.</p>');
  const aid=allowed.includes(db.device.viewAthleteId)?db.device.viewAthleteId:allowed.at(-1);
  const session=latestChildSession();
  const workout=session?.workoutIds.map(id=>M.workoutOf(db,id)).find(w=>w?.athleteId===aid);
  const summary=workout&&M.completed(db,workout).length?card(workoutSummary(aid,workout)+workoutDetails(workout,M.best(db,workout),true)):'';
  return header('','',false,'<a href="#admin-login" data-act="pin" class="mode-tag header-login">Войти</a>')+card('<h1 class="hero-title center">Тренировка завершена</h1>')+
    athleteTabs(allowed,aid,'child-view')+profilePanel(aid,
      summary+card('<h2>Мой прогресс</h2>'+graphic(M.renderChartData(db,aid),false,recordAsOf(aid))))+
    `<div class="buttons">${b('История','history-child','wide nav-return')}</div>`;
}

function finalAdult(){
  const workout=M.workoutOf(db,viewId);
  if(!workout)return adultHome();
  const summary=workoutSummary(workout.athleteId,workout);
  const points=M.renderChartData(db,workout.athleteId);
  return header('','',true)+card('<h1 class="hero-title center">Тренировка завершена</h1>')+
    card(summary+workoutDetails(workout,M.best(db,workout),true))+
    card('<h2>Мой прогресс</h2>'+graphic(points,false,recordAsOf(workout.athleteId)))+
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
  const bars=visible.map((p,i)=>{const x=left+slot*(i+.5),w=slot*.63,yy=y(p.ms),color=p.ms===best?'#ffd166':'#83def3';const label=(p.ms/1000).toFixed(1).replace('.',',');return `<g class="chart-bar"><title>${esc(M.datetime(p.when))}: ${esc(M.fmt(p.ms))}</title><rect x="${x-w/2}" y="${yy}" width="${w}" height="${Math.max(.8,floor-yy)}" rx="3" fill="${color}"/><text x="${x}" y="${Math.max(top+3,yy-5)}" text-anchor="middle" class="chart-value">${label}</text><text x="${x}" y="${H-15}" text-anchor="middle" class="chart-date">${esc(M.date(p.when))}</text></g>`;}).join('');
  const averageLine=average===null?'':`<line class="chart-average" x1="${left}" y1="${y(average)}" x2="${W-right}" y2="${y(average)}" stroke="#ffd166" stroke-width="1.4"><title>Среднее по всем тренировкам: ${esc(M.fmt(Math.round(average)))}</title></line>`;
  const chart=`<svg class="chart"${scrollable?` style="width:${W}px"`:''} viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Столбчатый график последних ${visible.length} завершённых тренировок, в секундах, ось от нуля${average===null?'':`, среднее по всем тренировкам ${esc(M.fmt(Math.round(average)))}`}">${lines}${averageLine}${bars}${scrollable?'':labels}</svg>`;
  if(scrollable)return `<div class="history-chart"><svg class="history-chart-axis" viewBox="0 0 40 ${H}" aria-hidden="true">${labels}</svg><div class="chart-scrollable" tabindex="0" role="region" aria-label="Диаграмма прогресса">${chart}</div></div>`;
  return `<div class="chart-wrap">${chart}</div>`;
}
function recordAsOf(athleteId){return M.baseline(db,athleteId);}
function workoutSummary(athleteId,workout,heading=false){
  const workouts=M.publicWorkouts(db,athleteId);
  const record=recordAsOf(athleteId);
  const attempts=workout?M.completed(db,workout):[];
  const best=workout?M.best(db,workout):null;
  const improvements=attempts.filter(a=>a.recordEvent&&a.previousRecordMs!==null);
  const subtitle=workout?`Тренировка ${esc(M.datetime(workout.createdAt))}`:'Пока нет тренировок';
  const firstOnly=workouts.length===1&&!db.archived.some(a=>a.athleteId===athleteId);
  const title=heading?`<h2>${subtitle}</h2>`:`<div class="muted">${subtitle}</div>`;
  return `${title}${best!==null&&best!==undefined?`<div class="metric"><span>Лучшее время</span><strong>${recordTime(best,athleteId,attempts.some(a=>a.recordEvent))}</strong></div>`:''}${attempts.some(a=>a.recordEvent)?'<div class="record">★ Новый рекорд!</div>':''}${improvements.length?`<div class="note">Улучшение на ${M.fmt(Math.max(...improvements.map(a=>a.previousRecordMs-a.totalMs)))}</div>`:''}${record!==null?row(firstOnly?'Исходный результат':'Рекорд',M.fmt(record)):''}`;
}
function progress(athleteId,child=false,separate=false){
  const last=M.publicWorkouts(db,athleteId).at(-1);
  const points=M.renderChartData(db,athleteId);
  const summary=workoutSummary(athleteId,last,separate);
  const chart='<h2>Мой прогресс</h2>'+graphic(points,separate);
  const workouts=historyItems(athleteId,child,separate);
  if(separate)return card(summary+(last?workoutDetails(last,M.best(db,last),true):''))+card(chart)+card(workouts);
  return card(`${summary}<div class="progress-chart">${chart}</div>${workouts}`);
}

function intervalDetails(a,sharedMax){if(a.mode!=='intervals'||!a.intervalsMs?.length)return '';const max=sharedMax??Math.max(...a.intervalsMs);return `<details><summary>Время каждого интервала (${a.intervalsMs.length})</summary><div class="stack">${a.intervalsMs.map((ms,i)=>`<div><div class="row between small"><span>Интервал ${i+1}</span><strong>${M.fmt(ms)}</strong></div><div style="height:8px;border-radius:4px;background:#0e2033;overflow:hidden"><div style="height:100%;background:#83def3;width:${(ms/Math.max(1,max)*100).toFixed(1)}%"></div></div></div>`).join('')}</div></details>`;}
function recordTime(ms,athleteId,wasRecord=false){
  const current=ms===recordAsOf(athleteId);
  return current||wasRecord
    ?`<span class="record">${M.fmt(ms)} <span aria-label="${current?'Личный рекорд':'Рекорд на момент попытки'}">★</span></span>`
    :M.fmt(ms);
}
function workoutDetails(workout,best,sharedScale){
  const attempts=M.completed(db,workout);
  const intervals=sharedScale?attempts.flatMap(a=>a.mode==='intervals'?(a.intervalsMs??[]):[]):[];
  const sharedMax=sharedScale?Math.max(1,...intervals):undefined;
  return `<details><summary>Подробнее</summary><div class="note">${esc(M.datetime(workout.createdAt))}</div>${attempts.map(a=>row(`Попытка ${a.ordinal}`,recordTime(a.totalMs,a.athleteId,a.recordEvent)+(attempts.length>1&&a.totalMs===best&&!a.recordEvent&&a.totalMs!==recordAsOf(a.athleteId)?'<span aria-label="Лучшая попытка"> ★</span>':''))+intervalDetails(a,sharedMax)).join('')}</details>`;
}
function historyItems(aid,child=false,personal=false){
  const ordered=[...M.publicWorkouts(db,aid)].reverse();
  const completedCount=ordered.length;
  if(personal)ordered.shift();
  const limited=personal?!showAllPersonal:child&&!showAll;
  const show=limited?ordered.slice(0,5):ordered;return `<h2>Тренировки</h2>${!ordered.length?muted(personal?'Нет предыдущих тренировок':'Нет завершённых тренировок'):''}<div class="history-list">${show.map(w=>{const bs=M.best(db,w);return `<div class="history-item"><div class="row between"><span class="muted">${esc(M.date(w.createdAt))}</span><strong>${recordTime(bs,aid,M.completed(db,w).some(a=>a.recordEvent))}</strong></div>${workoutDetails(w,bs,personal)}</div>`;}).join('')}${personal&&ordered.length>5?b(limited?`Все тренировки (${completedCount})`:'5 тренировок','personal-history-all','wide',`aria-expanded="${!limited}"`):''}</div>${db.archived.filter(a=>a.athleteId===aid).length?`<h2>Исторический архив</h2>${db.archived.filter(a=>a.athleteId===aid).map(a=>`<div class="history-item"><span>${esc(a.date)} · </span><strong>${recordTime(a.bestMs,aid)}</strong><span class="note"> · архив без отдельных попыток</span></div>`).join('')}`:''}${!personal&&limited&&ordered.length>5?b('Вся история','history-all','wide'):''}`;}
function historyScreen(){
  const mode=db.device.lastInterface;
  const aid=mode==='child'||mode==='trainer'?db.device.viewAthleteId:currentAthlete();
  const trainerHistory=mode==='child'||mode==='trainer';
  if(!trainerHistory)return header('',b('Назад','back-history','small'))+historyContent(aid);
  const ids=mode==='trainer'&&trainerUnlocked?db.athletes.map(a=>a.id):db.device.childParticipants;
  const selected=ids.includes(aid)?aid:ids[0];
  return header('','',false,'<a href="#admin-login" data-act="pin" class="mode-tag header-login">Войти</a>')+
    athleteTabs(ids,selected,'history-profile')+profilePanel(selected,historyContent(selected,mode==='child',trainerUnlocked&&mode==='trainer'));
}
function historyContent(aid,child=false,trainer=false){
  return `${progress(aid,child,true)}${trainer?interruptedAttempts(aid):''}${!child&&db.incomplete.some(a=>a.athleteId===aid)?card('<h2>Ранее неполные попытки</h2>'+db.incomplete.filter(a=>a.athleteId===aid).map(a=>`<div class="list-row"><span>${esc(M.datetime(a.startedAt))} · не зачтена</span>${b('Удалить','delete-incomplete','danger small',`data-id="${esc(a.id)}"`)}</div>`).join('')):''}${trainer?adminHistory(aid):''}`;
}

function interruptedAttempts(aid){
  const interrupt=db.attempts.filter(a=>a.athleteId===aid&&a.status==='interrupted');
  return card(`<h2>Прерванные попытки</h2>${interrupt.length?interrupt.map(a=>`<div class="list-row"><span>${esc(M.datetime(a.startedAt))}</span>${b('Удалить','delete-interrupted','danger small',`data-id="${esc(a.id)}"`)}</div>`).join(''):muted('Прерванных попыток нет')}`);
}
function animationSettings(){
  const selected=launchAnimation();
  return card('<h2 id="launch-animation-title">Анимация запуска</h2><div class="animation-options" role="group" aria-labelledby="launch-animation-title">'+
    [['glow','Сияние'],['pulse','Пульсация'],['none','Без анимации']].map(([value,label])=>
      `<label class="animation-option"><span class="animation-sample" aria-hidden="true"><span class="counter-ready launch-${value}"><span class="play-glyph"></span></span></span><span>${label}</span><input type="radio" name="launch-animation" value="${value}" ${value===selected?'checked':''}></label>`).join('')+'</div>');
}
function appSettings(){
  const fromPersonalHistory=db.device.lastInterface==='athlete'&&['history','athlete'].includes(settingsFrom);
  return header()+
    '<h1 class="settings-title">Настройки</h1>'+
    (renderError?card(muted('Настройки недоступны, пока приложение не откроется.')):
    card('<h2>Тренировка</h2>'+chooseAttempts(soloPlannedAttempts())+chooseMode(soloMeasurementMode(),intervalCountLabel(config.intervalCount)))+
    animationSettings()+
    (fromPersonalHistory?
      card('<h2>Мои данные</h2><div class="buttons">'+b('Сохранить','export-json','wide')+b('Загрузить','import-json','wide')+'</div><p class="note center">Данные хранятся на&nbsp;устройстве.</p><input type="file" id="file-import" accept=".json,application/json" hidden>')+
      interruptedAttempts(currentAthlete()):''))+
    `<div class="buttons">${b('Назад','settings-back','wide nav-return')}</div>`;
}
function adminHistory(aid){return card(`<h2>Управление историей</h2>${db.workouts.filter(w=>w.athleteId===aid).map(w=>`<div class="list-row"><span>${esc(M.datetime(w.createdAt))} · ${w.status}</span>${b('Удалить','delete-workout','danger small',`data-id="${esc(w.id)}"`)}</div>`).join('')}${db.attempts.filter(a=>a.athleteId===aid&&a.status==='completed').map(a=>`<div class="list-row"><span>Попытка ${a.ordinal} · ${M.fmt(a.totalMs)}</span>${b('Удалить','delete-attempt','danger small',`data-id="${esc(a.id)}"`)}</div>`).join('')}${db.archived.filter(x=>x.athleteId===aid).map(x=>`<div class="list-row"><span>Архив ${esc(x.date)} · ${M.fmt(x.bestMs)}</span>${b('Удалить','delete-archived','danger small',`data-id="${esc(x.id)}"`)}</div>`).join('')}`);}
function trainerHome(){const c=M.currentChild(db),options=db.athletes.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');const title=header('Администратор',`<a href="#exit" data-act="switch-athlete" class="mode-tag trainer-exit">Выйти</a>`+b('К занятию','go-child','small'))+`<h1 class="hero-title">Управление занятием</h1>`;if(c)return title+card(`<h2>Занятие идёт</h2><p>${c.athleteIds.map(id=>esc(athlete(id).name)).join(' → ')}</p><p>Следующая попытка: ${c.nextIndex+1} из ${c.sequence.length}</p>${b('Вернуться к занятию','go-child','primary wide')}<div class="buttons">${b('Принудительно завершить','force-child','danger wide')}</div>`);
  return title+card(`<h2>Подготовить занятие</h2><label>Участник А<select id="trainer-a">${options}</select></label><label>Участник Б<select id="trainer-b"><option value="">Нет — один участник</option>${options}</select></label>${chooseAttempts()}${chooseMode()}<div class="buttons">${b('Начать занятие','start-child','primary wide')}</div>`)+card(`<h2>Спортсмены</h2>${db.athletes.map(a=>`<div class="list-row"><span>${esc(a.name)}</span>${b('История','trainer-history','small',`data-id="${esc(a.id)}"`)} ${db.athletes.length>1?b('Удалить','delete-athlete','danger small',`data-id="${esc(a.id)}"`):''}</div>`).join('')}<label>Добавить спортсмена<input id="new-athlete" maxlength="50" placeholder="Имя"></label><div class="buttons">${b('Добавить','add-athlete','primary')}</div><label>Мой профиль спортсмена<select id="coach-athlete">${db.athletes.map(a=>`<option value="${esc(a.id)}" ${a.id===db.device.trainerAthleteId?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>`)+card(`<h2>Добавить архивный результат</h2><p class="note">Историческое время без отдельных попыток. Не редактирует уже измеренные значения.</p><label>Спортсмен<select id="archive-athlete">${options}</select></label><label>Дата<input type="date" id="archive-date"></label><label>Время, секунды<input type="text" id="archive-time" inputmode="decimal" placeholder="Например 23,567"></label><div class="buttons">${b('Добавить в архив','add-archive','primary')}</div>`)+card(`<h2>Резервные копии</h2><div class="buttons">${b('Экспорт JSON','export-json')} ${b('Импорт JSON','import-json')} ${b('Удалить все локальные данные','reset-all','danger')}</div><input id="file-import" type="file" accept=".json,application/json" hidden>`);
}
function pinScreen(){return header()+card(`<h2>Вход администратора</h2>${!config?.trainerAccess?`<div class="error">PIN пока не сконфигурирован. Разработчик должен записать проверочный хеш PIN, выбранного администратором, в config.json.</div>`:`<label>PIN-код<input type="password" id="pin-input" inputmode="numeric" autocomplete="off" maxlength="32" placeholder="PIN"></label><div class="buttons">${b('Войти','pin-submit','primary wide')}</div>`}`)+b('Назад','pin-back','wide');}
function render(){if(!db)return;document.body?.classList.toggle('trainer-theme',['child','trainer'].includes(db.device.lastInterface));const previousPlot=app.querySelector('.chart-scrollable[data-positioned]');const plotOffset=previousPlot?.scrollLeft;let html='';if(screen==='settings')html=appSettings();else if(renderError)html=header()+card(`<div class="error">${esc(renderError)}</div>${renderError.includes('Interval Lab')||renderError.includes('перенос')?'<div class="buttons"><a class="primary wide" href="https://t39s.github.io/dev-sandbox/interval-lab/">Открыть Interval Lab для переноса</a></div>':`<div class="buttons">${b('Экспортировать текущие данные','export-json')}</div>`}`);else if(screen==='pin')html=pinScreen();else if(screen==='trainer')html=trainerUnlocked?trainerHome():pinScreen();else if(screen==='athlete')html=adultHome();else if(screen==='athlete-ready')html=soloReady();else if(screen==='child-ready')html=childReady();else if(screen==='child-final')html=childFinal();else if(screen==='result')html=resultScreen();else if(screen==='rest'){const c=M.currentChild(db),turn=M.nextTurn(db);const w=c?M.workoutOf(db,turn?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);html=restScreen(!!c,w);}else if(screen==='final')html=finalAdult();else if(screen==='history')html=historyScreen();else html=adultHome();const previousScreen=screen==='settings'?settingsFrom:screen;const showAdminLogin=!['child','trainer'].includes(db.device.lastInterface)&&!renderError&&previousScreen!=='pin'&&previousScreen!=='trainer'&&db.device.lastInterface!=='trainer';app.innerHTML=`<main class="shell">${html}<footer class="nav-spacer app-footer"><span class="app-version">sidesteps v. 0.2.11-rc.5</span>${showAdminLogin?' <span aria-hidden="true">·</span> <a href="#admin-login" data-act="pin" title="Для администратора">Войти</a>':''}</footer></main>`;
  const plot=app.querySelector('.chart-scrollable');
  if(plot?.clientWidth&&plotOffset!==undefined){
    plot.scrollLeft=plotOffset;
    plot.dataset.positioned='true';
  }
  initializeProgressScroll();
}
function go(newScreen,lastInterface=null){if(lastInterface){change(n=>{n.device.lastInterface=lastInterface;});}
  if(newScreen==='child-ready'){
    const c=M.currentChild(db),turn=M.nextTurn(db),w=M.workoutOf(db,turn?.workoutId);
    if(c?.athleteIds.length===1 && turn?.ordinal===2 && w?.firstEndedAt && restBypassedWorkout!==w.id && remainingRest(w)>0)newScreen='rest';
  }
  screen=newScreen;render();}
function bestPreviousBeforeAttempt(a){return a.recordEvent;}
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
    const a=operate(s=>{
      if(w)return M.startAttempt(s,w.id,s.device.measurementMode,config.intervalCount,date);
      const mode=soloMeasurementMode();
      const workout=M.startSolo(s,currentAthlete(),soloPlannedAttempts());
      workout.state.device.measurementMode=mode;
      return M.startAttempt(workout.state,workout.value.id,mode,config.intervalCount,date);
    });
    run={id:a.id,start:now,lastAccepted:now,intervals:[],mode:a.mode,target:config.intervalCount,lastCheckpoint:now};
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
  try{const closed=M.expireSolo(db,Date.now());if(closed){localStorage.setItem(M.KEY,JSON.stringify(closed.state));db=closed.state;viewId=closed.value.id;run=null;if(screen==='settings')settingsFrom='final';else screen='final';resetVoice();message('Тренировка завершена. Сохранён результат первой попытки.');render();return;}}catch(e){fail(e);}
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
 switch(name){
 case 'cancel-launch':{
   if(!cancelLaunchAvailable())return;
   const partial=partialMeasurement(),a=operate(s=>M.cancelAttempt(s,run.id,partial.elapsedMs,partial.intervalsMs,config.attemptCancelWindowSec));
   run=null;releaseWakeLock();resetVoice();restBypassedWorkout=null;
   const w=M.workoutOf(db,a.workoutId),c=M.currentChild(db);
   go(w.firstEndedAt&&remainingRest(w)>0&&(!c||c.athleteIds.length===1)?'rest':c?'child-ready':'athlete-ready');return;
 }
 case 'end-training':{
   if(!trainingScreen())return;
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
   settingsFrom=screen;
   settingsDraft=['pin','trainer'].includes(screen)
     ? Array.from(app.querySelectorAll('input[id]:not([type="file"]),select[id]'),field=>[field.id,field.value])
     : [];
   go('settings');
   return;
 }
 case 'settings-back':{
   const previous=settingsFrom;
   const draft=settingsDraft;
   settingsDraft=[];
   go(previous);
   for(const [id,value] of draft){
     const field=$(id);
     if(field)field.value=value;
   }
   app.querySelector('[data-act="settings"]')?.focus();
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
 case 'pin':returnFromPin=screen;go('pin');return;
 case 'pin-back':if(returnFromPin){const previous=returnFromPin;returnFromPin=null;go(previous);return;}if(db.device.lastInterface==='trainer'&&!trainerUnlocked){go('athlete','athlete');return;}go(db.device.lastInterface==='child'?(M.currentChild(db)?'child-ready':'child-final'):(db.device.lastInterface==='trainer'?'trainer':'athlete'));return;
 case 'pin-submit':{const code=$('pin-input')?.value||'';if(!await pinMatches(code)){message('Неверный PIN');return;}returnFromPin=null;trainerUnlocked=true;change(n=>{n.device.trainerActivated=true;n.device.lastInterface='trainer';});go('trainer');return;}
 case 'switch-athlete':{if(M.currentChild(db)){message('Сначала завершите занятие');return;}trainerUnlocked=false;change(n=>{n.device.lastInterface='athlete';});go('athlete');return;}
 case 'go-child':{if(!db.device.trainerActivated)return;trainerUnlocked=false;change(n=>{n.device.lastInterface='child';});go(M.currentChild(db)?'child-ready':'child-final');return;}
 case 'open-exercise':go('athlete-ready');app.querySelector('[data-tap]')?.focus();return;
 case 'final-home':showAllPersonal=false;viewId=null;lastResultId=null;go('athlete');return;
 case 'resume-legacy':{const wid=button.dataset.id;const w=M.workoutOf(db,wid);if(!w||w.status!=='legacy_pending'||w.athleteId!==currentAthlete())return;change(n=>{n.device.activeWorkoutId=wid;});go('athlete-ready');return;}
 case 'start-child':{const a=$('trainer-a').value,bb=$('trainer-b').value,ids=bb?[a,bb]:[a],count=Number($('attempt-count').value);const mode=$('mode-select').value;change(n=>{n.device.measurementMode=mode;});operate(s=>M.startChild(s,ids,count));trainerUnlocked=false;go('child-ready');queueVoice(athlete(ids[0]).name);return;}
 case 'force-child':{if(!trainerUnlocked||(!run&&!window.confirm('Завершить занятие, сохранив выполненные попытки?')))return;await handleAction('end-training');return;}
 case 'rest-early':if(screen==='result'||screen==='rest'||screen==='child-ready'){const c=M.currentChild(db);const w=c?M.workoutOf(db,M.nextTurn(db)?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);restBypassedWorkout=w?.id||null;screen=c?'child-ready':'athlete-ready';resetVoice();render();}return;
 case 'history-athlete':returnFromHistory=screen;go('history');return;
 case 'history-child':returnFromHistory=screen;go('history');return;
 case 'personal-history-all':showAllPersonal=!showAllPersonal;render();app.querySelector('[data-act="personal-history-all"]')?.focus();return;
 case 'history-all':showAll=true;render();return;
 case 'back-history':showAll=false;go(returnFromHistory==='trainer'?'trainer':db.device.lastInterface==='child'?(M.currentChild(db)?'child-ready':'child-final'):(db.device.activeWorkoutId?'athlete-ready':'athlete'));return;
 case 'history-profile':{const ids=trainerUnlocked&&db.device.lastInterface==='trainer'?db.athletes.map(a=>a.id):db.device.childParticipants;const aid=button.dataset.id;if(!ids.includes(aid))return;change(n=>{n.device.viewAthleteId=aid;});showAllPersonal=false;render();app.querySelector('[role="tab"][aria-selected="true"]')?.focus();return;}
 case 'child-view':{if(M.currentChild(db))return;let aid=button.dataset.id;if(!db.device.childParticipants.includes(aid))return;change(n=>{n.device.viewAthleteId=aid;});go('child-final');app.querySelector('[role="tab"][aria-selected="true"]')?.focus();return;}
 case 'trainer-history':{if(!trainerUnlocked)return;const aid=button.dataset.id;change(n=>{n.device.viewAthleteId=aid;});returnFromHistory='trainer';go('history');return;}
 case 'add-archive':{if(!trainerUnlocked)return;const aid=$('archive-athlete').value,day=$('archive-date').value,raw=$('archive-time').value.trim().replace(',','.');const num=Number(raw);if(!raw||!Number.isFinite(num)||num<=0)throw Error('Некорректное время архива');operate(s=>M.addArchived(s,aid,day,Math.round(num*1000)));render();return;}
 case 'add-athlete':{if(!trainerUnlocked)return;const name=$('new-athlete').value;operate(s=>M.addAthlete(s,name));render();return;}
 case 'reset-all':{if(!trainerUnlocked||!window.confirm('Удалить ВСЕ локальные данные и профили с этого устройства?')||!window.confirm('Подтвердите необратимый сброс. Сделайте экспорт перед удалением.'))return;const cleared=M.blank();cleared.device.launchAnimationFirstDay=localDay();localStorage.setItem(M.KEY,JSON.stringify(cleared));db=cleared;localStorage.removeItem(M.LEGACY_KEY);trainerUnlocked=false;resetVoice();go('athlete');return;}
 case 'delete-athlete':{if(!trainerUnlocked||!window.confirm('Удалить профиль и ВСЮ его историю?'))return;operate(s=>M.deleteRecord(s,'athlete',button.dataset.id,true));render();return;}
 case 'delete-incomplete':{if(!window.confirm('Удалить неполную попытку?'))return;const found=db.incomplete.find(a=>a.id===button.dataset.id);if(!trainerUnlocked&&found?.athleteId!==currentAthlete())return;operate(s=>M.deleteRecord(s,'incomplete',button.dataset.id,trainerUnlocked));render();return;}
 case 'delete-interrupted':{if(!window.confirm('Удалить прерванную попытку?'))return;operate(s=>M.deleteRecord(s,'attempt',button.dataset.id,trainerUnlocked));render();return;}
 case 'delete-attempt':{if(!trainerUnlocked||!window.confirm('Удалить завершённую попытку? Рекорды будут пересчитаны.'))return;operate(s=>M.deleteRecord(s,'attempt',button.dataset.id,true));render();return;}
 case 'delete-workout':{if(!trainerUnlocked||!window.confirm('Удалить тренировку и завершённые попытки?'))return;operate(s=>M.deleteRecord(s,'workout',button.dataset.id,true));render();return;}
 case 'delete-archived':{if(!trainerUnlocked||!window.confirm('Удалить архивную запись?'))return;operate(s=>M.deleteRecord(s,'archived',button.dataset.id,true));render();return;}
 case 'export-json':{const data=JSON.stringify(exportSnapshot(),null,2);await download('sidesteps_backup_v5.json',data);return;}
 case 'import-json':$('file-import')?.click();return;
 default:return;
 }
 }catch(e){fail(e);}}
function exportSnapshot(){if(trainerUnlocked&&db.device.lastInterface==='trainer')return db;const aid=currentAthlete();const n=M.clone(db);n.athletes=n.athletes.filter(a=>a.id===aid);n.workouts=n.workouts.filter(w=>w.athleteId===aid);n.attempts=n.attempts.filter(a=>a.athleteId===aid);n.archived=n.archived.filter(a=>a.athleteId===aid);n.incomplete=n.incomplete.filter(a=>a.athleteId===aid);n.childSessions=[];n.device.selectedAthleteId=aid;n.device.trainerAthleteId=aid;n.device.viewAthleteId=aid;n.device.trainerActivated=false;n.device.lastInterface='athlete';n.device.activeChildSessionId=null;n.device.childParticipants=[];return M.validate(n);}
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
async function importFile(file){if(!file)return;try{let raw=JSON.parse(await file.text());let imported=raw.schemaVersion===5?M.validate(raw):M.migrateV4(raw);let existing=db;
  if(!trainerUnlocked && imported.athletes.length!==1)throw Error('Выберите резервную копию с одной историей тренировок.');
  if(!trainerUnlocked&&db.workouts.length+db.attempts.length>0&&imported.athletes[0].id!==currentAthlete())throw Error('Эта резервная копия не соответствует текущей истории тренировок.');
  // Fresh local default is a placeholder, not an identity conflict with a legacy default athlete.
  if(db.workouts.length===0&&db.attempts.length===0&&db.archived.length===0&&db.athletes.length===1&&db.athletes[0].id==='athlete-default'&&db.athletes[0].name==='Спортсмен'){
   const base=M.blank();base.athletes=imported.athletes;const merged=M.merge(base,imported);merged.state.device={...db.device,selectedAthleteId:imported.athletes[0].id,trainerAthleteId:imported.athletes[0].id};M.validate(merged.state);localStorage.setItem(M.KEY,JSON.stringify(merged.state));db=merged.state;
  }else{const merged=M.merge(db,imported);localStorage.setItem(M.KEY,JSON.stringify(merged.state));db=merged.state;}
  message('Импорт завершён');render();}catch(e){fail(e);}}
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
app.addEventListener('change',e=>{
  const {id,value}=e.target;
  try{
    if(screen==='settings'&&e.target.name==='launch-animation'){
      if(['glow','pulse','none'].includes(value))change(n=>{n.device.launchAnimation=value;});
    }else if(screen==='settings'&&id==='attempt-count'){
      change(n=>{n.device.soloPlannedAttempts=Number(value);});
    }else if(id==='mode-select'){
      change(n=>{
        if(screen==='settings')n.device.soloMeasurementMode=value;
        else n.device.measurementMode=value;
      });
    }else if(id==='coach-athlete'){
      change(n=>{n.device.trainerAthleteId=value;});
      render();
    }else if(id==='file-import'){
      importFile(e.target.files[0]);
    }
  }catch(err){fail(err);}
});
window.addEventListener('storage',e=>{if(e.key===M.KEY){message('Данные изменены в другой вкладке. Перезагрузите приложение.');renderError='Конфликт нескольких вкладок. Перезагрузите страницу и используйте одну вкладку для измерения.';render();}});
window.addEventListener('pagehide',()=>{resetVoice();releaseWakeLock();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&run)acquireWakeLock();});
init();
})();
