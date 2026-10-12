import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPalette, fallbackPalette, beatInfo, beatIndexAt, densityHistogram, densityAt, travelAt, spanAmount,
  buildEvents, spectrumAt, hitLevel, vocalLevel, pulseAfter, hash01, buildSongData, VISUALIZERS,
} from '../src/visualizers.js';

const px = (list) => Uint8ClampedArray.from(list.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
const fill = (n, c) => Array.from({ length: n }, () => c);

test('palette: dominant colour first, a distinct second, accent is the most saturated', () => {
  const p = extractPalette(px([...fill(30, [200, 30, 30]), ...fill(10, [30, 30, 220]), ...fill(20, [90, 90, 90])]));
  assert.ok(p.colors[0][0] > 150 && p.colors[0][2] < 80, 'red dominates');
  assert.ok(p.colors.some((c) => c[2] > 150 && c[0] < 80), 'blue is in the palette');
  assert.equal(p.colors.length, 4);
  assert.ok(p.brightness > 0.2 && p.brightness < 0.6);
  assert.ok(p.v.every((c) => c.length === 3));
});

test('palette: transparent pixels are ignored; an empty image has no palette; a flat cover still gives 4 colours', () => {
  assert.equal(extractPalette(px([[255, 0, 0, 0]])), null);
  const flat = extractPalette(px(fill(50, [10, 120, 200])));
  assert.equal(flat.colors.length, 4);
  assert.notDeepEqual(flat.colors[0], flat.colors[1]);
  assert.equal(fallbackPalette(3).colors.length, 4);
});

test('hash01 is deterministic and in [0, 1)', () => {
  assert.equal(hash01(5, 2), hash01(5, 2));
  assert.notEqual(hash01(5, 2), hash01(6, 2));
  for (let i = 0; i < 200; i++) { const v = hash01(i); assert.ok(v >= 0 && v < 1); }
});

const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((time, i) => ({ time, measure: i % 4 === 0 }));

test('beat lookup and phase', () => {
  assert.equal(beatIndexAt(beats, -1), -1);
  assert.equal(beatIndexAt(beats, 0.5), 1);
  assert.equal(beatIndexAt(beats, 1.74), 3);
  const b = beatInfo(beats, 1.25);
  assert.equal(b.index, 2);
  assert.ok(Math.abs(b.phase - 0.5) < 1e-9);
  assert.ok(Math.abs(b.pos - 2.5) < 1e-9);
  assert.ok(Math.abs(b.bpm - 120) < 1e-9);
  assert.ok(Math.abs(b.pulse - 0.125) < 1e-9);
});

test('beat position continues at the nearest tempo before and after the grid, and follows tempo changes', () => {
  assert.ok(Math.abs(beatInfo(beats, -0.5).pos + 1) < 1e-9);
  assert.ok(Math.abs(beatInfo(beats, 5).pos - 10) < 1e-9);
  const slow = [{ time: 0 }, { time: 1 }, { time: 3 }];
  assert.ok(Math.abs(beatInfo(slow, 2).pos - 1.5) < 1e-9);
  assert.equal(beatInfo([], 1).bpm, 120); // no grid: 120 BPM
});

test('bar phase uses the measure markers', () => {
  const m = beatInfo(beats, 2.5); // beat 5 of a bar that started at beat 4 (t = 2) and ends at beat 8 (t = 4)
  assert.ok(Math.abs(m.measurePhase - 0.25) < 1e-9);
  assert.equal(beatInfo(beats, 2.6).measureBeat, false);
  assert.equal(beatInfo(beats, 2).measureBeat, true);
  assert.ok(beatInfo(beats, 2).measurePulse > 0.99);
});

test('density histogram: notes per second, chords count once, normalised lookup, travel grows', () => {
  const times = [0.1, 0.1, 0.1, 5.1, 5.3, 5.5, 5.7, 5.9, 6.1];
  const d = densityHistogram(times, 10);
  assert.ok(d.bins[5] > d.bins[0], 'busy second beats the sparse one');
  assert.ok(d.bins[0] > 0 && d.bins[0] < 1, 'three notes at one time are one note');
  assert.equal(densityAt(d, 5.5) <= 1, true);
  assert.ok(densityAt(d, 5.5) > densityAt(d, 9));
  assert.equal(densityAt(d, 9.5), 0);
  assert.ok(travelAt(d, 6) > travelAt(d, 3));
  assert.ok(travelAt(d, 6) - travelAt(d, 5) > travelAt(d, 9) - travelAt(d, 8), 'faster through the dense part');
  assert.ok(Math.abs(travelAt(d, -2) + 0.6) < 1e-9);
  assert.ok(travelAt(d, 99) > travelAt(d, 10));
});

test('spans, hits, vocals and percussion pulses', () => {
  const spans = [{ start: 10, end: 20 }];
  assert.equal(spanAmount(spans, 5), 0);
  assert.equal(spanAmount(spans, 15), 1);
  assert.ok(spanAmount(spans, 10.2) > 0 && spanAmount(spans, 10.2) < 1);
  const chart = { mode: 'lanes', lanes: 5, notes: [{ time: 1, end: 1, lane: 0 }, { time: 2, end: 4, lane: 4 }] };
  const ev = buildEvents([chart]);
  assert.equal(ev.count, 2);
  assert.ok(ev.pos[0] < ev.pos[1]);
  assert.ok(hitLevel(ev, 1.01) > hitLevel(ev, 1.2));
  assert.equal(hitLevel(ev, 3), 0);
  const notes = [{ time: 1, end: 2 }, { time: 5, end: 5.5 }];
  assert.equal(vocalLevel(notes, 1.5), 1);
  assert.ok(vocalLevel(notes, 2.2) > 0 && vocalLevel(notes, 2.2) < 1);
  assert.equal(vocalLevel(notes, 4), 0);
  assert.ok(pulseAfter([1, 2], 2.1, 0.25) > pulseAfter([1, 2], 2.5, 0.25));
  assert.equal(pulseAfter([1, 2], 0.5), 0);
});

test('spectrum: a held note lights its bars, an ended one fades', () => {
  const chart = { mode: 'lanes', lanes: 5, notes: [{ time: 1, end: 3, lane: 0 }] };
  const ev = buildEvents([chart]);
  const out = new Float32Array(40);
  spectrumAt(ev, 2, 40, out);
  const held = Math.max(...out);
  assert.ok(held > 0.9);
  assert.ok(out[4] > out[30], 'lane 0 sits at the low end');
  spectrumAt(ev, 3.5, 40, out);
  assert.ok(Math.max(...out) < held);
  spectrumAt(ev, 10, 40, out);
  assert.equal(Math.max(...out), 0);
});

test('song data is built from the charts and the registry has none plus at least five', () => {
  const chart = { mode: 'lanes', lanes: 5, notes: [{ time: 1, end: 1, lane: 0 }, { time: 3, end: 3, lane: 2 }], beats, sections: [{ time: 0, name: 'A' }], starPower: [{ start: 1, end: 2 }], solos: [], duration: 30 };
  const data = buildSongData({ song: { title: 'T', artist: 'A', length: 40 }, charts: [chart] });
  assert.equal(data.duration, 40);
  assert.equal(data.beats.length, beats.length);
  assert.equal(data.starPower.length, 1);
  assert.equal(data.percussion.length, 0);
  assert.equal(data.palette.colors.length, 4);
  assert.equal(VISUALIZERS[0].id, 'none');
  assert.ok(VISUALIZERS.filter((v) => v.create).length >= 5);
  assert.equal(new Set(VISUALIZERS.map((v) => v.id)).size, VISUALIZERS.length);
});
