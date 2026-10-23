// The fretboard of the 3D view (rectangular notes, burst hit animation, flow sustains) drawn with WebGL 2: the same picture as renderLanes3D (highway3d.js), at a
// fraction of the CPU cost when several wide panes are on screen. Highway (highway.js) owns the stage, the dividers, the countdown, the vocals and every overlay, drawn
// on its own 2D canvas ABOVE the canvas of this module; GLBoard only paints the lane panes, on a transparent canvas between the page's background canvas and the 2D one.
//
// How: the app's own functions (drawYNote, drawCymbalFace) draw each kind of note ONCE into a texture atlas; the notes, sustains, bands, beat lines, bursts and the road are
// instances / triangles whose screen positions are computed in the vertex shader from the song time, with the same projection (projection3D: scale 1 / (1 + k d),
// y = vy + (hit - vy) scale + c d^2). The whole chart is uploaded once; a pane costs a dozen draw calls and a few uniforms, whatever the number of notes.
//
// The contract (see Highway.drawPane):
//   const board = GLBoard.create(canvas)            // null when WebGL 2 is missing
//   board.begin(cssW, cssH, dpr)                    // once per frame: sizes the canvas, clears it (transparent)
//   board.drawPane(chart, t, { x, y, w, h }, opts)  // per pane, in CSS px of the stage; returns the notes drawn
//   board.end()
//   glUnsupported(hw)                               // why the panes must be drawn by the 2D code instead (null: the board can draw them)
// What it does not draw (the 2D code does, or the pane falls back to it, see glUnsupported): other note styles, hit animations and tail styles, the loop / replay dimming;
// the countdown, lyrics and vocals are overlays or other panes. Motion blur: begin(..., i) / end() average the samples (see begin).
import { projection3D } from './highway3d.js';
import {
  drawYNote, drawCymbalFace, YNOTE_SIDE_3D, NOTE_RECT_W, NOTE_RECT_H, NOTE_PALETTE, noteColor, withAlpha, spansOfKind, breAlpha, ynoteVersion,
  HIT_Y, HIT_FLASH_SEC, FILL_ACTIVATION, BAR_FLASH_SEC, BAND_BORDERS, FILL_COLORS, FILL_BORDER, FILL_BORDER_LANES, FILL_STRONG, ROLL_LEAD_SEC, ROLL_COLUMN_ALPHA, HIT_LINE_BORDER_SOFT, TAPER_GAIN, NOTE_TRI_W, NOTE_TRI_H, NOTE_TRI_ROUND, NOTE_RECT_ROUND,
} from './gfx.js';

const CYMBAL_HEIGHT = 0.9; // the height of a cymbal model as a fraction of a rectangular note's (setMeshes)
const RECT_SCALE = 1.15; // the rectangular notes and the pads under them are this much larger than the other heads (highway3d.js)
// The material styles of the YARG models, chosen with fx.metal and fx.glass (the indices): the metal parts (the frame, the caps, the cymbal's rim) and the glass (the lit middle).
export const METAL_STYLES = ['Satin stainless', 'Polished chrome', 'Brushed steel', 'Satin gold', 'Polished gold', 'Champagne', 'Rose gold', 'Copper', 'Gunmetal', 'Black chrome'];
export const GLASS_STYLES = ['Lamp', 'Neon tube', 'Frosted', 'Crystal', 'Candy gel', 'Ember'];
const HEAD_R = 0.36; // note head radius in lane widths (highway3d.js)
const ROAD_NEAR = -0.14; // the road starts below the pads
const BAR_DEPTH = 0.0058; // pedal / open bar thickness along the road, in depth units
const REF_RX = 60; // the head radius, in px, the atlas sprites are drawn with
const CELL_W = 176, CELL_H = 112, ATLAS = 2048, COLS = Math.floor(ATLAS / CELL_W), ROWS = Math.floor(ATLAS / CELL_H);
const STAR_POWER_BAND = [1, 0.69, 0, 0.17], SOLO_BAND = [0, 0.59, 0.86, 0.15]; // (the 3D bands are a little denser than the 2D ones)
const TAIL_VERTS = 2 * 21 + 4; // the tail strip: 21 segment rows (SEGS 20) and the two rows of the tip
const BAND_ROWS = 10; // rows of a band strip (a curved road bends its edges)
const MUL_SLOTS = 16; // alpha multipliers of the bands: lane l of a big rock ending uses slot l, 15 is 1

const cssCache = new Map();
// 'rgba(r,g,b,a)' / '#rrggbb' -> [r, g, b, a] in 0..1
function rgba(css) {
  let v = cssCache.get(css);
  if (v) return v;
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (m) { const p = m[1].split(',').map(Number); v = [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1]; }
  else v = [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16) / 255).concat(css.length > 7 ? parseInt(css.slice(7, 9), 16) / 255 : 1);
  cssCache.set(css, v);
  return v;
}

// Why the pane cannot be drawn by the board (null: it can). The 2D code draws these cases.
export function glUnsupported(hw, chart) {
  if (chart && chart.mode !== 'lanes') return 'mode';
  if (hw.view !== '3d') return 'view';
  if (hw.noteStyle !== 'rect') return 'noteStyle';
  if (hw.hitAnimation !== 'burst') return 'hitAnimation';
  if (hw.tailStyle !== 'flow') return 'tailStyle';
  if (hw.loopEnd !== null || hw.replayWindow !== null) return 'loop';
  return null;
}

// ---- shaders ------------------------------------------------------------------------------------------------------------------------------------------------------

const UNIFORMS = `uniform vec2 u_res; uniform float u_hit, u_vy, u_k, u_c, u_cx, u_laneW, u_half, u_t, u_win, u_flip, u_headR, u_end, u_fh, u_padB, u_board, u_taper, u_fog, u_relief, u_side, u_sx0, u_sy0, u_span, u_lit, u_held;`;
const COMMON = `#version 300 es
precision highp float;
${UNIFORMS}
// u_side: 0 the usual view from behind the hit line (a perspective), 1 a view from the side (an elevation without perspective: the depth runs along the screen, to the right, from the
// hit line at u_sx0; the height is up; the lanes, which would lie on one another, are spread a little up the screen), in between a morph of the two.
float scaleAt(float d) { return mix(1.0 / (1.0 + u_k * d), 1.0, u_side); }
vec2 project(float lx, float d) {
  float p = 1.0 / (1.0 + u_k * d);
  vec2 top = vec2(u_cx + lx * u_flip * u_laneW * p, u_vy + (u_hit - u_vy) * p + (d > 0.0 ? u_c * d * d : 0.0));
  vec2 side = vec2(u_sx0 + d * u_span + lx * u_flip * u_laneW * 0.12, u_sy0 - lx * u_flip * u_laneW * 0.3);
  return mix(top, side, u_side);
}
// the directions of the width of a strip (a tail, a band) and of its length towards the far end, on the screen
vec2 stripSide() { return mix(vec2(1.0, 0.0), vec2(0.0, 1.0), u_side); }
vec2 stripFar() { return mix(vec2(0.0, -1.0), vec2(1.0, 0.0), u_side); }
vec4 clipPos(vec2 px) { return vec4(px.x / u_res.x * 2.0 - 1.0, 1.0 - px.y / u_res.y * 2.0, 0.0, 1.0); }
`;
// The fade of the pane's edges, as the app erases them from its layer: the far edge eases out over 26% of the height (smootherstep, from y = c), the bottom edge dissolves
// right under the pads.
const FS_HEAD = `#version 300 es
precision highp float;
${UNIFORMS}
float sm5(float u) { u = clamp(u, 0.0, 1.0); return u * u * u * (u * (u * 6.0 - 15.0) + 10.0); }
float topFade(float y) { return u_fh < 0.0 ? 1.0 : sm5((y - u_c) / u_fh); } // (u_fh < 0: no fade, the side view)
float edgeFade(float y) {
  float top = u_fh < 0.0 ? 1.0 : sm5((y - u_c) / u_fh);
  float b = clamp((y - u_padB) / max(1.0, u_res.y - u_padB), 0.0, 1.0);
  float er = b < 0.3 ? mix(0.0, 0.2, b / 0.3) : b < 0.6 ? mix(0.2, 0.6, (b - 0.3) / 0.3) : b < 0.85 ? mix(0.6, 0.92, (b - 0.6) / 0.25) : mix(0.92, 1.0, (b - 0.85) / 0.15);
  return top * (1.0 - er);
}
`;
const FS_COLOR = `${FS_HEAD}in vec4 v_col; in float v_y; uniform float u_noFade; out vec4 o;
void main() { float a = v_col.a * (u_noFade > 1.5 ? topFade(v_y) : mix(edgeFade(v_y), 1.0, u_noFade)); o = vec4(v_col.rgb * a, a); } // (u_noFade: 0 the whole fade, 1 none, 2 the far edge only: the dark base reaches the bottom of the pane)`;

// The road in relief (the effect "relief"): the road and lane stripes (the faint white quads) get fine grooves along the lanes, a bevelled plate every half second of the
// song that scrolls with the notes, and a sheen that slides up the board; all of it only changes how much light the faint quads add.
const FS_FLAT = `${FS_HEAD}in vec4 v_col; in float v_y; in vec2 v_g; uniform float u_noFade; out vec4 o;
void main() {
  float a = v_col.a * (u_noFade > 1.5 ? topFade(v_y) : mix(edgeFade(v_y), 1.0, u_noFade));
  if (u_relief > 0.0 && u_noFade < 1.5 && v_col.a < 0.06) {
    float groove = 0.5 + 0.5 * sin(v_g.x * 18.8496);
    float f = fract((u_t + v_g.y * u_win) / 0.5);
    float seam = 1.0 - smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.94, 1.0, f));
    float sheen = pow(0.5 + 0.5 * sin(6.2831853 * (v_g.y * 1.5 - u_t * 0.25)), 10.0);
    a *= 1.0 + u_relief * (0.55 * groove + 0.7 * seam + 1.0 * sheen);
  }
  o = vec4(v_col.rgb * a, a);
}`;

