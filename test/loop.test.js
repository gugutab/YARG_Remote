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

test('loop wrap: the chart clock follows the old audio until the restart is heard (jumpHistory)', async () => {
  const { jumpHistory, positionAt } = await import('../src/clock.js');
  const hist = [{ time: 10, pos: 50 }, { time: 10.5, pos: 50.5 }];
  const lat = 0.2; // output latency: at audio time 10.6 the speakers play what was rendered at 10.4
  const h = jumpHistory(hist, 10.6, 1, 40); // B reached in rendered time at 10.6: restart at 40
  assert.ok(Math.abs(positionAt(h, 10.6 - lat, 1) - 50.4) < 1e-9); // still hearing the old stretch (before B)
  assert.ok(Math.abs(positionAt(h, 10.59, 1) - 50.59) < 1e-9); // up to B
  assert.equal(positionAt(h, 10.6, 1), 40); // then the new start, when it is heard
  assert.ok(Math.abs(positionAt(h, 10.7, 1) - 40.1) < 1e-9);
  assert.deepEqual(jumpHistory([], 3, 1, 7), [{ time: 3, pos: 7 }]); // nothing to keep: a plain jump
});

test('a backward seek animation lights no note it sweeps over (setLitLag)', async () => {
  const { heldAmount, setLitLag } = await import('../src/gfx.js');
  const n = { time: 10, length: 2 };
  assert.ok(heldAmount(n, 11) > 0);
  setLitLag(1.5); // drawn at 11, real time 9.5: the note has not been reached
  assert.equal(heldAmount(n, 11), 0);
  setLitLag(-3); // a forward animation (drawn behind the real time) changes nothing
  assert.ok(heldAmount(n, 11) > 0);
  setLitLag(0);
});
