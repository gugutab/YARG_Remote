// WebGL 2 ports of the three heaviest background visualizers (src/visualizers.js): Beat rings, Aurora and Warp. Each port reads the same state the 2D one gets from the
// driver (`driver.state`, `driver.data`: the clock, the beat, the density, the palette, the instruments' layers) and does the same arithmetic on the CPU (the melody of each
// instrument, the beat rings alive, the stars' stretch...); only the drawing moves to the GPU: rings and orbits are one full-screen pass whose pixels test their distance to
// each ring, the aurora is an instanced strip per ribbon strand with the three widths as three passes, and the stars are instanced quads placed by the vertex shader.
// Units: the shaders work in the visualizer's own units (the stage's CSS px, y down) and `u_sc` is the canvas pixels per unit (the app draws its background at a fraction
// of the full resolution), so a line is as wide as in the 2D version.
import { melodyAt, layerGain, layerColor, tint, ringsAt, hash01 } from '../src/visualizers.js';

const TAU = Math.PI * 2;
const fract = (v) => v - Math.floor(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const n255 = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];

const HEAD = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_sc;
`;
// a full-screen quad in the visualizer's units (y down)
const VS_FULL = `${HEAD}out vec2 v_p;
void main() { vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)); gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0); v_p = vec2(c.x, 1.0 - c.y) * u_res; }`;
const FS_HEAD = `${HEAD}in vec2 v_p; out vec4 o;
const float TAU = 6.2831853;
float cov(float d, float hw) { float aa = 0.5 / u_sc; return 1.0 - smoothstep(hw - aa, hw + aa, d); }
void over(inout vec4 acc, vec3 c, float a) { acc.rgb = c * a + acc.rgb * (1.0 - a); acc.a = a + acc.a * (1.0 - a); }
`;

function program(gl, name, vs, fs) {
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

// ---- Beat rings -----------------------------------------------------------------------------------------------------------------------------------------------------

const MAX_RINGS = 40;
const RINGS_FS = `${FS_HEAD}
uniform vec4 u_ring[${MAX_RINGS}]; uniform vec3 u_rcol[${MAX_RINGS}]; uniform int u_n; uniform float u_unit; uniform vec2 u_c;
uniform vec4 u_orb[3]; uniform vec3 u_ocol[3]; uniform vec2 u_perc; uniform vec3 u_corecol; uniform vec2 u_core;
void main() {
  vec2 d = v_p - u_c; float r = length(d); float ang = atan(d.y, d.x);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${MAX_RINGS}; i++) { // the rings, newest first: a faint wide trail under the line
    if (i >= u_n) break;
    vec4 g = u_ring[i];
    over(acc, u_rcol[i], g.w * 0.16 * cov(abs(r - g.x), g.z * 0.5));
    over(acc, u_rcol[i], g.w * cov(abs(r - g.x), g.y * 0.5));
  }
  for (int k = 0; k < 3; k++) { // the orbits: the circle, the marker's tail, the marker
    vec4 ob = u_orb[k]; vec3 col = u_ocol[k]; float a = ob.y, fl = ob.z;
    over(acc, col, 0.1 * cov(abs(r - ob.x), 1.5 * u_unit * 0.5));
    float rel = mod(ang - (a - 0.9) + 3.0 * TAU, TAU);
    if (rel < 0.9) over(acc, col, 0.38 * cov(abs(r - ob.x), 3.5 * u_unit * 0.5));
    vec2 m = u_c + vec2(cos(a), sin(a)) * ob.x; float dm = length(v_p - m);
    over(acc, col, (0.25 + 0.3 * fl) * cov(dm, (9.0 + 8.0 * fl) * u_unit));
    over(acc, mix(col, vec3(1.0), 0.5), 0.9 * cov(dm, 3.6 * u_unit));
  }
  if (u_perc.x > 0.02) over(acc, vec3(1.0), u_perc.x * 0.5 * cov(abs(r - u_perc.y), 3.0 * u_unit * 0.5)); // a percussion hit
  float g = max(0.0, 1.0 - r / u_core.y); // the soft core, added (lighter)
  acc.rgb += u_corecol * u_core.x * g; acc.a += u_core.x * g;
  o = acc;
}`;

function ringsPort(gl) {
  const pr = program(gl, 'rings', VS_FULL, RINGS_FS);
  const alive = [];
  const ring = new Float32Array(MAX_RINGS * 4), rcol = new Float32Array(MAX_RINGS * 3), orb = new Float32Array(12), ocol = new Float32Array(9);
  return {
    draw(s, data, w, h, sc) {
      const pal = data.palette;
      const cx = w / 2, cy = h / 2;
      const maxR = Math.hypot(w, h) * 0.55;
      const life = Math.min(4, 14 * s.beat.interval);
      const speed = maxR / life;
      const unit = Math.min(w, h) / 760;
      const bar = (1 - s.beat.measurePhase) ** 5;
      const rings = ringsAt(data.beats, s.t, s.beat.interval, life, alive);
      const n = Math.min(MAX_RINGS, rings.length);
      for (let r = 0; r < n; r++) {
        const { index: i, age, measure } = rings[r];
        const k = 1 - age / life;
        const col = n255(measure ? pal.va : pal.v[((i % 3) + 3) % 3]);
        const rad = (12 + age * speed) * (measure ? 1 + 0.05 * bar : 1);
        const a = Math.min(1, k ** 1.2 * (measure ? 1.1 : 0.9));
        ring.set([rad, (measure ? 7 : 2.6) * (0.5 + k) * unit, (measure ? 30 : 14) * (0.4 + k) * unit, a], r * 4);
        rcol.set(col, r * 3);
      }
      const orbits = [[0.17, s.beat.phase, pal.v[0]], [0.27, ((((s.beat.index % 2) + 2) % 2) + s.beat.phase) / 2, pal.v[1]], [0.38, s.beat.measurePhase, pal.va]];
      orbits.forEach(([size, frac, col], o) => {
        orb.set([Math.min(w, h) * size, -Math.PI / 2 + frac * TAU, (1 - frac) ** 6, 0], o * 4);
        ocol.set(n255(col), o * 3);
      });
      gl.useProgram(pr.p);
      const u = pr.u;
      gl.uniform2f(u.u_res, w, h); gl.uniform1f(u.u_sc, sc); gl.uniform1f(u.u_unit, unit); gl.uniform2f(u.u_c, cx, cy); gl.uniform1i(u.u_n, n);
      gl.uniform4fv(u.u_ring, ring); gl.uniform3fv(u.u_rcol, rcol); gl.uniform4fv(u.u_orb, orb); gl.uniform3fv(u.u_ocol, ocol);
      gl.uniform2f(u.u_perc, s.perc, 30 + (1 - s.perc) * maxR * 0.35);
      gl.uniform3fv(u.u_corecol, n255(pal.va)); gl.uniform2f(u.u_core, 0.22 + 0.3 * bar + 0.2 * s.hit, Math.min(w, h) * (0.2 + 0.03 * bar));
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

// ---- Aurora ---------------------------------------------------------------------------------------------------------------------------------------------------------

const AURORA_SEGS = 96;
const AURORA_VS = `${HEAD}in vec4 a_a; in vec4 a_b; in vec4 a_c; in vec4 a_d; uniform vec2 u_pass; out vec4 v_col; out float v_side, v_hw;
float ribbon(float x) { return a_a.x + sin(x * a_a.w + a_b.z) * a_a.y + sin(x * a_b.x + a_b.w) * a_a.y * 0.5 + sin(x * a_b.y + a_c.x) * a_a.y * 0.22; }
void main() {
  int id = gl_VertexID; float side = ((id & 1) == 0) ? -1.0 : 1.0; float k = float(id >> 1) / ${AURORA_SEGS}.0;
  float x = k * u_res.x; float y = ribbon(x);
  float dy = (ribbon(x + 2.0) - ribbon(x - 2.0)) / 4.0;
  float hw = a_a.z * u_pass.x * 0.5;
  vec2 p = vec2(x, y + side * hw * sqrt(1.0 + dy * dy)); // (the strip's edges are above and below the curve: a steep part is as wide across as the stroke)
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  v_col = vec4(a_d.rgb, a_c.y * u_pass.y); v_side = side; v_hw = hw;
}`;
const AURORA_FS = `${HEAD}in vec4 v_col; in float v_side, v_hw; uniform float u_unused; out vec4 o;
void main() { float edge = clamp((1.0 - abs(v_side)) * v_hw * u_sc + 0.5, 0.0, 1.0); float a = v_col.a * edge; o = vec4(v_col.rgb * a, a); }`;
const SKY_FS = `${FS_HEAD}uniform vec4 u_top; uniform vec4 u_bot;
void main() { vec4 c = mix(u_top, u_bot, v_p.y / u_res.y); o = vec4(c.rgb * c.a, c.a); }`;

function auroraPort(gl) {
  const sky = program(gl, 'sky', VS_FULL, SKY_FS);
  const rib = program(gl, 'aurora', AURORA_VS, AURORA_FS);
  const mel = Array.from({ length: 8 }, () => ({ pitch: 0.5, energy: 0 }));
  const buf = gl.createBuffer();
  const vao = gl.createVertexArray();
  const inst = new Float32Array(24 * 16);
  return {
    draw(s, data, w, h, sc) {
      const song = data;
      const pal = song.palette;
      const layers = song.layers?.length ? song.layers : [0, 1, 2].map((k) => ({ kind: '', events: song.events, shown: true, fallback: k }));
      const L = Math.min(layers.length, mel.length);
      let n = 0;
      for (let li = 0; li < L; li++) {
        const layer = layers[li];
        const on = layer.shown !== false;
        const m = melodyAt(layer.events, s.t, layerGain(layer.kind), mel[li]);
        const kindColor = layer.fallback === undefined ? layerColor(layer.kind, li, pal) : pal.v[layer.fallback % pal.v.length];
        const col = mixRgb(tint(kindColor, 0.1), [255, 200, 120], 0.15 * s.sp).map(Math.round);
        const e = m.energy;
        const y0 = h * (0.86 - 0.72 * m.pitch) + Math.sin(s.bt * 0.17 + li * 1.9) * h * 0.05;
        const amp = h * (0.055 + 0.14 * e) * (0.8 + 0.4 * s.density) * (0.8 + 0.25 * s.tempo);
        const thick = h * (0.016 + 0.04 * e);
        const ph = li * 2.3 + (song.seed % 7);
        const f1 = 0.0042 + li * 0.0006, f2 = f1 * 2.6, f3 = f1 * 4.3;
        const v1 = (0.7 + li * 0.15) * (li % 2 ? -1 : 1), v2 = 0.5 + li * 0.1, v3 = -0.9 - li * 0.08;
        const k0 = on ? 1 : 0.22;
        for (let strand = 0; strand < 3; strand++) {
          const sph = ph + strand * 1.3;
          const a = k0 * (0.55 + 0.6 * e);
          inst.set([y0 + (strand - 1) * thick * 2.6, amp, thick, f1, f2, f3, (-s.bt * v1 + sph) % TAU, (s.bt * v2 + sph * 1.7) % TAU, (s.bt * v3 + sph * 0.6) % TAU, a, 0, 0, col[0] / 255, col[1] / 255, col[2] / 255, 0], n * 16);
          n++;
        }
      }
      const top = [...pal.v[2].map((c) => c / 255), 0.16], bot = [...pal.v[0].map((c) => c / 255), 0.24];
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(sky.p);
      gl.uniform2f(sky.u.u_res, w, h); gl.uniform1f(sky.u.u_sc, sc); gl.uniform4fv(sky.u.u_top, top); gl.uniform4fv(sky.u.u_bot, bot);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.useProgram(rib.p);
      gl.uniform2f(rib.u.u_res, w, h); gl.uniform1f(rib.u.u_sc, sc);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, n * 16), gl.DYNAMIC_DRAW);
      for (const [i, name] of ['a_a', 'a_b', 'a_c', 'a_d'].entries()) { const l = rib.a(name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 64, i * 16); gl.vertexAttribDivisor(l, 1); }
      for (const [wf, am] of [[2.6, 0.03], [1.2, 0.075], [0.4, 0.15]]) { // the soft glow, then narrower, then the line
        gl.uniform2f(rib.u.u_pass, wf, am);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * (AURORA_SEGS + 1), n);
      }
      gl.bindVertexArray(null);
    },
  };
}

// ---- Warp -----------------------------------------------------------------------------------------------------------------------------------------------------------

const STARS = 220;
const WARP_VS = `${HEAD}in vec2 a_h; in float a_i; uniform vec2 u_c; uniform float u_R, u_travel, u_streak, u_groups; uniform vec4 u_gc[8]; uniform vec2 u_gs[8];
out vec4 v_col; out float v_side, v_hw;
float f01(float v) { return v - floor(v); }
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  int gi = int(mod(a_i, u_groups));
  float z = f01(a_h.x + u_travel);
  float band = min(2.0, floor(z * 3.0));
  float a = a_h.y * 6.2831853;
  float z0 = max(0.0, z - u_streak * u_gs[gi].x * (0.5 + z));
  float r1 = pow(z, 1.9) * u_R, r0 = pow(z0, 1.9) * u_R;
  vec2 dir = vec2(cos(a), sin(a)); vec2 nrm = vec2(-dir.y, dir.x);
  float hw = 0.5 * (1.0 + band * 0.9) * u_gs[gi].y;
  float along = mix(r0, r1, c.y);
  vec2 p = u_c + dir * (along + (c.y - 0.5) * 2.0 * hw) + nrm * (c.x - 0.5) * 2.0 * hw; // (round caps as a half width of extra length)
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  v_col = vec4(u_gc[gi].rgb, min(1.0, (0.35 + band * 0.25) * u_gc[gi].a)); v_side = (c.x - 0.5) * 2.0; v_hw = hw;
}`;
const WARP_FS = `${HEAD}in vec4 v_col; in float v_side, v_hw; out vec4 o;
void main() { float edge = clamp((1.0 - abs(v_side)) * v_hw * u_sc + 0.5, 0.0, 1.0); float a = v_col.a * edge; o = vec4(v_col.rgb * a, a); }`;
const GLOW_FS = `${FS_HEAD}uniform vec2 u_c; uniform vec4 u_gcol; uniform float u_gr; uniform vec4 u_flash;
void main() {
  float g = max(0.0, 1.0 - length(v_p - u_c) / u_gr);
  float a = u_gcol.a * g; vec4 acc = vec4(u_gcol.rgb * a, a);
  float f = u_flash.a; acc.rgb = u_flash.rgb * f + acc.rgb * (1.0 - f); acc.a = f + acc.a * (1.0 - f);
  o = acc;
}`;

function warpPort(gl) {
  const stars = program(gl, 'warp', WARP_VS, WARP_FS);
  const glow = program(gl, 'glow', VS_FULL, GLOW_FS);
  const mel = Array.from({ length: 8 }, () => ({ pitch: 0.5, energy: 0 }));
  const glowNow = [0, 0, 0];
  let glowAt = -1;
  const hs = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) hs.set([hash01(i, 1), hash01(i, 2), i], i * 3);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, hs, gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  { const l = stars.a('a_h'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 12, 0); gl.vertexAttribDivisor(l, 1); }
  { const l = stars.a('a_i'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 1, gl.FLOAT, false, 12, 8); gl.vertexAttribDivisor(l, 1); }
  gl.bindVertexArray(null);
  const gc = new Float32Array(32), gsArr = new Float32Array(16);
  return {
    draw(s, data, w, h, sc) {
      const pal = data.palette;
      const layers = data.layers ?? [];
      const L = Math.min(layers.length, mel.length);
      let lean = 0, total = 0;
      for (let li = 0; li < L; li++) {
        const m = melodyAt(layers[li].events, s.t, layerGain(layers[li].kind), mel[li]);
        if (layers[li].shown !== false) { lean += (0.5 - m.pitch) * m.energy; total += m.energy; }
      }
      const cx = w / 2 + Math.sin(s.bt * 0.11) * w * 0.03;
      const cy = h / 2 + Math.cos(s.bt * 0.09) * h * 0.03 + (total > 0 ? (lean / total) * Math.min(1, total) * h * 0.14 : 0);
      const R = Math.hypot(w, h) * 0.53;
      const busy = L ? Math.min(1, total / 2) : s.density;
      const streak = (0.015 + 0.06 * Math.max(s.density, busy) + 0.04 * s.sp) * (0.75 + 0.35 * s.tempo);
      const hot = [170, 225, 255];
      const travel = s.travel * 0.1 + s.bt * 0.04;
      const groups = L || 2;
      for (let gi = 0; gi < groups; gi++) {
        const layer = L ? layers[gi] : null;
        const e = layer ? mel[gi].energy : 0.5;
        const on = layer ? layer.shown !== false : true;
        const col = mixRgb(layer ? tint(layerColor(layer.kind, gi, pal), 0.5) : gi === 0 ? [235, 240, 255] : pal.v[1], hot, s.sp);
        gc.set([col[0] / 255, col[1] / 255, col[2] / 255, layer ? (on ? 0.5 + 0.5 * e : 0.2) : 1], gi * 4);
        gsArr.set([layer ? 0.55 + 1.5 * e : 1, layer ? 0.8 + 0.5 * e : 1], gi * 2);
      }
      let tr = pal.v[0][0], tg = pal.v[0][1], tb = pal.v[0][2];
      if (L && total > 0) {
        let sum = 0; tr = 0; tg = 0; tb = 0;
        for (let li = 0; li < L; li++) { const c = tint(layerColor(layers[li].kind, li, pal), 0.2); const wgt = mel[li].energy ** 2; tr += c[0] * wgt; tg += c[1] * wgt; tb += c[2] * wgt; sum += wgt; }
        if (sum > 0) { tr /= sum; tg /= sum; tb /= sum; }
      }
      const dt = glowAt < 0 ? 9 : clamp(s.clock - glowAt, 0, 0.25);
      glowAt = s.clock;
      const ease = 1 - Math.exp(-dt / 0.9);
      glowNow[0] += (tr - glowNow[0]) * ease; glowNow[1] += (tg - glowNow[1]) * ease; glowNow[2] += (tb - glowNow[2]) * ease;
      const glowCol = mixRgb(glowNow, hot, s.sp);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(stars.p);
      const u = stars.u;
      gl.uniform2f(u.u_res, w, h); gl.uniform1f(u.u_sc, sc); gl.uniform2f(u.u_c, cx, cy);
      gl.uniform1f(u.u_R, R); gl.uniform1f(u.u_travel, travel); gl.uniform1f(u.u_streak, streak); gl.uniform1f(u.u_groups, groups);
      gl.uniform4fv(u.u_gc, gc); gl.uniform2fv(u.u_gs, gsArr);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, STARS);
      gl.bindVertexArray(null);
      gl.useProgram(glow.p);
      gl.uniform2f(glow.u.u_res, w, h); gl.uniform1f(glow.u.u_sc, sc); gl.uniform2f(glow.u.u_c, cx, cy);
      gl.uniform4f(glow.u.u_gcol, glowCol[0] / 255, glowCol[1] / 255, glowCol[2] / 255, 0.16 + 0.3 * s.sp + 0.2 * busy);
      gl.uniform1f(glow.u.u_gr, Math.min(w, h) * (0.5 + 0.1 * busy));
      gl.uniform4f(glow.u.u_flash, 180 / 255, 225 / 255, 1, s.sp > 0 ? 0.1 * s.sp * s.beat.pulse : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

export const PORTS = { rings: ringsPort, aurora: auroraPort, warp: warpPort };
