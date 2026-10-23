// The rest of the stage visualizers on WebGL: the MIDI equalizer, the radial spectrum, the embers and the album art. Like those of visualizers-gl-stage.js they hear the music
// (`s.audio`): the bars follow the notes of each instrument (the MIDI spectrum of every layer goes to a texture, one row per instrument) and dance with the real spectrum on top;
// the record turns and its ring breathes with the kicks; the embers flare on the hits and twinkle with the highs; the cover's cloth ripples with the bass.
import { layerGain, layerColor, tint, spectrumAt } from './visualizers.js';
import { TAU, n255, HEAD, program } from './visualizers-gl-core.js';
import { MAX_LAYERS, fullScreenPort } from './visualizers-gl-common.js';

// ---- The MIDI spectrum of each instrument, as a texture ---------------------------------------------------------------------------------------------------------------

const EQ_ROWS = 2 * MAX_LAYERS; // rows 0..7: the level of each instrument's bars; rows 8..15: the peak caps (the highest level of the last 0.5 s)

// bins x 16 R8 texture on texture unit `unit`; update() fills it from the layers' events at the song time.
function eqTexture(gl, bins, unit) {
  const tex = gl.createTexture();
  const bytes = new Uint8Array(bins * EQ_ROWS);
  const now = new Float32Array(bins), past = new Float32Array(bins), peak = new Float32Array(bins);
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, bins, EQ_ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  return {
    // Returns the layers drawn (at least one: the whole song when the data has none).
    update(s, data, spread, peakSteps) {
      const layers = data.layers?.length ? data.layers : [{ kind: '', events: data.events, shown: true }];
      const L = Math.min(layers.length, MAX_LAYERS);
      bytes.fill(0);
      for (let li = 0; li < L; li++) {
        const { kind, events } = layers[li];
        const gain = layerGain(kind);
        const level = (v) => Math.min(1.3, 1 - Math.exp(-v * 1.1 * gain)); // the instruments' bars are exaggerated, the voice's are not
        spectrumAt(events, s.t, bins, now, spread);
        for (let k = 0; k < bins; k++) bytes[li * bins + k] = Math.round((level(now[k]) / 1.3) * 255);
        peak.fill(0);
        for (let q = 0; q <= peakSteps; q++) {
          spectrumAt(events, s.t - q * 0.1, bins, past, spread);
          for (let k = 0; k < bins; k++) peak[k] = Math.max(peak[k], level(past[k]) - q * 0.05);
        }
        for (let k = 0; k < bins; k++) bytes[(MAX_LAYERS + li) * bins + k] = Math.round((Math.max(0, peak[k]) / 1.3) * 255);
      }
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bins, EQ_ROWS, gl.RED, gl.UNSIGNED_BYTE, bytes);
      return { layers, L };
    },
  };
}

// The cover as a texture on unit `unit`, uploaded again when the song's cover changes. bind(data) -> true when there is a cover.
function coverTexture(gl, unit) {
  const tex = gl.createTexture();
  let current = null;
  return {
    bind(data) {
      const cv = data.coverCanvas;
      if (!cv) return false;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (current !== cv) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        gl.generateMipmap(gl.TEXTURE_2D);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        current = cv;
      }
      return true;
    },
  };
}

// What the equalizer and the radial spectrum share in the shader: the per-instrument uniforms and a lookup of the level / peak of a bar.
const EQ_DECL = `uniform sampler2D u_eq; uniform vec4 u_eqh[${MAX_LAYERS}]; uniform vec3 u_ecol[${MAX_LAYERS}]; uniform vec2 u_eqn;
float eqLevel(int li, float bin) { return texture(u_eq, vec2((bin + 0.5) / u_eqn.x, (float(li) + 0.5) / ${EQ_ROWS}.0)).r * 1.3; }
float eqPeak(int li, float bin) { return texture(u_eq, vec2((bin + 0.5) / u_eqn.x, (float(li + ${MAX_LAYERS}) + 0.5) / ${EQ_ROWS}.0)).r * 1.3; }
float eqIdle(float bin, int li) { return 0.04 + 0.03 * sin(bin * 0.45 + u_pos * 1.3 + float(li)); }`;