const ACT_RGB = [1, 3, 5].map((i) => (parseInt(FILL_ACTIVATION.slice(i, i + 2), 16) / 255).toFixed(4));
const PROGRAMS = {
  // the road, lane lines and rails (triangles in (lane x, fraction of the depth range) space) and the dark base
  flat: [`${COMMON}in vec2 a_pos; in vec4 a_col; in float a_ext; uniform float u_amul, u_dpr; out vec4 v_col; out float v_y; out vec2 v_g;
void main() { float d = ${ROAD_NEAR.toFixed(2)} + a_pos.y * (u_end - ${ROAD_NEAR.toFixed(2)}); vec2 px = project(a_pos.x, d); px.x += a_ext * u_dpr; gl_Position = clipPos(px); v_y = px.y; v_g = vec2(a_pos.x, d); v_col = vec4(a_col.rgb, a_col.a * u_amul); }`, FS_FLAT],
  // beat and measure lines: one instance each (time, kind)
  beats: [`${COMMON}in vec2 a_b; uniform vec4 u_bc[3]; out vec4 v_col; out float v_y;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  int kind = int(a_b.y); float d = clamp((a_b.x - u_t) / u_win, 0.0, 1.0); float p = scaleAt(d);
  float th = (kind == 2 ? 3.0 : kind == 1 ? 2.0 : 1.0) * p;
  vec2 l = project(-u_half, d), r = project(u_half, d);
  vec2 px = mix(l, r, c.x) + (c.y - 0.5) * th * vec2(u_side, 1.0 - u_side);
  gl_Position = a_b.x < u_t ? vec4(2.0, 2.0, 2.0, 1.0) : clipPos(px); v_y = px.y;
  vec4 col = u_bc[2 - kind]; v_col = vec4(col.rgb, col.a * u_board);
}`, FS_COLOR],
  // bands (star power, solo, fills, big rock ending, roll columns, borders): a strip from the start to the end, one instance each (t0, t1, x, half width) + colour + (alpha slot)
  bands: [`${COMMON}in vec4 a_t; in vec4 a_col; in vec4 a_x; uniform float u_mul[${MUL_SLOTS}]; out vec4 v_col; out float v_y;
void main() {
  int id = gl_VertexID; float side = ((id & 1) == 0) ? -1.0 : 1.0; float u = float(id >> 1) / ${(BAND_ROWS - 1).toFixed(1)};
  float lo = a_x.y > 0.5 ? 0.0 : ${ROAD_NEAR.toFixed(2)}; // (an open note's sustain starts at the hit line)
  float dn = clamp((a_t.x - u_t) / u_win, lo, u_end), df = clamp((a_t.y - u_t) / u_win, lo, u_end);
  float d = mix(dn, df, u);
  vec2 c = project(a_t.z, d); float w = u_laneW * a_t.w * scaleAt(d);
  vec2 px = c + stripSide() * (side * w); gl_Position = (df <= dn) ? vec4(2.0, 2.0, 2.0, 1.0) : clipPos(px); v_y = px.y;
  v_col = vec4(a_col.rgb, a_col.a * u_mul[int(a_x.x)] * u_board);
}`, FS_COLOR],
  // sustains, in the app's "flow" style: a strip of segments from the head to the end, tapered (TAIL_TAPER_POWER 3, never thinner than 0.3), swelling in waves while held
  // (WAVE_LEN 0.45 s, WAVE_PERIOD 0.6 s, WAVE_AMP 0.26), with a rounded tip. One instance each (t0, t1, lane, 0) + colour, drawn once per pass (halo, body, core, spine,
  // chevrons: u_mult is the half width factor, u_pass = alpha (-1: the body's 0.6 + 0.3 held), white mix, held only, chevron pass)
  tails: [`${COMMON}in vec4 a_t; in vec4 a_col; uniform float u_mult, u_waveMul, u_tailW; uniform vec4 u_pass;
const float SEGS = 20.0;
out vec4 v_col; out float v_ahead, v_l, v_hp, v_pxs, v_left, v_y, v_d;
void main() {
  int id = gl_VertexID; int nb = 2 * (int(SEGS) + 1);
  float side = ((id & 1) == 0) ? -1.0 : 1.0;
  float t0 = a_t.x, t1 = a_t.y;
  float ramp = clamp((u_t - t0) / 0.2, 0.0, 1.0); float rampIn = ramp * ramp * (3.0 - 2.0 * ramp);
  float rampOut = u_t <= t1 ? 1.0 : max(0.0, 1.0 - (u_t - t1) / 0.25);
  float amt = u_t - t0 >= u_lit ? min(rampIn, rampOut) : 0.0; // (u_lit: a backward seek animation lights nothing it sweeps over)
  float dBot = clamp((max(t0, u_t) - u_t) / u_win, 0.0, 1.0), dTop = clamp((t1 - u_t) / u_win, 0.0, 1.0);
  bool dead = dTop <= dBot || (u_pass.z > 0.5 && amt <= 0.0);
  bool tip = t1 <= u_t + u_win; bool isTip = id >= nb;
  float u = isTip ? 1.0 : float(id >> 1) / SEGS;
  float d = dBot + (dTop - dBot) * u;
  float sc = scaleAt(d), sRef = scaleAt(dBot);
  float S = u_held > 0.5 ? sin(6.2831853 * ((d - dBot) * u_win / 0.45 - u_t / 0.6)) : 0.0; // (no waves when the held motion is off)
  float hp = u_headR * 0.38 * u_tailW * (1.0 + 0.04 * amt) * u_mult * (0.3 + 0.7 * pow(sc / sRef, 3.0)) * u_laneW * sc * (1.0 + 0.26 * amt * u_waveMul * S);
  vec2 c = project(a_t.z + 0.5 - u_half, d); vec2 pos = c + stripSide() * (side * hp); float lat = side;
  if (isTip) {
    float ty = hp * 1.1; float hh = hp; float dy = 0.0;
    if (tip) { bool r0 = ((id - nb) >> 1) == 0; hh = r0 ? 0.7 * hp : 0.0; dy = r0 ? -0.7 * ty : -ty; }
    pos = c + stripSide() * (side * hh) - stripFar() * dy; lat = side * (hp > 0.0 ? hh / hp : 0.0);
  }
  gl_Position = dead ? vec4(2.0, 2.0, 2.0, 1.0) : clipPos(pos); v_y = pos.y;
  float alpha = u_pass.x < 0.0 ? 0.6 + 0.3 * amt : u_pass.x;
  vec3 tcol = mix(a_col.rgb, vec3(1.0), u_pass.y); tcol = mix(tcol, vec3(0.10, 0.14, 0.24), u_fog * 0.55 * d * d);
  v_col = vec4(tcol, alpha * (u_pass.z > 0.5 ? amt : 1.0)); v_d = d;
  v_ahead = d * u_win; v_l = lat; v_hp = hp; v_pxs = mix((u_hit - u_vy) * u_k * sc * sc, u_span, u_side) / u_win; v_left = t1 - u_t;
}`, `${FS_HEAD}in vec4 v_col; in float v_ahead, v_l, v_hp, v_pxs, v_left, v_y, v_d; uniform vec4 u_pass; out vec4 o;
void main() {
  float a = v_col.a * edgeFade(v_y);
  if (u_pass.w > 0.5) { // the chevrons: Vs pointing away from the hit line, one every FLOW_SPACING seconds, running up the tail (FLOW_PERIOD)
    float ph = u_held > 0.5 ? fract(u_t / 0.1) : 0.0; // (the chevrons stand still when the held motion is off)
    float cn = ceil(v_ahead / 0.18 - ph);
    float apex = 0.18 * (cn + ph);
    float f = min(1.0, min((v_left - apex) / 0.12, apex / 0.06));
    float back = (apex - v_ahead) * v_pxs;
    float al = abs(v_l);
    float lo = 1.1 * v_hp * al, th = 0.85 * v_hp * f;
    a *= step(0.0, f) * step(cn, 12.0) * step(al, f) * smoothstep(lo - 0.7, lo + 0.7, back) * (1.0 - smoothstep(lo + th - 0.7, lo + th + 0.7, back));
  }
  o = vec4(v_col.rgb * a, a);
}`],
  // notes, bars (kick, open) and pads: sprites from the atlas, one instance each (time, lane, uv rect, size factors, length, bar, bar width in lanes, depth offset of a double kick);
  // a pad is lit by its lane's flash. The burst animation: a head shrinks into the line and is gone after 0.1 s (a long note that has arrived is not drawn); a bar thins out and fades.
  notes: [`${COMMON}in vec4 a0; in vec4 a1; in vec4 a2; uniform float u_pad, u_atlas, u_bar, u_solid; uniform float u_flash[8]; out vec2 v_uv, v_o; out float v_a, v_boost, v_white, v_y, v_d, v_bar, v_bh, v_hw, v_sc;
float easeOut(float k) { return 1.0 - (1.0 - k) * (1.0 - k); }
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  bool bar = a2.y > 0.5;
  float dr = (a0.x - u_t) / u_win; float d = u_pad > 0.5 ? 0.0 : clamp(dr, 0.0, 1.0) + (bar ? a2.w * u_bar : 0.0);
  vec2 centre = project(a0.y + 0.5 - u_half, d);
  float past = u_t - (a0.x + a2.x); float kx = clamp(past / 0.1, 0.0, 1.0); float e = easeOut(kx);
  bool gone = u_pad < 0.5 && (past > 0.1 || (a2.x > 0.0 && !bar && u_t >= a0.x) || (u_solid > 0.5 && !bar)); // (a note with a model has no sprite, cymbals included)
  float sc = scaleAt(d); vec2 size;
  float bth = max(2.0, (u_hit - u_vy) * u_k * sc * sc * u_bar * (1.0 - 0.55 * e));
  if (bar) size = vec2(a2.z * u_laneW * sc + 4.0, bth + 2.0 * max(1.0, 2.0 * sc) + 2.0); // (the bar is drawn in the fragment shader: the fill and its two edge lines)
  else size = (a1.xy - a0.zw) * u_atlas * (u_laneW * u_headR * sc / ${REF_RX.toFixed(1)}) * a1.zw * (u_pad > 0.5 ? 1.0 : 1.0 - 0.5 * kx);
  vec2 off = (c - 0.5) * size;
  if (u_taper > 0.0 && !bar && u_pad < 0.5) { // (the effect "taper": the far edge of a note is narrower than its near edge, as the road is)
    float dd = 0.5 * size.y / max(1.0, (u_hit - u_vy) * u_k * sc * sc);
    float ratio = scaleAt(d + (c.y < 0.5 ? dd : -dd)) / sc;
    off.x *= 1.0 + u_taper * (ratio - 1.0);
  }
  vec2 px = centre + off; gl_Position = gone ? vec4(2.0, 2.0, 2.0, 1.0) : clipPos(px); v_y = px.y; v_d = d;
  v_uv = bar ? mix(a0.zw, a1.xy, 0.5) : mix(a0.zw, a1.xy, c);
  v_o = (c - 0.5) * size; v_bar = bar ? 1.0 : 0.0; v_bh = bth; v_hw = a2.z * u_laneW * sc * 0.5; v_sc = sc;
  float far = clamp((1.0 - d) / 0.14, 0.0, 1.0);
  v_a = u_pad > 0.5 ? 1.0 : bar ? far * (1.0 - e * e) : far;
  v_white = bar && past > 0.0 ? 0.85 * (1.0 - min(1.0, kx * 3.0)) : 0.0;
  v_boost = u_pad > 0.5 ? u_flash[int(clamp(a0.y, 0.0, 7.0))] : 0.0;
}`, `${FS_HEAD}uniform sampler2D u_tex; in vec2 v_uv, v_o; in float v_a, v_boost, v_white, v_y, v_d, v_bar, v_bh, v_hw, v_sc; out vec4 o;
void main() {
  if (v_bar > 0.5) { // a kick / open bar: the fill (whiter at the hit), a lit far edge and a darker near edge (highway3d.js), lines max(1, 2 scale) wide
    vec3 base = texture(u_tex, v_uv).rgb / max(texture(u_tex, v_uv).a, 1e-3);
    float hh = 0.5 * v_bh, lw = max(1.0, 2.0 * v_sc), ay = abs(v_o.y);
    float inX = clamp(v_hw - abs(v_o.x) + 0.5, 0.0, 1.0);
    vec3 col = mix(base, vec3(1.0), v_white);
    float fillC = clamp(hh - ay + 0.5, 0.0, 1.0);
    float farC = clamp(0.5 * lw - abs(v_o.y + hh) + 0.5, 0.0, 1.0);
    float nearC = clamp(0.5 * lw - abs(v_o.y - hh) + 0.5, 0.0, 1.0);
    vec3 rgb = col * fillC;
    float a = fillC;
    rgb = mix(rgb, mix(base, vec3(1.0), 0.65), farC); a = max(a, farC);
    rgb = mix(rgb, base * 0.6, nearC); a = max(a, nearC);
    a *= inX * v_a * edgeFade(v_y);
    o = vec4(rgb * a, a);
    return;
  }
  // the effect "fog": far notes lose focus (a lower mip of the sprite: a cheap depth of field) and take the colour of the air
  vec4 c = texture(u_tex, v_uv, u_fog * 3.2 * v_d * v_d) * v_a * edgeFade(v_y);
  c.rgb = mix(c.rgb, vec3(0.10, 0.14, 0.24) * c.a, u_fog * 0.5 * smoothstep(0.1, 1.0, v_d));
  c.rgb = min(c.rgb * (1.0 + v_boost * 1.4) + c.a * v_boost * 0.35, vec3(c.a));
  c.rgb = mix(c.rgb, vec3(c.a), v_white);
  o = c;
}`],
  // the resting hit pads (shown when the hit line bar is off): a rounded rectangle (a triangle on a cymbal lane) with a fill and a 2 px ring in the lane's colour, brighter while the
  // lane is hit (the 2D code's noteShape + padFill / padRing, setting highway.padLook). One quad per lane: instance (lane, cymbal lane).
  pads: [`${COMMON}in vec2 a_p; uniform float u_flash[8], u_bf, u_padFill, u_padRing, u_dpr; uniform vec3 u_lc[8]; out vec2 v_o; out vec3 v_col; out vec2 v_a; out float v_y, v_tri;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  int l = int(a_p.x); float f = u_flash[l];
  float rx = u_laneW * u_headR * 1.05 * (a_p.y > 0.5 ? 1.0 : ${RECT_SCALE});
  vec2 hs = vec2(rx * 1.5 + 4.0, rx * 0.55 * 1.5 + 4.0);
  vec2 off = (c - 0.5) * 2.0 * hs;
  vec2 px = project(a_p.x + 0.5 - u_half, 0.0) + off; gl_Position = clipPos(px); v_y = px.y;
  v_o = off; v_col = u_lc[l]; v_tri = a_p.y;
  v_a = vec2(min(0.9, u_padFill + 0.5 * f + 0.35 * u_bf), min(1.0, u_padRing + (1.0 - u_padRing) * max(f, u_bf)));
}`, `${FS_HEAD}in vec2 v_o, v_a; in vec3 v_col; in float v_y, v_tri; uniform float u_dpr; out vec4 o;
float sdRound(vec2 p, vec2 h, float r) { vec2 q = abs(p) - (h - r); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c, v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0), pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0), pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
void main() {
  float rx = u_laneW * u_headR * 1.05 * (v_tri > 0.5 ? 1.0 : ${RECT_SCALE}), ry = rx * 0.55;
  float dist = max(1.0, u_hit - u_vy);
  vec2 p = v_o; p.x /= max(0.2, 1.0 + ${TAPER_GAIN.toFixed(1)} * p.y / dist); // (the 2D outline narrows towards the far edge)
  float sd;
  if (v_tri > 0.5) {
    float w = rx * ${NOTE_TRI_W.toFixed(2)}, h = ry * ${NOTE_TRI_H.toFixed(2)};
    float L = sqrt(w * w + 4.0 * h * h), inr = 2.0 * w * h / (w + L), r = min(min(w, h) * ${NOTE_TRI_ROUND.toFixed(2)}, inr * 0.99);
    float k = (inr - r) / inr; vec2 ic = vec2(0.0, h - inr);
    sd = sdTri(p, ic + (vec2(0.0, -h) - ic) * k, ic + (vec2(w, h) - ic) * k, ic + (vec2(-w, h) - ic) * k) - r;
  } else {
    vec2 hh = vec2(rx * ${NOTE_RECT_W.toFixed(2)}, ry * ${NOTE_RECT_H.toFixed(2)});
    sd = sdRound(p, hh, min(hh.x, hh.y) * ${NOTE_RECT_ROUND.toFixed(2)});
  }
  float fillC = clamp(0.5 - sd, 0.0, 1.0), ringC = clamp(u_dpr - abs(sd) + 0.5, 0.0, 1.0);
  float ar = v_a.y * ringC, af = v_a.x * fillC;
  float a = (ar + af * (1.0 - ar)) * edgeFade(v_y);
  o = vec4(v_col * a, a);
}`],
  // the hit line bar: one segment per lane in the lane's colour (whiter while the lane is hit), over the notes and tails, with a border at each end (instance: lane, or -1 / -2)
  hitbar: [`${COMMON}in float a_i; uniform float u_bar, u_flash[8]; uniform vec3 u_lc[8]; uniform vec4 u_edge; out vec4 v_col; out float v_y;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float x0, x1; vec4 col;
  if (a_i < -1.5) { x0 = u_half - ${(FILL_BORDER_LANES * 0.4).toFixed(3)}; x1 = u_half + ${FILL_BORDER_LANES.toFixed(3)}; col = u_edge; }
  else if (a_i < -0.5) { x0 = -u_half - ${FILL_BORDER_LANES.toFixed(3)}; x1 = -u_half + ${(FILL_BORDER_LANES * 0.4).toFixed(3)}; col = u_edge; }
  else { int l = int(a_i); x0 = a_i - u_half; x1 = a_i + 1.0 - u_half; col = vec4(mix(u_lc[l], vec3(1.0), 0.3 + 0.45 * u_flash[l]), 1.0); }
  float d = (c.y - 0.5) * u_bar;
  vec2 px = project(mix(x0, x1, c.x), d); gl_Position = clipPos(px); v_y = px.y; v_col = col;
}`, FS_COLOR],
  // the hit burst: a rounded ripple, a flash and eight sparks on the hit line (drawHitBurst), looping three at a time while a long note is held, plus the glow where
  // its tail meets the line; one quad per burst, drawn additively, the pattern computed per pixel. Instances (time, lane, end, cymbal) + (r, g, b, held), each shared by 3 quads.
  burst: [`${COMMON}in vec4 b0; in vec4 b1; uniform float u_tailW; out vec2 v_p; out float v_k, v_rx, v_seed, v_glow, v_rg, v_ell, v_y; out vec3 v_col;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float j = float(gl_InstanceID % 3);
  float past = u_t - b0.x; float k, scl, seed, alive;
  if (b1.w < 0.5) { alive = (j < 0.5 && past >= u_lit && past <= 0.45) ? 1.0 : 0.0; k = past / 0.45; scl = 0.5; seed = b0.x; }
  else { alive = (past >= u_lit && past <= b0.z - b0.x) ? 1.0 : 0.0; float ph = past / 0.36 + j / 3.0; k = fract(ph); seed = b0.x + floor(ph) * 0.137 + j * 0.31; scl = 0.31; }
  float rx = u_laneW * u_headR * 0.72 * scl;
  float x = clamp(past / 0.2, 0.0, 1.0); float amt = x * x * (3.0 - 2.0 * x);
  float rg = u_laneW * u_headR * 0.38 * u_tailW * (1.0 + 0.04 * amt) * 2.4;
  vec2 hs = vec2(max(rx * 5.2, rg * 1.05), max(rx * 3.6, rg * 0.3));
  vec2 centre = project(b0.y + 0.5 - u_half, 0.0);
  vec2 off = (c - 0.5) * 2.0 * hs;
  vec2 px = centre + off; gl_Position = alive > 0.5 ? clipPos(px) : vec4(2.0, 2.0, 2.0, 1.0); v_y = px.y;
  v_p = off; v_k = k; v_rx = rx; v_seed = seed; v_col = b1.rgb; v_rg = rg; v_ell = b0.w;
  v_glow = (b1.w > 0.5 && j < 0.5) ? 0.5 * amt * (u_held > 0.5 ? 0.85 + 0.15 * sin(u_t * 22.0) : 1.0) : 0.0;
}`, `${FS_HEAD}in vec2 v_p; in float v_k, v_rx, v_seed, v_glow, v_rg, v_ell, v_y; in vec3 v_col; out vec4 o;
vec3 tintW(vec3 c, float a) { return mix(c, vec3(1.0), a); }
float sdRound(vec2 p, vec2 h, float r) { vec2 q = abs(p) - (h - r); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdShape(vec2 p, vec2 h) { return v_ell > 0.5 ? (length(p / h) - 1.0) * min(h.x, h.y) : sdRound(p, h, min(h.x, h.y) * 0.45); } // (a cymbal: an ellipse; a note: a rounded rectangle)
float segDist(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  float k = v_k, rx = v_rx, ry = rx * 0.55;
  float e = 1.0 - (1.0 - k) * (1.0 - k), fade = (1.0 - k) * (1.0 - k);
  vec3 sum = vec3(0.0);
  float rw = rx * 1.05 * (0.7 + 2.4 * e), rh = ry * 0.68 * (0.7 + 2.4 * e);
  float lw = max(0.8, rx * 0.24 * (1.0 - k));
  sum += tintW(v_col, 0.45) * (1.0 - smoothstep(lw * 0.5 - 0.5, lw * 0.5 + 0.5, abs(sdShape(v_p, vec2(rw, rh))))) * min(1.0, 1.15 * fade);
  if (k < 0.4) {
    float env = sin(3.14159265 * k / 0.4);
    float cw = rx * 1.05 * (0.6 + 0.5 * e), ch = ry * 0.68 * (0.6 + 0.5 * e);
    sum += tintW(v_col, 0.7) * (1.0 - smoothstep(-0.5, 0.5, sdShape(v_p, vec2(cw, ch)))) * 0.55 * env * env;
  }
  float base = floor(mod(v_seed * 1000.0, 97.0));
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float r = mod(base * 31.0 + fi * 57.0, 100.0) / 100.0;
    float a = -1.5707963 + (fi / 7.0 - 0.5) * 2.4 + (r - 0.5) * 0.3;
    float reach = rx * (2.0 + 2.4 * r) * e, tl = rx * (0.5 + 0.8 * r) * (1.0 - e * 0.5);
    float cs = cos(a), sn = sin(a), s0 = max(0.0, reach - tl);
    float sd = segDist(v_p, vec2(cs * s0, sn * s0 * 0.62), vec2(cs * reach, sn * reach * 0.62 - e * rx * 0.5 * (0.4 + r)));
    float w = max(0.8, rx * 0.17 * (1.0 - k));
    sum += tintW(v_col, 0.25) * (1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.5, sd)) * min(1.0, 1.1 * fade);
  }
  if (v_glow > 0.0) sum += v_col * v_glow * (1.0 - smoothstep(0.85, 1.0, length(v_p / vec2(v_rg, v_rg * 0.275))));
  o = vec4(sum * edgeFade(v_y), 0.0);
}`],
  // the fill activation mark (drawActivationMark): a pulsing additive halo, a ring (light green under white) around the head of the activation note; on a kick the bright far edge
  // of the bar. One quad per activation note: instances (time, lane, cymbal, bar).
  marks: [`${COMMON}in vec4 a0; uniform float u_bar; out vec2 v_p; out vec4 v_s; out float v_a, v_sc, v_y, v_isBar;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  bool bar = a0.w > 0.5;
  float past = u_t - a0.x; float kx = clamp(past / 0.1, 0.0, 1.0); float e = 1.0 - (1.0 - kx) * (1.0 - kx);
  float d = clamp((a0.x - u_t) / u_win, 0.0, 1.0); float sc = scaleAt(d);
  float far = clamp((1.0 - d) / 0.14, 0.0, 1.0);
  vec2 centre = project(bar ? 0.0 : a0.y + 0.5 - u_half, d);
  float rx = u_laneW * u_headR * sc * (1.0 - 0.5 * kx);
  vec2 r = a0.z > 0.5 ? vec2(rx, rx * 0.55) : vec2(rx * ${(NOTE_RECT_W * 1.15).toFixed(4)}, rx * ${(0.55 * NOTE_RECT_H * 1.15 * 1.1).toFixed(4)});
  float thick = max(2.0, (u_hit - u_vy) * u_k * sc * sc * u_bar * (1.0 - 0.55 * e));
  vec2 hs = bar ? vec2(u_half * u_laneW * sc + 4.0, thick + 4.0) : r * 2.3 + 4.0;
  vec2 off = (c - 0.5) * 2.0 * hs;
  vec2 px = centre + off; gl_Position = past > 0.1 ? vec4(2.0, 2.0, 2.0, 1.0) : clipPos(px); v_y = px.y;
  v_p = bar ? off + vec2(0.0, 0.5 * thick) : off; v_s = bar ? vec4(u_half * u_laneW * sc, thick, 0.0, 0.0) : vec4(r, 0.0, 0.0);
  v_a = far * (bar ? 1.0 - e * e : 1.0 - kx); v_sc = sc; v_isBar = bar ? 1.0 : 0.0;
}`, `${FS_HEAD}in vec2 v_p; in vec4 v_s; in float v_a, v_sc, v_y, v_isBar; out vec4 o;
const vec3 ACT = vec3(${ACT_RGB.join(', ')});
float ringCov(vec2 p, vec2 h, float w) { float f = length(p / h); float dist = (f - 1.0) * f / max(1e-4, length(p / (h * h))); return 1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.5, abs(dist)); }
void main() {
  float fade = edgeFade(v_y);
  if (v_isBar > 0.5) { // the far edge of an activation kick: a line across the bar
    float lw = max(1.0, 2.0 * v_sc);
    float cov = (1.0 - smoothstep(lw * 0.5 - 0.5, lw * 0.5 + 0.5, abs(v_p.y))) * step(abs(v_p.x), v_s.x);
    float a = cov * v_a * fade; o = vec4(ACT * a, a); return;
  }
  vec2 r = v_s.xy;
  float pulse = 0.5 + 0.5 * sin(u_t * 7.0);
  float rho = length(vec2(v_p.x, v_p.y * r.x / r.y));
  float f = clamp((rho - r.x * 0.8) / (r.x * 1.3), 0.0, 1.0);
  vec3 halo = ACT * (1.0 - f * f * (3.0 - 2.0 * f)) * (0.55 + 0.25 * pulse) * v_a;
  float a1 = ringCov(v_p, r * 1.3, 5.0 * v_sc) * 0.55 * v_a;
  float a2 = ringCov(v_p, r * 1.3, 2.0 * v_sc) * v_a;
  float a = a2 + a1 * (1.0 - a2);
  vec3 rgb = vec3(a2) + ACT * a1 * (1.0 - a2);
  o = vec4((rgb + (1.0 - a) * halo) * fade, a * fade);
}`],
  // the burst of a pedal / open bar (drawBarBurst): a flash along the whole bar, two rectangular ripples and sparks along its width. Instances (time, 0, 0, 0) + (r, g, b, seed).
  barburst: [`${COMMON}in vec4 b0; in vec4 b1; uniform float u_bar; out vec2 v_p; out float v_k, v_hw, v_hh, v_spark, v_seed, v_y; out vec3 v_col;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float past = u_t - b0.x; float k = past / 0.26;
  float hw = ${'u_half'} * u_laneW; float hh = max(2.0, (u_hit - u_vy) * u_k * u_bar * 0.5); float spark = u_laneW * u_headR * 0.6;
  float up = hh * 3.0 + spark * 2.4, dn = hh * 3.0;
  vec2 off = vec2((c.x - 0.5) * 2.0 * hw * 1.12, mix(-up, dn, c.y));
  vec2 px = project(0.0, 0.0) + off; gl_Position = (past >= u_lit && k < 1.0) ? clipPos(px) : vec4(2.0, 2.0, 2.0, 1.0); v_y = px.y;
  v_p = off; v_k = k; v_hw = hw; v_hh = hh; v_spark = spark; v_seed = b1.w; v_col = b1.rgb;
}`, `${FS_HEAD}in vec2 v_p; in float v_k, v_hw, v_hh, v_spark, v_seed, v_y; in vec3 v_col; out vec4 o;
vec3 tintW(vec3 c, float a) { return mix(c, vec3(1.0), a); }
float sdRound(vec2 p, vec2 h, float r) { vec2 q = abs(p) - (h - r); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float segDist(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  float k = v_k, hw = v_hw, hh = v_hh;
  float e = 1.0 - (1.0 - k) * (1.0 - k), fade = (1.0 - k) * (1.0 - k);
  vec3 sum = vec3(0.0);
  if (k < 0.4) {
    float env = sin(3.14159265 * k / 0.4);
    sum += tintW(v_col, 0.5) * (1.0 - smoothstep(-0.5, 0.5, sdRound(v_p, vec2(hw, hh * 1.1), hh))) * 0.36 * env * env;
  }
  for (int r = 0; r < 2; r++) {
    float kr = k - float(r) * 0.14;
    if (kr <= 0.0) continue;
    float kk = min(1.0, kr / (1.0 - float(r) * 0.14)); float er = 1.0 - (1.0 - kk) * (1.0 - kk);
    float rh = hh * (1.0 + 2.0 * er), rw = hw * (1.0 + 0.04 * er);
    float lw = max(0.8, hh * 0.5 * (1.0 - kr));
    sum += tintW(v_col, 0.45) * (1.0 - smoothstep(lw * 0.5 - 0.5, lw * 0.5 + 0.5, abs(sdRound(v_p, vec2(rw, rh), min(rh, 10.0))))) * min(1.0, (r == 1 ? 0.7 : 1.05) * (1.0 - kr) * (1.0 - kr));
  }
  float base = floor(mod(v_seed * 1000.0, 89.0));
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float r = mod(base * 29.0 + fi * 53.0, 100.0) / 100.0;
    float sx = (((fi + 0.5 + (r - 0.5) * 0.6) / 14.0) * 2.0 - 1.0) * hw * 0.95;
    float lean = (sx / hw) * 0.35 + (r - 0.5) * 0.25;
    float reach = v_spark * (0.9 + r) * e, tl = v_spark * (0.3 + 0.4 * r) * (1.0 - e * 0.5);
    float cs = sin(lean), sn = -cos(lean), s0 = max(0.0, reach - tl);
    float sd = segDist(v_p, vec2(sx + cs * s0, sn * s0 * 0.4), vec2(sx + cs * reach, sn * reach * 0.4));
    float w = max(0.8, v_spark * 0.12 * (1.0 - k));
    sum += tintW(v_col, 0.4) * (1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.5, sd)) * min(1.0, 1.1 * fade);
  }
  o = vec4(sum * edgeFade(v_y), 0.0);
}`],
  // the effect "solid": the notes as YARG's own 3D models (Assets/Art/Meshes/Gameplay/Notes/Rectangular of YARC-Official/YARG, LGPL-3.0, converted by
  // scripts/pack-note-meshes.mjs: a note is a metal frame with a coloured glass middle, a HOPO a smaller one with a white inner ring, a tap one with a dark one...). One mesh per
  // kind of note, drawn instanced (one instance per note, `divisor` 1) with the depth buffer on, so the faces hide one another. Each vertex is placed like the road: its width
  // along the lane, its depth along the road (in depth units) and its height lifted on the screen by the perspective scale at its depth, so the model gets a true perspective.
  // Lit by a fixed light above and in front: a texture of the model gives the metal its brushed look, the lane's colour tints the middle. Instances (time, lane, length, 0) + (r, g, b, 0).
  solid: [`${COMMON}in vec3 m_pos; in vec3 m_nrm; in vec2 m_uv; in float m_role; in vec4 s0; in vec4 s1; uniform vec3 u_msz; uniform float u_mbase, u_malpha;
out vec2 v_uv; out vec3 v_n, v_lane, v_mp; out float v_role, v_y, v_d, v_a;
void main() {
  float past = u_t - (s0.x + s0.z); float kx = clamp(past / 0.1, 0.0, 1.0); float sh = 1.0 - 0.5 * kx;
  bool gone = past > 0.1 || (s0.z > 0.0 && u_t >= s0.x);
  float d = clamp((s0.x - u_t) / u_win, 0.0, 1.0);
  float hs = u_headR / ${HEAD_R.toFixed(2)};
  float x = s0.y + 0.5 - u_half + m_pos.x * u_msz.x * sh * hs;
  float ky = mix(1.0, (u_laneW * u_msz.z) / max(u_span * u_msz.y, 1.0), u_side); // (in the side view a unit of depth is as long on the screen as a unit of height)
  float dep = d - m_pos.y * u_msz.y * ky * sh; // (the model's +y points at the player)
  float hgt = (m_pos.z - u_mbase) * u_msz.z * sh * hs;
  vec2 px = project(x, dep) - vec2(0.0, hgt * u_laneW * scaleAt(dep));
  vec4 clip = clipPos(px); clip.z = clamp(dep * 1.7 - 0.1 - hgt * 0.3, -0.99, 0.99); // (nearer and higher wins the depth test)
  gl_Position = gone ? vec4(2.0, 2.0, 2.0, 1.0) : clip; v_y = px.y; v_d = d;
  v_uv = m_uv; v_n = vec3(m_nrm.x, -m_nrm.y, m_nrm.z); v_lane = s1.rgb; v_role = m_role; v_mp = m_pos;
  v_a = clamp((1.0 - d) / 0.14, 0.0, 1.0) * u_malpha;
}`, `${FS_HEAD}uniform sampler2D u_mtex, u_mshine; uniform vec2 u_mnoise; in vec2 v_uv; in vec3 v_n, v_lane, v_mp; in float v_role, v_y, v_d, v_a; uniform float u_mcel, u_mtoon, u_mcym, u_mmetal, u_mglass, u_mcymst; out vec4 o;
// The middle of a note (YARG's RectangularNote shader graph, material NoteMiddle): the base map times a darkness mask that drifts with time (a soft cloud: gradient noise,
// scale -2.8 / speed 0.4 / tiling 1.1 x 1.3 in the material; here a value noise of two octaves), times the lane's colour, over which the shine map is laid with the opacity
// shine amount x its alpha (0.1); a small emission of the colour (0.1). The metal is the base map under the light, smoothness 0.5.
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// The metals: its colour, how much of a studio it reflects (a high value: a mirror), the strength and tightness of the highlight, how brushed it is, and how far the base map's darks are lifted
void metalStyle(float k, out vec3 tint, out float refl, out float spec, out float sexp, out float brush, out float lift) {
  if (k < 0.5) { tint = vec3(0.80, 0.82, 0.85); refl = 0.28; spec = 0.22; sexp = 10.0; brush = 0.07; lift = 0.45; }
  else if (k < 1.5) { tint = vec3(0.93, 0.95, 0.98); refl = 0.85; spec = 0.9; sexp = 48.0; brush = 0.0; lift = 0.6; }
  else if (k < 2.5) { tint = vec3(0.76, 0.78, 0.82); refl = 0.12; spec = 0.35; sexp = 14.0; brush = 0.55; lift = 0.3; }
  else if (k < 3.5) { tint = vec3(0.93, 0.75, 0.35); refl = 0.28; spec = 0.25; sexp = 10.0; brush = 0.07; lift = 0.45; }
  else if (k < 4.5) { tint = vec3(1.0, 0.80, 0.34); refl = 0.82; spec = 0.9; sexp = 48.0; brush = 0.0; lift = 0.6; }
  else if (k < 5.5) { tint = vec3(0.90, 0.82, 0.62); refl = 0.30; spec = 0.22; sexp = 10.0; brush = 0.10; lift = 0.5; }
  else if (k < 6.5) { tint = vec3(0.94, 0.62, 0.54); refl = 0.45; spec = 0.4; sexp = 20.0; brush = 0.05; lift = 0.5; }
  else if (k < 7.5) { tint = vec3(0.90, 0.48, 0.30); refl = 0.45; spec = 0.4; sexp = 20.0; brush = 0.12; lift = 0.4; }
  else if (k < 8.5) { tint = vec3(0.36, 0.38, 0.43); refl = 0.40; spec = 0.5; sexp = 24.0; brush = 0.15; lift = 0.3; }
  else { tint = vec3(0.12, 0.12, 0.14); refl = 0.90; spec = 1.0; sexp = 60.0; brush = 0.0; lift = 0.2; }
}
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  float g = texture(u_mtex, v_uv).r;
  vec3 Vc = normalize(mix(vec3(0.0, -0.55, 0.83), vec3(-0.95, 0.0, 0.3), u_side)); // (the direction to the camera: above and in front, or from the side of the lane 0 in the side view)
  vec3 N = normalize(v_n); vec3 L = normalize(mix(vec3(-0.25, -0.5, 0.85), vec3(-0.75, -0.2, 0.65), u_side)); vec3 H = normalize(L + Vc);
  float lam = max(dot(N, L), 0.0); float sp = pow(max(dot(N, H), 0.0), 36.0);
  vec3 c;
  if (u_mcel > 0.5) { // our own look: toon (u_mtoon 1: three tones of light, a hard highlight, an ink line on the silhouettes, the middle a lit gem in bands of colour) or smooth (0: the same shapes, soft gradients)
    bool toon = u_mtoon > 0.5 && u_mtoon < 1.5, gloss = u_mtoon > 1.5; // (u_mtoon: 0 smooth, 1 toon, 2 glossy)
    vec3 Rf = reflect(-Vc, N); // (the glossy look reflects a studio: a bright sky above, a dark floor, a soft box)
    vec3 env = mix(vec3(0.10, 0.12, 0.18), vec3(0.88, 0.94, 1.0), smoothstep(-0.25, 0.65, Rf.z)); float fres = pow(1.0 - max(dot(N, Vc), 0.0), 3.0);
    float box = pow(max(dot(Rf, normalize(L + vec3(0.0, 0.0, 0.35))), 0.0), 36.0);
    float dl = dot(N, L);
    float tone = toon ? (dl > 0.5 ? 1.0 : dl > 0.05 ? 0.66 : 0.38) : 0.35 + 0.65 * smoothstep(-0.1, 0.9, dl);
    float rim = 1.0 - max(dot(N, Vc), 0.0);
    vec3 ink = vec3(0.025, 0.03, 0.07);
    float hard = toon ? step(0.975, dot(N, H)) : pow(max(dot(N, H), 0.0), 48.0) * 0.7;
    if (v_role < 0.5 || v_role > 3.5) { // the shell: steel (a gold bezel on an accent)
      vec3 base = v_role > 6.5 ? vec3(0.30, 0.32, 0.37) : v_role > 3.5 ? vec3(1.0, 0.78, 0.28) : vec3(0.74, 0.76, 0.80); // (the cups light grey, the base dark grey, a gold cup on an accent)
      c = base * tone + vec3(0.55) * hard;
      c = mix(c, v_lane * 0.5 * tone, 0.1); // (a hint of the lane's colour on the metal)
      if (toon) { if (rim > 0.82) c = ink; } else c *= mix(0.55, 1.0, smoothstep(0.0, 0.5, 1.0 - rim));
      if (gloss) { vec3 mb = v_role > 6.5 ? vec3(0.30, 0.32, 0.37) : v_role > 3.5 ? vec3(1.0, 0.78, 0.28) : vec3(0.74, 0.76, 0.80); c = mb * (0.25 + 0.3 * tone) + env * mb * (0.45 + 0.9 * fres) + vec3(1.0) * box * 0.9; } // polished metal: the studio tinted by the metal
    } else if (v_role < 1.5) { // the gem: lit from inside, from a hot core to a darker edge
      float cv = max(dot(N, Vc), 0.0);
      float u = v_uv.x < 0.0 ? max(sqrt(max(1.0 - cv * cv, 0.0)), smoothstep(0.86, 1.0, abs(v_uv.y))) : v_uv.x; // (the glass tube: by how its surface faces the camera, darker at the caps)
      if (toon) c = u < 0.55 ? mix(v_lane, vec3(1.0), 0.1) : u < 0.86 ? v_lane * 0.92 : u < 0.96 ? v_lane * 0.6 : ink;
      else c = mix(v_lane * 0.72, mix(v_lane, vec3(1.0), 0.22), pow(1.0 - smoothstep(0.0, 1.0, u), 0.8)) * (1.0 - 0.35 * smoothstep(0.9, 1.0, u));
      if (v_uv.x < -1.5) { float core = toon ? step(u, 0.3) : 1.0 - smoothstep(0.12, 0.38, u); c = mix(c, v_uv.x < -2.5 ? ink : vec3(1.0), core); } // the core of a HOPO (white) or a tap (dark)
      if (gloss) { // glass: the light inside, a bright edge where it turns away, the studio reflected on it
        c = mix(v_lane * 0.6, mix(v_lane, vec3(1.0), 0.75), pow(1.0 - smoothstep(0.0, 1.0, u), 1.2)) * (1.0 - 0.3 * smoothstep(0.9, 1.0, u));
        if (v_uv.x < -1.5) { float core = 1.0 - smoothstep(0.12, 0.38, u); c = mix(c, v_uv.x < -2.5 ? ink : vec3(1.0), core); }
        c += env * (0.12 + 0.75 * fres) + vec3(1.0) * box * 0.95;
      }
      float glint = dot(N, normalize(L + vec3(-0.25, 0.1, 0.0)));
      if (!gloss) c += vec3(0.7) * (toon ? step(0.93, glint) * (u > 0.3 ? 1.0 : 0.0) : pow(max(glint, 0.0), 60.0) * 0.8); // the glint
    } else if (v_role < 2.5) c = vec3(1.0); // the white core of a HOPO (dome)
    else c = mix(ink, v_lane * 0.35, step(0.55, v_uv.x)); // the dark core of a tap (dome)
    c = min(c, vec3(1.0));
  }
  else if (v_role < 0.5) { // the metal (the style is a choice: fx.metal): the base map's baked shading kept for the form, a studio reflected on it, a highlight, and a brushing that goes from none to strong
    float capFace = step(0.6, abs(N.x));
    float rr = length(v_mp.yz), ang = atan(v_mp.y, v_mp.z);
    float lines = capFace > 0.5 ? vnoise(vec2(rr * 40.0, ang * 2.0)) : vnoise(vec2((v_mp.y + v_mp.z) * 40.0, v_mp.x * 1.5)); // (fast across the lines, slow along them)
    vec3 Tb = capFace > 0.5 ? normalize(vec3(0.0, v_mp.z, v_mp.y) + vec3(0.0, 0.0001, 0.0)) : vec3(1.0, 0.0, 0.0);
    float aniso = pow(sqrt(max(1.0 - pow(dot(Tb, H), 2.0), 0.0)), 14.0) * max(dot(N, L) * 0.7 + 0.3, 0.0);
    vec3 tint; float refl, spec, sexp, brush, lift;
    metalStyle(u_mmetal, tint, refl, spec, sexp, brush, lift);
    float baked = mix(g, 1.0, lift);
    vec3 Rm = reflect(-Vc, N);
    float sky = smoothstep(-0.3, 0.8, Rm.z);
    vec3 env = mix(vec3(0.22, 0.24, 0.28), vec3(0.97, 0.99, 1.0), sky); // (a blurred studio: a bright sky, a grey floor)
    if (refl > 0.6) env = mix(vec3(0.04, 0.05, 0.08), vec3(1.0), pow(sky, 1.6)) + vec3(0.7) * pow(max(dot(Rm, normalize(L + vec3(0.0, 0.0, 0.3))), 0.0), 12.0); // (a mirror: a harder studio)
    c = tint * baked * (0.5 + 0.55 * lam);
    c = mix(c, env * tint, refl);
    c += vec3(1.0) * (pow(max(dot(N, H), 0.0), sexp) * spec + aniso * (0.12 + brush * 0.9));
    c *= 1.0 + (0.07 + brush * 0.9) * (lines - 0.5);
  }
  else if (v_role < 1.5) { // the glass, lit from inside (the style is a choice: fx.glass)
    vec2 q = v_uv * vec2(1.1, 1.3) * 7.0 + vec2(u_t * 0.4, u_t * 0.25) * u_mnoise.x;
    float cloud = mix(u_mnoise.y, 1.0, 0.65 * vnoise(q) + 0.35 * vnoise(q * 2.3 + 11.0)); // (the darkness mask of the material, here only a gentle modulation)
    float face = clamp(dot(N, Vc), 0.0, 1.0);
    float core = pow(face, 2.2);
    float gv = u_mglass;
    if (u_mcym > 0.5 && u_mcymst > 0.5) { // a cymbal's coloured top as drum-cymbal metal tinted by the lane's colour: concentric lathe grooves, an anisotropic sheen that runs round them, a hard studio reflected on it
      float r = length(v_mp.xy), ang = atan(v_mp.y, v_mp.x);
      float lathe = 0.6 * vnoise(vec2(r * 55.0, ang * 1.5)) + 0.4 * vnoise(vec2(r * 140.0, ang * 3.0));
      vec3 Tc = normalize(vec3(-v_mp.y, -v_mp.x, 0.0) + vec3(0.0001)); // (the direction of the grooves, round the cymbal, in the world)
      float an = pow(sqrt(max(1.0 - pow(dot(Tc, H), 2.0), 0.0)), 22.0) * max(dot(N, L) * 0.7 + 0.3, 0.0);
      vec3 tint = mix(v_lane, vec3(1.0), 0.18);
      vec3 Rm = reflect(-Vc, N); float sky = smoothstep(-0.2, 0.9, Rm.z);
      vec3 env = mix(vec3(0.06, 0.07, 0.10), vec3(1.0), pow(sky, 1.4)) + vec3(0.8) * pow(max(dot(Rm, normalize(L + vec3(0.0, 0.0, 0.3))), 0.0), 16.0);
      vec3 body = tint * (0.35 + 0.65 * (0.5 + 0.5 * lam)) * (0.85 + 0.3 * lathe);
      c = mix(body, env * tint * 1.25, 0.55);
      c += vec3(1.0) * (an * 0.5 * (0.6 + 0.8 * lathe) + sp * 0.5);
      c += v_lane * 0.2 * pow(1.0 - face, 2.0);
    } else if (gv < 0.5) { // lamp: a saturated light, hottest where we look straight into it, gathering at the edge, with the cloud and the shine map's streak on it
      vec3 lamp = v_lane * (0.62 + 0.9 * core);
      lamp = mix(lamp, vec3(1.0), 0.3 * core * core);
      lamp *= mix(0.72, 1.0, (u_mcym > 0.5 ? 1.0 : g) * cloud);
      lamp += v_lane * 0.55 * pow(1.0 - face, 2.5);
      lamp = mix(lamp, vec3(1.0), (u_mcym > 0.5 ? 0.0 : 0.5) * texture(u_mshine, v_uv).a);
      c = lamp + vec3(1.0) * sp * 0.45; // (self-lit: the scene's light only adds a highlight)
    } else if (gv < 1.5) { // neon tube: a thin white-hot core, saturated colour, dark at the edge
      vec3 lamp = v_lane * (0.5 + 1.3 * core);
      lamp = mix(lamp, vec3(1.0), smoothstep(0.55, 0.9, core));
      lamp *= 0.35 + 0.65 * smoothstep(0.0, 0.4, face);
      c = lamp + vec3(1.0) * sp * 0.3;
    } else if (gv < 2.5) { // frosted: milky, soft, lighter than the lane's colour
      vec3 base = mix(v_lane, vec3(1.0), 0.5);
      vec3 lamp = base * (0.78 + 0.3 * core);
      lamp = mix(lamp, v_lane, 0.25 * (1.0 - core));
      lamp *= 0.9 + 0.1 * cloud;
      c = lamp + vec3(1.0) * pow(max(dot(N, H), 0.0), 14.0) * 0.2;
    } else if (gv < 3.5) { // crystal: facets in steps of how much the glass faces us, with bright edges between them
      float fq = floor(face * 5.0) / 5.0;
      vec3 lamp = v_lane * (0.5 + 0.95 * fq);
      float fe = 1.0 - smoothstep(0.0, 0.05, min(fract(face * 5.0), 1.0 - fract(face * 5.0)));
      lamp += vec3(1.0) * 0.25 * fe;
      lamp = mix(lamp, vec3(1.0), 0.35 * step(0.8, face));
      c = lamp + vec3(1.0) * sp * 0.4;
    } else if (gv < 4.5) { // candy gel: deep and glossy, dark at the edge, a hard highlight and a reflection
      vec3 lamp = v_lane * (0.42 + 0.7 * core);
      lamp = pow(lamp, vec3(0.9));
      lamp *= mix(0.55, 1.0, smoothstep(0.0, 0.5, face));
      float fres = pow(1.0 - face, 3.0);
      c = lamp + vec3(1.0) * (pow(max(dot(N, H), 0.0), 70.0) * 1.2 + pow(max(dot(reflect(-Vc, N), L), 0.0), 30.0) * 0.25) + v_lane * 0.15 * fres;
    } else { // ember: hot spots drifting in a darker glow
      float heat = smoothstep(0.35, 0.85, vnoise(q * 1.6 + 3.0));
      vec3 hot = mix(v_lane, vec3(1.0, 0.92, 0.65), 0.75);
      vec3 lamp = mix(v_lane * 0.5, hot, heat) * (0.6 + 0.8 * core);
      lamp += v_lane * 0.4 * pow(1.0 - face, 2.0);
      c = lamp + vec3(1.0) * sp * 0.3;
    }
  }
  else if (v_role < 2.5) c = mix(vec3(1.0), v_lane, 0.12) * (0.68 + 0.32 * lam); // the white of a HOPO
  else c = vec3(0.04) * (0.6 + 0.8 * lam) + vec3(1.0) * sp * 0.3; // the dark of a tap
  c = mix(c, vec3(0.10, 0.14, 0.24), u_fog * 0.5 * smoothstep(0.1, 1.0, v_d)); // (the fog of the other effect, when it is on)
  float a = v_a * edgeFade(v_y);
  o = vec4(c * a, a);
}`],

  // the effect "glow": a soft halo of the lane's colour around the lit glass of every note with a model (and its spill on the road), added to the picture: a quad per note (the
  // instances of the solid models), a falloff computed per pixel. u_gsz = (half width in lanes, half height in lanes, the height of the glass above the road in lanes, 0)
  glow: [`${COMMON}in vec4 s0; in vec4 s1; uniform vec4 u_gsz; out vec2 v_p; out vec3 v_col; out float v_k, v_y;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float past = u_t - (s0.x + s0.z); float kx = clamp(past / 0.1, 0.0, 1.0); float sh = 1.0 - 0.5 * kx;
  bool gone = past > 0.1 || (s0.z > 0.0 && u_t >= s0.x);
  float d = clamp((s0.x - u_t) / u_win, 0.0, 1.0); float sc = scaleAt(d);
  vec2 centre = project(s0.y + 0.5 - u_half, d) - vec2(0.0, u_gsz.z * u_laneW * sc * (u_headR / ${HEAD_R.toFixed(2)}));
  vec2 hs = vec2(u_gsz.x, u_gsz.y) * u_laneW * sc * (u_headR / ${HEAD_R.toFixed(2)}) * sh * 2.1; // (the halo reaches well past the glass)
  vec2 px = centre + (c - 0.5) * 2.0 * hs;
  gl_Position = gone ? vec4(2.0, 2.0, 2.0, 1.0) : clipPos(px);
  v_p = (c - 0.5) * 2.0; v_col = s1.rgb; v_y = px.y; v_k = clamp((1.0 - d) / 0.14, 0.0, 1.0) * (1.0 - kx);
}`, `${FS_HEAD}uniform float u_gain; in vec2 v_p; in vec3 v_col; in float v_k, v_y; out vec4 o;
void main() {
  float r = length(v_p * vec2(1.0, 1.15));
  float g = exp(-r * r * 4.2) * (1.0 - smoothstep(0.8, 1.0, r)); // (a bright core that falls off smoothly, gone at the quad's edge)
  float pulse = 0.88 + 0.12 * sin(u_t * 4.0 + v_col.r * 6.0); // (it breathes a little)
  vec3 col = v_col * 1.35 + vec3(0.08);
  o = vec4(col * g * 0.6 * u_gain * pulse * v_k * edgeFade(v_y), 0.0);
}`],

  // the effect "particles": sparks thrown up by every hit and embers rising from a held note, 24 per event, their paths computed in the vertex shader from the event's time
  // (a hash gives each its direction, speed and life; gravity pulls them back): nothing is stored per particle. Instances = events with a divisor of 24; additive.
  sparks: [`${COMMON}in vec4 b0; in vec4 b1; uniform float u_spread; out vec2 v_p; out float v_k, v_y, v_r; out vec3 v_col;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float fi = float(gl_InstanceID % 24);
  float seed = b0.x * 97.0 + fi * 13.7;
  float r1 = hash(seed), r2 = hash(seed + 1.3), r3 = hash(seed + 2.9);
  float life = 0.45 + 0.6 * r3;
  float past = u_t - b0.x, age, alive;
  if (b1.w < 0.5 || u_spread > 0.5) { age = past; alive = (past >= 0.0 && past < life) ? 1.0 : 0.0; } // a hit (a bar or a note)
  else { age = mod(past + r1 * life, life); alive = (past >= 0.0 && past <= b0.z - b0.x + 0.05 && fi < 12.0) ? 1.0 : 0.0; } // embers while held
  float k = age / life;
  vec2 origin = u_spread > 0.5 ? project(0.0, 0.0) + vec2((r2 - 0.5) * 2.0 * u_half * u_laneW * 0.95, 0.0) : project(b0.y + 0.5 - u_half, 0.0) + vec2((r2 - 0.5) * u_laneW * 0.45, 0.0);
  float ang = -1.5707963 + (r1 - 0.5) * (u_spread > 0.5 ? 0.9 : 2.2);
  float speed = u_laneW * (u_spread > 0.5 ? 1.3 : 2.4) * (0.45 + r2);
  vec2 p = origin + vec2(cos(ang), sin(ang) * 0.85) * speed * age + vec2(0.0, u_laneW * 3.2 * age * age);
  float r = max(1.2, u_laneW * (0.02 + 0.03 * r3) * (1.0 - 0.6 * k)); // radius in px
  vec2 px = p + (c - 0.5) * 2.0 * r * 1.6;
  gl_Position = alive > 0.5 ? clipPos(px) : vec4(2.0, 2.0, 2.0, 1.0);
  v_p = (c - 0.5) * 2.0; v_k = k; v_y = px.y; v_r = r; v_col = mix(b1.rgb, vec3(1.0), 0.35 + 0.4 * r2);
}`, `${FS_HEAD}in vec2 v_p; in float v_k, v_y, v_r; in vec3 v_col; out vec4 o;
void main() {
  float d = length(v_p); // 1 at the edge of the quad, whose half size is 1.6 radii
  float a = (1.0 - smoothstep(0.4, 0.62, d)) * (1.0 - v_k) * (1.0 - v_k) + 0.3 * (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - v_k); // a hot core and a round soft halo
  o = vec4(v_col * a * edgeFade(v_y), 0.0);
}`],
  // a motion blur sample: the framebuffer's picture added to the canvas as a running average (blendColor sets the weight 1 / (i + 1), see Highway.renderBlur)
  blur: [`${COMMON}out vec2 v_uv;
void main() { vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)); v_uv = c; gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0); }`, `#version 300 es
precision highp float;
uniform sampler2D u_tex; in vec2 v_uv; out vec4 o;
void main() { o = texture(u_tex, v_uv); }`],
};

