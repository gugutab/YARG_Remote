// Drawing constants and helpers shared by the 2D and 3D highway renderers.
// The lane, kick, open and tap colours below are YARG's defaults; the renderers draw with NOTE_PALETTE (src/palette.js, setting
// highway.palette), read at draw time, which holds these same colours unless another palette is chosen.
export { NOTE_PALETTE } from './palette.js';
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
  fill: 'rgba(40,200,90,0.24)', // YARG draws the drum fill overlay in green (the 2D/3D band fades at both ends and has edge lines, see FILL_EDGE)
  bre: 'rgba(255,80,80,0.15)',
};
export const FILL_STRONG = 'rgba(40,200,90,0.5)'; // the lead-up: a stronger green over the column (lane) of the activation note, along the whole fill
export const FILL_LEAD = 'rgba(40,200,90,0.3)'; // the lane of the final note shown BEFORE the fill starts (flat, no gradient)
export const FILL_LEAD_SEC = 1.2; // how long before the fill start that column begins
export const FILL_EDGE = 'rgba(140,255,170,0.9)'; // the thin bright line at the start and end of a fill phrase
export const FILL_ACTIVATION = '#8cffaa'; // the drum fill activation note's halo and ring (white core): not one of the lane colours
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
// Notes the playing position has not reached are never lit: while a seek animation sweeps the drawn time BACK (the loop
// wrap, a backward seek) the notes it passes over must not flash or glow as if hit. `litFrom` = drawn time - real time
// when that is positive, else 0; a note is lit only once `t - n.time >= litFrom` (set per frame by Highway.draw).
export let litFrom = 0;
export function setLitLag(lag) { litFrom = lag > 0 ? lag : 0; }
// Disabled notes (the stretch replayed after a rewind, and what follows the end of a loop) are never played, so they never light: no pad flash, no held glow
// as the hit line crosses them. `fn(note)` is Highway.disabledNote, or null when nothing is disabled (set per frame by Highway.draw).
let disabledOf = null;
export function setDisabledNotes(fn) { disabledOf = fn; }
export const noteDisabled = (n) => disabledOf !== null && disabledOf(n);
export function heldAmount(n, t) {
  if (!(n.length > 0) || t - n.time < litFrom || noteDisabled(n)) return 0;
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

// Motion blur samples per frame (app.js blurSampleCount): halved after a blurred frame slower than BLUR_SLOW_MS, one more after one faster than
// BLUR_FAST_MS; a gap over 100 ms is not a run of blurred frames (the next jump starts from the count learnt before).
export const BLUR_MAX_SAMPLES = 8;
const BLUR_SLOW_MS = 25; // (under 40 fps)
const BLUR_FAST_MS = 18;
export function adaptBlurSamples(n, gapMs) {
  if (!(gapMs < 100)) return n;
  if (gapMs > BLUR_SLOW_MS) return Math.max(2, n >> 1);
  return gapMs < BLUR_FAST_MS ? Math.min(BLUR_MAX_SAMPLES, n + 1) : n;
}
// The star power activation note of a drum fill (chart n.activation, setting highway.fillActivation): a glowing halo, a ring (white inside a
// light-green glow) and a small four-point star above it. Drawn by the caller on top of the finished head (the note keeps its lane colour
// and the sprite caches are untouched). rx / ry: the head's half sizes on screen; lw: line width scale (perspective); t: the pulse.
export function drawActivationMark(g, cx, cy, rx, ry, lw, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 7);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.translate(cx, cy);
  g.scale(1, ry / rx);
  fillHalo(g, FILL_ACTIVATION, rx * 0.8, rx * 2.1, 0.55 + 0.25 * pulse);
  g.restore();
  g.globalCompositeOperation = 'source-over';
  g.beginPath();
  g.ellipse(cx, cy, rx * 1.3, ry * 1.3, 0, 0, Math.PI * 2);
  g.lineWidth = 5 * lw;
  g.strokeStyle = FILL_ACTIVATION;
  g.globalAlpha *= 0.55;
  g.stroke();
  g.globalAlpha /= 0.55;
  g.lineWidth = 2 * lw;
  g.strokeStyle = '#ffffff';
  g.stroke();
}
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

// The resting pads scaled by the setting highway.padLook (1 = as above): [fill alpha, ring alpha], the ring at most 1.
export const padAlphas = (look) => [PAD_FILL_ALPHA * look, Math.min(1, PAD_RING_ALPHA * look)];