function setEq(gl, pr, common, info, w, h, s, heights) {
  const u = pr.u, hs = new Float32Array(MAX_LAYERS * 4), cols = new Float32Array(MAX_LAYERS * 3);
  for (let li = 0; li < info.L; li++) {
    hs.set([heights(li), common.shown[li], 0, 0], li * 4);
    cols.set(common.raw.subarray(li * 3, li * 3 + 3), li * 3);
  }
  gl.uniform4fv(u.u_eqh, hs); gl.uniform3fv(u.u_ecol, cols);
  gl.uniform1i(u.u_eq, 1);
}

// ---- The MIDI equalizer ---------------------------------------------------------------------------------------------------------------------------------------------

const EQ_BARS = 96;
const EQ_BODY = `void main() {
  vec2 p = v_p; float H = u_res.y, yb = H - p.y;
  float n = u_eqn.x; int L = int(u_eqn.y);
  float x = p.x / u_res.x * n, k = floor(x), fx = x - k;
  float inbar = smoothstep(0.1, 0.16, fx) * (1.0 - smoothstep(0.84, 0.9, fx));
  float au = spec((k + 0.5) / n) * clamp(u_au.x * 4.0, 0.0, 1.0); // the real spectrum under this bar (low to high, as the pitch axis)
  vec4 acc = vec4(0.0);
  for (int pass = 0; pass < 2; pass++) {
    for (int li = ${MAX_LAYERS - 1}; li >= 0; li--) {
      if (li >= L) continue;
      bool on = u_eqh[li].y > 0.5;
      if ((pass == 0) == on) continue; // the faint layers first (behind), then the lit ones; each from the tallest (back) to the shortest (front)
      vec3 col = u_ecol[li];
      float idle = eqIdle(k, li), maxH = u_eqh[li].x;
      float lvl = min(1.3, eqLevel(li, k) + idle);
      lvl = lvl * (0.82 + 0.45 * au) + 0.1 * au;
      float bh = lvl * maxH;
      if (!on) { over(acc, col, 0.15 * inbar * clamp(bh - yb + 0.5, 0.0, 1.0)); continue; }
      float top = clamp(yb / max(bh, 1.0), 0.0, 1.0);
      float fill = inbar * clamp(bh - yb + 0.5, 0.0, 1.0);
      over(acc, col, fill * mix(0.6, 0.5, 1.0 - top) * (L > 1 ? 1.0 : 0.95));
      float cap = inbar * clamp(1.0 - abs(yb - (bh - 2.0)) / 2.5 + 0.5, 0.0, 1.0);
      over(acc, mix(col, vec3(1.0), 0.72), cap * 0.95);
      float pk = (min(1.3, eqPeak(li, k) + idle) * (0.82 + 0.45 * au) + 0.1 * au) * maxH;
      if (pk > bh + 6.0) over(acc, mix(col, vec3(1.0), 0.72), inbar * clamp(1.0 - abs(yb - (pk - 1.5)) / 2.0 + 0.5, 0.0, 1.0) * 0.95);
    }
  }
  o = acc;
}`;

function equalizerPort(gl) {
  const eq = eqTexture(gl, EQ_BARS, 1);
  return fullScreenPort(gl, 'equalizer', EQ_BODY, {
    decl: EQ_DECL,
    extra(pr, s, data, w, h, sc, common) {
      const info = eq.update(s, data, Math.max(3, EQ_BARS / 14), 4);
      gl.uniform2f(pr.u.u_eqn, EQ_BARS, info.L);
      const L = info.L;
      setEq(gl, pr, common, info, w, h, s, (li) => h * (L === 1 ? 0.9 : 0.28 + 0.62 * (li / (L - 1))) * (1 + 0.045 * Math.cos((s.beat.pos + li * 0.25) * TAU)) * (1 + 0.06 * s.audio.kick)); // (the layer breathes once per beat; a kick lifts it)
      gl.activeTexture(gl.TEXTURE0);
    },
  });
}

