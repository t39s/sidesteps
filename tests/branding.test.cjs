const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const text=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
test('product display name is sidesteps',()=>{
  assert.match(text('index.html'),/sidesteps/);
  const manifest=JSON.parse(text('manifest.webmanifest'));
  assert.equal(manifest.short_name,'sidesteps');
  assert.match(text('app.js'),/sidesteps/);
});
test('storage keys unchanged for historical migration',()=>{
  assert.match(text('model.js'),/const KEY = 'interval-lab:data:v5', LEGACY_KEY = 'interval-lab:data:v1'/);
});
test('new service worker cannot delete legacy PWA caches',()=>{
  const sw=text('sw.js');
  assert.match(sw,/sidesteps-shell-/);
  assert.doesNotMatch(sw,/startsWith\('interval-lab-shell-'/);
  assert.match(sw,/new URL\(self\.registration\.scope\)\.pathname/);
});
test('trainer verifier present but plaintext PIN not in config',()=>{
  const cfg=JSON.parse(text('config.json'));
  assert.equal(cfg.trainerAccess.algorithm,'PBKDF2-SHA256');
  assert.ok(cfg.trainerAccess.saltB64.length>=16);
  assert.ok(cfg.trainerAccess.verifierB64.length>=24);
  assert.equal(Object.hasOwn(cfg.trainerAccess,'pin'),false);
});
