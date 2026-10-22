import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projection3D } from '../src/highway3d.js';

const H = 760, HIT = 700;
const yOf = (p, d) => p.vy + (HIT - p.vy) / (1 + p.k * d) + (d > 0 ? p.c * d * d : 0);

test('perspective 100 is the classic projection (far scale 0.3)', () => {
  const p = projection3D(H, HIT, 1, 0);
  assert.equal(p.k, 1 / 0.3 - 1);
  assert.equal(p.vy, (H * 0.05 - 0.3 * HIT) / (1 - 0.3));
  assert.equal(p.c, 0);
  assert.equal(p.end, 1.8);
  assert.deepEqual(projection3D(H, HIT), p); // (the defaults)
});

test('every strength keeps the hit line and the far edge in place; stronger shrinks the far end more', () => {
  let lastK = 0;
  for (const s of [0.6, 1, 1.2, 1.6]) {
    const p = projection3D(H, HIT, s, 0);
    assert.ok(Math.abs(yOf(p, 0) - HIT) < 1e-9);
    assert.ok(Math.abs(yOf(p, 1) - H * 0.05) < 1e-9);
    assert.ok(p.k > lastK);
    lastK = p.k;
  }
});

test('curve 0 is the flat road; a curve moves only depths past the hit line, down, and y still falls with depth', () => {
  for (const s of [0.6, 1, 1.2, 1.6]) {
    const flat = projection3D(H, HIT, s, 0);
    assert.deepEqual(projection3D(H, HIT, s, 0), { ...flat });
    for (const c of [0.25, 0.5, 1]) {
      const p = projection3D(H, HIT, s, c);
      assert.equal(p.k, flat.k);
      assert.equal(p.vy, flat.vy);
      assert.ok(p.c > 0);
      assert.equal(yOf(p, 0), HIT);
      assert.equal(yOf(p, -0.1), yOf(flat, -0.1));
      assert.ok(p.end > 1 && p.end <= 1.8);
      let last = Infinity;
      for (let d = -0.14; d <= p.end; d += 0.01) {
        const y = yOf(p, d);
        assert.ok(y < last, `y falls with depth (s ${s}, c ${c}, d ${d})`);
        if (d > 0) assert.ok(y > yOf(flat, d));
        last = y;
      }
      assert.ok(yOf(p, 1) > 0 && yOf(p, 1) < HIT); // the far edge stays inside the pane
    }
  }
});

test('flow tails: few segments, more for long or curved tails, at most 6', async () => {
  const { tailSegments } = await import('../src/highway3d.js');
  assert.equal(tailSegments(0.5, false), 1);
  assert.equal(tailSegments(60, false), 1);
  assert.equal(tailSegments(60, true), 2);
  assert.equal(tailSegments(250, false), 3);
  assert.equal(tailSegments(5000, true), 6);
  for (let px = 1; px < 2000; px += 37) assert.ok(tailSegments(px, false) <= tailSegments(px + 37, false));
});

test('flow chevrons: periodic, deterministic and running towards the hit line', async () => {
  const { flowPhase, flowPulseAt, FLOW_PERIOD, FLOW_SPACING } = await import('../src/highway3d.js');
  for (const t of [0, 0.01, 1.234, 57.9, 356.02]) {
    assert.ok(flowPhase(t) >= 0 && flowPhase(t) < 1);
    assert.ok(Math.abs(flowPhase(t + FLOW_PERIOD) - flowPhase(t)) < 1e-9 || Math.abs(Math.abs(flowPhase(t + FLOW_PERIOD) - flowPhase(t)) - 1) < 1e-9);
    assert.equal(flowPulseAt(2, t), flowPulseAt(2, t)); // a pure function of the time
    const dt = FLOW_PERIOD / 50;
    if (flowPhase(t) + dt / FLOW_PERIOD < 1) assert.ok(flowPulseAt(0, t + dt) > flowPulseAt(0, t)); // runs up the tail, away from the hit line
    // one period later chevron k + 1 stands where chevron k was
    assert.ok(Math.abs(flowPulseAt(1, t + FLOW_PERIOD) - flowPulseAt(1, t)) < 1e-9);
    assert.ok(Math.abs(flowPulseAt(1, t) - flowPulseAt(0, t) - FLOW_SPACING) < 1e-9);
  }
});

test('waveSegments: about 5 points per wave, fewer on a short or economical tail, never fewer than the plain taper', async () => {
  const { waveSegments, tailSegments, WAVE_LEN } = await import('../src/highway3d.js');
  assert.equal(waveSegments(600, false, WAVE_LEN * 2), 10); // two waves, 5 points each
  assert.equal(waveSegments(600, false, WAVE_LEN * 2, 3), 6);
  assert.equal(waveSegments(6000, false, WAVE_LEN * 20), 30); // capped
  assert.equal(waveSegments(30, false, WAVE_LEN * 4), 10); // 30 px on screen: one point per 3 px
  for (let px = 1; px < 600; px += 17) assert.ok(waveSegments(px, true, 2) >= tailSegments(px, true));
});