// ---- The radial spectrum ---------------------------------------------------------------------------------------------------------------------------------------------

const RADIAL_BINS = 40;
const RADIAL_DECL = `${EQ_DECL}
uniform sampler2D u_cover; uniform vec4 u_rd; uniform vec2 u_rs;`;
const RADIAL_BODY = `void main() {
  vec2 p = v_p, c = u_rd.xy, d = p - c;
  float r = length(d), discR = u_rd.z, ringR = u_rd.w;
  float M = u_eqn.x; int L = int(u_eqn.y);
  float aT = atan(d.x, -d.y);
  float m = abs(aT) / 3.14159265 * M, k = min(floor(m), M - 1.0);
  float sa = sign(aT + 1e-6) * (k + 0.5) / M * 3.14159265;
  vec2 axis = vec2(sin(sa), -cos(sa));
  float along = dot(d, axis), perp = length(d - along * axis);
  vec2 dir = d / max(r, 1e-3);
  float room = max(min(u_res.x, u_res.y) * 0.05, min(c.x / max(abs(dir.x), 1e-4), c.y / max(abs(dir.y), 1e-4)) - ringR - 4.0);
  float bw = 6.28318531 * ringR / (2.0 * M) * 0.64;
  float au = spec((k + 0.5) / M) * clamp(u_au.x * 4.0, 0.0, 1.0);
  vec4 acc = vec4(0.0);
  for (int pass = 0; pass < 2; pass++) {
    for (int li = ${MAX_LAYERS - 1}; li >= 0; li--) {
      if (li >= L) continue;
      bool on = u_eqh[li].y > 0.5;
      if ((pass == 0) == on) continue;
      vec3 col = u_ecol[li];
      float frac_ = L == 1 ? 1.2 : 0.75 + 0.65 * float(li) / float(L - 1);
      float idle = 0.05 + 0.035 * sin(k * 0.5 + u_pos * 1.3 + float(li));
      float lvl = min(1.3, eqLevel(li, k) + idle);
      lvl = lvl * (0.82 + 0.45 * au) + 0.1 * au;
      float len = min(room, lvl * frac_ * room);
      float inb = clamp(bw * 0.5 - perp + 0.5, 0.0, 1.0) * step(ringR, along);
      float body = inb * clamp(ringR + len - along + 0.5, 0.0, 1.0);
      over(acc, col, body * (on ? (L > 1 ? 0.62 : 0.9) : 0.15));
      if (!on) continue;
      float tip = inb * clamp(1.0 - abs(along - (ringR + len - 2.0)) / 2.5 + 0.5, 0.0, 1.0);
      over(acc, mix(col, vec3(1.0), 0.72), tip * 0.95);
      float pk = min(room, (min(1.3, eqPeak(li, k) + idle) * (0.82 + 0.45 * au) + 0.1 * au) * frac_ * room);
      if (pk > len + 6.0) over(acc, mix(col, vec3(1.0), 0.72), inb * clamp(1.0 - abs(along - (ringR + pk - 1.5)) / 2.0 + 0.5, 0.0, 1.0) * 0.95);
    }
  }
  over(acc, mix(u_pal[3], vec3(1.0), 0.4), cov(abs(r - ringR + 3.0), 1.0) * (0.18 + 0.4 * u_kick.x));
  // the record: the cover (or a palette disc) turning with the tempo, grooves, a label
  if (r < discR + 2.0) {
    float cs = cos(u_rs.y), sn = sin(u_rs.y);
    vec2 q = mat2(cs, -sn, sn, cs) * d / (2.0 * discR) + 0.5;
    vec3 rec = u_rs.x > 0.5 ? texture(u_cover, q).rgb : mix(u_pal[0], u_pal[2], clamp(q.y, 0.0, 1.0)) * 0.9;
    rec *= 0.92 + 0.08 * sin(r * 0.9) + 0.05 * sin(r * 0.37 + 1.0);
    rec *= 1.0 - 0.35 * smoothstep(discR * 0.86, discR, r);
    float hole = 1.0 - smoothstep(discR * 0.045, discR * 0.05, r), label = 1.0 - smoothstep(discR * 0.2, discR * 0.21, r);
    rec = mix(rec, vec3(0.03), hole);
    rec = mix(rec, rec * 0.8 + u_pal[3] * 0.2, label * (1.0 - hole) * (u_rs.x > 0.5 ? 0.0 : 1.0));
    rec += vec3(1.0) * 0.1 * u_kick.x * (1.0 - smoothstep(0.0, discR, r));
    over(acc, rec, cov(r, discR));
  }
  o = acc;
}`;

