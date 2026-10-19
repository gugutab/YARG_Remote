import test from 'node:test';
import assert from 'node:assert/strict';
import { markStrongBeats } from '../src/chart.js';

const grid = (perMeasure, measures) => Array.from({ length: perMeasure * measures }, (_, i) => ({ time: i * 0.5, measure: i % perMeasure === 0 }));

test('the strong beat is the middle of a measure with an even number of beats', () => {
  const four = markStrongBeats(grid(4, 2));
  assert.deepEqual(four.map((b) => !!b.strong), [false, false, true, false, false, false, true, false]);
  const six = markStrongBeats(grid(6, 1));
  assert.deepEqual(six.map((b) => !!b.strong), [false, false, false, true, false, false]);
});

test('odd and very short measures have no strong beat', () => {
  assert.ok(markStrongBeats(grid(3, 2)).every((b) => !b.strong));
  assert.ok(markStrongBeats(grid(2, 3)).every((b) => !b.strong));
});
