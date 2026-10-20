// The pure helpers behind the Highway "Notes" and "Track and bands" settings: the default of each one must give the original look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beatLineStyles, BEAT_LEVELS, padAlphas, PAD_FILL_ALPHA, PAD_RING_ALPHA, breAlpha, BRE_ALPHA_MIN, BRE_ALPHA_MAX, BRE_ALPHA_STEADY,
  noteCutFraction, rebuildYNote, YNOTE_CUT, YNOTE_CUT_MAX,
} from '../src/gfx.js';

test('beat lines: normal is the original colours of each view, off draws none, the others scale the alpha (at most 1)', () => {
  assert.deepEqual(beatLineStyles('normal', '2d'), ['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.2)', 'rgba(255,255,255,0.12)']);
  assert.deepEqual(beatLineStyles('normal', '3d'), ['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.14)']);
  assert.equal(beatLineStyles('off', '2d'), null);
  assert.deepEqual(beatLineStyles('subtle', '2d'), ['rgba(255,255,255,0.175)', 'rgba(255,255,255,0.1)', 'rgba(255,255,255,0.06)']);
  assert.deepEqual(beatLineStyles('strong', '3d'), ['rgba(255,255,255,0.72)', 'rgba(255,255,255,0.396)', 'rgba(255,255,255,0.252)']);
  assert.deepEqual(beatLineStyles('nope', '2d'), beatLineStyles('normal', '2d')); // an unknown level is normal
  assert.deepEqual(Object.keys(BEAT_LEVELS), ['off', 'subtle', 'normal', 'strong']);
});

test('pad look: 100 % is the original alphas, the ring never goes past 1', () => {
  assert.deepEqual(padAlphas(1), [PAD_FILL_ALPHA, PAD_RING_ALPHA]);
  assert.equal(padAlphas(1.5)[1], 1);
  assert.ok(Math.abs(padAlphas(0.5)[0] - PAD_FILL_ALPHA / 2) < 1e-12);
});

test('big rock ending: steady is the mean of the pulse, inside its range', () => {
  assert.equal(breAlpha(1.234, 2, 5, false), BRE_ALPHA_STEADY);
  assert.ok(BRE_ALPHA_STEADY > BRE_ALPHA_MIN && BRE_ALPHA_STEADY < BRE_ALPHA_MAX);
  let sum = 0;
  let n = 0;
  for (let t = 0; t < 600; t += 0.0137) { sum += breAlpha(t, 1, 5); n++; }
  assert.ok(Math.abs(sum / n - BRE_ALPHA_STEADY) < 0.005, `mean ${sum / n}`);
  assert.equal(breAlpha(1.234, 2, 5), breAlpha(1.234, 2, 5, true)); // the default still pulses
});

test('note cut: 33 % is exactly the design\'s one third; the rest is clamped to 0..YNOTE_CUT_MAX', () => {
  assert.equal(noteCutFraction(33), YNOTE_CUT);
  assert.equal(noteCutFraction(0), 0);
  assert.equal(noteCutFraction(20), 0.2);
  assert.equal(noteCutFraction(90), YNOTE_CUT_MAX);
  assert.equal(rebuildYNote(0.25), 0.25);
  assert.equal(rebuildYNote(-1), 0);
  assert.equal(rebuildYNote(YNOTE_CUT), YNOTE_CUT); // (back to the default for the other tests)
});
