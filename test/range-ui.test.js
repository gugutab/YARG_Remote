// Pure helpers of the slider code (src/range-ui.js): the wheel step and the painted fill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wheelValue, rangeFraction } from '../src/range-ui.js';

test('wheelValue: one step per notch, clamped to the range', () => {
  assert.equal(wheelValue(1, 0, 2, 0.05, 1), '1.05'); // 36 steps: one step
  assert.equal(wheelValue(1, 0, 2, 0.05, -3), '0.85');
  assert.equal(wheelValue(1.5, 0, 1.5, 0.01, 2), '1.5');
  assert.equal(wheelValue(0, 0, 1.5, 0.01, -1), '0');
  assert.equal(wheelValue(50, 0, 100, 5, 1), '55');
});

test('wheelValue: a slider with more than 100 steps moves 2% of its range, snapped to its step', () => {
  assert.equal(wheelValue(1400, 600, 3840, 40, 1), '1440'); // 81 steps: one step
  assert.equal(wheelValue(0, 0, 1000, 1, 1), '20'); // 1000 steps: 2% of the range
  assert.equal(wheelValue(0.5, 0, 2, 0.001, 1), '0.54');
  assert.equal(wheelValue(1, 0, 1.5, 0.01, 1), '1.03'); // a volume slider (150 steps)
});

test('rangeFraction: 0..1 over the range, clamped; an empty range does not divide by zero', () => {
  assert.equal(rangeFraction(50, 0, 100), 0.5);
  assert.equal(rangeFraction(-5, 0, 100), 0);
  assert.equal(rangeFraction(200, 0, 100), 1);
  assert.equal(rangeFraction(3, 3, 3), 0);
});
