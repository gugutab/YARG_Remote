// Drawing constants and helpers shared by the 2D and 3D highway renderers.
export const GUITAR_LANE_COLORS = ['#79d304', '#ff1d23', '#ffe900', '#00bfff', '#ff8400']; // YARG.Core ColorProfile.Defaults.cs
export const KICK_COLOR = '#ff8400'; // YARG's 4-lane kick (the 5-lane one is KICK_COLOR_5)
export const KICK_COLOR_5 = '#e63fff'; // YARG's 5-lane kick (purple)
export const STAR_POWER_GOLD = '#ffd700'; // the metal of a star power note in YARG
export const STAR_POWER_BAND = 'rgba(255,176,0,0.13)'; // the track under a star power phrase (YARG: gold-orange overlay)
export const SOLO_BAND = 'rgba(0,150,220,0.12)'; // ...and a solo (YARG: cyan-blue overlay)
export const OPEN_COLOR = '#c800ff'; // YARG's open-note purple
export const STAR_POWER_NOTE = '#ffffff'; // YARG draws notes inside a star power phrase in the star power colour
export const HARMONY_COLORS = { 1: '#00ccff', 2: '#ff8500', 3: '#ffdb00' }; // YARG's harmony parts: cyan, orange, yellow // harmony parts 1..3, behind the lead
export const KICK_BAR_HALF_H = 6; // pedal bar is 12 px tall at rest
export const DOUBLE_KICK_GAP = 4; // px between the two bars of a double kick
export const TAP_COLOR = '#b25cff';
export const ACCENT_OUTLINE_WIDTH = 4;
export const ACCENT_OUTLINE_DARKEN = 0.55; // multiplier applied to the note colour for the accent outline
export const GHOST_ALPHA = 0.65;
export const DISABLED_FILTER = 'saturate(0.06)'; // canvas filter of the disabled notes (a replayed stretch, what follows a loop): almost no colour
export const ROLL_COLORS = {
  kick: 'rgba(242,134,30,0.14)',
  tremolo: 'rgba(63,191,63,0.14)',
  trill: 'rgba(245,197,24,0.14)',
};
// Drum fill (activation phrase) and big rock ending bands, one colour per chart.fills kind; kept faint under the notes.
export const FILL_COLORS = {
  fill: 'rgba(40,200,90,0.13)', // YARG draws the drum fill overlay in green
  bre: 'rgba(255,80,80,0.15)',
};
export const FADE_SEC = 0.25; // how long a note takes to fade out after the hit line
export const BASE_LOOKAHEAD_SEC = 2.5; // time from the top edge to the hit line at neck speed 1
// The fretboards scroll at a fixed speed in pixels, like the vocal view: a taller window shows more lookahead instead of stretching the same
// time. The reference is a 700 px tall window (what BASE_LOOKAHEAD_SEC and the 3D depth were tuned for); the factor is clamped so a very short
// window (a phone) still shows about a second of music and a very tall one does not show more than 2.5x.
export const LANE_REF_H = 700;
export const laneLookFactor = (h) => Math.min(2.5, Math.max(0.5, h / LANE_REF_H));
export const ENTRY_MARGIN_SEC = 0.3; // extra window above the top edge, so notes are already moving when they enter
export const HIT_Y = 0.93; // hit line position as a fraction of canvas height

// First note that can still be drawn at time t. Heads stay for FADE_SEC after they pass the hit line,
// and a sustain stays until its end, so look back by the longest sustain in the chart.
// Notes must be sorted by time.
export function firstVisibleIndex(notes, t, maxLength) {
  return firstIndexAtOrAfter(notes, t - FADE_SEC - maxLength);
}

export function firstIndexAtOrAfter(notes, time) {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < time) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Colour strings are cached per colour and quantised amount: they were rebuilt for every note on every frame, and that garbage was
// one of the things behind micro-stutters. The steps are fine enough to be invisible.
const colorCache = [new Map(), new Map(), new Map()];
function cachedColor(kind, hex, amount, steps, build) {
  let row = colorCache[kind].get(hex);
  if (!row) { row = []; colorCache[kind].set(hex, row); }
  const q = Math.round(Math.min(1, Math.max(0, amount)) * steps);
  return row[q] ?? (row[q] = build(hex, q / steps));
}
// (the builders are module functions: an arrow written inside tintWhite/darken/withAlpha was a new closure on every call)
const buildTint = (h, a) => {
  const n = parseInt(h.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * a);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
};
const buildDark = (h, a) => {
  const n = parseInt(h.slice(1), 16);
  const mix = (c) => Math.round(c * a);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
};
const buildAlpha = (h, a) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function tintWhite(hex, amount) {
  return cachedColor(0, hex, amount, 64, buildTint);
}

