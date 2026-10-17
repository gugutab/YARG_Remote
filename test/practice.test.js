import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pausePanelWanted, restartNote, setLoopPoint } from '../src/practice.js';

test('setLoopPoint: no loop yet', () => {
  assert.deepEqual(setLoopPoint(null, 'start', 30, 200), { start: 30, end: 200 });
  assert.deepEqual(setLoopPoint(null, 'end', 30, 200), { start: 0, end: 30 });
  assert.equal(setLoopPoint(null, 'end', 0.2, 200), null); // shorter than the minimum
});

test('setLoopPoint: moves one end, swaps when crossing, keeps the minimum', () => {
  const r = { start: 20, end: 40 };
  assert.deepEqual(setLoopPoint(r, 'start', 25, 200), { start: 25, end: 40 });
  assert.deepEqual(setLoopPoint(r, 'end', 35, 200), { start: 20, end: 35 });
  assert.deepEqual(setLoopPoint(r, 'start', 60, 200), { start: 40, end: 60 }); // A after B: swapped
  assert.deepEqual(setLoopPoint(r, 'end', 5, 200), { start: 5, end: 20 }); // B before A: swapped
  assert.equal(setLoopPoint(r, 'start', 39.5, 200), null);
  assert.deepEqual(setLoopPoint(r, 'end', 500, 200), { start: 20, end: 200 }); // clamped to the song
});

test('restartNote counts whole seconds', () => {
  assert.equal(restartNote(2), 'Restarting loop in 2');
  assert.equal(restartNote(1.2), 'Restarting loop in 2');
  assert.equal(restartNote(0.4), 'Restarting loop in 1');
  assert.equal(restartNote(0), '');
});

test('pausePanelWanted needs a user pause and no blocker', () => {
  const ok = { enabled: true, pausedByUser: true, playing: false, ready: true };
  assert.equal(pausePanelWanted(ok), true);
  for (const k of ['waiting', 'listen', 'background', 'liveStage', 'ended', 'hidden', 'focusLost', 'overlayOpen', 'dismissed']) assert.equal(pausePanelWanted({ ...ok, [k]: true }), false, k);
  assert.equal(pausePanelWanted({ ...ok, enabled: false }), false);
  assert.equal(pausePanelWanted({ ...ok, pausedByUser: false }), false);
  assert.equal(pausePanelWanted({ ...ok, playing: true }), false);
});
