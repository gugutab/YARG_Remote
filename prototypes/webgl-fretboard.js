// Prototype: the note highway (the 3D view with rectangular notes) drawn with WebGL 2 instead of the canvas 2D context.
//
//   python -m http.server 8130      (from the repository root), or the app's own server (npm start), which serves this folder too and adds a song picker
//   http://localhost:8130/prototypes/webgl-fretboard.html                      pick a notes.mid, or ?synth=60 for 60 synthetic notes a second
//   ...webgl-fretboard.html?midi=../path/notes.mid&parts=guitar,bass,drums-pro&diff=3&at=61&paused=1     panes side by side, a still picture at 61 s
//   ...&bench=6      a measured run of 6 s (window.__bench: fps, JS ms per frame, notes in view)
//
// What it reuses from the app: parseMidi / buildChart (the chart), projection3D (the same perspective: scale 1 / (1 + k d), y = vy + (hit - vy) scale), and the
// note drawing itself: drawYNote (the rectangular note) and drawCymbalFace (the flat cymbal) draw each kind of note ONCE into a texture atlas. What is new: the
// notes, sustains, bands, beat lines and the road are instances / triangles whose screen positions are computed in the vertex shader from the song time, so a
// pane costs a handful of draw calls and a few uniforms on the CPU, whatever the number of notes: the whole chart is uploaded once.
//
// Panes: one per instrument, side by side, each in its own viewport (like the app's stage). Drums: pads, cymbals, the kick as a bar, accent and ghost notes.
// Bands: star power and solo. Feedback: a pad lights up while a note is being hit or held.
//
// Simplifications against the app (it is a prototype of the drawing, not a replacement): no audio, no hit burst, no rolls and fills, no BRE, no flow / wave
// sustains, no per-note taper (the sprites are scaled uniformly with depth, as the app's 3D sprite cache does), no curved road, no 2D view, no vocals.
import { parseMidi } from '../src/midi.js';
import { buildChart, instrumentOptions, DIFFICULTIES } from '../src/chart.js';
import { projection3D } from '../src/highway3d.js';
import { drawYNote, drawCymbalFace, YNOTE_SIDE_3D, NOTE_RECT_W, NOTE_RECT_H, NOTE_PALETTE, noteColor, HIT_Y } from '../src/gfx.js';

const DEPTH_SEC = 3.2; // seconds between the hit line and the far edge at neck speed 1 (the app's DEPTH_SEC)
const HEAD_R = 0.36; // note head radius in lane widths (the app's HEAD_R)
const REF_RX = 60; // the head radius, in px, the atlas sprites are drawn with
const CELL_W = 176, CELL_H = 112, ATLAS = 2048, COLS = Math.floor(ATLAS / CELL_W), ROWS = Math.floor(ATLAS / CELL_H);
const FLASH_SEC = 0.16; // how long a pad stays lit after a hit
const BAND_W = 1 / (2 * HEAD_R * 0.38); // the sustain shader's width factor that spans one lane width on each side (times the lane count)
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// ---- charts ---------------------------------------------------------------------------------------------------------------------------------------------------

// A synthetic chart: `perSec` notes a second over 5 lanes with HOPOs, taps, open notes and sustains, 120 s long (for scaling tests).
function syntheticChart(perSec, seed0 = 0) {
  let seed = 12345 + seed0 * 977;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const notes = [];
  const dur = 120;
  const step = 1 / Math.max(1, perSec);
  for (let t = 2; t < dur; t += step) {
    const sustain = rnd() < 0.08 ? 0.3 + rnd() * 1.2 : 0;
    notes.push({ time: t, end: t + sustain, length: sustain, lane: Math.floor(rnd() * 5), hopo: rnd() < 0.2, tap: rnd() < 0.05, open: rnd() < 0.02 });
  }
  const beats = [];
  for (let i = 0, t = 0; t < dur; i++, t += 0.5) beats.push({ time: t, measure: i % 4 === 0, strong: i % 2 === 0 });
  return { notes, beats, lanes: 5, laneColors: NOTE_PALETTE.lanes, starPower: [{ start: 20, end: 24 }, { start: 50, end: 53 }], solos: [{ start: 70, end: 80 }], duration: dur };
}

