const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../model.js'),config=require('../config.json');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fixture(state,soundEnabled=false){
  let stored=null;
  let clock=state.attempts.at(-1)?.endedAt?Date.parse(state.attempts.at(-1).endedAt):Date.now(),delayedResult,api,cancels=0,resumes=0,storageFailure=false,confirmResult=true,confirmWait=0;
  const spoken=[],utterances=[],bodyClasses=new Set();
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const handlers={};
  const app={innerHTML:'',style:{},querySelector:()=>null,addEventListener(name,handler){handlers[name]=handler;}};
  const speechSynthesis={paused:false,cancel(){cancels++;},resume(){resumes++;this.paused=false;},speak(u){spoken.push(u.text);utterances.push(u);}};
  function SpeechSynthesisUtterance(text){this.text=text;}
  const confirmations=[];
  const window={confirm(text){confirmations.push(text);clock+=confirmWait;return confirmResult;},ILModel:M,speechSynthesis,SpeechSynthesisUtterance,addEventListener(){}};
  const hooks=`window.testAPI={load(s){db=s;config=${JSON.stringify({...config,restDurationSec:15})};db.device.soundEnabled=${soundEnabled};},state:()=>db,afterFinished,tick,resultProgress,sayAttempt,validateConfig,childReady,childFinal,restScreen,tap,historyScreen,trainerHome,handleAction,render,setScreen(s){screen=s;},unlock(){trainerUnlocked=true;},screen:()=>screen,until:()=>resultUntil};`;
  vm.runInNewContext(source.replace('init();\n})();',hooks+'\n})();'),{
    window,document:{body:{classList:{toggle(name,on){if(on)bodyClasses.add(name);else bodyClasses.delete(name);}}},getElementById:()=>app,addEventListener(){}},navigator:{},console,
    speechSynthesis,SpeechSynthesisUtterance,Date:TestDate,performance:{now:()=>clock},
    localStorage:{getItem(){return stored;},setItem(key,value){if(storageFailure)throw Error('Storage unavailable');stored=value;}},setTimeout(fn,ms){if(ms===200)delayedResult=fn;},clearTimeout(){},
  });
  api=window.testAPI;api.load(state);
  return {api,app,submit(form){handlers.submit({target:form,preventDefault(){}});},spoken,utterances,speechSynthesis,bodyClasses,confirmations,setConfirm(result,wait=0){confirmResult=result;confirmWait=wait;},chooseAnimation(value){handlers.change({target:{name:'launch-animation',value}});},failStorage(){storageFailure=true;},advance(ms){clock+=ms;},show(){delayedResult();},clock:()=>clock,cancels:()=>cancels,resumes:()=>resumes};
}
function finish({child=false,pair=false,record=false,planned=1}={}){
  let state=M.blank();
  if(record)state=M.addArchived(state,'athlete-default','2026-01-01',10000).state;
  let workout;
  if(child){
    const ids=['athlete-default'];
    if(pair){const r=M.addAthlete(state,'Б');state=r.state;ids.push(r.value.id);}
    state=M.startChild(state,ids,planned).state;
    workout=M.nextTurn(state).workoutId;
  }else{const r=M.startSolo(state,'athlete-default',planned);state=r.state;workout=r.value.id;}
  const a=M.startAttempt(state,workout,'stopwatch',4);state=a.state;
  const result=M.finishAttempt(state,a.value.id,1446,[],new Date().toISOString());
  return {state:result.state,result:result.value};
}
for(const child of [false,true])for(const record of [false,true])for(const sound of [false,true]){
  test(`${child?'trainer':'athlete'} ${record?'record':'ordinary'} result: ${sound?'sound':'silent'}, time from appearance`,()=>{
    const {state,result}=finish({child,record});
    assert.equal(result.attempt.recordEvent,record);
    const f=fixture(state,sound);
    f.api.afterFinished(result,!child,null);
    if(!child){assert.equal(f.api.until(),null);f.advance(200);f.show();}
    assert.equal(f.api.screen(),'result');
    assert.match(f.app.innerHTML,/1,446 с/);
    const displayMs=(record?config.recordDisplaySec:config.resultDisplaySec)*1000;
    assert.equal(f.api.until(),f.clock()+displayMs);
    if(sound)assert.equal(f.spoken[0],'1,4 секунды');else assert.deepEqual(f.spoken,[]);
    // Speech deliberately stays unfinished: it must not extend screen time.
    f.advance(displayMs-1);f.api.resultProgress();assert.equal(f.api.screen(),'result');
    f.advance(1);f.api.resultProgress();assert.equal(f.api.screen(),child?'child-final':'final');
  });
}
test('paired trainer session shows each result before moving to next participant',()=>{
  const {state,result}=finish({child:true,pair:true,planned:2});const f=fixture(state);
  f.api.afterFinished(result,false,null);assert.equal(f.api.screen(),'result');
  f.advance(4999);f.api.resultProgress();assert.equal(f.api.screen(),'result');
  f.advance(1);f.api.resultProgress();assert.equal(f.api.screen(),'child-ready');
});
for(const record of [false,true])test(`athlete rest reminder once at 10 seconds left (${record?'record':'ordinary'})`,()=>{
  const {state,result}=finish({record,planned:2});const f=fixture(state,true);
  f.api.afterFinished(result,true,null);f.show();
  f.utterances[0].onend();
  if(record){assert.equal(f.spoken[1],'Новый рекорд!');f.utterances[1].onend();}
  const cancels=f.cancels();f.speechSynthesis.paused=true;
  f.advance(4999);f.api.tick();assert.ok(!f.spoken.includes('Пора начинать'));
  f.advance(1);f.api.tick();assert.equal(f.spoken.at(-1),'Пора начинать');
  assert.equal(f.cancels(),cancels);assert.equal(f.resumes(),1);
  f.api.tick();f.advance(5000);f.api.tick();
  assert.equal(f.spoken.filter(s=>s==='Пора начинать').length,1);
  f.advance(5000);f.api.tick();assert.equal(f.api.screen(),'athlete-ready');
});
test('silent athlete rest has no voice reminder and ends after 15 seconds',()=>{
  const {state,result}=finish({planned:2});const f=fixture(state);
  f.api.afterFinished(result,true,null);f.show();f.advance(5000);f.api.tick();
  assert.deepEqual(f.spoken,[]);f.advance(10000);f.api.tick();assert.equal(f.api.screen(),'athlete-ready');
});
test('spoken seconds use tenths and correct Russian plural forms',()=>{
  const f=fixture(M.blank(),true);
  for(const [totalMs,text] of [[6970,'7 секунд'],[1000,'1 секунда'],[2000,'2 секунды'],[2300,'2,3 секунды'],[11000,'11 секунд'],[21000,'21 секунда']]){
    f.api.sayAttempt({totalMs});assert.equal(f.spoken.at(-1),text);f.utterances.at(-1).onend();
  }
});
test('record announcement follows the time',()=>{
  const f=fixture(M.blank(),true);f.api.sayAttempt({totalMs:1446,recordEvent:true});
  assert.deepEqual(f.spoken,['1,4 секунды']);f.utterances[0].onend();
  assert.deepEqual(f.spoken,['1,4 секунды','Новый рекорд!']);
});
test('display config requires both perception durations',()=>{
  const f=fixture(M.blank());assert.ok(f.api.validateConfig(config));
  for(const key of ['resultDisplaySec','recordDisplaySec'])assert.throws(()=>f.api.validateConfig({...config,[key]:0}));
  assert.ok(!('resultPauseSec'in config));
});

