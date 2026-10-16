import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LegacyPlayer } from '../src/player.js';

// A fake context whose decode can be held back, to model a slow load that is superseded.
function fakeCtx() {
  const gates = [];
  const buf = (length = 100, sampleRate = 100) => ({
    length, sampleRate, numberOfChannels: 1, duration: length / sampleRate,
    getChannelData: () => new Float32Array(length), copyToChannel() {},
  });
  return {
    gates,
    createBuffer: (ch, length, sr) => buf(length, sr),
    createGain: () => ({ connect() {}, gain: { value: 1 } }),
    decodeAudioData: () => new Promise((res) => gates.push(() => res(buf()))),
  };
}
const stem = (id) => ({ id, label: id, getFile: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }) });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('unload() while a decode is in flight: the load returns false and installs nothing', async () => {
  const ctx = fakeCtx();
  const p = new LegacyPlayer(ctx, { });
  const a = p.load([stem('a')]);
  await tick();
  p.unload(); // the user picked another song / closed this one
  ctx.gates.forEach((g) => g());
  assert.equal(await a, false);
  assert.equal(p.stems.size, 0);
  assert.equal(p.duration, 0);
});

test('a load that starts after unload() still works', async () => {
  const ctx = fakeCtx();
  const p = new LegacyPlayer(ctx, { });
  p.unload();
  const b = p.load([stem('b')]);
  await tick();
  ctx.gates.forEach((g) => g());
  assert.equal(await b, true);
  assert.equal(p.stems.size, 1);
});