export function darken(hex, factor) {
  return cachedColor(1, hex, factor, 100, buildDark);
}

export function withAlpha(hex, alpha) {
  return cachedColor(2, hex, alpha, 100, buildAlpha);
}

// A long note keeps its head on the hit line while it lasts; the exit animation starts when the tail ends.
export const exitTime = (n) => n.time + (n.length || 0);
export const isHeld = (n, t) => n.length > 0 && t >= n.time && t < n.time + n.length;

// A held tail only breathes: a slow, faint brightening of its core (0..1 shimmer).
export const tailShimmer = (t) => 0.5 + 0.5 * Math.sin(t * 4);
// The held head is a little bigger than a normal one and swells very slightly.
export const HELD_SCALE = 1.12;
export const heldPulse = (t) => HELD_SCALE + 0.025 * Math.sin(t * 9);

// How much of the "active long note" look to show, 0..1: it fades in over HELD_FADE_IN seconds after the hit and
// fades out over the exit (FADE_SEC) after the tail ends, so nothing pops.
export const HELD_FADE_IN = 0.2;
export function heldAmount(n, t) {
  if (!(n.length > 0) || t < n.time) return 0;
  const end = n.time + n.length;
  const x = Math.min(1, (t - n.time) / HELD_FADE_IN);
  const rampIn = x * x * (3 - 2 * x); // smoothstep
  const rampOut = t <= end ? 1 : Math.max(0, 1 - (t - end) / FADE_SEC);
  return Math.min(rampIn, rampOut);
}

// Radial halo: fills a circle of radius `outer` around (0, 0) that is strongest near `inner` and fades to nothing at the
// edge. `color` is a #rrggbb string. The caller positions/scales the context (an ellipse is a scaled circle).
export function fillHalo(g, color, inner, outer, strength) {
  // The gradient does not depend on the strength (that is the global alpha), so it is built once per colour and size, not per note per frame.
  // (Looked up by colour, then by size in a short list: a string key built from the numbers was garbage for every halo on every frame.)
  let entries = haloGradients.get(color);
  let grad = null;
  if (entries) for (let i = 0; i < entries.length; i++) if (entries[i].inner === inner && entries[i].outer === outer) { grad = entries[i].grad; break; }
  if (!grad) {
    const stops = haloStops(color);
    grad = g.createRadialGradient(0, 0, inner, 0, 0, outer);
    // eased falloff (smoothstep, see haloProfile): strongest at `inner`, zero slope at both ends, nothing at the edge
    for (let i = 0; i <= 12; i++) grad.addColorStop(i / 12, stops[i]);
    if (haloCount >= 96) { haloGradients.clear(); haloCount = 0; entries = undefined; } // (3D sizes change with the distance: do not grow without bound)
    if (!entries) haloGradients.set(color, (entries = []));
    entries.push({ inner, outer, grad });
    haloCount++;
  }
  const alpha = g.globalAlpha;
  g.globalAlpha = alpha * strength;
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, outer, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = alpha;
}
const haloGradients = new Map(); // colour -> [{ inner, outer, grad }]
let haloCount = 0;
// The 13 colour-stop strings of a halo, per colour (the gradient itself is rebuilt whenever the size moves, but its strings never change).
const haloStopCache = new Map();
function haloStops(color) {
  let list = haloStopCache.get(color);
  if (!list) {
    const rgb = hexRgb(color);
    list = [];
    for (let i = 0; i <= 12; i++) list.push(`rgba(${rgb},${haloProfile(i / 12)})`);
    haloStopCache.set(color, list);
  }
  return list;
}

