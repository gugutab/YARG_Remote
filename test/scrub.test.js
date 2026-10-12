import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAIN, HOP, grainStart, hann, grainsAt, easeOutCubic } from '../src/scrub.js';

test('overlapping Hann grains sum to one once two are running', () => {
  for (const e of [HOP, HOP + 100, 5 * HOP + 7, 40 * HOP + 513]) {
    const w = grainsAt(0, 1e6, 1e6, e).reduce((a, g) => a + g.w, 0);
    assert.ok(Math.abs(w - 1) < 1e-9, `e=${e} w=${w}`);
  }
});

test('the first grain ramps up from silence', () => {
  const g = grainsAt(0, 1e6, 1e6, 0);
  assert.equal(g.length, 1);
  assert.equal(g[0].w, 0);
  assert.ok(hann(GRAIN / 2) > 0.999);
});

test('grain sources follow the ease-out path from the start to the target', () => {
  const dur = 30000;
  assert.equal(grainStart(1000, 9000, dur, 0), 1000);
  assert.ok(Math.abs(grainStart(1000, 9000, dur, Math.floor(dur / HOP)) - 9000) < 8000 * 0.05); // near the end it has almost arrived
  const a = grainStart(0, 1e6, dur, 5) - grainStart(0, 1e6, dur, 4);
  const b = grainStart(0, 1e6, dur, 25) - grainStart(0, 1e6, dur, 24);
  assert.ok(a > b, 'it moves fastest at the start and slows down');
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(2), 1); // clamped
});

test('it also works backwards (a rewind)', () => {
  assert.ok(grainStart(900000, 1000, 20000, 3) < 900000);
});
