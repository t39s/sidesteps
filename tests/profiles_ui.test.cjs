const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),M=require('../model.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
async function page(initial={},options={}){
 const data=new Map(Object.entries(initial)),nodes={},events={},appEvents={},messages=[];let failWrite=false;
 const app={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(k,v)=>appEvents[k]=v};
 const store={getItem:k=>{const value=data.get(k)??null;options.onRead?.(k,data);return value;},setItem(k,v){if(failWrite)throw Error('Quota exceeded');data.set(k,v);},removeItem:k=>data.delete(k)};
 const browser={ILModel:M,SideMigration:require('../migration.js'),addEventListener:(k,v)=>events[k]=v,confirm:()=>options.confirm!==false,prompt:()=>null};
 const hooks=`window.api={init,handleAction,importFile,exportSnapshot,operate,statsPoints,recordAsOf,workoutDetails,archiveHistory,historyItems,interruptedAttempts,expanded:key=>expandedLists.has(key),settings:()=>trainerSettings(),state:()=>db,authorized:()=>trainerUnlocked,unlock:()=>{trainerUnlocked=true;},screen:()=>screen};`;
 vm.runInNewContext(source.replace('init();\n})();',hooks+'\ninit();\n})();'),{
 window:browser,document:{getElementById:k=>k==='app'?app:k==='toast'?{style:{},set textContent(v){messages.push(v);}}:nodes[k],addEventListener(){}},
 localStorage:store,fetch:async()=>({ok:true,json:async()=>({...require('../config.json'),trainerAccess:options.noPin?null:require('../config.json').trainerAccess})}),
 navigator:{},console:{error(){}},Date,performance:{now:()=>1000},setTimeout(){},clearTimeout(){},setInterval(){},
 crypto:{subtle:{importKey:async()=>0,deriveBits:async()=>new Uint8Array(32).buffer}},TextEncoder,atob,
 });
 await new Promise(r=>setImmediate(r));return {data,store,nodes,events,appEvents,messages,api:browser.api,html:()=>app.innerHTML,failWrite(){failWrite=true;}};
}
const v5=require('./fixtures/v5-multiple.json');
test('multi startup waits without any v5 or v6 write; cancel/reload/no PIN unchanged',async()=>{const bytes=JSON.stringify(v5);for(const noPin of [false,true]){const p=await page({[M.V5_KEY]:bytes},{noPin});assert.match(p.html(),/Выберите базовый профиль/);assert.equal(p.data.get(M.V5_KEY),bytes);assert.equal(p.data.has(M.KEY),false);await p.api.handleAction('pin-back');assert.equal(p.data.has(M.KEY),false);await p.api.init();assert.equal(p.data.get(M.V5_KEY),bytes);assert.equal(p.data.has(M.KEY),false);}});
test('authorized migration second profile commits v6 preserving source; reload idempotent',async()=>{const bytes=JSON.stringify(v5),p=await page({[M.V5_KEY]:bytes});p.api.unlock();p.nodes['base-choice']={value:v5.athletes[1].id};await p.api.handleAction('migration-confirm');assert.equal(p.api.state().baseProfileId,v5.athletes[1].id);assert.equal(p.data.get(M.V5_KEY),bytes);assert.equal(p.api.authorized(),true);const q=await page(Object.fromEntries(p.data));assert.equal(q.api.state().baseProfileId,v5.athletes[1].id);assert.equal(q.api.authorized(),false);assert.deepEqual(q.api.state().athletes,v5.athletes);});
test('failed migration write leaves source and candidate absent',async()=>{const bytes=JSON.stringify(v5),p=await page({[M.V5_KEY]:bytes});p.api.unlock();p.nodes['base-choice']={value:v5.athletes[1].id};p.failWrite();await p.api.handleAction('migration-confirm');assert.equal(p.data.get(M.V5_KEY),bytes);assert.equal(p.data.has(M.KEY),false);assert.ok(p.messages.some(x=>x.includes('Quota')));});
test('single startup preserves v5 and runs existing recovery',async()=>{const v=require('./fixtures/v5-running.json'),single=M.clone(v);single.athletes=[single.athletes[0]];const bytes=JSON.stringify(single),p=await page({[M.V5_KEY]:bytes});assert.equal(p.data.get(M.V5_KEY),bytes);assert.equal(p.api.state().attempts[0].status,'interrupted');});
test('import conflict, invalid JSON, quota all retain exact saved bytes',async()=>{const s=M.addArchived(M.blank(),'athlete-default','2026-01-01',2000).state,p=await page({[M.KEY]:JSON.stringify(s)});const bytes=p.data.get(M.KEY);for(const raw of ['{bad',JSON.stringify({...s,archived:[]})]){await p.api.importFile({text:async()=>raw});assert.equal(p.data.get(M.KEY),bytes);}p.failWrite();await p.api.importFile({text:async()=>JSON.stringify(s)});assert.equal(p.data.get(M.KEY),bytes);});
test('multi placeholder import choice cancels without writes, confirms one candidate',async()=>{const empty=M.blank();empty.device.lastInterface='trainer';const p=await page({[M.KEY]:JSON.stringify(empty)});p.api.unlock();const bytes=p.data.get(M.KEY),incoming=M.migrateV5ToV6(v5,v5.athletes[0].id);await p.api.importFile({text:async()=>JSON.stringify(incoming)});assert.match(p.html(),/Выберите базовый профиль/);assert.equal(p.data.get(M.KEY),bytes);await p.api.handleAction('import-cancel');assert.equal(p.data.get(M.KEY),bytes);await p.api.importFile({text:async()=>JSON.stringify(incoming)});p.nodes['base-choice']={value:v5.athletes[1].id};await p.api.handleAction('import-confirm');assert.equal(p.api.state().baseProfileId,v5.athletes[1].id);});
test('exports never grant privileges; personal export only base, trainer export all',async()=>{const s=M.migrateV5ToV6(v5,v5.athletes[0].id);s.device.trainerActivated=true;s.device.trainerAthleteId=v5.athletes[1].id;s.device.lastInterface='trainer';const p=await page({[M.KEY]:JSON.stringify(s)});let out=p.api.exportSnapshot();assert.equal(out.athletes.length,1);assert.equal(out.baseProfileId,s.baseProfileId);assert.equal(out.device.trainerActivated,false);p.api.unlock();out=p.api.exportSnapshot();assert.equal(out.athletes.length,2);assert.equal(out.device.trainerActivated,false);});
test('stale storage blocks commit and protected actions until reload',async()=>{const p=await page();p.api.unlock();p.data.set(M.KEY,'changed');assert.throws(()=>p.api.operate(s=>M.renameAthlete(s,s.baseProfileId,'X')),/другой вкладке/);assert.equal(p.data.get(M.KEY),'changed');p.events.storage({key:M.KEY});assert.equal(p.api.authorized(),true);await p.api.handleAction('set-base',{dataset:{id:'missing'}});assert.equal(p.data.get(M.KEY),'changed');});

test('leaving coach solo session blocks its continuation until PIN, preserving recovery',async()=>{let s=M.migrateV5ToV6(v5,v5.athletes[0].id),aid=v5.athletes[1].id;s=M.mutation(s,n=>{n.device.activeWorkoutId=M.newWorkout(n,aid,2).id;}).state;s.device.trainerAthleteId=aid;s.device.lastInterface='athlete';const p=await page({[M.KEY]:JSON.stringify(s)});assert.equal(p.api.screen(),'pin');await p.api.handleAction('pin-back');await p.api.handleAction('open-exercise');assert.equal(p.api.screen(),'pin');assert.equal(p.api.state().device.activeWorkoutId,s.device.activeWorkoutId);p.api.unlock();await p.api.handleAction('resume-additional-solo');assert.equal(p.api.screen(),'athlete-ready');assert.equal(p.api.state().device.activeWorkoutId,s.device.activeWorkoutId);});

test('startup cannot overwrite a newer snapshot observed after parsing its input',async()=>{const original=M.blank(),newer=JSON.stringify(M.renameAthlete(original,original.baseProfileId,'Другая вкладка').state);let reads=0;const p=await page({[M.KEY]:JSON.stringify(original)},{onRead(k,data){if(k===M.KEY&&++reads===2)data.set(k,newer);}});assert.equal(p.data.get(M.KEY),newer);assert.match(p.html(),/Не удалось открыть историю/);});
test('single migration cannot overwrite v6 concurrently created by another tab',async()=>{const source=JSON.stringify(require('./fixtures/v5-single.json')),newer=JSON.stringify(M.renameAthlete(M.blank(),'athlete-default','Другая вкладка').state);let reads=0;const p=await page({[M.V5_KEY]:source},{onRead(k,data){if(k===M.V5_KEY&&++reads===2)data.set(M.KEY,newer);}});assert.equal(p.data.get(M.KEY),newer);assert.equal(p.data.get(M.V5_KEY),source);assert.match(p.html(),/Не удалось открыть историю/);});
test('base selection migrates v5 session after a previously deleted workout, without touching source',async()=>{const v=require('./fixtures/v5-deleted-session-workout.json'),bytes=JSON.stringify(v),p=await page({[M.V5_KEY]:bytes});assert.equal(p.data.has(M.KEY),false);p.api.unlock();p.nodes['base-choice']={value:v.athletes[1].id};await p.api.handleAction('migration-confirm');assert.equal(p.api.state().baseProfileId,v.athletes[1].id);assert.deepEqual(p.api.state().workouts,v.workouts);assert.deepEqual(p.api.state().attempts,v.attempts);assert.equal(p.api.state().childSessions.length,v.childSessions.length);assert.equal(p.data.get(M.V5_KEY),bytes);const q=await page(Object.fromEntries(p.data));assert.equal(q.api.state().baseProfileId,v.athletes[1].id);assert.deepEqual(q.api.state().attempts,v.attempts);});

test('personal history scopes manual archive input; settings keep data exchange',async()=>{
  const p=await page();
  await p.api.handleAction('settings');
  assert.match(p.html(),/Обменяться данными[\s\S]*Выгрузить/);
  assert.doesNotMatch(p.html(),/Добавить архивный результат/);
  await p.api.handleAction('settings-back');
  assert.match(p.html(),/Добавить архивный результат/);
  p.nodes['archive-date']={value:'2026-11-01'};
  p.nodes['archive-time']={value:'12,345'};
  await p.api.handleAction('add-archive');
  assert.equal(p.api.state().archived[0].athleteId,p.api.state().baseProfileId);
  assert.equal(p.api.state().archived[0].bestMs,12345);
  assert.equal(p.api.authorized(),false);
});
test('personal deletion cancellation and write failure leave exact bytes unchanged',async()=>{
  const s=M.addArchived(M.blank(),'athlete-default','2026-11-01',2000).state;
  for(const cancel of [true,false]){
    const p=await page({[M.KEY]:JSON.stringify(s)},{confirm:!cancel});
    await p.api.handleAction('settings');
    p.appEvents.change({target:{id:'show-history-delete',checked:true}});
    await p.api.handleAction('settings-back');
    const before=p.data.get(M.KEY);
    if(!cancel)p.failWrite();
    await p.api.handleAction('delete-archived',{dataset:{id:s.archived[0].id}});
    assert.equal(p.data.get(M.KEY),before);
    assert.equal(p.api.state().archived.length,1);
  }
});
test('personal multiprofile import selection cancels safely and imports only selected profile',async()=>{
  let s=M.addAthlete(M.blank(),'Выбранный').state;
  const aid=s.athletes[1].id;
  s=M.addArchived(s,aid,'2026-11-01',2000).state;
  const p=await page(),before=p.data.get(M.KEY);
  await p.api.importFile({text:async()=>JSON.stringify(s)});
  assert.match(p.html(),/Выберите профиль для загрузки/);
  assert.equal(p.data.get(M.KEY),before);
  await p.api.handleAction('import-cancel');
  assert.equal(p.data.get(M.KEY),before);
  await p.api.importFile({text:async()=>JSON.stringify(s)});
  p.nodes['base-choice']={value:aid};
  await p.api.handleAction('import-confirm');
  assert.equal(p.api.state().athletes.length,1);
  assert.equal(p.api.state().baseProfileId,aid);
  assert.equal(p.api.state().archived.length,1);
  assert.equal(p.api.authorized(),false);
});

test('personal profile rename preserves identity and history in export and reload',async()=>{
  let s=M.addAthlete(M.blank(),'Другой').state;
  s=M.addArchived(s,s.baseProfileId,'2026-11-01',1000).state;
  const p=await page({[M.KEY]:JSON.stringify(s)});
  await p.api.handleAction('settings');
  assert.match(p.html(),/Тренировка[\s\S]*Название профиля[\s\S]*Обменяться данными/);
  p.nodes['profile-name']={value:'  Моё имя  '};
  await p.api.handleAction('save-profile-name',{dataset:{id:s.athletes[1].id}});
  const out=p.api.exportSnapshot();
  assert.equal(out.athletes[0].id,s.baseProfileId);
  assert.equal(out.athletes[0].name,'Моё имя');
  assert.deepEqual(out.archived,s.archived);
  assert.equal(p.api.state().athletes[1].name,'Другой');
  assert.equal(p.api.authorized(),false);
  const q=await page(Object.fromEntries(p.data));
  assert.equal(q.api.state().athletes[0].name,'Моё имя');
});
test('personal profile rename rejects invalid input and failed writes atomically',async()=>{
  for(const value of ['', ' '.repeat(2), 'a'.repeat(51), 'Новое имя']){
    const p=await page();
    await p.api.handleAction('settings');
    const before=p.data.get(M.KEY);
    p.nodes['profile-name']={value};
    if(value==='Новое имя')p.failWrite();
    await p.api.handleAction('save-profile-name');
    assert.equal(p.data.get(M.KEY),before);
    assert.equal(p.api.state().athletes[0].name,'Спортсмен');
  }
});

test('personal history counts the separate latest workout within the five-workout limit',async()=>{
  let s=M.blank();
  for(let i=0;i<6;i++){
    const w=M.startSolo(s,s.baseProfileId,1);
    const a=M.startAttempt(w.state,w.value.id,'intervals',20);
    s=M.finishAttempt(a.state,a.value.id,1000+i*100,Array(20).fill(50+i*5)).state;
    s.workouts.at(-1).createdAt=`2026-11-${String(i+1).padStart(2,'0')}T12:00:00.000Z`;
    if(i>=4){
      const p=await page({[M.KEY]:JSON.stringify(s)});
      const html=p.html();
      assert.ok(html.indexOf('<h2>Мой прогресс</h2>')<html.indexOf('<h2>Тренировка '));
      const previous=html.split('<h2>Предыдущие тренировки</h2>')[1];
      assert.equal((previous.match(/class="history-item"/g)||[]).length,4);
      assert.equal(previous.includes('Все тренировки ('),i===5);
      assert.match(html,/Комментарии<.*textarea name="athleteComment"/);
    }
  }
});

test('permanent trainer settings require current PIN authority, persist and stay outside exports',async()=>{
  const p=await page();
  p.nodes['working-count']={value:'30'};p.nodes['test-count']={value:'3'};
  p.nodes['work-rest']={value:'90'};p.nodes['test-rest']={value:'15'};
  const initial=p.data.get(M.SETTINGS_KEY);
  await p.api.handleAction('save-trainer-settings');assert.equal(p.data.get(M.SETTINGS_KEY),initial);
  p.api.unlock();await p.api.handleAction('pin');
  await p.api.handleAction('save-trainer-settings');
  assert.equal(p.api.settings().workingIntervalCount,30);
  assert.equal(p.api.settings().workingCountLocked,true);
  const saved=p.data.get(M.SETTINGS_KEY),out=p.api.exportSnapshot();
  assert.equal(JSON.stringify(out).includes('workingIntervalCount'),false);
  const q=await page(Object.fromEntries(p.data));
  assert.equal(q.data.get(M.SETTINGS_KEY),saved);assert.equal(q.api.settings().testIntervalCount,3);
  assert.equal(q.api.authorized(),false);assert.equal(q.api.state().device.soloMeasurementMode,'intervals');
  assert.equal(q.api.state().device.soloPlannedAttempts,2);assert.equal(q.api.state().device.soundEnabled,false);
  await q.api.importFile({text:async()=>JSON.stringify(out)});
  assert.equal(q.data.get(M.SETTINGS_KEY),saved);
});
test('trainer settings quota and stale storage failures retain settings and history',async()=>{
  for(const stale of [false,true]){
    const p=await page();p.api.unlock();await p.api.handleAction('pin');
    p.nodes['working-count']={value:'30'};p.nodes['test-count']={value:'3'};
    p.nodes['work-rest']={value:'90'};p.nodes['test-rest']={value:'15'};
    const history=p.data.get(M.KEY),original=p.api.settings().testIntervalCount;
    if(stale)p.data.set(M.SETTINGS_KEY,'newer');else p.failWrite();
    const before=p.data.get(M.SETTINGS_KEY);
    await p.api.handleAction('save-trainer-settings');
    assert.equal(p.data.get(M.KEY),history);assert.equal(p.data.get(M.SETTINGS_KEY),before);
    assert.equal(p.api.settings().testIntervalCount,original);
  }
});
test('existing installations preserve the accepted work count 20 and settings changes do not edit an active plan',async()=>{
  const r=M.startSolo(M.blank(),'athlete-default',2,M.measurementPlan('test-intervals',M.defaultTrainerSettings(require('../config.json'),false)));
  const p=await page({[M.KEY]:JSON.stringify(r.state)});
  assert.equal(p.api.settings().workingIntervalCount,20);assert.equal(p.api.settings().workingCountLocked,true);
  p.appEvents.change({target:{id:'mode-select',value:'stopwatch'}});
  assert.deepEqual(p.api.state().workouts[0].measurementPlan,r.state.workouts[0].measurementPlan);
});

function longListsState(){
  let s=M.blank();
  for(let i=0;i<7;i++){
    const w=M.startSolo(s,s.baseProfileId,1),a=M.startAttempt(w.state,w.value.id,'intervals',20);
    s=M.finishAttempt(a.state,a.value.id,1000+i*100,Array(20).fill(50+i*5)).state;
    s.workouts.at(-1).createdAt=`2026-11-${String(i+1).padStart(2,'0')}T12:00:00.000Z`;
    s=M.addArchived(s,s.baseProfileId,`2026-10-${String(i+1).padStart(2,'0')}`,2000+i*100).state;
  }
  const pending=M.startSolo(s,s.baseProfileId,1);s=pending.state;
  for(let i=0;i<7;i++){
    const a=M.startAttempt(s,pending.value.id,'intervals',20,`2026-11-${String(i+1).padStart(2,'0')}T13:00:00.000Z`);
    s=M.interruptAttempt(a.state,a.value.id).state;
  }
  return M.endWorkout(s,pending.value.id).state;
}
test('profile save is independent of saving or discarding workout settings',async()=>{
  const p=await page();await p.api.handleAction('settings');
  const before=p.data.get(M.KEY);
  p.appEvents.change({target:{id:'attempt-count',value:'1'}});
  p.appEvents.change({target:{id:'mode-select',value:'stopwatch'}});
  p.appEvents.change({target:{name:'launch-animation',value:'none'}});
  p.appEvents.input({target:{id:'profile-name',value:'Новое имя'}});
  assert.equal(p.data.get(M.KEY),before);
  await p.api.handleAction('settings-back');
  assert.equal(p.data.get(M.KEY),before);
  await p.api.handleAction('settings');
  assert.match(p.html(),/value="Спортсмен"/);
  p.appEvents.change({target:{id:'attempt-count',value:'1'}});
  p.appEvents.change({target:{id:'mode-select',value:'stopwatch'}});
  p.appEvents.change({target:{name:'launch-animation',value:'none'}});
  p.appEvents.input({target:{id:'profile-name',value:'Новое имя'}});
  await p.api.handleAction('save-profile-name');
  assert.equal(p.api.state().device.soloPlannedAttempts,2);
  await p.api.handleAction('settings-back');
  assert.equal(p.api.state().athletes[0].name,'Новое имя');
  await p.api.handleAction('settings');
  p.appEvents.change({target:{id:'attempt-count',value:'1'}});
  p.appEvents.change({target:{id:'mode-select',value:'stopwatch'}});
  p.appEvents.change({target:{name:'launch-animation',value:'none'}});
  p.appEvents.input({target:{id:'profile-name',value:''}});
  await p.api.handleAction('settings-save');
  const saved=p.api.state();
  assert.equal(saved.athletes[0].name,'Новое имя');assert.equal(saved.device.soloPlannedAttempts,1);
  assert.equal(saved.device.soloMeasurementMode,'stopwatch');assert.equal(saved.device.launchAnimation,'none');
  assert.equal(p.api.screen(),'athlete');
});
test('failed workout settings write retains the old values and keeps the settings open',async()=>{
  const p=await page();await p.api.handleAction('settings');
  const before=p.data.get(M.KEY);
  p.appEvents.change({target:{id:'attempt-count',value:'1'}});
  p.failWrite();
  await p.api.handleAction('settings-save');
  assert.equal(p.data.get(M.KEY),before);
  assert.equal(p.api.state().device.soloPlannedAttempts,2);
  assert.equal(p.api.screen(),'settings');
});
test('archive, history and interrupted lists expand independently and retain state after deletion',async()=>{
  const s=longListsState(),p=await page({[M.KEY]:JSON.stringify(s)}),aid=s.baseProfileId;
  const count=(html,pattern)=>(html.match(pattern)||[]).length;
  assert.equal(count(p.api.archiveHistory(aid),/class="history-item"/g),5);
  assert.equal(count(p.api.historyItems(aid),/class="history-item"/g),4);
  assert.equal(count(p.api.interruptedAttempts(aid,true),/data-act="delete-interrupted"/g),5);
  for(const key of [`archive:athlete:${aid}`,`interrupted:athlete:${aid}`]){
    await p.api.handleAction('list-toggle',{dataset:{listKey:key}});
  }
  assert.equal(count(p.api.archiveHistory(aid),/class="history-item"/g),7);
  assert.equal(count(p.api.interruptedAttempts(aid,true),/data-act="delete-interrupted"/g),7);
  assert.equal(count(p.api.historyItems(aid),/class="history-item"/g),4);
  await p.api.handleAction('settings');
  p.appEvents.input({target:{id:'profile-name',value:'Не сохранять это имя'}});
  p.appEvents.change({target:{id:'show-history-delete',checked:true}});
  await p.api.handleAction('settings-back');
  await p.api.handleAction('delete-archived',{dataset:{id:s.archived[0].id}});
  assert.equal(p.api.state().archived.length,6);assert.equal(p.api.state().athletes[0].name,'Спортсмен');
  assert.equal(count(p.api.archiveHistory(aid),/class="history-item"/g),6);
  assert.equal(p.api.expanded(`archive:athlete:${aid}`),true);
  await p.api.handleAction('list-toggle',{dataset:{listKey:`archive:athlete:${aid}`}});
  assert.equal(count(p.api.archiveHistory(aid),/class="history-item"/g),5);
});
test('saving the history switch does not discard the profile draft',async()=>{
  const p=await page();await p.api.handleAction('settings');
  p.appEvents.input({target:{id:'profile-name',value:'Имя после сохранения'}});
  p.appEvents.change({target:{id:'show-history-delete',checked:true}});
  await p.api.handleAction('save-profile-name');
  assert.equal(p.api.state().athletes[0].name,'Имя после сохранения');
});
test('settings opened from a new workout omit the profile name and preserve its frozen plan',async()=>{
  const plan=M.measurementPlan('intervals',M.defaultTrainerSettings(require('../config.json'),false));
  const r=M.startSolo(M.blank(),'athlete-default',2,plan),p=await page({[M.KEY]:JSON.stringify(r.state)});
  await p.api.handleAction('settings');assert.doesNotMatch(p.html(),/Название профиля|profile-name/);
  p.appEvents.change({target:{id:'mode-select',value:'stopwatch'}});
  await p.api.handleAction('settings-save');
  assert.deepEqual(p.api.state().workouts[0].measurementPlan,plan);
  assert.equal(p.api.state().device.soloMeasurementMode,'stopwatch');
});

test('archive statistics save only after coach PIN, persist across exit/reload and are absent from exports',async()=>{
  const s=longListsState(),p=await page({[M.KEY]:JSON.stringify(s)});
  p.nodes['include-archive-stats']={checked:true};
  const original=p.data.get(M.SETTINGS_KEY);
  await p.api.handleAction('save-trainer-settings');assert.equal(p.data.get(M.SETTINGS_KEY),original);
  p.api.unlock();await p.api.handleAction('pin');
  p.nodes['test-count']={value:'4'};p.nodes['work-rest']={value:'120'};p.nodes['test-rest']={value:'20'};
  const before=p.data.get(M.KEY);await p.api.handleAction('save-trainer-settings');
  assert.equal(p.data.get(M.KEY),before);assert.equal(p.api.settings().includeArchiveStats,true);
  assert.equal(p.api.statsPoints(s.baseProfileId).length,14);
  assert.equal(JSON.stringify(p.api.exportSnapshot()).includes('includeArchiveStats'),false);
  await p.api.handleAction('switch-athlete');assert.equal(p.api.authorized(),false);
  assert.equal(p.api.statsPoints(s.baseProfileId).length,14);assert.doesNotMatch(p.html(),/id="include-archive-stats"/);
  const q=await page(Object.fromEntries(p.data));assert.equal(q.api.settings().includeArchiveStats,true);
  assert.equal(q.api.statsPoints(s.baseProfileId).length,14);
  const setting=q.data.get(M.SETTINGS_KEY);await q.api.importFile({text:async()=>JSON.stringify(p.api.exportSnapshot())});
  assert.equal(q.data.get(M.SETTINGS_KEY),setting);assert.equal(q.api.authorized(),false);
});
test('failed archive statistics settings write retains previous calculations and sports data',async()=>{
  const s=longListsState(),p=await page({[M.KEY]:JSON.stringify(s)});
  p.api.unlock();await p.api.handleAction('pin');
  p.nodes['include-archive-stats']={checked:true};p.nodes['test-count']={value:'4'};
  p.nodes['work-rest']={value:'120'};p.nodes['test-rest']={value:'20'};
  const before=p.data.get(M.KEY),settings=p.data.get(M.SETTINGS_KEY);p.failWrite();
  await p.api.handleAction('save-trainer-settings');
  assert.equal(p.data.get(M.KEY),before);assert.equal(p.data.get(M.SETTINGS_KEY),settings);
  assert.equal(p.api.statsPoints(s.baseProfileId).length,7);assert.notEqual(p.api.settings().includeArchiveStats,true);
});

test('full reset clears trainer choices and allows the working count to be chosen after reload',async()=>{
  const config=require('../config.json');
  const defaults=M.defaultTrainerSettings(config,false);
  const previous=M.changeTrainerSettings(defaults,{workingIntervalCount:30,includeArchiveStats:true,testIntervalCount:3,workRestDurationSec:99},true);
  const model=M.addArchived(M.blank(),'athlete-default','2026-11-01',800).state;
  const initial={[M.KEY]:JSON.stringify(model),[M.SETTINGS_KEY]:JSON.stringify(previous)};
  const cancelled=await page(initial,{confirm:false});
  cancelled.api.unlock();await cancelled.api.handleAction('reset-all');
  assert.equal(cancelled.data.get(M.SETTINGS_KEY),initial[M.SETTINGS_KEY]);
  assert.equal(cancelled.api.state().archived.length,1);
  const p=await page(initial);
  p.api.unlock();await p.api.handleAction('reset-all');
  assert.deepEqual(p.api.settings(),defaults);
  assert.equal(p.api.state().archived.length,0);
  assert.equal(p.api.authorized(),false);
  const q=await page(Object.fromEntries(p.data));
  assert.deepEqual(JSON.parse(q.data.get(M.SETTINGS_KEY)),defaults);
  q.api.unlock();await q.api.handleAction('pin');
  q.nodes['working-count']={value:'27'};
  q.nodes['test-count']={value:'4'};
  q.nodes['work-rest']={value:'120'};
  q.nodes['test-rest']={value:'20'};
  await q.api.handleAction('save-trainer-settings');
  assert.equal(q.api.settings().workingIntervalCount,27);
  assert.equal(q.api.settings().workingCountLocked,true);
});
