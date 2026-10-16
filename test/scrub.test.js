import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAIN, HOP, grainStart, hann, grainsAt, easeOutCubic } from '../src/scrub.js';

test('overlapping Hann grains sum to one once two are running', () => {
  for (const e of [HOP, HOP + 100, 5 * HOP + 7, 40 * HOP + 513]) {
    const w = grainsAt(0, 1e6, 1e6, e).reduce((a, g) => a + g.w, 0);
    assert.ok(Math.abs(w - 1) < 1e-9, `e=${e} w=${w}`);
  }
});

test('the first grain ramps up from silence', () => {
  const g = grainsAt(0, 1e6, 1e6, 0);
  assert.equal(g.length, 1);
  assert.equal(g[0].w, 0);
  assert.ok(hann(GRAIN / 2) > 0.999);
});

test('grain sources follow the ease-out path from the start to the target', () => {
  const dur = 30000;
  assert.equal(grainStart(1000, 9000, dur, 0), 1000);
  assert.ok(Math.abs(grainStart(1000, 9000, dur, Math.floor(dur / HOP)) - 9000) < 8000 * 0.05); // near the end it has almost arrived
  const a = grainStart(0, 1e6, dur, 5) - grainStart(0, 1e6, dur, 4);
  const b = grainStart(0, 1e6, dur, 25) - grainStart(0, 1e6, dur, 24);
  assert.ok(a > b, 'it moves fastest at the start and slows down');
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(2), 1); // clamped
});

test('it also works backwards (a rewind)', () => {
  assert.ok(grainStart(900000, 1000, 20000, 3) < 900000);
});

// The original allocating implementation, kept as the reference for the scalar forms the worklet uses.
function grainsAtReference(from, to, dur, e) {
  const k1 = Math.floor(e / HOP);
  const out = [];
  for (const k of [k1, k1 - 1]) {
    if (k < 0) continue;
    const x = e - k * HOP;
    if (x >= GRAIN) continue;
    out.push({ src: grainStart(from, to, dur, k) + x, w: hann(x) });
  }
  return out;
}

test('grainsAt and the scalar forms match the original implementation over many positions', async () => {
  const { grainSrcAt, grainWeightAt } = await import('../src/scrub.js');
  const cases = [[0, 1e6, 22050], [900000, 1000, 20000], [5000, 5000, 1], [123456, 654321, 30000]];
  for (const [from, to, dur] of cases) {
    for (let e = 0; e < dur + 5000; e += 37) {
      const ref = grainsAtReference(from, to, dur, e);
      assert.deepEqual(grainsAt(from, to, dur, e), ref);
      const scalar = [];
      for (let pass = 0; pass < 2; pass++) {
        const src = grainSrcAt(from, to, dur, e, pass);
        if (src === src) scalar.push({ src, w: grainWeightAt(e, pass) });
      }
      assert.deepEqual(scalar, ref);
    }
  }
});
