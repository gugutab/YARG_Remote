import test from 'node:test';
import assert from 'node:assert/strict';
import { Metronome, beatsInWindow, ctxTimeFor, clickParams, levelGain, firstBeatAtOrAfter, SOUNDS } from '../src/metronome.js';
import { ACTIONS } from '../src/shortcuts.js';

const beats = Array.from({ length: 12 }, (_, i) => ({ time: 1 + i * 0.5, measure: i % 4 === 0 }));

test('firstBeatAtOrAfter finds the first beat at or after a time', () => {
  assert.equal(firstBeatAtOrAfter(beats, 0), 0);
  assert.equal(firstBeatAtOrAfter(beats, 1), 0);
  assert.equal(firstBeatAtOrAfter(beats, 1.01), 1);
  assert.equal(firstBeatAtOrAfter(beats, 99), beats.length);
});

test('beatsInWindow lists the beats of [from, to) with the accent on the measure start', () => {
  const w = beatsInWindow(beats, 0, 1.4, 3.1);
  assert.deepEqual(w.map((b) => b.pos), [1.5, 2, 2.5, 3]);
  assert.deepEqual(w.map((b) => b.accent), [false, false, false, true]);
  assert.deepEqual(w.map((b) => b.index), [1, 2, 3, 4]);
});

test('beatsInWindow applies the chart delay and skips indexes already done', () => {
  const w = beatsInWindow(beats, 0.25, 1.2, 2.3);
  assert.deepEqual(w.map((b) => b.pos), [1.25, 1.75, 2.25]);
  assert.deepEqual(beatsInWindow(beats, 0, 1, 3.1, 3).map((b) => b.index), [3, 4]);
  assert.deepEqual(beatsInWindow(beats, 0, 10, 11), []);
  assert.deepEqual(beatsInWindow([], 0, 0, 5), []);
});

test('ctxTimeFor maps a song position to audio time at any speed', () => {
  assert.equal(ctxTimeFor(12, { pos: 10, at: 5, rate: 1 }), 7);
  assert.equal(ctxTimeFor(12, { pos: 10, at: 5, rate: 0.5 }), 9); // half speed: twice as long
  assert.equal(ctxTimeFor(12, { pos: 10, at: 5, rate: 2 }), 6);
  assert.equal(ctxTimeFor(9, { pos: 10, at: 5, rate: 1 }), 4);
});

test('clickParams: every sound has parts, and the accent is higher', () => {
  for (const s of SOUNDS) {
    const n = clickParams(s, false);
    const a = clickParams(s, true);
    assert.ok(n.parts.length >= 1 && n.dur > 0 && n.peak > 0 && n.peak <= 1);
    assert.ok(a.parts[0].freq > n.parts[0].freq, s);
  }
  assert.equal(clickParams('nope', false).parts[0].type, 'triangle'); // unknown: the default click
});

test('levelGain is 0..1 and rises with the percentage', () => {
  assert.equal(levelGain(0), 0);
  assert.equal(levelGain(100), 1);
  assert.ok(levelGain(50) > 0 && levelGain(50) < 0.5);
  assert.equal(levelGain(500), 1);
  assert.equal(levelGain('x'), 0);
});

test('shortcuts: the new keys are free', () => {
  const keys = ACTIONS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
});

// A fake audio context that records what is scheduled.
function fakeCtx() {
  const ctx = { currentTime: 10, starts: [], createGain: () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }) };
  ctx.createOscillator = () => ({ frequency: {}, connect() {}, disconnect() {}, start(t) { ctx.starts.push(t); }, stop() { this.stopped = true; } });
  return ctx;
}

test('Metronome schedules clicks ahead on the clock, once each, and none while paused', () => {
  const ctx = fakeCtx();
  let clock = { playing: true, pos: 1.9, at: 10, rate: 1 };
  const m = new Metronome({ ctx, destination: {}, clock: () => clock, beats: () => beats, delay: () => 0 });
  m.enabled = true;
  m.tick(); // window: song 1.9..2.05 -> beat at 2.0 -> audio time 10.1
  assert.equal(ctx.starts.length, 1);
  assert.ok(Math.abs(ctx.starts[0] - 10.1) < 1e-9);
  ctx.currentTime = 10.025; clock = { ...clock, pos: 1.925 };
  m.tick();
  assert.equal(ctx.starts.length, 1); // not twice
  // half speed: the next beat (2.5) is 1.2 s of audio away; it is scheduled only when it enters the lookahead
  ctx.currentTime = 10.5; clock = { playing: true, pos: 2.35, at: 10.5, rate: 0.5 };
  m.tick(); // rate changed: reset; window song 2.35..2.425: nothing
  assert.equal(ctx.starts.length, 1);
  ctx.currentTime = 10.8; clock = { playing: true, pos: 2.5 - 0.05, at: 10.8, rate: 0.5 };
  m.tick(); // window 2.45..2.525 -> beat 2.5 at 10.8 + 0.1
  assert.equal(ctx.starts.length, 2);
  assert.ok(Math.abs(ctx.starts[1] - 10.9) < 1e-9);
  clock = { playing: false };
  m.tick();
  ctx.currentTime = 11; m.tick();
  assert.equal(ctx.starts.length, 2);
});

test('Metronome applies the chart delay and restarts after a jump of the position', () => {
  const ctx = fakeCtx();
  let clock = { playing: true, pos: 5, at: 10, rate: 1 };
  const m = new Metronome({ ctx, destination: {}, clock: () => clock, beats: () => beats, delay: () => 0.1 });
  m.enabled = true;
  m.tick(); // the beat at 5.0 is heard at song position 5.1 -> audio time 10.1
  assert.equal(ctx.starts.length, 1);
  assert.ok(Math.abs(ctx.starts[0] - 10.1) < 1e-9);
  ctx.currentTime = 10.02; clock = { playing: true, pos: 2.02, at: 10.02, rate: 1 }; // a seek back to 2.02
  m.tick(); // beat 2.0 (+0.1 delay = 2.1) comes again
  assert.equal(ctx.starts.length, 2);
  assert.ok(Math.abs(ctx.starts[1] - 10.1) < 1e-9);
});
