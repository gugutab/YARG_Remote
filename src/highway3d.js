// 3D view of the note highway: a perspective projection drawn on the same 2D canvas (no WebGL, no libraries),
// so it stays light enough for phones. Only the lane instruments (guitar, bass, keys, drums) have a highway;
// vocals keep the flat view. Like the 2D view, drawing is a pure function of the playback time.
import {
  NOTE_PALETTE, breAlpha, HELD_SCALE, drawYNote, YNOTE_SIDE_3D, TAPER_GAIN, drawCymbalFace, sprite3D, noteSpritePx, NOTE_RECT_W, NOTE_RECT_H, NOTE_TRI_W, NOTE_TRI_H, STAR_POWER_GOLD, ACCENT_OUTLINE_WIDTH,
  ACCENT_OUTLINE_DARKEN, GHOST_ALPHA, setDesaturated, isDesaturated, dcol, desaturate, exitTime, heldAmount, litFrom, noteDisabled, fillHalo, haloProfile, tailShimmer, HIT_FLASH_SEC, BAR_FLASH_SEC, PAD_FILL_ALPHA, PAD_RING_ALPHA, noteShape, heldPulse, ROLL_COLORS, FILL_COLORS, FILL_STRONG, FILL_BORDER, FILL_BORDER_LANES, BAND_BORDERS, ROLL_COLUMN_ALPHA, ROLL_LEAD_SEC, HIT_LINE_COLOR, HIT_LINE_BORDER, HIT_LINE_BORDER_SOFT, drawHitBurst, drawBarBurst, BURST_SEC, BAR_BURST_SEC, BURST_LOOP_SEC, BURST_VANISH_SEC, FILL_EDGE, FILL_ACTIVATION, drawActivationMark, FADE_SEC, firstVisibleIndex, spansOfKind, tintWhite, darken, withAlpha, noteScale, noteColor, BOTTOM_FADE_STOPS, EDGE_FADE_STOPS, fadeGradient, boardBase,
  laneLookFactor, HIT_Y
} from './gfx.js';

const DEPTH_SEC = 3.2; // seconds between the hit line and the far edge at neck speed 1 (the flat view shows 2.5)
const FAR_SCALE = 0.3; // size of things at the far edge relative to the hit line
const FAR_TOP = 0.05; // far edge position, as a fraction of the canvas height
const HEAD_R = 0.36; // note head radius, in lane widths
const RECT_SCALE = 1.15; // the rectangular notes (and the pads they land on) are this much larger than the other heads
const HEAD_TILT = 0.55; // vertical squash of the heads (they lie on the road)
const FADE_IN = 0.14; // fraction of the depth over which notes fade in at the far edge
const TAIL_TAPER_POWER = 3; // like the heads' TAPER_GAIN: about 3x the natural perspective change
const TAIL_MIN_WIDTH = 0.3; // a tail never gets thinner than this fraction of its base width
const ROAD_NEAR = -0.14; // the road starts below the canvas (past the pads), so it can fade out at the bottom
const ROAD_END = 1.8; // the road runs well past the last visible note, so it has no visible far edge: the fade hides the rest
const BAR_DEPTH = 0.0058; // a third thinner again (0.0087, itself a third of the earliest 0.026) // pedal/open bar thickness along the road, in depth units (it lies flat on the fretboard)
const GLOW_DEPTH = 0.009; // half-height of the hit glow (it was 0.026 and looked too tall)
const easeOut = (x) => 1 - (1 - x) ** 3;
const TAIL_RIGHT = new Float64Array(2 * 21); // scratch for taperedStrip
const NO_BEATS = [];
const FLASH = new Float64Array(16); // scratch of renderLanes3D: the light of each pad
const FILL_KINDS = Object.keys(FILL_COLORS);
const STAR_POWER_BAND_3D = 'rgba(255,176,0,0.17)'; // (the 3D bands are a little denser than the 2D ones)
const SOLO_BAND_3D = 'rgba(0,150,220,0.15)';
const ROLL_TYPES = Object.keys(ROLL_COLORS);
const HOPO_DOT = 'rgba(255,255,255,0.9)'; // the alpha of a HOPO dot while its note has not been hit yet (0.9 * (1 - 0))

// The metal edge under a cymbal disc (rectangular style): one vertical gradient from 0 to 1 per variant (plain, star power), built once.
const discEdges = [null, null, null]; // (plain, star power, star power desaturated)
function discEdgeGradient(g, sp) {
  const i = sp ? (isDesaturated() ? 2 : 1) : 0;
  if (!discEdges[i]) {
    const edge = g.createLinearGradient(0, 0, 0, 1);
    const m = sp ? ['#f0d060', '#a37c00', '#3d2e00'].map(i === 2 ? desaturate : (c) => c) : ['#d4dae1', '#7f8893', '#30353b'];
    edge.addColorStop(0, m[0]);
    edge.addColorStop(0.45, m[1]);
    edge.addColorStop(0.75, m[2]);
    edge.addColorStop(1, sp ? (i === 2 ? withAlpha(desaturate('#3d2e00'), 0.35) : 'rgba(61,46,0,0.35)') : 'rgba(48,53,59,0.35)'); // the metal fades into the road at the bottom: depth
    discEdges[i] = edge;
  }
  return discEdges[i];
}
// A stand-in for the context that `noteShape` draws its outline into, mapping y to (y - y0) * k: the outline is added under the gradient's
// translate(0, y0) + scale(1, 1 / k) in those unit coordinates, so it lands on the same pixels (filling a path added before the transform
// changes would rasterize its edges a little differently).
const unitY = {
  g: null, y0: 0, k: 1,
  moveTo(x, y) { this.g.moveTo(x, (y - this.y0) * this.k); },
  lineTo(x, y) { this.g.lineTo(x, (y - this.y0) * this.k); },
  closePath() { this.g.closePath(); },
  ellipse(x, y, rx, ry, rot, a0, a1) { this.g.ellipse(x, (y - this.y0) * this.k, rx, ry * this.k, rot, a0, a1); },
};

// The projection of the current call. These were closures made inside renderLanes3D on every frame (and every pane); as plain functions
// over a few module variables nothing is allocated, and the engine can inline them into the note loops.
let PK = 0; // 1 / FAR_SCALE - 1
let PVY = 0; // vanishing point, above the canvas
let PHIT = 0; // hit line
let PCX = 0; // centre of the road
let PLANE = 0; // lane width at the hit line
let PSEC = 1; // seconds between the hit line and the far edge
let PT = 0; // song time
let PC = 0; // downward curve of the road: an extra PC * d^2 px (down) at depth d > 0 (0 = a flat road; setting highway.curve)
let PEND = ROAD_END; // where the road stops: ROAD_END, or the crest of a curved road (past it the road would fold back down)
const scaleAt = (d) => 1 / (1 + PK * d); // perspective scale at depth d (0 = hit line, 1 = far edge)
const yAt = (d) => PVY + (PHIT - PVY) * scaleAt(d) + (d > 0 ? PC * d * d : 0);
const xAt = (lx, d) => PCX + lx * PLANE * scaleAt(d); // lx = lane units from the road's centre
const depth = (time) => Math.min(1, Math.max(0, (time - PT) / PSEC));
const CURVE_MAX = 0.9; // curve 100%: the road's slope on screen at the far edge (d = 1) is 10% of the flat one, so the crest stays past the notes
const CURVE_STEPS = 24; // at most this many segments per depth unit of a quad or line on a curved road
const CURVE_TOL = 0.15; // ...and only as many as keep a road edge within this many px of the true curve
let PSTEPS = CURVE_STEPS; // the segments per depth unit of the current projection (curveSteps)
// Segments per depth unit for the current projection: the polylines of a curved road cost GPU time per vertex (with 24 per unit the road, its
// stripes, lines and bands were about 1.5 ms of a 3-pane frame), and 24 is far finer than needed in most windows. The chord error of the road's
// outer edge (halfW lane units from the centre: the farthest from the centre, so the largest error) is measured at CURVE_STEPS once per
// projection; it falls with the square of the step count, which gives the fewest steps within CURVE_TOL (at least 4).
const curveStepsCache = new Map();
function curveSteps(halfW) {
  if (!(PC > 0)) return CURVE_STEPS;
  const key = `${PK}|${PVY}|${PHIT}|${PC}|${PEND}|${PLANE * halfW}`;
  let n = curveStepsCache.get(key);
  if (n === undefined) {
    const px = (d) => PCX + halfW * PLANE / (1 + PK * d);
    const py = (d) => PVY + (PHIT - PVY) / (1 + PK * d) + (d > 0 ? PC * d * d : 0);
    const segs = Math.ceil((PEND - ROAD_NEAR) * CURVE_STEPS);
    let err = 0;
    for (let i = 0; i < segs; i++) {
      const a = ROAD_NEAR + ((PEND - ROAD_NEAR) * i) / segs, b = ROAD_NEAR + ((PEND - ROAD_NEAR) * (i + 1)) / segs;
      const ax = px(a), ay = py(a), dx = px(b) - ax, dy = py(b) - ay, len = Math.hypot(dx, dy) || 1;
      for (let k = 1; k < 8; k++) { const d = a + ((b - a) * k) / 8; err = Math.max(err, Math.abs(dx * (py(d) - ay) - dy * (px(d) - ax)) / len); }
    }
    n = Math.max(4, Math.min(CURVE_STEPS, Math.ceil(CURVE_STEPS * Math.sqrt(err / CURVE_TOL))));
    if (curveStepsCache.size >= 16) curveStepsCache.delete(curveStepsCache.keys().next().value);
    curveStepsCache.set(key, n);
  }
  return n;
}

