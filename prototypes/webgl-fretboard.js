// Prototype: the note highway (a 3D fretboard) drawn with WebGL 2 instead of the canvas 2D context.
//
//   python -m http.server 8130      (from the repository root; the page only needs static files)
//   http://localhost:8130/prototypes/webgl-fretboard.html            pick a notes.mid, or ?synth=60 for 60 synthetic notes a second
//   http://localhost:8130/prototypes/webgl-fretboard.html?midi=../path/notes.mid&part=guitar&diff=3&at=61&paused=1   a still picture at 61 s
//   ...&bench=6   a measured run of 6 s (the result in window.__bench: fps, JS ms per frame, notes in view)
//
// What it reuses from the app: parseMidi / buildChart (the chart), projection3D (the same perspective: scale 1 / (1 + k d), y = vy + (hit - vy) scale),
// and drawYNote, the app's own note drawing, which is drawn ONCE per kind into a texture atlas. What is new: the notes, the sustains, the beat lines and the road
// are instances / triangles whose screen positions are computed in the vertex shader from the song time, so a frame costs a handful of draw calls and a few
// uniforms on the CPU, whatever the number of notes: the whole chart is uploaded once.
//
// Simplifications against the app (it is a prototype of the drawing, not a replacement): no audio, no hit animation, no star power bands, rolls or fills, no
// flow / wave sustains, no per-note taper (the sprites are scaled uniformly with depth, as the app's 3D sprite cache does), no curved road, no 2D view.
import { parseMidi } from '../src/midi.js';
import { buildChart, instrumentOptions, DIFFICULTIES } from '../src/chart.js';
import { projection3D } from '../src/highway3d.js';
import { drawYNote, YNOTE_SIDE_3D, NOTE_RECT_W, NOTE_RECT_H, NOTE_PALETTE, noteColor, HIT_Y } from '../src/gfx.js';

const DEPTH_SEC = 3.2; // seconds between the hit line and the far edge at neck speed 1 (the app's DEPTH_SEC)
const HEAD_R = 0.36; // note head radius in lane widths (the app's HEAD_R)
const REF_RX = 60; // the head radius, in px, the atlas sprites are drawn with
const CELL_W = 176, CELL_H = 96, COLS = 5, ATLAS = 1024;
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// ---- the chart ------------------------------------------------------------------------------------------------------------------------------------------------

// A synthetic chart: `perSec` notes a second over 5 lanes with chords, HOPO runs, taps and sustains, 120 s long (for scaling tests).
function syntheticChart(perSec) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const notes = [];
  const dur = 120;
  const step = 1 / Math.max(1, perSec);
  for (let t = 2; t < dur; t += step) {
    const lane = Math.floor(rnd() * 5);
    const sustain = rnd() < 0.08 ? 0.3 + rnd() * 1.2 : 0;
    notes.push({ time: t, end: t + sustain, length: sustain, lane, hopo: rnd() < 0.2, tap: rnd() < 0.05, open: rnd() < 0.02 });
  }
  const beats = [];
  for (let i = 0, t = 0; t < dur; i++, t += 0.5) beats.push({ time: t, measure: i % 4 === 0, strong: i % 2 === 0 });
  return { notes, beats, lanes: 5, laneColors: NOTE_PALETTE.lanes, starPower: [], duration: dur };
}

let chart = null;
let midi = null;
function loadChart() {
  const synth = Number($('synth').value);
  if (synth > 0) { chart = syntheticChart(synth); return; }
  if (!midi) { chart = syntheticChart(8); return; }
  const opts = instrumentOptions(midi);
  const ins = opts.find((o) => o.id === $('part').value) || opts[0];
  const diff = DIFFICULTIES[Number($('diff').value)] || DIFFICULTIES[3];
  chart = buildChart(midi, ins, diff, {});
  if (!chart) chart = syntheticChart(8);
}
function chartSummary() { return `${chart.notes.length} notes, ${chart.lanes} lanes, ${chart.duration.toFixed(0)} s`; }

// ---- the atlas: every kind of note drawn once by the app's own function --------------------------------------------------------------------------------------

