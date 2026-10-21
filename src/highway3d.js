// 3D view of the note highway: a perspective projection drawn on the same 2D canvas (no WebGL, no libraries),
// so it stays light enough for phones. Only the lane instruments (guitar, bass, keys, drums) have a highway;
// vocals keep the flat view. Like the 2D view, drawing is a pure function of the playback time.
import {
  NOTE_PALETTE, breAlpha, HELD_SCALE, drawYNote, YNOTE_SIDE_3D, TAPER_GAIN, drawCymbalFace, NOTE_RECT_W, NOTE_RECT_H, STAR_POWER_GOLD, ACCENT_OUTLINE_WIDTH,
  ACCENT_OUTLINE_DARKEN, GHOST_ALPHA, DISABLED_FILTER, exitTime, heldAmount, litFrom, noteDisabled, fillHalo, haloProfile, tailShimmer, HIT_FLASH_SEC, BAR_FLASH_SEC, PAD_FILL_ALPHA, PAD_RING_ALPHA, noteShape, heldPulse, ROLL_COLORS, FILL_COLORS, FILL_STRONG, FILL_BORDER, FILL_BORDER_LANES, FILL_EDGE, FILL_ACTIVATION, drawActivationMark, FADE_SEC, firstVisibleIndex, spansOfKind, tintWhite, darken, withAlpha, noteScale, noteColor, BOTTOM_FADE_STOPS, EDGE_FADE_STOPS, fadeGradient, boardBase,
  laneLookFactor
} from './gfx.js';

