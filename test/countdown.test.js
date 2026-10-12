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
