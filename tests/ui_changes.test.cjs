const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const get=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('athlete footer contains the version and administrator link on one line',()=>{
  const app=get('app.js');
  assert.match(app,/<footer class="nav-spacer app-footer"><span class="app-version">sidesteps v\. 0\.2\.7-rc\.7<\/span>/);
  assert.match(app,/<span aria-hidden="true">·<\/span> <a href="#admin-login" data-act="pin" title="Для администратора">Войти<\/a>/);
  assert.doesNotMatch(app,/Данные хранятся на этом устройстве|b\('Тренер','pin'/);
  assert.doesNotMatch(get('index.html'),/0\.2\.3/);
  assert.doesNotMatch(get('manifest.webmanifest'),/0\.2\.3/);
});
test('athlete heading and administrator terminology',()=>{
  const app=get('app.js');
  assert.match(app,/const label='Приставные шаги<br>на время'/);
  assert.doesNotMatch(app,/header\('(Спортсмен|Дети|Ребёнок)'/);
  assert.match(app,/header\('Администратор'/);
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

test('last solo result is displayed in milliseconds and voiced in tenths before the training summary',async()=>{
  const vm=require('node:vm');
  const M=require('../model.js');
  const config={...JSON.parse(get('config.json')),intervalCount:1,minTapGapMs:0};
  const appEvents={},documentEvents={},spoken=[];
  let initial=M.blank();
  initial.device.soloPlannedAttempts=1;
  let state=JSON.stringify(initial),now=1000,clock=Date.now(),tick,showResult;
  class TestDate extends Date { static now(){return clock;} }
  const app={innerHTML:'',querySelector:()=>null,addEventListener:(name,handler)=>{appEvents[name]=handler;}};
  const speechSynthesis={cancel(){},speak:utterance=>{spoken.push(utterance.text);utterance.onend();}};
  function SpeechSynthesisUtterance(text){this.text=text;}
  vm.runInNewContext(get('app.js'),{
    window:{ILModel:M,SideMigration:{run:()=>({})},addEventListener(){},speechSynthesis,SpeechSynthesisUtterance},
    document:{getElementById:()=>app,addEventListener:(name,handler)=>{documentEvents[name]=handler;}},
    localStorage:{getItem:()=>state,setItem:(_key,value)=>{state=value;}},
    fetch:async()=>({ok:true,json:async()=>config}),
    navigator:{},performance:{now:()=>now},console,speechSynthesis,SpeechSynthesisUtterance,
    Date:TestDate,setInterval:fn=>{tick=fn;},setTimeout:(fn,ms)=>{if(ms===200)showResult=fn;},clearTimeout(){},
  });
  await new Promise(resolve=>setImmediate(resolve));
  const click=act=>appEvents.click({target:{closest:()=>({matches:()=>false,dataset:{act}})}});
  click('open-exercise');
  const touch=pointerId=>({pointerId,pointerType:'touch',button:0,target:{closest:()=>true},preventDefault(){}});
  assert.match(app.innerHTML,/data-elapsed>0\.0 с/);
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
  clock+=config.resultDisplaySec*1000-1;
  tick();
  assert.match(app.innerHTML,/Попытка 1<\/h1>/);
  clock++;
  tick();
  assert.match(app.innerHTML,/Тренировка завершена<\/h1>/);
  assert.match(app.innerHTML,/1,446 с/);
  const cases=[
    [6970,'7 секунд'],[1000,'1 секунда'],[2000,'2 секунды'],
    [2300,'2,3 секунды'],[11000,'11 секунд'],[21000,'21 секунда'],
  ];
  for(const [duration,expected] of cases){
    click('final-home');
    click('open-exercise');
    now+=1000;
    appEvents.pointerdown(touch(1));
    documentEvents.pointerup(touch(1));
    now+=duration;
    appEvents.pointerdown(touch(2));
    const utteranceIndex=spoken.length;
    documentEvents.pointerup(touch(2));
    assert.equal(spoken[utteranceIndex],expected);
    showResult();
    clock+=config.resultDisplaySec*1000;
    tick();
  }
});