// Soft falloff of the halo around a held tail: [distance from the strip's edge as a fraction of the reach, strength].
// Smoothstep falloff: it starts and ends with zero slope, so the glow dies out gently instead of ending abruptly.
export const haloProfile = (f) => 1 - f * f * (3 - 2 * f);
export const TAIL_HALO_PROFILE = Array.from({ length: 13 }, (_, i) => [i / 12, haloProfile(i / 12)]);

function hexRgb(color) {
  const n = parseInt(color.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// Halo beside a tail (2D): a horizontal gradient, strongest at the strip's edges and fading out over `reach` px.
// Draws from yTop to yBot, plus a rounded cap above yTop (the same falloff, as a half circle).
export function fillTailHalo(g, color, cx, half, reach, yTop, yBot, strength, withCap) {
  // The gradients are built around x = 0 with the strength left to the global alpha, then cached per colour and size: a tail's halo
  // is the same shape every frame, only its position (a translate) and strength change.
  // (looked up by colour, then by size in a short list: a string key built from the numbers was garbage for every held tail on every frame)
  let entries = tailHaloGradients.get(color);
  let pair = null;
  if (entries) for (let i = 0; i < entries.length; i++) if (entries[i].half === half && entries[i].reach === reach) { pair = entries[i]; break; }
  if (!pair) {
    const rgb = hexRgb(color);
    const total = 2 * (half + reach);
    const lin = g.createLinearGradient(-half - reach, 0, half + reach, 0);
    for (let i = TAIL_HALO_PROFILE.length - 1; i >= 0; i--) {
      const [f, a] = TAIL_HALO_PROFILE[i];
      lin.addColorStop((reach * (1 - f)) / total, `rgba(${rgb},${a})`);
    }
    for (const [f, a] of TAIL_HALO_PROFILE) lin.addColorStop(1 - (reach * (1 - f)) / total, `rgba(${rgb},${a})`);
    const rad = g.createRadialGradient(0, 0, half, 0, 0, half + reach);
    for (const [f, a] of TAIL_HALO_PROFILE) rad.addColorStop(f, `rgba(${rgb},${a})`);
    pair = { half, reach, lin, rad };
    if (tailHaloCount >= 96) { tailHaloGradients.clear(); tailHaloCount = 0; entries = undefined; }
    if (!entries) tailHaloGradients.set(color, (entries = []));
    entries.push(pair);
    tailHaloCount++;
  }
  const total = 2 * (half + reach);
  g.save();
  g.translate(cx, 0);
  g.globalAlpha *= strength;
  g.fillStyle = pair.lin;
  g.fillRect(-half - reach, yTop, total, Math.max(0, yBot - yTop));
  if (withCap) { // the rounded end: the half of a radial gradient that lies beyond the tail's end
    g.beginPath();
    g.rect(-half - reach, yTop - half - reach, total, half + reach);
    g.clip();
    g.translate(0, yTop);
    g.fillStyle = pair.rad;
    g.beginPath();
    g.arc(0, 0, half + reach, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
const tailHaloGradients = new Map(); // colour -> [{ half, reach, lin, rad }]
let tailHaloCount = 0;

export const HIT_FLASH_SEC = 0.14; // how long a hit pad stays lit after a note hit
export const BAR_FLASH_SEC = 0.24; // ... after a pedal or open hit (it lights every pad)

// Note head shape. 'round' = circle/ellipse (the default), 'rect' = rounded rectangle, a bit wider than tall.
// Adds the shape to the current path; rx / ry are the half sizes of the round version.
//
// `dist` (optional) makes the shape follow the 3D perspective: the distance, in px, from the shape's centre to the
// vanishing point. In this projection the width at a row is proportional to (row - vanishing row), so each point is
// scaled around the centre by (y - vy) / dist: the top edge comes out narrower than the bottom one. TAPER_GAIN
// exaggerates that a little so it is easy to see.
export const NOTE_RECT_W = 1.05; // half-width of the rounded rectangle relative to rx (it was 1.2: a bit smaller now)
export const NOTE_RECT_H = 0.68; // half-height relative to ry (it was 0.78)
export const TAPER_GAIN = 3;
// the cymbal triangle (apex up): half sizes relative to rx / ry, and corner rounding
export const NOTE_TRI_W = 1.4; // wider than the round note
export const NOTE_TRI_H = 0.72; // flatter than the round note (it was 1.0)
export const NOTE_TRI_ROUND = 0.5;
export const NOTE_RECT_ROUND = 0.8; // corner radius as a fraction of the half-height (1 = a pill); it was 0.55

// The sampled outline of a note head goes into one reused buffer (x, y pairs): drawing hundreds of notes a frame used to allocate
// thousands of small arrays, and the garbage collector's pauses showed up as micro-stutters.
const PT = new Float64Array(256);

// A triangle with rounded corners, sampled into PT (9 points per corner, 27 in all); returns the number of points.
function roundedTriangle(x0, y0, x1, y1, x2, y2, r) {
  let n = 0;
  for (let i = 0; i < 3; i++) {
    const vx = i === 0 ? x0 : i === 1 ? x1 : x2;
    const vy = i === 0 ? y0 : i === 1 ? y1 : y2;
    const ax = i === 0 ? x2 : i === 1 ? x0 : x1; // previous vertex
    const ay = i === 0 ? y2 : i === 1 ? y0 : y1;
    const bx = i === 0 ? x1 : i === 1 ? x2 : x0; // next vertex
    const by = i === 0 ? y1 : i === 1 ? y2 : y0;
    let uax = ax - vx;
    let uay = ay - vy;
    let ubx = bx - vx;
    let uby = by - vy;
    const la = Math.hypot(uax, uay);
    const lb = Math.hypot(ubx, uby);
    uax /= la; uay /= la; ubx /= lb; uby /= lb;
    const cos = Math.max(-1, Math.min(1, uax * ubx + uay * uby));
    const theta = Math.acos(cos); // angle at the corner
    const t = Math.min(r / Math.tan(theta / 2), la * 0.48, lb * 0.48); // distance from the corner to the tangent points
    const rr = t * Math.tan(theta / 2); // the radius that distance allows
    const bisx = uax + ubx;
    const bisy = uay + uby;
    const bl = Math.hypot(bisx, bisy) || 1;
    const dc = rr / Math.sin(theta / 2);
    const cx = vx + (bisx / bl) * dc;
    const cy = vy + (bisy / bl) * dc;
    const a0 = Math.atan2(vy + uay * t - cy, vx + uax * t - cx);
    const a1 = Math.atan2(vy + uby * t - cy, vx + ubx * t - cx);
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (d * k) / 8;
      PT[n++] = cx + rr * Math.cos(a);
      PT[n++] = cy + rr * Math.sin(a);
    }
  }
  return n / 2;
}

// The silhouette of the rectangular note after the note design (an SVG: narrower flat top with small rounded corners, sides that slant outwards to the widest point a little
// below the middle, then in again to the bottom). The points are in units of the half width and half height of the shape (the cap path of the design, mirrored).
const NOTE_SIL = (() => {
  const U = (px) => (px - 110) / 99.2; // design x -> -1..1 (the widest point of the design is 10.8 .. 209.2)
  const V = (py) => (py - 54) / 38; // design y -> -1..1 (16 .. 92)
  const cubic = (p0, p1, p2, p3, steps) => Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps;
    const m = 1 - t;
    return [m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0], m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]];
  });
  const right = [[194, 16]]; // from the top middle clockwise (the left side of the design mirrored about x = 110)
  right.push(...cubic([194, 16], [198.5, 16], [200.4, 18], [201.4, 21.5], 4));
  right.push([208.2, 43]);
  right.push(...cubic([208.2, 43], [209.8, 48.5], [209.9, 54], [209.2, 59.5], 4));
  right.push([205.1, 92]);
  const mirrored = right.slice(0, -1).reverse().map(([px, py]) => [220 - px, py]); // the left side, from the bottom up
  const all = [[110, 16], ...right, [14.9, 92], ...mirrored];
  return all.map(([px, py]) => [U(px), V(py)]);
})();
const NOTE_SIL_N = NOTE_SIL.length;