// The beat grid: [measure line, strong beat, weak beat] fill styles of a view at a level of the setting highway.beatLines (null = no lines).
// 'normal' is the original look of each view (the 3D lines are a little stronger than the 2D ones).
const BEAT_ALPHAS = { '2d': [0.35, 0.2, 0.12], '3d': [0.4, 0.22, 0.14] };
export const BEAT_LEVELS = { off: 0, subtle: 0.5, normal: 1, strong: 1.8 };
export function beatLineStyles(level, view) {
  const f = BEAT_LEVELS[level] ?? 1;
  if (!f) return null;
  return (BEAT_ALPHAS[view] || BEAT_ALPHAS['2d']).map((a) => `rgba(255,255,255,${Math.min(1, +(a * f).toFixed(3))})`);
}

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
export const BRE_ALPHA_STEADY = (BRE_ALPHA_MIN + BRE_ALPHA_MAX) / 2; // the mean of the pulse (each sine averages 0.5): setting highway.breBand 'steady'
export function breAlpha(t, lane, lanes, pulse = true) {
  if (!pulse) return BRE_ALPHA_STEADY;
  const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.8 * t - (lane / Math.max(1, lanes)) * 2 * Math.PI); // a chase across the lanes, 1.8 times a second
  const fast = 0.5 + 0.5 * Math.sin(2 * Math.PI * (2.4 + 0.3 * lane) * t + lane * 1.7); // each lane at its own speed
  const slow = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t + lane * 2.3);
  const mix = 0.5 * wave + 0.3 * fast + 0.2 * slow; // 0..1
  return BRE_ALPHA_MIN + (BRE_ALPHA_MAX - BRE_ALPHA_MIN) * mix;
}

