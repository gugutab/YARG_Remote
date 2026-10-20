import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowOnboarding, flashLit, clampLatency, formatMs } from '../src/onboarding.js';

test('the welcome shows only for a fresh visit on the plain library', () => {
  assert.equal(shouldShowOnboarding({}), true);
  assert.equal(shouldShowOnboarding({ onboarded: true }), false);
  assert.equal(shouldShowOnboarding({ changedCount: 3 }), false);
  assert.equal(shouldShowOnboarding({ hash: '#/song/abc/play' }), false);
  assert.equal(shouldShowOnboarding({ hash: '#/' }), true);
});

test('the flash is lit right after each click, shifted by the delay', () => {
  assert.equal(flashLit(0.05, 0), true);
  assert.equal(flashLit(0.5, 0), false);
  assert.equal(flashLit(3.02, 0), true);
  assert.equal(flashLit(0.05, 0.1), false); // picture later: not yet
  assert.equal(flashLit(0.15, 0.1), true);
  assert.equal(flashLit(0.03, -0.05), true); // picture earlier: lit before the click is heard
  assert.equal(flashLit(-1, 0), false);
});

test('the latency is rounded to 5 ms and kept inside +-300', () => {
  assert.equal(clampLatency(47), 45);
  assert.equal(clampLatency(999), 300);
  assert.equal(clampLatency(-999), -300);
  assert.equal(clampLatency('x'), 0);
  assert.equal(formatMs(0), '0 ms');
  assert.equal(formatMs(-40), '−40 ms');
  assert.equal(formatMs(25), '+25 ms');
});