function radialPort(gl) {
  const eq = eqTexture(gl, RADIAL_BINS, 1), cover = coverTexture(gl, 2);
  let spin = 0, lastClock = null;
  return fullScreenPort(gl, 'radial', RADIAL_BODY, {
    decl: RADIAL_DECL,
    extra(pr, s, data, w, h, sc, common) {
      const info = eq.update(s, data, Math.max(2.5, RADIAL_BINS / 14), 4);
      gl.uniform2f(pr.u.u_eqn, RADIAL_BINS, info.L);
      setEq(gl, pr, common, info, w, h, s, () => 1);
      const dt = lastClock === null ? 0 : Math.min(0.1, Math.max(0, s.clock - lastClock));
      lastClock = s.clock;
      spin += dt * 0; // (the record turns with the tempo: s.bt, below; the clock only keeps the pace of the kicks' push)
      const base = Math.min(w, h), discR = base * 0.2 * (1 + 0.02 * s.audio.kick);
      const ringR = discR * (1.14 + 0.012 * Math.cos(s.beat.pos * TAU)); // the ring breathes once per beat (the record keeps its size)
      gl.uniform4f(pr.u.u_rd, w / 2, h / 2, discR, ringR);
      const has = cover.bind(data);
      gl.uniform1i(pr.u.u_cover, 2);
      gl.uniform2f(pr.u.u_rs, has ? 1 : 0, s.bt * 0.05 * TAU * 0.25 + spin);
      gl.activeTexture(gl.TEXTURE0);
    },
  });
}

// ---- Embers ----------------------------------------------------------------------------------------------------------------------------------------------------------------------

const EMBERS = 300;
const EMBER_RATE_FULL = 24; // notes per second (all the instruments) at which every spark is lit
const EMBER_MIN = 0.05; // the share of sparks left in a silent part
const EMBER_VS = `${HEAD}uniform float u_phase, u_vis, u_hit, u_pulse, u_kick, u_tre, u_t; uniform vec4 u_col[${MAX_LAYERS}]; uniform int u_nc;
out vec2 v_q; out vec3 v_col; out float v_a;
float hh(float n, float s) { return fract(sin(n * 12.9898 + s * 78.233) * 43758.5453); }
void main() {
  float fi = float(gl_InstanceID);
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  float life = 5.0 + hh(fi, 3.0) * 6.0;
  float present = clamp(u_vis - fi, 0.0, 1.0); // (a spark fades in and out as the count rises and falls)
  float phase = fract(hh(fi, 1.0) + u_phase / life);
  float x = hh(fi, 2.0) * u_res.x + sin(phase * 6.2831853 * 1.5 + hh(fi, 4.0) * 20.0) * u_res.x * 0.02;
  float y = u_res.y * (1.05 - phase * 1.15);
  vec4 cc = u_col[gl_InstanceID % u_nc];
  float size = (10.0 + hh(fi, 5.0) * 28.0) * (1.0 - phase * 0.55) * (1.0 + u_hit * 0.35 + 0.55 * u_kick) * (0.8 + 0.35 * min(1.5, cc.a));
  float tw = 0.5 + 0.5 * sin(u_t * 5.0 + hh(fi, 6.0) * 30.0); tw *= tw;
  float tws = 1.0 + u_tre * 1.2 * (0.5 + 0.5 * sin(u_t * 17.0 + hh(fi, 8.0) * 60.0)); // the highs make them glint
  v_a = min(1.0, sin(phase * 3.14159265) * (0.5 + 0.5 * tw) * (0.55 + 0.45 * u_pulse + 0.25 * u_kick) * min(1.4, cc.a) * tws) * present;
  v_col = cc.rgb; v_q = c;
  vec2 px = vec2(x, y) + c * size;
  gl_Position = present > 0.0 ? vec4(px.x / u_res.x * 2.0 - 1.0, 1.0 - px.y / u_res.y * 2.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const EMBER_FS = `${HEAD}in vec2 v_q; in vec3 v_col; in float v_a; out vec4 o;