const DEPTH_SEC = 3.2; // seconds between the hit line and the far edge at neck speed 1 (the flat view shows 2.5)
const FAR_SCALE = 0.3; // size of things at the far edge relative to the hit line
const FAR_TOP = 0.05; // far edge position, as a fraction of the canvas height
const HEAD_R = 0.36; // note head radius, in lane widths
const HEAD_TILT = 0.55; // vertical squash of the heads (they lie on the road)
const FADE_IN = 0.14; // fraction of the depth over which notes fade in at the far edge
const TAIL_TAPER_POWER = 3; // like the heads' TAPER_GAIN: about 3x the natural perspective change
const TAIL_MIN_WIDTH = 0.3; // a tail never gets thinner than this fraction of its base width
const ROAD_NEAR = -0.14; // the road starts below the canvas (past the pads), so it can fade out at the bottom
const ROAD_END = 1.8; // the road runs well past the last visible note, so it has no visible far edge: the fade hides the rest
const BAR_DEPTH = 0.0087; // one third of the earlier 0.026 // pedal/open bar thickness along the road, in depth units (it lies flat on the fretboard)
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
const discEdges = [null, null];
function discEdgeGradient(g, sp) {
  const i = sp ? 1 : 0;
  if (!discEdges[i]) {
    const edge = g.createLinearGradient(0, 0, 0, 1);
    const m = sp ? ['#f0d060', '#a37c00', '#3d2e00'] : ['#d4dae1', '#7f8893', '#30353b'];
    edge.addColorStop(0, m[0]);
    edge.addColorStop(0.45, m[1]);
    edge.addColorStop(0.75, m[2]);
    edge.addColorStop(1, sp ? 'rgba(61,46,0,0.35)' : 'rgba(48,53,59,0.35)'); // the metal fades into the road at the bottom: depth
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
const CURVE_STEPS = 24; // segments per depth unit of a quad or line on a curved road

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
  g.beginPath();
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
  const n = Math.max(1, Math.ceil(Math.abs(d1 - d0) * CURVE_STEPS));
  g.beginPath();
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
  if (PC > 0) for (let i = 1, n = Math.ceil((PEND - ROAD_NEAR) * CURVE_STEPS); i <= n; i++) { const d = ROAD_NEAR + ((PEND - ROAD_NEAR) * i) / n; g.lineTo(xAt(lx, d), yAt(d)); }
  else g.lineTo(xAt(lx, ROAD_END), yAt(ROAD_END));
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
function span(g, spans, color, xl, xr) { // xl..xr: the lane range in lane units (-half..half is the whole road)
  g.fillStyle = color;
  if (!spans) return;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if ((s.end - PT) / PSEC < ROAD_NEAR || s.start > PT + PSEC) continue;
    const near = Math.max(ROAD_NEAR, Math.min(1, (s.start - PT) / PSEC)); // the band goes on past the hit line, to the end of the board
    quad(g, near, depth(s.end), xl, xr);
    g.fill();
  }
}
export function renderLanes3D(hw, t, w, h) {
  const g = hw.g;
  const chart = hw.chart;
  const lanes = chart.lanes;
  const portrait = h > w;
  // Road width at the hit line. It grows with the window (0.94 of a narrow one), then slowly, and stops at 1.05 of the height: no jump when
  // the window passes from taller than wide to wider than tall, and past the cap only the side gaps grow.
  const roadW = portrait ? w * 0.94 : Math.min(h * 1.05, h * 0.94 + (w - h) * 0.16);
  const laneW = roadW / lanes;
  const headR = HEAD_R * hw.noteSize; // (setting highway.noteScale: heads and pads)
  const padRy = laneW * headR * 1.05 * HEAD_TILT; // vertical radius of the hit pads
  const hitY = h - (padRy + 26); // hit line (the pads): the 26 px below them hold the bottom fade
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

  // In a long rest the whole board turns more transparent together (see Highway.restBoard)
  const boardK = hw.restBoard(t, windowSec);
  g.globalAlpha = boardK;
  // road (its dark base is added at the very end, behind everything, so the edge fades do not thin it)
  g.fillStyle = 'rgba(255,255,255,0.045)';
  quad(g, ROAD_NEAR, PEND, -half, half);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.045)';
  for (let i = 0; i < lanes && hw.laneStripes; i += 2) { // (setting highway.laneStripes)
    quad(g, ROAD_NEAR, PEND, i - half, i + 1 - half);
    g.fill();
  }
  if (hw.starPowerBand) span(g, chart.starPower, STAR_POWER_BAND_3D, -half, half);
  if (hw.soloBand) span(g, chart.solos, SOLO_BAND_3D, -half, half);
  for (let i = 0; i < FILL_KINDS.length; i++) {
    if (FILL_KINDS[i] === 'fill' && !hw.fillBand) continue;
    if (FILL_KINDS[i] === 'bre' && hw.breBand === 'off') continue;
    const spans = spansOfKind(chart, FILL_KINDS[i] === 'fill' ? chart.fillBands ?? chart.fills : chart.fills, 'kind', FILL_KINDS[i]); // (fills without their own activation chord are not shown, like YARG)
    if (FILL_KINDS[i] === 'bre') { // the big rock ending: every lane in its own colour, pulsing (breAlpha)
      const cols = chart.laneColors || NOTE_PALETTE.lanes;
      const pulseBre = hw.breBand === 'pulse';
      for (let l = 0; l < lanes; l++) span(g, spans, withAlpha(cols[l] || cols[0], breAlpha(t, l, lanes, pulseBre)), -half + l, -half + l + 1);
    } else fillBand3D(g, spans, FILL_COLORS[FILL_KINDS[i]], -half, half, roadW);
  }
  for (let i = 0; i < ROLL_TYPES.length; i++) span(g, spansOfKind(chart, chart.rolls, 'type', ROLL_TYPES[i]), ROLL_COLORS[ROLL_TYPES[i]], -half, half);

  // lane dividers and rails
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.beginPath();
  for (let i = 1; i < lanes; i++) roadLine(g, i - half);
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.beginPath();
  for (let i = 0; i < 2; i++) roadLine(g, i === 0 ? -half : half);
  g.stroke();

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
  // (there is no hit line: the pads mark the spot; a pedal hit lights every pad)
  const padRx = laneW * headR;
  for (let i = 0; i < lanes; i++) {
    const x = cx + (i + 0.5 - half) * laneW;
    g.beginPath();
    noteShape(g, x, hitY, padRx * 1.05, padRx * 1.05 * HEAD_TILT, chart.laneKinds?.[i] === 'cymbal' ? 'tri' : hw.noteStyle, hitY - vy);
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
    g.filter = hw.disabledNote(n) ? DISABLED_FILTER : 'none'; // disabled notes lose their colour
    if (n.lane >= 0 && !n.open) continue;
    const past = t - exitTime(n);
    if (past > FADE_SEC) continue;
    const kx = Math.max(0, past) / FADE_SEC;
    const e = easeOut(kx);
    const d = depth(n.time);
    const base = n.open ? NOTE_PALETTE.open : chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick;
    const far = Math.min(1, (1 - d) / FADE_IN);
    const alpha = far * (1 - e * e); // stays solid for a moment, then drops
    const thick = barDepth * (1 - 0.55 * e); // the bar thins as it is "consumed"
    const white = past > 0 ? 0.85 * (1 - Math.min(1, kx * 3)) : 0; // quick white flash at the moment of the hit, not before
    const barCount = n.doubleKick ? 2 : 1; // a double kick stacks a second bar
    if (kx > 0) { // glow: a wider, taller, translucent copy that spreads past the rails
      g.globalAlpha = 0.55 * (1 - kx) * (1 - kx) * far;
      g.globalCompositeOperation = 'lighter'; // additive, so the glow lights the road instead of greying it
      g.fillStyle = base;
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
      g.strokeStyle = n.activation && hw.fillActivation ? FILL_ACTIVATION : tintWhite(base, 0.65); // (a fill's activation kick: a bright far edge)
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
  for (let vi = from; vi < end; vi++) {
    const n = notes[vi];
    g.filter = hw.disabledNote(n) ? DISABLED_FILTER : 'none'; // disabled notes lose their colour
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
    g.filter = hw.disabledNote(n) ? DISABLED_FILTER : 'none'; // disabled notes lose their colour
    if (n.lane < 0 || n.open) continue;
    const past = t - exitTime(n); // long notes: the exit starts when the tail ends
    if (past > FADE_SEC) continue;
    const kx = Math.max(0, past) / FADE_SEC;
    const d = depth(n.time);
    const p = scaleAt(d);
    const x = PCX + (n.lane + 0.5 - half) * PLANE * p;
    const lift = d > 0 ? PC * d * d : 0; // (the curve moves the note down the road; its shape keeps the flat road's taper: vy moves with it)
    const y = PVY + (PHIT - PVY) * p + lift;
    const vy = PVY + lift;
    const amt = heldAmount(n, t);
    const rx = laneW * headR * noteScale(n) * p * (1 + 0.4 * kx) * (1 + (pulse - 1) * amt);
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
      drawYNote(g, x, y, rx * NOTE_RECT_W, ry * NOTE_RECT_H, n, colors[n.lane], body, TAPER_GAIN / (y - vy), YNOTE_SIDE_3D * hw.noteBase, kx === 0 && amt === 0); // (a held or exiting note changes tint and size every frame: drawn directly)
      if (n.accent) {
        g.beginPath();
        noteShape(g, x, y, rx, ry, 'ynote', y - vy);
        g.lineWidth = ACCENT_OUTLINE_WIDTH * p;
        g.strokeStyle = darken(colors[n.lane], ACCENT_OUTLINE_DARKEN);
        g.stroke();
      }
      if (n.activation && hw.fillActivation) drawActivationMark(g, x, y, rx * NOTE_RECT_W, ry * NOTE_RECT_H, p, t);
      continue;
    }
    // thickness: a thin darker edge underneath the top face (no cast shadow; all of it moves, grows and fades with the note)
    const th = Math.max(0.5, rx * (disc ? 0.27 : 0.21)); // (a little thicker in the rectangular style)
    const headStyle = disc ? 'round' : n.cymbal ? 'tri' : hw.noteStyle; // cymbals: a disc in the rectangular style, else a rounded triangle
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
    g.lineWidth = n.accent ? ACCENT_OUTLINE_WIDTH * p : Math.max(1, 1.5 * p);
    g.strokeStyle = n.accent ? darken(colors[n.lane], ACCENT_OUTLINE_DARKEN) : 'rgba(0,0,0,0.5)';
    g.stroke();
    if (n.hopo) {
      g.beginPath();
      noteShape(g, x, y, rx * 0.35, ry * 0.35, hw.noteStyle, y - vy);
      g.fillStyle = kx === 0 ? HOPO_DOT : `rgba(255,255,255,${0.9 * (1 - kx)})`;
      g.fill();
    }
    if (n.activation && hw.fillActivation) drawActivationMark(g, x, y, rx, ry, p, t);
  }
  g.globalAlpha = 1;
  g.filter = 'none';

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
  quad(g, ROAD_NEAR, PEND, -half, half);
  g.fill();
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
