import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelState, isSolo } from '../src/levelicon.js';

test('levelState: icon steps, fill and boost', () => {
  assert.deepEqual(levelState(1), { icon: 'volume', fill: 67, boost: false, off: false });
  assert.equal(levelState(0.3).icon, 'volume-low');
  assert.equal(levelState(1.5).fill, 100);
  assert.equal(levelState(1.2).boost, true);
  assert.deepEqual(levelState(0), { icon: 'volume-off', fill: 0, boost: false, off: true });
  assert.deepEqual(levelState(0.8, true), { icon: 'volume-off', fill: 0, boost: false, off: true });
  assert.equal(levelState(NaN).off, true);
});

test('isSolo: audible members while every other state is silent', () => {
  const a = { muted: false }, b = { muted: true }, c = { muted: true };
  const silent = (s) => s.muted;
  assert.equal(isSolo([a], [a, b, c], silent), true);
  assert.equal(isSolo([a], [a], silent), false);
  assert.equal(isSolo([b], [a, b, c], silent), false);
  assert.equal(isSolo([a, b], [a, b, c], silent), false);
});