// The projection for a pane: `h` its height, `hitY` the hit line, `strength` the perspective (setting highway.perspective / 100: 1 = the
// classic FAR_SCALE) and `curve` the downward bend (highway.curve / 100). The far edge (d = 1) of a flat road stays at FAR_TOP and the hit
// line at hitY for every strength; only how fast things shrink with depth changes. Returns { k, vy, c, end }: the scale at depth d is
// 1 / (1 + k d), y = vy + (hitY - vy) * scale + (d > 0 ? c d^2 : 0), and `end` is the depth where the road stops (the crest of a curved one).
export function projection3D(h, hitY, strength = 1, curve = 0) {
  const far = Math.min(0.6, Math.max(0.12, FAR_SCALE / strength));
  const k = 1 / far - 1;
  const vy = (h * FAR_TOP - far * hitY) / (1 - far); // vanishing point, above the canvas
  if (!(curve > 0)) return { k, vy, c: 0, end: ROAD_END };
  const a = (hitY - vy) * k; // -dy/dd of the flat road is a / (1 + k d)^2
  const c = (Math.min(1, curve) * CURVE_MAX * a) / (2 * (1 + k) ** 2); // the curve's slope 2 c d cancels CURVE_MAX of it at d = 1
  // the crest: where 2 c d (1 + k d)^2 = a (past it y would grow again); it is past d = 1, found by bisection
  let lo = 1, hi = ROAD_END;
  if (2 * c * hi * (1 + k * hi) ** 2 < a) return { k, vy, c, end: ROAD_END };
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (2 * c * m * (1 + k * m) ** 2 < a) lo = m; else hi = m; }
  return { k, vy, c, end: lo };
}

