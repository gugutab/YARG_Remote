import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfMeter } from '../src/perf.js';

function run(meter, dts, draw = 2, start = 0) {
  let t = start;
  meter.frame(t, draw);
  for (const dt of dts) { t += dt; meter.frame(t, draw); }
  return t;
}

test('steady 60 fps', () => {
  const m = new PerfMeter();
  run(m, Array(120).fill(1000 / 60), 3);
  const s = m.stats();
  assert.ok(Math.abs(s.fps - 60) < 1);
  assert.ok(Math.abs(s.avg - 16.667) < 0.1);
  assert.equal(s.dropped, 0);
  assert.equal(s.drawAvg, 3);
});

test('window forgets old frames', () => {
  const m = new PerfMeter();
  const t = run(m, Array(60).fill(100)); // 10 fps for 6 s
  run(m, Array(60).fill(10), 1, t + 10);  // then 100 fps for 0.6 s
  assert.ok(m.stats().fps > 50);
  assert.ok(m.stats().samples <= 70);
});

test('dropped frames: gaps over 1.5x median or 25 ms', () => {
  const m = new PerfMeter();
  run(m, [16, 16, 16, 40, 16, 16, 26, 16]);
  assert.equal(m.stats().dropped, 2);
  assert.equal(m.stats().max, 40);
});

test('p95, draw max', () => {
  const m = new PerfMeter();
  const dts = Array(99).fill(10); dts.push(100);
  run(m, dts, 1);
  assert.equal(m.stats().max, 100);
  assert.equal(m.stats().p95, 10);
});

test('series ring keeps the last 120 in order', () => {
  const m = new PerfMeter();
  run(m, Array.from({ length: 300 }, (_, i) => i + 1));
  const s = m.series();
  assert.equal(s.length, 120);
  assert.equal(s[0], 181);
  assert.equal(s[119], 300);
});

test('empty meter', () => {
  assert.equal(new PerfMeter().stats().fps, 0);
});