// Fills PT with the outline of a note head and returns how many points it holds.
function outline(x, y, rx, ry, style) {
  if (style === 'ynote') { // the rectangular note after the design (same size as 'rect': the half width and height are the same)
    const w = rx * NOTE_RECT_W;
    const h = ry * NOTE_RECT_H;
    for (let i = 0; i < NOTE_SIL_N; i++) {
      PT[2 * i] = x + NOTE_SIL[i][0] * w;
      PT[2 * i + 1] = y + NOTE_SIL[i][1] * h;
    }
    return NOTE_SIL_N;
  }
  if (style === 'tri') { // a rounded triangle pointing up (cymbal notes)
    const w = rx * NOTE_TRI_W;
    const h = ry * NOTE_TRI_H;
    return roundedTriangle(x, y - h, x + w, y + h, x - w, y + h, Math.min(w, h) * NOTE_TRI_ROUND);
  }
  let n = 0;
  if (style !== 'rect') {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      PT[n++] = x + rx * Math.cos(a);
      PT[n++] = y + ry * Math.sin(a);
    }
    return 40;
  }
  const w = rx * NOTE_RECT_W;
  const h = ry * NOTE_RECT_H;
  const r = Math.min(w, h) * NOTE_RECT_ROUND;
  for (let c = 0; c < 4; c++) { // the four corners, each an arc of 7 points
    const cx = c === 0 || c === 1 ? x + w - r : x - w + r;
    const cy = c === 0 || c === 3 ? y - h + r : y + h - r;
    const start = c * 90 - 90;
    for (let k = 0; k <= 6; k++) {
      const a = ((start + (k / 6) * 90) * Math.PI) / 180;
      PT[n++] = cx + r * Math.cos(a);
      PT[n++] = cy + r * Math.sin(a);
    }
  }
  return 28;
}

