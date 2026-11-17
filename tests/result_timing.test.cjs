const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../model.js'),config=require('../config.json');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fixture(state,soundEnabled=false){
  let clock=Date.now(),delayedResult,api,cancels=0,resumes=0;
  const spoken=[],utterances=[];
  class TestDate extends Date {static now(){return clock;}}
  const app={innerHTML:'',querySelector:()=>null,addEventListener(){}};
  const speechSynthesis={paused:false,cancel(){cancels++;},resume(){resumes++;this.paused=false;},speak(u){spoken.push(u.text);utterances.push(u);}};
  function SpeechSynthesisUtterance(text){this.text=text;}
  const window={ILModel:M,speechSynthesis,SpeechSynthesisUtterance,addEventListener(){}};
  const hooks=`window.testAPI={load(s){db=s;config=${JSON.stringify(config)};db.device.soundEnabled=${soundEnabled};},afterFinished,tick,resultProgress,sayAttempt,validateConfig,childReady,childFinal,restScreen,screen:()=>screen,until:()=>resultUntil};`;
  vm.runInNewContext(source.replace('init();\n})();',hooks+'\n})();'),{
    window,document:{getElementById:()=>app,addEventListener(){}},navigator:{},console,
    speechSynthesis,SpeechSynthesisUtterance,Date:TestDate,performance:{now:()=>1000},
    localStorage:{setItem(){}},setTimeout(fn,ms){if(ms===200)delayedResult=fn;},clearTimeout(){},
  });
  api=window.testAPI;api.load(state);
  return {api,app,spoken,utterances,speechSynthesis,advance(ms){clock+=ms;},show(){delayedResult();},clock:()=>clock,cancels:()=>cancels,resumes:()=>resumes};
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
  assert.equal(config.intervalCount,4);assert.equal(config.restDurationSec,15);assert.ok(!('resultPauseSec'in config));
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
