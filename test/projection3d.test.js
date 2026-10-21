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