function buildAtlas(colors) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS;
  const g = cv.getContext('2d');
  const cells = new Map();
  let idx = 0;
  const put = (key, draw) => {
    const x = (idx % COLS) * CELL_W, y = Math.floor(idx / COLS) * CELL_H;
    idx++;
    g.save();
    g.beginPath();
    g.rect(x, y, CELL_W, CELL_H);
    g.clip();
    draw(g, x + CELL_W / 2, y + CELL_H / 2);
    g.restore();
    cells.set(key, [x / ATLAS, y / ATLAS, (x + CELL_W) / ATLAS, (y + CELL_H) / ATLAS]);
  };
  const lanes = Math.min(colors.length, 6);
  for (let l = 0; l < lanes; l++) {
    for (const kind of ['n', 'h', 't']) {
      for (const sp of [0, 1]) {
        put(`${l}|${kind}|${sp}`, (c, cx, cy) => {
          const n = { lane: l, hopo: kind === 'h', tap: kind === 't', sp: !!sp };
          // the sizes the app's 3D view gives these notes: RECT_SCALE 1.15, the plain note 1.1 taller, the HOPO 0.8 smaller, narrower and taller, the tap likewise
          const r = REF_RX * (n.hopo ? 0.8 : 1);
          const fw = 1.15 * (n.hopo || n.tap ? 0.85 : 1) * (n.tap ? 0.8 : 1);
          const fh = 1.15 * (n.hopo || n.tap ? 1.2 : 1.1) * (n.tap ? 0.8 : 1);
          drawYNote(c, cx, cy, r * NOTE_RECT_W * fw, r * 0.55 * NOTE_RECT_H * fh, n, colors[l], noteColor(n, colors), 0, YNOTE_SIDE_3D, false);
        });
      }
    }
    put(`pad|${l}`, (c, cx, cy) => { // the hit pad: a ring of the lane's colour
      c.beginPath();
      c.roundRect(cx - 62, cy - 22, 124, 44, 10);
      c.fillStyle = `${colors[l]}33`;
      c.fill();
      c.lineWidth = 5;
      c.strokeStyle = colors[l];
      c.stroke();
    });
  }
  put('open|0', (c, cx, cy) => { // an open note / a kick: a bar across the road
    const gr = c.createLinearGradient(0, cy - 14, 0, cy + 14);
    gr.addColorStop(0, '#e6a6ff');
    gr.addColorStop(0.5, '#c800ff');
    gr.addColorStop(1, '#6a0088');
    c.fillStyle = gr;
    c.beginPath();
    c.roundRect(cx - 84, cy - 14, 168, 28, 8);
    c.fill();
  });
  return { canvas: cv, cells };
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
  // sustains: a trapezoid from the head to the end of the note, one instance each (t0, t1, lane, width) + colour
  tails: [`${COMMON}in vec4 a_t; in vec4 a_col; out vec4 v_col;
void main() {
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0; float far = float((gl_VertexID >> 1) & 1);
  float tt = max(far > 0.5 ? a_t.y : a_t.x, u_t); float d = clamp((tt - u_t) / u_win, 0.0, 1.2); float p = scaleAt(d);
  vec2 c = project(a_t.z + 0.5 - u_half, d); float w = u_laneW * HEAD * 0.38 * a_t.w * p;
  gl_Position = clipPos(vec2(c.x + side * w, c.y));
  v_col = vec4(a_col.rgb, a_col.a * step(u_t, a_t.y) * (1.0 - smoothstep(0.5, 1.0, d)));
}`.replace('HEAD', HEAD_R.toFixed(3)), FS_COLOR],
  // notes and pads: sprites from the atlas, one instance each (time, lane, uv rect, size factors)
  notes: [`${COMMON}in vec4 a0; in vec4 a1; uniform float u_pad; uniform float u_atlas; out vec2 v_uv; out float v_a;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float dr = (a0.x - u_t) / u_win; float d = u_pad > 0.5 ? 0.0 : clamp(dr, 0.0, 1.0);
  vec2 centre = project(a0.y + 0.5 - u_half, d);
  vec2 size = (a1.xy - a0.zw) * u_atlas * (u_laneW * ${HEAD_R.toFixed(3)} * scaleAt(d) / ${REF_RX.toFixed(1)}) * a1.zw;
  gl_Position = (u_pad < 0.5 && dr < -0.04) ? vec4(2.0, 2.0, 2.0, 1.0) : clipPos(centre + (c - 0.5) * size);
  v_uv = mix(a0.zw, a1.xy, c); v_a = u_pad > 0.5 ? 1.0 : clamp((1.0 - d) / 0.12, 0.0, 1.0);
}`, `#version 300 es
precision mediump float; uniform sampler2D u_tex; in vec2 v_uv; in float v_a; out vec4 o; void main() { o = texture(u_tex, v_uv) * v_a; }`],
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
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u, a: (n) => gl.getAttribLocation(p, n) };
}
for (const name of Object.keys(PROGRAMS)) progs[name] = compile(name);

