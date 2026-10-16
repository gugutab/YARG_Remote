import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWidths, sanitizeSizes } from '../src/panesizes.js';

test('valid sizes pass through', () => {
  assert.deepEqual(sanitizeSizes({ weights: { guitar: 1.5, drums: 0.7 }, vocalH: 200 }), { weights: { guitar: 1.5, drums: 0.7 }, vocalH: 200 });
});

test('zero, negative and huge weights are clamped; non-numbers are dropped', () => {
  const r = sanitizeSizes({ weights: { a: 0, b: -3, c: 1e9, d: 'x', e: null, f: NaN, g: Infinity }, vocalH: 0 });
  assert.equal(r.weights.a, 0.05);
  assert.equal(r.weights.b, 0.05);
  assert.equal(r.weights.c, 20);
  assert.deepEqual(Object.keys(r.weights).sort(), ['a', 'b', 'c']);
  assert.equal(r.vocalH, null);
});

test('vocalH below the floor or not finite becomes null', () => {
  for (const v of [89, -5, NaN, Infinity, '200', undefined, null]) assert.equal(sanitizeSizes({ vocalH: v }).vocalH, null);
  assert.equal(sanitizeSizes({ vocalH: 90 }).vocalH, 90);
});

test('garbage input gives the defaults', () => {
  for (const v of [null, undefined, 5, 'x', [], { weights: [1, 2] }, { weights: 'a' }]) assert.deepEqual(sanitizeSizes(v), { weights: {}, vocalH: null });
});

test('fitWidths: no pane under the minimum, the rest share what is left by weight', () => {
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const even = fitWidths([1, 1, 1], 900, 140);
  assert.deepEqual(even.map(Math.round), [300, 300, 300]);
  const extreme = fitWidths([20, 0.05], 1300, 140); // a sliver would be 3 px
  assert.equal(Math.round(extreme[1]), 140);
  assert.equal(Math.round(sum(extreme)), 1300);
  const zero = fitWidths([0.05, 0.05, 1], 1000, 140);
  assert.ok(zero.every((w) => w >= 139.9));
  assert.equal(Math.round(sum(zero)), 1000);
  assert.deepEqual(fitWidths([1, 2], 200, 140).map(Math.round), [100, 100]); // the minimums do not fit: even split
  assert.deepEqual(fitWidths([], 500, 140), []);
});
