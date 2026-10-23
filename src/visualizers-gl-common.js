// What every stage shader shares: the numbers it reads (the beat, the density, star power, the palette, the instruments' colours and energies, and what the speakers play: s.audio of
// src/audio-features.js, with its spectrum as a 1D texture `spec(x)`), the full-screen port builder and the helpers. Used by visualizers-gl-stage.js and visualizers-gl-stage2.js.
import { melodyAt, layerGain, layerColor, tint } from './visualizers.js';
import { mixRgb, n255, FS_HEAD, VS_FULL, program } from './visualizers-gl-core.js';
import { BANDS } from './audio-features.js';

export const MAX_LAYERS = 8;

// The numbers every stage shader reads. `u_lay[i]` = the instrument's light colour and its energy; `u_shown[i]` 1 when it is on screen.
export const STAGE_FS = `${FS_HEAD}
uniform float u_bt, u_dens, u_sp, u_hit, u_ph, u_mph, u_pos, u_vocal, u_travel, u_t, u_run;
uniform vec3 u_pal[4]; uniform vec4 u_lay[${MAX_LAYERS}]; uniform float u_shown[${MAX_LAYERS}]; uniform int u_nl;
uniform vec4 u_au; uniform vec2 u_kick; uniform sampler2D u_spec;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
float spec(float x) { return texture(u_spec, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
vec3 palAt(float k) { k = fract(k) * 3.0; int i = int(floor(k)); float f = fract(k); vec3 a = u_pal[i % 3], b = u_pal[(i + 1) % 3]; return mix(a, b, f * f * (3.0 - 2.0 * f)); } // (the palette as a closed ramp)
vec3 layerCol(int i) { return u_lay[i % u_nl].rgb; }
float layerEn(int i) { return u_lay[i % u_nl].a; }
float beatPulse() { return pow(1.0 - u_ph, 3.0); }
float maxc(vec3 c) { return max(c.r, max(c.g, c.b)); }
void addLight(inout vec4 acc, vec3 c, float a) { acc.rgb = min(acc.rgb + c * a, vec3(1.0)); acc.a = clamp(max(acc.a, maxc(c) * a), 0.0, 1.0); } // (an additive light: 'lighter' of the 2D code)
`;

// A calm view of the sound for the visualizers that must not flash: the level, bass, mid and treble low-passed over about `tau` seconds (so they follow the loudness of a passage,
// never a single hit) and no kick / flux at all. read(audio, clock) -> the same shape as `s.audio`.
export function createCalmAudio(tau = 0.8) {
  const o = { on: false, level: 0, bass: 0, mid: 0, treble: 0, kick: 0, flux: 0, bands: new Float32Array(BANDS) }; // (the bands are low-passed too, over a quarter of tau: no spiky spectrum)
  let last = null;
  return {
    read(a, clock) {
      const dt = last === null ? 1 : Math.min(0.25, Math.max(0, clock - last));
      last = clock;
      const k = 1 - Math.exp(-dt / tau);
      o.on = a.on;
      const kb = 1 - Math.exp(-dt / (tau * 0.3));
      for (let i = 0; i < BANDS; i++) o.bands[i] += (a.bands[i] - o.bands[i]) * kb;
      o.level += (a.level - o.level) * k; o.bass += (a.bass - o.bass) * k; o.mid += (a.mid - o.mid) * k; o.treble += (a.treble - o.treble) * k;
      return o;
    },
  };
}

// The shared uniforms and the spectrum texture of one port (one WebGL context, one program at a time).
export function stageCommon(gl, { calm = false } = {}) {
  const calmAudio = calm ? createCalmAudio() : null;
  const mel = Array.from({ length: MAX_LAYERS }, () => ({ pitch: 0.5, energy: 0 }));
  const pal = new Float32Array(12), lay = new Float32Array(MAX_LAYERS * 4), shown = new Float32Array(MAX_LAYERS), raw = new Float32Array(MAX_LAYERS * 3), au = new Float32Array(4);
  const bytes = new Uint8Array(BANDS);
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, BANDS, 1, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return {
    layers: 1,
    raw, shown, // (the instruments' own colours, 0..1 rgb per layer, and whether each is on screen: for the ports that draw per instrument)
    // Sets the shared uniforms on the current program `pr` and binds the spectrum texture on unit 0.
    set(pr, s, data, w, h, sc) {
      const u = pr.u, p = data.palette, layers = data.layers ?? [];
      [p.v[0], p.v[1], p.v[2], p.va].forEach((c, i) => pal.set(n255(c), i * 3));
      const L = Math.max(1, Math.min(layers.length, MAX_LAYERS));
      this.layers = L;
      for (let i = 0; i < L; i++) {
        const layer = layers[i];
        const m = layer ? melodyAt(layer.events, s.t, layerGain(layer.kind), mel[i]) : mel[i];
        const base = layer ? layerColor(layer.kind, i, p) : p.v[i % p.v.length];
        raw.set(n255(base), i * 3);
        shown[i] = layer && layer.shown === false ? 0 : 1;
        lay.set([...n255(mixRgb(tint(base, 0.1), [255, 200, 120], 0.15 * s.sp)), layer && layer.shown === false ? 0.15 * m.energy : layer ? m.energy : 0.3 + 0.5 * s.density], i * 4);
      }
      const a = calmAudio ? calmAudio.read(s.audio, s.clock) : s.audio;
      for (let i = 0; i < BANDS; i++) bytes[i] = Math.min(255, Math.round(a.bands[i] * 255));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BANDS, 1, gl.RED, gl.UNSIGNED_BYTE, bytes);
      gl.useProgram(pr.p);
      gl.uniform1i(u.u_spec, 0);
      gl.uniform2f(u.u_res, w, h); gl.uniform1f(u.u_sc, sc);
      gl.uniform1f(u.u_bt, s.bt); gl.uniform1f(u.u_dens, s.density); gl.uniform1f(u.u_sp, s.sp); gl.uniform1f(u.u_hit, s.hit);
      gl.uniform1f(u.u_ph, s.beat.phase); gl.uniform1f(u.u_mph, s.beat.measurePhase); gl.uniform1f(u.u_pos, s.beat.pos);
      gl.uniform1f(u.u_vocal, s.vocal); gl.uniform1f(u.u_travel, s.travel); gl.uniform1f(u.u_t, s.t);
      gl.uniform3fv(u.u_pal, pal); gl.uniform4fv(u.u_lay, lay); gl.uniform1fv(u.u_shown, shown); gl.uniform1i(u.u_nl, L);
      au[0] = a.level; au[1] = a.bass; au[2] = a.mid; au[3] = a.treble;
      gl.uniform4fv(u.u_au, au); gl.uniform2f(u.u_kick, a.kick, a.flux);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    },
  };
}

// A port made of one full-screen shader: `body` is its main(); `extra(pr, s, data, w, h, sc, common)` sets the uniforms of its own before the draw.
export function fullScreenPort(gl, id, body, { decl = '', extra = null, calm = false } = {}) {
  const pr = program(gl, id, VS_FULL, `${STAGE_FS}${decl}\n${body}`);
  const common = stageCommon(gl, { calm });
  return {
    draw(s, data, w, h, sc) {
      common.set(pr, s, data, w, h, sc);
      extra?.(pr, s, data, w, h, sc, common);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
