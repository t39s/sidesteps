const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../model.js');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const config = require('../config.json');

async function openPage(storage, wallTime = null) {
  const events = {};
  let onTick;
  const renderTimers = [];
  class PageDate extends Date {
    constructor(...args) { super(...(args.length ? args : [wallTime ?? Date.now()])); }
    static now() { return wallTime ?? Date.now(); }
  }

  const browser = { ILModel: M, SideMigration: { run: () => ({}) }, confirm: () => true, addEventListener() {} };
  const app = {
    innerHTML: '', style:{},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(name, handler) { events[name] = handler; },
  };
  let time = 1000;
  vm.runInNewContext(source.replace('init();\n})();', 'window.testUnlockTrainer=()=>{trainerUnlocked=true;};\ninit();\n})();'), {
    window: browser,
    document: { getElementById: () => app, addEventListener() {} },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    fetch: async () => ({ ok: true, json: async () => config }),
    navigator: {}, Date: PageDate,
    performance: { now: () => time },
    setInterval(fn) { onTick = fn; }, setTimeout(fn, delay) { if(delay===200)renderTimers.push(fn); }, clearTimeout() {}, console,
  });
  await new Promise(resolve => setImmediate(resolve));
  return {
    html: () => app.innerHTML,
    unlockTrainer: browser.testUnlockTrainer,
    setDate(value) { wallTime = Date.parse(value); },
    tick() { onTick(); },
    renderResult() { for(const fn of renderTimers.splice(0))fn(); },
    state: () => JSON.parse(storage.get(M.KEY)),
    click(act) {
      const button = { dataset: { act }, matches: () => false, setAttribute() {} };
      events.click({ target: { closest: () => button } });
    },
    change(id, value) { events.change({ target: { id, name: id, value } }); },
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
  assert.ok(page.html().includes(`0 / ${config.workingIntervalCount} интервалов`));
});

test('reload restores exercise defaults and preserves history and identity', async () => {
  let state = M.addArchived(M.blank('stable-test-profile'), 'stable-test-profile', '2026-11-10', 12345).state;
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
  page.click('open-exercise');page.click('settings');
  page.change('attempt-count', '1');
  page.change('mode-select', 'stopwatch');
  page.click('settings-save');
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
  const started = M.startSolo(M.blank('stable-test-profile'), 'stable-test-profile', 2);
  const attempt = M.startAttempt(started.state, started.value.id, 'stopwatch', config.workingIntervalCount);
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
    const state = M.startChild(M.blank('stable-test-profile'), ['stable-test-profile'], 1).state;
    state.device.lastInterface = role;
    state.device.measurementMode = 'stopwatch';
    state.device.soundEnabled = true;
    const page = await openPage(storeState(state));
    assert.equal(page.state().device.lastInterface, role);
    assert.equal(page.state().device.soundEnabled, false);
    assert.equal(page.state().device.measurementMode, 'stopwatch');
    assert.deepEqual(page.state().childSessions, state.childSessions);
    assert.match(page.html(), role === 'trainer' ? /Вход в интерфейс тренера/ : /Попытка 1 из 1/);
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
      const attempt = M.startAttempt(state, started.value.id, 'intervals', config.workingIntervalCount);
      state = M.finishAttempt(attempt.state, attempt.value.id, duration, Array(20).fill(duration/20)).state;
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

for(const child of [false,true])test(`${child?'coach device':'personal device'}: first local day pulses, following days glow`,async()=>{
  let s=M.blank();if(child)s=M.startChild(s,['athlete-default'],2).state;
  const storage=storeState(s);
  const first=await openPage(storage,Date.parse('2026-11-19T08:00:00'));
  assert.equal(first.state().device.launchAnimationFirstDay,'2026-11-19');
  if(!child)first.click('open-exercise');
  assert.ok(first.html().includes('counter counter-ready launch-pulse'));
  for(const [date,expected] of [['2026-11-19T23:59:59','pulse'],['2026-11-20T00:00:00','glow'],['2026-11-25T12:00:00','glow']]){
    const page=await openPage(storage,Date.parse(date));if(!child)page.click('open-exercise');
    assert.ok(page.html().includes(`counter counter-ready launch-${expected}`));
    assert.equal(page.state().device.launchAnimationFirstDay,'2026-11-19');
    assert.equal(page.state().device.launchAnimation,undefined);
  }
});
for(const chosen of ['pulse','glow','none'])test(`manual ${chosen} overrides automatic rule immediately and after reload`,async()=>{
  const storage=storeState(M.blank()),page=await openPage(storage,Date.parse('2026-11-19T08:00:00'));
  page.click('open-exercise');page.click('settings');page.change('launch-animation',chosen);page.click('settings-save');page.click('open-exercise');
  assert.ok(page.html().includes(`counter counter-ready launch-${chosen}`));
  const later=await openPage(storage,Date.parse('2026-12-21T08:00:00'));later.click('open-exercise');
  assert.ok(later.html().includes(`counter counter-ready launch-${chosen}`));
});
test('automatic animation uses calendar day across year boundary, not 24 elapsed hours',async()=>{
  const storage=storeState(M.blank()),page=await openPage(storage,Date.parse('2026-12-31T23:59:00'));
  assert.equal(page.state().device.launchAnimationFirstDay,'2026-12-31');
  const next=await openPage(storage,Date.parse('2027-01-01T00:01:00'));next.click('open-exercise');
  assert.ok(next.html().includes('counter counter-ready launch-glow'));
});


test('in-app reset starts a new animation day and glow takes over after a completed workout without reload', async () => {
  const previous = M.blank();
  previous.device.launchAnimation = 'pulse';
  previous.device.launchAnimationFirstDay = '2026-11-01';
  const storage = storeState(previous);
  const page = await openPage(storage, Date.parse('2026-11-19T08:00:00'));
  page.unlockTrainer();
  page.click('reset-all');
  assert.equal(page.state().device.launchAnimation, undefined);

  page.click('open-exercise');page.click('settings');
  page.change('attempt-count', '1');
  page.change('mode-select', 'stopwatch');
  page.click('settings-save');
  page.click('open-exercise');
  assert.match(page.html(), /counter counter-ready launch-pulse/);
  page.tap();
  page.tap();
  assert.equal(page.state().workouts[0].status, 'completed');
  page.renderResult();
  page.setDate('2026-11-19T08:01:00');
  page.tick();
  assert.match(page.html(), /Тренировка завершена/);
  page.click('final-home');

  page.setDate('2026-11-21T08:00:00');
  page.click('open-exercise');
  assert.match(page.html(), /counter counter-ready launch-glow/);
  assert.equal(page.state().device.launchAnimationFirstDay, '2026-11-19');
});