const SHARED = ['u_res', 'u_hit', 'u_vy', 'u_k', 'u_c', 'u_cx', 'u_laneW', 'u_half', 'u_t', 'u_win'];
const view = { res: [1, 1], hit: 0, vy: 0, k: 0, c: 0, cx: 0, laneW: 0, half: 0, win: DEPTH_SEC };
function setShared(pr, t) {
  const u = pr.u;
  if (u.u_res) gl.uniform2f(u.u_res, view.res[0], view.res[1]);
  const vals = { u_hit: view.hit, u_vy: view.vy, u_k: view.k, u_c: view.c, u_cx: view.cx, u_laneW: view.laneW, u_half: view.half, u_t: t, u_win: view.win };
  for (const n of SHARED) if (n !== 'u_res' && u[n]) gl.uniform1f(u[n], vals[n]);
}

// ---- the scene (rebuilt when the chart, the part or the lane count changes) ------------------------------------------------------------------------------------

const scene = { notes: null, tails: null, beats: null, road: null, pads: null, tex: null, atlas: null };
const f32 = (arr) => Float32Array.from(arr);
function buffer(data, usage = gl.STATIC_DRAW) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage); return b; }
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
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

function buildScene() {
  const colors = chart.laneColors || NOTE_PALETTE.lanes;
  const lanes = chart.lanes || 5;
  const atlas = buildAtlas(colors);
  scene.atlas = atlas;
  if (scene.tex) gl.deleteTexture(scene.tex);
  scene.tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, scene.tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // star power: the notes inside a phrase (the app flags them the same way)
  const spans = [...(chart.starPower || [])].sort((a, b) => a.start - b.start);
  let si = 0;
  for (const n of chart.notes) {
    while (si < spans.length && n.time > spans[si].end) si++;
    n.sp = si < spans.length && n.time >= spans[si].start;
  }
  const src = chart.notes.filter((n) => n.lane >= -1).sort((a, b) => a.time - b.time);
  const noteTimes = new Float32Array(src.length);
  const inst = new Float32Array(src.length * 8); // time, lane, u0, v0 | u1, v1, sx, sy   (stored latest first: far notes are drawn before near ones)
  const tails = [];
  const colorOf = (l) => hexRgb(colors[Math.min(l, colors.length - 1)]);
  let maxLen = 0;
  src.forEach((n, i) => {
    const o = (src.length - 1 - i) * 8;
    const open = n.open || n.lane < 0;
    const kind = n.tap ? 't' : n.hopo ? 'h' : 'n';
    const cell = open ? atlas.cells.get('open|0') : atlas.cells.get(`${Math.min(n.lane, 5)}|${kind}|${n.sp ? 1 : 0}`);
    noteTimes[i] = n.time;
    inst.set([n.time, open ? lanes / 2 - 0.5 : n.lane, cell[0], cell[1], cell[2], cell[3], open ? (lanes * REF_RX) / (HEAD_R * CELL_W * 0.955) : 1, 1], o); // (an open note is as wide as the road: the bar's sprite is 0.955 of its cell)
    if (!open && n.length > 0.09) { tails.push({ t0: n.time, t1: n.time + n.length, lane: n.lane }); maxLen = Math.max(maxLen, n.length); }
  });
  tails.sort((a, b) => a.t0 - b.t0);
  const tailStarts = Float32Array.from(tails, (t) => t.t0);
  const tailData = new Float32Array(tails.length * 8);
  tails.forEach((t, i) => { const o = (tails.length - 1 - i) * 8; tailData.set([t.t0, t.t1, t.lane, 1, ...colorOf(t.lane), 0.62], o); });
  const beats = (chart.beats || []).map((b) => [b.time, b.measure ? 2 : b.strong ? 1 : 0]).flat();
  const pads = [];
  for (let l = 0; l < lanes; l++) { const c = atlas.cells.get(`pad|${Math.min(l, 5)}`); pads.push(0, l, c[0], c[1], c[2], c[3], 1, 1); }

  for (const k of ['notes', 'tails', 'beats', 'pads', 'road']) if (scene[k]) gl.deleteBuffer(scene[k].buf);
  scene.notes = { buf: buffer(inst), count: src.length, times: noteTimes };
  scene.tails = { buf: buffer(tailData), count: tails.length, starts: tailStarts, maxLen };
  scene.beats = { buf: buffer(f32(beats)), count: beats.length / 2, times: Float32Array.from(chart.beats || [], (b) => b.time) };
  scene.pads = { buf: buffer(f32(pads)), count: lanes };
  const road = roadGeometry(lanes);
  scene.road = { buf: buffer(road), count: road.length / 6 };
  scene.lanes = lanes;
  scene.vaos = scene.vaos || {};
  for (const v of Object.values(scene.vaos)) gl.deleteVertexArray(v);
  scene.vaos = {};
}

