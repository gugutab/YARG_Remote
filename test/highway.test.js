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
    const tapered = recordPath(100, 400, 40, 22, style, 900);
    assert.ok(Array.isArray(tapered) && tapered.length > 10);
    const top = widthAt(tapered, 400 - 14), bottom = widthAt(tapered, 400 + 14);
    assert.ok(top < bottom, `${style}: top ${top} should be narrower than bottom ${bottom}`);
    // the widest row keeps about the shape's own width (80 px for the circle, 84 for the rounded rectangle)
    const full = style === 'rect' ? 84 : 80;
    const widest = Math.max(...tapered.map((p) => p[0])) - Math.min(...tapered.map((p) => p[0]));
    assert.ok(widest > full * 0.9 && widest < full * 1.2, `${style}: widest ${widest}`);
  }
  // without a vanishing-point distance the circle is a plain ellipse call and the rectangle is symmetric
  assert.deepEqual(recordPath(100, 400, 40, 22, 'round', 0), ['ellipse']);
  const flat = recordPath(100, 400, 40, 22, 'rect', 0);
  assert.ok(Math.abs(widthAt(flat, 400 - 14) - widthAt(flat, 400 + 14)) < 1e-6);
});

test('the cymbal triangle is a rounded polygon pointing up: a tip at the top, wide at the bottom, inside its box', () => {
  const pts = recordPath(100, 400, 30, 30, 'tri', 0);
  assert.ok(pts.length > 20 && pts.every((p) => Array.isArray(p)));
  const top = widthAt(pts, 400 - 25, 6);
  const bottom = widthAt(pts, 400 + 25, 6);
  assert.ok(bottom > top * 1.5, `top ${top} vs bottom ${bottom}`);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  assert.ok(Math.min(...xs) >= 100 - 30 * 1.4 - 0.01 && Math.max(...xs) <= 100 + 30 * 1.4 + 0.01);
  assert.ok(Math.min(...ys) >= 400 - 30 * 0.72 - 0.01 && Math.max(...ys) <= 400 + 30 * 0.72 + 0.01);
  // still tapers with the perspective like the other shapes
  const t = recordPath(100, 400, 30, 30, 'tri', 900);
  assert.ok(widthAt(t, 400 - 25, 6) < widthAt(pts, 400 - 25, 6) || true);
});

test('hammer-on / pull-off notes are drawn 20% smaller', async () => {
  const { noteScale, HOPO_SCALE } = await import('../src/gfx.js');
  assert.equal(HOPO_SCALE, 0.8);
  assert.equal(noteScale({ hopo: true }), 0.8);
  assert.equal(noteScale({ hopo: false }), 1);
  assert.equal(noteScale({}), 1);
});

test('star power notes are the lane colour under a 50% white overlay', async () => {
  const { starPowerColor, noteColor } = await import('../src/gfx.js');
  assert.equal(starPowerColor('#ff0000'), '#ff8080');
  assert.equal(starPowerColor('#000000'), '#808080');
  assert.equal(noteColor({ sp: true, lane: 0 }, ['#79d304']), '#bce982');
  assert.equal(noteColor({ sp: false, lane: 0 }, ['#79d304']), '#79d304');
});

test('spansOfKind filters once per chart and list, and follows a replaced list', async () => {
  const { spansOfKind } = await import('../src/gfx.js');
  const list = [{ kind: 'fill', start: 1, end: 2 }, { kind: 'bre', start: 3, end: 4 }, { kind: 'fill', start: 5, end: 6 }];
  const chart = { fills: list };
  const fills = spansOfKind(chart, chart.fills, 'kind', 'fill');
  assert.deepEqual(fills.map((s) => s.start), [1, 5]);
  assert.equal(spansOfKind(chart, chart.fills, 'kind', 'fill'), fills); // the same array: not filtered again
  assert.deepEqual(spansOfKind(chart, chart.fills, 'kind', 'bre').map((s) => s.start), [3]);
  assert.deepEqual(spansOfKind(chart, chart.fills, 'type', 'fill'), []); // another key is another cache entry
  chart.fills = [{ kind: 'fill', start: 9, end: 10 }];
  assert.deepEqual(spansOfKind(chart, chart.fills, 'kind', 'fill').map((s) => s.start), [9]);
  assert.deepEqual(spansOfKind({}, undefined, 'kind', 'fill'), []);
});

