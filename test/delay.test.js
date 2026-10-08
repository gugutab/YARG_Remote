import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songDelaySeconds, parseSongIni } from '../src/ini.js';
import { stemStartPlan } from '../src/player.js';

test('song.ini delay (ms) is converted to seconds with the sign kept', () => {
  assert.equal(songDelaySeconds({ delay: 250 }), 0.25);
  assert.equal(songDelaySeconds({ delay: -500 }), -0.5);
});

test('delay_seconds is used when delay is missing or zero', () => {
  assert.equal(songDelaySeconds(parseSongIni('[song]\ndelay_seconds = 0.4\n')), 0.4);
  assert.equal(songDelaySeconds({ delay: 0, delay_seconds: 0.4 }), 0.4);
  assert.equal(songDelaySeconds({}), 0);
});

test('positive delay: the audio file is read ahead of the chart clock', () => {
  // chart t = 0 must play file position 0.25 s
  assert.deepEqual(stemStartPlan(0, 0.25, 100), { offset: 0.25, startDelay: 0 });
  assert.deepEqual(stemStartPlan(10, 0.25, 100), { offset: 10.25, startDelay: 0 });
});

test('negative delay: the stem starts later, after -(t + delay) seconds', () => {
  // chart t = 0 with delay -0.5: the file has not begun, so it starts 0.5 s later
  assert.deepEqual(stemStartPlan(0, -0.5, 100), { offset: 0, startDelay: 0.5 });
  // chart t = 0.2 with delay -0.5: still 0.3 s before the file starts
  assert.ok(Math.abs(stemStartPlan(0.2, -0.5, 100).startDelay - 0.3) < 1e-9);
  // once the file has started it plays from its own position
  assert.deepEqual(stemStartPlan(1, -0.5, 100), { offset: 0.5, startDelay: 0 });
});

test('a stem that ended before the chart time is skipped', () => {
  assert.equal(stemStartPlan(99.9, 0.25, 100), null);
  assert.deepEqual(stemStartPlan(5, 0, 100), { offset: 5, startDelay: 0 });
});
