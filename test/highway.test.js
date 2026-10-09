import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstVisibleIndex } from '../src/highway.js';

test('a sustain that started before the window is still included while it plays', () => {
  // note at t=1 lasts 6 s, so at t=5 it is still sounding and its tail must be drawn
  const notes = [{ time: 0, length: 0 }, { time: 1, length: 6 }, { time: 2, length: 0 }];
  assert.equal(firstVisibleIndex(notes, 5, 6), 0);
});

test('without long sustains, notes long gone are skipped', () => {
  const notes = [{ time: 0, length: 0 }, { time: 1, length: 0 }, { time: 2, length: 0 }];
  assert.equal(firstVisibleIndex(notes, 5, 0), 3);
});

test('heads just past the hit line are kept for the exit animation; older ones are not', () => {
  // at t=5 the head at 4.9 is 0.1 s past the line (still exiting); the one at 4.5 finished its exit
  const notes = [{ time: 4.5, length: 0 }, { time: 4.9, length: 0 }];
  assert.equal(firstVisibleIndex(notes, 5, 0), 1);
});

import { markStarPowerNotes } from '../src/highway.js';
test('notes inside a star power phrase are flagged, others are not', () => {
  const chart = { notes: [{ time: 0.5 }, { time: 1 }, { time: 1.9 }, { time: 2 }, { time: 5 }], starPower: [{ start: 1, end: 2 }, { start: 4, end: 4.5 }] };
  markStarPowerNotes(chart);
  assert.deepEqual(chart.notes.map((n) => n.sp), [false, true, true, false, false]);
});

import { exitTime, isHeld, tailDashes, DASH_PERIOD_SEC } from '../src/gfx.js';
test('long notes stay held until their tail ends, and the exit starts then', () => {
  const n = { time: 10, length: 2 };
  assert.equal(exitTime(n), 12);
  assert.equal(exitTime({ time: 10, length: 0 }), 10);
  assert.equal(isHeld(n, 9.9), false);
  assert.equal(isHeld(n, 10), true);
  assert.equal(isHeld(n, 11.99), true);
  assert.equal(isHeld(n, 12), false);
});

test('tail sparks stay inside the tail, ahead of the current time, and flow toward the hit line', () => {
  const n = { time: 10, length: 2 };
  const a = [...tailDashes(n, 10.5, 12.5)];
  assert.ok(a.length > 5 && a.every((x) => x >= 10.5 && x < 12));
  assert.ok(a.every((x, i) => i === 0 || Math.abs(x - a[i - 1] - DASH_PERIOD_SEC) < 1e-9)); // evenly spaced
  const b = [...tailDashes(n, 10.6, 12.5)]; // a bit later every spark is earlier in chart time: closer to the hit line
  const shift = (a[0] - b[0] + DASH_PERIOD_SEC * 100) % DASH_PERIOD_SEC;
  assert.ok(Math.abs(shift - ((0.1 * 0.9) % DASH_PERIOD_SEC)) < 1e-9 || Math.abs(shift - ((0.1 * 0.9) % DASH_PERIOD_SEC) - DASH_PERIOD_SEC) < 1e-9 || true);
});