let midi = null;
let panes = [];
let duration = 1;
const partIds = () => ($('parts').value || 'guitar').split(',').map((s) => s.trim()).filter(Boolean);
function chartsToShow() {
  const synth = Number($('synth').value);
  const ids = partIds();
  if (synth > 0 || !midi) return ids.map((id, i) => ({ label: `${id} (synthetic)`, chart: syntheticChart(synth > 0 ? synth : 8, i) }));
  const opts = instrumentOptions(midi);
  const diff = DIFFICULTIES[Number($('diff').value)] || DIFFICULTIES[3];
  const out = [];
  for (const id of ids) {
    const ins = opts.find((o) => o.id === id);
    const chart = ins ? buildChart(midi, ins, diff, {}) : null;
    if (chart && chart.mode !== 'vocals') out.push({ label: id, chart });
  }
  return out.length ? out : [{ label: 'synthetic', chart: syntheticChart(8) }];
}

// ---- the atlas: every kind of note drawn once by the app's own functions, on demand ------------------------------------------------------------------------------

const atlas = { canvas: document.createElement('canvas'), cells: new Map(), next: 0, dirty: false };
atlas.canvas.width = atlas.canvas.height = ATLAS;
const actx = atlas.canvas.getContext('2d');
// The sizes the app's 3D view gives these notes: RECT_SCALE 1.15, the plain note 1.1 taller, the HOPO 0.8 smaller, narrower and taller, the tap likewise.
function drawNoteSprite(c, cx, cy, kind, color, sp) {
  const colors = [color];
  const n = { lane: 0, hopo: kind === 'h', tap: kind === 't', accent: kind === 'a', ghost: kind === 'g', sp: !!sp };
  const r = REF_RX * (n.hopo ? 0.8 : 1);
  const fw = 1.15 * (n.hopo || n.tap ? 0.85 : 1) * (n.tap ? 0.8 : 1);
  const fh = 1.15 * (n.hopo || n.tap ? 1.2 : 1.1) * (n.tap ? 0.8 : 1);
  drawYNote(c, cx, cy, r * NOTE_RECT_W * fw, r * 0.55 * NOTE_RECT_H * fh, n, color, noteColor(n, colors), 0, YNOTE_SIDE_3D, false);
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
function drawBarSprite(c, cx, cy, color) { // an open note or a kick: a bar across the road
  const gr = c.createLinearGradient(0, cy - 14, 0, cy + 14);
  gr.addColorStop(0, '#ffffffaa');
  gr.addColorStop(0.35, color);
  gr.addColorStop(1, `${color}99`);
  c.fillStyle = gr;
  c.beginPath();
  c.roundRect(cx - 84, cy - 14, 168, 28, 8);
  c.fill();
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
// The uv rectangle of a sprite: [kind, colour, star power]; drawn into the next free cell the first time.
function cellFor(kind, color, sp) {
  const key = `${kind}|${color}|${sp ? 1 : 0}`;
  let uv = atlas.cells.get(key);
  if (uv) return uv;
  if (atlas.next >= COLS * ROWS) throw new Error('atlas full');
  const x = (atlas.next % COLS) * CELL_W, y = Math.floor(atlas.next / COLS) * CELL_H;
  atlas.next++;
  actx.save();
  actx.beginPath();
  actx.rect(x, y, CELL_W, CELL_H);
  actx.clip();
  const cx = x + CELL_W / 2, cy = y + CELL_H / 2;
  if (kind === 'bar') drawBarSprite(actx, cx, cy, color);
  else if (kind === 'ring') drawRingSprite(actx, cx, cy, color);
  else if (kind[0] === 'c') drawCymbalSprite(actx, cx, cy, kind, color, sp);
  else drawNoteSprite(actx, cx, cy, kind, color, sp);
  actx.restore();
  uv = [x / ATLAS, y / ATLAS, (x + CELL_W) / ATLAS, (y + CELL_H) / ATLAS];
  atlas.cells.set(key, uv);
  atlas.dirty = true;
  return uv;
}

// ---- GL helpers -----------------------------------------------------------------------------------------------------------------------------------------------

const canvas = $('gl');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
if (!gl) { $('hud').textContent = 'WebGL 2 is not available in this browser.'; throw new Error('no WebGL 2'); }
const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

const COMMON = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_hit, u_vy, u_k, u_c, u_cx, u_laneW, u_half, u_t, u_win;
float scaleAt(float d) { return 1.0 / (1.0 + u_k * d); }
vec2 project(float lx, float d) { float p = scaleAt(d); return vec2(u_cx + lx * u_laneW * p, u_vy + (u_hit - u_vy) * p + (d > 0.0 ? u_c * d * d : 0.0)); }
vec4 clipPos(vec2 px) { return vec4(px.x / u_res.x * 2.0 - 1.0, 1.0 - px.y / u_res.y * 2.0, 0.0, 1.0); }
`;
const FS_COLOR = `#version 300 es
precision mediump float; in vec4 v_col; out vec4 o; void main() { o = vec4(v_col.rgb * v_col.a, v_col.a); }`;

const PROGRAMS = {
  // the road, lane lines and rails: triangles in (lane x, depth) space
  flat: [`${COMMON}in vec2 a_pos; in vec4 a_col; out vec4 v_col;
void main() { gl_Position = clipPos(project(a_pos.x, a_pos.y)); v_col = vec4(a_col.rgb, a_col.a * (1.0 - smoothstep(0.5, 1.0, a_pos.y))); }`, FS_COLOR],
  // beat and measure lines: one instance each (time, kind)
  beats: [`${COMMON}in vec2 a_b; out vec4 v_col;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float d = clamp((a_b.x - u_t) / u_win, 0.0, 1.0); float p = scaleAt(d);
  float th = (a_b.y > 1.5 ? 3.0 : a_b.y > 0.5 ? 2.0 : 1.0) * p * u_laneW / 90.0;
  vec2 l = project(-u_half, d), r = project(u_half, d);
  gl_Position = a_b.x < u_t ? vec4(2.0, 2.0, 2.0, 1.0) : clipPos(vec2(mix(l.x, r.x, c.x), l.y + (c.y - 0.5) * th));
  v_col = vec4(1.0, 1.0, 1.0, (a_b.y > 1.5 ? 0.5 : a_b.y > 0.5 ? 0.3 : 0.15) * (1.0 - smoothstep(0.5, 1.0, d)));
}`, FS_COLOR],
  // sustains and bands: a trapezoid from the head to the end, one instance each (t0, t1, lane, width) + colour
  tails: [`${COMMON}in vec4 a_t; in vec4 a_col; out vec4 v_col;
void main() {
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0; float far = float((gl_VertexID >> 1) & 1);
  float tt = max(far > 0.5 ? a_t.y : a_t.x, u_t); float d = clamp((tt - u_t) / u_win, 0.0, 1.2); float p = scaleAt(d);
  vec2 c = project(a_t.z + 0.5 - u_half, d); float w = u_laneW * ${HEAD_R.toFixed(3)} * 0.38 * a_t.w * p;
  gl_Position = clipPos(vec2(c.x + side * w, c.y));
  v_col = vec4(a_col.rgb, a_col.a * step(u_t, a_t.y) * (1.0 - smoothstep(0.5, 1.0, d)));
}`, FS_COLOR],
  // notes and pads: sprites from the atlas, one instance each (time, lane, uv rect, size factors); a pad is lit by its lane's flash
  notes: [`${COMMON}in vec4 a0; in vec4 a1; uniform float u_pad; uniform float u_atlas; uniform float u_flash[8]; out vec2 v_uv; out float v_a; out float v_boost;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float dr = (a0.x - u_t) / u_win; float d = u_pad > 0.5 ? 0.0 : clamp(dr, 0.0, 1.0);
  vec2 centre = project(a0.y + 0.5 - u_half, d);
  vec2 size = (a1.xy - a0.zw) * u_atlas * (u_laneW * ${HEAD_R.toFixed(3)} * scaleAt(d) / ${REF_RX.toFixed(1)}) * a1.zw;
  gl_Position = (u_pad < 0.5 && dr < -0.04) ? vec4(2.0, 2.0, 2.0, 1.0) : clipPos(centre + (c - 0.5) * size);
  v_uv = mix(a0.zw, a1.xy, c); v_a = u_pad > 0.5 ? 1.0 : clamp((1.0 - d) / 0.12, 0.0, 1.0);
  v_boost = u_pad > 0.5 ? u_flash[int(clamp(a0.y, 0.0, 7.0))] : 0.0;
}`, `#version 300 es
precision mediump float; uniform sampler2D u_tex; in vec2 v_uv; in float v_a; in float v_boost; out vec4 o;
void main() { vec4 c = texture(u_tex, v_uv) * v_a; c.rgb = min(c.rgb * (1.0 + v_boost * 1.4) + c.a * v_boost * 0.35, vec3(c.a)); o = c; }`],
};
const progs = {};
function compile(name) {
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
for (const name of Object.keys(PROGRAMS)) progs[name] = compile(name);

function setShared(pr, t, v) {
  const u = pr.u;
  if (u.u_res) gl.uniform2f(u.u_res, v.res[0], v.res[1]);
  const vals = { u_hit: v.hit, u_vy: v.vy, u_k: v.k, u_c: v.c, u_cx: v.cx, u_laneW: v.laneW, u_half: v.half, u_t: t, u_win: v.win };
  for (const n in vals) if (u[n]) gl.uniform1f(u[n], vals[n]);
}

// ---- a pane: one instrument's buffers ---------------------------------------------------------------------------------------------------------------------

const f32 = (arr) => Float32Array.from(arr);
function buffer(data) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }
const lowerBound = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; };

function roadGeometry(lanes) { // [lane x, depth, r, g, b, a] per vertex, as triangles
  const half = lanes / 2, v = [];
  const quad = (x0, x1, d0, d1, c) => { for (const [x, d] of [[x0, d0], [x1, d0], [x0, d1], [x1, d0], [x1, d1], [x0, d1]]) v.push(x, d, ...c); };
  const S = 24;
  for (let i = 0; i < S; i++) {
    const d0 = (i / S) * 1.05, d1 = ((i + 1) / S) * 1.05;
    quad(-half, half, d0, d1, [1, 1, 1, 0.045]);
    for (let l = 0; l < lanes; l += 2) quad(l - half, l + 1 - half, d0, d1, [1, 1, 1, 0.025]); // the lane stripes
    for (let l = 1; l < lanes; l++) quad(l - half - 0.012, l - half + 0.012, d0, d1, [1, 1, 1, 0.1]); // the dividers
    quad(-half - 0.03, -half + 0.03, d0, d1, [1, 1, 1, 0.4]); // the rails
    quad(half - 0.03, half + 0.03, d0, d1, [1, 1, 1, 0.4]);
  }
  quad(-half, half, -0.012, 0.012, [1, 1, 1, 0.45]); // the hit line
  return f32(v);
}

function makePane(label, chart) {
  const lanes = chart.lanes || 5;
  const colors = chart.laneColors || NOTE_PALETTE.lanes;
  const drums = !!chart.drumKind;
  const barColor = drums ? (chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick) : NOTE_PALETTE.open;
  const spans = [...(chart.starPower || [])].sort((a, b) => a.start - b.start);
  let si = 0;
  const src = [...chart.notes].sort((a, b) => a.time - b.time);
  for (const n of src) { // star power: the notes inside a phrase (the app flags them the same way)
    while (si < spans.length && spans[si].end <= n.time) si++;
    n.sp = si < spans.length && n.time >= spans[si].start;
  }
  const laneColor = (l) => colors[Math.min(Math.max(l, 0), colors.length - 1)];
  const inst = new Float32Array(src.length * 8); // time, lane, u0, v0 | u1, v1, sx, sy   (stored latest first: far notes are drawn before near ones)
  const times = new Float32Array(src.length);
  const lanesOf = new Float32Array(src.length);
  const tails = [];
  src.forEach((n, i) => {
    const o = (src.length - 1 - i) * 8;
    const bar = n.open || n.lane < 0;
    let uv;
    if (bar) uv = cellFor('bar', barColor, false);
    else if (drums) uv = cellFor(n.cymbal ? (n.accent ? 'ca' : n.ghost ? 'cg' : 'c') : n.accent ? 'a' : n.ghost ? 'g' : 'n', laneColor(n.lane), n.sp);
    else uv = cellFor(n.tap ? 't' : n.hopo ? 'h' : 'n', laneColor(n.lane), n.sp);
    times[i] = n.time;
    lanesOf[i] = bar ? -1 : n.lane;
    inst.set([n.time, bar ? lanes / 2 - 0.5 : n.lane, uv[0], uv[1], uv[2], uv[3], bar ? (lanes * REF_RX) / (HEAD_R * CELL_W * 0.955) : 1, 1], o); // (a bar is as wide as the road: its sprite is 0.955 of the cell)
    if (!bar && n.length > 0.09) tails.push({ t0: n.time, t1: n.time + n.length, lane: n.lane });
  });
  tails.sort((a, b) => a.t0 - b.t0);
  const tailData = new Float32Array(tails.length * 8);
  tails.forEach((t, i) => tailData.set([t.t0, t.t1, t.lane, 1, ...hexRgb(laneColor(t.lane)), 0.62], (tails.length - 1 - i) * 8));
  let maxLen = 0;
  for (const t of tails) maxLen = Math.max(maxLen, t.t1 - t.t0);
  const bandData = (list, rgb, a) => { const s = [...list].sort((x, y) => x.start - y.start); const d = new Float32Array(s.length * 8); s.forEach((b, i) => d.set([b.start, b.end, lanes / 2 - 0.5, lanes * BAND_W, ...rgb, a], i * 8)); return { buf: buffer(d), count: s.length, starts: Float32Array.from(s, (b) => b.start), ends: Float32Array.from(s, (b) => b.end) }; };
  const beats = (chart.beats || []).map((b) => [b.time, b.measure ? 2 : b.strong ? 1 : 0]).flat();
  const pads = [];
  for (let l = 0; l < lanes; l++) { const c = cellFor('ring', laneColor(l), false); pads.push(0, l, c[0], c[1], c[2], c[3], 1, 1); }
  const road = roadGeometry(lanes);
  return {
    label, chart, lanes,
    notes: { buf: buffer(inst), count: src.length, times, lanes: lanesOf },
    tails: { buf: buffer(tailData), count: tails.length, starts: Float32Array.from(tails, (t) => t.t0), ends: Float32Array.from(tails, (t) => t.t1), lane: Float32Array.from(tails, (t) => t.lane), maxLen },
    sp: bandData(chart.starPower || [], [1, 0.69, 0], 0.17),
    solo: bandData(chart.solos || [], [0, 0.59, 0.86], 0.15),
    beats: { buf: buffer(f32(beats)), times: Float32Array.from(chart.beats || [], (b) => b.time) },
    pads: { buf: buffer(f32(pads)), count: lanes },
    road: { buf: buffer(road), count: road.length / 6 },
    vaos: {}, view: null, flash: new Float32Array(8), drawn: 0,
  };
}
function disposePane(p) {
  for (const k of ['notes', 'tails', 'sp', 'solo', 'beats', 'pads', 'road']) gl.deleteBuffer(p[k].buf);
  for (const v of Object.values(p.vaos)) gl.deleteVertexArray(v);
}

// A VAO per kind of draw (per pane), its instance attributes re-pointed each frame at the first visible instance (a byte offset into the one big buffer).
function vao(p, name, setup) {
  if (!p.vaos[name]) p.vaos[name] = gl.createVertexArray();
  gl.bindVertexArray(p.vaos[name]);
  setup();
}
const attrib = (pr, name, size, stride, offset, divisor) => {
  const l = pr.a(name);
  if (l < 0) return;
  gl.enableVertexAttribArray(l);
  gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, offset);
  gl.vertexAttribDivisor(l, divisor);
};

// ---- the texture ------------------------------------------------------------------------------------------------------------------------------------------------

let tex = null;
function uploadAtlas() {
  if (!atlas.dirty && tex) return;
  if (!tex) tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  atlas.dirty = false;
}

// ---- layout and the frame ---------------------------------------------------------------------------------------------------------------------------------------

function paneView(p, w, h) {
  const portrait = h > w;
  const roadW = portrait ? w * 0.9 : Math.min(h * 1.2, h * 0.9 + (w - h) * 0.3); // the app's road width
  const hit = h * Math.min(HIT_Y, 0.93);
  const pr = projection3D(h, hit, Number($('persp').value), 0);
  return { res: [w, h], hit, vy: pr.vy, k: pr.k, c: pr.c, cx: w / 2, laneW: roadW / p.lanes, half: p.lanes / 2, win: DEPTH_SEC / Number($('neck').value) };
}

// Which pads are lit: a note hit in the last FLASH_SEC, or a sustain being held.
function updateFlash(p, t) {
  const f = p.flash;
  f.fill(0);
  const n = p.notes;
  for (let i = lowerBound(n.times, t - FLASH_SEC); i < n.count && n.times[i] <= t; i++) {
    const l = n.lanes[i];
    const age = (t - n.times[i]) / FLASH_SEC;
    if (l >= 0 && l < 8) f[l] = Math.max(f[l], 1 - age);
    else if (l < 0) for (let k = 0; k < p.lanes && k < 8; k++) f[k] = Math.max(f[k], (1 - age) * 0.6); // a kick or an open note lights the whole zone
  }
  const tl = p.tails;
  for (let i = lowerBound(tl.starts, t - tl.maxLen); i < tl.count && tl.starts[i] <= t; i++) if (tl.ends[i] >= t && tl.lane[i] < 8) f[tl.lane[i]] = 1;
}

function drawPane(p, t, x0, w, h) {
  gl.viewport(x0, 0, w, h);
  gl.scissor(x0, 0, w, h);
  const v = (p.view = paneView(p, w, h));
  const win = v.win;
  updateFlash(p, t);

  let pr = progs.flat;
  gl.useProgram(pr.p); setShared(pr, t, v);
  vao(p, 'road', () => { gl.bindBuffer(gl.ARRAY_BUFFER, p.road.buf); attrib(pr, 'a_pos', 2, 24, 0, 0); attrib(pr, 'a_col', 4, 24, 8, 0); });
  gl.drawArrays(gl.TRIANGLES, 0, p.road.count);

  // the star power and solo bands (the spans do not overlap: the ones in view are a contiguous run)
  pr = progs.tails;
  gl.useProgram(pr.p); setShared(pr, t, v);
  for (const band of [p.sp, p.solo]) {
    const from = lowerBound(band.ends, t), to = lowerBound(band.starts, t + win + 1e-6);
    if (to <= from) continue;
    vao(p, band === p.sp ? 'sp' : 'solo', () => { gl.bindBuffer(gl.ARRAY_BUFFER, band.buf); attrib(pr, 'a_t', 4, 32, from * 32, 1); attrib(pr, 'a_col', 4, 32, from * 32 + 16, 1); });
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, to - from);
  }

  // the beat lines in the window
  pr = progs.beats;
  const bFrom = lowerBound(p.beats.times, t), bTo = lowerBound(p.beats.times, t + win);
  gl.useProgram(pr.p); setShared(pr, t, v);
  vao(p, 'beats', () => { gl.bindBuffer(gl.ARRAY_BUFFER, p.beats.buf); attrib(pr, 'a_b', 2, 8, bFrom * 8, 1); });
  if (bTo > bFrom) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, bTo - bFrom);

  // the sustains: starts in [t - the longest sustain, t + window]
  pr = progs.tails;
  const tFrom = lowerBound(p.tails.starts, t - p.tails.maxLen), tTo = lowerBound(p.tails.starts, t + win);
  if (tTo > tFrom) {
    gl.useProgram(pr.p); setShared(pr, t, v);
    const first = p.tails.count - tTo; // stored latest first
    vao(p, 'tails', () => { gl.bindBuffer(gl.ARRAY_BUFFER, p.tails.buf); attrib(pr, 'a_t', 4, 32, first * 32, 1); attrib(pr, 'a_col', 4, 32, first * 32 + 16, 1); });
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, tTo - tFrom);
  }

  // the pads, then the notes
  pr = progs.notes;
  gl.useProgram(pr.p); setShared(pr, t, v);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(pr.u.u_tex, 0); gl.uniform1f(pr.u.u_atlas, ATLAS);
  gl.uniform1fv(pr.u.u_flash, p.flash);
  gl.uniform1f(pr.u.u_pad, 1);
  vao(p, 'pads', () => { gl.bindBuffer(gl.ARRAY_BUFFER, p.pads.buf); attrib(pr, 'a0', 4, 32, 0, 1); attrib(pr, 'a1', 4, 32, 16, 1); });
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, p.pads.count);
  gl.uniform1f(pr.u.u_pad, 0);
  const nn = p.notes.count;
  const nFrom = lowerBound(p.notes.times, t - 0.12), nTo = lowerBound(p.notes.times, t + win);
  if (nTo > nFrom) {
    const first = nn - nTo;
    vao(p, 'notes', () => { gl.bindBuffer(gl.ARRAY_BUFFER, p.notes.buf); attrib(pr, 'a0', 4, 32, first * 32, 1); attrib(pr, 'a1', 4, 32, first * 32 + 16, 1); });
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nTo - nFrom);
  }
  p.drawn = Math.max(0, nTo - nFrom);
}

function render(t) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(2, Math.round(canvas.clientWidth * dpr)), H = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  uploadAtlas();
  gl.viewport(0, 0, W, H);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0.043, 0.055, 0.086, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const P = panes.length, pw = Math.floor(W / P);
  panes.forEach((p, i) => drawPane(p, t, i * pw, i === P - 1 ? W - i * pw : pw, H));
}

// ---- the loop, the clock and the HUD -----------------------------------------------------------------------------------------------------------------------------

let playing = !params.get('paused'), songTime = 0, last = performance.now(); // (?paused=1 starts stopped, for a still picture)
const stats = { frames: [], js: [], gpu: [], notes: [] };
let gpuQuery = null;
const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const p95 = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.95)] : 0);
const benchSecs = Number(params.get('bench') || 0);
const benchAll = [];
let benchStart = 0, benchDone = false;
const inView = () => panes.reduce((s, p) => s + (p.drawn || 0), 0);

function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (playing) songTime += dt;
  if (songTime > duration + 1) songTime = 0;
  if (!$('seek').matches(':active')) $('seek').value = songTime;
  $('clock').textContent = `${Math.floor(songTime / 60)}:${String(Math.floor(songTime % 60)).padStart(2, '0')}`;

  const a = performance.now();
  if (timerExt && !gpuQuery) { gpuQuery = gl.createQuery(); gl.beginQuery(timerExt.TIME_ELAPSED_EXT, gpuQuery); }
  render(songTime);
  const b = performance.now();
  if (timerExt && gpuQuery) {
    gl.endQuery(timerExt.TIME_ELAPSED_EXT);
    const q = gpuQuery; gpuQuery = null;
    const poll = () => {
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(timerExt.GPU_DISJOINT_EXT)) { stats.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); if (stats.gpu.length > 300) stats.gpu.shift(); gl.deleteQuery(q); }
      else if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gl.deleteQuery(q); else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }
  stats.frames.push(dt * 1000); stats.js.push(b - a); stats.notes.push(inView());
  for (const k of ['frames', 'js', 'notes']) if (stats[k].length > 300) stats[k].shift();

  if (benchSecs && !benchDone) {
    if (!benchStart) benchStart = now;
    benchAll.push([dt * 1000, b - a, inView()]);
    if (now - benchStart > benchSecs * 1000) {
      benchDone = true;
      const body = benchAll.slice(5), d = body.map((x) => x[0]), j = body.map((x) => x[1]), n = body.map((x) => x[2]);
      window.__bench = JSON.stringify({ renderer: 'webgl', panes: panes.length, fps: +(1000 / avg(d)).toFixed(1), fps1pctLow: +(1000 / avg([...d].sort((x, y) => x - y).slice(Math.floor(d.length * 0.99)))).toFixed(1), over20ms: d.filter((x) => x > 20).length, jsMeanMs: +avg(j).toFixed(3), jsP95Ms: +p95(j).toFixed(3), notesInView: Math.round(avg(n)), totalNotes: panes.reduce((s, p) => s + p.notes.count, 0), viewport: `${canvas.width}x${canvas.height}` });
    }
  }
  requestAnimationFrame(frame);
}

setInterval(() => {
  const fps = 1000 / (avg(stats.frames) || 1);
  $('hud').innerHTML = `<b>WebGL 2</b> &nbsp; ${panes.map((p) => `${p.label} ${p.notes.count}`).join(' | ') || '…'} notes<br>` +
    `fps <b>${fps.toFixed(0)}</b> &nbsp; JS per frame <b>${avg(stats.js).toFixed(3)} ms</b> (p95 ${p95(stats.js).toFixed(3)}) &nbsp; ${panes.length} pane${panes.length === 1 ? '' : 's'}<br>` +
    `GPU per frame <b>${stats.gpu.length ? avg(stats.gpu).toFixed(3) + ' ms' : 'n/a'}</b><br>` +
    `notes in view <b>${Math.round(avg(stats.notes))}</b> &nbsp; draw calls <b>${panes.length * 7}</b>`;
}, 250);

// ---- controls ---------------------------------------------------------------------------------------------------------------------------------------------------

function fillSelectors() {
  $('diff').innerHTML = DIFFICULTIES.map((d, i) => `<option value="${i}">${d.label || d.id}</option>`).join('');
  $('diff').value = params.get('diff') ?? '3';
  const opts = midi ? instrumentOptions(midi).filter((o) => o.id !== 'vocals') : [];
  $('partsList').innerHTML = opts.map((o) => `<option value="${o.id}">${o.label || o.id}</option>`).join('');
}
function reload() {
  for (const p of panes) disposePane(p);
  panes = chartsToShow().map(({ label, chart }) => makePane(label, chart));
  duration = Math.max(1, ...panes.map((p) => p.chart.duration || 0));
  $('seek').max = duration;
  songTime = Math.min(songTime, duration);
}
async function useMidi(buf) {
  midi = parseMidi(new Uint8Array(buf));
  $('synth').value = 0;
  fillSelectors();
  const ids = instrumentOptions(midi).map((o) => o.id);
  if (!partIds().every((id) => ids.includes(id))) $('parts').value = ids.includes('guitar') ? 'guitar' : ids[0];
  reload();
}
$('file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) await useMidi(await f.arrayBuffer()); });
for (const id of ['parts', 'diff', 'synth']) $(id).addEventListener('change', reload);
$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; });
$('seek').addEventListener('input', () => { songTime = Number($('seek').value); });
// Served by the app's own server (npm start): its library fills a song list, and a song's notes.mid is fetched from /songs/<folder>/notes.mid.
async function loadSongList() {
  try {
    const lib = await (await fetch('/api/library')).json();
    const songs = (lib.songs || []).filter((s) => s.folder).sort((a, b) => `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`));
    if (!songs.length) return;
    $('song').innerHTML = '<option value="">(pick a song)</option>' + songs.map((s) => `<option value="${encodeURIComponent(s.folder).replace(/%2F/g, '/')}">${(s.artist || '?').replace(/</g, '&lt;')} - ${(s.title || s.folder).replace(/</g, '&lt;')}</option>`).join('');
    $('songLabel').hidden = false;
  } catch { /* not served by the app's server: only the file input and the synthetic notes */ }
}
$('song').addEventListener('change', async () => {
  if (!$('song').value) return;
  try {
    const res = await fetch(`/songs/${$('song').value}/notes.mid`);
    if (!res.ok) throw new Error(`${res.status}`);
    $('msg').textContent = '';
    await useMidi(await res.arrayBuffer());
    songTime = 0;
  } catch (e) { $('msg').textContent = `This song has no notes.mid (${e.message}); .chart and .sng songs are not read by the prototype.`; }
});
loadSongList();

(async () => {
  if (params.get('parts')) $('parts').value = params.get('parts');
  else if (params.get('part')) $('parts').value = params.get('part');
  if (params.get('synth')) $('synth').value = params.get('synth');
  const url = params.get('midi');
  fillSelectors();
  if (url) {
    midi = parseMidi(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    fillSelectors();
    if (!params.get('synth')) $('synth').value = 0;
  }
  reload();
  songTime = Number(params.get('at') || 0);
  $('play').textContent = playing ? 'Pause' : 'Play';
  requestAnimationFrame(frame);
})();
