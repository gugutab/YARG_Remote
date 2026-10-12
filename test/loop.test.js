import test from 'node:test';
import assert from 'node:assert/strict';
import { snapPoints, snapTime, clampLoop, currentSectionRange, sectionRange, loopForSection, shouldWrap } from '../src/looprange.js';

test('snapPoints adds the song start and end, sorted and unique', () => {
  assert.deepEqual(snapPoints([30, 10, 10, 500], 120), [0, 10, 30, 120]);
});

test('snapTime snaps within the pixel threshold only', () => {
  const pts = snapPoints([10, 30], 100);
  assert.equal(snapTime(10.1, pts, 50), 10); // 5 px
  assert.equal(snapTime(10.4, pts, 50), 10.4); // 20 px
  assert.equal(snapTime(99.9, pts, 50), 100); // the song end is a point
  assert.equal(snapTime(20.0, pts, 50), 20.0);
  assert.equal(snapTime(3, pts, 0), 3);
});

test('snapTime picks the nearest of two close points', () => {
  assert.equal(snapTime(10.09, [10, 10.1], 100), 10.1);
});

test('clampLoop keeps the minimum length and the song bounds', () => {
  const r = { start: 10, end: 20 };
  assert.deepEqual(clampLoop('start', 25, r, 100), { start: 19, end: 20 });
  assert.deepEqual(clampLoop('end', 5, r, 100), { start: 10, end: 11 });
  assert.deepEqual(clampLoop('start', -4, r, 100), { start: 0, end: 20 });
  assert.deepEqual(clampLoop('end', 400, r, 100), { start: 10, end: 100 });
  assert.deepEqual(clampLoop('start', 12, r, 100), { start: 12, end: 20 });
});

test('currentSectionRange: section start to next start, song end for the last', () => {
  const starts = [0, 30, 60];
  assert.deepEqual(currentSectionRange(starts, 45, 100), { start: 30, end: 60 });
  assert.deepEqual(currentSectionRange(starts, 30, 100), { start: 30, end: 60 });
  assert.deepEqual(currentSectionRange(starts, 80, 100), { start: 60, end: 100 });
  assert.deepEqual(currentSectionRange([20, 50], 5, 100), { start: 20, end: 50 }); // before the first: the first
});

test('currentSectionRange without sections is t +- 10 s clamped', () => {
  assert.deepEqual(currentSectionRange([], 50, 100), { start: 40, end: 60 });
  assert.deepEqual(currentSectionRange([], 3, 100), { start: 0, end: 13 });
  assert.deepEqual(currentSectionRange([], 97, 100), { start: 87, end: 100 });
});

test('sectionRange and loopForSection extend or narrow', () => {
  const starts = [0, 30, 60, 90];
  const b = sectionRange(starts, 1, 120);
  const d = sectionRange(starts, 3, 120);
  assert.deepEqual(b, { start: 30, end: 60 });
  assert.equal(sectionRange(starts, 9, 120), null);
  assert.deepEqual(loopForSection(null, b), b);
  assert.deepEqual(loopForSection(b, d), { start: 30, end: 120 });
  assert.deepEqual(loopForSection({ start: 30, end: 120 }, b), b); // inside: narrows
});

test('shouldWrap only when leaving the end from inside', () => {
  const r = { start: 30, end: 60 };
  assert.equal(shouldWrap(r, 59.9, 60.02), true);
  assert.equal(shouldWrap(r, 59.5, 59.9), false);
  assert.equal(shouldWrap(r, 59.9, 60.02, 0.1), false); // look-ahead: effective end 59.9, prev is not before it
  assert.equal(shouldWrap(r, 59.7, 59.95, 0.1), true);
  assert.equal(shouldWrap(r, 10, 10.02), false); // dormant before the region
  assert.equal(shouldWrap(r, 70, 70.02), false); // dormant after it
  assert.equal(shouldWrap(r, 50, 75), false); // a seek out of the region is not a wrap
  assert.equal(shouldWrap(r, 29, 30.5), false); // entering the region from before
  assert.equal(shouldWrap(null, 1, 2), false);
  assert.equal(shouldWrap(r, null, 60), false);
});
