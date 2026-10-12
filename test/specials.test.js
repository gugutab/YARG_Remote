import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specialNotes, neighbourTime, cluster } from '../src/specials.js';

const lanes = (notes, extra = {}) => ({ mode: 'lanes', notes, starPower: [], solos: [], fills: [], rolls: [], ...extra });

test('cluster keeps the start of each run of close occurrences', () => {
  assert.deepEqual(cluster([1, 1.4, 1.9, 5, 5.2, 9]), [1, 5, 9]);
});

test('lane charts: counts and places of each special kind', () => {
  const chart = lanes(
    [{ time: 1, open: true }, { time: 1.2, open: true }, { time: 8, open: true }, { time: 3, tap: true }, { time: 4, accent: true }, { time: 5, doubleKick: true }],
    { starPower: [{ start: 10, end: 12 }], fills: [{ start: 20, end: 21, kind: 'fill' }, { start: 30, end: 33, kind: 'bre' }], rolls: [{ type: 'tremolo', start: 40, end: 41 }] },
  );
  const byId = Object.fromEntries(specialNotes(chart).map((s) => [s.id, s]));
  assert.equal(byId.open.count, 3);
  assert.deepEqual(byId.open.times, [1, 8]);
  assert.deepEqual(Object.keys(byId).sort(), ['accent', 'bre', 'doubleKick', 'fill', 'open', 'starPower', 'tap', 'tremolo']);
  assert.equal(byId.bre.count, 1);
});

test('vocal charts: slides, talkies, percussion and range shifts', () => {
  const chart = {
    mode: 'vocals',
    notes: [{ time: 1, slide: true }, { time: 2, talkie: true }, { time: 3 }],
    percussion: [{ time: 4, played: true }, { time: 6, played: false }],
    rangeShifts: [{ time: 7 }],
  };
  const ids = specialNotes(chart).map((s) => s.id);
  assert.deepEqual(ids, ['slide', 'talkie', 'percussion', 'rangeShift']);
  assert.deepEqual(specialNotes(null), []);
});

test('neighbourTime goes forward and back without sticking', () => {
  const times = [5, 20, 40];
  assert.equal(neighbourTime(times, 0, 1), 5);
  assert.equal(neighbourTime(times, 5, 1), 20); // not the one we are on
  assert.equal(neighbourTime(times, 41, 1), null);
  assert.equal(neighbourTime(times, 20.2, -1), 5); // not the one that just started
  assert.equal(neighbourTime(times, 3, -1), null);
});
