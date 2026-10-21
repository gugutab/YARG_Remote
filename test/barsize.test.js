import test from 'node:test';
import assert from 'node:assert/strict';
import { snapPositions, snapHeight, magnetHeight, nextSnap, BAR_MIN, clampHeight, barLevel, serializeHeight, parseStoredHeight, keyHeight } from '../src/barsize.js';

test('clampHeight keeps the height in the range', () => {
  assert.equal(clampHeight(5, 120), BAR_MIN);
  assert.equal(clampHeight(500, 120), 120);
  assert.equal(clampHeight(63.6, 120), 64);
  assert.equal(clampHeight(NaN, 120), 120);
  assert.equal(clampHeight(50, 8), BAR_MIN); // a nonsense maximum never goes below the minimum
});

test('barLevel: seek bar only, compact row, full bar', () => {
  assert.equal(barLevel(BAR_MIN, 120), 'min');
  assert.equal(barLevel(55, 120), 'min');
  assert.equal(barLevel(56, 120), 'compact');
  assert.equal(barLevel(111, 120), 'compact');
  assert.equal(barLevel(112, 120), 'full');
  assert.equal(barLevel(120, 120), 'full');
  assert.equal(barLevel(100, 100), 'full');
  assert.equal(barLevel(60, 60), 'compact'); // a tiny maximum never reports full
});

test('serialize and parse the stored height', () => {
  assert.equal(serializeHeight(120, 120), 'max');
  assert.equal(serializeHeight(64.4, 120), '64');
  assert.equal(parseStoredHeight('max', null, 100), 100);
  assert.equal(parseStoredHeight('64', null, 120), 64);
  assert.equal(parseStoredHeight('900', null, 120), 120); // the window got smaller
  assert.equal(parseStoredHeight('2', null, 120), BAR_MIN);
  assert.equal(parseStoredHeight('abc', null, 120), null);
  assert.equal(parseStoredHeight(null, null, 120), null);
});

test('legacy barHidden: 1 is the minimum, 0 the maximum, the new key wins', () => {
  assert.equal(parseStoredHeight(null, '1', 120), BAR_MIN);
  assert.equal(parseStoredHeight(null, '0', 120), 120);
  assert.equal(parseStoredHeight('80', '1', 120), 80);
});

test('keyHeight: arrows step by 8 px, Home and End jump to the ends', () => {
  assert.equal(keyHeight('ArrowUp', 64, 120), 72);
  assert.equal(keyHeight('ArrowDown', 64, 120), 56);
  assert.equal(keyHeight('ArrowDown', 64, 120, 'ArrowDown'), 72); // a bar at the top grows downwards
  assert.equal(keyHeight('ArrowUp', 118, 120), 120);
  assert.equal(keyHeight('Home', 64, 120), BAR_MIN);
  assert.equal(keyHeight('End', 64, 120), 120);
  assert.equal(keyHeight('a', 64, 120), null);
});


test('snap: three positions, the nearest on release, a magnet near them, arrows jump to the next', () => {
  assert.deepEqual(snapPositions(120), [16, 64, 120]);
  assert.deepEqual(snapPositions(100), [16, 64, 100]);
  assert.deepEqual(snapPositions(60), [16, 60]); // too low for a middle position
  assert.equal(snapHeight(30, 120), 16);
  assert.equal(snapHeight(45, 120), 64);
  assert.equal(snapHeight(100, 120), 120);
  assert.equal(magnetHeight(70, 120), 64);
  assert.equal(magnetHeight(90, 120), 90); // between positions: untouched
  assert.equal(nextSnap(16, 120, 1), 64);
  assert.equal(nextSnap(64, 120, 1), 120);
  assert.equal(nextSnap(120, 120, 1), 120);
  assert.equal(nextSnap(64, 120, -1), 16);
  assert.equal(nextSnap(16, 120, -1), 16);
  assert.equal(nextSnap(90, 120, -1), 64);
});