// ---- helpers --------------------------------------------------------------------------------------------------------------------------------------------------------

const f32 = (arr) => Float32Array.from(arr);
const lowerBound = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const smooth = (x) => x * x * (3 - 2 * x);
const sortedBy = (list, key) => [...list].sort((a, b) => a[key] - b[key]);


// ---- our own note model: a pill ---------------------------------------------------------------------------------------------------------------------------------

// A stadium (a capsule: two half circles joined by straight sides) swept by a profile: the outline at an offset `o` from the segment [-L, L] of the x axis is a stadium of
// radius o, so a profile of (offset, height) pairs describes the whole note: a flat base slab, the wall of the body, a bevelled shoulder, a flat bezel, and a dome in the middle.
// Returns the mesh in the format of setMeshes: per triangle corner positions (x along the note, y depth, z up) / normals / uv (x: 0 at the middle of the dome to 1 at its edge)
// / role (0 shell, 1 gem, 2 pearl, 3 dark, 4 trim) and the half extents. `variant`: 'n' note, 'h' HOPO (a white core), 't' tap (a dark core), 'a' accent (a gold bezel), 'c' a cymbal.
function pillMesh(L, variant, flat = 1) {
  const gold = variant === 'a' || variant === 'ca';
  const P = [ // [offset, height, role]: from the outside of the base, up and inwards
    [1.18, 0, 0], [1.18, 0.3, 0], [1.0, 0.3, 0], [1.0, 0.75, 0], [0.99, 0.88, 0], [0.95, 0.98, 0], [0.88, 1.04, 0],
    [0.8, 1.04, gold ? 4 : 0], [0.78, 0.96, 0],
    [0.78, 0.96, 1], [0.74, 1.06, 1], [0.64, 1.2, 1], [0.5, 1.34, 1], [0.3, 1.46, 1], [0, 1.52, 1],
  ].map(([o, h, r]) => [o, h <= 0.3 ? h : 0.3 + (h - 0.3) * flat, r]);
  const core = variant === 'h' ? 2 : variant === 't' ? 3 : 0;
  const N = 18; // samples on each half circle
  const ring = []; // [x, y, nx, ny] of the unit outline: the point at offset 1 and the direction away from the segment
  for (let k = 0; k <= N; k++) { const a = -Math.PI / 2 + (k / N) * Math.PI; ring.push([L, 0, Math.cos(a), Math.sin(a)]); }
  for (let k = 0; k <= N; k++) { const a = Math.PI / 2 + (k / N) * Math.PI; ring.push([-L, 0, Math.cos(a), Math.sin(a)]); }
  const pos = [], nrm = [], uv = [], role = [];
  const corner = (seg, rj, ro, h, o, u, r) => { // one vertex of segment `seg` at ring point rj
    const [cx, cy, dx, dy] = ring[rj];
    pos.push(cx + dx * o, cy + dy * o, h);
    const nr = seg.nr, nu = seg.nu;
    nrm.push(dx * nr, dy * nr, nu);
    uv.push(u, 0);
    role.push(r);
    void ro;
  };
  for (let i = 0; i + 1 < P.length; i++) {
    const [o0, h0, r0] = P[i], [o1, h1] = P[i + 1];
    const dO = o1 - o0, dH = h1 - h0, len = Math.hypot(dO, dH);
    if (len < 1e-6) continue;
    const seg = { nr: dH / len, nu: -dO / len };
    const dome = r0 === 1;
    const rr = dome && o1 < 0.3 && core ? core : r0; // the inner part of the dome is the white / dark core of a HOPO / tap
    const u0 = dome ? o0 / 0.78 : 1, u1 = dome ? o1 / 0.78 : 1;
    for (let j = 0; j < ring.length; j++) {
      const k = (j + 1) % ring.length;
      const tri = [[j, o0, h0, u0], [k, o0, h0, u0], [j, o1, h1, u1], [k, o0, h0, u0], [k, o1, h1, u1], [j, o1, h1, u1]];
      for (const [rj, o, h, u] of tri) corner(seg, rj, 0, h, o, u, rr);
    }
  }
  const half = [0, 0, 0];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) half[a] = Math.max(half[a], Math.abs(pos[i + a]));
  return { pos, nrm, uv, role, size: half };
}

