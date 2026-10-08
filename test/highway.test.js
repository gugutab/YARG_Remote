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