// The rectangular note ('ynote'), drawn as vectors after the note design SVG (220 x 100 viewBox): a lane-coloured body with a gloss and darker ends, two mirrored
// chrome caps whose inner edge curves inwards (shaded bands that follow the cap: dark outer edge, grey ridge, bright highlight, dark inner line, vertical shade,
// specular blob) and a base in perspective (dark top face narrower at the back, dark front face over the caps' lower ends, soft floor shadow).
// Every part is a polygon sampled once from the design's path data, in design units centred on (110, 54); a note is drawn by scaling that space to its half
// width / height (the design's visible half width 99.2 and the cap's half height 38) and re-tracing the polygons, so the edges stay crisp at any size and DPR.
// The 3D taper is applied to the points while tracing (each point's x is scaled by 1 + k * its row), which an affine transform cannot do.
// Speed: a screen holds 100+ notes, and in a GPU canvas every fill, clip and stroke is a draw of its own. So there are no clips, no blur and no strokes but the
// floor shadow: the design's blurred cap strokes become one precomputed colour profile across the cap (a linear gradient, see capProfile), laid along the cap's
// slanted ridge by a shear in three horizontal slabs; the body gloss is a gradient per colour (cached). A full-size note is one stroke (floor shadow) and
// 12-13 fills; under 24 px of half width the caps are one piece each and the specular blobs go (8 draws); under 9 px the shade of the caps goes too.
const YN_CX = 110;
const YN_CY = 54;
const YN_HW = 99.2;
const YN_HH = 38;
const YN_BASE_V = 35; // design row 89 (the body's bottom): the base below it is stretched or squashed by `side`
// How tall the base under the note is drawn, relative to the design: the 2D view looks from above (less of the front face), the 3D one from a lower angle.
export const YNOTE_SIDE_2D = 0.6;
export const YNOTE_SIDE_3D = 1.6;
function sampleDesign(start, segs, steps = 8) {
  const out = [start[0] - YN_CX, start[1] - YN_CY];
  let px = start[0];
  let py = start[1];
  for (const s of segs) {
    if (s.length === 2) { out.push(s[0] - YN_CX, s[1] - YN_CY); px = s[0]; py = s[1]; continue; }
    const q = s.length === 4; // quadratic (x1 y1 x y) or cubic (x1 y1 x2 y2 x y)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const m = 1 - t;
      if (q) out.push(m * m * px + 2 * m * t * s[0] + t * t * s[2] - YN_CX, m * m * py + 2 * m * t * s[1] + t * t * s[3] - YN_CY);
      else out.push(m * m * m * px + 3 * m * m * t * s[0] + 3 * m * t * t * s[2] + t * t * t * s[4] - YN_CX, m * m * m * py + 3 * m * m * t * s[1] + 3 * m * t * t * s[3] + t * t * t * s[5] - YN_CY);
    }
    px = s[s.length - 2];
    py = s[s.length - 1];
  }
  return Float32Array.from(out);
}
// The part of closed polygon P (u, v pairs) between rows v0 and v1 (Sutherland-Hodgman against the two lines).
function clipRows(P, v0, v1) {
  const half = (pts, keep, vc) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const ia = keep(a[1]);
      const ib = keep(b[1]);
      if (ia !== ib) out.push([a[0] + ((b[0] - a[0]) * (vc - a[1])) / (b[1] - a[1]), vc]);
      if (ib) out.push(b);
    }
    return out;
  };
  let pts = [];
  for (let i = 0; i < P.length; i += 2) pts.push([P[i], P[i + 1]]);
  pts = half(pts, (v) => v >= v0, v0);
  pts = half(pts, (v) => v <= v1, v1);
  return Float32Array.from(pts.flat());
}
// The top of the note can be cut: the cut is the fraction of the face height (design rows 16 .. 89) taken off the top (YNOTE_CUT by default, setting
// highway.noteCut). The cut note keeps the design's "ceiling": the flat top with its rounded corner (7.4 units in, 5.5 down) is laid again at the cut line, on the
// cap's outer edge as it is there; the cap's inner edge and the body just end at the cut. Everything below that depends on the cut is rebuilt by rebuildYNote.
export const YNOTE_CUT = 1 / 3;
export const YNOTE_CUT_MAX = 0.4; // (past 0.4 the cut reaches the cap's inner curve at row 46 and the outline would fold)
// The setting's percentage as a cut fraction: 33 is the design's one third exactly (so the default draws what it always drew).
export const noteCutFraction = (pct) => (pct === 33 ? YNOTE_CUT : Math.min(YNOTE_CUT_MAX, Math.max(0, pct / 100)));
const OUTER = [[18.6, 21.5], [11.8, 43], [10.8, 59.5], [14.9, 92]]; // the cap's outer edge below the corner: line, cubic (via 10.2 48.5, 10.1 54), line
const cubicPt = (t) => { // the outer cubic from (11.8, 43) to (10.8, 59.5)
  const m = 1 - t;
  return [m * m * m * 11.8 + 3 * m * m * t * 10.2 + 3 * m * t * t * 10.1 + t * t * t * 10.8, m * m * m * 43 + 3 * m * m * t * 48.5 + 3 * m * t * t * 54 + t * t * t * 59.5];
};
const outerAt = (y) => { // the outer edge at design row y (y between the corner's end and row 92): [x, rest], rest = the points that follow, down to row 92
  if (y <= 43) return [18.6 + ((y - 21.5) * (11.8 - 18.6)) / (43 - 21.5), [[11.8, 43], ...Array.from({ length: 8 }, (_, i) => cubicPt((i + 1) / 8)), [14.9, 92]]];
  if (y <= 59.5) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (cubicPt(mid)[1] < y) lo = mid; else hi = mid; }
    return [cubicPt(lo)[0], [...Array.from({ length: 8 }, (_, i) => cubicPt(lo + ((i + 1) / 8) * (1 - lo))), [14.9, 92]]];
  }
  return [10.8 + ((y - 59.5) * (14.9 - 10.8)) / (92 - 59.5), [[14.9, 92]]];
};
const YN_BASE_TOP = sampleDesign([19, 84], [[201, 84], [203.8, 84, 204.7, 86.5], [205.5, 90.5], [14.5, 90.5], [15.3, 86.5], [16.2, 84, 19, 84]], 4);
const YN_BASE_FRONT = sampleDesign([14.5, 90.5], [[205.5, 90.5], [205.5, 93.5, 203, 96, 200, 96], [20, 96], [17, 96, 14.5, 93.5, 14.5, 90.5]], 8); // the lower ends are quarter circles of the face's whole height
let YT = 0; // the design row of the (new) top
let XI = 0; // the cap's inner edge at the new top
let YN_CAP = null; // the left cap; the right one is mirrored
let YN_BODY = null;
let YN_HOPO_STRIP = null; // the band beside a cap (HOPO / accent white strip)
let YN_TAP_CENTRE = null; // the tap / ghost dark centre
let CAP_SLABS = null;
// The band beside a cap (HOPO / accent white strip): from under the cap to the cap's inner edge moved `s` units in; both sides go in one path.
const strip = (s) => sampleDesign([30, YT], [[XI + s, YT], [31.6 + s, 46], [30.8 + s, 50, 30.6 + s, 55, 31.2 + s, 60], [35 + s, 89], [30, 89]]);
// The tap / ghost dark centre: between two coloured strips of width `s`.
const centre = (s) => sampleDesign([XI + s, YT], [[31.6 + s, 46], [30.8 + s, 50, 30.6 + s, 55, 31.2 + s, 60], [35 + s, 89], [185 - s, 89], [188.8 - s, 60], [189.4 - s, 55, 189.2 - s, 50, 188.4 - s, 46], [181 - s, 16]]);
// Recomputes the cut-dependent polygons for a cut fraction (0 .. YNOTE_CUT_MAX) and drops the gradients that depend on the top row.
export function rebuildYNote(cut = YNOTE_CUT) {
  const c = Math.min(YNOTE_CUT_MAX, Math.max(0, Number(cut) || 0));
  const CUT_D = 73 * c;
  YT = 16 + CUT_D;
  const [XE, OUTER_REST] = outerAt(YT + 5.5); // the outer edge where the corner ends
  XI = 31.6 + ((46 - YT) * 7.4) / 30;
  YN_CAP = sampleDesign([XI, YT], [[XE + 7.4, YT], [XE + 2.9, YT, XE + 1, YT + 2, XE, YT + 5.5], ...OUTER_REST, [35.4, 92], [35, 89], [31.2, 60], [30.6, 55, 30.8, 50, 31.6, 46]]);
  YN_BODY = sampleDesign([XI, YT], [[220 - XI, YT], [191.4, 46], [192.2, 50, 192.4, 55, 191.8, 60], [188, 89], [32, 89], [28.2, 60], [27.6, 55, 27.8, 50, 28.6, 46]]);
  YN_HOPO_STRIP = strip(30); // design units (0.3 of the half width, as before)
  YN_TAP_CENTRE = centre(17);
  // The cap's shading follows its ridge, which is (nearly) a straight slanted line in three stretches: [top row, bottom row, ridge x at the top, at the bottom]
  // (design units). Each slab of the cap is filled with the cap profile sheared along its stretch; a slab reaches 0.6 units into the next one, which is drawn
  // over it, so their shared edge has no anti-aliasing seam.
  CAP_SLABS = [[10, 45, 33.6, 26.6], [45, 60, 26.6, 26.2], [60, 100, 26.2, 30]].map(([y0, y1, x0, x1], i, all) => {
    const m = (x1 - x0) / (y1 - y0); // ridge x per row
    return { poly: clipRows(YN_CAP, y0 - YN_CY, (i < all.length - 1 ? y1 + 0.6 : y1) - YN_CY), u0: x0 - YN_CX, v0: y0 - YN_CY, m, uc: (x0 + x1) / 2 - YN_CX };
  });
  ynShared = null; // (capV starts at the top row)
  bodyGradients.clear(); // (so does every body gloss)
  ynSprites.clear(); // (and every cached note picture)
  yn3Sprites.clear();
  yn3Px = 0;
  return c;
}