void main() {
  float d = length(v_q);
  float g = exp(-d * d * 3.2) * (1.0 - smoothstep(0.85, 1.0, d));
  o = vec4(mix(v_col, vec3(1.0), 0.35 * exp(-d * d * 14.0)) * g * v_a, g * v_a * 0.7);
}`;
const EMBER_GLOW = `void main() {
  float k = clamp((v_p.y - 0.4 * u_res.y) / (0.6 * u_res.y), 0.0, 1.0);
  float a = k * 0.35 * clamp(0.45 + 0.5 * u_dens + 0.3 * pow(1.0 - u_ph, 3.0) * u_dens + 0.3 * u_au.y, 0.0, 1.3);
  o = vec4(u_pal[3] * a, a);
}`;

// How many notes start in [a, b) (a sorted time array of `count` entries).
function countBetween(times, count, a, b) {
  const lb = (x) => { let lo = 0, hi = count; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < x) lo = m + 1; else hi = m; } return lo; };
  return lb(b) - lb(a);
}

function embersPort(gl) {
  let lit = 0, lastClock = null;
  const glow = fullScreenPort(gl, 'embers-glow', EMBER_GLOW);
  const pr = program(gl, 'embers', EMBER_VS, EMBER_FS);
  const cols = new Float32Array(MAX_LAYERS * 4);
  return {
    draw(s, data, w, h, sc) {
      glow.draw(s, data, w, h, sc);
      const p = data.palette, layers = data.layers ?? [];
      const n = layers.length ? Math.min(layers.length, MAX_LAYERS) : 4;
      for (let i = 0; i < n; i++) {
        const layer = layers[i];
        const c = layer ? n255(tint(layerColor(layer.kind, i, p), 0.35)) : n255(i === 0 ? p.va : i === 3 ? [255, 220, 150] : p.v[i - 1]);
        cols.set(c, i * 4);
        cols[i * 4 + 3] = 1;
      }
      gl.useProgram(pr.p);
      const u = pr.u;
      gl.uniform2f(u.u_res, w, h); gl.uniform1f(u.u_sc, sc);
      gl.uniform1f(u.u_phase, s.travel * 0.9 + s.bt * 0.5);
      const ev = data.events;
      const rate = ev ? countBetween(ev.times, ev.count, s.t - 1, s.t + 1) / 2 : s.density * EMBER_RATE_FULL; // the notes of the last and the next second: the sparks follow the music's activity
      const want = EMBERS * (EMBER_MIN + (1 - EMBER_MIN) * Math.min(1, rate / EMBER_RATE_FULL));
      const dt = lastClock === null ? 1 : Math.min(0.2, Math.max(0, s.clock - lastClock));
      lastClock = s.clock;
      lit += (want - lit) * (1 - Math.exp(-dt * 2.5)); // (rises and falls over about half a second)
      gl.uniform1f(u.u_vis, lit);
      gl.uniform1f(u.u_hit, s.hit); gl.uniform1f(u.u_pulse, Math.pow(1 - s.beat.phase, 3)); gl.uniform1f(u.u_kick, s.audio.kick); gl.uniform1f(u.u_tre, s.audio.treble); gl.uniform1f(u.u_t, s.t);
      gl.uniform4fv(u.u_col, cols); gl.uniform1i(u.u_nc, n);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, EMBERS);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    },
  };
}

// ---- Album art ----------------------------------------------------------------------------------------------------------------------------------------------------------

const COVER_DECL = 'uniform sampler2D u_cover; uniform vec4 u_cv; uniform vec2 u_cv2;';
const COVER_BODY = `void main() {
  vec2 p = v_p;
  if (u_cv2.x < 0.5) { float k = (p.x + p.y) / (u_res.x + u_res.y); o = vec4(mix(u_pal[0], u_pal[2], k) * 0.6, 0.6); return; }
  float size = u_cv.z, amp = u_cv.w, rip = size * 0.003;
  vec2 ctr = u_cv.xy;
  float u0 = (p.x - (ctr.x - size * 0.5)) / size;
  float rx0 = sin(u0 * TAU * 1.3 - u_pos * 0.7 + 0.6);
  float u = (p.x - (ctr.x - size * 0.5) - rx0 * rip) / size;
  float p1 = u * TAU * 0.85 - u_pos * 0.8, p2 = u * TAU * 1.9 - u_pos * 1.35 - u_t * 0.2 + 1.7;
  float dy = 0.65 * sin(p1) + 0.35 * sin(p2);
  float slope = (0.65 * cos(p1) * 0.85 + 0.35 * cos(p2) * 1.9) / (0.65 * 0.85 + 0.35 * 1.9);
  float sy = 1.0 + 0.008 * sin(p2 + 1.0);
  float v = (p.y - ctr.y - dy * amp) / (size * sy) + 0.5;
  vec3 col = texture(u_cover, vec2(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0))).rgb;
  col += vec3(max(slope, 0.0) * 0.16);
  col *= 1.0 - max(-slope, 0.0) * 0.2;
  o = vec4(col, 1.0);
}`;

const PAN_FREQ_X = [0.025, 0.057, 0.094], PAN_FREQ_Y = [0.02, 0.047, 0.08], PAN_REACH = 0.6; // (a quarter of the old speed and 60 % of its reach: the picture drifts very slowly)
const wander = (t, f, ph) => 0.55 * Math.sin(t * f[0] + ph[0]) + 0.3 * Math.sin(t * f[1] + ph[1]) + 0.15 * Math.sin(t * f[2] + ph[2]); // -1..1: the camera's slow, never repeating drift

function coverPort(gl) {
  const cover = coverTexture(gl, 1);
  return fullScreenPort(gl, 'cover', COVER_BODY, {
    decl: COVER_DECL,
    extra(pr, s, data, w, h) {
      const has = cover.bind(data);
      gl.uniform1i(pr.u.u_cover, 1);
      gl.uniform2f(pr.u.u_cv2, has ? 1 : 0, 0);
      const size = Math.max(w, h) * 1.2; // the picture is always 20 % larger than the screen (its larger side): room to pan over it
      const amp = h * 0.02 * (0.85 + 0.3 * s.density);
      const room = (view) => Math.max(view * 0.03, (size - view) / 2 - amp * 1.5);
      const cx = w / 2 + wander(s.bt, PAN_FREQ_X, [0.6, 2.1, 4.4]) * room(w) * PAN_REACH, cy = h / 2 + wander(s.bt, PAN_FREQ_Y, [2.2, 0.4, 3.3]) * room(h) * PAN_REACH;
      gl.uniform4f(pr.u.u_cv, cx, cy, size, amp);
      gl.activeTexture(gl.TEXTURE0);
    },
  });
}

export const STAGE2_PORTS = { equalizer: equalizerPort, radial: radialPort, embers: embersPort, cover: coverPort };
