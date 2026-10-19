import test from 'node:test';
import assert from 'node:assert/strict';
import { breAlpha, BRE_ALPHA_MIN, BRE_ALPHA_MAX } from '../src/gfx.js';

test('the BRE pulse stays inside its alpha range and differs between lanes', () => {
  let lo = 1;
  let hi = 0;
  for (let t = 0; t < 20; t += 0.013) {
    for (let lane = 0; lane < 5; lane++) {
      const a = breAlpha(t, lane, 5);
      assert.ok(a >= BRE_ALPHA_MIN - 1e-9 && a <= BRE_ALPHA_MAX + 1e-9);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
  }
  assert.ok(hi - lo > 0.15); // it really moves
  assert.notEqual(breAlpha(1.234, 0, 5), breAlpha(1.234, 3, 5));
});

test('the BRE pulse changes smoothly (no flashes): consecutive frames differ little', () => {
  let worst = 0;
  for (let t = 0; t < 10; t += 1 / 60) for (let lane = 0; lane < 5; lane++) worst = Math.max(worst, Math.abs(breAlpha(t + 1 / 60, lane, 5) - breAlpha(t, lane, 5)));
  assert.ok(worst < 0.03, `step ${worst}`);
});
