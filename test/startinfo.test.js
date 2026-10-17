import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFreshStart, overlayLines, startPlan } from '../src/startinfo.js';

test('fresh start only from the very beginning, not resumes, loops, background or the end', () => {
  assert.equal(isFreshStart({ position: 0 }), true);
  assert.equal(isFreshStart({ position: 0.49 }), true);
  assert.equal(isFreshStart({ position: 0.5 }), false);
  assert.equal(isFreshStart({ position: 0, resumed: true }), false);
  assert.equal(isFreshStart({ position: 0, loop: true }), false);
  assert.equal(isFreshStart({ position: 0, background: true }), false);
  assert.equal(isFreshStart({ position: 0, ended: true }), false);
});

test('overlay lines: title, artist, then album, year, genre without empties', () => {
  const l = overlayLines({ title: '<b>Highway Star</b>', artist: 'Deep Purple', album: 'Machine Head', ini: { year: '1972', genre: '' } });
  assert.equal(l.title, 'Highway Star');
  assert.equal(l.artist, 'Deep Purple');
  assert.deepEqual(l.details, ['Machine Head', '1972']);
});

test('start plan', () => {
  const base = { fresh: true, delay: 0, overlayOn: true, keep: false, firstOfSong: true };
  assert.deepEqual(startPlan(base), { delay: 0, show: true, hideMs: 4000 });
  assert.deepEqual(startPlan({ ...base, firstOfSong: false }), { delay: 0, show: false, hideMs: 4000 });
  assert.deepEqual(startPlan({ ...base, delay: 2, firstOfSong: false }), { delay: 2, show: true, hideMs: 3000 });
  assert.deepEqual(startPlan({ ...base, delay: 2, overlayOn: false }), { delay: 2, show: false, hideMs: 3000 });
  assert.deepEqual(startPlan({ ...base, keep: true }), { delay: 0, show: true, hideMs: null });
  assert.deepEqual(startPlan({ ...base, fresh: false, delay: 2 }), { delay: 0, show: false, hideMs: null });
});