// A VAO per kind of draw, its instance attributes re-pointed each frame at the first visible instance (a byte offset into the one big buffer).
function vao(name, setup) {
  if (!scene.vaos[name]) { scene.vaos[name] = gl.createVertexArray(); }
  gl.bindVertexArray(scene.vaos[name]);
  setup();
}
const attrib = (pr, name, size, stride, offset, divisor) => {
  const l = pr.a(name);
  if (l < 0) return;
  gl.enableVertexAttribArray(l);
  gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, offset);
  gl.vertexAttribDivisor(l, divisor);
};

// ---- layout and the frame ---------------------------------------------------------------------------------------------------------------------------------------

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const lanes = scene.lanes || 5;
  const portrait = h > w;
  const roadW = portrait ? w * 0.9 : Math.min(h * 1.2, h * 0.9 + (w - h) * 0.3); // the app's road width
  const hit = h * Math.min(HIT_Y, 0.93);
  const pr = projection3D(h, hit, Number($('persp').value), 0);
  Object.assign(view, { res: [w, h], hit, vy: pr.vy, k: pr.k, c: pr.c, cx: w / 2, laneW: roadW / lanes, half: lanes / 2, win: DEPTH_SEC / Number($('neck').value) });
  gl.viewport(0, 0, w, h);
}

let drawn = { notes: 0, tails: 0 };
function render(t) {
  layout();
  gl.clearColor(0.043, 0.055, 0.086, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const win = view.win;

  // the road
  let pr = progs.flat;
  gl.useProgram(pr.p); setShared(pr, t);
  vao('road', () => { gl.bindBuffer(gl.ARRAY_BUFFER, scene.road.buf); attrib(pr, 'a_pos', 2, 24, 0, 0); attrib(pr, 'a_col', 4, 24, 8, 0); });
  gl.drawArrays(gl.TRIANGLES, 0, scene.road.count);

  // the beat lines in the window
  pr = progs.beats;
  const bFrom = lowerBound(scene.beats.times, t), bTo = lowerBound(scene.beats.times, t + win);
  gl.useProgram(pr.p); setShared(pr, t);
  vao('beats', () => { gl.bindBuffer(gl.ARRAY_BUFFER, scene.beats.buf); attrib(pr, 'a_b', 2, 8, bFrom * 8, 1); });
  if (bTo > bFrom) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, bTo - bFrom);

  // the sustains: starts in [t - the longest sustain, t + window]
  pr = progs.tails;
  const tn = scene.tails.count;
  const tFrom = lowerBound(scene.tails.starts, t - scene.tails.maxLen), tTo = lowerBound(scene.tails.starts, t + win);
  if (tTo > tFrom) {
    gl.useProgram(pr.p); setShared(pr, t);
    const first = tn - tTo; // stored latest first
    vao('tails', () => { gl.bindBuffer(gl.ARRAY_BUFFER, scene.tails.buf); attrib(pr, 'a_t', 4, 32, first * 32, 1); attrib(pr, 'a_col', 4, 32, first * 32 + 16, 1); });
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, tTo - tFrom);
  }
  drawn.tails = Math.max(0, tTo - tFrom);

  // the pads, then the notes
  pr = progs.notes;
  gl.useProgram(pr.p); setShared(pr, t);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.tex);
  gl.uniform1i(pr.u.u_tex, 0); gl.uniform1f(pr.u.u_atlas, ATLAS);
  gl.uniform1f(pr.u.u_pad, 1);
  vao('pads', () => { gl.bindBuffer(gl.ARRAY_BUFFER, scene.pads.buf); attrib(pr, 'a0', 4, 32, 0, 1); attrib(pr, 'a1', 4, 32, 16, 1); });
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.pads.count);
  gl.uniform1f(pr.u.u_pad, 0);
  const nn = scene.notes.count;
  const nFrom = lowerBound(scene.notes.times, t - 0.12), nTo = lowerBound(scene.notes.times, t + win);
  if (nTo > nFrom) {
    const first = nn - nTo;
    vao('notes', () => { gl.bindBuffer(gl.ARRAY_BUFFER, scene.notes.buf); attrib(pr, 'a0', 4, 32, first * 32, 1); attrib(pr, 'a1', 4, 32, first * 32 + 16, 1); });
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nTo - nFrom);
  }
  drawn.notes = Math.max(0, nTo - nFrom);
}

