// Pure formatters of the instrument tile tools (src/tiles-ui.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NECK_FMT, DELAY_FMT } from '../src/tiles-ui.js';

test('NECK_FMT: one decimal and a times sign', () => {
  assert.equal(NECK_FMT(1), '1.0×');
  assert.equal(NECK_FMT(1.25), '1.3×');
  assert.equal(NECK_FMT(0.5), '0.5×');
});

test('DELAY_FMT: seconds without a leading zero or trailing zeros', () => {
  assert.equal(DELAY_FMT(0), '0s');
  assert.equal(DELAY_FMT(0.004), '0s');
  assert.equal(DELAY_FMT(0.35), '.35s');
  assert.equal(DELAY_FMT(-0.4), '-.4s');
  assert.equal(DELAY_FMT(1), '1s');
  assert.equal(DELAY_FMT(-1), '-1s');
});
