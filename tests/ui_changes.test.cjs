const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const get=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('version appears only as the last footer line',()=>{
  const app=get('app.js');
  assert.match(app,/class="app-version">Версия 0\.2\.1-rc\.1<\/div><\/footer>/);
  assert.doesNotMatch(app,/<span class="mode-tag">[0-9]/);
  assert.doesNotMatch(get('index.html'),/v0\.2\.1/);
  assert.doesNotMatch(get('manifest.webmanifest'),/v0\.2\.1/);
});
test('child interface label is Дети; individual child choice remains semantically intact',()=>{
  const app=get('app.js');
  assert.match(app,/header\('Дети'/);
  assert.doesNotMatch(app,/header\('Ребёнок'/);
  assert.match(app,/Нет — один ребёнок/);
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