// The note as a lamp: a metal base from one cup to the other, a metal cup at each end whose mouth opens inwards (a concave dish: the outside of each is a dome, the inside a bowl) and, held
// in the two mouths, a glass tube lit from inside. The tube and the cups are round, cut flat at the top of the base (a pill with a flat bottom). The tube lies along x (the width of the
// note). `half` is the half length of the tube; variant 'h' (HOPO: a white core in the glass), 't' (tap: a dark core) and 'a' (accent: gold cups). The tube's vertices carry
// uv.x = -1 / -2 / -3 (the shader shades it by how it faces the camera; -2 a HOPO, -3 a tap) and uv.y = how far along it they are (-1 at one cup, 0 in the middle, 1 at the other).
function tubeMesh(half, variant) {
  const V = (p, n, u, v, r) => ({ p, n, u, v, r });
  const tris = []; // [vertex, vertex, vertex]
  const capRole = variant === 'a' ? 4 : 0, vcode = variant === 'h' ? -2 : variant === 't' ? -3 : -1; // (the glass is role 1; uv.x < 0 marks the tube and says which kind)
  const bz = 0.7, zc = 1.8, rc = 1.55, ri = 1.45, rt = 1.3, Dout = 1.0, Din = 0.8, N = 28, M = 6, tubeHalf = half + 0.1;
  const quadV = (a, b, c, d) => { tris.push([a, b, c], [a, c, d]); };
  // the tube (a full cylinder: it is cut below)
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const v = (a, x) => V([x, rt * Math.cos(a), zc + rt * Math.sin(a)], [0, Math.cos(a), Math.sin(a)], vcode, x / tubeHalf, 1);
    quadV(v(a0, -tubeHalf), v(a1, -tubeHalf), v(a1, tubeHalf), v(a0, tubeHalf));
  }
  // two thin rails of dark metal along the tube, on its two visible edges (the far-up one and the near-down one, seen from the camera): the frame around the glass
  for (const th of [Math.PI - 0.58, -0.58]) {
    const cy = rt * Math.cos(th), cz = zc + rt * Math.sin(th), rr = 0.24;
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
      const v = (a, x) => V([x, cy + rr * Math.cos(a), cz + rr * Math.sin(a)], [0, Math.cos(a), Math.sin(a)], 1, 0, 7);
      quadV(v(a0, -tubeHalf), v(a1, -tubeHalf), v(a1, tubeHalf), v(a0, tubeHalf));
    }
  }
  // the cups, one at each end
  for (const sg of [-1, 1]) {
    const x0 = sg * half;
    const dish = (rad, depth, inward) => { // a paraboloid x = x0 + sg * depth * (1 - (rho / rad)^2), outside (convex) or inside (concave: the normals point to the mouth)
      for (let k = 0; k < M; k++) {
        const r0 = rad * (1 - k / M), r1 = rad * (1 - (k + 1) / M);
        const x = (rho) => x0 + sg * depth * (1 - (rho / rad) ** 2);
        const slope = (rho) => (-2 * depth * rho) / (rad * rad); // dx/drho / sg
        for (let i = 0; i < N; i++) {
          const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
          const v = (rho, a) => {
            const c = Math.cos(a), sn = Math.sin(a), f = slope(rho);
            const n = inward ? [-sg, f * c, f * sn] : [sg, -f * c, -f * sn]; // (the outside faces out and away from the axis; the inside faces the mouth and the axis)
            const len = Math.hypot(...n);
            return V([x(rho), rho * c, zc + rho * sn], n.map((q) => q / len), 1, 0, inward ? 0 : capRole);
          };
          quadV(v(r0, a0), v(r0, a1), v(r1, a1), v(r1, a0));
        }
      }
    };
    dish(rc, Dout, false); // the outside: a dome
    dish(ri, Din, true); // the inside: a bowl, opening towards the tube
    for (let i = 0; i < N; i++) { // the lip: a ring between the bowl and the dome, facing the tube
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const v = (rho, a) => V([x0, rho * Math.cos(a), zc + rho * Math.sin(a)], [-sg, 0, 0], 1, 0, capRole);
      quadV(v(rc, a0), v(rc, a1), v(ri, a1), v(ri, a0));
    }
  }
  // cut everything flat at the top of the base
  const lerp = (a, b, t) => {
    const n = a.n.map((q, i) => q + (b.n[i] - q) * t), len = Math.hypot(...n) || 1;
    return V(a.p.map((q, i) => q + (b.p[i] - q) * t), n.map((q) => q / len), a.u + (b.u - a.u) * t, a.v + (b.v - a.v) * t, a.r);
  };
  const cut = [];
  for (const tri of tris) {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3], ina = a.p[2] >= bz, inb = b.p[2] >= bz;
      if (ina) out.push(a);
      if (ina !== inb) out.push(lerp(a, b, (bz - a.p[2]) / (b.p[2] - a.p[2])));
    }
    for (let k = 1; k + 1 < out.length; k++) cut.push([out[0], out[k], out[k + 1]]);
  }
  // the base: a slab from the outer tip of one cup to the outer tip of the other, deeper than the pill (no bottom face)
  const W = half + Dout, by = 1.25;
  const flat = (a, b, c, d, n) => quadV(V(a, n, 1, 0, 7), V(b, n, 1, 0, 7), V(c, n, 1, 0, 7), V(d, n, 1, 0, 7)); // (role 7: the base, a darker metal than the cups)
  const base = [];
  { const keep = tris.length; flat([-W, -by, bz], [W, -by, bz], [W, by, bz], [-W, by, bz], [0, 0, 1]);
    flat([-W, by, 0], [W, by, 0], [W, by, bz], [-W, by, bz], [0, 1, 0]);
    flat([-W, -by, 0], [W, -by, 0], [W, -by, bz], [-W, -by, bz], [0, -1, 0]);
    flat([W, -by, 0], [W, by, 0], [W, by, bz], [W, -by, bz], [1, 0, 0]);
    flat([-W, -by, 0], [-W, by, 0], [-W, by, bz], [-W, -by, bz], [-1, 0, 0]);
    base.push(...tris.slice(keep)); }
  const pos = [], nrm = [], uv = [], role = [];
  for (const tri of [...cut, ...base]) for (const v of tri) { pos.push(...v.p); nrm.push(...v.n); uv.push(v.u, v.v); role.push(v.r); }
  const size = [0, 0, 0];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) size[a] = Math.max(size[a], Math.abs(pos[i + a]));
  return { pos, nrm, uv, role, size };
}

