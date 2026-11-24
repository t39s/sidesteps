const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const get=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('athlete footer centers coach link above version',()=>{
  const app=get('app.js');
  assert.match(app,/athlete-footer/);
  assert.match(app,/app-version">v\. 0\.3\.5-rc\.2/);
  assert.match(app,/<details class="history-more"><summary>Ещё<\/summary>[\s\S]*Интерфейс тренера<\/a>/);
  assert.match(get('styles.css'),/\.athlete-footer\{[^}]*flex-direction:column/);
  assert.doesNotMatch(app,/Данные хранятся на этом устройстве|b\('Тренер','pin'/);
  assert.doesNotMatch(get('index.html'),/0\.2\.3/);
  assert.doesNotMatch(get('manifest.webmanifest'),/0\.2\.3/);
});
test('athlete heading and administrator terminology',()=>{
  const app=get('app.js');
  assert.match(app,/const label='Приставные шаги<br>на время'/);
  assert.doesNotMatch(app,/header\('(Спортсмен|Дети|Ребёнок)'/);
  assert.match(app,/header\('Тренер'/);
  assert.match(app,/Нет — один участник/);
  assert.doesNotMatch(app,/Две попытки по умолчанию\. Лучший результат/);
});
test('personal progress shows up to 100 workouts with a fixed axis',()=>{
  const app=get('app.js');
  assert.match(app,/const visible=points\.slice\(scrollable\?-100:-5\)/);
  assert.match(app,/<rect x=/);
  assert.match(app,/aria-label="Столбчатый график/);
  assert.doesNotMatch(app,/class="chart-scroll"|min-width:\$\{Math\.min\(W/);
});
test('rest clock updates without replacing touch targets every tick',()=>{
  const app=get('app.js');
  assert.match(app,/\[data-rest-clock\]/);
  assert.match(app,/clock\.textContent=M\.mins\(remainingRest\(w\)\)/);
  assert.match(app,/case 'rest-early'/);
  assert.match(app,/restBypassedWorkout=w\?\.id/);
});

test('touch release voices a precise result once, with an independent display deadline',async()=>{
  const vm=require('node:vm');
  const M=require('../model.js');
  const config={...JSON.parse(get('config.json')),workingIntervalCount:1,minTapGapMs:500,resultDisplaySec:5,recordDisplaySec:10};
  const appEvents={},documentEvents={},spoken=[];
  let initial=M.blank();
  initial.device.soloPlannedAttempts=1;
  let state=JSON.stringify(initial),now=1000,clock=Date.now(),tick,showResult;
  class TestDate extends Date { static now(){return clock;} }
  const app={innerHTML:'',style:{},querySelector:()=>null,addEventListener:(name,handler)=>{appEvents[name]=handler;}};
  let heldSpeech=null,holdSpeech=true;
  const speechSynthesis={cancel(){},speak:utterance=>{
    spoken.push(utterance.text);
    if(holdSpeech)heldSpeech=utterance;
    else utterance.onend();
  }};
  function SpeechSynthesisUtterance(text){this.text=text;}
  vm.runInNewContext(get('app.js'),{
    window:{ILModel:M,SideMigration:{run:()=>({})},addEventListener(){},speechSynthesis,SpeechSynthesisUtterance},
    document:{getElementById:()=>app,addEventListener:(name,handler)=>{documentEvents[name]=handler;}},
    localStorage:{getItem:key=>key===M.KEY?state:key===M.SETTINGS_KEY?JSON.stringify({...M.defaultTrainerSettings(config,false),workingCountLocked:true}):null,setItem:(key,value)=>{if(key===M.KEY)state=value;}},
    fetch:async()=>({ok:true,json:async()=>config}),
    navigator:{},performance:{now:()=>now},console,speechSynthesis,SpeechSynthesisUtterance,
    Date:TestDate,setInterval:fn=>{tick=fn;},setTimeout:(fn,ms)=>{if(ms===200)showResult=fn;},clearTimeout(){},
  });
  await new Promise(resolve=>setImmediate(resolve));
  const click=act=>appEvents.click({target:{closest:()=>({matches:()=>false,dataset:{act}})}});
  click('open-exercise');
  click('settings');
  appEvents.change({target:{id:'attempt-count',value:'1'}});
  click('settings-save');
  appEvents.click({target:{closest:()=>({matches:()=>false,dataset:{act:'toggle-sound'},setAttribute(){}})}});
  click('open-exercise');
  const touch=pointerId=>({pointerId,pointerType:'touch',button:0,target:{closest:()=>true},preventDefault(){}});
  assert.match(app.innerHTML,/data-elapsed>0,0 с/);
  appEvents.pointerdown(touch(1));
  documentEvents.pointerup(touch(1));
  now=2446;
  appEvents.pointerdown(touch(2));
  assert.equal(JSON.parse(state).attempts[0].totalMs,1446);
  assert.equal(JSON.parse(state).workouts[0].status,'completed');
  assert.deepEqual(spoken,[]);
  documentEvents.pointerup(touch(3));
  assert.deepEqual(spoken,[]);
  now=3000;
  documentEvents.pointerup(touch(2));
  documentEvents.pointerup(touch(2));
  assert.deepEqual(spoken,['1,4 секунды']);
  showResult();
  assert.match(app.innerHTML,/Попытка 1<\/h1>/);
  assert.match(app.innerHTML,/class="display">1,446 с/);
  clock+=5000;
  tick();
  assert.match(app.innerHTML,/Тренировка завершена<\/h1>/);
  assert.match(app.innerHTML,/1,446 с/);
});
