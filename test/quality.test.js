import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameCap, resolveDpr, createAdaptive, adaptiveEffects, adaptiveBudget, ADAPTIVE_MAX } from '../src/quality.js';

// Draws per second of a frame cap over `seconds` of display ticks at `hz`, with optional +-jitter (ms, deterministic).
function drawsPerSecond(cap, hz, seconds = 10, jitter = 0) {
  const fc = createFrameCap();
  fc.set(cap);
  const period = 1000 / hz;
  let n = 0;
  const ticks = Math.round(seconds * hz);
  for (let i = 0; i < ticks; i++) {
    const j = jitter ? Math.sin(i * 12.9898) * jitter : 0;
    if (fc.ready(1000 + i * period + j)) n++;
  }
  return n / seconds;
}

test('frame cap: Auto draws every display frame', () => {
  assert.equal(drawsPerSecond(0, 60), 60);
  assert.equal(drawsPerSecond('auto', 144), 144);
});

test('frame cap: averages the cap on displays it does not divide, tolerating jitter', () => {
  for (const [cap, hz] of [[30, 60], [45, 60], [60, 60], [30, 120], [45, 120], [60, 120], [90, 120], [60, 144], [30, 144], [45, 90]]) {
    for (const jitter of [0, 1.2]) {
      const fps = drawsPerSecond(cap, hz, 20, jitter);
      assert.ok(Math.abs(fps - cap) <= 1, `${cap} on ${hz} Hz (jitter ${jitter}): ${fps}`);
    }
  }
});

test('frame cap: a cap above the display rate draws every frame; a long gap draws at once without a burst', () => {
  assert.equal(drawsPerSecond(90, 60), 60);
  const fc = createFrameCap();
  fc.set(30);
  assert.equal(fc.ready(0), true);
  assert.equal(fc.ready(16.7), false);
  assert.equal(fc.ready(1000), true); // after an idle second
  assert.equal(fc.ready(1016.7), false); // no catch-up
  assert.equal(fc.ready(1033.4), true);
});

test('resolveDpr: Auto keeps the old min(dpr, 2); fixed choices cap it; economy and the adaptive cap only lower it', () => {
  for (const d of [1, 1.25, 1.5, 2, 3]) assert.equal(resolveDpr({ device: d }), Math.min(d, 2));
  assert.equal(resolveDpr({ device: 3, scale: 'high' }), 2);
  assert.equal(resolveDpr({ device: 3, scale: 'medium' }), 1.5);
  assert.equal(resolveDpr({ device: 3, scale: 'low' }), 1);
  assert.equal(resolveDpr({ device: 1, scale: 'medium' }), 1);
  assert.equal(resolveDpr({ device: 2, economy: true }), 1.5);
  assert.equal(resolveDpr({ device: 3, scale: 'low', economy: true }), 0.75);
  assert.equal(resolveDpr({ device: 3, adaptiveCap: 1.5 }), 1.5);
  assert.equal(resolveDpr({ device: 3, scale: 'low', adaptiveCap: 1.5 }), 1); // never above the user's choice
  assert.equal(resolveDpr({ device: 1, adaptiveCap: 1.5 }), 1);
  assert.equal(resolveDpr({ device: NaN }), 1);
  assert.equal(resolveDpr({ device: 2, scale: 'bogus' }), 2);
});

test('adaptiveEffects: each level keeps the cuts of the ones before', () => {
  assert.deepEqual(adaptiveEffects(0), { blurMax: Infinity, vizFactor: 1, dprCap: Infinity, vizOff: false, wavePoints: 5 });
  assert.equal(adaptiveEffects(1).blurMax, 3);
  assert.equal(adaptiveEffects(1).wavePoints, 3);
  assert.equal(adaptiveEffects(2).vizFactor, 0.5);
  assert.equal(adaptiveEffects(3).dprCap, 1.5);
  assert.equal(adaptiveEffects(4).dprCap, 1);
  assert.deepEqual(adaptiveEffects(ADAPTIVE_MAX), { blurMax: 3, vizFactor: 0.5, dprCap: 1, vizOff: true, wavePoints: 3 });
  assert.equal(adaptiveBudget(0), 1000 / 60);
  assert.equal(adaptiveBudget(30), 1000 / 30);
  assert.equal(adaptiveBudget(90), 1000 / 60); // never chases more than 60 fps
});

// Runs the controller for `seconds`; `frame(level, t)` gives { interval, work } of the next frame (ms). Returns the level history.
function run(ctl, seconds, frame, { budget = 1000 / 60, start = 0, skip } = {}) {
  let t = start;
  const changes = [];
  while (t < start + seconds * 1000) {
    const { interval, work = 4 } = frame(ctl.level, t);
    t += interval;
    if (skip?.(t)) { ctl.quiet(t); continue; }
    const before = ctl.level;
    if (ctl.feed(t, interval, work, budget) !== before) changes.push({ t, level: ctl.level });
  }
  return { changes, end: t };
}

