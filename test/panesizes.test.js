import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSizes } from '../src/panesizes.js';

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