// ---- the board ------------------------------------------------------------------------------------------------------------------------------------------------------

export class GLBoard {
  static create(canvas) {
    try {
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
      return gl ? new GLBoard(canvas, gl) : null;
    } catch { return null; }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    this.data = new WeakMap(); // chart -> its buffers
    this.live = new Set(); // the charts that have buffers (to free them)
    this.roads = new Map(); // `${lanes}|${stripes}` -> road geometry
    this.look = '';
    this.calls = 0;
    this.drawn = 0;
    this.blur = -1;
    this.blur = -1;
    this.onLost = null; // called when the GPU context is lost (the page then draws with the 2D code)
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.onLost?.(); });
    this.progs = {};
    for (const name of Object.keys(PROGRAMS)) this.progs[name] = this.compile(name);
    this.resetAtlas();
    this.ownMeshes = null; // our own pill models (built the first time the effect asks for them)
  }

  compile(name) {
    const gl = this.gl;
    const [vs, fs] = PROGRAMS[name];
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(s)}`); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    return { p, u, a: (n) => gl.getAttribLocation(p, n) };
  }

  // ---- the atlas: every kind of note drawn once by the app's own functions, on demand

  resetAtlas() {
    const gl = this.gl;
    this.atlas = { canvas: this.atlas?.canvas || document.createElement('canvas'), cells: new Map(), next: 0, dirty: true };
    this.atlas.canvas.width = this.atlas.canvas.height = ATLAS;
    this.actx = this.atlas.canvas.getContext('2d');
    this.actx.clearRect(0, 0, ATLAS, ATLAS);
    if (this.tex) { gl.deleteTexture(this.tex); this.tex = null; }
  }

  cellFor(kind, color, sp) {
    const key = `${kind}|${color}|${sp ? 1 : 0}`;
    const atlas = this.atlas;
    let uv = atlas.cells.get(key);
    if (uv) return uv;
    if (atlas.next >= COLS * ROWS) throw new Error('atlas full');
    const x = (atlas.next % COLS) * CELL_W, y = Math.floor(atlas.next / COLS) * CELL_H;
    atlas.next++;
    const c = this.actx;
    c.save();
    c.beginPath();
    c.rect(x, y, CELL_W, CELL_H);
    c.clip();
    const cx = x + CELL_W / 2, cy = y + CELL_H / 2;
    if (kind === 'bar') drawBarSprite(c, cx, cy, color);
    else if (kind === 'ring') drawRingSprite(c, cx, cy, color);
    else if (kind[0] === 'c') drawCymbalSprite(c, cx, cy, kind, color, sp);
    else drawNoteSprite(c, cx, cy, kind, color, sp, this.noteBase);
    c.restore();
    uv = [x / ATLAS, y / ATLAS, (x + CELL_W) / ATLAS, (y + CELL_H) / ATLAS];
    atlas.cells.set(key, uv);
    atlas.dirty = true;
    return uv;
  }

  uploadAtlas() {
    const gl = this.gl;
    if (!this.atlas.dirty && this.tex) return;
    if (!this.tex) this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.atlas.dirty = false;
  }

  // The models of the notes: `meshes` is the JSON of scripts/pack-note-meshes.mjs, `images` the textures by name ({ NormalNote, CymbalNote }: images or canvases). Until they are set the
  // effect "solid" draws nothing (the sprites stay).
  setMeshes(meshes, images) {
    const gl = this.gl;
    this.meshes = {};
    const texs = {};
    for (const [name, img] of Object.entries(images)) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      texs[name] = tex;
    }
    const zSpan = (m) => { let lo = Infinity, hi = -Infinity; for (let i = 2; i < m.pos.length; i += 3) { lo = Math.min(lo, m.pos[i]); hi = Math.max(hi, m.pos[i]); } return hi - lo; };
    const noteHeight = meshes.n ? zSpan(meshes.n) * (0.435 / meshes.n.size[0]) * 0.8 : 0; // the height of a rectangular note, in lanes: a cymbal is set against it
    for (const [kind, m] of Object.entries(meshes)) {
      const n = m.role.length;
      const data = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) data.set([m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2], m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2], m.uv[i * 2], m.uv[i * 2 + 1], m.role[i]], i * 9);
      const cym = kind[0] === 'c';
      const half = cym ? 0.44 / m.size[0] : 0.435 / 3.85; // (a note's half width is 0.435 lanes, a cymbal's radius 0.44; the HOPO and tap models are narrower on their own)
      let minZ = Infinity;
      for (let i = 0; i < n; i++) minZ = Math.min(minZ, m.pos[i * 3 + 2]);
      this.meshes[kind] = { buf: this.buffer(data), count: n, tex: texs[m.tex], shine: texs[`${m.tex}Shine`] ?? texs[m.tex], cym, msz: [half, half * 0.053, cym && noteHeight ? (noteHeight * CYMBAL_HEIGHT) / zSpan(m) : half * 0.8], base: minZ, alpha: kind === 'g' || kind === 'cg' ? 0.55 : 1, glow: cym ? [0.3, 0.34, noteHeight * CYMBAL_HEIGHT * 0.6] : [0.27, 0.26, noteHeight * 0.45] }; // (a cymbal is flatter than a note; glow: the halo's half width, half height and the height of the glass, in lanes)
    }
  }

  // Our own pill models (pillMesh), one per kind of note, with the same shape of data as the YARG ones: built the first time the effect "solid" asks for them (opts.fx.solid = 'own').
  buildOwnMeshes() {
    const gl = this.gl;
    const tex = gl.createTexture(); // (a 1 x 1 white texture for the sampler the cel shading does not use)
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this.ownMeshes = {};
    const kinds = { n: [2.2, 'n', 1], h: [1.45, 'h', 1], t: [1.45, 't', 1], a: [2.2, 'a', 1], g: [2.2, 'n', 1], c: [0, 'c', 0.3], ca: [0, 'ca', 0.3], cg: [0, 'c', 0.3] };
    for (const [kind, [L, variant, flat]] of Object.entries(kinds)) {
      const m = kind[0] === 'c' ? pillMesh(L, variant, flat) : tubeMesh(L, variant); // (the notes are lamps, the cymbals round dishes)
      const n = m.role.length;
      const data = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) data.set([m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2], m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2], m.uv[i * 2], m.uv[i * 2 + 1], m.role[i]], i * 9);
      const half = kind[0] === 'c' ? 0.44 : 0.435 / (L + 1.0); // (a note's half width, the cups included, is 0.435 lanes, a cymbal's radius 0.44)
      this.ownMeshes[kind] = { buf: this.buffer(data), count: n, tex, shine: tex, cel: true, cym: kind[0] === 'c', msz: [half, half * 0.053, half * (kind[0] === 'c' ? 0.8 : 1.0)], base: 0, alpha: kind === 'g' || kind === 'cg' ? 0.55 : 1, glow: kind[0] === 'c' ? [0.3, 0.34, 0.06] : [0.27, 0.26, 0.12] };
    }
  }

  buffer(data) { const gl = this.gl, b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }

  // ---- a chart's buffers

  roadGeometry(lanes, stripes) { // [lane x, fraction of the depth range, r, g, b, a] per vertex, as triangles
    const key = `${lanes}|${stripes ? 1 : 0}`;
    let r = this.roads.get(key);
    if (r) return r;
    const half = lanes / 2, v = [];
    const quad = (x0, x1, d0, d1, c, e0 = 0, e1 = 0) => { for (const [x, d, e] of [[x0, d0, e0], [x1, d0, e1], [x0, d1, e0], [x1, d0, e1], [x1, d1, e1], [x0, d1, e0]]) v.push(x, d, ...c, e); };
    const S = 40;
    for (let i = 0; i < S; i++) {
      const d0 = i / S, d1 = (i + 1) / S;
      quad(-half, half, d0, d1, [1, 1, 1, 0.045]);
      if (stripes) for (let l = 0; l < lanes; l += 2) quad(l - half, l + 1 - half, d0, d1, [1, 1, 1, 0.045]); // the lane stripes (the road's own alpha, like the 2D fill)
      for (let l = 1; l < lanes; l++) quad(l - half, l - half, d0, d1, [1, 1, 1, 0.1], -0.5, 0.5); // the dividers: lines 1 css px wide (the 2D code strokes them), whatever the distance
      quad(-half, -half, d0, d1, [1, 1, 1, 0.4], -1, 1); // the rails: 2 px
      quad(half, half, d0, d1, [1, 1, 1, 0.4], -1, 1);
    }
    const base = []; // (in rows like the road: a curved road bends its edges, and a single quad would stay straight and stick out past the rails)
    for (let i = 0; i < S; i++) for (const [x, d] of [[-half, i / S], [half, i / S], [-half, (i + 1) / S], [half, i / S], [half, (i + 1) / S], [-half, (i + 1) / S]]) base.push(x, d, 0, 0, 0, 1, 0);
    r = { road: { buf: this.buffer(f32(v)), count: v.length / 7 }, base: { buf: this.buffer(f32(base)), count: base.length / 7 } };
    this.roads.set(key, r);
    return r;
  }

  makeData(chart) {
    const lanes = chart.lanes || 5;
    const colors = chart.laneColors || NOTE_PALETTE.lanes;
    const drums = !!chart.drumKind;
    const barColor = drums ? (chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick) : NOTE_PALETTE.open;
    const laneColor = (l) => colors[Math.min(Math.max(l, 0), colors.length - 1)];
    const spans = sortedBy(chart.starPower || [], 'start');
    let si = 0;
    const src = [...chart.notes].sort((a, b) => a.time - b.time);
    const sp = new Array(src.length); // star power: the notes inside a phrase (the chart's own flag when it has one)
    src.forEach((n, i) => {
      while (si < spans.length && spans[si].end <= n.time) si++;
      sp[i] = n.sp ?? (si < spans.length && n.time >= spans[si].start);
    });
    const inst = [], instBars = []; // stride 12, in time order; reversed below (far notes are drawn before near ones); the bars are drawn first, under the sustains and the heads
    const times = [], lanesOf = [];
    const tails = [], hits = [], helds = [], barHits = [], acts = [], solids = {}; // (solids: per kind of model, the rows of its instances)
    src.forEach((n, i) => {
      const bar = n.open || n.lane < 0;
      const dk = bar && n.doubleKick ? 2 : 1;
      let uv;
      if (bar) uv = this.cellFor('bar', barColor, false);
      else if (drums) uv = this.cellFor(n.cymbal ? (n.accent ? 'ca' : n.ghost ? 'cg' : 'c') : n.accent ? 'a' : n.ghost ? 'g' : 'n', laneColor(n.lane), sp[i]);
      else uv = this.cellFor(n.tap ? 't' : n.hopo ? 'h' : 'n', laneColor(n.lane), sp[i]);
      times.push(n.time);
      lanesOf.push(bar ? -1 : n.lane);
      for (let j = 0; j < dk; j++) (bar ? instBars : inst).push([n.time, bar ? lanes / 2 - 0.5 : n.lane, uv[0], uv[1], uv[2], uv[3], 1, 1, n.length > 0 && !bar ? n.length : 0, bar ? 1 : 0, lanes, bar ? j * 1.3 : (n.cymbal ? 1 : 0)]);
      if (n.activation) acts.push(n.time, bar ? -1 : n.lane, n.cymbal ? 1 : 0, bar ? 1 : 0);
      if (bar) { barHits.push(n.time, 0, 0, 0, ...hexRgb(barColor), n.time); return; }
      const rgb = hexRgb(noteColor({ lane: n.lane, sp: sp[i] }, colors)); // (a star power note's tail and burst take its tinted colour)
      const cym = n.cymbal ? 1 : 0;
      (solids[cym ? (n.accent ? 'ca' : n.ghost ? 'cg' : 'c') : n.tap ? 't' : n.hopo ? 'h' : n.accent ? 'a' : n.ghost ? 'g' : 'n'] ??= []).push({ time: n.time, row: [n.time, n.lane, n.length > 0 ? n.length : 0, 0, ...rgb, 0] });
      if (n.length > 0) { tails.push({ t0: n.time, t1: n.time + n.length, lane: n.lane, rgb }); helds.push(n.time, n.lane, n.time + n.length, cym, ...rgb, 1); }
      else hits.push(n.time, n.lane, n.time, cym, ...rgb, 0);
    });
    const packNotes = (rows) => {
      const count = rows.length;
      const data = new Float32Array(count * 12);
      rows.forEach((row, i) => data.set(row, (count - 1 - i) * 12)); // (latest first)
      return { buf: this.buffer(data), count, times: Float32Array.from(rows, (r) => r[0]), maxLen: rows.reduce((m, r) => Math.max(m, r[8]), 0) };
    };
    const noteList = packNotes(inst), barList = packNotes(instBars);
    tails.sort((a, b) => a.t0 - b.t0);
    const tailData = new Float32Array(tails.length * 8);
    tails.forEach((t, i) => tailData.set([t.t0, t.t1, t.lane, 0, ...t.rgb, 1], (tails.length - 1 - i) * 8));
    let maxLen = 0;
    for (const t of tails) maxLen = Math.max(maxLen, t.t1 - t.t0);
    const list = (arr, stride) => ({ buf: this.buffer(f32(arr)), count: arr.length / stride, times: Float32Array.from({ length: arr.length / stride }, (_, i) => arr[i * stride]), maxLen });
    const solid = {};
    for (const [kind, list] of Object.entries(solids)) {
      const data = new Float32Array(list.length * 8);
      list.forEach((e, i) => data.set(e.row, (list.length - 1 - i) * 8)); // (latest first, like the sprites)
      solid[kind] = { buf: this.buffer(data), count: list.length, times: Float32Array.from(list, (e) => e.time) };
    }
    const heldB = list(helds, 8);
    heldB.maxLen = maxLen;
    const beatKinds = (chart.beats || []).map((b) => [b.time, b.measure ? 2 : b.strong ? 1 : 0]).flat();
    const pads = [];
    for (let l = 0; l < lanes; l++) pads.push(l, chart.laneKinds?.[l] === 'cymbal' ? 1 : 0);
    const hasOpen = chart.notes.some((n) => n.open);
    return {
      lanes, colors, drums, hasOpen,
      notes: { ...noteList, fTimes: Float32Array.from(times), fLanes: Float32Array.from(lanesOf) }, // (a double kick is two instances: the lights read the notes once)
      tails: { buf: this.buffer(tailData), count: tails.length, starts: Float32Array.from(tails, (t) => t.t0), ends: Float32Array.from(tails, (t) => t.t1), lane: Float32Array.from(tails, (t) => t.lane), maxLen },
      hitB: list(hits, 8),
      heldB,
      solid,
      barB: list(barHits, 8),
      actB: list(acts, 4),
      beats: { buf: this.buffer(f32(beatKinds)), times: Float32Array.from(chart.beats || [], (b) => b.time) },
      pads: { buf: this.buffer(f32(pads)), count: lanes },
      bars: barList,
      bands: null, bandKey: '',
      vaos: {}, flash: new Float32Array(8), padFlash: new Float32Array(8), lc: Float32Array.from(Array.from({ length: 8 }, (_, l) => hexRgb(laneColor(Math.min(l, lanes - 1)))).flat()),
    };
  }

  // The overlay bands: star power, solo, fills, the big rock ending, roll columns, and their borders. Static per chart and per setting: instances (t0, t1, x, half width)
  // + colour + (alpha slot), sorted by start.
  makeBands(chart, d, o) {
    const half = d.lanes / 2;
    const out = [];
    const add = (t0, t1, x0, x1, c, slot = MUL_SLOTS - 1, zero = 0) => { if (t1 > t0) out.push([t0, t1, (x0 + x1) / 2, (x1 - x0) / 2, c[0], c[1], c[2], c[3], slot, zero, 0, 0]); };
    const borders = (spanList, left, right, t0k = 'start', t1k = 'end') => {
      for (const s of spanList || []) {
        add(s[t0k], s[t1k], -half - FILL_BORDER_LANES, -half + FILL_BORDER_LANES * 0.4, left);
        add(s[t0k], s[t1k], half - FILL_BORDER_LANES * 0.4, half + FILL_BORDER_LANES, right);
      }
    };
    if (o.starPowerBand) for (const s of chart.starPower || []) add(s.start, s.end, -half, half, STAR_POWER_BAND);
    if (o.bandBorders) borders(chart.starPower, rgba(BAND_BORDERS.starPower), rgba(BAND_BORDERS.starPower));
    if (o.soloBand) for (const s of chart.solos || []) add(s.start, s.end, -half, half, SOLO_BAND);
    if (o.bandBorders) borders(chart.solos, rgba(BAND_BORDERS.solo), rgba(BAND_BORDERS.solo));
    const fills = o.fillBand ? spansOfKind(chart, chart.fillBands ?? chart.fills, 'kind', 'fill') : [];
    for (const s of fills) {
      const end = s.bandEnd ?? s.end;
      add(s.start, end, -half, half, rgba(FILL_COLORS.fill));
      add(s.start, end, -half - FILL_BORDER_LANES, -half + FILL_BORDER_LANES * 0.4, rgba(FILL_BORDER));
      add(s.start, end, half - FILL_BORDER_LANES * 0.4, half + FILL_BORDER_LANES, rgba(FILL_BORDER));
      if (s.activationLane !== undefined) { // the lead-up: a stronger green over the column of the final note (every column for the kick)
        if (s.activationLane >= 0 && s.activationLane < d.lanes) add(s.start, end, s.activationLane - half, s.activationLane + 1 - half, rgba(FILL_STRONG));
        else add(s.start, end, -half, half, rgba(FILL_STRONG));
      }
    }
    if (o.breBand !== 'off') {
      const bre = spansOfKind(chart, chart.fills, 'kind', 'bre'); // every lane in its own colour, pulsing (the alpha slot of lane l, see drawPane)
      for (let l = 0; l < d.lanes && l < MUL_SLOTS - 1; l++) {
        const c = rgba(d.colors[l] || d.colors[0]);
        for (const s of bre) add(s.start, s.end, -half + l, -half + l + 1, [c[0], c[1], c[2], 1], l);
      }
      if (o.bandBorders) borders(bre, rgba(d.colors[0]), rgba(d.colors[d.lanes - 1] || d.colors[0]));
    }
    const kickCol = d.drums ? (chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick) : NOTE_PALETTE.kick;
    for (const type of ['kick', 'tremolo', 'trill']) {
      for (const s of spansOfKind(chart, chart.rolls, 'type', type)) {
        if (!s.lanes) continue;
        for (const l of s.lanes) {
          const c = rgba(withAlpha(l >= 0 && l < d.lanes ? d.colors[l] : kickCol, ROLL_COLUMN_ALPHA));
          if (l >= 0 && l < d.lanes) add(s.start - ROLL_LEAD_SEC, s.end + ROLL_LEAD_SEC, l - half, l + 1 - half, c);
          else add(s.start - ROLL_LEAD_SEC, s.end + ROLL_LEAD_SEC, -half, half, c);
        }
      }
    }
    const openCol = rgba(withAlpha(NOTE_PALETTE.open, 0.3));
    for (const n of chart.notes) if (n.open && n.length > 0) add(n.time, n.time + n.length, -half, half, openCol, MUL_SLOTS - 1, 1); // (the sustain of an open note: a band over every lane)
    out.sort((a, b) => a[0] - b[0]);
    const data = new Float32Array(out.length * 12);
    out.forEach((r, i) => data.set(r, i * 12));
    let maxLen = 0;
    for (const r of out) maxLen = Math.max(maxLen, r[1] - r[0]);
    return { buf: this.buffer(data), count: out.length, starts: Float32Array.from(out, (r) => r[0]), maxLen, bre: chart.fills?.some((s) => s.kind === 'bre') };
  }

  freeData(d) {
    const gl = this.gl;
    for (const k of ['notes', 'bars', 'tails', 'hitB', 'heldB', 'barB', 'actB', 'beats', 'pads']) gl.deleteBuffer(d[k].buf);
    for (const k of Object.keys(d.solid)) gl.deleteBuffer(d.solid[k].buf);
    if (d.bands) gl.deleteBuffer(d.bands.buf);
    for (const v of Object.values(d.vaos)) gl.deleteVertexArray(v);
  }

  // The buffers of every chart are dropped (a new song, or the look of the notes changed: the atlas is drawn again too).
  dropAll() {
    for (const c of this.live) { const d = this.data.get(c); if (d) this.freeData(d); this.data.delete(c); }
    this.live.clear();
    this.resetAtlas();
  }

  // A chart that is no longer shown: its buffers are freed.
  release(chart) {
    const d = this.data.get(chart);
    if (!d) return;
    this.freeData(d);
    this.data.delete(chart);
    this.live.delete(chart);
  }

  dataFor(chart) {
    let d = this.data.get(chart);
    if (!d) { d = this.makeData(chart); this.data.set(chart, d); this.live.add(chart); }
    return d;
  }

  // ---- frame

  // blur: -1 for a normal frame; i >= 0 for sample i of a motion blur: the frame goes to a framebuffer and end() adds it to the canvas with the weight 1 / (i + 1)
  // (the canvas is cleared by sample 0), the same running average the 2D code makes with drawImage.
  begin(w, h, dpr, look = '', blur = -1) {
    const gl = this.gl;
    const W = Math.max(2, Math.round(w * dpr)), H = Math.max(2, Math.round(h * dpr));
    const cv = this.canvas;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    this.dpr = dpr;
    this.H = H;
    this.W = W;
    const sig = `${look}|${ynoteVersion}`;
    if (sig !== this.look) { this.look = sig; this.noteBase = Number(look.split('|')[0]) || 1; if (this.live.size) this.dropAll(); else this.resetAtlas(); }
    this.blur = blur;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (blur <= 0) gl.clear(gl.COLOR_BUFFER_BIT); // (a normal frame, or the first sample: the canvas starts empty)
    if (blur >= 0) { this.blurTarget(W, H); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.calls = 0;
    this.drawn = 0;
  }

  // The framebuffer a motion blur sample is drawn into (the size of the canvas).
  blurTarget(W, H) {
    const gl = this.gl;
    if (this.fbo && this.fboW === W && this.fboH === H) return;
    if (!this.fbo) { this.fbo = gl.createFramebuffer(); this.fboTex = gl.createTexture(); }
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    this.fboW = W; this.fboH = H;
  }

  // The end of a frame: a motion blur sample is added to the canvas (running average, weight 1 / (i + 1)).
  end() {
    if (this.blur < 0 || this.lost) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.SCISSOR_TEST);
    const pr = this.progs.blur;
    gl.useProgram(pr.p);
    gl.bindVertexArray(this.blurVao ??= gl.createVertexArray());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1i(pr.u.u_tex, 0);
    gl.blendColor(0, 0, 0, 1 / (this.blur + 1));
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    this.blur = -1;
  }

  vao(d, name, setup) {
    const gl = this.gl;
    if (!d.vaos[name]) d.vaos[name] = gl.createVertexArray();
    gl.bindVertexArray(d.vaos[name]);
    setup();
  }

  attrib(pr, name, size, stride, offset, divisor) {
    const gl = this.gl, l = pr.a(name);
    if (l < 0) return;
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(l, divisor);
  }

  inst(mode, first, count, n) { this.calls++; this.gl.drawArraysInstanced(mode, first, count, n); }

  shared(pr, t, v) {
    const gl = this.gl, u = pr.u;
    if (u.u_res) gl.uniform2f(u.u_res, v.res[0], v.res[1]);
    const vals = { u_side: v.side, u_sx0: v.sx0, u_sy0: v.sy0, u_span: v.span, u_hit: v.hit, u_vy: v.vy, u_k: v.k, u_c: v.c, u_cx: v.cx, u_laneW: v.laneW, u_half: v.half, u_t: t, u_win: v.win, u_flip: v.flip, u_headR: v.headR, u_end: v.end, u_fh: v.fh, u_padB: v.padB, u_board: v.board, u_lit: v.lit, u_held: v.held, u_tailW: v.tailW, u_bar: v.bar, u_taper: v.taper, u_fog: v.fog, u_relief: v.relief };
    for (const n in vals) if (u[n]) gl.uniform1f(u[n], vals[n]);
  }

  // Which pads are lit: a note hit in the last HIT_FLASH_SEC, a sustain being held, a bar hit (lights every pad); the same lights as renderLanes3D.
  flashes(d, t, o) {
    const f = d.flash, pf = d.padFlash, n = d.notes;
    f.fill(0);
    let bar = 0;
    const flicker = o.heldMotion ? 0.15 * Math.sin(t * 22) : 0;
    const lit = o.litLag > 0 ? o.litLag : 0;
    for (let i = lowerBound(n.fTimes, t - BAR_FLASH_SEC); i < n.fTimes.length && n.fTimes[i] <= t; i++) {
      const l = n.fLanes[i], age = t - n.fTimes[i];
      if (age < lit) continue; // (a backward seek animation lights nothing it sweeps over)
      if (l >= 0 && l < 8) { if (age < HIT_FLASH_SEC) f[l] = Math.max(f[l], 1 - age / HIT_FLASH_SEC); }
      else if (l < 0 && age < BAR_FLASH_SEC) bar = Math.max(bar, 1 - age / BAR_FLASH_SEC);
    }
    if (o.fillActivation) for (let i = lowerBound(d.actB.times, t - BAR_FLASH_SEC); i < d.actB.count && d.actB.times[i] <= t; i++) if (t - d.actB.times[i] >= lit) bar = Math.max(bar, 1 - (t - d.actB.times[i]) / BAR_FLASH_SEC); // (a fill's activation note lights the whole kit)
    const tl = d.tails;
    for (let i = lowerBound(tl.starts, t - tl.maxLen); i < tl.count && tl.starts[i] <= t; i++) {
      if (tl.ends[i] + 0.25 < t || tl.lane[i] >= 8 || t - tl.starts[i] < lit) continue;
      const x = Math.min(1, (t - tl.starts[i]) / 0.2), rampIn = smooth(x);
      const rampOut = t <= tl.ends[i] ? 1 : Math.max(0, 1 - (t - tl.ends[i]) / 0.25);
      f[tl.lane[i]] = Math.max(f[tl.lane[i]], Math.min(rampIn, rampOut) * (0.75 + flicker));
    }
    for (let l = 0; l < 8; l++) pf[l] = f[l]; // (the pads: the lane's own flash; the bar's goes in on its own)
    for (let l = 0; l < 8; l++) f[l] = Math.max(f[l], bar);
    return bar;
  }

  // Draws one lane pane. rect: { x, y, w, h } in CSS px of the stage (y from the top). opts: the highway's settings for this pane (neck, perspective, curve, noteSize,
  // sustainWidth, kickBar, hitLine, laneStripes, trackOpacity, boardK, leftHanded, heldMotion, windowSec, starPowerBand, soloBand, fillBand, breBand, bandBorders, beatStyle).
  drawPane(chart, t, rect, o) {
    const gl = this.gl;
    if (this.lost || !(rect.w >= 1 && rect.h >= 1)) return 0;
    const dpr = this.dpr;
    const px = Math.round(rect.x * dpr), pw = Math.max(1, Math.round((rect.x + rect.w) * dpr) - px), ph = Math.max(1, Math.round(rect.h * dpr));
    const py = this.H - Math.round((rect.y + rect.h) * dpr);
    gl.viewport(px, py, pw, ph);
    gl.scissor(px, py, pw, ph);
    const d = this.dataFor(chart);
    this.uploadAtlas(); // (the sprites of a new chart are drawn into the atlas when its buffers are made)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    const w = pw, h = ph, lanes = d.lanes;
    const portrait = h > w;
    const roadW = portrait ? w * 0.9 : Math.min(h * 1.2, h * 0.9 + (w - h) * 0.3); // (the road's width, as renderLanes3D)
    const laneW = roadW / lanes;
    const hit = h * HIT_Y;
    const proj = projection3D(h, hit, o.perspective, o.curve);
    const headR = HEAD_R * o.noteSize;
    const padRy = laneW * headR * 1.05 * 0.55;
    const padB = hit + padRy;
    const fx = o.fx || {}; // the optional effects (taper, fog, relief, particles, solid): each is on or off; solid is 'own' (our pill models) or 'yarg' (YARG's, once setMeshes has them)
    if (fx.solid === 'own' && !this.ownMeshes) this.buildOwnMeshes();
    const models = fx.solid === 'own' ? this.ownMeshes : fx.solid ? this.meshes : null;
    const side = Math.max(0, Math.min(1, o.side || 0));
    const sx0 = w * 0.16;
    const v = {
      side, sx0, sy0: h * 0.6, span: (w - sx0) * 0.95 * 3, // (the side view shows a third of the window: a note is as thick as it is tall, so a whole window would crowd them)
      res: [w, h], hit, vy: proj.vy, k: proj.k, c: proj.c, cx: w / 2, laneW, half: lanes / 2, win: o.windowSec, flip: o.leftHanded ? -1 : 1, headR,
      taper: fx.taper ? 1 : 0, fog: fx.fog ? 1 : 0, relief: fx.relief ? 1 : 0,
      lit: o.litLag > 0 ? o.litLag : 0, held: o.heldMotion ? 1 : 0,
      end: proj.end, fh: side > 0.5 ? -1 : h * 0.26, padB: h - padB > 2 && side < 0.5 ? padB : h * 4, board: o.boardK, tailW: o.sustainWidth, bar: BAR_DEPTH * o.kickBar,
    };
    const win = v.win;
    const barFlash = this.flashes(d, t, o);
    const bandKey = `${o.starPowerBand}|${o.soloBand}|${o.fillBand}|${o.breBand}|${o.bandBorders}`;
    if (d.bandKey !== bandKey) { if (d.bands) gl.deleteBuffer(d.bands.buf); d.bands = this.makeBands(chart, d, o); d.bandKey = bandKey; }
    const P = this.progs;
    let pr;
    const use = (name) => { pr = P[name]; gl.useProgram(pr.p); this.shared(pr, t, v); };

    // the road, then its dark base behind it (premultiplied blending cannot draw behind: the base goes first, the road on top of it)
    const road = this.roadGeometry(lanes, o.laneStripes);
    use('flat');
    gl.uniform1f(pr.u.u_dpr, dpr);
    gl.uniform1f(pr.u.u_noFade, 2);
    gl.uniform1f(pr.u.u_amul, o.trackOpacity * o.boardK);
    this.vao(d, 'base', () => { gl.bindBuffer(gl.ARRAY_BUFFER, road.base.buf); this.attrib(pr, 'a_pos', 2, 28, 0, 0); this.attrib(pr, 'a_col', 4, 28, 8, 0); this.attrib(pr, 'a_ext', 1, 28, 24, 0); });
    this.calls++;
    gl.drawArrays(gl.TRIANGLES, 0, road.base.count);
    gl.uniform1f(pr.u.u_noFade, 0);
    gl.uniform1f(pr.u.u_amul, o.boardK);
    this.vao(d, 'road', () => { gl.bindBuffer(gl.ARRAY_BUFFER, road.road.buf); this.attrib(pr, 'a_pos', 2, 28, 0, 0); this.attrib(pr, 'a_col', 4, 28, 8, 0); this.attrib(pr, 'a_ext', 1, 28, 24, 0); });
    this.calls++;
    gl.drawArrays(gl.TRIANGLES, 0, road.road.count);

    // the bands (star power, solo, fills, rolls, the big rock ending): the ones in view, any overlapping
    const bands = d.bands;
    const bFrom = lowerBound(bands.starts, t - bands.maxLen - 1e-6), bTo = lowerBound(bands.starts, t + win + 1e-6);
    if (bTo > bFrom) {
      use('bands');
      const mul = new Float32Array(MUL_SLOTS).fill(1);
      if (bands.bre) for (let l = 0; l < lanes && l < MUL_SLOTS - 1; l++) mul[l] = breAlpha(t, l, lanes, o.breBand === 'pulse');
      gl.uniform1fv(pr.u.u_mul, mul);
      this.vao(d, 'bands', () => { gl.bindBuffer(gl.ARRAY_BUFFER, bands.buf); this.attrib(pr, 'a_t', 4, 48, bFrom * 48, 1); this.attrib(pr, 'a_col', 4, 48, bFrom * 48 + 16, 1); this.attrib(pr, 'a_x', 4, 48, bFrom * 48 + 32, 1); });
      this.inst(gl.TRIANGLE_STRIP, 0, 2 * BAND_ROWS, bTo - bFrom);
    }

    // the beat lines in the window
    if (o.beatStyle) {
      const lo = lowerBound(d.beats.times, t), hi = lowerBound(d.beats.times, t + win);
      if (hi > lo) {
        use('beats');
        gl.uniform4fv(pr.u.u_bc, o.beatStyle.flatMap((c) => rgba(c)));
        this.vao(d, 'beats', () => { gl.bindBuffer(gl.ARRAY_BUFFER, d.beats.buf); this.attrib(pr, 'a_b', 2, 8, lo * 8, 1); });
        this.inst(gl.TRIANGLE_STRIP, 0, 4, hi - lo);
      }
    }

    // the pads (without the hit line bar, whose coloured segments replace them)
    if (!o.hitLine) {
      use('pads');
      gl.uniform1fv(pr.u.u_flash, d.padFlash);
      gl.uniform3fv(pr.u.u_lc, d.lc);
      gl.uniform1f(pr.u.u_bf, barFlash);
      gl.uniform1f(pr.u.u_padFill, o.padFill); gl.uniform1f(pr.u.u_padRing, o.padRing);
      gl.uniform1f(pr.u.u_dpr, dpr);
      this.vao(d, 'pads', () => { gl.bindBuffer(gl.ARRAY_BUFFER, d.pads.buf); this.attrib(pr, 'a_p', 2, 8, 0, 1); });
      this.inst(gl.TRIANGLE_STRIP, 0, 4, d.pads.count);
    }

    // the pedal / open bars (under the sustains and the heads), far ones first
    {
      const bl = d.bars, bFrom2 = lowerBound(bl.times, t - bl.maxLen - 0.12), bTo2 = lowerBound(bl.times, t + win);
      if (bTo2 > bFrom2) {
        use('notes');
        gl.uniform1i(pr.u.u_tex, 0); gl.uniform1f(pr.u.u_atlas, ATLAS);
        gl.uniform1f(pr.u.u_pad, 0);
        const first = bl.count - bTo2;
        this.vao(d, 'bars', () => { gl.bindBuffer(gl.ARRAY_BUFFER, bl.buf); this.attrib(pr, 'a0', 4, 48, first * 48, 1); this.attrib(pr, 'a1', 4, 48, first * 48 + 16, 1); this.attrib(pr, 'a2', 4, 48, first * 48 + 32, 1); });
        this.inst(gl.TRIANGLE_STRIP, 0, 4, bTo2 - bFrom2);
      }
    }

    // the sustains (flow style): a halo (held only), the body, a lighter core, a bright spine and the chevrons (held only)
    const tails = d.tails;
    const tFrom = lowerBound(tails.starts, t - tails.maxLen), tTo = lowerBound(tails.starts, t + win);
    if (tTo > tFrom) {
      use('tails');
      const first = tails.count - tTo; // stored latest first
      this.vao(d, 'tails', () => { gl.bindBuffer(gl.ARRAY_BUFFER, tails.buf); this.attrib(pr, 'a_t', 4, 32, first * 32, 1); this.attrib(pr, 'a_col', 4, 32, first * 32 + 16, 1); });
      for (const [mult, waveMul, a, white, heldOnly, chev] of [[1.9, 1, 0.16, 0, 1, 0], [1, 1, -1, 0, 0, 0], [0.55, 1, 0.16, 1, 0, 0], [0.16, 0.5, 0.42, 1, 0, 0], [1.05, 1, 0.75, 0.75, 1, 1]]) {
        gl.uniform1f(pr.u.u_mult, mult); gl.uniform1f(pr.u.u_waveMul, waveMul); gl.uniform4f(pr.u.u_pass, a, white, heldOnly, chev);
        this.inst(gl.TRIANGLE_STRIP, 0, TAIL_VERTS, tTo - tFrom);
      }
    }

    // the notes, far ones first
    use('notes');
    gl.uniform1i(pr.u.u_tex, 0); gl.uniform1f(pr.u.u_atlas, ATLAS);
    gl.uniform1f(pr.u.u_pad, 0);
    gl.uniform1f(pr.u.u_solid, fx.solid && models ? 1 : 0);
    const notes = d.notes;
    const nFrom = lowerBound(notes.times, t - 0.12), nTo = lowerBound(notes.times, t + win);
    if (nTo > nFrom) {
      const first = notes.count - nTo;
      this.vao(d, 'notes', () => { gl.bindBuffer(gl.ARRAY_BUFFER, notes.buf); this.attrib(pr, 'a0', 4, 48, first * 48, 1); this.attrib(pr, 'a1', 4, 48, first * 48 + 16, 1); this.attrib(pr, 'a2', 4, 48, first * 48 + 32, 1); });
      this.inst(gl.TRIANGLE_STRIP, 0, 4, nTo - nFrom);
    }
    const drawn = Math.max(0, nTo - nFrom);
    if (fx.solid && models) { // the models of the notes, with the depth buffer (cleared inside this pane's scissor)
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      use('solid');
      gl.activeTexture(gl.TEXTURE1);
      gl.uniform1i(pr.u.u_mtex, 1); gl.uniform1i(pr.u.u_mshine, 2);
      for (const [kind, sol] of Object.entries(d.solid)) {
        const mesh = models[kind];
        if (!mesh) continue;
        const sFrom = lowerBound(sol.times, t - 0.12), sTo = lowerBound(sol.times, t + win);
        if (sTo <= sFrom) continue;
        const first = sol.count - sTo;
        gl.bindTexture(gl.TEXTURE_2D, mesh.tex);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mesh.shine); gl.activeTexture(gl.TEXTURE1);
        gl.uniform1f(pr.u.u_mcel, mesh.cel ? 1 : 0); gl.uniform1f(pr.u.u_mcym, mesh.cym && !mesh.cel ? 1 : 0); gl.uniform1f(pr.u.u_mmetal, fx.metal || 0); gl.uniform1f(pr.u.u_mglass, fx.glass || 0); gl.uniform1f(pr.u.u_mcymst, fx.cymbal || 0); gl.uniform1f(pr.u.u_mtoon, fx.shade === 'glossy' ? 2 : fx.shade === 'smooth' || fx.cel === false ? 0 : 1);
        gl.uniform2f(pr.u.u_mnoise, mesh.cym ? 0.62 : 1.0, 0.7); // (the middle's noise speed: the note 0.4, the cymbal 0.25, relative to the note; its minimum darkness)
        gl.uniform3f(pr.u.u_msz, mesh.msz[0], mesh.msz[1], mesh.msz[2]); gl.uniform1f(pr.u.u_mbase, mesh.base); gl.uniform1f(pr.u.u_malpha, mesh.alpha);
        this.vao(d, `solid_${kind}`, () => {
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
          this.attrib(pr, 'm_pos', 3, 36, 0, 0); this.attrib(pr, 'm_nrm', 3, 36, 12, 0); this.attrib(pr, 'm_uv', 2, 36, 24, 0); this.attrib(pr, 'm_role', 1, 36, 32, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, sol.buf);
          this.attrib(pr, 's0', 4, 32, first * 32, 1); this.attrib(pr, 's1', 4, 32, first * 32 + 16, 1);
        });
        this.inst(gl.TRIANGLES, 0, mesh.count, sTo - sFrom);
      }
      gl.disable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE0);
    }

    if (fx.solid && models && fx.glow > 0) { // the glow of the lit glass: a halo of the lane's colour round each note with a model, added
      gl.blendFunc(gl.ONE, gl.ONE);
      use('glow');
      gl.uniform1f(pr.u.u_gain, fx.glow);
      for (const [kind, sol] of Object.entries(d.solid)) {
        const mesh = models[kind];
        if (!mesh || kind[0] === 'c') continue; // (no glow on the cymbals)
        const sFrom = lowerBound(sol.times, t - 0.12), sTo = lowerBound(sol.times, t + win);
        if (sTo <= sFrom) continue;
        const first = sol.count - sTo;
        gl.uniform4f(pr.u.u_gsz, mesh.glow[0], mesh.glow[1], mesh.glow[2], 0);
        this.vao(d, `glow_${kind}`, () => { gl.bindBuffer(gl.ARRAY_BUFFER, sol.buf); this.attrib(pr, 's0', 4, 32, first * 32, 1); this.attrib(pr, 's1', 4, 32, first * 32 + 16, 1); });
        this.inst(gl.TRIANGLE_STRIP, 0, 4, sTo - sFrom);
      }
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    // the fill activation marks, over the heads (under the hit line bar, as in the 2D code)
    if (o.fillActivation && d.actB.count) {
      const aFrom = lowerBound(d.actB.times, t - 0.12), aTo = lowerBound(d.actB.times, t + win);
      if (aTo > aFrom) {
        use('marks');
        this.vao(d, 'actB', () => { gl.bindBuffer(gl.ARRAY_BUFFER, d.actB.buf); this.attrib(pr, 'a0', 4, 16, aFrom * 16, 1); });
        this.inst(gl.TRIANGLE_STRIP, 0, 4, aTo - aFrom);
      }
    }

    // the hit line bar over the notes and tails: a segment per lane (whiter while it is hit) and a border at each end (the open note / pedal colour when the chart has them)
    if (o.hitLine) {
      use('hitbar');
      gl.uniform1fv(pr.u.u_flash, d.flash);
      gl.uniform3fv(pr.u.u_lc, d.lc);
      const edge = d.drums ? (chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick) : d.hasOpen ? NOTE_PALETTE.open : null;
      const e = edge ? rgba(withAlpha(edge, 0.8)) : rgba(HIT_LINE_BORDER_SOFT);
      gl.uniform4f(pr.u.u_edge, e[0], e[1], e[2], e[3]);
      if (!d.hitIdx) { d.hitIdx = this.buffer(f32([...Array(lanes).keys(), -1, -2])); }
      this.vao(d, 'hitbar', () => { gl.bindBuffer(gl.ARRAY_BUFFER, d.hitIdx); this.attrib(pr, 'a_i', 1, 4, 0, 1); });
      this.inst(gl.TRIANGLE_STRIP, 0, 4, lanes + 2);
    }

    // the hit bursts and the held glow, added over everything (three quads per instance: the looping bursts of a held note), then the bar bursts
    gl.blendFunc(gl.ONE, gl.ONE);
    use('burst');
    const burst = (list, from, to, vaoName) => {
      if (to <= from) return;
      this.vao(d, vaoName, () => { gl.bindBuffer(gl.ARRAY_BUFFER, list.buf); this.attrib(pr, 'b0', 4, 32, from * 32, 3); this.attrib(pr, 'b1', 4, 32, from * 32 + 16, 3); });
      this.inst(gl.TRIANGLE_STRIP, 0, 4, 3 * (to - from));
    };
    burst(d.hitB, lowerBound(d.hitB.times, t - 0.45), lowerBound(d.hitB.times, t + 1e-6), 'hitB');
    burst(d.heldB, lowerBound(d.heldB.times, t - d.heldB.maxLen), lowerBound(d.heldB.times, t + 1e-6), 'heldB');
    const kFrom = lowerBound(d.barB.times, t - 0.26), kTo = lowerBound(d.barB.times, t + 1e-6);
    if (kTo > kFrom) {
      use('barburst');
      this.vao(d, 'barB', () => { gl.bindBuffer(gl.ARRAY_BUFFER, d.barB.buf); this.attrib(pr, 'b0', 4, 32, kFrom * 32, 1); this.attrib(pr, 'b1', 4, 32, kFrom * 32 + 16, 1); });
      this.inst(gl.TRIANGLE_STRIP, 0, 4, kTo - kFrom);
    }
    if (fx.particles) {
      use('sparks');
      const sparks = (list, from, to, vaoName, span) => {
        if (to <= from) return;
        gl.uniform1f(pr.u.u_spread, span);
        this.vao(d, vaoName, () => { gl.bindBuffer(gl.ARRAY_BUFFER, list.buf); this.attrib(pr, 'b0', 4, 32, from * 32, 24); this.attrib(pr, 'b1', 4, 32, from * 32 + 16, 24); });
        this.inst(gl.TRIANGLE_STRIP, 0, 4, 24 * (to - from));
      };
      sparks(d.hitB, lowerBound(d.hitB.times, t - 1.1), lowerBound(d.hitB.times, t + 1e-6), 'hitS', 0);
      sparks(d.heldB, lowerBound(d.heldB.times, t - d.heldB.maxLen - 1.1), lowerBound(d.heldB.times, t + 1e-6), 'heldS', 0);
      sparks(d.barB, lowerBound(d.barB.times, t - 1.1), lowerBound(d.barB.times, t + 1e-6), 'barS', 1);
    }
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawn += drawn;
    return drawn;
  }

  dispose() {
    this.dropAll();
    const gl = this.gl;
    for (const r of this.roads.values()) { gl.deleteBuffer(r.road.buf); gl.deleteBuffer(r.base.buf); }
    this.roads.clear();
    for (const p of Object.values(this.progs)) gl.deleteProgram(p.p);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// ---- the sprites (the app's own drawing, once per kind) ---------------------------------------------------------------------------------------------------------------

// The sizes the app's 3D view gives these notes: RECT_SCALE 1.15, the plain note 1.1 taller, the HOPO 0.8 smaller, narrower and taller, the tap likewise.
function drawNoteSprite(c, cx, cy, kind, color, sp, noteBase = 1) {
  const colors = [color];
  const n = { lane: 0, hopo: kind === 'h', tap: kind === 't', accent: kind === 'a', ghost: kind === 'g', sp: !!sp };
  const r = REF_RX * (n.hopo ? 0.8 : 1);
  const fw = 1.15 * (n.hopo || n.tap ? 0.85 : 1) * (n.tap ? 0.8 : 1);
  const fh = 1.15 * (n.hopo || n.tap ? 1.2 : 1.1) * (n.tap ? 0.8 : 1);
  drawYNote(c, cx, cy, r * NOTE_RECT_W * fw, r * 0.55 * NOTE_RECT_H * fh, n, color, noteColor(n, colors), 0, YNOTE_SIDE_3D * noteBase, false);
}
function drawCymbalSprite(c, cx, cy, kind, color, sp) { // a flat disc with a base under it, and the dome (drawCymbalFace picks the flat design for a flattened disc)
  const rx = REF_RX, ry = rx * 0.55;
  c.fillStyle = sp ? '#cfae45' : '#bdbdbd';
  c.beginPath();
  c.ellipse(cx, cy + rx * 0.19, rx * 1.045, ry, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  drawCymbalFace(c, cx, cy, rx, ry, { accent: kind === 'ca', ghost: kind === 'cg', sp: !!sp }, color);
}
function drawBarSprite(c, cx, cy, color) { // an open note or a kick: its colour (the bar itself is drawn by the notes shader)
  c.fillStyle = color;
  c.fillRect(cx - 20, cy - 20, 40, 40);
}
function drawRingSprite(c, cx, cy, color) { // the hit pad: a ring of the lane's colour
  c.beginPath();
  c.roundRect(cx - 62, cy - 22, 124, 44, 10);
  c.fillStyle = `${color}33`;
  c.fill();
  c.lineWidth = 5;
  c.strokeStyle = color;
  c.stroke();
}