test('trainer uses athlete measurement layout with participant identity',()=>{
  let s=M.blank();s=M.startChild(s,['athlete-default'],2).state;
  const f=fixture(s);const ready=f.api.childReady();
  assert.match(ready,/hero-title center">Попытка 1 из 2/);
  assert.match(ready,/participant-name">Спортсмен/);
  assert.match(ready,/personal-measure/);assert.match(ready,/play-glyph/);
  assert.match(ready,/data-elapsed>0,0 с/);
  const {state,result}=finish({child:true,planned:2});const r=fixture(state);
  r.api.afterFinished(result,false,null);
  assert.match(r.app.innerHTML,/attempt-result half-attempt/);
  assert.match(r.app.innerHTML,/personal-rest half-attempt/);
  const rest=r.api.restScreen(true,result.workout);
  assert.match(rest,/hero-title center">Отдых/);
  assert.match(rest,/personal-rest/);assert.match(rest,/participant-name">Спортсмен/);
});
test('trainer final summary preserves participant selector and workout details',()=>{
  let s=M.blank();const added=M.addAthlete(s,'Б');s=added.state;
  s=M.startChild(s,['athlete-default',added.value.id],1).state;
  for(let i=0;i<2;i++){
    const a=M.startAttempt(s,M.nextTurn(s).workoutId,'stopwatch',4);s=a.state;
    s=M.finishAttempt(s,a.value.id,1500+i*100,[]).state;
  }
  const f=fixture(s);const html=f.api.childFinal();
  assert.match(html,/hero-title center">Тренировка завершена/);
  assert.equal((html.match(/data-act="child-view"/g)||[]).length,2);
  assert.match(html,/Мой прогресс/);assert.match(html,/1,600/);
  assert.match(html,/data-act="history-child"/);
});

test('enabling sound on any screen is silent, subsequent events still speak',async()=>{
  for(const screen of ['athlete','trainer','history','settings','pin','athlete-ready','child-ready','result','final','child-final']){
    const {state,result}=finish({child:screen==='child-final'});const f=fixture(state);
    f.api.afterFinished(result, false, null);f.api.setScreen(screen);
    await f.api.handleAction('toggle-sound',{setAttribute(){}});
    assert.deepEqual(f.spoken,[],screen);
    f.api.sayAttempt(result.attempt);assert.equal(f.spoken[0],'1,4 секунды');
    await f.api.handleAction('toggle-sound',{setAttribute(){}});
    assert.ok(f.cancels()>0);
  }
});
test('trainer history has one login below brand and athlete history panels',()=>{
  for(const mode of ['child','trainer']){
    const {state}=finish({child:true});state.device.lastInterface=mode;
    const f=fixture(state);f.api.setScreen('history');if(mode==='trainer')f.api.unlock();
    f.api.render();const html=f.app.innerHTML;
    assert.equal((html.match(/data-act="pin"/g)||[]).length,1);
    assert.match(html,/<header[\s\S]*class="mode-tag header-login">Войти<\/a>[\s\S]*<\/header>/);
    assert.doesNotMatch(html,/data-act="back-history"|mode-tag">История/);
    assert.match(html,/Мой прогресс/);assert.match(html,/history-chart/);
    assert.match(html,/Спортсмен/);
  }
});
test('trainer exit is a link and returns to athlete history',async()=>{
  const s=M.blank();s.device.lastInterface='trainer';const f=fixture(s);f.api.unlock();
  const html=f.api.trainerHome();assert.match(html,/<a href="#exit" data-act="switch-athlete" class="mode-tag trainer-exit">Выйти<\/a>/);
  assert.doesNotMatch(html,/Мои упражнения/);
  await f.api.handleAction('switch-athlete',{});assert.equal(f.api.screen(),'athlete');
});

test('participant tabs select the same athlete on final and history screens',async()=>{
  let s=M.blank();const added=M.addAthlete(s,'Второй');s=added.state;
  s=M.startChild(s,['athlete-default',added.value.id],1).state;
  for(let i=0;i<2;i++){
    const a=M.startAttempt(s,M.nextTurn(s).workoutId,'stopwatch',4);s=a.state;
    s=M.finishAttempt(s,a.value.id,1500+i*100,[]).state;
  }
  const f=fixture(s);
  const selected=id=>new RegExp(`id="profile-tab-${id}"[^>]*aria-selected="true"`);
  let html=f.api.childFinal();
  assert.match(html,/<h1 class="hero-title center">Тренировка завершена<\/h1><\/section>/);
  assert.match(html,/class="athlete-tabs participant-tabs" role="tablist"/);
  assert.match(html,selected(added.value.id));
  await f.api.handleAction('child-view',{dataset:{id:'athlete-default'}});
  assert.match(f.app.innerHTML,selected('athlete-default'));
  await f.api.handleAction('history-child',{});
  assert.match(f.app.innerHTML,selected('athlete-default'));
  assert.match(f.app.innerHTML,/header-login">Войти/);
  await f.api.handleAction('history-profile',{dataset:{id:added.value.id}});
  assert.match(f.app.innerHTML,selected(added.value.id));
  assert.match(f.app.innerHTML,/1,600/);
  await f.api.handleAction('history-profile',{dataset:{id:'unrelated'}});
  assert.match(f.app.innerHTML,selected(added.value.id));
});

test('trainer background scope and final login under brand',async()=>{
  const {state}=finish({child:true});const f=fixture(state);
  f.api.setScreen('child-final');f.api.render();
  assert.ok(f.bodyClasses.has('trainer-theme'));
  assert.equal((f.app.innerHTML.match(/data-act="pin"/g)||[]).length,1);
  assert.match(f.app.innerHTML,/<header[\s\S]*header-login">Войти<\/a>[\s\S]*<\/header>/);
  await f.api.handleAction('switch-athlete',{});
  assert.ok(!f.bodyClasses.has('trainer-theme'));
});

test('trainer session login stays beneath brand on every screen, never in footer',()=>{
  const {state,result}=finish({child:true,planned:2});const f=fixture(state);
  f.api.afterFinished(result,false,null);
  for(const screen of ['child-ready','result','rest','child-final','history','settings']){
    f.api.setScreen(screen);f.api.render();const html=f.app.innerHTML;
    assert.equal((html.match(/data-act="pin"/g)||[]).length,1,screen);
    assert.match(html,/<header[\s\S]*header-login">Войти<\/a>[\s\S]*<\/header>/,screen);
    assert.doesNotMatch(html,/<footer[\s\S]*data-act="pin"/,screen);
  }
});

test('trainer settings are disabled in markup and action handler; athlete settings remain available',async()=>{
  for(const mode of ['trainer','child','athlete']){
    const s=M.blank();s.device.lastInterface=mode;const f=fixture(s);f.api.setScreen(mode==='trainer'?'trainer':mode==='child'?'child-ready':'athlete');
    if(mode==='trainer')f.api.unlock();f.api.render();
    if(mode!=='athlete')assert.match(f.app.innerHTML,/aria-label="Настройки" disabled/);
    await f.api.handleAction('settings',{});
    assert.equal(f.api.screen()==='settings',mode==='athlete');
  }
});
test('start-stop shares play surface and shows large elapsed time with two-touch measurement',async()=>{
  const s=M.blank();s.device.soloMeasurementMode='stopwatch';s.device.soloPlannedAttempts=1;
  const f=fixture(s);f.api.setScreen('athlete-ready');f.api.render();
  assert.match(f.app.innerHTML,/counter-ready/);assert.doesNotMatch(f.app.innerHTML,/КОСНИСЬ|СТАРТ–СТОП|интервалов/);
  f.api.tap();f.advance(1500);f.api.render();
  assert.match(f.app.innerHTML,/class="stopwatch-counter" data-elapsed>1,5 с/);
  f.api.tap();f.show();assert.match(f.app.innerHTML,/1,500 с/);
});

test('athlete administrator login gear is disabled and settings work again after returning',async()=>{
  const f=fixture(M.blank());f.api.setScreen('athlete');
  await f.api.handleAction('pin',{});f.api.render();
  assert.match(f.app.innerHTML,/aria-label="Настройки" disabled/);
  await f.api.handleAction('settings',{});assert.equal(f.api.screen(),'pin');
  await f.api.handleAction('pin-back',{});assert.equal(f.api.screen(),'athlete');
  assert.doesNotMatch(f.app.innerHTML,/aria-label="Настройки" disabled/);
  await f.api.handleAction('settings',{});assert.equal(f.api.screen(),'settings');
});

for(const destination of ['settings','pin'])for(const record of [false,true])for(const sound of [false,true]){
  test(`result deadline recovers after early ${destination} navigation (${record?'record':'ordinary'}, ${sound?'sound':'silent'})`,async()=>{
    const {state,result}=finish({record});const f=fixture(state,sound);
    f.api.afterFinished(result,true,null);
    await f.api.handleAction(destination,{});
    f.advance(200);f.show();
    assert.equal(f.api.until(),null);
    f.advance(1000);
    await f.api.handleAction(destination+'-back',{});
    assert.equal(f.api.screen(),'result');
    const duration=(record?config.recordDisplaySec:config.resultDisplaySec)*1000;
    assert.equal(f.api.until(),f.clock()+duration);
    f.advance(duration-1);f.api.tick();assert.equal(f.api.screen(),'result');
    f.advance(1);f.api.tick();assert.equal(f.api.screen(),'final');
  });
}
test('a delayed render does not restart an already displayed result deadline',async()=>{
  const {state,result}=finish();const f=fixture(state);
  f.api.afterFinished(result,true,null);
  await f.api.handleAction('settings',{});
  await f.api.handleAction('settings-back',{});
  const deadline=f.api.until();assert.notEqual(deadline,null);
  f.advance(200);f.show();assert.equal(f.api.until(),deadline);
  f.api.render();assert.equal(f.api.until(),deadline);
});

function readyFixture(mode='intervals',{child=false,pair=false}={}){
  let s=M.blank();s.device.soloMeasurementMode=mode;s.device.measurementMode=mode;
  if(child){const ids=['athlete-default'];if(pair){const added=M.addAthlete(s,'Б');s=added.state;ids.push(added.value.id);}s=M.startChild(s,ids,2).state;}
  const f=fixture(s);f.api.setScreen(child?'child-ready':'athlete-ready');f.api.render();return f;
}
for(const mode of ['intervals','stopwatch'])for(const child of [false,true]){
  test(`${mode} ${child?'child':'athlete'}: launch cancellation preserves same attempt and clears counters`,async()=>{
    const f=readyFixture(mode,{child});assert.match(f.app.innerHTML,/data-act="end-training"/);
    assert.doesNotMatch(f.app.innerHTML,/data-act="cancel-launch"/);
    f.api.tap();f.advance(900);if(mode==='intervals')f.api.tap();
    assert.match(f.app.innerHTML,/data-act="cancel-launch"/);
    await f.api.handleAction('cancel-launch');
    assert.equal(f.api.state().attempts[0].interruptionReason,'start_cancelled');
    assert.match(f.app.innerHTML,/play-glyph/);assert.match(f.app.innerHTML,/Попытка 1 из 2/);
    f.api.tap();assert.equal(f.api.state().attempts[1].ordinal,1);
    assert.equal(f.api.state().attempts[1].intervalsMs.length,0);
  });
}
test('cancellation button disappears at 10 seconds and stale click cannot cancel',async()=>{
  const f=readyFixture('stopwatch');f.api.tap();const control={hidden:false};
  f.app.querySelector=selector=>selector==='[data-cancel-launch]'?control:null;
  f.advance(9999);f.api.tick();assert.equal(control.hidden,false);
  f.advance(1);f.api.tick();assert.equal(control.hidden,true);
  await f.api.handleAction('cancel-launch');assert.equal(f.api.state().attempts[0].status,'running');
  await f.api.handleAction('end-training');assert.equal(f.api.screen(),'athlete');
  assert.equal(f.api.state().attempts[0].interruptionReason,'early_end');
});
for(const child of [false,true])test(`${child?'child':'athlete'}: cancellation of early second start returns to remaining rest`,async()=>{
  const {state,result}=finish({child,planned:2});const f=fixture(state);
  f.api.afterFinished(result,!child,null);if(!child)f.show();
  await f.api.handleAction('rest-early');f.api.tap();f.advance(1000);
  await f.api.handleAction('cancel-launch');assert.equal(f.api.screen(),'rest');
  assert.match(f.app.innerHTML,/Начать раньше/);
  assert.equal(f.api.state().workouts[0].firstEndedAt,result.attempt.endedAt);
  f.advance(14000);f.api.tick();assert.equal(f.api.screen(),child?'child-ready':'athlete-ready');
});
test('cross before first launch returns home without stored workout',async()=>{
  const f=readyFixture();await f.api.handleAction('end-training');
  assert.equal(f.api.screen(),'athlete');assert.deepEqual(f.api.state().workouts,[]);
});
test('cross on paired result ends the displayed athlete, including through PIN navigation',async()=>{
  for(const pin of [false,true]){
    const {state,result}=finish({child:true,pair:true,planned:2}),f=fixture(state);
    f.api.afterFinished(result,false,null);
    const before=M.nextTurn(f.api.state());
    if(pin)await f.api.handleAction('pin');
    await f.api.handleAction('end-training');
    assert.deepEqual(M.nextTurn(f.api.state()),before);
    assert.equal(M.workoutOf(f.api.state(),result.workout.id).closeReason,'early_end');
    assert.equal(f.api.screen(),'child-ready');
  }
});
test('coach cross ends whole running session',async()=>{
  const f=readyFixture('intervals',{child:true,pair:true});f.api.tap();f.advance(800);f.api.tap();
  f.api.unlock();f.api.state().device.lastInterface='trainer';f.api.setScreen('trainer');f.api.render();
  await f.api.handleAction('end-training');
  assert.equal(f.api.screen(),'trainer');assert.equal(M.currentChild(f.api.state()),null);
  assert.equal(f.api.state().attempts[0].elapsedMs,800);
});
test('cross is last header control during training and absent from home',()=>{
  const {state,result}=finish(),f=fixture(state);f.api.afterFinished(result,false,null);
  for(const screen of ['athlete-ready','result','rest']){
    f.api.setScreen(screen);f.api.render();const html=f.app.innerHTML;
    assert.match(html,/<header[\s\S]*data-act="toggle-sound"[\s\S]*data-act="settings"[\s\S]*data-act="end-training"[\s\S]*<\/header>/);
  }
  f.api.setScreen('athlete');f.api.render();assert.doesNotMatch(f.app.innerHTML,/data-act="end-training"/);
});
test('storage failure cannot falsely cancel or close the running workout',async()=>{
  for(const action of ['cancel-launch','end-training']){
    const f=readyFixture('stopwatch');f.api.tap();f.advance(900);f.failStorage();
    const original=console.error;console.error=()=>{};
    try{await f.api.handleAction(action);}finally{console.error=original;}
    assert.equal(f.api.state().attempts[0].status,'running');
    assert.equal(f.api.screen(),'athlete-ready');
  }
});

test('animation settings follow training and show three live radio samples',()=>{
  const f=readyFixture();f.api.setScreen('settings');f.api.render();const html=f.app.innerHTML;
  assert.ok(html.indexOf('<h2>Тренировка</h2>')<html.indexOf('Анимация запуска'));
  for(const name of ['Сияние','Пульсация','Без анимации'])assert.ok(html.includes(name));
  assert.equal((html.match(/name="launch-animation"/g)||[]).length,3);
  assert.equal((html.match(/class="animation-sample"/g)||[]).length,3);
  assert.match(html,/value="pulse" checked/);
});
for(const value of ['glow','pulse','none'])test(`animation selection ${value} applies in both measurement modes and on coach device`,()=>{
  for(const child of [false,true])for(const mode of ['intervals','stopwatch']){
    const f=readyFixture(mode,{child});f.api.setScreen('settings');f.chooseAnimation(value);
    assert.equal(f.api.state().device.launchAnimation,value);
    f.api.render();assert.ok(f.app.innerHTML.includes(`value="${value}" checked`));
    f.api.setScreen(child?'child-ready':'athlete-ready');f.api.render();
    assert.ok(f.app.innerHTML.includes(`counter counter-ready launch-${value}`));
  }
});
test('confirm rejection preserves running attempt and waiting time stays in result',async()=>{
  const f=readyFixture('stopwatch');f.api.tap();f.advance(700);f.setConfirm(false,5000);
  await f.api.handleAction('end-training');
  assert.equal(f.confirmations.length,1);assert.match(f.confirmations[0],/Текущая попытка будет прервана/);
  assert.equal(f.api.state().attempts[0].status,'running');f.advance(800);f.api.tap();
  assert.equal(f.api.state().attempts[0].totalMs,6500);
});
test('confirm acceptance captures interruption after response, including within first 10 seconds',async()=>{
  const f=readyFixture('intervals');f.api.tap();f.advance(800);f.api.tap();f.setConfirm(true,3000);
  await f.api.handleAction('end-training');
  assert.equal(f.confirmations.length,1);assert.equal(f.api.state().attempts[0].elapsedMs,3800);
  assert.deepEqual(f.api.state().attempts[0].intervalsMs,[800]);
  assert.equal(f.api.state().attempts[0].interruptionReason,'early_end');
});
test('launch cancellation and closing an unstarted training do not ask for confirmation',async()=>{
  const f=readyFixture();await f.api.handleAction('end-training');assert.equal(f.confirmations.length,0);
  f.api.setScreen('athlete-ready');f.api.tap();f.advance(800);await f.api.handleAction('cancel-launch');
  assert.equal(f.confirmations.length,0);
});
test('coach force-close during measurement asks once',async()=>{
  const f=readyFixture('stopwatch',{child:true});f.api.tap();
  f.api.unlock();f.api.state().device.lastInterface='trainer';f.api.setScreen('trainer');
  await f.api.handleAction('force-child');assert.equal(f.confirmations.length,1);
  assert.equal(M.currentChild(f.api.state()),null);
});

test('automatic animation changes after local midnight without replacing measurement surface',()=>{
  const f=readyFixture(),day=new Date(f.clock());
  f.api.state().device.launchAnimationFirstDay=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
  const glyph={className:'counter counter-ready launch-pulse'};
  f.app.querySelector=selector=>selector==='[data-launch-animation]'?glyph:null;
  const before=f.app.innerHTML;f.advance(24*60*60*1000);f.api.tick();
  assert.equal(glyph.className,'counter counter-ready launch-glow');assert.equal(f.app.innerHTML,before);
});


for(const child of [false,true])test(`completed workout has no close control in ${child?'coach':'athlete'} mode`,()=>{
  const {state,result}=finish({child}),f=fixture(state);
  f.api.afterFinished(result,false,null);
  assert.match(f.app.innerHTML,/data-act="end-training"/);
  f.advance(10000);
  f.api.resultProgress();
  assert.equal(f.api.screen(),child?'child-final':'final');
  assert.match(f.app.innerHTML,/Тренировка завершена/);
  assert.doesNotMatch(f.app.innerHTML,/data-act="end-training"/);
  assert.match(f.app.innerHTML,child?/data-act="history-child"/:/data-act="final-home"/);
});

test('coach edits or cancels an athlete name without changing profile identity or history',async()=>{
  const {state,result}=finish({child:true}),profile=state.athletes[0];
  const f=fixture(state);
  f.api.setScreen('trainer');
  f.api.state().device.lastInterface='trainer';
  f.api.unlock();
  f.api.render();
  assert.match(f.app.innerHTML,/Переименовать/);
  assert.match(f.app.innerHTML,/name="athlete-name" value="Спортсмен"/);
  const field={value:'',focus(){},select(){}};
  const name={textContent:profile.name},option={value:profile.id,textContent:profile.name};
  const toggle={closest:()=>row,focus(){},setAttribute(){}};
  const form={hidden:true,dataset:{athleteId:profile.id},elements:{'athlete-name':field},matches:()=>true,closest:()=>row};
  const row={querySelector(selector){return {'.athlete-rename':form,'[data-athlete-name]':name,'[data-act="rename-athlete"]':toggle}[selector];}};
  f.app.querySelectorAll=()=>[option];

  await f.api.handleAction('rename-athlete',toggle);
  assert.equal(field.value,profile.name);
  field.value='Черновик';
  await f.api.handleAction('cancel-athlete-rename',toggle);
  assert.equal(form.hidden,true);
  assert.equal(f.api.state().athletes[0].name,profile.name);
  await f.api.handleAction('rename-athlete',toggle);
  assert.equal(field.value,profile.name);
  field.value='  Новое <имя>  ';
  f.submit(form);
  assert.equal(form.hidden,true);
  assert.equal(name.textContent,'Новое <имя>');
  assert.equal(option.textContent,name.textContent);
  assert.equal(f.api.state().athletes[0].id,profile.id);
  assert.deepEqual(f.api.state().attempts,state.attempts);
  assert.equal(f.api.state().workouts[0].athleteId,result.workout.athleteId);
  f.api.render();
  assert.match(f.app.innerHTML,/Новое &lt;имя&gt;/);
  assert.throws(()=>M.renameAthlete(f.api.state(),profile.id,'  '),/Имя: от 1 до 50 символов/);
});