// Adds polygon P to the current path, mirrored when m = -1, with the base rows (below the body) scaled by `side` and the taper k applied.
function traceYN(g, P, m, k, side) {
  for (let i = 0; i < P.length; i += 2) {
    let v = P[i + 1];
    if (v > YN_BASE_V) v = YN_BASE_V + (v - YN_BASE_V) * side;
    const u = m * P[i] * (1 + k * v);
    if (i === 0) g.moveTo(u, v); else g.lineTo(u, v);
  }
  g.closePath();
}
const baseRow = (py, side) => YN_BASE_V + (py - YN_CY - YN_BASE_V) * side;

// The colour across a cap, from 18 units outside its ridge to 7 inside (design units), as the design paints it: fill, then each stroke blurred by its
// stdDeviation 1.3 (a band of width w blurs to the difference of two error functions), composited in order. The outer edge is ~15.5 units out, the inner
// edge ~4.9 units in, all along the cap.
const CAP_FROM = -18;
const CAP_TO = 7;
function capProfile(pal) {
  const erf = (x) => { // Abramowitz-Stegun 7.1.26
    const s = Math.sign(x);
    const a = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
  };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const layers = [[-15.5, 7, pal.outer], [0, 13, pal.ridge], [0, 7, pal.light], [0, 2.5, pal.white], [4.9, 1.6, pal.inner]];
  const stops = [];
  for (let d = CAP_FROM; d <= CAP_TO; d += 0.5) {
    let c = rgb(pal.fill);
    for (const [at, w, col] of layers) {
      const s = 1.3 * Math.SQRT2;
      const a = 0.5 * (erf((d - at + w / 2) / s) - erf((d - at - w / 2) / s));
      const lc = rgb(col);
      c = c.map((v, i) => v * (1 - a) + lc[i] * a);
    }
    stops.push([(d - CAP_FROM) / (CAP_TO - CAP_FROM), `rgb(${c.map(Math.round).join(',')})`]);
  }
  return stops;
}
const CAP_CHROME = { fill: '#2a2a2a', outer: '#0e0e0e', ridge: '#7a7a7a', light: '#bdbdbd', white: '#f4f4f4', inner: '#1a1a1a' };
const CAP_GOLD = { fill: '#3a2c00', outer: '#140e00', ridge: '#a77d00', light: '#e8b923', white: '#fff3b8', inner: '#241a00' };
const CAP_STOPS = [capProfile(CAP_CHROME), capProfile(CAP_GOLD)];

