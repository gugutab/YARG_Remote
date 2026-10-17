import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPalette, fallbackPalette, beatInfo, beatIndexAt, densityHistogram, densityAt, travelAt, spanAmount,
  buildEvents, spectrumAt, hitLevel, vocalLevel, pulseAfter, hash01, buildSongData, VISUALIZERS, clothAt, radialLayout, beamAngle, sectionValue,
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

test('cloth: bounded, continuous across the picture, travelling with the beat and song time', () => {
  let prev = clothAt(0, 3, 10);
  for (let i = 1; i <= 100; i++) {
    const c = clothAt(i / 100, 3, 10);
    assert.ok(Math.abs(c.dy) <= 1 && Math.abs(c.slope) <= 1 && Math.abs(c.rx) <= 1 && Math.abs(c.sy - 1) < 0.01);
    assert.ok(Math.abs(c.dy - prev.dy) < 0.2, 'no jumps between neighbouring strips');
    prev = c;
  }
  assert.notEqual(clothAt(0.4, 3, 10).dy, clothAt(0.4, 4, 10).dy);
  assert.equal(clothAt(0.4, 3, 10).dy, clothAt(0.4, 3, 10).dy, 'a pure function of the position and time');
  const a = clothAt(0.3, 5, 1).dy;
  const b = clothAt(0.3 + 1e-4, 5, 1).dy;
  assert.ok(Math.sign((b - a) * 1e4) === Math.sign(clothAt(0.3, 5, 1).slope), 'the slope matches the wave');
});

test('radial layout: mirrored bars, top to bottom on each side, every bin used twice', () => {
  const m = 10;
  const { angle, bin } = radialLayout(m);
  assert.equal(angle.length, 2 * m);
  for (let k = 0; k < m; k++) {
    assert.equal(bin[k], k);
    assert.equal(bin[2 * m - 1 - k], k);
    assert.ok(Math.abs(angle[k] + Math.PI / 2 + (angle[2 * m - 1 - k] + Math.PI / 2)) < 1e-6, 'left mirrors right around the top');
    assert.ok(Math.cos(angle[k]) > 0 && Math.cos(angle[2 * m - 1 - k]) > 0 === false);
  }
  assert.ok(angle[0] < angle[m - 1], 'the right side runs clockwise');
});

test('spotlights sweep with the beat position, each on its own period, and stay inside the stage', () => {
  for (let i = 0; i < 6; i++) {
    for (let pos = 0; pos < 64; pos += 0.5) assert.ok(Math.abs(beamAngle(i, 6, pos)) < 0.9);
  }
  assert.notEqual(beamAngle(0, 5, 3), beamAngle(1, 5, 3));
  assert.equal(beamAngle(2, 5, 7), beamAngle(2, 5, 7));
  assert.ok(Math.abs(beamAngle(0, 5, 0) - beamAngle(0, 5, 16)) < 1e-9, 'beam 0 repeats every 16 beats');
});

test('sectionValue eases from the previous section value to the new one', () => {
  const secs = [{ time: 0 }, { time: 10 }, { time: 20 }];
  const fn = (k) => k * 10;
  assert.equal(sectionValue(secs, 5, 0, fn), 0);
  assert.equal(sectionValue(secs, 10, 1, fn), 0);
  assert.equal(sectionValue(secs, 11, 1, fn), 5);
  assert.equal(sectionValue(secs, 15, 1, fn), 10);
  assert.equal(sectionValue([], 3, 0, fn), 0);
});

test('the registry has the new effects with a swatch and a hint', () => {
  for (const id of ['radial', 'spotlights', 'tunnel']) {
    const v = VISUALIZERS.find((x) => x.id === id);
    assert.ok(v && v.create && v.swatch && v.hint && v.label);
  }
});

test('buildSongData builds one layer of events per instrument, with its kind', async () => {
  const { buildSongData, layerColor, INSTRUMENT_COLORS } = await import('../src/visualizers.js');
  const mk = (times, lanes = 5) => ({ mode: 'lanes', lanes, notes: times.map((t) => ({ time: t, end: t, lane: 2 })), beats: [], sections: [], duration: 10 });
  const data = buildSongData({ song: { title: 'T' }, charts: [mk([1, 2, 3]), mk([1.5])], kinds: ['guitar', 'drum'] });
  assert.equal(data.layers.length, 2);
  assert.deepEqual(data.layers.map((l) => l.kind), ['guitar', 'drum']);
  assert.deepEqual(data.layers.map((l) => l.events.count), [3, 1]);
  assert.equal(data.events.count, 4); // the merged events stay for the other visualizers
  assert.deepEqual(layerColor('guitar', 0), INSTRUMENT_COLORS.guitar);
  assert.equal(layerColor('mystery', 1, { v: [[1, 2, 3], [4, 5, 6]] })[0], 4); // an unknown instrument takes a colour from the palette
});

test('buildEvents: vocal charts count their harmony notes, and shared charts use the whole range', async () => {
  const { buildEvents, buildSongData } = await import('../src/visualizers.js');
  const vocals = { mode: 'vocals', notes: [{ time: 1, end: 2, pitch: 60 }], harmonies: [{ part: 2, notes: [{ time: 1, end: 2, pitch: 70 }, { time: 3, end: 4, pitch: 50 }] }], duration: 10 };
  const guitar = { mode: 'lanes', lanes: 5, notes: [{ time: 1, end: 1, lane: 4 }], duration: 10 };
  assert.equal(buildEvents([vocals]).count, 3); // the lead and the two harmony notes
  const apart = buildEvents([guitar, vocals]);
  const shared = buildEvents([guitar, vocals], { shared: true });
  assert.ok(Math.max(...apart.pos.slice(0, 1)) <= 1 && Math.min(...apart.pos) >= 0);
  assert.ok(shared.pos[shared.count - 1] >= 0 && Math.max(...shared.pos) <= 1);
  const data = buildSongData({ song: {}, charts: [guitar, vocals], kinds: ['guitar', 'mic'], layerCharts: [[guitar], [vocals]], shown: [false, true] });
  assert.deepEqual(data.layers.map((l) => [l.kind, l.shown, l.events.count]), [['guitar', false, 1], ['mic', true, 3]]);
});
