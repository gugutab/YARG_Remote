import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeLock } from '../src/wakelock.js';

const wait = () => new Promise((r) => setTimeout(r, 5));
const fakeNav = () => {
  const n = { requests: 0, released: 0 };
  n.wakeLock = { request: async () => { n.requests += 1; return { release: async () => { n.released += 1; }, addEventListener() {} }; } };
  return n;
};
const doc = { visibilityState: 'visible', addEventListener() {} };

test('the lock is taken while playing and released on pause', async () => {
  const nav = fakeNav();
  const w = createWakeLock(nav, doc);
  w.set(true);
  await wait();
  assert.equal(w.held, true);
  assert.equal(nav.requests, 1);
  w.set(true); // already held: no second request
  await wait();
  assert.equal(nav.requests, 1);
  w.set(false);
  assert.equal(w.held, false);
  assert.equal(nav.released, 1);
});

test('no Wake Lock API, a refusal or a hidden tab never throw', async () => {
  createWakeLock({}, doc).set(true);
  const refusing = { wakeLock: { request: async () => { throw new Error('denied'); } } };
  const w = createWakeLock(refusing, doc);
  w.set(true);
  await wait();
  assert.equal(w.held, false);
  const hidden = fakeNav();
  createWakeLock(hidden, { ...doc, visibilityState: 'hidden' }).set(true);
  assert.equal(hidden.requests, 0);
});

test('a lock acquired after playback stopped is released at once', async () => {
  const nav = fakeNav();
  const w = createWakeLock(nav, doc);
  w.set(true);
  w.set(false);
  await wait();
  assert.equal(w.held, false);
  assert.equal(nav.released, nav.requests);
});