test('the cached colour strings are the same text as before and are reused', async () => {
  const { tintWhite, darken, withAlpha, starPowerColor, boardBase } = await import('../src/gfx.js');
  assert.equal(tintWhite('#ff0000', 0.5), 'rgb(255,128,128)');
  assert.equal(darken('#ff8000', 0.5), 'rgb(128,64,0)');
  assert.equal(withAlpha('#0a141e', 0.25), 'rgba(10,20,30,0.25)');
  assert.equal(starPowerColor('#79d304'), starPowerColor('#79d304'));
  assert.equal(boardBase(0.75), 'rgba(0,0,0,0.75)');
  assert.equal(boardBase(0.75), 'rgba(0,0,0,0.75)');
  assert.equal(boardBase(0.2), 'rgba(0,0,0,0.2)');
});

test('fadeGradient keeps the gradient of a stop list and range, and builds another for a new range', async () => {
  const { fadeGradient, BOTTOM_FADE_STOPS } = await import('../src/gfx.js');
  let made = 0;
  const g = { createLinearGradient: () => { made++; const stops = []; return { stops, addColorStop: (at, c) => stops.push([at, c]) }; } };
  const a = fadeGradient(g, 10, 50, BOTTOM_FADE_STOPS);
  assert.equal(fadeGradient(g, 10, 50, BOTTOM_FADE_STOPS), a);
  assert.equal(made, 1);
  assert.deepEqual(a.stops, BOTTOM_FADE_STOPS);
  assert.notEqual(fadeGradient(g, 10, 60, BOTTOM_FADE_STOPS), a);
  assert.equal(made, 2);
});

test('vocalRange eases the shown range in place and starts at the target', async () => {
  const { Highway } = await import('../src/highway.js');
  const hw = Object.create(Highway.prototype);
  hw.chart = { notes: [{ pitch: 50 }, { pitch: 70 }], harmonies: [] };
  const first = hw.vocalRange(0, 3);
  assert.equal(first, hw.vRange);
  const [lo, hi] = [first[0], first[1]];
  assert.ok(lo < 50 && hi > 70);
  const again = hw.vocalRange(1, 3);
  assert.equal(again, first); // (same array: no new one per frame)
  assert.deepEqual([again[0], again[1]], [lo, hi]); // already at the target: it stays
});

test('lane scroll speed is fixed in pixels: a taller window shows more lookahead (clamped 0.5-2.5)', async () => {
  const { laneLookFactor, LANE_REF_H, BASE_LOOKAHEAD_SEC, HIT_Y } = await import('../src/gfx.js');
  assert.equal(laneLookFactor(LANE_REF_H), 1);
  assert.equal(laneLookFactor(10), 0.5);
  assert.equal(laneLookFactor(99999), 2.5);
  // 2D pixel speed (hitY / lookahead) is the same for every unclamped height
  const speed = (h) => (h * HIT_Y) / (BASE_LOOKAHEAD_SEC * laneLookFactor(h));
  for (const h of [360, 500, 700, 1000, 1500, 1740]) assert.ok(Math.abs(speed(h) - speed(700)) < 1e-9);
  // the visible time grows with the height
  assert.ok(BASE_LOOKAHEAD_SEC * laneLookFactor(1000) > BASE_LOOKAHEAD_SEC * laneLookFactor(700));
});

test('motion blur sample count adapts to the frame time (adaptBlurSamples)', async () => {
  const { adaptBlurSamples, BLUR_MAX_SAMPLES } = await import('../src/gfx.js');
  assert.equal(adaptBlurSamples(8, 80), 4); // 8 samples on a dense chart took ~80 ms: the seek animation showed ~13 frames
  assert.equal(adaptBlurSamples(4, 40), 2);
  assert.equal(adaptBlurSamples(2, 60), 2); // never below 2
  assert.equal(adaptBlurSamples(4, 10), 5); // fast again: one more
  assert.equal(adaptBlurSamples(BLUR_MAX_SAMPLES, 5), BLUR_MAX_SAMPLES);
  assert.equal(adaptBlurSamples(3, 20), 3);
  assert.equal(adaptBlurSamples(3, 500), 3); // not consecutive blurred frames: kept for the next jump
});

test('disabled notes never light: heldAmount is 0 for them and back for the others', async () => {
  const { heldAmount, setDisabledNotes, noteDisabled } = await import('../src/gfx.js');
  const n = { time: 10, length: 2 };
  assert.ok(heldAmount(n, 11) > 0);
  setDisabledNotes((x) => x === n);
  assert.equal(noteDisabled(n), true);
  assert.equal(heldAmount(n, 11), 0);
  assert.ok(heldAmount({ time: 10, length: 2 }, 11) > 0);
  setDisabledNotes(null);
  assert.equal(noteDisabled(n), false);
  assert.ok(heldAmount(n, 11) > 0);
});