test('adaptive: a steady 60 fps never changes anything', () => {
  const ctl = createAdaptive();
  const { changes } = run(ctl, 120, (_, t) => ({ interval: 1000 / 60 + Math.sin(t) * 0.8, work: 6 }));
  assert.deepEqual(changes, []);
  assert.equal(ctl.level, 0);
});

test('adaptive: also nothing at 144 Hz, nor at a 30 fps cap that holds', () => {
  const a = createAdaptive();
  assert.deepEqual(run(a, 60, () => ({ interval: 1000 / 144, work: 3 })).changes, []);
  const b = createAdaptive();
  assert.deepEqual(run(b, 60, () => ({ interval: 1000 / 30, work: 9 }), { budget: adaptiveBudget(30) }).changes, []);
});

test('adaptive: sustained 40 ms frames step down one level at a time, after 2-3 s each', () => {
  const ctl = createAdaptive();
  const { changes } = run(ctl, 12, () => ({ interval: 40, work: 30 }));
  assert.ok(changes.length >= 2, JSON.stringify(changes));
  assert.ok(changes[0].t >= 2500 && changes[0].t <= 3500, `first step at ${changes[0].t}`);
  changes.forEach((c, i) => assert.equal(c.level, i + 1));
  for (let i = 1; i < changes.length; i++) assert.ok(changes[i].t - changes[i - 1].t >= 3000, 'dwell between steps');
  run(ctl, 60, () => ({ interval: 40, work: 30 }), { start: 12000 });
  assert.equal(ctl.level, ADAPTIVE_MAX); // and it stops at the last level
});

test('adaptive: a short slow burst (under 2.5 s) does not step down', () => {
  const ctl = createAdaptive();
  const { changes } = run(ctl, 30, (_, t) => ({ interval: (t % 10000) < 2000 ? 40 : 1000 / 60, work: 5 }));
  assert.deepEqual(changes, []);
});

test('adaptive: steps back up after about 10 s of headroom once the frames recover', () => {
  const ctl = createAdaptive();
  const slow = run(ctl, 8, () => ({ interval: 40, work: 30 }));
  const lvl = ctl.level;
  assert.ok(lvl >= 1);
  const { changes } = run(ctl, 60, () => ({ interval: 1000 / 60, work: 4 }), { start: slow.end });
  assert.ok(changes.length >= 1);
  assert.equal(changes[0].level, lvl - 1);
  const wait = changes[0].t - slow.end;
  assert.ok(wait >= 10000 && wait <= 12500, `first step up after ${wait} ms`);
});

test('adaptive: frames at the budget but heavy drawing (no headroom) do not step up', () => {
  const ctl = createAdaptive();
  const slow = run(ctl, 5, () => ({ interval: 40, work: 30 }));
  const lvl = ctl.level;
  run(ctl, 60, () => ({ interval: 1000 / 60, work: 14 }), { start: slow.end });
  assert.equal(ctl.level, lvl);
});

test('adaptive: no oscillation when only the lower level holds the target', () => {
  const ctl = createAdaptive();
  // level 0 is too heavy for this device; level 1 holds 60 fps with headroom (so the controller will try going back up)
  const { changes } = run(ctl, 300, (level) => (level === 0 ? { interval: 40, work: 30 } : { interval: 1000 / 60, work: 5 }));
  const ups = changes.filter((c, i) => i > 0 && c.level < changes[i - 1].level);
  assert.ok(ups.length <= 2, `${ups.length} step ups in 5 minutes: ${JSON.stringify(changes)}`);
  for (let i = 1; i < ups.length; i++) assert.ok(ups[i].t - ups[i - 1].t >= 40000, 'each retry waits much longer');
  assert.ok(changes.every((c) => c.level <= 1), 'never goes past the level that holds');
});

test('adaptive: ignores outlier frames over 250 ms', () => {
  const ctl = createAdaptive();
  const { changes } = run(ctl, 60, (_, t) => ({ interval: Math.floor(t / 16.67) % 30 === 0 ? 400 : 1000 / 60, work: 5 }));
  assert.deepEqual(changes, []);
});

test('adaptive: ignores frames while quiet (hidden, paused, idle, after a seek or a resize)', () => {
  const ctl = createAdaptive();
  // slow frames, but the app calls quiet() every frame (paused / hidden): nothing changes
  const { changes } = run(ctl, 30, () => ({ interval: 40, work: 30 }), { skip: () => true });
  assert.deepEqual(changes, []);
  // after quiet, the first second is ignored, then the 2.5 s window starts
  ctl.quiet(100000);
  const r = run(ctl, 5, () => ({ interval: 40, work: 30 }), { start: 100000 });
  assert.equal(r.changes.length, 1);
  assert.ok(r.changes[0].t >= 100000 + 1000 + 2500, `stepped at ${r.changes[0].t}`);
  // a gap in the frames (a pause) restarts the averages: two slow 2 s stretches with a gap never add up
  const g = createAdaptive();
  const a = run(g, 2, () => ({ interval: 40, work: 30 }));
  const b = run(g, 2, () => ({ interval: 40, work: 30 }), { start: a.end + 5000 });
  assert.deepEqual([...a.changes, ...b.changes], []);
});