export function noteShape(g, x, y, rx, ry, style, dist = 0) {
  if (!dist) {
    if (style !== 'rect' && style !== 'tri' && style !== 'ynote') {
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      return;
    }
    const n = outline(x, y, rx, ry, style);
    g.moveTo(PT[0], PT[1]);
    for (let i = 1; i < n; i++) g.lineTo(PT[2 * i], PT[2 * i + 1]);
    g.closePath();
    return;
  }
  const n = outline(x, y, rx, ry, style);
  for (let i = 0; i < n; i++) {
    const px = PT[2 * i];
    const py = PT[2 * i + 1];
    const true_ = (dist + (py - y)) / dist; // exact perspective factor at this row
    const f = 1 + TAPER_GAIN * (true_ - 1);
    const X = x + (px - x) * f;
    if (i === 0) g.moveTo(X, py);
    else g.lineTo(X, py);
  }
  g.closePath();
}

// Resting look of the hit pads at the bottom of the board (fill and ring alpha); they light up from here.
export const PAD_FILL_ALPHA = 0.26; // originally 0.14: the resting pads are more opaque now
export const PAD_RING_ALPHA = 0.8; // originally 0.55

// Hammer-on / pull-off notes (and their tails) are drawn 20% smaller than strummed ones.
export const HOPO_SCALE = 0.8;
export const GHOST_SCALE = 0.8; // YARG's ghost note model is about 80% as wide as a normal one
export const noteScale = (n) => (n.hopo ? HOPO_SCALE : n.ghost ? GHOST_SCALE : 1);