// (The projection is written out in the loops below, with the scale kept in a local: as calls, the engine ran out of inlining room in these
// big functions and every x, y and scale came back boxed as a new number, thousands of them per held note per frame. Same operations, same results.)
function quad(g, d0, d1, lx0, lx1) {
  if (PC > 0) { curvedQuad(g, d0, d1, lx0, lx1); return; }
  const s0 = 1 / (1 + PK * d0);
  const s1 = 1 / (1 + PK * d1);
  const y0 = PVY + (PHIT - PVY) * s0;
  const y1 = PVY + (PHIT - PVY) * s1;
  g.beginPath?.(); // (g may be a Path2D: see roadPaths)
  g.moveTo(PCX + lx0 * PLANE * s0, y0);
  g.lineTo(PCX + lx1 * PLANE * s0, y0);
  g.lineTo(PCX + lx1 * PLANE * s1, y1);
  g.lineTo(PCX + lx0 * PLANE * s1, y1);
  g.closePath();
}
// The same quad on a curved road: both sides are polylines that follow the curve (cut at the crest).
function curvedQuad(g, d0, d1, lx0, lx1) {
  d0 = Math.min(d0, PEND);
  d1 = Math.min(d1, PEND);
  const n = Math.max(1, Math.ceil(Math.abs(d1 - d0) * PSTEPS));
  g.beginPath?.();
  for (let i = 0; i <= n; i++) {
    const d = d0 + ((d1 - d0) * i) / n;
    const s = 1 / (1 + PK * d);
    const y = PVY + (PHIT - PVY) * s + (d > 0 ? PC * d * d : 0);
    if (i === 0) g.moveTo(PCX + lx0 * PLANE * s, y);
    else g.lineTo(PCX + lx0 * PLANE * s, y);
  }
  for (let i = n; i >= 0; i--) {
    const d = d0 + ((d1 - d0) * i) / n;
    const s = 1 / (1 + PK * d);
    g.lineTo(PCX + lx1 * PLANE * s, PVY + (PHIT - PVY) * s + (d > 0 ? PC * d * d : 0));
  }
  g.closePath();
}
// A line along the road at lx lane units from the centre, from ROAD_NEAR to the road's end (added to the current path).
function roadLine(g, lx) {
  g.moveTo(xAt(lx, ROAD_NEAR), yAt(ROAD_NEAR));
  if (PC > 0) for (let i = 1, n = Math.ceil((PEND - ROAD_NEAR) * PSTEPS); i <= n; i++) { const d = ROAD_NEAR + ((PEND - ROAD_NEAR) * i) / n; g.lineTo(xAt(lx, d), yAt(d)); }
  else g.lineTo(xAt(lx, ROAD_END), yAt(ROAD_END));
}
// The board's fixed shapes for the current projection, as Path2D objects kept between frames: the road (also the dark base), the lane stripes,
// the lane dividers and the rails. On a curved road (the default) these are long polylines, and rebuilding them as the context's own path every
// frame made the GPU canvas tessellate them again each time (about a third of the frame of 3 panes in a dense part); a Path2D that is filled
// again lets the canvas reuse that work. Same geometry, same pixels. Keyed by everything the geometry depends on (a resize makes a new entry).
const roadPaths = new Map();
function roadPathsFor(lanes, half, stripes) {
  const key = `${lanes}|${stripes ? 1 : 0}|${PK}|${PVY}|${PHIT}|${PCX}|${PLANE}|${PC}|${PEND}`;
  let p = roadPaths.get(key);
  if (!p) {
    p = { road: new Path2D(), stripes: new Path2D(), dividers: new Path2D(), rails: new Path2D() };
    quad(p.road, ROAD_NEAR, PEND, -half, half);
    for (let i = 0; i < lanes && stripes; i += 2) quad(p.stripes, ROAD_NEAR, PEND, i - half, i + 1 - half); // (disjoint: one fill draws what one fill each did)
    for (let i = 1; i < lanes; i++) roadLine(p.dividers, i - half);
    for (let i = 0; i < 2; i++) roadLine(p.rails, i === 0 ? -half : half);
    if (roadPaths.size >= 16) roadPaths.delete(roadPaths.keys().next().value); // (panes of several sizes, a window being resized)
    roadPaths.set(key, p);
  }
  return p;
}
// A tail strip with the same extra perspective taper the note heads get (see noteShape): relative to the strip's base
// (dRef, where the head is), its width shrinks with (scale / baseScale) ^ TAIL_TAPER_POWER, never below TAIL_MIN_WIDTH.
const tailFactor = (d, dRef) => TAIL_MIN_WIDTH + (1 - TAIL_MIN_WIDTH) * (scaleAt(d) / scaleAt(dRef)) ** TAIL_TAPER_POWER;
function taperedStrip(g, d0, d1, mid, wl, dRef) {
  const N = 20;
  const right = TAIL_RIGHT; // (reused: x, y pairs)
  const sRef = 1 / (1 + PK * dRef);
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const d = d0 + ((d1 - d0) * i) / N;
    const sc = 1 / (1 + PK * d);
    const halfW = wl * (TAIL_MIN_WIDTH + (1 - TAIL_MIN_WIDTH) * (sc / sRef) ** TAIL_TAPER_POWER); // (tailFactor)
    const y = PVY + (PHIT - PVY) * sc + (d > 0 ? PC * d * d : 0);
    if (i === 0) g.moveTo(PCX + (mid - halfW) * PLANE * sc, y);
    else g.lineTo(PCX + (mid - halfW) * PLANE * sc, y);
    right[2 * i] = PCX + (mid + halfW) * PLANE * sc;
    right[2 * i + 1] = y;
  }
  for (let i = N; i >= 0; i--) g.lineTo(right[2 * i], right[2 * i + 1]);
  g.closePath();
}
// The 'flow' tail style (setting highway.tailStyle): a body in the lane colour with a lighter core and spine and a rounded tip, built from a
// few segments and filled in batches (one fill per body colour, one for every core, one for every spine), plus, on a held tail only, chevrons
// that run down it towards the hit line, a soft halo and a glow where it meets the hit line. All a pure function of the time.
export const FLOW_PERIOD = 0.1; // seconds between two chevrons passing the same point
export const FLOW_SPACING = 0.18; // chart seconds between two chevrons along the tail (they run at SPACING / PERIOD = 1.8x the notes' speed, so they flow down the tail)
const FLOW_CHEVRONS = 12; // at most this many on one tail
const FLOW_TIP = 1.1; // the tip's length beyond the tail's end, in half widths
// The chevrons' phase at time t, 0..1 (periodic, FLOW_PERIOD).
export const flowPhase = (t) => { const x = t / FLOW_PERIOD; return x - Math.floor(x); };
// Chevron k's distance ahead of the hit line at time t, in chart seconds: it grows as t grows (the chevrons run UP the tail, away from the hit line),
// and chevron k takes the place of chevron k + 1 after one period.
export const flowPulseAt = (k, t) => FLOW_SPACING * (k + flowPhase(t));
// The swelling of a held tail: waves that inflate and deflate its width, travelling up the tail. `ahead` = chart seconds ahead of the hit line.
export const WAVE_LEN = 0.45; // chart seconds from one swelling to the next
export const WAVE_PERIOD = 0.6; // seconds of song time for a wave to travel one length
export const WAVE_AMP = 0.26; // at full held amount the width swings by +- this (a fraction of the width)
export const waveFactor = (ahead, t, amp = WAVE_AMP) => 1 + amp * Math.sin(2 * Math.PI * (ahead / WAVE_LEN - t / WAVE_PERIOD));
// Segments of one side of a flow tail `lenPx` pixels long on screen: a straight road needs few (the taper is the only bend), a curved one one more.
export const tailSegments = (lenPx, curved) => Math.max(1, Math.min(6, Math.ceil(lenPx / 90) + (curved ? 1 : 0)));
// Segments of a swelling (held) tail: about `points` per wave (5 at full quality), capped at 30, and never denser than one per 3 px of the
// tail on screen (a short tail's waves are too small to see; the cap only bites below 90 px).
export const waveSegments = (lenPx, curved, spanSec, points = 5) => Math.min(30, Math.max(tailSegments(lenPx, curved), Math.min(Math.ceil((spanSec / WAVE_LEN) * points), Math.ceil(lenPx / 3))));
// The visible flow tails of the frame (columns, reused): depths, centre and half width in lane units, segments, tip, body fill, amount held
const FT = { n: 0, d0: [], d1: [], mid: [], wl: [], segs: [], tip: [], body: [], amt: [], col: [], wave: [], off: [] };
const FT_BODIES = []; // the distinct body fills of the frame
// One flow tail outline as a subpath of the current path (no beginPath): the tapered sides sampled closer together near the base, where
// both the width and the screen position change fastest, and a rounded tip when `tip`.
function flowStrip(g, k, mult, waveMul = 1) {
  const ft = FT, right = FLOW_RIGHT, o = ft.off[k], segs = ft.segs[k], wl = ft.wl[k] * mult, wave = ft.wave[k] * waveMul;
  let halfPx = 0, xe = 0, ye = 0;
  for (let i = 0; i <= segs; i++) {
    halfPx = wl * SMP_W[o + i] * (wave > 0 ? 1 + wave * SMP_S[o + i] : 1); // (tailFactor, and the wave of a held tail)
    const xm = SMP_X[o + i], y = SMP_Y[o + i];
    if (i === 0) g.moveTo(xm - halfPx, y);
    else g.lineTo(xm - halfPx, y);
    right[2 * i] = xm + halfPx;
    right[2 * i + 1] = y;
    xe = xm; ye = y;
  }
  if (ft.tip[k]) {
    const ty = halfPx * FLOW_TIP;
    g.lineTo(xe - 0.7 * halfPx, ye - 0.7 * ty);
    g.lineTo(xe, ye - ty);
    g.lineTo(xe + 0.7 * halfPx, ye - 0.7 * ty);
  }
  for (let i = segs; i >= 0; i--) g.lineTo(right[2 * i], right[2 * i + 1]);
  g.closePath();
}
// The sample points of tail k, computed once per frame and shared by the halo, body, core and spine strips (they differ only in width and
// wave amplitude): centre x, y, the unit half width in pixels (taper and perspective) and the wave's sine.
const FLOW_RIGHT = new Float64Array(2 * 32); // scratch for the right side (segs <= 30)
let SMP_X = new Float64Array(256), SMP_Y = new Float64Array(256), SMP_W = new Float64Array(256), SMP_S = new Float64Array(256);
function sampleFlowTail(k, off, t) {
  const ft = FT, segs = ft.segs[k], d0 = ft.d0[k], d1 = ft.d1[k], mid = ft.mid[k], wave = ft.wave[k];
  if (off + segs + 1 > SMP_X.length) { // (grow: rare)
    const n = Math.max(SMP_X.length * 2, off + segs + 1);
    const grow = (a) => { const b = new Float64Array(n); b.set(a); return b; };
    SMP_X = grow(SMP_X); SMP_Y = grow(SMP_Y); SMP_W = grow(SMP_W); SMP_S = grow(SMP_S);
  }
  ft.off[k] = off;
  const sRef = 1 / (1 + PK * d0);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const d = d0 + (d1 - d0) * (wave > 0 ? u : u * u); // (a swelling tail is sampled evenly: the waves need the points)
    const sc = 1 / (1 + PK * d);
    SMP_W[off + i] = (TAIL_MIN_WIDTH + (1 - TAIL_MIN_WIDTH) * (sc / sRef) ** TAIL_TAPER_POWER) * PLANE * sc;
    SMP_S[off + i] = wave > 0 ? Math.sin(2 * Math.PI * ((d - d0) * PSEC / WAVE_LEN - t / WAVE_PERIOD)) : 0;
    SMP_Y[off + i] = PVY + (PHIT - PVY) * sc + (d > 0 ? PC * d * d : 0);
    SMP_X[off + i] = PCX + mid * PLANE * sc;
  }
  return off + segs + 1;
}
// Draws the sustains of notes[from .. end) in the flow style. Static tails cost (body colours + 2) fills in all; a held one adds a halo,
// its chevrons and its contact glow.
function drawFlowTails(g, hw, notes, from, end, t, colors, half, headR, tailW, windowSec, held) {
  const ft = FT;
  ft.n = 0;
  FT_BODIES.length = 0;
  let anyHeld = false;
  const curved = PC > 0;
  for (let vi = from; vi < end; vi++) {
    const n = notes[vi];
    if (!n.length || n.lane < 0) continue;
    const dTop = Math.min(depth(n.time + n.length), PEND);
    const dBot = depth(Math.max(n.time, t));
    if (dTop <= dBot) continue;
    setDesaturated(hw.disabledNote(n)); // disabled notes lose their colour
    if (n.open) {
      g.fillStyle = withAlpha(NOTE_PALETTE.open, 0.3);
      quad(g, dBot, dTop, -half, half);
      g.fill();
      continue;
    }
    const lenPx = (PVY + (PHIT - PVY) / (1 + PK * dBot) + (dBot > 0 ? PC * dBot * dBot : 0)) - (PVY + (PHIT - PVY) / (1 + PK * dTop) + PC * dTop * dTop);
    if (lenPx < 1) continue; // (nothing to see)
    const amt = heldAmount(n, t);
    const col = noteColor(n, colors);
    const k = ft.n++;
    ft.d0[k] = dBot;
    ft.d1[k] = dTop;
    ft.mid[k] = n.lane + 0.5 - half;
    ft.wl[k] = headR * noteScale(n) * 0.38 * tailW * (1 + 0.04 * amt); // (HOPO notes are smaller; a held tail is a touch wider, and swells in waves)
    ft.wave[k] = held ? WAVE_AMP * amt : 0; // (the waves stand still-free: they only run while the held motion is on)
    ft.segs[k] = ft.wave[k] > 0 ? waveSegments(lenPx, curved, (dTop - dBot) * PSEC, hw.tailWavePoints) : tailSegments(lenPx, curved);
    ft.tip[k] = n.time + n.length <= t + windowSec;
    const body = withAlpha(col, Math.round((0.6 + 0.3 * amt) * 20) / 20); // (bucketed, so held tails batch too)
    ft.body[k] = body;
    ft.amt[k] = amt;
    ft.col[k] = col;
    if (amt > 0) anyHeld = true;
    if (!FT_BODIES.includes(body)) FT_BODIES.push(body);
  }
  if (ft.n === 0) return;
  for (let k = 0, off = 0; k < ft.n; k++) off = sampleFlowTail(k, off, t);
  setDesaturated(false); // (the body fills were made above, per note; only held tails, never disabled, take a colour below)
  // held: a soft halo under the body
  if (anyHeld) {
    for (let k = 0; k < ft.n; k++) {
      if (!(ft.amt[k] > 0)) continue;
      g.fillStyle = withAlpha(ft.col[k], Math.round(0.16 * ft.amt[k] * 100) / 100);
      g.beginPath();
      flowStrip(g, k, 1.9);
      g.fill();
    }
  }
  // the bodies, one fill per colour
  for (let b = 0; b < FT_BODIES.length; b++) {
    const body = FT_BODIES[b];
    g.fillStyle = body;
    g.beginPath();
    for (let k = 0; k < ft.n; k++) if (ft.body[k] === body) flowStrip(g, k, 1);
    g.fill();
  }
  // a lighter core and a bright spine, white over every colour at once
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.16;
  g.beginPath();
  for (let k = 0; k < ft.n; k++) flowStrip(g, k, 0.55);
  g.fill();
  g.globalAlpha = 0.42;
  g.beginPath();
  for (let k = 0; k < ft.n; k++) flowStrip(g, k, 0.16, 0.5);
  g.fill();
  g.globalAlpha = 1;
  if (!anyHeld) return;
  // held: chevrons running UP the tail (still when the held motion is off), growing in at the hit line and shrinking at the far end.
  // Each is a V pointing away from the hit line, laid out on screen along the tail's direction and sized by the tail's width there.
  const ph = held ? flowPhase(t) : 0;
  for (let k = 0; k < ft.n; k++) {
    const amt = ft.amt[k];
    if (!(amt > 0)) continue;
    const mid = ft.mid[k], wl = ft.wl[k] * 1.05, d1 = ft.d1[k];
    const left = d1 * PSEC; // chart seconds of tail ahead of the hit line
    const s1 = 1 / (1 + PK * d1);
    const bx = PCX + mid * PLANE, ex = PCX + mid * PLANE * s1, ey = PVY + (PHIT - PVY) * s1 + PC * d1 * d1;
    const len = Math.hypot(ex - bx, ey - PHIT) || 1;
    const ux = (ex - bx) / len, uy = (ey - PHIT) / len; // along the tail, away from the hit line
    g.globalAlpha = 0.75 * amt;
    g.fillStyle = tintWhite(ft.col[k], 0.75);
    g.beginPath();
    for (let c = 0; c < FLOW_CHEVRONS; c++) {
      const x = FLOW_SPACING * (c + ph);
      if (x >= left) break;
      const f = Math.min(1, (left - x) / 0.12, x / 0.06); // grows in at the hit line, shrinks towards the far end
      if (!(f > 0)) continue;
      const d = x / PSEC;
      const sc = 1 / (1 + PK * d);
      const hp = wl * (TAIL_MIN_WIDTH + (1 - TAIL_MIN_WIDTH) * sc ** TAIL_TAPER_POWER) * PLANE * sc * f; // half width in px (the held tail's base is the hit line)
      const px = PCX + mid * PLANE * sc, py = PVY + (PHIT - PVY) * sc + PC * d * d;
      const vee = 1.1 * hp, th = 0.85 * hp; // the depth of the V and the chevron's thickness, in px along the tail
      g.moveTo(px, py);
      g.lineTo(px + hp - ux * vee, py - uy * vee);
      g.lineTo(px + hp - ux * (vee + th), py - uy * (vee + th));
      g.lineTo(px - ux * th, py - uy * th);
      g.lineTo(px - hp - ux * (vee + th), py - uy * (vee + th));
      g.lineTo(px - hp - ux * vee, py - uy * vee);
      g.closePath();
    }
    g.fill();
  }
  // held: the contact glow where the tail meets the hit line (additive, one small ellipse each)
  g.globalCompositeOperation = 'lighter';
  const flick = held ? 0.85 + 0.15 * Math.sin(t * 22) : 1;
  for (let k = 0; k < ft.n; k++) {
    const amt = ft.amt[k];
    if (!(amt > 0)) continue;
    const rx = ft.wl[k] * 2.4 * PLANE;
    g.globalAlpha = 0.5 * amt * flick;
    g.fillStyle = ft.col[k];
    g.beginPath();
    g.ellipse(PCX + ft.mid[k] * PLANE, PHIT, rx, rx * HEAD_TILT * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
}
// A drum fill band: a full-strength quad from the phrase start to the activation chord (no fades), with a thin bright line
// across the road at the start and end.
function fillBand3D(g, spans, color, xl, xr, roadW) {
  if (!spans) return;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const end = s.bandEnd ?? s.end; // (to the activation note when there is one)
    if ((end - PT) / PSEC < ROAD_NEAR || s.start > PT + PSEC) continue;
    const d0 = (s.start - PT) / PSEC, d1 = (end - PT) / PSEC;
    const piece = (a, b, k, col, bx0, bx1) => { // [a, b] in depth, clamped to the road, at k of the band's alpha, over the lane range bx0..bx1
      const lo = Math.max(ROAD_NEAR, a);
      if (b <= lo) return;
      g.globalAlpha *= k;
      g.fillStyle = col;
      quad(g, lo, b, bx0, bx1);
      g.fill();
      g.globalAlpha /= k;
    };
    const band = (col, bx0, bx1) => piece(d0, d1, 1, col, bx0, bx1); // hard edges at both ends: visible in full as soon as it comes in, no fade
    band(color, xl, xr);
    { // green borders on both sides of the road along the fill
      const lo = Math.max(ROAD_NEAR, d0);
      if (d1 > lo) { g.fillStyle = FILL_BORDER; quad(g, lo, d1, xl - FILL_BORDER_LANES, xl + FILL_BORDER_LANES * 0.4); g.fill(); quad(g, lo, d1, xr - FILL_BORDER_LANES * 0.4, xr + FILL_BORDER_LANES); g.fill(); }
    }
    if (s.activationLane !== undefined) { // the lead-up: a stronger green over the column of the final note, along the whole fill (every column for the kick)
      const lanes = xr - xl;
      const inside = s.activationLane >= 0 && s.activationLane < lanes;
      band(FILL_STRONG, inside ? xl + s.activationLane : xl, inside ? xl + s.activationLane + 1 : xr);
    }
    g.fillStyle = FILL_EDGE;
    for (const dd of [d0, d1]) {
      if (dd < ROAD_NEAR || dd > 1) continue;
      const p = scaleAt(dd);
      g.fillRect(PCX + xl * PLANE * p, PVY + (PHIT - PVY) * p + (dd > 0 ? PC * dd * dd : 0) - 1.5 * p, roadW * p, 3 * p);
    }
  }
}
// Bands (star power, solo, fills, rolls) that run along the road, to the end of the board.
function span(g, spans, color, xl, xr, border = null) { // xl..xr: the lane range in lane units (-half..half is the whole road)
  g.fillStyle = color;
  if (!spans) return;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if ((s.end - PT) / PSEC < ROAD_NEAR || s.start > PT + PSEC) continue;
    const near = Math.max(ROAD_NEAR, Math.min(1, (s.start - PT) / PSEC)); // the band goes on past the hit line, to the end of the board
    quad(g, near, Math.min(1, (s.end - PT) / PSEC), xl, xr); // (the far end is not clamped at the hit line: the band runs on past it, off the board)
    g.fill();
  }
  if (border && BORDERS3D) sideBorders3D(g, spans, border, border, xl, xr);
}
// The background of the lane(s) a roll is played on, in the colour of that lane's notes (every lane in the kick colour for a kick roll).
function rollColumns3D(g, spans, cols, kickCol, half, lanes) {
  if (!spans) return;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (!s.lanes || (s.end + ROLL_LEAD_SEC - PT) / PSEC < ROAD_NEAR || s.start - ROLL_LEAD_SEC > PT + PSEC) continue;
    const near = Math.max(ROAD_NEAR, Math.min(1, (s.start - ROLL_LEAD_SEC - PT) / PSEC));
    const far = Math.min(1, (s.end + ROLL_LEAD_SEC - PT) / PSEC);
    if (far <= near) continue;
    for (const l of s.lanes) {
      g.fillStyle = withAlpha(l >= 0 && l < lanes ? cols[l] : kickCol, ROLL_COLUMN_ALPHA);
      if (l >= 0 && l < lanes) quad(g, near, far, -half + l, -half + l + 1); else quad(g, near, far, -half, half);
      g.fill();
    }
  }
}
let BORDERS3D = true; // setting highway.bandBorders, set per frame
// Thick borders on both sides of the road along each span (left / right colour), like the drum fill's green ones.
function sideBorders3D(g, spans, left, right, xl, xr) {
  if (!spans) return;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if ((s.end - PT) / PSEC < ROAD_NEAR || s.start > PT + PSEC) continue;
    const near = Math.max(ROAD_NEAR, Math.min(1, (s.start - PT) / PSEC));
    const far = depth(s.end);
    if (far <= near) continue;
    g.fillStyle = left;
    quad(g, near, far, xl - FILL_BORDER_LANES, xl + FILL_BORDER_LANES * 0.4);
    g.fill();
    g.fillStyle = right;
    quad(g, near, far, xr - FILL_BORDER_LANES * 0.4, xr + FILL_BORDER_LANES);
    g.fill();
  }
}
// A head of the 3D view (not the rectangular note): its edge underneath, the top face and the outline. `disc`: a cymbal of the rectangular style (a chrome
// disc with a metal edge); headStyle: the outline (cymbals of the other styles: a rounded triangle).
function drawHead3D(g, x, y, rx, ry, vy, n, colors, body, lw, disc, headStyle) {
  // thickness: a thin darker edge underneath the top face (no cast shadow; all of it moves, grows and fades with the note)
  const th = Math.max(0.5, rx * (disc ? 0.27 : 0.21)); // (a little thicker in the rectangular style)
  if (disc) { // the rectangular style: the edge under the disc is metal like the caps (not a dark shade of the colour)
    const y0 = y + ry * 0.4; // the gradient runs from y0 down to y + th + ry: a unit gradient (0..1) under that translate and scale
    const span = y + th + ry - y0;
    g.save();
    g.translate(0, y0);
    g.scale(1, span);
    g.beginPath();
    unitY.g = g; unitY.y0 = y0; unitY.k = 1 / span;
    noteShape(unitY, x, y + th, rx, ry, headStyle, y + th - vy);
    unitY.g = null;
    g.fillStyle = discEdgeGradient(g, n.sp);
    g.fill();
    g.restore();
  } else {
    g.beginPath();
    noteShape(g, x, y + th, rx, ry, headStyle, y + th - vy);
    g.fillStyle = darken(n.tap && !n.sp ? NOTE_PALETTE.tap : colors[n.lane], 0.45); // the edge keeps the plain lane colour (no star power overlay)
    g.fill();
  }
  g.beginPath();
  noteShape(g, x, y, rx, ry, headStyle, y - vy);
  g.fillStyle = body;
  g.fill();
  if (disc) drawCymbalFace(g, x, y, rx, ry, n, colors[n.lane]);
  g.lineWidth = lw;
  g.strokeStyle = n.accent ? darken(colors[n.lane], ACCENT_OUTLINE_DARKEN) : 'rgba(0,0,0,0.5)';
  g.stroke();
}

