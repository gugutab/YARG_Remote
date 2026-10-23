// The vocal view's notes on the WebGL board: the pitch bars, the ribbons that join a pitch slide to the note before it, the talkies (unpitched notes: a dashed box), the percussion
// hits, the beat lines, the hit line and the glow of the voice at the hit line. Highway.renderVocals works out the layout (the pitch range, where each note is) and records what is
// visible into a VocalFrame; GLBoard.drawVocals() hands the frame to GLVocals, which draws it in a few instanced passes (each note is a quad, its shape an SDF in the fragment
// shader). The lyrics stay on the 2D canvas above (text), as the bands behind them.
// Star power notes (a note inside a star power phrase, vocals.js `sp`) get a gold outline and a gold glow where they are sung.
// Units: the pane's CSS px, y down, origin at the pane's top left (the board sets the viewport to the pane).

// ---- the frame --------------------------------------------------------------------------------------------------------------------------------------------------------

const STRIDE = 12;

// A growable list of rows of 12 floats (three vec4 attributes per instance).
class Rec {
  constructor() { this.a = new Float32Array(STRIDE * 48); this.n = 0; }
  reset() { this.n = 0; }
  push(v0 = 0, v1 = 0, v2 = 0, v3 = 0, v4 = 0, v5 = 0, v6 = 0, v7 = 0, v8 = 0, v9 = 0, v10 = 0, v11 = 0) {
    if ((this.n + 1) * STRIDE > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    const a = this.a, o = this.n++ * STRIDE;
    a[o] = v0; a[o + 1] = v1; a[o + 2] = v2; a[o + 3] = v3; a[o + 4] = v4; a[o + 5] = v5; a[o + 6] = v6; a[o + 7] = v7; a[o + 8] = v8; a[o + 9] = v9; a[o + 10] = v10; a[o + 11] = v11;
  }
}

const rgbCache = new Map();
// '#rrggbb' (or '#rgb') -> [r, g, b] in 0..1 (white for anything else)
export function rgbOf(hex) {
  let c = rgbCache.get(hex);
  if (c) return c;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  let h = m ? m[1] : 'ffffff';
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  if (rgbCache.size > 256) rgbCache.clear();
  rgbCache.set(hex, c);
  return c;
}

// What one frame of the vocal view draws, recorded by Highway.renderVocals: `flat` quads (the base, the beat lines, the hit line), `groups` (one per voice, drawn in order: the
// harmonies first, the lead on top: their ribbons then their bars), the percussion hits and the glows of the voices at the hit line.
export class VocalFrame {
  constructor() {
    this.flat = new Rec();
    this.groups = [];
    this.used = 0;
    this.perc = new Rec();
    this.glows = new Rec();
    this.t = 0;
    this.hitX = 0;
    this.percColors = null; // { glow, ring, ball, lit, dark }: hex strings
  }
  begin(t, hitX) {
    this.t = t; this.hitX = hitX;
    this.flat.reset(); this.perc.reset(); this.glows.reset();
    this.used = 0;
  }
  group() {
    const g = (this.groups[this.used] ??= { ribbons: new Rec(), bars: new Rec() });
    this.used++;
    g.ribbons.reset(); g.bars.reset();
    return g;
  }
  // a flat coloured rectangle (premultiplied by the shader)
  quad(x, y, w, h, [r, g, b], a) { this.flat.push(x, y, w, h, r, g, b, a); }
  // a pitch bar (or a talkie box: flags 1), `passed` the colour of the part that has crossed the hit line; sp: a star power note
  bar(grp, x1, x2, y, half, idle, passed, talkie, sp) {
    grp.bars.push(x1, x2, y, half, idle[0], idle[1], idle[2], (talkie ? 1 : 0) + (sp ? 2 : 0), passed[0], passed[1], passed[2], 0);
  }
  // the ribbon of a pitch slide, from (xs, ya) to (xe, y)
  ribbon(grp, xs, xe, ya, y, half, idle, passed, sp) {
    grp.ribbons.push(xs, xe, ya, y, idle[0], idle[1], idle[2], half, passed[0], passed[1], passed[2], sp ? 1 : 0);
  }
  // a percussion hit
  hit(x, y, r, past, k, alpha, pop, lit) { this.perc.push(x, y, r, past, k, alpha, pop, lit); }
  // the glow of a voice: y, its radius, its strength 0..1, the seconds since the note started, the note's colour, star power, a seed
  glow(y, R, env, age, rgb, sp, seed) { this.glows.push(y, R, env, age, rgb[0], rgb[1], rgb[2], sp ? 1 : 0, seed); }
}

// ---- the shaders --------------------------------------------------------------------------------------------------------------------------------------------------------

const VS = (bounds) => `#version 300 es
precision highp float;
uniform vec2 u_size; uniform float u_hitx;
in vec4 a0; in vec4 a1; in vec4 a2;
flat out vec4 v_a0; flat out vec4 v_a1; flat out vec4 v_a2; out vec2 v_p;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec4 bb = ${bounds};
  v_p = mix(bb.xy, bb.zw, c);
  v_a0 = a0; v_a1 = a1; v_a2 = a2;
  gl_Position = vec4(v_p.x / u_size.x * 2.0 - 1.0, 1.0 - v_p.y / u_size.y * 2.0, 0.0, 1.0);
}`;

const FS = (decl, body) => `#version 300 es
precision highp float;
uniform float u_hitx, u_t;
flat in vec4 v_a0; flat in vec4 v_a1; flat in vec4 v_a2; in vec2 v_p; out vec4 o;
const vec3 GOLD = vec3(1.0, 0.773, 0.239);
float cover(float d) { return 1.0 - smoothstep(-0.5, 0.5, d); }
${decl}
${body}`;

const PROGRAMS = {
  // x, y, w, h | rgba: the base, the beat lines, the hit line
  flat: [VS('vec4(a0.x, a0.y, a0.x + a0.z, a0.y + a0.w)'), FS('', 'void main() { o = vec4(v_a1.rgb * v_a1.a, v_a1.a); }')],

  // a pitch bar: x1, x2, y, half | r, g, b, flags (1 talkie, 2 star power) | passed rgb. A rounded bar, or a dashed box for a talkie; the part past the hit line has the passed colour;
  // star power: a gold line just inside the edge and a soft gold glow outside it.
  bars: [VS('vec4(a0.x - 12.0, a0.z - a0.w - 12.0, a0.y + 12.0, a0.z + a0.w + 12.0)'), FS(
    'float sdRR(vec2 p, vec2 hs, float r) { vec2 q = abs(p) - hs + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }',
    `void main() {
  float x1 = v_a0.x, x2 = v_a0.y, y = v_a0.z, hf = v_a0.w;
  vec2 hs = vec2((x2 - x1) * 0.5, hf);
  int fl = int(v_a1.w + 0.5); bool tk = (fl & 1) != 0; bool sp = (fl & 2) != 0;
  float d = sdRR(v_p - vec2((x1 + x2) * 0.5, y), hs, tk ? 0.0 : min(hf, hs.x));
  vec3 col = v_p.x < u_hitx ? v_a2.rgb : v_a1.rgb;
  float inside = cover(d), a = inside, ring = 0.0;
  if (tk) { // a free note: a faint fill and a dashed border 2 px wide, just inside
    float dash = step(fract((v_p.x + v_p.y) / 7.0), 4.0 / 7.0);
    float edge = (1.0 - smoothstep(0.5, 1.5, abs(d + 1.0))) * dash;
    a = max(0.35 * inside, edge);
    ring = sp ? edge : 0.0;
  } else if (sp) ring = inside * smoothstep(-3.4, -2.4, d); // (a gold line 2.5 px wide inside the edge)
  col = mix(col, GOLD, ring);
  float glow = sp ? (1.0 - inside) * 0.55 * exp(-max(d, 0.0) / 4.5) * (1.0 - smoothstep(4.0, 11.0, max(d, 0.0))) : 0.0; // (gone before the quad's edge)
  float al = a + glow * (1.0 - a);
  o = vec4(col * a + GOLD * glow * (1.0 - a), al);
}`)],

  // the ribbon of a pitch slide: xs, xe, ya, y | r, g, b, half | passed rgb, star power. The pitch glides in a smooth S from (xs, ya) to (xe, y).
  ribbons: [VS('vec4(a0.x, min(a0.z, a0.w) - a1.w - 12.0, a0.y, max(a0.z, a0.w) + a1.w + 12.0)'), FS('',
    `void main() {
  float xs = v_a0.x, xe = v_a0.y, ya = v_a0.z, y = v_a0.w, hf = v_a1.w;
  float u = clamp((v_p.x - xs) / max(xe - xs, 1.0), 0.0, 1.0);
  float yc = mix(ya, y, u * u * (3.0 - 2.0 * u));
  float d = abs(v_p.y - yc) - hf;
  float mask = smoothstep(xs - 0.5, xs + 0.5, v_p.x) * (1.0 - smoothstep(xe - 0.5, xe + 0.5, v_p.x));
  vec3 col = v_p.x < u_hitx ? v_a2.rgb : v_a1.rgb;
  float inside = cover(d) * mask, sp = v_a2.w;
  float ring = sp * inside * smoothstep(-3.4, -2.4, d);
  col = mix(col, GOLD, ring);
  float glow = sp * (1.0 - cover(d)) * 0.55 * exp(-max(d, 0.0) / 4.5) * (1.0 - smoothstep(4.0, 11.0, max(d, 0.0))) * mask;
  o = vec4(col * inside + GOLD * glow * (1.0 - inside), inside + glow * (1.0 - inside));
}`)],

  // a percussion hit: x, y, r, past | k, alpha, pop, lit. The ball (swelling on the beat), and for the first PERC_HOLD seconds a glow, two rings going out and eight spokes.
  perc: [VS('vec4(a0.x - a0.z * 4.0, a0.y - a0.z * 4.0, a0.x + a0.z * 4.0, a0.y + a0.z * 4.0)'), FS(
    'uniform vec3 u_pglow, u_pring, u_pball, u_plit, u_pdark;',
    `void main() {
  vec2 c = v_a0.xy, d = v_p - c; float r = v_a0.z, past = v_a0.w, k = v_a1.x, alpha = v_a1.y, pop = v_a1.z, lit = v_a1.w;
  float L = length(d), fade = 1.0 - k;
  vec4 acc = vec4(0.0);
  bool live = past > 0.0 && k < 1.0;
  if (live) {
    float Rg = r * (2.2 + k);
    float g = (1.0 - smoothstep(r * 0.4, Rg, L)) * 0.55 * fade;
    acc = vec4(u_pglow * g, g);
    for (int i = 0; i < 2; i++) { // two rings, one after the other
      float delay = i == 0 ? 0.0 : 0.18, grow = i == 0 ? 1.9 : 1.4, wd = i == 0 ? 3.5 : 2.0;
      float q = clamp((k - delay) / (1.0 - delay), 0.0, 1.0);
      if (q <= 0.0) continue;
      float w = wd * (1.0 - q) + 0.5, a = 0.9 * (1.0 - q) * cover(abs(L - r * (1.0 + q * grow)) - w * 0.5);
      acc = vec4(u_pring * a + acc.rgb * (1.0 - a), a + acc.a * (1.0 - a));
    }
    float ang = atan(d.y, d.x), sec = floor((ang - 0.3927) / 0.7853982 + 0.5), ac = sec * 0.7853982 + 0.3927; // eight spokes, short, flying out
    float along = L * cos(ang - ac), perp = abs(L * sin(ang - ac));
    float from = r * (1.15 + k * 1.1), to = from + r * 0.55 * fade;
    float sw = (3.0 * fade + 0.5) * 0.5;
    float a = 0.9 * fade * cover(perp - sw) * smoothstep(from - 0.5, from + 0.5, along) * (1.0 - smoothstep(to - 0.5, to + 0.5, along));
    acc = vec4(u_pring * a + acc.rgb * (1.0 - a), a + acc.a * (1.0 - a));
  }
  float rb = r * pop;
  float ball = cover(L - rb);
  vec3 bc = lit > 0.0 ? mix(u_pball, u_plit, lit) : u_pball;
  float ringIn = cover(abs(L - rb * 0.5) - 1.0) * 0.55 * ball;
  vec3 bcol = mix(bc, u_pdark, ringIn);
  acc = vec4(bcol * ball + acc.rgb * (1.0 - ball), ball + acc.a * (1.0 - ball));
  o = acc * alpha;
}`)],

  // the voice at the hit line: y, R, env, age | r, g, b, star power | seed. Calm, never a flash: a soft halo and a warm core that follow the pitch, a stretch of the hit line that
  // lights up, a ring that blooms outwards when a note starts, and a few embers that drift up and back from the hit. Gold for star power.
  glow: [VS('vec4(u_hitx - a0.y * 7.0, a0.x - a0.y * 4.2, u_hitx + a0.y * 3.2, a0.x + a0.y * 4.2)'), FS('',
    `void main() {
  float y = v_a0.x, R = v_a0.y, env = v_a0.z, age = v_a0.w;
  vec3 tone = v_a1.w > 0.5 ? GOLD : v_a1.rgb;
  float seed = v_a2.x;
  vec2 d = v_p - vec2(u_hitx, y);
  float r = length(d);
  float cut = 1.0 - smoothstep(R * 1.9, R * 4.0, r); // (everything fades out before the quad's edge: no straight sides)
  float halo = exp(-pow(r / (R * 2.7), 2.0)) * 0.34 * env * cut;
  float core = exp(-pow(r / (R * 0.9), 2.0)) * 0.62 * env;
  float line = exp(-d.x * d.x / 7.0) * exp(-pow(d.y / (R * 3.3), 2.0)) * 0.75 * env * (1.0 - smoothstep(R * 2.4, R * 4.1, abs(d.y)));
  float ra = clamp(age / 0.6, 0.0, 1.0), re = 1.0 - (1.0 - ra) * (1.0 - ra);
  float ringR = R * (0.7 + 3.0 * re), ringW = mix(3.2, 0.9, ra);
  float ring = (1.0 - ra) * (1.0 - smoothstep(0.0, 1.0, abs(r - ringR) / ringW)) * 0.8 * min(1.0, env * 3.0) * (1.0 - smoothstep(R * 3.2, R * 4.1, r));
  float em = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float h1 = fract(sin(fi * 12.9898 + seed * 3.7) * 43758.5453), h2 = fract(sin(fi * 78.233 + seed * 1.3) * 12345.678);
    float ph = fract(u_t * (0.3 + 0.22 * h1) + h2);
    vec2 pc = vec2(u_hitx - ph * R * (2.6 + 3.6 * h1), y - ph * R * (0.6 + 2.2 * h2) + sin(ph * 6.2832 * (1.0 + h1) + fi) * R * 0.25);
    float sz = R * (0.17 + 0.12 * h2) * (1.0 - 0.7 * ph);
    vec2 q = v_p - pc;
    em += exp(-dot(q, q) / (sz * sz)) * (1.0 - ph) * (1.0 - ph) * smoothstep(0.0, 0.12, ph);
  }
  em *= 0.8 * env;
  vec3 hot = mix(tone, vec3(1.0), 0.55);
  vec3 light = tone * (halo + ring) + hot * (core + line * 0.8 + em);
  o = vec4(light, clamp(max(light.r, max(light.g, light.b)) * 0.9, 0.0, 1.0));
}`)],
};

// ---- the drawing --------------------------------------------------------------------------------------------------------------------------------------------------------

export class GLVocals {
  constructor(gl) {
    this.gl = gl;
    this.progs = {};
    for (const [name, [vs, fs]] of Object.entries(PROGRAMS)) this.progs[name] = this.build(name, vs, fs);
  }

