// Note colours (setting highway.palette): the five lane colours and the kick, open and tap colours, as presets or the user's own
// five lanes. Pure data plus one mutable object, NOTE_PALETTE, that the charts and the renderers read at draw time: applyPalette()
// changes its arrays in place, so a chart built earlier (its laneColors is one of these arrays) follows a palette change without
// being rebuilt. Star power, solo, fill and roll colours are not part of a palette.

const YARG_LANES = ['#79d304', '#ff1d23', '#ffe900', '#00bfff', '#ff8400']; // green, red, yellow, blue, orange (YARG.Core ColorProfile.Defaults.cs)
// Extended Pro drums (chart.js EXTENDED_DRUM_LANES): red, yellow tom, yellow cymbal, blue tom, blue cymbal, green tom, green cymbal.
const YARG_EXTENDED = ['#ff1d23', '#ffe900', '#ffd010', '#00bfff', '#2090ff', '#79d304', '#a0d010'];

export const PALETTES = [
  { id: 'yarg', label: 'YARG (default)', lanes: YARG_LANES, kick: '#ff8400', kick5: '#e63fff', open: '#c800ff', tap: '#b25cff', extended: YARG_EXTENDED },
  // After Okabe & Ito's colour-blind safe set, tuned so the five lanes stay apart under deuteranopia, protanopia and tritanopia
  // (test/palette.test.js simulates them) while keeping the green / red / yellow / blue / orange order of the frets.
  { id: 'colorblind', label: 'Colour-blind safe', lanes: ['#00c08b', '#c43c3c', '#ffe600', '#3a6fe8', '#d98a00'], kick: '#d98a00', kick5: '#cc79a7', open: '#cc79a7', tap: '#e5a8d0' },
  // Fully saturated and bright: the most separation from the dark track and from each other.
  { id: 'contrast', label: 'High contrast', lanes: ['#33ff00', '#ff0033', '#ffff00', '#00ccff', '#ff8800'], kick: '#ff8800', kick5: '#ff33ff', open: '#e033ff', tap: '#cc80ff' },
  { id: 'custom', label: 'Custom' },
];
export const DEFAULT_LANE_COLORS = YARG_LANES;
export const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// The user's five lane colours (highway.laneColors) cleaned: an array of exactly five #rrggbb (lower case), or null.
export function cleanLaneColors(v) {
  if (!Array.isArray(v) || v.length !== 5 || !v.every(isHexColor)) return null;
  return v.map((c) => c.toLowerCase());
}

const mix = (a, b, k) => {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};

// The full palette for a preset id (unknown: YARG) and, for 'custom', the user's five lanes (invalid: YARG's). The lanes are in
// guitar order (green, red, yellow, blue, orange); drums4 / drums5 / extended are the drum lanes in their own order.
export function resolvePalette(id, custom) {
  let p = PALETTES.find((x) => x.id === id && x.lanes) ?? PALETTES[0];
  if (id === 'custom') {
    const lanes = cleanLaneColors(custom) ?? YARG_LANES;
    p = { ...PALETTES[0], lanes, kick: lanes[4], extended: null }; // the 4-lane kick is the orange lane's colour, as in YARG
  }
  const [g, r, y, b, o] = p.lanes;
  return {
    lanes: [...p.lanes], kick: p.kick, kick5: p.kick5, open: p.open, tap: p.tap,
    drums4: [r, y, b, g],
    drums5: [r, y, b, o, g],
    extended: p.extended ? [...p.extended] : [r, y, mix(y, '#ffffff', 0.3), b, mix(b, '#ffffff', 0.3), g, mix(g, '#ffffff', 0.3)], // a cymbal is its tom's colour, lighter
  };
}

// What the drawing code reads. Arrays keep their identity (charts hold them); applyPalette refills them.
export const NOTE_PALETTE = resolvePalette('yarg');

export function applyPalette(resolved) {
  for (const k of ['lanes', 'drums4', 'drums5', 'extended']) NOTE_PALETTE[k].splice(0, NOTE_PALETTE[k].length, ...resolved[k]);
  for (const k of ['kick', 'kick5', 'open', 'tap']) NOTE_PALETTE[k] = resolved[k];
}