// Gradients in design units (they scale with the transform): built once; the base ones per `side`, the body ones per colour.
let ynShared = null;
const ynBase = new Map(); // side -> [chrome, gold]
const linGrad = (g, x0, y0, x1, y1, stops) => {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
};
function ynGradients(g, side, gold) {
  if (!ynShared) {
    ynShared = {
      ends: linGrad(g, -82, 0, 82, 0, [[0, 'rgba(0,0,0,0.4)'], [0.1, 'rgba(0,0,0,0)'], [0.9, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.4)']]),
      baseEnds: linGrad(g, -95.5, 0, 95.5, 0, [[0, 'rgba(0,0,0,0.75)'], [0.06, 'rgba(0,0,0,0.64)'], [0.2, 'rgba(0,0,0,0.26)'], [0.34, 'rgba(0,0,0,0)'], [0.66, 'rgba(0,0,0,0)'], [0.8, 'rgba(0,0,0,0.26)'], [0.94, 'rgba(0,0,0,0.64)'], [1, 'rgba(0,0,0,0.75)']]), // the base fades to black at both ends: it curves away
      capV: linGrad(g, 0, YT - YN_CY, 0, 35, [[0, 'rgba(0,0,0,0.6)'], [0.38, 'rgba(0,0,0,0)'], [0.7, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.35)']]),
      cap: CAP_STOPS.map((stops) => linGrad(g, CAP_FROM, 0, CAP_TO, 0, stops)),
    };
  }
  let pair = ynBase.get(side);
  if (!pair) {
    const top0 = baseRow(84, side);
    const top1 = baseRow(90.5, side);
    const front1 = baseRow(96, side);
    const fy = baseRow(96.5, side);
    const fr = 3.4 * Math.max(0.5, side); // half height of the floor shadow
    const shadow = linGrad(g, 0, fy - fr, 0, fy + fr, [[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']]);
    // the top face's dark line at row 88 is the design's contact shadow under the body
    pair = [['#141414', '#0c0c0c', '#4a4a4a', ['#23272b', '#5e646c', '#8d939b', '#3a3e43', '#121416']], ['#1c1600', '#120e00', '#5a4a14', ['#2a2200', '#6a5415', '#98801f', '#3c3008', '#120d00']]].map((c) => ({
      top: linGrad(g, 0, Math.min(top0, top1 - 0.01), 0, top1, [[0, c[0]], [0.7, c[1]], [1, c[2]]]),
      front: linGrad(g, 0, top1, 0, Math.max(front1, top1 + 0.01), c[3].map((col, i) => [[0, 0.3, 0.55, 0.8, 1][i], col])),
      shadow, fy, fr,
    }));
    if (ynBase.size >= 8) ynBase.clear();
    ynBase.set(side, pair);
  }
  return pair[gold ? 1 : 0];
}
// The body's gloss for one flat colour, after the design's green (#79d304 -> #4f8f06 .. #6fb80e .. #9df22c .. #86dc1c .. #6cb80f .. #4c8a06): darker at the
// top and bottom, a brighter band a little above the middle (added, so the hue stays saturated). `color` is #rrggbb or rgb(r,g,b).
const bodyGradients = new Map();
function bodyGradient(g, color) {
  let gr = bodyGradients.get(color);
  if (!gr) {
    const c = color[0] === '#' ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : color.slice(color.indexOf('(') + 1, -1).split(',').map(Number);
    const mul = (f) => `rgb(${c.map((v) => Math.round(v * f)).join(',')})`;
    const add = (n) => `rgb(${c.map((v) => Math.min(255, v + n)).join(',')})`;
    gr = linGrad(g, 0, YT - YN_CY, 0, 35, [[0, mul(0.65)], [0.12, mul(0.88)], [0.45, add(36)], [0.6, add(14)], [0.92, mul(0.88)], [1, mul(0.63)]]);
    if (bodyGradients.size >= 256) bodyGradients.clear(); // (held notes change their tint every frame)
    bodyGradients.set(color, gr);
  }
  return gr;
}
const ynSprites = new Map(); // cached flat notes (ynSprite)
const yn3Sprites = new Map(); // cached 3D notes (ynSprite3D)
let yn3Px = 0; // (their pixels)
rebuildYNote(YNOTE_CUT); // (after the gradient caches it resets exist)

// Draws a rectangular note centred at (x, y) with half width hw and half height hh (the box of the 'ynote' outline). `bodyColor` is the body's flat colour (lane
// colour, star power tint, held / exit tint), `laneColor` the plain lane colour (the strips of a star power tap). `taper` is the perspective taper per px of row
// (TAPER_GAIN / dist in 3D, 0 in 2D) and `side` scales the height of the base under the note (how much of the front face the view shows). Uses the caller's
// globalAlpha and filter.
// `cacheable`: the caller's colours are steady from frame to frame (not a held or exiting note's changing tint); a flat (2D) note is then drawn from a
// cached picture of itself (ynSprite) when nothing in the canvas state would make that look different.
// Setting highway.fast3dNotes: 3D notes come from scaled cached pictures (about a third faster, slightly softer edges); off = every 3D note drawn directly.
let fast3d = false;
export function setFast3dNotes(on) { fast3d = !!on; }
export function drawYNote(g, x, y, hw, hh, n, laneColor, bodyColor, taper = 0, side = 1, cacheable = false) {
  if (cacheable && g.globalAlpha === 1 && g.filter === 'none' && g.globalCompositeOperation === 'source-over' && typeof g.getTransform === 'function'
    && (taper === 0 ? ynSprite(g, x, y, hw, hh, n, laneColor, bodyColor, side) : fast3d && ynSprite3D(g, x, y, hw, hh, n, laneColor, bodyColor, taper, side))) return;
  drawYNoteDirect(g, x, y, hw, hh, n, laneColor, bodyColor, taper, side);
}

// Sprites of 3D notes. In the 3D view a steady note's taper per design unit (taper * hh / YN_HH) and its aspect (hh / hw) are the same at every depth (its
// size and its distance to the vanishing point both grow with the road's scale), so it is one picture uniformly scaled: drawn once per size bucket
// (half width in device px rounded to a power of YN3_STEP) at YN3_SS times that size, then drawn scaled to the exact size and sub-pixel place with
// drawImage (bilinear). Unlike the flat sprites this resamples: edges differ from the direct path by up to ~1/4 of their contrast on a few pixels.
// The detail level (parts dropped under 24 / 16 / 9 px) follows the note's real size, so it is part of the key. Same canvas-state conditions as ynSprite.
// Cleared when it holds YN3_MAX sprites or YN3_MAX_PX pixels, or the note's cut changes.
const YN3_STEP = 1.05;
const YN3_SS = 2;
const YN3_MAX = 1200;
const YN3_MAX_PX = 8e6; // (~32 MB; Highway Star with 3 panes at 1300x760 holds ~570 sprites, 1.8 M px)
const LOG_YN3_STEP = Math.log(YN3_STEP);
function ynSprite3D(g, x, y, hw, hh, n, laneColor, bodyColor, taper, side) {
  const m = g.getTransform();
  if (m.b !== 0 || m.c !== 0 || !(m.a > 0) || !(m.d > 0)) return false;
  const hwd = hw * m.a; // half width in device px
  const bi = Math.round(Math.log(hwd) / LOG_YN3_STEP);
  const f = (Math.exp(bi * LOG_YN3_STEP) * YN3_SS) / hwd; // sprite px per device px
  const kq = Math.round(taper * (hh / YN_HH) * 1e7); // the taper per design unit (equal up to rounding noise at every depth)
  const asp = Math.round((hh * m.d * 1e4) / hwd);
  const dark = n.tap || n.ghost;
  const key = `${bodyColor}|${dark && n.sp ? laneColor : ''}|${n.sp ? 1 : 0}${n.tap ? 1 : 0}${n.ghost ? 1 : 0}${n.hopo || n.accent ? 1 : 0}|${bi}|${kq}|${asp}|${side}|${hw >= 24 ? 2 : hw >= 16 ? 1 : 0}${hw >= 9 ? 1 : 0}`;
  let sp = yn3Sprites.get(key);
  if (!sp) {
    // the note's extent around (x, y) as in ynSprite, widened by the taper at the farthest row
    const sy = hh / YN_HH;
    const mid = (YT - YN_CY + YN_BASE_V) / 2;
    const vLo = YT - YN_CY;
    const vHi = Math.max(baseRow(96.5, side) + 3.4 * Math.max(0.5, side), baseRow(96, side));
    const vMax = Math.max(Math.abs(vLo - mid), Math.abs(vHi - mid));
    const X = Math.ceil(((100 * (1 + Math.abs(kq / 1e7) * Math.max(Math.abs(vLo), Math.abs(vHi))) * hw) / YN_HW) * m.a * f) + 3;
    const Y = Math.ceil(vMax * sy * m.d * f) + 3;
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(2 * X, 2 * Y) : Object.assign(document.createElement('canvas'), { width: 2 * X, height: 2 * Y });
    const sg = canvas.getContext('2d');
    sg.setTransform(m.a * f, 0, 0, m.d * f, X, Y);
    drawYNoteDirect(sg, 0, 0, hw, hh, n, laneColor, bodyColor, taper, side);
    if (yn3Sprites.size >= YN3_MAX || yn3Px >= YN3_MAX_PX) { yn3Sprites.clear(); yn3Px = 0; }
    sp = { canvas, X, Y };
    yn3Sprites.set(key, sp);
    yn3Px += 4 * X * Y;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(sp.canvas, m.a * x + m.e - sp.X / f, m.d * y + m.f - sp.Y / f, (2 * sp.X) / f, (2 * sp.Y) / f);
  g.setTransform(m);
  return true;
}

// Sprites of flat notes. A note is ~13 gradient fills and ~10 polygons; in 2D every note of one kind in one lane has the same size, so it is drawn once into a
// small canvas, at the same device-pixel fraction (quantised to 1/YN_SPRITE_Q px) as on screen, and copied at a whole-pixel offset (no resampling). Only
// under a plain scale + translate, full opacity, no filter, source-over; the layered fills composite into transparency first, which differs from painting
// them over the board by rounding only. Keyed by everything the picture depends on; cleared when it grows past YN_SPRITE_MAX or the note's cut changes.
const YN_SPRITE_Q = 8;
const YN_SPRITE_MAX = 800; // (8 fractions x lanes x note kinds x panes; a few MB)
function ynSprite(g, x, y, hw, hh, n, laneColor, bodyColor, side) {
  const m = g.getTransform();
  if (m.b !== 0 || m.c !== 0 || !(m.a > 0) || !(m.d > 0)) return false;
  const dx = m.a * x + m.e;
  const dy = m.d * y + m.f;
  let ix = Math.floor(dx);
  let iy = Math.floor(dy);
  let fx = Math.round((dx - ix) * YN_SPRITE_Q);
  let fy = Math.round((dy - iy) * YN_SPRITE_Q);
  if (fx === YN_SPRITE_Q) { fx = 0; ix++; }
  if (fy === YN_SPRITE_Q) { fy = 0; iy++; }
  const dark = n.tap || n.ghost;
  const key = `${bodyColor}|${dark && n.sp ? laneColor : ''}|${n.sp ? 1 : 0}${n.tap ? 1 : 0}${n.ghost ? 1 : 0}${n.hopo || n.accent ? 1 : 0}|${hw}|${hh}|${side}|${m.a}|${m.d}|${fx}|${fy}`;
  let sp = ynSprites.get(key);
  if (!sp) {
    // the note's extent around (x, y), in note units: u within +-100 design units (base and shadow end ~96), v from the cut top to under the floor shadow
    const sy = hh / YN_HH;
    const mid = (YT - YN_CY + YN_BASE_V) / 2;
    const vMax = Math.max(Math.abs(YT - YN_CY - mid), Math.abs(baseRow(96.5, side) + 3.4 * Math.max(0.5, side) - mid), Math.abs(baseRow(96, side) - mid));
    const X = Math.ceil((100 * hw / YN_HW) * m.a) + 3;
    const Y = Math.ceil(vMax * sy * m.d) + 3;
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(2 * X, 2 * Y) : Object.assign(document.createElement('canvas'), { width: 2 * X, height: 2 * Y });
    const sg = canvas.getContext('2d');
    sg.setTransform(m.a, 0, 0, m.d, X + fx / YN_SPRITE_Q, Y + fy / YN_SPRITE_Q);
    drawYNoteDirect(sg, 0, 0, hw, hh, n, laneColor, bodyColor, 0, side);
    if (ynSprites.size >= YN_SPRITE_MAX) ynSprites.clear();
    sp = { canvas, X, Y };
    ynSprites.set(key, sp);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(sp.canvas, ix - sp.X, iy - sp.Y);
  g.setTransform(m);
  return true;
}

function drawYNoteDirect(g, x, y, hw, hh, n, laneColor, bodyColor, taper, side) {
  const k = taper * (hh / YN_HH); // taper per design unit of row
  const detail = hw >= 24 ? 2 : hw >= 9 ? 1 : 0; // the small parts only where they have pixels to live in
  const base = ynGradients(g, side, n.sp);
  const S = ynShared;
  g.save();
  g.translate(x, y - ((YT - YN_CY + YN_BASE_V) / 2) * (hh / YN_HH)); // (the middle of the cut note's face on the note's position)
  g.scale(hw / YN_HW, hh / YN_HH);
  if (hw >= 16) { // the soft floor shadow: a round-capped stroke with a vertical fade
    const fu = 91.5 * (1 + k * base.fy);
    g.beginPath();
    g.moveTo(-fu, base.fy);
    g.lineTo(fu, base.fy);
    g.lineCap = 'round';
    g.lineWidth = 2 * base.fr;
    g.strokeStyle = base.shadow;
    g.stroke();
  }
  // the base's top face (narrower at the back)
  g.beginPath();
  traceYN(g, YN_BASE_TOP, 1, k, side);
  g.fillStyle = base.top;
  g.fill();
  g.fillStyle = S.baseEnds;
  g.fill();
  // the body (a tap or ghost: the colour stays on the strips, the centre is dark; a HOPO or accent: white strips), then its darker ends over all of it
  g.beginPath();
  traceYN(g, YN_BODY, 1, k, side);
  const dark = n.tap || n.ghost;
  g.fillStyle = bodyGradient(g, dark && n.sp ? laneColor : bodyColor);
  g.fill();
  if (dark || n.hopo || n.accent) {
    g.beginPath();
    if (dark) traceYN(g, YN_TAP_CENTRE, 1, k, side);
    else { traceYN(g, YN_HOPO_STRIP, 1, k, side); traceYN(g, YN_HOPO_STRIP, -1, k, side); }
    g.fillStyle = bodyGradient(g, dark ? '#1b1c1f' : '#f4f4f4');
    g.fill();
    g.beginPath();
    traceYN(g, YN_BODY, 1, k, side);
  }
  g.fillStyle = S.ends;
  g.fill();
  // the two chrome (gold for star power) caps: the profile across the cap, sheared along the ridge slab by slab (one piece, along the middle stretch, when small)
  g.fillStyle = S.cap[n.sp ? 1 : 0];
  const slabs = detail === 2;
  for (let m = -1; m <= 1; m += 2) {
    const sg = m; // m = 1 is the design's left cap, -1 the mirrored right one (the profile is mirrored with it)
    for (let i = slabs ? 0 : 1; i < (slabs ? CAP_SLABS.length : 2); i++) {
      const s = CAP_SLABS[i];
      g.beginPath();
      traceYN(g, slabs ? s.poly : YN_CAP, sg, k, side);
      // the gradient's x is the distance from the ridge: screen u = sg * (x + u0 + slope * (v - v0)) (+ the taper at the slab's ridge)
      const c = sg * (s.m + s.uc * k);
      const e = sg * (s.u0 - s.m * s.v0);
      g.transform(sg, 0, c, 1, e, 0);
      g.fill();
      g.transform(sg, 0, -c * sg, 1, -e * sg, 0); // (the inverse: the path is already in place, only the gradient moved)
    }
  }
  if (detail) {
    g.beginPath(); // the vertical shade over both caps
    traceYN(g, YN_CAP, 1, k, side);
    traceYN(g, YN_CAP, -1, k, side);
    g.fillStyle = S.capV;
    g.fill();
  }
  // the base's front face, over the caps' lower ends
  g.beginPath();
  traceYN(g, YN_BASE_FRONT, 1, k, side);
  g.fillStyle = base.front;
  g.fill();
  g.fillStyle = S.baseEnds; // (the vertical fade above stays; this one only darkens the two ends)
  g.fill();
  g.restore();
}

// A cymbal in the rectangular style, after YARG's cymbal model: a chrome disc with a coloured cone in the middle (an accent has a white ring, a ghost a dark centre with
// a coloured ring). Call it with the disc's outline (an ellipse of half sizes rx / ry at x, y) as the current path.
// Its gradients are built once in unit space (radius 1) and drawn under a scale, with the path added after the scale in unit coordinates (adding it
// before the scale and filling under it rasterizes the edges a little differently in Chromium; this way the pixels are the same as before).
let cymbalGrads = null; // { chrome: [plain, gold], cone }
function cymbalGradients(g) {
  if (!cymbalGrads) {
    const chrome = (c) => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      [0, 0.6, 0.88, 1].forEach((o, i) => gr.addColorStop(o, c[i]));
      return gr;
    };
    const cone = g.createRadialGradient(-0.25, -0.3, 0, 0, 0, 1);
    cone.addColorStop(0, 'rgba(255,255,255,0.6)');
    cone.addColorStop(1, 'rgba(0,0,0,0.12)');
    cymbalGrads = { chrome: [chrome(['#eef2f6', '#9aa3ad', '#e3e9f0', '#2e3237']), chrome(['#fff0a0', '#b88a00', '#ffe27a', '#3d2e00'])], cone };
  }
  return cymbalGrads;
}
// Fills a circle of radius `r` at the current origin with a unit-space gradient scaled by `s`.
function fillCircleScaled(g, gradient, r, s) {
  g.save();
  g.scale(s, s);
  g.beginPath();
  g.arc(0, 0, r / s, 0, Math.PI * 2);
  g.fillStyle = gradient;
  g.fill();
  g.restore();
}
export function drawCymbalFace(g, x, y, rx, ry, n, laneColor) {
  const grads = cymbalGradients(g);
  g.save();
  g.clip();
  g.translate(x, y);
  g.scale(1, ry / rx); // work in a circle of radius rx, the ellipse comes from this scale
  fillCircleScaled(g, grads.chrome[n.sp ? 1 : 0], rx + 1, rx);
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
    fillCircleScaled(g, grads.cone, inner, inner);
  }
  g.restore();
}
