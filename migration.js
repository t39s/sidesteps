/* One-person Interval Lab v1-v4 -> sidesteps v5 migration, same browser origin. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SideMigration=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PENDING='sidesteps:migration:pending:v1';
  const DONE='sidesteps:migration:done:v1';
  const LEGACY='interval-lab:data:v1';
  const TARGET='interval-lab:data:v5';
  const fields=['workouts','attempts','archived','incomplete'];
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  function select(old,athleteId,M){
    const complete=M.migrateV4(old);
    const selected=complete.athletes.find(a=>a.id===athleteId);
    assert(selected,'Выбранный профиль не найден в Interval Lab');
    const state=M.clone(complete);
    state.athletes=[selected];
    for(const field of fields)state[field]=state[field].filter(x=>x.athleteId===athleteId);
    state.childSessions=[];
    state.device={...state.device,lastInterface:'athlete',trainerActivated:false,
      selectedAthleteId:athleteId,trainerAthleteId:athleteId,viewAthleteId:athleteId,
      activeWorkoutId:null,activeChildSessionId:null,childParticipants:[]};
    return M.validateV5(state);
  }
  function empty(state){
    return state.athletes.length===1&&state.athletes[0].id==='athlete-default'&&
      state.athletes[0].name==='Спортсмен'&&
      ['workouts','attempts','archived','incomplete','childSessions'].every(k=>state[k].length===0)&&
      !state.device.activeWorkoutId&&!state.device.activeChildSessionId;
  }
  function same(a,b){
    if(a.athletes.length!==1||a.athletes[0].id!==b.athletes[0].id||
       a.athletes[0].name!==b.athletes[0].name)return false;
    return fields.every(k=>JSON.stringify(a[k])===JSON.stringify(b[k]))&&a.childSessions.length===0;
  }
  function run(store,M){
    if(store.getItem(M.KEY))return {blocked:false,migrated:false};
    const pending=store.getItem(PENDING);
    if(!pending)return {blocked:!store.getItem(TARGET)&&!!store.getItem(LEGACY),migrated:false};
    const request=JSON.parse(pending);
    assert(request&&request.version===1&&typeof request.athleteId==='string'&&request.athleteId,'Некорректный запрос переноса');
    const raw=store.getItem(LEGACY);
    assert(raw,'История Interval Lab не найдена. Не очищайте данные сайта.');
    const selected=select(JSON.parse(raw),request.athleteId,M);
    const current=store.getItem(TARGET);
    if(current){
      const existing=M.validateV5(JSON.parse(current));
      assert(empty(existing)||same(existing,selected),'В sidesteps уже есть другая история. Автоматический перенос заблокирован, данные сохранены.');
      if(!same(existing,selected))store.setItem(TARGET,JSON.stringify(selected));
    }else store.setItem(TARGET,JSON.stringify(selected));
    const checked=M.validateV5(JSON.parse(store.getItem(TARGET)));
    assert(same(checked,selected),'Не удалось подтвердить сохранение истории в sidesteps');
    const counts=Object.fromEntries(fields.map(k=>[k,selected[k].length]));
    store.setItem(DONE,JSON.stringify({version:1,athleteId:request.athleteId,athleteName:selected.athletes[0].name,counts,completedAt:new Date().toISOString()}));
    store.removeItem(PENDING);
    return {blocked:false,migrated:true,counts};
  }
  return {PENDING,DONE,LEGACY,TARGET,select,empty,same,run};
});
