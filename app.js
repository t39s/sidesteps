(() => {
'use strict';
const M=window.ILModel,$=id=>document.getElementById(id),app=$('app');
let db=null,config=null,screen='boot',run=null,viewId=null,lastResultId=null,resultUntil=0,trainerUnlocked=false,returnFromHistory='athlete',returnFromPin=null,athleteTab='history',exerciseMode='intervals',showAll=false,showAllPersonal=false,personalFlashTimer=null,voiceSerial=0,voicePending=0,voiceNow=null,voiceQueue=[],voiceWaiters=[],toastTimeout=null,renderError=null,restBypassedWorkout=null,wakeLock=null;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=(tag,attrs='',body='')=>`<${tag} ${attrs}>${body}</${tag}>`;
const b=(label,act,cl='',attrs='')=>`<button type="button" class="${cl}" data-act="${act}" ${attrs}>${label}</button>`;
const card=(html,cl='')=>`<section class="panel ${cl}">${html}</section>`;
const muted=text=>`<div class="note">${text}</div>`;
const dateTime=x=>M.datetime(x);
const athlete=id=>db.athletes.find(x=>x.id===id)||{name:'Неизвестный спортсмен'};
const currentAthlete=()=>db.device.trainerActivated?db.device.trainerAthleteId:db.device.selectedAthleteId;
const isChild=()=>db.device.lastInterface==='child';
const cfgOK=()=>!!config;
const sound=()=>cfgOK()&&config.audioPolicy==='user-controllable'&&db.device.soundEnabled;
const soundControl=()=>!cfgOK()||config.audioPolicy==='off'?'':b(db.device.soundEnabled?'🔊 Звук':'🔇 Звук','toggle-sound','small');
function message(s){const t=$('toast');t.textContent=s;t.style.display='block';clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.style.display='none',4300);}
function fail(e){console.error(e);message(e?.message||String(e));}
function operate(action){const r=action(db);localStorage.setItem(M.KEY,JSON.stringify(r.state));db=r.state;return r.value;}
function change(f){return operate(s=>M.mutation(s,f));}
function resetVoice(){voiceSerial++;voiceQueue=[];voiceNow=null;voicePending=0;try{if('speechSynthesis'in window)speechSynthesis.cancel();}catch(e){}voiceWaiters.splice(0).forEach(f=>f());}
function speechDone(){return voicePending===0?Promise.resolve():new Promise(r=>voiceWaiters.push(r));}
function updateSpeechWaiters(){if(voicePending===0)voiceWaiters.splice(0).forEach(f=>f());}
function queueVoice(text){if(!sound()||!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return;const token=voiceSerial;voicePending++;voiceQueue.push({text,token});if(!voiceNow)drainSpeech();}
function drainSpeech(){if(voiceNow||!voiceQueue.length){updateSpeechWaiters();return;}const next=voiceQueue.shift();if(next.token!==voiceSerial){voicePending--;drainSpeech();return;}voiceNow=next;let finished=false;const u=new SpeechSynthesisUtterance(next.text);u.lang='ru-RU';u.rate=.95;const timer=setTimeout(done,8500);function done(){if(finished)return;finished=true;clearTimeout(timer);if(next.token!==voiceSerial)return;voiceNow=null;voicePending=Math.max(0,voicePending-1);updateSpeechWaiters();drainSpeech();}u.onend=done;u.onerror=done;try{speechSynthesis.speak(u);}catch(e){done();}}
async function acquireWakeLock(){if(!run||!navigator.wakeLock)return;try{wakeLock=await navigator.wakeLock.request('screen');}catch(e){}}
async function releaseWakeLock(){const w=wakeLock;wakeLock=null;if(w)try{await w.release();}catch(e){}}
function sayAttempt(a){queueVoice((a.totalMs/1000).toFixed(1).replace('.',',')+' секунды');if(a.recordEvent)queueVoice('Новый рекорд!');}
function validateConfig(c){if(!c||!Number.isSafeInteger(c.minTapGapMs)||c.minTapGapMs<0||c.minTapGapMs>60000)throw Error('minTapGapMs: целое 0–60000');if(!Number.isSafeInteger(c.intervalCount)||c.intervalCount<1||c.intervalCount>200)throw Error('intervalCount: целое 1–200');if(!Number.isSafeInteger(c.restDurationSec)||c.restDurationSec<0||c.restDurationSec>600)throw Error('restDurationSec: целое 0–600');if(![5,10,15].includes(c.resultDisplaySec))throw Error('resultDisplaySec: 5, 10 или 15');if(!['off','user-controllable'].includes(c.audioPolicy))throw Error('audioPolicy: off или user-controllable');if(c.trainerAccess!==null&&c.trainerAccess!==undefined){let p=c.trainerAccess;if(p.algorithm!=='PBKDF2-SHA256'||!Number.isInteger(p.iterations)||p.iterations<100000||p.iterations>1000000||!p.saltB64||!p.verifierB64)throw Error('Недопустимый verifier PIN');}return c;}
async function pinMatches(pin){if(!config.trainerAccess)return false;const p=config.trainerAccess;const bytes=str=>Uint8Array.from(atob(str),c=>c.charCodeAt(0));const enc=new TextEncoder().encode(pin);const key=await crypto.subtle.importKey('raw',enc,'PBKDF2',false,['deriveBits']);const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(p.saltB64),iterations:p.iterations,hash:'SHA-256'},key,256));const expected=bytes(p.verifierB64);if(bits.length!==expected.length)return false;let diff=0;for(let i=0;i<bits.length;i++)diff|=bits[i]^expected[i];return diff===0;}
async function init(){let recoveredTimeoutId=null;try{let response=await fetch('./config.json',{cache:'no-store'});if(!response.ok)throw Error('Не удалось загрузить config.json');config=validateConfig(await response.json());}catch(e){renderError=e.message;}
  try{const current=localStorage.getItem(M.KEY);if(current){db=M.validate(JSON.parse(current));}else{const legacy=localStorage.getItem(M.LEGACY_KEY);db=legacy?M.migrateV4(JSON.parse(legacy)):M.blank();localStorage.setItem(M.KEY,JSON.stringify(db));}
    const formerId=db.device.activeWorkoutId;const recovered=M.recover(db);localStorage.setItem(M.KEY,JSON.stringify(recovered.state));db=recovered.state;const former=M.workoutOf(db,formerId);if(former&&former.status==='completed'&&former.closeReason==='timeout')recoveredTimeoutId=former.id;
  }catch(e){renderError='Не удалось открыть историю: '+e.message+'. Данные не перезаписаны.';db=M.blank();}
  if(!renderError){if(db.device.lastInterface==='trainer'){screen='pin';}else if(db.device.lastInterface==='child'){const c=M.currentChild(db),turn=M.nextTurn(db),w=M.workoutOf(db,turn?.workoutId);screen=c?'child-ready':'child-final';if(c?.athleteIds.length===1 && turn?.ordinal===2 && w?.firstEndedAt && remainingRest(w)>0)screen='rest';if(!db.device.childParticipants.length)screen='athlete';}else{const w=M.workoutOf(db,db.device.activeWorkoutId);if(w&&w.status!=='completed'){screen=M.completed(db,w).length?'rest':'athlete-ready';}else screen='athlete';}if(recoveredTimeoutId&&db.device.lastInterface==='athlete'){viewId=recoveredTimeoutId;screen='final';}}
  render();if(recoveredTimeoutId&&screen==='final')message('Тренировка завершена. Сохранён результат первой попытки.');setInterval(tick,80);if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
function header(context='',actions='',homeLink=false){
  const label='Приставные шаги<br>на время';
  const brand=homeLink?`<a class="brand brand-home" href="./" data-act="final-home">${label}</a>`:`<div class="brand">${label}</div>`;
  return `<header class="app-head"><div>${brand}${context?`<div class="mode-tag">${esc(context)}</div>`:''}</div><div class="toolbar">${actions}${soundControl()}</div></header>`;}
function row(label,value){return `<div class="list-row"><span>${label}</span><strong>${value}</strong></div>`;}
function chooseAttempts(){return `<label for="attempt-count">Попыток в тренировке</label><select id="attempt-count"><option value="2">2 попытки (по умолчанию)</option><option value="1">1 попытка</option></select>`;}
function chooseMode(mode=db.device.measurementMode,intervalLabel='С отсечками'){return `<label for="mode-select">Режим измерения</label><select id="mode-select"><option value="intervals" ${mode==='intervals'?'selected':''}>${intervalLabel}</option><option value="stopwatch" ${mode==='stopwatch'?'selected':''}>Старт–Стоп</option></select>`;}
function intervalCountLabel(count){
  const last=count%10;
  const teens=count%100>=11&&count%100<=14;
  const noun=teens?'отсечек':last===1?'отсечка':last>=2&&last<=4?'отсечки':'отсечек';
  return `${count} ${noun} (по умолчанию)`;
}
function adultHome(){
  const historyActive=athleteTab==='history';
  return header()+`<div class="athlete-tabs" role="tablist" aria-label="Разделы приложения">
    <button type="button" role="tab" id="athlete-tab-history" aria-controls="athlete-panel-history" aria-selected="${historyActive}" tabindex="${historyActive?0:-1}" data-act="athlete-tab" data-tab="history">История</button>
    <button type="button" role="tab" id="athlete-tab-exercise" aria-controls="athlete-panel-exercise" aria-selected="${!historyActive}" tabindex="${historyActive?-1:0}" data-act="athlete-tab" data-tab="exercise">Новое упражнение</button>
  </div>
  <section id="athlete-panel-history" role="tabpanel" aria-labelledby="athlete-tab-history" tabindex="0" ${historyActive?'':'hidden'}>
    ${historyContent(currentAthlete())}
    ${card('<h2>Мои данные</h2><div class="buttons">'+b('Сохранить','export-json','wide')+b('Загрузить','import-json','wide')+'</div><p class="note">Данные хранятся на&nbsp;устройстве.</p><input type="file" id="file-import" accept=".json,application/json" hidden>')}
  </section>
  <section id="athlete-panel-exercise" role="tabpanel" aria-labelledby="athlete-tab-exercise" tabindex="0" ${historyActive?'hidden':''}>
    ${card(chooseAttempts()+chooseMode(exerciseMode,intervalCountLabel(config.intervalCount))+`<div class="buttons">${b('Начать тренировку','start-solo','primary wide')}</div>`)}
    ${legacyResumeChoices()}
  </section>`;
}
function selectAthleteTab(tab){
  if(athleteTab!=='exercise'&&tab.dataset.tab==='exercise'){
    exerciseMode='intervals';
    $('mode-select').value=exerciseMode;
  }
  athleteTab=tab.dataset.tab;
  for(const item of tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')){
    const selected=item===tab;
    item.setAttribute('aria-selected',String(selected));
    item.tabIndex=selected?0:-1;
    $(item.getAttribute('aria-controls')).hidden=!selected;
  }
  initializeProgressScroll();
  tab.focus();
}
function legacyResumeChoices(){const ids=[currentAthlete()];const pending=db.workouts.filter(w=>ids.includes(w.athleteId)&&w.status==='legacy_pending');return pending.length?card('<h2>Ранее незавершённые тренировки</h2>'+pending.map(w=>'<div class="list-row"><span>'+esc(M.datetime(w.createdAt))+'</span>'+b('Продолжить','resume-legacy','small',`data-id="${esc(w.id)}"`)+'</div>').join('')):'';}
function remainingRest(w){return Math.max(0,Date.parse(w.firstEndedAt)+config.restDurationSec*1000-Date.now());}
function soloReady(){
  const workout=M.workoutOf(db,db.device.activeWorkoutId);
  if(!workout)return adultHome();
  const attempt=M.completed(db,workout).length+1;
  return header()+
    card(`<h1 class="hero-title center">Попытка ${attempt} из ${workout.plannedAttempts}</h1>`)+
    measureSurface(true);
}
function measureSurface(personal=false){const mode=db.device.measurementMode;const running=!!run;const intervals=running?run.intervals.length:0;const now=running?performance.now():0;const sec=running?Math.max(0,Math.floor((now-run.start)/10)/100).toFixed(2):'0.00';return `<div class="tap-surface${personal?' personal-measure':''}" data-tap="1" role="button" tabindex="0" aria-label="${running?'Отсечка или стоп':'Начать измерение'}">${personal&&mode==='intervals'?'':`<div class="muted">${mode==='intervals'?'С ОТСЕЧКАМИ':'СТАРТ–СТОП'}</div>`}${mode==='intervals'?`<div class="counter" data-digits="${String(intervals).length}">${intervals}</div><div class="${personal?'secondary-display':'note'}">${intervals} / ${run?run.target:config.intervalCount} интервалов</div>`:'<div style="height:26px"></div>'}<div class="secondary-display" data-elapsed>${sec} с</div>${personal&&mode==='intervals'?'':`<div class="muted" style="margin-top:20px">${running?(mode==='intervals'?'КОСНИСЬ ДЛЯ ОТСЕЧКИ':'КОСНИСЬ ДЛЯ СТОПА'):'КОСНИСЬ ДЛЯ СТАРТА'}</div>`}</div>`;}
function childReady(){const c=M.currentChild(db);if(!c)return childFinal();const turn=M.nextTurn(db);if(!turn)return childFinal();const w=M.workoutOf(db,turn.workoutId);if(c.athleteIds.length===1&&turn.ordinal===2&&w?.firstEndedAt&&config){const restLeft=remainingRest(w);if(restLeft>0&&restBypassedWorkout!==w.id)return restScreen(true,w);}
  return `<div class="child">${header()}<div class="screen-heading">${esc(athlete(turn.athleteId).name)}</div><div class="center muted">Попытка ${turn.ordinal} из ${c.plannedAttempts}</div>${measureSurface()}${muted('Только ваш секундомер. Смена участников происходит автоматически.')}</div>`;}
function personalRestCard(workout,compact=false){
  return card(`<div class="personal-rest-time">
    ${compact?'<div class="muted">Отдых</div>':''}
    <div class="display" data-rest-clock>${M.mins(remainingRest(workout))}</div>
  </div>${b('Начать раньше','rest-early','primary wide')}`,compact?'personal-rest half-attempt':'personal-rest');
}
function resultScreen(){
  const a=M.attemptOf(db,lastResultId);
  if(!a)return screen==='result'?(isChild()?childReady():soloReady()):'';
  const w=M.workoutOf(db,a.workoutId),c=M.currentChild(db);
  const rests=w.status==='pending'&&w.plannedAttempts===2;
  if(!isChild()){
    const time=(a.totalMs/1000).toFixed(2).replace('.',',');
    const title=card(`<h1 class="hero-title center">Попытка ${a.ordinal}</h1>`);
    const result=card(`<div class="display">${time} с</div>${a.recordEvent?'<div class="record">★ Новый рекорд!</div>':''}`,'attempt-result half-attempt');
    return header()+title+result+(rests?personalRestCard(w,true):'');
  }
  const participant=`${esc(athlete(a.athleteId).name)} · `;
  const result=`<div class="center"><div class="muted">${participant}Попытка ${a.ordinal}</div><div class="display">${M.fmt(a.totalMs)}</div>${a.recordEvent?'<div class="record">★ Новый рекорд!</div>':''}</div>`;
  const firstPart=header()+result;
  if(c?.athleteIds.length===2)return firstPart+card(`<div class="center muted">Следующий участник появится автоматически</div>`);
  if(rests)return firstPart+card(`<div class="center">Отдых <strong class="secondary-display" data-rest-clock>${M.mins(remainingRest(w))}</strong></div><div class="buttons">${b('Начать раньше','rest-early','primary wide')}</div>`);
  return firstPart;
}
function restScreen(child,w){
  if(!w)return adultHome();
  if(child)return participantRest(w);
  return header()+card('<h1 class="hero-title center">Отдых</h1>')+personalRestCard(w);
}
function participantRest(w){return `<div class="child">${header()}<div class="fullscreen-rest"><div class="screen-heading">Отдых</div><div class="display" data-rest-clock>${M.mins(remainingRest(w))}</div><div class="muted">${esc(athlete(w.athleteId).name)}</div><div class="buttons">${b('Начать раньше','rest-early','primary wide')}</div></div></div>`;}
function latestChildSession(){const candidates=db.childSessions.filter(c=>c.status!=='active');return candidates.at(-1)||null;}
function childFinal(){const active=M.currentChild(db);if(active)return childReady();const allowed=db.device.childParticipants;if(!allowed.length)return header()+card('<h2>Сеанс не выбран</h2><p>Администратор должен выбрать участника.</p>');let aid=db.device.viewAthleteId;if(!allowed.includes(aid))aid=allowed.at(-1);return `<div class="child">${header()}<h1 class="hero-title">Результаты: ${esc(athlete(aid).name)}</h1>${allowed.length===2?`<div class="buttons">${allowed.map(x=>b(esc(athlete(x).name),'child-view','soft',`data-id="${esc(x)}"`)).join('')}</div>`:''}${progress(aid,true)}${b('История','history-child','wide')}</div>`;}
function finalAdult(){
  const workout=M.workoutOf(db,viewId);
  if(!workout)return adultHome();
  const summary=workoutSummary(workout.athleteId,workout);
  const points=M.renderChartData(db,workout.athleteId);
  return header('','',true)+card('<h1 class="hero-title center">Тренировка завершена</h1>')+
    card(summary+workoutDetails(workout,M.best(db,workout),true))+
    card('<h2>Мой прогресс</h2>'+graphic(points.slice(-5)))+
    `<div class="buttons">${b('На главную','final-home','wide')}</div>`;
}
function initializeProgressScroll(){
  const plot=app.querySelector('.chart-scrollable:not([data-positioned])');
  if(!plot?.clientWidth)return;
  plot.scrollLeft=plot.scrollWidth;
  plot.dataset.positioned='true';
}
function graphic(points,scrollable=false){
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
  const best=Math.min(...visible.map(p=>p.ms));
  const ticks=[0,.25,.5,.75,1].map(fr=>({
    y:y(hi*fr),
    label:(hi*fr/1000).toFixed(hi<20000?1:0)
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
  return `${title}${best!==null&&best!==undefined?`<div class="metric"><span>Лучшее время</span><strong>${M.fmt(best)}</strong></div>`:''}${attempts.some(a=>a.recordEvent)?'<div class="record">★ Новый рекорд!</div>':''}${improvements.length?`<div class="note">Улучшение на ${M.fmt(Math.max(...improvements.map(a=>a.previousRecordMs-a.totalMs)))}</div>`:''}${record!==null?row(firstOnly?'Исходный результат':'Рекорд',M.fmt(record)):''}`;
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
function workoutDetails(workout,best,sharedScale){
  const attempts=M.completed(db,workout);
  const intervals=sharedScale?attempts.flatMap(a=>a.mode==='intervals'?(a.intervalsMs??[]):[]):[];
  const sharedMax=sharedScale?Math.max(1,...intervals):undefined;
  return `<details><summary>Подробнее</summary><div class="note">${esc(M.datetime(workout.createdAt))}</div>${attempts.map(a=>row(`Попытка ${a.ordinal}`,M.fmt(a.totalMs)+(a.totalMs===best?' ★':''))+intervalDetails(a,sharedMax)).join('')}</details>`;
}
function historyItems(aid,child=false,personal=false){
  const ordered=[...M.publicWorkouts(db,aid)].reverse();
  if(personal)ordered.shift();
  const limited=personal?!showAllPersonal:child&&!showAll;
  const show=limited?ordered.slice(0,5):ordered;return `<h2>Тренировки</h2>${!ordered.length?muted(personal?'Нет предыдущих тренировок':'Нет завершённых тренировок'):''}<div class="history-list">${show.map(w=>{const bs=M.best(db,w);return `<div class="history-item"><div class="row between"><span class="muted">${esc(M.date(w.createdAt))}</span><strong>${M.fmt(bs)}</strong></div>${workoutDetails(w,bs,personal)}</div>`;}).join('')}${personal&&ordered.length>5?b(limited?'Все тренировки':'5 тренировок','personal-history-all','wide',`aria-expanded="${!limited}"`):''}</div>${db.archived.filter(a=>a.athleteId===aid).length?`<h2>Исторический архив</h2>${db.archived.filter(a=>a.athleteId===aid).map(a=>`<div class="history-item"><span>${esc(a.date)} · </span><strong>${M.fmt(a.bestMs)}</strong><span class="note"> · архив без отдельных попыток</span></div>`).join('')}`:''}${!personal&&limited&&ordered.length>5?b('Вся история','history-all','wide'):''}`;}
function historyScreen(){
  const mode=db.device.lastInterface;
  const aid=mode==='child'||mode==='trainer'?db.device.viewAthleteId:currentAthlete();
  return header(mode==='athlete'?'':'История',b('Назад','back-history','small'))+historyContent(aid,mode==='child',trainerUnlocked&&mode==='trainer');
}
function historyContent(aid,child=false,trainer=false){
  const interrupt=db.attempts.filter(a=>a.athleteId===aid&&a.status==='interrupted');
  return `${child||trainer?`<h1 class="hero-title">${esc(athlete(aid).name)}</h1>`:''}${progress(aid,child,!child&&!trainer)}${!child?card(`<h2>Прерванные попытки</h2>${interrupt.length?interrupt.map(a=>`<div class="list-row"><span>${esc(M.datetime(a.startedAt))}</span>${b('Удалить','delete-interrupted','danger small',`data-id="${esc(a.id)}"`)}</div>`).join(''):muted('Прерванных попыток нет')}`):''}${!child&&db.incomplete.some(a=>a.athleteId===aid)?card('<h2>Ранее неполные попытки</h2>'+db.incomplete.filter(a=>a.athleteId===aid).map(a=>`<div class="list-row"><span>${esc(M.datetime(a.startedAt))} · не зачтена</span>${b('Удалить','delete-incomplete','danger small',`data-id="${esc(a.id)}"`)}</div>`).join('')):''}${trainer?adminHistory(aid):''}`;
}
function adminHistory(aid){return card(`<h2>Управление историей</h2>${db.workouts.filter(w=>w.athleteId===aid).map(w=>`<div class="list-row"><span>${esc(M.datetime(w.createdAt))} · ${w.status}</span>${b('Удалить','delete-workout','danger small',`data-id="${esc(w.id)}"`)}</div>`).join('')}${db.attempts.filter(a=>a.athleteId===aid&&a.status==='completed').map(a=>`<div class="list-row"><span>Попытка ${a.ordinal} · ${M.fmt(a.totalMs)}</span>${b('Удалить','delete-attempt','danger small',`data-id="${esc(a.id)}"`)}</div>`).join('')}${db.archived.filter(x=>x.athleteId===aid).map(x=>`<div class="list-row"><span>Архив ${esc(x.date)} · ${M.fmt(x.bestMs)}</span>${b('Удалить','delete-archived','danger small',`data-id="${esc(x.id)}"`)}</div>`).join('')}`);}
function trainerHome(){const c=M.currentChild(db),options=db.athletes.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');const title=header('Администратор',b('Мои упражнения','switch-athlete','small')+b('К занятию','go-child','small'))+`<h1 class="hero-title">Управление занятием</h1>`;if(c)return title+card(`<h2>Занятие идёт</h2><p>${c.athleteIds.map(id=>esc(athlete(id).name)).join(' → ')}</p><p>Следующая попытка: ${c.nextIndex+1} из ${c.sequence.length}</p>${b('Вернуться к занятию','go-child','primary wide')}<div class="buttons">${b('Принудительно завершить','force-child','danger wide')}</div>`);
  return title+card(`<h2>Подготовить занятие</h2><label>Участник А<select id="trainer-a">${options}</select></label><label>Участник Б<select id="trainer-b"><option value="">Нет — один участник</option>${options}</select></label>${chooseAttempts()}${chooseMode()}<div class="buttons">${b('Начать занятие','start-child','primary wide')}</div>`)+card(`<h2>Спортсмены</h2>${db.athletes.map(a=>`<div class="list-row"><span>${esc(a.name)}</span>${b('История','trainer-history','small',`data-id="${esc(a.id)}"`)} ${db.athletes.length>1?b('Удалить','delete-athlete','danger small',`data-id="${esc(a.id)}"`):''}</div>`).join('')}<label>Добавить спортсмена<input id="new-athlete" maxlength="50" placeholder="Имя"></label><div class="buttons">${b('Добавить','add-athlete','primary')}</div><label>Мой профиль спортсмена<select id="coach-athlete">${db.athletes.map(a=>`<option value="${esc(a.id)}" ${a.id===db.device.trainerAthleteId?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>`)+card(`<h2>Добавить архивный результат</h2><p class="note">Историческое время без отдельных попыток. Не редактирует уже измеренные значения.</p><label>Спортсмен<select id="archive-athlete">${options}</select></label><label>Дата<input type="date" id="archive-date"></label><label>Время, секунды<input type="text" id="archive-time" inputmode="decimal" placeholder="Например 23,567"></label><div class="buttons">${b('Добавить в архив','add-archive','primary')}</div>`)+card(`<h2>Резервные копии</h2><div class="buttons">${b('Экспорт JSON','export-json')} ${b('Импорт JSON','import-json')} ${b('Удалить все локальные данные','reset-all','danger')}</div><input id="file-import" type="file" accept=".json,application/json" hidden>`);
}
function pinScreen(){return header()+card(`<h2>Вход администратора</h2>${!config?.trainerAccess?`<div class="error">PIN пока не сконфигурирован. Разработчик должен записать проверочный хеш PIN, выбранного администратором, в config.json.</div>`:`<label>PIN-код<input type="password" id="pin-input" inputmode="numeric" autocomplete="off" maxlength="32" placeholder="PIN"></label><div class="buttons">${b('Войти','pin-submit','primary wide')}</div>`}`)+b('Назад','pin-back','wide');}
function render(){if(!db)return;const previousPlot=app.querySelector('.chart-scrollable[data-positioned]');const plotOffset=previousPlot?.scrollLeft;let html='';if(renderError)html=card(`<div class="error">${esc(renderError)}</div><div class="buttons">${b('Экспортировать текущие данные','export-json')}</div>`);else if(screen==='pin')html=pinScreen();else if(screen==='trainer')html=trainerUnlocked?trainerHome():pinScreen();else if(screen==='athlete')html=adultHome();else if(screen==='athlete-ready')html=soloReady();else if(screen==='child-ready')html=childReady();else if(screen==='child-final')html=childFinal();else if(screen==='result')html=resultScreen();else if(screen==='rest'){const c=M.currentChild(db),turn=M.nextTurn(db);const w=c?M.workoutOf(db,turn?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);html=restScreen(!!c,w);}else if(screen==='final')html=finalAdult();else if(screen==='history')html=historyScreen();else html=adultHome();const showAdminLogin=!renderError&&screen!=='pin'&&screen!=='trainer'&&db.device.lastInterface!=='trainer';app.innerHTML=`<main class="shell">${html}<footer class="nav-spacer app-footer"><span class="app-version">sidesteps v. 0.2.3-rc.9</span>${showAdminLogin?' <span aria-hidden="true">·</span> <a href="#admin-login" data-act="pin" title="Для администратора">Войти</a>':''}</footer></main>`;
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
function afterFinished(result,personal=false){lastResultId=result.attempt.id;viewId=result.workout.id;run=null;releaseWakeLock();screen=result.sessionDone?(db.device.lastInterface==='child'?'child-final':'final'):'result';
  if(result.workout.status==='completed'&&!M.currentChild(db))screen=db.device.lastInterface==='child'?'child-final':'final';
  resultUntil=Date.now()+config.resultDisplaySec*1000;resetVoice();sayAttempt(result.attempt);
  if(personal){const finishedScreen=screen;setTimeout(()=>{if(screen===finishedScreen)render();},200);}
  else render();}
function startMeasurement(){if(!config||run)return;let w=null;const c=M.currentChild(db);if(db.device.lastInterface==='child'){const t=M.nextTurn(db);if(!t)return;w=M.workoutOf(db,t.workoutId);}else{w=M.workoutOf(db,db.device.activeWorkoutId);}if(!w){message('Нет активной тренировки');return;}if(w.plannedAttempts===2&&M.completed(db,w).length===1&&!c&&M.deadline(w)!==null&&Date.now()>=M.deadline(w)){try{operate(s=>M.closeWorkout(s,w.id,'timeout'));viewId=w.id;go('final');}catch(e){fail(e)}return;}
  const now=performance.now(),date=new Date().toISOString();try{const a=operate(s=>M.startAttempt(s,w.id,db.device.measurementMode,config.intervalCount,date));run={id:a.id,start:now,lastAccepted:now,intervals:[],mode:a.mode,target:config.intervalCount};resetVoice();acquireWakeLock();render();}catch(e){fail(e);}}
function completeMeasurement(now,personal=false){const dur=now-run.start;let intervals=[];let ms;if(run.mode==='intervals'){intervals=[...run.intervals];ms=intervals.reduce((x,y)=>x+y,0);}else ms=Math.max(1,Math.round(dur));const id=run.id;try{const v=operate(s=>M.finishAttempt(s,id,ms,intervals));afterFinished(v,personal);}catch(e){fail(e);}}
function flashPersonalTap(){
  const zone=app.querySelector('.personal-measure');
  if(!zone)return;
  clearTimeout(personalFlashTimer);
  zone.classList.add('flash');
  personalFlashTimer=setTimeout(()=>zone.classList.remove('flash'),200);
}
function tap(){
  if(renderError||!config||!['athlete-ready','child-ready'].includes(screen))return;
  const personal=screen==='athlete-ready';
  const now=performance.now();
  if(!run){
    startMeasurement();
    if(personal&&run)flashPersonalTap();
    return;
  }
  if(now-run.lastAccepted<=config.minTapGapMs)return;
  run.lastAccepted=now;
  if(!personal){
    const zone=app.querySelector('.tap-surface');
    zone?.classList.add('flash');
    setTimeout(()=>zone?.classList.remove('flash'),150);
  }
  if(run.mode==='intervals'){
    const elapsed=run.intervals.reduce((total,ms)=>total+ms,0);
    run.intervals.push(Math.max(0,Math.round(now-run.start-elapsed)));
  }
  const finished=run.mode==='stopwatch'||run.intervals.length===run.target;
  if(!finished||(personal&&run.mode==='intervals'))render();
  if(personal)flashPersonalTap();
  if(finished)completeMeasurement(now,personal);
}
function resultProgress(){if(screen!=='result')return;const a=M.attemptOf(db,lastResultId);if(!a)return;const w=M.workoutOf(db,a.workoutId);if(Date.now()<resultUntil||voicePending>0)return;const c=M.currentChild(db);if(c?.athleteIds.length===2){screen='child-ready';queueVoice(athlete(M.nextTurn(db).athleteId).name);render();return;}
 if(w.status==='completed'){screen=db.device.lastInterface==='child'?'child-final':'final';render();return;}if(remainingRest(w)<=0){screen='child-ready'===db.device.lastInterface?'child-ready':(db.device.lastInterface==='child'?'child-ready':'athlete-ready');queueVoice('Можно начинать');render();}else{screen='rest';render();}}
function tick(){
  if(renderError||!config)return;
  try{const closed=M.expireSolo(db,Date.now());if(closed){localStorage.setItem(M.KEY,JSON.stringify(closed.state));db=closed.state;viewId=closed.value.id;run=null;screen='final';resetVoice();message('Тренировка завершена. Сохранён результат первой попытки.');render();return;}}catch(e){fail(e);}
  if(screen==='result'){
    resultProgress();
  }else if(screen==='rest'){
    const c=M.currentChild(db),turn=M.nextTurn(db);
    const w=c?M.workoutOf(db,turn?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);
    if(!w){screen=c?'child-final':'final';render();return;}
    if(remainingRest(w)<=0 && voicePending===0){screen=c?'child-ready':'athlete-ready';queueVoice('Можно начинать');render();return;}
  }else if(screen==='child-ready'&&!run){
    // A resumed single-child session may be waiting for rest on this screen.
    const c=M.currentChild(db),turn=M.nextTurn(db);
    const w=c?M.workoutOf(db,turn?.workoutId):null;
    if(c?.athleteIds.length===1 && turn?.ordinal===2 && w?.firstEndedAt && restBypassedWorkout!==w.id){
      if(remainingRest(w)>0 && app.querySelector('.fullscreen-rest')){screen='rest';}
      else if(app.querySelector('.fullscreen-rest')){queueVoice('Можно начинать');render();return;}
    }
  }
  // Update only text nodes: replacing the button mid-touch could lose the click.
  const clock=app.querySelector('[data-rest-clock]');
  if(clock){const c=M.currentChild(db),turn=M.nextTurn(db);const w=c?M.workoutOf(db,turn?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);if(w)clock.textContent=M.mins(remainingRest(w));}
  if(run && (screen==='athlete-ready'||screen==='child-ready')){
    const elapsed=app.querySelector('[data-elapsed]');
    if(elapsed)elapsed.textContent=(Math.max(0,Math.floor((performance.now()-run.start)/10)/100)).toFixed(2)+' с';
  }
}
async function handleAction(name,button){try{
 switch(name){
 case 'toggle-sound':change(n=>{n.device.soundEnabled=!n.device.soundEnabled;});if(!sound())resetVoice();else if(lastResultId&&['result','final','child-final'].includes(screen)){const a=M.attemptOf(db,lastResultId);if(a){resetVoice();sayAttempt(a);}}render();return;
 case 'pin':returnFromPin=screen;go('pin');return;
 case 'pin-back':if(returnFromPin){const previous=returnFromPin;returnFromPin=null;go(previous);return;}if(db.device.lastInterface==='trainer'&&!trainerUnlocked){go('athlete','athlete');return;}go(db.device.lastInterface==='child'?(M.currentChild(db)?'child-ready':'child-final'):(db.device.lastInterface==='trainer'?'trainer':'athlete'));return;
 case 'pin-submit':{const code=$('pin-input')?.value||'';if(!await pinMatches(code)){message('Неверный PIN');return;}returnFromPin=null;trainerUnlocked=true;change(n=>{n.device.trainerActivated=true;n.device.lastInterface='trainer';});go('trainer');return;}
 case 'switch-athlete':{if(M.currentChild(db)){message('Сначала завершите занятие');return;}trainerUnlocked=false;change(n=>{n.device.lastInterface='athlete';});go('athlete');return;}
 case 'go-child':{if(!db.device.trainerActivated)return;trainerUnlocked=false;change(n=>{n.device.lastInterface='child';});go(M.currentChild(db)?'child-ready':'child-final');return;}
 case 'start-solo':{const count=Number($('attempt-count').value);const mode=$('mode-select').value;change(n=>{n.device.measurementMode=mode;});operate(s=>M.startSolo(s,currentAthlete(),count));go('athlete-ready');return;}
 case 'final-home':showAllPersonal=false;viewId=null;lastResultId=null;athleteTab='history';go('athlete');return;
 case 'athlete-tab':selectAthleteTab(button);return;
 case 'resume-legacy':{const wid=button.dataset.id;const w=M.workoutOf(db,wid);if(!w||w.status!=='legacy_pending'||w.athleteId!==currentAthlete())return;change(n=>{n.device.activeWorkoutId=wid;});go('athlete-ready');return;}
 case 'start-child':{const a=$('trainer-a').value,bb=$('trainer-b').value,ids=bb?[a,bb]:[a],count=Number($('attempt-count').value);const mode=$('mode-select').value;change(n=>{n.device.measurementMode=mode;});operate(s=>M.startChild(s,ids,count));trainerUnlocked=false;go('child-ready');queueVoice(athlete(ids[0]).name);return;}
 case 'force-child':{if(!trainerUnlocked||!window.confirm('Завершить занятие, сохранив выполненные попытки?'))return;const c=operate(s=>M.forceCloseChild(s));message('Сеанс завершён');go('trainer');return;}
 case 'rest-early':if(screen==='result'||screen==='rest'||screen==='child-ready'){const c=M.currentChild(db);const w=c?M.workoutOf(db,M.nextTurn(db)?.workoutId):M.workoutOf(db,db.device.activeWorkoutId);restBypassedWorkout=w?.id||null;screen=c?'child-ready':'athlete-ready';resetVoice();render();}return;
 case 'history-athlete':returnFromHistory=screen;go('history');return;
 case 'history-child':returnFromHistory=screen;go('history');return;
 case 'personal-history-all':showAllPersonal=!showAllPersonal;render();app.querySelector('[data-act="personal-history-all"]')?.focus();return;
 case 'history-all':showAll=true;render();return;
 case 'back-history':showAll=false;go(returnFromHistory==='trainer'?'trainer':db.device.lastInterface==='child'?(M.currentChild(db)?'child-ready':'child-final'):(db.device.activeWorkoutId?'athlete-ready':'athlete'));return;
 case 'child-view':{if(M.currentChild(db))return;let aid=button.dataset.id;if(!db.device.childParticipants.includes(aid))return;change(n=>{n.device.viewAthleteId=aid;});go('child-final');return;}
 case 'trainer-history':{if(!trainerUnlocked)return;const aid=button.dataset.id;change(n=>{n.device.viewAthleteId=aid;});returnFromHistory='trainer';go('history');return;}
 case 'add-archive':{if(!trainerUnlocked)return;const aid=$('archive-athlete').value,day=$('archive-date').value,raw=$('archive-time').value.trim().replace(',','.');const num=Number(raw);if(!raw||!Number.isFinite(num)||num<=0)throw Error('Некорректное время архива');operate(s=>M.addArchived(s,aid,day,Math.round(num*1000)));render();return;}
 case 'add-athlete':{if(!trainerUnlocked)return;const name=$('new-athlete').value;operate(s=>M.addAthlete(s,name));render();return;}
 case 'reset-all':{if(!trainerUnlocked||!window.confirm('Удалить ВСЕ локальные данные и профили с этого устройства?')||!window.confirm('Подтвердите необратимый сброс. Сделайте экспорт перед удалением.'))return;const cleared=M.blank();localStorage.setItem(M.KEY,JSON.stringify(cleared));db=cleared;localStorage.removeItem(M.LEGACY_KEY);trainerUnlocked=false;resetVoice();go('athlete');return;}
 case 'delete-athlete':{if(!trainerUnlocked||!window.confirm('Удалить профиль и ВСЮ его историю?'))return;operate(s=>M.deleteRecord(s,'athlete',button.dataset.id,true));render();return;}
 case 'delete-incomplete':{if(!window.confirm('Удалить неполную попытку?'))return;const found=db.incomplete.find(a=>a.id===button.dataset.id);if(!trainerUnlocked&&found?.athleteId!==currentAthlete())return;operate(s=>M.deleteRecord(s,'incomplete',button.dataset.id,trainerUnlocked));render();return;}
 case 'delete-interrupted':{if(!window.confirm('Удалить прерванную попытку?'))return;operate(s=>M.deleteRecord(s,'attempt',button.dataset.id,trainerUnlocked));render();return;}
 case 'delete-attempt':{if(!trainerUnlocked||!window.confirm('Удалить завершённую попытку? Рекорды будут пересчитаны.'))return;operate(s=>M.deleteRecord(s,'attempt',button.dataset.id,true));render();return;}
 case 'delete-workout':{if(!trainerUnlocked||!window.confirm('Удалить тренировку и завершённые попытки?'))return;operate(s=>M.deleteRecord(s,'workout',button.dataset.id,true));render();return;}
 case 'delete-archived':{if(!trainerUnlocked||!window.confirm('Удалить архивную запись?'))return;operate(s=>M.deleteRecord(s,'archived',button.dataset.id,true));render();return;}
 case 'export-json':{const data=JSON.stringify(exportSnapshot(),null,2);download('sidesteps_backup_v5.json',data,'application/json');return;}
 case 'import-json':$('file-import')?.click();return;
 default:return;
 }
 }catch(e){fail(e);}}
function exportSnapshot(){if(trainerUnlocked&&db.device.lastInterface==='trainer')return db;const aid=currentAthlete();const n=M.clone(db);n.athletes=n.athletes.filter(a=>a.id===aid);n.workouts=n.workouts.filter(w=>w.athleteId===aid);n.attempts=n.attempts.filter(a=>a.athleteId===aid);n.archived=n.archived.filter(a=>a.athleteId===aid);n.incomplete=n.incomplete.filter(a=>a.athleteId===aid);n.childSessions=[];n.device.selectedAthleteId=aid;n.device.trainerAthleteId=aid;n.device.viewAthleteId=aid;n.device.trainerActivated=false;n.device.lastInterface='athlete';n.device.activeChildSessionId=null;n.device.childParticipants=[];return M.validate(n);}
function download(filename,content,mime){const blob=new Blob([content],{type:mime});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
async function importFile(file){if(!file)return;try{let raw=JSON.parse(await file.text());let imported=raw.schemaVersion===5?M.validate(raw):M.migrateV4(raw);let existing=db;
  if(!trainerUnlocked && imported.athletes.length!==1)throw Error('Выберите резервную копию с одной историей тренировок.');
  if(!trainerUnlocked&&db.workouts.length+db.attempts.length>0&&imported.athletes[0].id!==currentAthlete())throw Error('Эта резервная копия не соответствует текущей истории тренировок.');
  // Fresh local default is a placeholder, not an identity conflict with a legacy default athlete.
  if(db.workouts.length===0&&db.attempts.length===0&&db.archived.length===0&&db.athletes.length===1&&db.athletes[0].id==='athlete-default'&&db.athletes[0].name==='Спортсмен'){
   const base=M.blank();base.athletes=imported.athletes;const merged=M.merge(base,imported);merged.state.device={...db.device,selectedAthleteId:imported.athletes[0].id,trainerAthleteId:imported.athletes[0].id};M.validate(merged.state);localStorage.setItem(M.KEY,JSON.stringify(merged.state));db=merged.state;
  }else{const merged=M.merge(db,imported);localStorage.setItem(M.KEY,JSON.stringify(merged.state));db=merged.state;}
  message('Импорт завершён');render();}catch(e){fail(e);}}
app.addEventListener('pointerdown',e=>{let area=e.target.closest('[data-tap]');if(!area||e.button!==0||e.isPrimary===false)return;e.preventDefault();tap(e);});
app.addEventListener('keydown',e=>{
  const tab=e.target.closest('[role="tab"][data-tab]');
  if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    e.preventDefault();
    const tabs=[...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
    const index=e.key==='Home'?0:e.key==='End'?tabs.length-1:
      (tabs.indexOf(tab)+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    selectAthleteTab(tabs[index]);
  }
if((e.key===' '||e.key==='Enter')&&e.target.closest('[data-tap]')&&!e.repeat){e.preventDefault();tap(e);}if(e.key==='Enter'&&e.target.id==='pin-input'){e.preventDefault();handleAction('pin-submit');}});
app.addEventListener('click',e=>{const bt=e.target.closest('[data-act]');if(bt){if(bt.matches('a'))e.preventDefault();handleAction(bt.dataset.act,bt);}});
app.addEventListener('change',e=>{if(e.target.id==='mode-select'){if(screen==='athlete')exerciseMode=e.target.value;else try{change(n=>{n.device.measurementMode=e.target.value;});}catch(err){fail(err);}}if(e.target.id==='coach-athlete'){try{change(n=>{n.device.trainerAthleteId=e.target.value;});render();}catch(err){fail(err);}}if(e.target.id==='file-import'){importFile(e.target.files[0]);}});
window.addEventListener('storage',e=>{if(e.key===M.KEY){message('Данные изменены в другой вкладке. Перезагрузите приложение.');renderError='Конфликт нескольких вкладок. Перезагрузите страницу и используйте одну вкладку для измерения.';render();}});
window.addEventListener('pagehide',()=>{resetVoice();releaseWakeLock();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&run)acquireWakeLock();});
init();
})();
