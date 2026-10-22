import test from 'node:test';
import assert from 'node:assert/strict';
import { packInstance, INST_FLOATS } from '../src/glnotes.js';

test('packInstance writes one instance at its slot and leaves the others alone', () => {
  const buf = new Float32Array(INST_FLOATS * 3);
  packInstance(buf, 1, 10, 20, 30, 40, 1, 2, 3, 4, 5, 0.5);
  assert.deepEqual([...buf.slice(0, INST_FLOATS)], new Array(INST_FLOATS).fill(0));
  assert.deepEqual([...buf.slice(INST_FLOATS, 2 * INST_FLOATS)], [10, 20, 30, 40, 1, 2, 3, 4, 5, 0.5]);
  assert.deepEqual([...buf.slice(2 * INST_FLOATS)], new Array(INST_FLOATS).fill(0));
});
