import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songDelaySeconds, parseSongIni } from '../src/ini.js';
import { alignChannel, alignedLength } from '../src/player.js';

test('song.ini delay (ms) is converted to seconds with the sign kept', () => {
  assert.equal(songDelaySeconds({ delay: 250 }), 0.25);
  assert.equal(songDelaySeconds({ delay: -500 }), -0.5);
});

test('delay_seconds is used when delay is missing or zero', () => {
  assert.equal(songDelaySeconds(parseSongIni('[song]\ndelay_seconds = 0.4\n')), 0.4);
  assert.equal(songDelaySeconds({ delay: 0, delay_seconds: 0.4 }), 0.4);
  assert.equal(songDelaySeconds({}), 0);
});

test('positive delay: the file is read ahead, so the first samples are dropped', () => {
  // at sample rate 1, chart time 0 is file time 2 s
  assert.deepEqual([...alignChannel(Float32Array.from([1, 2, 3, 4, 5, 6]), 1, 2)], [3, 4, 5, 6]);
  assert.equal(alignedLength(6, 1, 2), 4);
});

test('negative delay: silence is added in front, so the file starts later on the chart', () => {
  // chart time 0 is file time -2 s: two silent samples, then the file
  assert.deepEqual([...alignChannel(Float32Array.from([1, 2, 3, 4, 5, 6]), 1, -2)], [0, 0, 1, 2, 3, 4, 5, 6]);
  assert.equal(alignedLength(6, 1, -2), 8);
});

test('no delay leaves the stem unchanged', () => {
  assert.deepEqual([...alignChannel(Float32Array.from([1, 2, 3]), 1, 0)], [1, 2, 3]);
});

test('a delay longer than the file leaves a stem that is only silence', () => {
  assert.deepEqual([...alignChannel(Float32Array.from([1, 2, 3]), 1, 5)], [0]);
});
