const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../model.js');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const config = require('../config.json');

async function openPage(storage) {
  const events = {};
  const app = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(name, handler) { events[name] = handler; },
  };
  let time = 1000;
  vm.runInNewContext(source, {
    window: { ILModel: M, SideMigration: { run: () => ({}) }, addEventListener() {} },
    document: { getElementById: () => app, addEventListener() {} },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    fetch: async () => ({ ok: true, json: async () => config }),
    navigator: {},
    performance: { now: () => time },
    setInterval() {}, setTimeout() {}, clearTimeout() {}, console,
  });
  await new Promise(resolve => setImmediate(resolve));
  return {
    html: () => app.innerHTML,
    state: () => JSON.parse(storage.get(M.KEY)),
    click(act) {
      const button = { dataset: { act }, matches: () => false, setAttribute() {} };
      events.click({ target: { closest: () => button } });
    },
    change(id, value) { events.change({ target: { id, value } }); },
    tap() {
      time += config.minTapGapMs + 100;
      events.pointerdown({ target: { closest: () => true }, button: 0, preventDefault() {} });
    },
  };
}

function storeState(state) {
  return new Map([[M.KEY, JSON.stringify(state)]]);
}

test('first load starts muted with two interval attempts', async () => {
  const page = await openPage(new Map());
  assert.equal(page.state().device.soundEnabled, false);
  page.click('open-exercise');
  assert.match(page.html(), /Попытка 1 из 2/);
  assert.match(page.html(), /play-glyph/);
  assert.ok(page.html().includes(`0 / ${config.intervalCount} интервалов`));
});

test('reload restores exercise defaults and preserves history and identity', async () => {
  let state = M.addArchived(M.blank(), 'athlete-default', '2026-11-10', 12345).state;
  state.device.soundEnabled = true;
  state.device.soloPlannedAttempts = 1;
  state.device.soloMeasurementMode = 'stopwatch';
  state.device.measurementMode = 'stopwatch';
  const page = await openPage(storeState(state));
  const restored = page.state();
  assert.equal(restored.device.soundEnabled, false);
  assert.equal(restored.device.soloPlannedAttempts, 2);
  assert.equal(restored.device.soloMeasurementMode, 'intervals');
  assert.equal(restored.device.measurementMode, 'intervals');
  for (const key of ['athletes', 'workouts', 'attempts', 'childSessions', 'archived', 'incomplete']) {
    assert.deepEqual(restored[key], state[key]);
  }
  assert.equal(restored.device.selectedAthleteId, state.device.selectedAthleteId);
});

test('starting another exercise in the same page keeps user choices', async () => {
  const storage = new Map();
  const page = await openPage(storage);
  page.click('settings');
  page.change('attempt-count', '1');
  page.change('mode-select', 'stopwatch');
  page.click('settings-back');
  page.click('toggle-sound');
  page.click('open-exercise');
  page.tap();
  page.tap();
  assert.equal(page.state().workouts[0].status, 'completed');
  page.click('final-home');
  page.click('open-exercise');
  assert.match(page.html(), /Попытка 1 из 1/);
  assert.match(page.html(), /play-glyph/);
  assert.equal(page.state().device.soundEnabled, true);
  page.tap();
  assert.equal(page.state().attempts[1].mode, 'stopwatch');
  assert.equal(page.state().workouts[1].plannedAttempts, 1);
  const reloaded = await openPage(storage);
  assert.equal(reloaded.state().device.soundEnabled, false);
  assert.equal(reloaded.state().device.soloPlannedAttempts, 2);
});

test('reload between attempts preserves the active workout and measurement mode', async () => {
  const started = M.startSolo(M.blank(), 'athlete-default', 2);
  const attempt = M.startAttempt(started.state, started.value.id, 'stopwatch', config.intervalCount);
  const finished = M.finishAttempt(attempt.state, attempt.value.id, 2000, []);
  const state = finished.state;
  state.device.measurementMode = 'stopwatch';
  state.device.soloPlannedAttempts = 1;
  state.device.soloMeasurementMode = 'stopwatch';
  state.device.soundEnabled = true;
  const page = await openPage(storeState(state));
  assert.deepEqual(page.state().workouts, state.workouts);
  assert.deepEqual(page.state().attempts, state.attempts);
  assert.equal(page.state().device.measurementMode, 'stopwatch');
  assert.equal(page.state().device.soloMeasurementMode, 'intervals');
  assert.equal(page.state().device.soundEnabled, false);
  page.click('rest-early');
  assert.match(page.html(), /Попытка 2 из 2/);
  page.tap();
  assert.equal(page.state().attempts[1].mode, 'stopwatch');
});

test('reload retains the active participant session and the administrator login boundary', async () => {
  for (const role of ['child', 'trainer']) {
    const state = M.startChild(M.blank(), ['athlete-default'], 1).state;
    state.device.lastInterface = role;
    state.device.measurementMode = 'stopwatch';
    state.device.soundEnabled = true;
    const page = await openPage(storeState(state));
    assert.equal(page.state().device.lastInterface, role);
    assert.equal(page.state().device.soundEnabled, false);
    assert.equal(page.state().device.measurementMode, 'stopwatch');
    assert.deepEqual(page.state().childSessions, state.childSessions);
    assert.match(page.html(), role === 'trainer' ? /Вход администратора/ : /Попытка 1 из 1/);
  }
});

test('invalid saved history is not overwritten by startup defaults', async () => {
  const invalid = '{broken data';
  const storage = new Map([[M.KEY, invalid]]);
  const page = await openPage(storage);
  assert.equal(storage.get(M.KEY), invalid);
  assert.match(page.html(), /Не удалось открыть историю/);
});

test('only a workout with two completed attempts gets a best-attempt mark', async () => {
  let state = M.addArchived(M.blank(), 'athlete-default', '2026-11-10', 1000).state;
  function workout(durations) {
    const started = M.startSolo(state, 'athlete-default', durations.length);
    state = started.state;
    for (const duration of durations) {
      const attempt = M.startAttempt(state, started.value.id, 'stopwatch', config.intervalCount);
      state = M.finishAttempt(attempt.state, attempt.value.id, duration, []).state;
    }
  }
  workout([2000]);
  const single = await openPage(storeState(state));
  assert.doesNotMatch(single.html(), /Лучшая попытка/);
  workout([3000, 2500]);
  workout([500]);
  const page = await openPage(storeState(state));
  assert.equal((page.html().match(/aria-label="Лучшая попытка"/g) ?? []).length, 1);
  assert.match(page.html(), /0,500 с <span aria-label="Личный рекорд">★/);
});

test('launch animation preference survives page reload and applies to the start triangle',async()=>{
  for(const value of ['glow','pulse','none']){
    const s=M.blank();s.device.launchAnimation=value;const storage=storeState(s);
    const page=await openPage(storage);assert.equal(page.state().device.launchAnimation,value);
    page.click('open-exercise');assert.ok(page.html().includes(`counter counter-ready launch-${value}`));
  }
});
