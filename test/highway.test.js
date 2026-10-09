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

import { exitTime, isHeld, heldPulse, HELD_SCALE, tailShimmer, heldAmount, HELD_FADE_IN, FADE_SEC } from '../src/gfx.js';
test('long notes stay held until their tail ends, and the exit starts then', () => {
  const n = { time: 10, length: 2 };
  assert.equal(exitTime(n), 12);
  assert.equal(exitTime({ time: 10, length: 0 }), 10);
  assert.equal(isHeld(n, 9.9), false);
  assert.equal(isHeld(n, 10), true);
  assert.equal(isHeld(n, 11.99), true);
  assert.equal(isHeld(n, 12), false);
});

test('the held head is a little bigger than normal and the tail shimmer stays within 0..1', () => {
  for (let t = 0; t < 5; t += 0.05) {
    assert.ok(heldPulse(t) > 1.05 && heldPulse(t) < 1.2, `pulse ${heldPulse(t)}`);
    assert.ok(tailShimmer(t) >= 0 && tailShimmer(t) <= 1);
  }
  assert.equal(HELD_SCALE, 1.12);
});

test('the active look of a long note fades in after the hit and out after the tail, never popping', () => {
  const n = { time: 10, length: 2 };
  assert.equal(heldAmount(n, 9.99), 0);
  assert.equal(heldAmount(n, 10), 0);
  const mid = heldAmount(n, 10 + HELD_FADE_IN / 2);
  assert.ok(mid > 0.3 && mid < 0.7);
  assert.equal(heldAmount(n, 11), 1);
  assert.equal(heldAmount(n, 12), 1);
  assert.ok(heldAmount(n, 12 + FADE_SEC / 2) > 0.3 && heldAmount(n, 12 + FADE_SEC / 2) < 0.7);
  assert.equal(heldAmount(n, 12 + FADE_SEC), 0);
  assert.equal(heldAmount({ time: 10, length: 0 }, 10.1), 0);
  let last = 0; // continuous: no step bigger than a few percent between 5 ms samples
  for (let x = 9.9; x < 12.4; x += 0.005) { const v = heldAmount(n, x); assert.ok(Math.abs(v - last) < 0.1); last = v; }
});

import { haloProfile, TAIL_HALO_PROFILE } from '../src/gfx.js';
test('the tail halo falloff goes from 1 to 0 smoothly, with a gentle (zero-slope) end', () => {
  assert.equal(haloProfile(0), 1);
  assert.equal(haloProfile(1), 0);
  for (let i = 1; i < TAIL_HALO_PROFILE.length; i++) assert.ok(TAIL_HALO_PROFILE[i][1] <= TAIL_HALO_PROFILE[i - 1][1]);
  // near the end the glow is almost flat: the last step loses far less than the middle steps do
  const step = (a, b) => haloProfile(a) - haloProfile(b);
  assert.ok(step(11 / 12, 1) < step(5 / 12, 6 / 12) / 5);
  assert.ok(step(0, 1 / 12) < step(5 / 12, 6 / 12) / 5);
});

import { noteShape } from '../src/gfx.js';
const recordPath = (...args) => {
  const pts = [];
  const g = { moveTo: (x, y) => pts.push([x, y]), lineTo: (x, y) => pts.push([x, y]), closePath() {}, ellipse() { pts.push('ellipse'); } };
  noteShape(g, ...args);
  return pts;
};
const widthAt = (pts, y, tol = 1.5) => {
  const row = pts.filter((p) => Math.abs(p[1] - y) < tol).map((p) => p[0]);
  return Math.max(...row) - Math.min(...row);
};

test('3D note shapes taper with the perspective: the top edge is narrower than the bottom one', () => {
  for (const style of ['round', 'rect']) {
    const flat = recordPath(100, 400, 40, 22, style, 0);
    const tapered = recordPath(100, 400, 40, 22, style, 900);
    assert.ok(Array.isArray(tapered) && tapered.length > 10);
    const flatTop = widthAt(flat, 400 - 14), flatBottom = widthAt(flat, 400 + 14);
    const top = widthAt(tapered, 400 - 14), bottom = widthAt(tapered, 400 + 14);
    assert.ok(Math.abs(flatTop - flatBottom) < 1e-6 || style === 'round', 'flat shapes are symmetric');
    assert.ok(top < bottom, `${style}: top ${top} should be narrower than bottom ${bottom}`);
    // the centre row keeps its width (the taper only changes it away from the centre)
    assert.ok(Math.abs(widthAt(tapered, 400, 9) - widthAt(flat, 400, 9)) < 6);
  }
});