  build(name, vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`vocals ${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`vocals ${name}: ${gl.getProgramInfoLog(p)}`);
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [n, off] of [['a0', 0], ['a1', 16], ['a2', 32]]) {
      const loc = gl.getAttribLocation(p, n);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, STRIDE * 4, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return { p, u, vao, buf };
  }

  // One pass: the rows of `rec` as instanced quads with program `name`.
  pass(name, rec, setup) {
    if (rec.n === 0) return;
    const gl = this.gl, pr = this.progs[name];
    gl.useProgram(pr.p);
    gl.uniform2f(pr.u.u_size, this.w, this.h);
    gl.uniform1f(pr.u.u_hitx, this.hitX);
    gl.uniform1f(pr.u.u_t, this.t);
    setup?.(pr);
    gl.bindVertexArray(pr.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pr.buf);
    gl.bufferData(gl.ARRAY_BUFFER, rec.a.subarray(0, rec.n * STRIDE), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, rec.n);
  }

  // rect: { x, y, w, h } of the pane in CSS px; dpr: the board's canvas pixels per CSS px; H: the canvas height in pixels.
  draw(rect, frame, dpr, H) {
    const gl = this.gl;
    const px = Math.round(rect.x * dpr), pw = Math.max(1, Math.round((rect.x + rect.w) * dpr) - px), ph = Math.max(1, Math.round(rect.h * dpr));
    const py = H - Math.round((rect.y + rect.h) * dpr);
    gl.viewport(px, py, pw, ph);
    gl.scissor(px, py, pw, ph);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.w = rect.w; this.h = rect.h; this.hitX = frame.hitX; this.t = frame.t;
    this.pass('flat', frame.flat);
    for (let i = 0; i < frame.used; i++) {
      this.pass('ribbons', frame.groups[i].ribbons);
      this.pass('bars', frame.groups[i].bars);
    }
    const pc = frame.percColors;
    if (pc) this.pass('perc', frame.perc, (pr) => { for (const k of ['glow', 'ring', 'ball', 'lit', 'dark']) gl.uniform3fv(pr.u[`u_p${k}`], rgbOf(pc[k])); });
    this.pass('glow', frame.glows);
    gl.bindVertexArray(null);
  }
}
