import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitCountdowns, countdownAt, MIN_COUNTDOWN_SEC } from '../src/countdown.js';

const chart = (notes, extra = {}) => ({ notes, ...extra });

test('a gap of 9 s or more between notes gets a countdown from the last note end', () => {
  const c = chart([{ time: 0.5, end: 1 }, { time: 12, end: 13 }, { time: 20, end: 21 }]);
  assert.deepEqual(waitCountdowns(c), [{ start: 1, end: 12 }]); // 12 - 1 = 11 s; 20 - 13 = 7 s: none
});

test('the start of the song counts: nothing to play for the first 9 s', () => {
  assert.deepEqual(waitCountdowns(chart([{ time: 10, end: 10.2 }])), [{ start: 0, end: 10 }]);
  assert.deepEqual(waitCountdowns(chart([{ time: MIN_COUNTDOWN_SEC - 0.1, end: 9 }])), []);
});

test('a long sustain keeps the gap closed until it ends; overlapping notes are one block', () => {
  const c = chart([{ time: 1, end: 15 }, { time: 2, end: 3 }, { time: 22, end: 23 }]);
  assert.deepEqual(waitCountdowns(c), []); // 22 - 15 = 7 s
  const d = chart([{ time: 1, end: 15 }, { time: 2, end: 3 }, { time: 25, end: 26 }]);
  assert.deepEqual(waitCountdowns(d), [{ start: 15, end: 25 }]);
});

test('vocal harmonies and percussion count as notes', () => {
  const c = { notes: [{ time: 1, end: 2 }], harmonies: [{ notes: [{ time: 8, end: 9 }] }], percussion: [{ time: 15 }, { time: 30 }] };
  assert.deepEqual(waitCountdowns(c), [{ start: 15, end: 30 }]); // 9 -> 15 is only 6 s
});

test('a coda cuts the countdown at its start and suppresses the ones after it', () => {
  const c = chart([{ time: 1, end: 2 }, { time: 40, end: 41 }, { time: 80, end: 81 }], { fills: [{ kind: 'bre', start: 20, end: 60 }] });
  assert.deepEqual(waitCountdowns(c), [{ start: 2, end: 20 }]);
});

test('countdownAt finds the running countdown and its remaining time', () => {
  const list = [{ start: 2, end: 20 }, { start: 30, end: 45 }];
  assert.equal(countdownAt(list, 1), null);
  assert.deepEqual(countdownAt(list, 10), { remaining: 10, total: 18 });
  assert.equal(countdownAt(list, 20), null);
  assert.deepEqual(countdownAt(list, 44), { remaining: 1, total: 15 });
  assert.equal(countdownAt([], 5), null);
});

test('percussion: false counts a percussion section as a rest (for the lyric views)', () => {
  const c = { notes: [{ time: 1, end: 2 }, { time: 40, end: 41 }], percussion: [{ time: 10 }, { time: 15 }, { time: 20 }, { time: 25 }, { time: 30 }] };
  assert.deepEqual(waitCountdowns(c), [{ start: 30, end: 40 }]); // hits every 5 s keep the gaps short, until the last one
  assert.deepEqual(waitCountdowns(c, { percussion: false }), [{ start: 2, end: 40 }]);
});

import { countdownAlpha, measureStarts, measurePosition, measuresLeft } from '../src/countdown.js';

test('countdownAlpha: fades in over 0.5 s, full in the middle, gone at 1 s remaining (YARG shows it while more than 1.5 s remain)', () => {
  assert.equal(countdownAlpha({ total: 20, remaining: 20 }), 0);
  assert.equal(countdownAlpha({ total: 20, remaining: 19.75 }), 0.5);
  assert.equal(countdownAlpha({ total: 20, remaining: 10 }), 1);
  assert.equal(countdownAlpha({ total: 20, remaining: 1.5 }), 1);
  assert.equal(countdownAlpha({ total: 20, remaining: 1.25 }), 0.5);
  assert.equal(countdownAlpha({ total: 20, remaining: 1 }), 0);
});

test('measuresLeft counts the whole measures until the measure the notes come back in', () => {
  const beats = Array.from({ length: 41 }, (_, i) => ({ time: i * 0.5, measure: i % 4 === 0 })); // 4/4 at 120 BPM: a measure every 2 s
  const starts = measureStarts(beats);
  assert.deepEqual(starts.slice(0, 3), [0, 2, 4]);
  assert.equal(measurePosition(starts, 3), 1.5);
  assert.equal(measuresLeft(starts, 0, 20), 10); // the end (measure 10) is 10 measures away
  assert.equal(measuresLeft(starts, 1, 20), 10); // 9.5 measures to go: rounded up
  assert.equal(measuresLeft(starts, 2, 20), 9); // at the start of the second measure: 9 to go
  assert.equal(measuresLeft(starts, 2.1, 21), 9); // the end snaps down to the start of its measure (21 s is inside measure 10)
  assert.equal(measuresLeft(starts, 19.9, 20), 1);
});

test('the shortest rest with a countdown can be changed (setting highway.countdownMin)', () => {
  const c = chart([{ time: 0.5, end: 1 }, { time: 7, end: 8 }, { time: 20, end: 21 }]); // gaps: 6 s, 12 s
  assert.deepEqual(waitCountdowns(c), [{ start: 8, end: 20 }]);
  assert.deepEqual(waitCountdowns(c, { min: 5 }), [{ start: 1, end: 7 }, { start: 8, end: 20 }]);
  assert.deepEqual(waitCountdowns(c, { min: 15 }), []);
  assert.deepEqual(waitCountdowns(c, { min: MIN_COUNTDOWN_SEC }), waitCountdowns(c));
});
