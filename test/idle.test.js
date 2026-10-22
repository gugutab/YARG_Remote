import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSkipDraw, IDLE_AFTER_MS, IDLE_REFRESH_MS } from '../src/idle.js';

const idle = { playing: false, animating: false, same: true, now: 100000, lastInputAt: 0, dirtyAt: 0, lastDrawAt: 99900 };

test('canSkipDraw: a paused, quiet, unchanged stage keeps the last picture', () => {
  assert.equal(canSkipDraw(idle), true);
});

test('canSkipDraw: playing, animating or a changed picture always draws', () => {
  assert.equal(canSkipDraw({ ...idle, playing: true }), false);
  assert.equal(canSkipDraw({ ...idle, animating: true }), false); // seek animation, drag, a wait in progress, the perf overlay
  assert.equal(canSkipDraw({ ...idle, same: false }), false); // new time, size, dpr, panes or chart
});

test('canSkipDraw: recent input or a recent change keeps drawing for IDLE_AFTER_MS', () => {
  assert.equal(canSkipDraw({ ...idle, lastInputAt: idle.now - IDLE_AFTER_MS + 1 }), false);
  assert.equal(canSkipDraw({ ...idle, dirtyAt: idle.now - IDLE_AFTER_MS + 1 }), false);
  assert.equal(canSkipDraw({ ...idle, lastInputAt: idle.now - IDLE_AFTER_MS }), true);
});

test('canSkipDraw: the slow refresh redraws once the last draw is IDLE_REFRESH_MS old', () => {
  assert.equal(canSkipDraw({ ...idle, lastDrawAt: idle.now - IDLE_REFRESH_MS + 1 }), true);
  assert.equal(canSkipDraw({ ...idle, lastDrawAt: idle.now - IDLE_REFRESH_MS }), false);
  assert.equal(canSkipDraw({ ...idle, lastDrawAt: -Infinity }), false); // nothing drawn yet
});
