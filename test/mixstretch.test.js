import test from 'node:test';
import assert from 'node:assert/strict';
import { MixStretcher } from '../src/mixstretch.js';
import { positionAt, trimHistory } from '../src/clock.js';

const SR = 44100;
const impulse = (len, at, amp = 1) => {
  const a = new Float32Array(len);
  a[at] = amp;
  return a;
};
const renderAll = (mix, total, block = 128) => {
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const positions = [];
  for (let i = 0; i < total; i += block) {
    const n = Math.min(block, total - i);
    positions.push(mix.render(L.subarray(i, i + n), R.subarray(i, i + n), n));
  }
  return { L, R, positions };
};
const peakIndex = (a) => a.reduce((best, v, i) => (Math.abs(v) > Math.abs(a[best]) ? i : best), 0);

test('stems are summed sample for sample, with per-stem gains', () => {
  const mix = new MixStretcher(SR);
  mix.setStems([[impulse(4000, 1000, 0.5)], [impulse(4000, 1000, 0.25), impulse(4000, 1000, 1)]]);
  mix.setGains([1, 2]);
  const { L, R } = renderAll(mix, 2048);
  // stem 0 is mono (both channels), stem 1 is stereo; gains ramp in over the first block, so read the settled part
  assert.equal(peakIndex(L), 1000);
  assert.ok(Math.abs(L[1000] - (0.5 + 0.25 * 2)) < 1e-6);
  assert.ok(Math.abs(R[1000] - (0.5 + 1 * 2)) < 1e-6);
});

test('all stems share one clock: three stems equal one stem three times as loud, at any speed', () => {
  for (const rate of [1, 0.5, 0.75, 1.5]) {
    const at = SR;
    const noise = new Float32Array(SR * 4).map((_, i) => Math.sin(i * 0.05) * Math.exp(-((i - at) ** 2) / 1e7) + (i === at ? 1 : 0));
    const triple = new MixStretcher(SR);
    triple.setStems([[noise], [noise], [noise]]);
    triple.setRate(rate);
    const single = new MixStretcher(SR);
    single.setStems([[noise.map((v) => v * 3)]]);
    single.setRate(rate);
    const total = Math.round((SR * 3) / rate);
    const a = renderAll(triple, total).L;
    const b = renderAll(single, total).L;
    let worst = 0;
    for (let i = 0; i < total; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    assert.ok(worst < 1e-3, `rate ${rate}: stems differ by ${worst}`);
  }
});

test('the reported position matches the impulse being heard (stretched and not)', () => {
  for (const rate of [1, 0.5, 0.8, 1.25]) {
    const mix = new MixStretcher(SR);
    const at = SR * 2;
    mix.setStems([[impulse(SR * 6, at)]]);
    mix.setRate(rate);
    const total = Math.round((SR * 5) / rate);
    const { L, positions } = renderAll(mix, total);
    const heard = peakIndex(L); // output frame where the impulse is audible
    const block = Math.floor(heard / 128);
    // position reported after the block that contains the impulse: within that block's span of source frames
    const reported = positions[block];
    const tolerance = SR * 0.04 + 128 * rate; // 40 ms plus one block
    assert.ok(Math.abs(reported - at) < tolerance, `rate ${rate}: reported ${reported} vs impulse at ${at}`);
  }
});

test('seek moves the read position and the audio follows', () => {
  const mix = new MixStretcher(SR);
  mix.setStems([[impulse(SR * 4, SR * 3)]]);
  mix.seek(SR * 2.5);
  const { L } = renderAll(mix, SR);
  assert.equal(peakIndex(L), Math.round(SR * 0.5));
});

test('returning to normal speed continues from the audible position', () => {
  const mix = new MixStretcher(SR);
  mix.setStems([[impulse(SR * 8, SR * 5)]]);
  mix.setRate(0.5);
  renderAll(mix, SR); // 1 s of output = 0.5 s of source
  mix.setRate(1);
  const here = mix.audiblePosition();
  assert.ok(Math.abs(here - SR * 0.5) < SR * 0.06, `audible ${here}`);
  const { L } = renderAll(mix, SR * 5);
  const heard = peakIndex(L);
  assert.ok(Math.abs(heard - (SR * 5 - here)) < 8, `impulse at ${heard}, expected ${SR * 5 - here}`);
});

test('the stream ends with silence', () => {
  const mix = new MixStretcher(SR);
  mix.setStems([[impulse(1000, 10)]]);
  const { L } = renderAll(mix, 3000);
  assert.equal(L[2500], 0);
  assert.ok(mix.ended);
});

test('changing between two stretched speeds does not make the reported position jump', () => {
  const pairs = [[0.5, 2], [0.2, 2], [2, 0.2], [1.5, 0.5], [0.75, 1.25]];
  for (const [from, to] of pairs) {
    const mix = new MixStretcher(SR);
    mix.setStems([[new Float32Array(SR * 60)]]);
    mix.setRate(from);
    renderAll(mix, SR); // settle
    const before = mix.audiblePosition();
    mix.setRate(to);
    const right = mix.audiblePosition();
    assert.ok(Math.abs(right - before) < SR * 0.004, `${from}->${to}: jumped ${(right - before) / SR * 1000} ms`);
    // and it keeps moving forward afterwards
    let last = right;
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    for (let i = 0; i < 400; i++) {
      const pos = mix.render(L, R, 128);
      assert.ok(pos >= last - 1, `${from}->${to}: went backwards at block ${i}`);
      last = pos;
    }
  }
});

test('clock: positions are interpolated from the report history, exactly across speed changes', () => {
  // 1x until t=1 (pos 1), then 0.5x: pos(t) = 1 + (t-1)*0.5 ; reports every 0.1 s of audio time
  const history = [];
  for (let t = 0; t <= 2.0001; t += 0.1) history.push({ time: t, pos: t <= 1 ? t : 1 + (t - 1) * 0.5 });
  const rate = 0.5;
  // asking for a time before the newest report (the sound is behind the render) reads inside the history
  assert.ok(Math.abs(positionAt(history, 0.55, rate) - 0.55) < 1e-9);
  assert.ok(Math.abs(positionAt(history, 1.55, rate) - 1.275) < 1e-9);
  assert.ok(Math.abs(positionAt(history, 1.0, rate) - 1.0) < 1e-9);
  // beyond the newest report it extrapolates with the current speed
  assert.ok(Math.abs(positionAt(history, 2.2, rate) - 1.6) < 1e-6);
  // before the oldest report, backwards at the current speed
  assert.ok(Math.abs(positionAt([{ time: 5, pos: 3 }], 4.8, 1) - 2.8) < 1e-9);
  assert.equal(positionAt([], 1, 1), 0);
  trimHistory(history, 0.5);
  assert.ok(history[0].time >= 1.5 - 1e-9 && history.length > 3);
});
