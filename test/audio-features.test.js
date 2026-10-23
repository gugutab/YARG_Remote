import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioFeatures, bandEdges, BANDS } from '../src/audio-features.js';

const FFT = 2048, SR = 48000;
const spectrum = (fill) => Uint8Array.from({ length: FFT / 2 }, (_, i) => fill(i * SR / FFT));
const hz = (f) => f;

test('bandEdges: log-spaced, strictly increasing, inside the spectrum', () => {
  const e = bandEdges(SR, FFT);
  assert.equal(e.length, BANDS + 1);
  for (let i = 1; i < e.length; i++) assert.ok(e[i] > e[i - 1], `edge ${i}`);
  assert.ok(e[0] >= 1 && e[BANDS] <= FFT / 2);
  assert.ok(e[BANDS] * SR / FFT > 10000); // (reaches the treble)
});

test('silence gives zeros; a bass tone raises bass, not treble', () => {
  const f = createAudioFeatures();
  f.update(null, 0, FFT, 0);
  assert.equal(f.on, false);
  assert.equal(f.level, 0);
  const bass = spectrum((fr) => (fr > 40 && fr < 120 ? 230 : 5));
  for (let i = 0; i < 30; i++) f.update(bass, SR, FFT, 0.1 + i / 60);
  assert.equal(f.on, true);
  assert.ok(f.bass > 0.4 && f.bass < 0.6, `a steady bass sits about the middle: ${f.bass}`);
  const louder = spectrum((fr) => (fr > 40 && fr < 120 ? 255 : 5));
  for (let i = 0; i < 6; i++) f.update(louder, SR, FFT, 0.6 + i / 60);
  assert.ok(f.bass > 0.52, `a louder moment goes up: ${f.bass}`);
  assert.ok(f.bands[0] + f.bands[1] + f.bands[2] > f.bands[BANDS - 1] + f.bands[BANDS - 2] + f.bands[BANDS - 3]);
});

test('a sudden bass hit makes a kick pulse that decays; a steady tone does not', () => {
  const f = createAudioFeatures();
  const quiet = spectrum((fr) => (fr < 200 ? 20 : 5)), hit = spectrum((fr) => (fr < 200 ? 240 : 10));
  let t = 0;
  for (let i = 0; i < 60; i++) f.update(quiet, SR, FFT, (t += 1 / 60));
  assert.ok(f.kick < 0.05, `steady ${f.kick}`);
  f.update(hit, SR, FFT, (t += 1 / 60));
  const peak = f.kick;
  assert.ok(peak > 0.5, `kick ${peak}`);
  for (let i = 0; i < 30; i++) f.update(hit, SR, FFT, (t += 1 / 60));
  assert.ok(f.kick < peak * 0.2, 'decays while the bass stays loud');
});

test('pausing lets the numbers fall away', () => {
  const f = createAudioFeatures();
  const loud = spectrum(() => 200);
  let t = 0;
  for (let i = 0; i < 20; i++) f.update(loud, SR, FFT, (t += 1 / 60));
  assert.ok(f.level > 0.4);
  for (let i = 0; i < 90; i++) f.update(null, 0, FFT, (t += 1 / 60));
  assert.equal(f.on, false);
  assert.ok(f.level < 0.02 && f.bass < 0.02);
});

test('a second update in the same instant changes nothing', () => {
  const f = createAudioFeatures();
  f.update(spectrum(() => 100), SR, FFT, 1);
  const lvl = f.level;
  f.update(spectrum(() => 250), SR, FFT, 1);
  assert.equal(f.level, lvl);
});
