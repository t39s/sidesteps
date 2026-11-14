const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const get=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('athlete footer contains the version and administrator link on one line',()=>{
  const app=get('app.js');
  assert.match(app,/<footer class="nav-spacer app-footer"><span class="app-version">sidesteps v\. 0\.2\.2-rc\.6<\/span>/);
  assert.match(app,/<span aria-hidden="true">·<\/span> <a href="#admin-login" data-act="pin" title="Для администратора">Войти<\/a>/);
  assert.doesNotMatch(app,/Данные хранятся на этом устройстве|b\('Тренер','pin'/);
  assert.doesNotMatch(get('index.html'),/0\.2\.2/);
  assert.doesNotMatch(get('manifest.webmanifest'),/0\.2\.2/);
});
test('athlete heading and administrator terminology',()=>{
  const app=get('app.js');
  assert.match(app,/const label='Приставные шаги<br>на время'/);
  assert.doesNotMatch(app,/header\('(Спортсмен|Дети|Ребёнок)'/);
  assert.match(app,/header\('Администратор'/);
  assert.match(app,/Нет — один участник/);
  assert.doesNotMatch(app,/Две попытки по умолчанию\. Лучший результат/);
});
test('five latest completed workouts shown as compact vertical bars',()=>{
  const app=get('app.js');
  assert.match(app,/const visible=points\.slice\(-5\)/);
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