// ---- the loop, the clock and the HUD -----------------------------------------------------------------------------------------------------------------------------

let playing = !params.get('paused'), songTime = 0, last = performance.now(); // (?paused=1 starts stopped, for a still picture)
const stats = { frames: [], js: [], gpu: [], notes: [] };
let gpuQuery = null;
const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const p95 = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.95)] : 0);
const benchSecs = Number(params.get('bench') || 0);
let benchStart = 0, benchDone = false;

function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (playing) songTime += dt;
  if (songTime > chart.duration + 1) songTime = 0;
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
  stats.frames.push(dt * 1000); stats.js.push(b - a); stats.notes.push(drawn.notes);
  for (const k of ['frames', 'js', 'notes']) if (stats[k].length > 300) stats[k].shift();

  if (benchSecs && !benchDone) {
    if (!benchStart) { benchStart = now; benchAll.length = 0; }
    benchAll.push([dt * 1000, b - a, drawn.notes]);
    if (now - benchStart > benchSecs * 1000) {
      benchDone = true;
      const d = benchAll.slice(5).map((x) => x[0]), j = benchAll.slice(5).map((x) => x[1]), n = benchAll.slice(5).map((x) => x[2]);
      window.__bench = JSON.stringify({ renderer: 'webgl', fps: +(1000 / avg(d)).toFixed(1), over20ms: d.filter((x) => x > 20).length, jsMeanMs: +avg(j).toFixed(3), jsP95Ms: +p95(j).toFixed(3), notesInView: Math.round(avg(n)), totalNotes: chart.notes.length, viewport: view.res.join('x') });
    }
  }
  requestAnimationFrame(frame);
}
const benchAll = [];

setInterval(() => {
  const fps = 1000 / (avg(stats.frames) || 1);
  $('hud').innerHTML = `<b>WebGL 2</b> &nbsp; ${chartSummary()}<br>` +
    `fps <b>${fps.toFixed(0)}</b> &nbsp; JS per frame <b>${avg(stats.js).toFixed(3)} ms</b> (p95 ${p95(stats.js).toFixed(3)})<br>` +
    `GPU per frame <b>${stats.gpu.length ? avg(stats.gpu).toFixed(3) + ' ms' : 'n/a'}</b><br>` +
    `notes in view <b>${Math.round(avg(stats.notes))}</b> &nbsp; sustains <b>${drawn.tails}</b> &nbsp; draw calls <b>6</b>`;
}, 250);

// ---- controls ---------------------------------------------------------------------------------------------------------------------------------------------------

function fillSelectors() {
  const opts = midi ? instrumentOptions(midi) : [];
  $('part').innerHTML = opts.map((o) => `<option value="${o.id}">${o.label || o.id}</option>`).join('');
  $('diff').innerHTML = DIFFICULTIES.map((d, i) => `<option value="${i}">${d.label || d.id}</option>`).join('');
  $('diff').value = params.get('diff') ?? '3';
  const want = params.get('part');
  if (want && opts.some((o) => o.id === want)) $('part').value = want;
}
function reload() {
  loadChart();
  buildScene();
  $('seek').max = chart.duration;
  songTime = Math.min(songTime, chart.duration);
}
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  midi = parseMidi(new Uint8Array(await f.arrayBuffer()));
  $('synth').value = 0;
  fillSelectors();
  reload();
});
for (const id of ['part', 'diff', 'synth']) $(id).addEventListener('change', reload);
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
    midi = parseMidi(new Uint8Array(await res.arrayBuffer()));
    $('synth').value = 0;
    $('msg').textContent = '';
    fillSelectors();
    reload();
    songTime = 0;
  } catch (e) { $('msg').textContent = `This song has no notes.mid (${e.message}); .chart and .sng songs are not read by the prototype.`; }
});
loadSongList();
$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; });
$('seek').addEventListener('input', () => { songTime = Number($('seek').value); });

(async () => {
  if (params.get('synth')) $('synth').value = params.get('synth');
  const url = params.get('midi');
  if (url) {
    midi = parseMidi(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    fillSelectors();
    if (!params.get('synth')) $('synth').value = 0;
  } else fillSelectors();
  reload();
  songTime = Number(params.get('at') || 0);
  $('play').textContent = playing ? 'Pause' : 'Play';
  requestAnimationFrame(frame);
})();
