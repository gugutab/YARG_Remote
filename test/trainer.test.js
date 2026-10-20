import test from 'node:test';
import assert from 'node:assert/strict';
import { snapSpeed, trainerConfig, startTrainer, nextTrainerState, trainerStatus, stepNote, SPEED_MIN, SPEED_MAX } from '../src/trainer.js';
import { buildDefaults } from '../src/settings-schema.js';

const cfg = (o = {}) => ({ start: 0.6, target: 1, step: 0.05, passes: 2, ...o });
const wrap = (state, c, speed) => nextTrainerState(state, { type: 'wrap', speed }, c);
// Runs `n` wraps from the start and returns every speed heard (the start first).
function ramp(c, n) {
  let s = startTrainer(c);
  const speeds = [s.speed];
  for (let i = 0; i < n; i++) { s = wrap(s, c, s.speed); speeds.push(s.speed); }
  return { speeds, last: s };
}

test('snapSpeed clamps to the slider range and snaps to 0.05', () => {
  assert.equal(snapSpeed(0.62), 0.6);
  assert.equal(snapSpeed(0.63), 0.65);
  assert.equal(snapSpeed(0.1), SPEED_MIN);
  assert.equal(snapSpeed(5), SPEED_MAX);
  assert.equal(snapSpeed(0.6 + 0.05 + 0.05), 0.7); // no float drift (0.7000000000000001)
  assert.equal(snapSpeed(NaN), 1);
});

test('trainerConfig converts the percent settings to rates', () => {
  const d = buildDefaults();
  const c = trainerConfig((id) => d[id]);
  assert.deepEqual(c, { start: 0.6, target: 1, step: 0.05, passes: 2 });
  assert.equal(d['practice.trainer'], false, 'off by default');
});

test('startTrainer sets the start speed with no passes', () => {
  assert.deepEqual(startTrainer(cfg()), { speed: 0.6, passes: 0, stepped: false, done: false });
});

test('the speed steps up after N passes and the count restarts', () => {
  const c = cfg();
  let s = startTrainer(c);
  s = wrap(s, c, s.speed);
  assert.deepEqual(s, { speed: 0.6, passes: 1, stepped: false, done: false });
  s = wrap(s, c, s.speed);
  assert.deepEqual(s, { speed: 0.65, passes: 0, stepped: true, done: false });
  s = wrap(s, c, s.speed);
  assert.equal(s.speed, 0.65);
  assert.equal(s.passes, 1);
});

test('a full ramp stops at the target and stays there', () => {
  const { speeds, last } = ramp(cfg({ step: 0.1, passes: 1 }), 8);
  assert.deepEqual(speeds, [0.6, 0.7, 0.8, 0.9, 1, 1, 1, 1, 1]);
  assert.equal(last.done, true);
  assert.equal(last.stepped, false);
});

test('the last step is clamped to the target', () => {
  const c = cfg({ start: 0.6, target: 0.75, step: 0.1, passes: 1 });
  let s = wrap(startTrainer(c), c, 0.6);
  assert.equal(s.speed, 0.7);
  s = wrap(s, c, s.speed);
  assert.deepEqual(s, { speed: 0.75, passes: 0, stepped: true, done: true });
});

test('N = 1 steps on every wrap', () => {
  const { speeds } = ramp(cfg({ passes: 1 }), 3);
  assert.deepEqual(speeds, [0.6, 0.65, 0.7, 0.75]);
});

test('passes are read as a whole number of at least 1', () => {
  assert.deepEqual(ramp(cfg({ passes: 0 }), 2).speeds, [0.6, 0.65, 0.7]);
  assert.deepEqual(ramp(cfg({ passes: 2.4 }), 2).speeds, [0.6, 0.6, 0.65]);
});

test('a target at or below the start is done at once (no ramp down)', () => {
  for (const target of [0.6, 0.5]) {
    const c = cfg({ start: 0.6, target, passes: 1 });
    const s0 = startTrainer(c);
    assert.equal(s0.speed, 0.6);
    assert.equal(s0.done, true);
    const s1 = wrap(s0, c, 0.6);
    assert.deepEqual(s1, { speed: 0.6, passes: 0, stepped: false, done: true });
  }
});

test('the ramp goes on from a speed the user set by hand', () => {
  const c = cfg({ passes: 1, step: 0.1 });
  const s = wrap(startTrainer(c), c, 0.8); // moved the slider to 0.8 during the pass
  assert.equal(s.speed, 0.9);
  const above = wrap({ speed: 0.8, passes: 0, done: false }, c, 1.2); // set above the target: done, untouched
  assert.deepEqual(above, { speed: 1.2, passes: 0, stepped: false, done: true });
});

test('a speed off the grid still moves up', () => {
  const c = cfg({ passes: 1, step: 0.05 });
  const s = wrap({ speed: 0.62, passes: 0, done: false }, c, 0.62);
  assert.equal(s.speed, 0.65);
  assert.equal(s.stepped, true);
});

test('a step below the grid still moves one grid step', () => {
  const c = cfg({ passes: 1, step: 0.01 });
  assert.equal(wrap(startTrainer(c), c, 0.6).speed, 0.65);
});

test('the start and target are clamped to the slider range', () => {
  assert.equal(startTrainer(cfg({ start: 0.1 })).speed, SPEED_MIN);
  const { speeds } = ramp(cfg({ start: 1.9, target: 2.5, step: 0.25, passes: 1 }), 3);
  assert.deepEqual(speeds, [1.9, 2, 2, 2]);
});

test('lowering the target under the current speed ends the ramp', () => {
  const s = nextTrainerState({ speed: 0.8, passes: 1, done: false }, { type: 'wrap', speed: 0.8 }, cfg({ target: 0.7 }));
  assert.deepEqual(s, { speed: 0.8, passes: 0, stepped: false, done: true });
});

test('events other than a wrap count nothing', () => {
  const c = cfg();
  const s = nextTrainerState({ speed: 0.6, passes: 1, done: false }, { type: 'seek' }, c);
  assert.deepEqual(s, { speed: 0.6, passes: 1, stepped: false, done: false });
  assert.deepEqual(nextTrainerState({ speed: 0.6, passes: 1, done: false }, null, c), s);
});

test('trainerStatus text for each state', () => {
  const c = cfg();
  assert.match(trainerStatus({ on: false, looping: true, state: null, cfg: c }), /^Off/);
  assert.equal(trainerStatus({ on: true, looping: false, state: null, cfg: c }), 'Starts with a loop (R): 60% → 100%, +5% every 2 passes.');
  assert.equal(trainerStatus({ on: true, looping: false, state: null, cfg: cfg({ passes: 1 }) }), 'Starts with a loop (R): 60% → 100%, +5% every 1 pass.');
  assert.equal(trainerStatus({ on: true, looping: true, state: startTrainer(c), cfg: c }), 'Pass 1/2 at 60% → 100%');
  assert.equal(trainerStatus({ on: true, looping: true, state: { speed: 0.6, passes: 1, done: false }, cfg: c }), 'Pass 2/2 at 60% → 100%');
  assert.equal(trainerStatus({ on: true, looping: true, state: { speed: 1, passes: 0, done: true }, cfg: c }), 'Target reached: 100%');
});

test('stepNote says when the target is reached', () => {
  assert.equal(stepNote({ speed: 0.65, done: false }), 'Speed 65%');
  assert.equal(stepNote({ speed: 1, done: true }), 'Speed 100% (target reached)');
});