// Star power notes: a white overlay at 80% over the lane colour (the colour and the centre still show through).
export const STAR_POWER_OVERLAY = 0.8;
const starPowerColors = new Map(); // hex -> result (a handful of lane colours: the string was rebuilt for every star power note on every frame)
export function starPowerColor(hex) {
  let out = starPowerColors.get(hex);
  if (out === undefined) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * STAR_POWER_OVERLAY).toString(16).padStart(2, '0');
    out = `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
    if (starPowerColors.size >= 64) starPowerColors.clear();
    starPowerColors.set(hex, out);
  }
  return out;
}
export const noteColor = (n, colors) => (n.sp ? starPowerColor(colors[n.lane]) : colors[n.lane]);

// The spans of `list` (chart.fills, chart.rolls) whose `key` is `value`, filtered once per chart instead of on every frame.
export function spansOfKind(chart, list, key, value) {
  const byKey = (chart.spanKinds ??= new Map()); // key -> (value -> { src, spans }); no "key:value" string per call
  let cache = byKey.get(key);
  if (!cache) byKey.set(key, (cache = new Map()));
  let hit = cache.get(value);
  if (!hit || hit.src !== list) { hit = { src: list, spans: (list || []).filter((x) => x[key] === value) }; cache.set(value, hit); }
  return hit.spans;
}

// Colour stops of the edge fades, built once (they were rebuilt as strings for every pane on every frame). The fade only uses alpha:
// it erases a layer or paints over the stage, so the colour is always black (see Highway.fadeStyle).
const fadeColor = (a) => `rgba(0,0,0,${a})`;
const smootherstep = (u) => u * u * u * (u * (u * 6 - 15) + 10);
export const BOTTOM_FADE_STOPS = [[0, 0], [0.3, 0.2], [0.6, 0.6], [0.85, 0.92], [1, 1]].map(([at, a]) => [at, fadeColor(a)]); // just below the pads
export const EDGE_FADE_STOPS = Array.from({ length: 13 }, (_, n) => { const u = n / 12; return [u, fadeColor((1 - smootherstep(u)).toFixed(3))]; }); // far edge of the board
export const LYRIC_RAMP_STOPS = Array.from({ length: 17 }, (_, n) => { const pos = n / 16; return [pos, fadeColor(1 - smootherstep(Math.pow(pos, 0.7)))]; }); // lyric sheet edges

// A vertical gradient (x = 0) of one of the stop lists above from y0 to y1, kept for the next frame: panes of the same height share it
// and it only changes with the window size, so it is not rebuilt (13 colour stops each) for every pane on every frame.
const fadeGradients = new Map(); // stops -> [{ y0, y1, grad }]
export function fadeGradient(g, y0, y1, stops) {
  let list = fadeGradients.get(stops);
  if (!list) fadeGradients.set(stops, (list = []));
  for (let i = 0; i < list.length; i++) if (list[i].y0 === y0 && list[i].y1 === y1) return list[i].grad;
  const grad = g.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i < stops.length; i++) grad.addColorStop(stops[i][0], stops[i][1]);
  if (list.length >= 8) list.shift(); // (a window being resized makes a new one per frame)
  list.push({ y0, y1, grad });
  return grad;
}

// The fillStyle of a fretboard's dark base (black at the given opacity): the same text again while the opacity does not change.
let baseAlpha = -1;
let baseStyle = '';
export const boardBase = (a) => (a === baseAlpha ? baseStyle : (baseStyle = `rgba(0,0,0,${(baseAlpha = a)})`));

// The big rock ending (BRE) band of a lane: the lane's own colour, pulsing at different speeds in every lane with a wave that runs across the lanes
// (frantic, but made of smooth sines in a narrow alpha range, so it does not flash). `t` in seconds; the result is an alpha in [BRE_ALPHA_MIN, BRE_ALPHA_MAX].
export const BRE_ALPHA_MIN = 0.07;
export const BRE_ALPHA_MAX = 0.3;
export function breAlpha(t, lane, lanes) {
  const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.8 * t - (lane / Math.max(1, lanes)) * 2 * Math.PI); // a chase across the lanes, 1.8 times a second
  const fast = 0.5 + 0.5 * Math.sin(2 * Math.PI * (2.4 + 0.3 * lane) * t + lane * 1.7); // each lane at its own speed
  const slow = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t + lane * 2.3);
  const mix = 0.5 * wave + 0.3 * fast + 0.2 * slow; // 0..1
  return BRE_ALPHA_MIN + (BRE_ALPHA_MAX - BRE_ALPHA_MIN) * mix;
}

// The face of a guitar-like note in the rectangular style, after YARG's note model: chrome end caps and a coloured centre band. A strum is the plain band; a HOPO has
// white strips beside the caps; a tap has a dark centre between coloured strips; star power makes the caps gold (the band is the white-tinted colour already filled).
// Call it with the note's outline as the current path (it clips to it); `hw` / `hh` are the half width / height of that outline, `laneColor` the plain lane colour.
const CHROME = ['#2b2f35', '#e3e9f0', '#8f98a3', '#3b4048'];
const CHROME_GOLD = ['#4d3b00', '#fff0a0', '#c99400', '#5c4500'];
export function drawGuitarNoteFace(g, x, y, hw, hh, n, laneColor) {
  g.save();
  g.clip();
  const cap = hw * 0.26;
  const strip = hw * (n.tap || n.ghost ? 0.17 : 0.3); // the white HOPO strips are wider than the tap's coloured ones
  const top = y - hh - 1;
  const full = 2 * hh + 2;
  if (n.tap || n.ghost) { // dark centre, the colour on the strips beside the caps (YARG's tap and ghost notes)
    g.fillStyle = '#1b1c1f';
    g.fillRect(x - hw + cap, top, 2 * (hw - cap), full);
    g.fillStyle = laneColor;
    g.fillRect(x - hw + cap, top, strip, full);
    g.fillRect(x + hw - cap - strip, top, strip, full);
  } else if (n.hopo || n.accent) { // white strips (the accent's white tabs)
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillRect(x - hw + cap, top, strip, full);
    g.fillRect(x + hw - cap - strip, top, strip, full);
  }
  const gloss = g.createLinearGradient(0, y - hh, 0, y + hh); // a soft highlight on top, a little shade below
  gloss.addColorStop(0, 'rgba(255,255,255,0.32)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0.04)');
  gloss.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = gloss;
  g.fillRect(x - hw - 1, top, 2 * hw + 2, full);
  const stops = n.sp ? CHROME_GOLD : CHROME;
  for (const side of [-1, 1]) { // the chrome caps: bright in the middle of the cap, dark at both edges
    const edge = x + side * hw;
    const cg = g.createLinearGradient(edge, 0, edge - side * cap, 0);
    for (let i = 0; i < 4; i++) cg.addColorStop(i / 3, stops[i]);
    g.fillStyle = cg;
    g.fillRect(Math.min(edge, edge - side * cap) - 1, top, cap + 2, full);
    g.fillStyle = 'rgba(0,0,0,0.5)'; // the seam between the cap and the band
    g.fillRect(side < 0 ? edge + cap - 1 : edge - cap, top, 1, full);
  }
  g.fillStyle = gloss; // the shade also over the caps, so they curve like the band
  g.fillRect(x - hw - 1, top, 2 * hw + 2, full);
  g.restore();
}

// A cymbal in the rectangular style, after YARG's cymbal model: a chrome disc with a coloured cone in the middle (an accent has a white ring, a ghost a dark centre with
// a coloured ring). Call it with the disc's outline (an ellipse of half sizes rx / ry at x, y) as the current path.
export function drawCymbalFace(g, x, y, rx, ry, n, laneColor) {
  g.save();
  g.clip();
  g.translate(x, y);
  g.scale(1, ry / rx); // work in a circle of radius rx, the ellipse comes from this scale
  const gold = n.sp;
  const chrome = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  chrome.addColorStop(0, gold ? '#fff0a0' : '#eef2f6');
  chrome.addColorStop(0.6, gold ? '#b88a00' : '#9aa3ad');
  chrome.addColorStop(0.88, gold ? '#ffe27a' : '#e3e9f0');
  chrome.addColorStop(1, gold ? '#3d2e00' : '#2e3237');
  g.fillStyle = chrome;
  g.beginPath();
  g.arc(0, 0, rx + 1, 0, Math.PI * 2);
  g.fill();
  if (n.accent) { // the white ring
    g.strokeStyle = '#ffffff';
    g.lineWidth = rx * 0.14;
    g.beginPath();
    g.arc(0, 0, rx * 0.76, 0, Math.PI * 2);
    g.stroke();
  }
  const inner = rx * 0.62;
  g.beginPath();
  g.arc(0, 0, inner, 0, Math.PI * 2);
  if (n.ghost) { // dark centre inside a coloured ring
    g.fillStyle = '#1b1c1f';
    g.fill();
    g.strokeStyle = laneColor;
    g.lineWidth = rx * 0.11;
    g.stroke();
  } else { // the cone: the colour with a light top
    g.fillStyle = laneColor;
    g.fill();
    const cone = g.createRadialGradient(-inner * 0.25, -inner * 0.3, 0, 0, 0, inner);
    cone.addColorStop(0, 'rgba(255,255,255,0.6)');
    cone.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = cone;
    g.fill();
  }
  g.restore();
}
