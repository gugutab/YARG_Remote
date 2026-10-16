// Drawing constants and helpers shared by the 2D and 3D highway renderers.
export const GUITAR_LANE_COLORS = ['#79d304', '#ff1d23', '#ffe900', '#00bfff', '#ff8400']; // YARG.Core ColorProfile.Defaults.cs
export const KICK_COLOR = '#f2861e';
export const OPEN_COLOR = '#c800ff'; // YARG's open-note purple
export const STAR_POWER_NOTE = '#ffffff'; // YARG draws notes inside a star power phrase in the star power colour
export const HARMONY_COLORS = { 1: '#3fbf9f', 2: '#2fa8a8', 3: '#8fd6c4' }; // harmony parts 1..3, behind the lead
export const KICK_BAR_HALF_H = 6; // pedal bar is 12 px tall at rest
export const DOUBLE_KICK_GAP = 4; // px between the two bars of a double kick
export const TAP_COLOR = '#b25cff';
export const ACCENT_OUTLINE_WIDTH = 4;
export const ACCENT_OUTLINE_DARKEN = 0.55; // multiplier applied to the note colour for the accent outline
export const GHOST_ALPHA = 0.45;
export const ROLL_COLORS = {
  kick: 'rgba(242,134,30,0.14)',
  tremolo: 'rgba(63,191,63,0.14)',
  trill: 'rgba(245,197,24,0.14)',
};
// Drum fill (activation phrase) and big rock ending bands, one colour per chart.fills kind; kept faint under the notes.
export const FILL_COLORS = {
  fill: 'rgba(178,92,255,0.13)',
  bre: 'rgba(255,80,80,0.15)',
};
export const FADE_SEC = 0.25; // how long a note takes to fade out after the hit line
export const BASE_LOOKAHEAD_SEC = 2.5; // time from the top edge to the hit line at neck speed 1
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

export function tintWhite(hex, amount) {
  return cachedColor(0, hex, amount, 64, (h, a) => {
    const n = parseInt(h.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * a);
    return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
  });
}

export function darken(hex, factor) {
  return cachedColor(1, hex, factor, 100, (h, a) => {
    const n = parseInt(h.slice(1), 16);
    const mix = (c) => Math.round(c * a);
    return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
  });
}

export function withAlpha(hex, alpha) {
  return cachedColor(2, hex, alpha, 100, (h, a) => {
    const n = parseInt(h.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  });
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
  const key = `${color}|${inner}|${outer}`;
  let grad = haloGradients.get(key);
  if (!grad) {
    const n = parseInt(color.slice(1), 16);
    const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    grad = g.createRadialGradient(0, 0, inner, 0, 0, outer);
    // eased falloff (smoothstep, see haloProfile): strongest at `inner`, zero slope at both ends, nothing at the edge
    for (let i = 0; i <= 12; i++) grad.addColorStop(i / 12, `rgba(${rgb},${haloProfile(i / 12)})`);
    if (haloGradients.size >= 96) haloGradients.clear(); // (3D sizes change with the distance: do not grow without bound)
    haloGradients.set(key, grad);
  }
  const alpha = g.globalAlpha;
  g.globalAlpha = alpha * strength;
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, outer, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = alpha;
}
const haloGradients = new Map();

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
  const key = `${color}|${half}|${reach}`;
  let pair = tailHaloGradients.get(key);
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
    pair = { lin, rad };
    if (tailHaloGradients.size >= 96) tailHaloGradients.clear();
    tailHaloGradients.set(key, pair);
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
const tailHaloGradients = new Map();

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

// Fills PT with the outline of a note head and returns how many points it holds.
function outline(x, y, rx, ry, style) {
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
    if (style !== 'rect' && style !== 'tri') {
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
export const noteScale = (n) => (n.hopo ? HOPO_SCALE : 1);

// Star power notes: a white overlay at 80% over the lane colour (the colour and the centre still show through).
export const STAR_POWER_OVERLAY = 0.8;
export function starPowerColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * STAR_POWER_OVERLAY).toString(16).padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}
export const noteColor = (n, colors) => (n.sp ? starPowerColor(colors[n.lane]) : colors[n.lane]);

// The spans of `list` (chart.fills, chart.rolls) whose `key` is `value`, filtered once per chart instead of on every frame.
export function spansOfKind(chart, list, key, value) {
  const cache = (chart.spanKinds ??= new Map());
  const id = `${key}:${value}`;
  let hit = cache.get(id);
  if (!hit || hit.src !== list) { hit = { src: list, spans: (list || []).filter((x) => x[key] === value) }; cache.set(id, hit); }
  return hit.spans;
}

// Colour stops of the edge fades, built once (they were rebuilt as strings for every pane on every frame). The fade only uses alpha:
// it erases a layer or paints over the stage, so the colour is always black (see Highway.fadeStyle).
const fadeColor = (a) => `rgba(0,0,0,${a})`;
const smootherstep = (u) => u * u * u * (u * (u * 6 - 15) + 10);
export const BOTTOM_FADE_STOPS = [[0, 0], [0.3, 0.2], [0.6, 0.6], [0.85, 0.92], [1, 1]].map(([at, a]) => [at, fadeColor(a)]); // just below the pads
export const EDGE_FADE_STOPS = Array.from({ length: 13 }, (_, n) => { const u = n / 12; return [u, fadeColor((1 - smootherstep(u)).toFixed(3))]; }); // far edge of the board
export const LYRIC_RAMP_STOPS = Array.from({ length: 17 }, (_, n) => { const pos = n / 16; return [pos, fadeColor(1 - smootherstep(Math.pow(pos, 0.7)))]; }); // lyric sheet edges