// The HOPO dot on a head (kx: the head's exit, 0..1).
function hopoDot(g, x, y, rx, ry, style, dist, kx) {
  g.beginPath();
  noteShape(g, x, y, rx * 0.35, ry * 0.35, style, dist);
  g.fillStyle = kx === 0 ? HOPO_DOT : `rgba(255,255,255,${0.9 * (1 - kx)})`;
  g.fill();
}
// The half extent of a drawHead3D picture around its centre, in units of rx (see sprite3D): the shape (a triangle is wider and flatter), its edge
// underneath (th, at least 0.5 px), the perspective taper of the lowest row and the outline.
function headExtentX(style, rx, dist, lw) {
  const w = style === 'tri' ? NOTE_TRI_W : 1;
  const below = (style === 'tri' ? NOTE_TRI_H : 1) * HEAD_TILT + 0.21 + 0.5 / rx;
  return w * (1 + (TAPER_GAIN * below * rx) / dist) + lw / rx;
}
function headExtentY(style, rx, lw) {
  return (style === 'tri' ? NOTE_TRI_H : 1) * HEAD_TILT + 0.21 + 0.5 / rx + lw / rx;
}

export function renderLanes3D(hw, t, w, h) {
  const g = hw.g;
  const chart = hw.chart;
  const lanes = chart.lanes;
  const portrait = h > w;
  // Road width at the hit line. It grows with the window (0.9 of a narrow one, leaving a margin for the hit line's end indicators), then more slowly, and stops at 1.2 of the height:
  // no jump when the window passes from taller than wide to wider than tall, and past the cap only the side gaps grow.
  const roadW = portrait ? w * 0.9 : Math.min(h * 1.2, h * 0.9 + (w - h) * 0.3);
  const laneW = roadW / lanes;
  const headR = HEAD_R * hw.noteSize; // (setting highway.noteScale: heads and pads)
  const padRy = laneW * headR * 1.05 * HEAD_TILT; // vertical radius of the hit pads
  // The hit line (the pads) sits at HIT_Y of the pane's height, the same fraction as in 2D, so the panes of a stage (different instruments, different widths) stay aligned whatever the
  // resize. The pads are cut by the pane's bottom edge a little, as the road fades out there.
  const hitY = h * HIT_Y;
  const cx = w / 2;
  const windowSec = (DEPTH_SEC / hw.neck) * laneLookFactor(h); // neck speed shortens or stretches the visible time; a taller window shows more of it (fixed pixel speed)
  const proj = projection3D(h, hitY, hw.perspective, hw.curve); // (settings highway.perspective and highway.curve)
  PK = proj.k;
  PVY = proj.vy; // vanishing point, above the canvas
  PC = proj.c;
  PEND = proj.end;
  PHIT = hitY;
  PCX = cx;
  PLANE = laneW;
  PSEC = windowSec;
  PT = t;
  const vy = PVY;
  const half = lanes / 2;
  PSTEPS = curveSteps(half);

  // In a long rest the whole board turns more transparent together (see Highway.restBoard)
  const boardK = hw.restBoard(t, windowSec);
  g.globalAlpha = boardK;
  // road (its dark base is added at the very end, behind everything, so the edge fades do not thin it)
  const roadP = roadPathsFor(lanes, half, hw.laneStripes); // (setting highway.laneStripes)
  g.fillStyle = 'rgba(255,255,255,0.045)';
  g.fill(roadP.road);
  if (hw.laneStripes) g.fill(roadP.stripes);
  BORDERS3D = hw.bandBorders;
  if (hw.starPowerBand) span(g, chart.starPower, STAR_POWER_BAND_3D, -half, half, BAND_BORDERS.starPower);
  else if (BORDERS3D) sideBorders3D(g, chart.starPower, BAND_BORDERS.starPower, BAND_BORDERS.starPower, -half, half); // (the gold borders mark the phrase even when its tint is off, the default)
  if (hw.soloBand) span(g, chart.solos, SOLO_BAND_3D, -half, half, BAND_BORDERS.solo);
  for (let i = 0; i < FILL_KINDS.length; i++) {
    if (FILL_KINDS[i] === 'fill' && !hw.fillBand) continue;
    if (FILL_KINDS[i] === 'bre' && hw.breBand === 'off') continue;
    const spans = spansOfKind(chart, FILL_KINDS[i] === 'fill' ? chart.fillBands ?? chart.fills : chart.fills, 'kind', FILL_KINDS[i]); // (fills without their own activation chord are not shown, like YARG)
    if (FILL_KINDS[i] === 'bre') { // the big rock ending: every lane in its own colour, pulsing (breAlpha)
      const cols = chart.laneColors || NOTE_PALETTE.lanes;
      const pulseBre = hw.breBand === 'pulse';
      for (let l = 0; l < lanes; l++) span(g, spans, withAlpha(cols[l] || cols[0], breAlpha(t, l, lanes, pulseBre)), -half + l, -half + l + 1);
      if (BORDERS3D) sideBorders3D(g, spans, cols[0], cols[lanes - 1] || cols[0], -half, half); // (the outer edges take the first and last lane colours)
    } else fillBand3D(g, spans, FILL_COLORS[FILL_KINDS[i]], -half, half, roadW);
  }
  for (let i = 0; i < ROLL_TYPES.length; i++) {
    const rs = spansOfKind(chart, chart.rolls, 'type', ROLL_TYPES[i]);
    rollColumns3D(g, rs, chart.laneColors || NOTE_PALETTE.lanes, chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick, half, lanes);
  }

  // lane dividers and rails
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.stroke(roadP.dividers);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.stroke(roadP.rails);

  // beat and measure lines
  const beatStyle = hw.beatStyles['3d']; // (setting highway.beatLines: null = off)
  const beats = beatStyle ? chart.beats : NO_BEATS;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (b.time < t || b.time > t + windowSec) continue;
    const d = depth(b.time);
    const p = scaleAt(d);
    g.fillStyle = b.measure ? beatStyle[0] : b.strong ? beatStyle[1] : beatStyle[2];
    const bh = b.measure ? 3 : b.strong ? 2 : 1;
    g.fillRect(PCX + -half * PLANE * p, PVY + (PHIT - PVY) * p + (d > 0 ? PC * d * d : 0) - (bh / 2) * p, roadW * p, bh * p);
  }

  g.globalAlpha = 1;

  // notes that can still be seen
  const from = firstVisibleIndex(chart.notes, t, hw.maxLength);
  const notes = chart.notes;
  let end = from; // the notes that can be seen are notes[from .. end)
  while (end < notes.length && notes[end].time <= t + windowSec) end++;
  const colors = chart.laneColors || NOTE_PALETTE.lanes;
  const held = hw.heldMotion; // (setting highway.heldPulse: off keeps the held head, tail and pad still)
  const shimmer = held ? tailShimmer(t) : 0.5; // (the same for every note of the frame)
  const pulse = held ? heldPulse(t) : HELD_SCALE;
  const flicker = held ? 0.15 * Math.sin(t * 22) : 0;
  const tailW = hw.sustainWidth; // (setting highway.sustainWidth)
  const barDepth = BAR_DEPTH * hw.kickBar; // (setting highway.kickBarHeight)

  // hit zone: a bar across the road and one pad per lane, lit while a note is being hit
  const flash = FLASH;
  flash.fill(0, 0, lanes);
  let barFlash = 0; // a pedal or open hit lights the whole zone
  for (let vi = from; vi < end; vi++) {
    const n = notes[vi];
    const past = t - n.time;
    if (past < litFrom || noteDisabled(n)) continue; // (see setLitLag; a disabled note, replayed or after the loop end, is never hit)
    if (n.activation && hw.fillActivation && past < BAR_FLASH_SEC && 1 - past / BAR_FLASH_SEC > barFlash) barFlash = 1 - past / BAR_FLASH_SEC; // a fill's activation note lights the whole kit
    if (n.lane >= 0 && !n.open) flash[n.lane] = Math.max(flash[n.lane], heldAmount(n, t) * (0.75 + flicker));
    if (n.lane >= 0 && !n.open) {
      if (past < HIT_FLASH_SEC) flash[n.lane] = Math.max(flash[n.lane], 1 - past / HIT_FLASH_SEC);
    } else if (past < BAR_FLASH_SEC && 1 - past / BAR_FLASH_SEC > barFlash) {
      barFlash = 1 - past / BAR_FLASH_SEC;
    }
  }
  // (the pads mark the spot; a pedal hit lights every pad)
  const padRx = laneW * headR;
  for (let i = 0; i < lanes && !hw.hitLine; i++) { // (with the hit line bar on, its coloured segments replace the pads)
    const x = cx + (i + 0.5 - half) * laneW;
    g.beginPath();
    const cymbalPad = chart.laneKinds?.[i] === 'cymbal';
    const pk = !cymbalPad && hw.noteStyle === 'rect' ? RECT_SCALE : 1; // (the rectangular pads match the larger notes)
    noteShape(g, x, hitY, padRx * 1.05 * pk, padRx * 1.05 * HEAD_TILT * pk, cymbalPad ? 'tri' : hw.noteStyle, hitY - vy);
    g.fillStyle = withAlpha(colors[i], Math.min(0.9, hw.padFill + 0.5 * flash[i] + 0.35 * barFlash));
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = withAlpha(colors[i], Math.min(1, hw.padRing + (1 - hw.padRing) * Math.max(flash[i], barFlash)));
    g.stroke();
  }

  // Pedal and open bars lie flat on the road (a quad with real depth, not a screen-space strip) and sit behind
  // the heads; far ones first. Hit animation (FADE_SEC): white flash, a glow that spreads over the road and the
  // rails, and a bar that thins out as it fades.
  for (let i = end - 1; i >= from; i--) {
    const n = notes[i];
    setDesaturated(hw.disabledNote(n)); // disabled notes lose their colour
    if (n.lane >= 0 && !n.open) continue;
    const past = t - exitTime(n);
    const barFade = hw.hitAnimation === 'burst' ? BURST_VANISH_SEC : FADE_SEC; // (the burst: the bar vanishes quickly, the burst does the rest)
    if (past > barFade) continue;
    const kx = Math.max(0, past) / barFade;
    const e = easeOut(kx);
    const d = depth(n.time);
    const base = n.open ? NOTE_PALETTE.open : chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick;
    const far = Math.min(1, (1 - d) / FADE_IN);
    const alpha = far * (1 - e * e); // stays solid for a moment, then drops
    const thick = barDepth * (1 - 0.55 * e); // the bar thins as it is "consumed"
    const white = past > 0 ? 0.85 * (1 - Math.min(1, kx * 3)) : 0; // quick white flash at the moment of the hit, not before
    const barCount = n.doubleKick ? 2 : 1; // a double kick stacks a second bar
    if (kx > 0 && hw.hitAnimation !== 'burst') { // glow: a wider, taller, translucent copy that spreads past the rails (the burst has its own)
      g.globalAlpha = 0.55 * (1 - kx) * (1 - kx) * far;
      g.globalCompositeOperation = 'lighter'; // additive, so the glow lights the road instead of greying it
      g.fillStyle = dcol(base);
      quad(g, d - GLOW_DEPTH * (0.6 + 1.6 * e), d + GLOW_DEPTH * (0.6 + 1.6 * e), -half - 0.12 * e, half + 0.12 * e);
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    for (let bi = 0; bi < barCount; bi++) {
      const off = bi === 0 ? 0 : barDepth * 1.3;
      const d0 = d + off - thick / 2;
      const d1 = d + off + thick / 2;
      g.globalAlpha = alpha;
      g.fillStyle = tintWhite(base, white);
      quad(g, d0, d1, -half, half);
      g.fill();
      // lit far edge and darker near edge give the bar some body
      const s1 = scaleAt(d1);
      const s0 = scaleAt(d0);
      const y1 = PVY + (PHIT - PVY) * s1 + (d1 > 0 ? PC * d1 * d1 : 0);
      const y0 = PVY + (PHIT - PVY) * s0 + (d0 > 0 ? PC * d0 * d0 : 0);
      g.lineWidth = Math.max(1, 2 * s1);
      g.strokeStyle = n.activation && hw.fillActivation ? dcol(FILL_ACTIVATION) : tintWhite(base, 0.65); // (a fill's activation kick: a bright far edge)
      g.beginPath();
      g.moveTo(PCX + -half * PLANE * s1, y1);
      g.lineTo(PCX + half * PLANE * s1, y1);
      g.stroke();
      g.strokeStyle = darken(base, 0.6);
      g.beginPath();
      g.moveTo(PCX + -half * PLANE * s0, y0);
      g.lineTo(PCX + half * PLANE * s0, y0);
      g.stroke();
    }
  }
  g.globalAlpha = 1;

  // sustains
  if (hw.tailStyle === 'flow') drawFlowTails(g, hw, notes, from, end, t, colors, half, headR, tailW, windowSec, held);
  else for (let vi = from; vi < end; vi++) {
    const n = notes[vi];
    setDesaturated(hw.disabledNote(n)); // disabled notes lose their colour
    if (!n.length || n.lane < 0) continue;
    const dTop = depth(n.time + n.length);
    const dBot = depth(Math.max(n.time, t));
    if (dTop <= dBot) continue;
    if (n.open) {
      g.fillStyle = withAlpha(NOTE_PALETTE.open, 0.3);
      quad(g, dBot, dTop, -half, half);
      g.fill();
    } else {
      // held (active): the whole tail is lighter, more opaque and slowly brightens and dims (no extra shapes)
      const amt = heldAmount(n, t); // fades in after the hit
      g.fillStyle = withAlpha(noteColor(n, colors), 0.6 + 0.25 * amt);
      const mid = n.lane + 0.5 - half;
      const hr = headR * noteScale(n); // HOPO notes are smaller
      taperedStrip(g, dBot, dTop, mid, hr * 0.38 * tailW, dBot);
      g.fill();
      if (amt > 0) {
        g.fillStyle = `rgba(255,255,255,${amt * (0.3 + 0.12 * shimmer)})`;
        taperedStrip(g, dBot, dTop, mid, hr * 0.38 * tailW, dBot);
        g.fill();
        // soft halo around the tail while it is played: many wider and wider faint strips, added together, each with a
        // rounded end (a half ellipse beyond the tail's end, only when the end is on screen)
        g.globalCompositeOperation = 'lighter';
        const haloColor = noteColor(n, colors);
        const endVisible = n.time + n.length <= t + windowSec;
        const pEnd = scaleAt(dTop);
        const xEnd = xAt(mid, dTop);
        const yEnd = yAt(dTop);
        for (let i = 1; i <= 12; i++) {
          // each strip adds what the smooth falloff loses between its inner and outer edge, so the sum follows it
          g.fillStyle = withAlpha(haloColor, 0.12 * amt * (haloProfile((i - 1) / 12) - haloProfile(i / 12)));
          const wl = hr * (0.38 * tailW + 0.08 * i); // half width in lane units
          taperedStrip(g, dBot, dTop, mid, wl, dBot);
          g.fill();
          if (endVisible) {
            const rxi = laneW * wl * pEnd * tailFactor(dTop, dBot); // the rounded end follows the tapered width
            g.save();
            g.beginPath();
            g.rect(0, 0, w, yEnd); // only the part beyond the end
            g.clip();
            g.beginPath();
            g.ellipse(xEnd, yEnd, rxi, rxi * HEAD_TILT, 0, 0, Math.PI * 2);
            g.fill();
            g.restore();
          }
        }
        g.globalCompositeOperation = 'source-over';
      }
    }
  }


  // heads, far to near so closer ones cover farther ones
  for (let i = end - 1; i >= from; i--) {
    const n = notes[i];
    setDesaturated(hw.disabledNote(n)); // disabled notes lose their colour
    if (n.lane < 0 || n.open) continue;
    const past = t - exitTime(n); // long notes: the exit starts when the tail ends
    const fadeSec = hw.hitAnimation === 'burst' ? BURST_VANISH_SEC : FADE_SEC; // (the burst: the note vanishes quickly)
    if (past > fadeSec) continue;
    if (hw.hitAnimation === 'burst' && n.length > 0 && t >= n.time) continue; // (a long note that has arrived is not drawn at all: only its tail and the looping burst)
    const kx = Math.max(0, past) / fadeSec;
    const d = depth(n.time);
    const p = scaleAt(d);
    const x = PCX + (n.lane + 0.5 - half) * PLANE * p;
    const lift = d > 0 ? PC * d * d : 0; // (the curve moves the note down the road; its shape keeps the flat road's taper: vy moves with it)
    const y = PVY + (PHIT - PVY) * p + lift;
    const vy = PVY + lift;
    const amt = heldAmount(n, t);
    const rx = laneW * headR * noteScale(n) * p * (hw.hitAnimation === 'burst' ? 1 - 0.5 * kx : 1 + 0.4 * kx) * (1 + (pulse - 1) * amt); // (the burst makes the note shrink into the hit line instead of swelling)
    const ry = rx * HEAD_TILT;
    if (amt > 0) { // a soft halo while the note is held
      g.globalCompositeOperation = 'lighter';
      g.save();
      g.translate(x, y);
      g.scale(1, HEAD_TILT); // the halo lies on the road: a circle squashed like the head
      fillHalo(g, noteColor(n, colors), rx * 0.7, rx * 1.7, 0.45 * amt); // radial fade-out
      g.restore();
      g.globalCompositeOperation = 'source-over';
    }
    const faced = !n.cymbal && hw.noteStyle === 'rect'; // a note in the rectangular style: YARG's chrome caps and coloured band
    const disc = n.cymbal && hw.noteStyle === 'rect'; // ...and a cymbal is a chrome disc with a coloured cone
    const body = tintWhite(n.sp ? noteColor(n, colors) : n.tap && !faced ? NOTE_PALETTE.tap : colors[n.lane], Math.min(1, kx + amt * (0.32 + 0.12 * shimmer))); // an active long note's head is lighter, like its tail
    g.globalAlpha = (1 - kx) * hw.noteAlpha(n) * Math.min(1, (1 - d) / FADE_IN);
    if (faced) { // the rectangular style: the vector note after the design, with its base in perspective (no separate thickness edge)
      drawYNote(g, x, y, rx * NOTE_RECT_W * RECT_SCALE, ry * NOTE_RECT_H * RECT_SCALE, n, colors[n.lane], body, TAPER_GAIN / (y - vy), YNOTE_SIDE_3D * hw.noteBase, kx === 0 && amt === 0); // (a held or exiting note changes tint and size every frame: drawn directly)
      if (n.accent) {
        g.beginPath();
        noteShape(g, x, y, rx * RECT_SCALE, ry * RECT_SCALE, 'ynote', y - vy);
        g.lineWidth = ACCENT_OUTLINE_WIDTH * p;
        g.strokeStyle = darken(colors[n.lane], ACCENT_OUTLINE_DARKEN);
        g.stroke();
      }
      if (n.activation && hw.fillActivation) drawActivationMark(g, x, y, rx * NOTE_RECT_W * RECT_SCALE, ry * NOTE_RECT_H * RECT_SCALE, p, t);
      continue;
    }
    const lw = n.accent ? ACCENT_OUTLINE_WIDTH * p : Math.max(1, 1.5 * p);
    if (disc) { // a steady cymbal disc comes from a cached picture, scaled (see sprite3D); a held or exiting one changes every frame: drawn directly
      const dist = y - vy;
      if (!(kx === 0 && amt === 0 && g.filter === 'none' && g.globalCompositeOperation === 'source-over'
        && sprite3D(g, x, y, rx, noteSpritePx(), `disc|${body}|${colors[n.lane]}|${n.sp ? 1 : 0}${n.accent ? 1 : 0}${n.ghost ? 1 : 0}|${Math.round((lw * 100) / rx)}|${Math.round((dist * 100) / rx)}`,
          1 + (TAPER_GAIN * 0.9 * rx) / dist + lw / rx, HEAD_TILT + 0.3 + lw / rx, (sg) => drawHead3D(sg, 0, 0, rx, ry, -dist, n, colors, body, lw, true, 'round')))) {
        drawHead3D(g, x, y, rx, ry, vy, n, colors, body, lw, true, 'round');
      }
    } else {
      // a steady head (circle, triangle, square) also comes from a cached picture: its edge, face and outline were three path fills and strokes
      // per note per frame, the largest part of a dense frame with circles; the HOPO dot is in the picture too
      const style = n.cymbal ? 'tri' : hw.noteStyle;
      const dist = y - vy;
      const dot = n.hopo && g.globalAlpha === 1; // (while the note fades in, its dot is drawn over the faded picture, as before: in the picture it would fade as one piece with the face and turn grey)
      if (kx === 0 && amt === 0 && g.filter === 'none' && g.globalCompositeOperation === 'source-over'
        && sprite3D(g, x, y, rx, noteSpritePx(), `head|${style}|${body}|${colors[n.lane]}|${n.tap && !n.sp ? 1 : 0}${n.accent ? 1 : 0}${dot ? 1 : 0}|${Math.round((lw * 100) / rx)}|${Math.round((dist * 100) / rx)}`,
          headExtentX(style, rx, dist, lw), headExtentY(style, rx, lw), (sg) => { drawHead3D(sg, 0, 0, rx, ry, -dist, n, colors, body, lw, false, style); if (dot) hopoDot(sg, 0, 0, rx, ry, hw.noteStyle, dist, 0); })) {
        if (n.hopo && !dot) hopoDot(g, x, y, rx, ry, hw.noteStyle, dist, 0);
        if (n.activation && hw.fillActivation) drawActivationMark(g, x, y, rx, ry, p, t);
        continue;
      }
      drawHead3D(g, x, y, rx, ry, vy, n, colors, body, lw, false, style);
    }
    if (n.hopo) hopoDot(g, x, y, rx, ry, hw.noteStyle, y - vy, kx);
    if (n.activation && hw.fillActivation) drawActivationMark(g, x, y, rx, ry, p, t);
  }
  g.globalAlpha = 1;
  setDesaturated(false);
  if (hw.hitLine) { // a fixed bar across the road at the hit line, drawn over the notes and the tails (they pass underneath), as thick as the pedal / open bars, in the colour of each lane (it lights when a note is hit), with a fixed border at each end; the pads are not drawn
    for (let i = 0; i < lanes; i++) {
      g.fillStyle = tintWhite(colors[i], 0.3 + 0.45 * Math.max(flash[i], barFlash)); // the note's colour under a white overlay (whiter while the lane is hit)
      quad(g, -barDepth / 2, barDepth / 2, -half + i, -half + i + 1); // (the first and last segments end exactly on the walls of the board)
      g.fill();
    }
    // the end indicators pass over the coloured bar, a little transparent, in the colour of the open notes or the pedal when the chart has them (white otherwise)
    const hasOpen = (chart.hasOpen ??= chart.notes.some((n) => n.open));
    const edge = chart.drumKind ? (chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick) : hasOpen ? NOTE_PALETTE.open : null;
    g.fillStyle = edge ? withAlpha(edge, 0.8) : HIT_LINE_BORDER_SOFT;
    quad(g, -barDepth / 2, barDepth / 2, -half - FILL_BORDER_LANES, -half + FILL_BORDER_LANES * 0.4); // (the borders are exactly as deep as the bar)
    g.fill();
    quad(g, -barDepth / 2, barDepth / 2, half - FILL_BORDER_LANES * 0.4, half + FILL_BORDER_LANES);
    g.fill();
  }
  if (hw.hitAnimation === 'burst') { // the burst: a shockwave ring and a fan of sparks on the hit line when a note arrives (setting highway.hitAnimation); drawn over the hit line
    for (let i = end - 1; i >= from; i--) {
      const n = notes[i];
      if (n.lane < 0 || n.open) { // a pedal / open bar: its own burst along the whole bar
        const pb = t - n.time;
        if (pb < 0 || pb >= BAR_BURST_SEC || pb < litFrom || noteDisabled(n)) continue;
        const bcol = n.open ? NOTE_PALETTE.open : chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick;
        const barPx = PHIT - (PVY + (PHIT - PVY) / (1 + PK * (barDepth / 2))); // the bar's half thickness on screen at the hit line
        drawBarBurst(g, PCX, PHIT, half * PLANE, Math.max(2, barPx), bcol, pb / BAR_BURST_SEC, n.time, laneW * headR * 0.6);
        continue;
      }
      const past = t - n.time;
      if (past < 0 || past < litFrom || noteDisabled(n)) continue;
      const bx = PCX + (n.lane + 0.5 - half) * PLANE, bw = laneW * headR, bh = laneW * headR * HEAD_TILT, bc = noteColor(n, colors);
      const rippleRect = hw.noteStyle === 'rect' && !n.cymbal; // (the rectangular ripple is only for the rectangular notes)
      if (n.length > 0 && past < n.length) { // a held long note: three bursts a third of a period apart, so there is always one in flight (a constant variation)
        for (let j = 0; j < 3; j++) {
          const ph = past / BURST_LOOP_SEC + j / 3;
          drawHitBurst(g, bx, PHIT, bw, bh, bc, ph - Math.floor(ph), n.time + Math.floor(ph) * 0.137 + j * 0.31, 0.31, rippleRect); // (half the size they had)
        }
      } else if (past < BURST_SEC) drawHitBurst(g, bx, PHIT, bw, bh, bc, past / BURST_SEC, n.time, 0.5, rippleRect); // (half the size it had)
    }
  }

  // a very short fade at the bottom: the board dissolves right below the pads
  const padBottom = hitY + padRy;
  if (h - padBottom > 2) {
    const bf = fadeGradient(g, padBottom, h, BOTTOM_FADE_STOPS);
    g.globalCompositeOperation = hw.layered ? 'destination-out' : 'source-over';
    g.fillStyle = bf;
    g.fillRect(0, padBottom, w, h - padBottom);
    g.globalCompositeOperation = 'source-over';
  }

  // the board's neutral dark base, as opaque as the setting says: behind the notes and the guides, and not faded at the edges
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = boardBase(hw.trackOpacity * boardK); // (more transparent in a long rest)
  g.fill(roadP.road);
  g.globalCompositeOperation = 'source-over';
  // far edge fades into the background
  // (an eased fade, so the board dissolves instead of ending in a visible edge)
  // (on a curved road it moves down with the far edge, PC px at d = 1; above it the background is solid)
  const fadeH = h * 0.26;
  const grad = fadeGradient(g, PC, PC + fadeH, EDGE_FADE_STOPS); // smootherstep: eases at both ends
  g.globalCompositeOperation = hw.layered ? 'destination-out' : 'source-over';
  g.fillStyle = grad;
  g.fillRect(0, 0, w, PC + fadeH);  g.globalCompositeOperation = 'source-over';
}
