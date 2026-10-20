// Note palettes (src/palette.js): resolution of the presets and of the custom lanes, the in-place refill the charts rely on, and that
// the colour-blind preset keeps its five lanes apart under simulated colour vision deficiencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, resolvePalette, applyPalette, NOTE_PALETTE, cleanLaneColors, DEFAULT_LANE_COLORS } from '../src/palette.js';
import { GUITAR_LANE_COLORS, KICK_COLOR, KICK_COLOR_5, OPEN_COLOR, TAP_COLOR } from '../src/gfx.js';
import { EXTENDED_DRUM_LANES } from '../src/chart.js';
import { buildValidator } from '../src/settings-schema.js';

test('palette: YARG (the default) is exactly the colours the renderers had before', () => {
  const p = resolvePalette('yarg');
  assert.deepEqual(p.lanes, GUITAR_LANE_COLORS);
  assert.deepEqual([p.kick, p.kick5, p.open, p.tap], [KICK_COLOR, KICK_COLOR_5, OPEN_COLOR, TAP_COLOR]);
  assert.deepEqual(p.drums4, ['#ff1d23', '#ffe900', '#00bfff', '#79d304']);
  assert.deepEqual(p.drums5, ['#ff1d23', '#ffe900', '#00bfff', '#ff8400', '#79d304']);
  assert.deepEqual(p.extended, EXTENDED_DRUM_LANES.map((l) => l.color));
  assert.deepEqual(NOTE_PALETTE, p, 'the live palette starts as YARG');
  assert.deepEqual(resolvePalette('nope'), p, 'an unknown id falls back to YARG');
});

test('palette: every preset is complete and valid; drum lanes follow the guitar lanes', () => {
  for (const { id } of PALETTES) {
    const p = resolvePalette(id, ['#111111', '#222222', '#333333', '#444444', '#555555']);
    for (const c of [...p.lanes, ...p.drums4, ...p.drums5, ...p.extended, p.kick, p.kick5, p.open, p.tap]) assert.match(c, /^#[0-9a-f]{6}$/, `${id}: ${c}`);
    const [g, r, y, b, o] = p.lanes;
    assert.deepEqual(p.drums4, [r, y, b, g], id);
    assert.deepEqual(p.drums5, [r, y, b, o, g], id);
    assert.equal(p.extended.length, 7, id);
    assert.deepEqual([p.extended[0], p.extended[1], p.extended[3], p.extended[5]], [r, y, b, g], `${id}: the toms`);
  }
});

test('palette: custom uses the user\'s five lanes (kick = orange lane), invalid ones fall back to YARG', () => {
  const mine = ['#AA0000', '#00aa00', '#0000aa', '#aaaa00', '#00aaaa'];
  const p = resolvePalette('custom', mine);
  assert.deepEqual(p.lanes, mine.map((c) => c.toLowerCase()));
  assert.equal(p.kick, '#00aaaa');
  assert.equal(p.open, OPEN_COLOR);
  for (const bad of [null, [], ['#000000'], [...mine, '#ffffff'], ['red', '#00aa00', '#0000aa', '#aaaa00', '#00aaaa'], 'x']) {
    assert.equal(cleanLaneColors(bad), null);
    assert.deepEqual(resolvePalette('custom', bad).lanes, DEFAULT_LANE_COLORS);
  }
});

test('palette: applyPalette refills the arrays in place (charts hold them) and back', () => {
  const lanes = NOTE_PALETTE.lanes;
  const drums4 = NOTE_PALETTE.drums4;
  try {
    applyPalette(resolvePalette('colorblind'));
    assert.equal(NOTE_PALETTE.lanes, lanes);
    assert.equal(NOTE_PALETTE.drums4, drums4);
    assert.deepEqual(lanes, PALETTES.find((x) => x.id === 'colorblind').lanes);
    assert.equal(NOTE_PALETTE.kick, resolvePalette('colorblind').kick);
  } finally {
    applyPalette(resolvePalette('yarg'));
  }
  assert.deepEqual(NOTE_PALETTE, resolvePalette('yarg'));
});

test('palette: settings validation of highway.palette and highway.laneColors', () => {
  const v = buildValidator();
  assert.deepEqual(v('highway.palette', 'colorblind'), { ok: true, value: 'colorblind' });
  assert.equal(v('highway.palette', 'pink').ok, false);
  assert.deepEqual(v('highway.laneColors', ['#FFFFFF', '#000000', '#123456', '#abcdef', '#00ff00']), { ok: true, value: ['#ffffff', '#000000', '#123456', '#abcdef', '#00ff00'] });
  for (const bad of [{}, ['#fff', '#000000', '#123456', '#abcdef', '#00ff00'], ['#ffffff'], 'red']) assert.equal(v('highway.laneColors', bad).ok, false);
});

// ---- Colour vision deficiency simulation: Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear RGB. ----
const MACHADO = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const toLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const linearRgb = (hex) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16)));
const simulate = (m, c) => m.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])));
function lab([r, g, b]) { // linear sRGB -> CIELAB (D65)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); // CIE76
function minPairDistance(lanes, matrix) {
  const L = lanes.map((h) => lab(matrix ? simulate(matrix, linearRgb(h)) : linearRgb(h)));
  let min = Infinity;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) min = Math.min(min, deltaE(L[i], L[j]));
  return min;
}

test('palette: the colour-blind preset keeps every pair of lanes apart under deuteranopia, protanopia and tritanopia', () => {
  const lanes = resolvePalette('colorblind').lanes;
  const MIN = 25; // CIE76 units; YARG's own lanes fall to about 7 (green / orange) under deuteranopia
  assert.ok(minPairDistance(lanes) >= MIN, 'normal vision');
  for (const [name, m] of Object.entries(MACHADO)) {
    const d = minPairDistance(lanes, m);
    assert.ok(d >= MIN, `${name}: closest pair of lanes is ${d.toFixed(1)} apart`);
  }
  assert.ok(minPairDistance(resolvePalette('yarg').lanes, MACHADO.deuteranopia) < MIN, 'the check does separate a palette that is not safe');
  // the lanes stay readable on the dark track: no lane darker than L* 45
  for (const c of lanes) assert.ok(lab(linearRgb(c))[0] >= 45, `${c} is too dark for the track`);
});
