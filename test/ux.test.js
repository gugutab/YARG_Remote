import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeFade } from '../src/settings-ui.js';

test('edgeFade: no fade when the strip fits', () => {
  assert.deepEqual(edgeFade(0, 390, 390), { start: false, end: false });
  assert.deepEqual(edgeFade(0, 390, 390.6), { start: false, end: false }); // fractional slack
});

test('edgeFade: fades the end at the start, both in the middle, the start at the end', () => {
  assert.deepEqual(edgeFade(0, 390, 900), { start: false, end: true });
  assert.deepEqual(edgeFade(200, 390, 900), { start: true, end: true });
  assert.deepEqual(edgeFade(510, 390, 900), { start: true, end: false });
});
