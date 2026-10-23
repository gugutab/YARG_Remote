// The WebGL visualizers of the stage that listen to the music: Lava lamp, Kaleidoscope, Smoke, Galaxy, Synthwave, Spotlights, Tunnel (and, in visualizers-gl-stage2.js, the equalizer,
// the radial spectrum, the embers and the album art). Each is a full-screen fragment shader fed by one shared set of numbers (`stageCommon`): the motion clock (`s.bt`, the beat
// count, faster in a fast part), the beat's phase, the density, star power, the hit level, the cover's palette, the colour and energy of each instrument (the melody of each:
// melodyAt) and what the speakers play now: `s.audio` (src/audio-features.js: the level, the bass / mid / treble, the kick and flux pulses and a 48-band spectrum that goes to the
// shader as a 1D texture, `spec(x)`). With no sound (paused, a prototype) the audio numbers are 0 and every visualizer keeps moving with the chart alone. Units: the stage's CSS px,
// y down (see visualizers-gl-core.js).
import { melodyAt, layerGain, layerColor, tint, beamAngle, sectionValue } from './visualizers.js';
import { clamp, mixRgb, n255 } from './visualizers-gl-core.js';
import { MAX_LAYERS, fullScreenPort } from './visualizers-gl-common.js';

// The visualizers that must never flash (no kick, no beat pulse, no hit flash; the sound only moves them slowly): their ports are made with { calm: true }.
const CALM = { calm: true };

const BODIES = {
  // metaballs drifting in the palette's colours; each instrument's blob swells with its melody, every blob with the beat and the bass, and quivers with its own slice of the spectrum
  lava: `void main() {
  vec2 uv = (v_p - 0.5 * u_res) / min(u_res.x, u_res.y);
  float field = 0.0; vec3 col = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 pos = vec2(sin(u_bt * (0.16 + 0.021 * fi) + fi * 2.1) * 0.62, cos(u_bt * (0.12 + 0.017 * fi) + fi * 1.3 + sin(u_bt * 0.05 + fi)) * 0.38);
    float en = layerEn(i), sa = spec(fi / 9.0);
    float r = 0.085 + 0.05 * sin(u_bt * 0.3 + fi) + 0.11 * en + 0.03 * u_sp + 0.07 * u_au.y + 0.05 * sa;
    vec2 d = uv - pos; float f = r * r / max(dot(d, d), 1e-4);
    vec3 c = (i % 3 == 0) ? layerCol(i) : palAt(fi * 0.21 + u_bt * 0.01);
    field += f; col += f * c;
  }
  col /= max(field, 1e-3);
  float iso = smoothstep(0.97, 1.03, field), rim = smoothstep(0.55, 0.97, field) * (1.0 - iso) * 0.6;
  vec3 body = col * (0.85 + 0.55 * smoothstep(1.0, 3.0, field)) + 0.12 * pow(smoothstep(1.0, 1.6, field), 2.0);
  float a = iso * 0.88 + rim * 0.3;
  o = vec4(mix(col, body, iso) * a, a);
}`,
  // a mirrored wedge of warped noise in the palette, turning with the tempo and breathing with the beat; the spectrum stands up in it as bars that the folds repeat all round
  kaleido: `void main() {
  vec2 uv = (v_p - 0.5 * u_res) / min(u_res.x, u_res.y);
  float r = length(uv), a = atan(uv.y, uv.x);
  float n = 6.0 + floor(u_dens * 4.0) * 2.0;
  float seg = TAU / n;
  a = mod(a + u_bt * 0.04, seg); a = abs(a - 0.5 * seg);
  vec2 p = r * vec2(cos(a), sin(a)) * 3.2 + vec2(u_bt * 0.12, 0.0);
  float w = fbm(p + 1.6 * fbm(p * 1.7 + u_bt * 0.08));
  float rid = pow(1.0 - abs(2.0 * w - 1.0), 2.2);
  vec3 col = palAt(w * 1.3 + r * 0.5 + u_mph * 0.4 + u_bt * 0.01);
  col = col * (0.45 + 1.1 * rid) + vec3(1.0) * 0.18 * pow(rid, 4.0);
  float pulse = 0.9 + 0.3 * u_sp + 0.2 * u_au.w;
  float vig = smoothstep(1.3, 0.1, r);
  float a2 = clamp((0.45 + 0.55 * rid) * vig, 0.0, 0.95);
  vec4 acc = vec4(col * pulse * a2, a2);
  float af = a / (0.5 * seg); // 0..1 across the half fold: the spectrum, low to high
  float bh = 0.1 + 0.34 * spec(af) * 1.2;
  float bar = smoothstep(0.012, 0.0, abs(r - bh)) * step(0.1, bh) * 0.7 + smoothstep(0.0, 0.01, bh - r) * smoothstep(0.08, 0.1, r) * 0.22;
  bar *= clamp(u_au.x * 3.0, 0.0, 1.0);
  over(acc, mix(palAt(af * 0.6 + 0.2), vec3(1.0), 0.35), clamp(bar, 0.0, 0.9));
  o = acc;
}`,
  // flowing smoke: noise warped by noise, in the palette with a tint of the instruments that play; the bass pushes the warp, a kick lights it, star power too
  smoke: `void main() {
  vec2 uv = v_p / u_res * vec2(u_res.x / u_res.y, 1.0) * 2.2;
  float t = u_bt * 0.06;
  float wv = 4.0 + 2.2 * u_au.y;
  vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(5.2, 1.3) + t * 1.1));
  vec2 r = vec2(fbm(uv + wv * q + vec2(1.7, 9.2) + t * 1.3), fbm(uv + wv * q + vec2(8.3, 2.8) + t * 1.2));
  float f = fbm(uv + wv * r);
  vec3 col = mix(u_pal[0], u_pal[1], clamp(f * f * 4.0, 0.0, 1.0));
  col = mix(col, u_pal[2], clamp(length(q) * 0.9, 0.0, 1.0));
  vec3 tint = vec3(0.0); float tw = 0.0;
  for (int i = 0; i < ${MAX_LAYERS}; i++) { if (i >= u_nl) break; tint += u_lay[i].rgb * u_lay[i].a; tw += u_lay[i].a; }
  col = mix(col, tint / max(tw, 1e-3), clamp(0.12 + 0.5 * tw / float(max(u_nl, 1)), 0.0, 0.55));
  col *= 0.8 + 0.5 * f + 0.35 * u_sp + 0.25 * u_au.w * f;
  float a = clamp(0.2 + 0.55 * f + 0.15 * u_dens + 0.12 * u_au.x, 0.0, 0.88);
  o = vec4(col * a, a);
}`,
  // a spiral galaxy turning with the music: arms of the palette, a core that flares on the bass and the kicks, a field of stars that twinkle with the highs, a halo of spectrum ticks round it
  galaxy: `void main() {
  vec2 uv = (v_p - 0.5 * u_res) / min(u_res.x, u_res.y);
  float r = length(uv), a = atan(uv.y, uv.x);
  float spin = u_bt * 0.05;
  float arm = 0.5 + 0.5 * sin(2.0 * (a - 2.2 * log(r + 0.03) * 1.6 + spin * 6.2831853));
  float dust = fbm(vec2(cos(a + spin * 3.0), sin(a + spin * 3.0)) * 2.2 + r * 3.0);
  float disc = pow(arm, 2.5 + 2.0 * (1.0 - u_dens)) * exp(-r * 2.4) * (0.55 + 0.9 * dust) * (0.85 + 0.45 * u_au.x);
  vec3 armCol = palAt(r * 1.4 + 0.1 + 0.2 * dust);
  float core = exp(-r * r * 22.0) * (0.6 + 0.4 * u_sp + 0.6 * u_au.y);
  vec3 col = armCol * disc * 1.6 + u_pal[3] * core * 1.4;
  vec2 sp = uv * 36.0 + vec2(cos(spin), sin(spin)) * 3.0; vec2 cid = floor(sp);
  float star = step(0.985, h21(cid)) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5)) * (0.75 + (0.15 + 0.25 * u_au.w) * sin(u_bt * 0.5 + h21(cid + 3.0) * 50.0));
  vec3 starCol = mix(vec3(1.0), palAt(h21(cid + 9.0)), 0.4);
  col += starCol * star * 0.9;
  float ang01 = abs(fract(a / TAU + 0.5) * 2.0 - 1.0); // 0..1 round the halo, mirrored: the spectrum
  float tick = spec(ang01), r0 = 0.4;
  float halo = smoothstep(0.004, 0.0, abs(r - r0)) * 0.1 + smoothstep(0.0, 0.006, r - r0) * smoothstep(r0 + 0.02 + tick * 0.14, r0, r) * 0.22 * smoothstep(0.012, 0.06, tick);
  col += mix(palAt(ang01), vec3(1.0), 0.3) * halo * clamp(u_au.x * 3.0, 0.0, 1.0);
  float al = clamp(maxc(col) * 0.9, 0.0, 0.92);
  o = vec4(min(col, vec3(al)), al);
}`,
  // the sunset of the synthwave: a sky, a striped sun that pulses with the bar and the kicks, a skyline that is the spectrum, a grid rolling towards you one cell every two beats
  synthwave: `void main() {
  vec2 p = v_p; float W = u_res.x, H = u_res.y;
  float hor = floor(H * 0.55), cx = W * 0.5;
  vec3 c0 = u_pal[0], c1 = u_pal[3];
  float mp = pow(1.0 - u_mph, 4.0);
  vec4 acc = vec4(0.0);
  if (p.y < hor) { float k = p.y / hor; over(acc, mix(c0, c1, k), mix(0.1, 0.5, k) + 0.1 * u_au.x); }
  float baseR = min(W, H) * 0.2;
  float R = baseR; // (the sun keeps its size: no pulse)
  vec2 sc = vec2(cx, hor - R * 0.5);
  float dist = length(p - sc);
  float v = (p.y - (sc.y - R)) / (2.0 * R);
  vec3 sunTop = vec3(1.0, 0.886, 0.47), sunMid = mix(vec3(1.0, 0.47, 0.35), c1, 0.4), sunBot = mix(vec3(0.9, 0.235, 0.59), c0, 0.4);
  vec3 sunCol = v < 0.55 ? mix(sunTop, sunMid, clamp(v / 0.55, 0.0, 1.0)) : mix(sunMid, sunBot, clamp((v - 0.55) / 0.45, 0.0, 1.0));
  float s = (v - 0.5) * 2.0;
  float crawl = fract(u_pos / 8.0);
  float grow = smoothstep(0.0, 1.0, clamp(s / 0.2, 0.0, 1.0));
  float ph = fract(s * 8.0 - crawl), wd = 16.0 * (0.045 + 0.07 * max(s, 0.0)) * grow, fw = max(fwidth(s * 8.0), 1e-4);
  float cut = s > 0.0 ? 1.0 - smoothstep(wd - fw, wd + fw, ph) : 0.0;
  over(acc, sunCol, cov(dist, R) * (1.0 - cut));
  if (p.y < hor) addLight(acc, c1, (1.0 - smoothstep(R * 0.6, R * 2.2, dist)) * (0.26 + 0.2 * u_sp));
  float x01 = p.x / W;
  float rid = 0.012 + 0.02 * vn(vec2(x01 * 9.0, 1.0)) + 0.17 * spec(abs(x01 - 0.5) * 2.0) * clamp(u_au.x * 4.0, 0.0, 1.0);
  float top = hor - rid * H;
  if (p.y <= hor + 1.0) {
    over(acc, vec3(0.03, 0.01, 0.1), smoothstep(top - 1.0, top + 1.0, p.y) * 0.95);
    over(acc, c1, exp(-abs(p.y - top) * 0.3) * 0.45 * step(top, p.y + 3.0) * (0.5 + 0.8 * u_au.x));
  }
  if (p.y >= hor) {
    over(acc, vec3(8.0, 4.0, 24.0) / 255.0, 0.55);
    float z = (p.y - hor) / (H - hor);
    float lineA = 0.5 + 0.3 * u_kick.x + 0.2 * u_sp + 0.25 * u_au.w;
    float i = (p.x - cx) / (W * (0.012 + 0.128 * z)), wi = max(fwidth(i), 1e-4);
    float lx = clamp(1.25 - abs(fract(i + 0.5) - 0.5) / wi, 0.0, 1.0);
    float rr = 12.0 * pow(max(z, 1e-4), 1.0 / 3.0) + fract(u_pos / 2.0), wr = max(fwidth(rr), 1e-4);
    float ly = clamp(1.25 - abs(fract(rr + 0.5) - 0.5) / wr, 0.0, 1.0) * smoothstep(0.0, 0.04, z);
    over(acc, c1, 0.55 * lineA * max(lx * smoothstep(0.0, 0.03, z), ly));
    over(acc, c0, 0.4 * lineA * cov(p.y - hor, 2.0));
  }
  o = acc;
}`,
};

// ---- Stage lights --------------------------------------------------------------------------------------------------------------------------------------------------

const MAX_BEAMS = 10;
const SPOT_DECL = `uniform vec4 u_beam[${MAX_BEAMS}]; uniform vec3 u_bcol[${MAX_BEAMS}]; uniform int u_nb; uniform vec4 u_sl;`;
const SPOT_BODY = `void main() {
  vec2 p = v_p; float W = u_res.x, H = u_res.y;
  float drive = u_sl.x, len = u_sl.y, pr = u_sl.z;
  vec4 acc = vec4(0.0);
  float k = p.y / H;
  over(acc, u_pal[2], mix(0.14, 0.04, smoothstep(0.0, 0.6, k)) * (1.0 - smoothstep(0.6, 1.0, k)) + smoothstep(0.6, 1.0, k) * 0.12 * 0.0);
  over(acc, u_pal[3], smoothstep(0.6, 1.0, k) * 0.12);
  vec3 light = vec3(0.0);
  for (int i = 0; i < ${MAX_BEAMS}; i++) {
    if (i >= u_nb) break;
    vec4 b = u_beam[i]; vec3 col = u_bcol[i];
    float ang = b.y, half_ = b.z, power = b.w;
    vec2 origin = vec2(b.x, -4.0), v = p - origin, dir = vec2(sin(ang), cos(ang));
    float along = dot(v, dir), perp = v.x * dir.y - v.y * dir.x;
    float off = atan(abs(perp), max(along, 1.0));
    float cone = pow(clamp(1.0 - off / (2.0 * half_), 0.0, 1.0), 1.25) * step(0.0, along) * pow(1.0 - smoothstep(0.0, len, along), 1.1);
    light += col * cone * drive * power * 0.5;
    vec2 hit = vec2(b.x + tan(ang) * H, 0.97 * H);
    float ell = length((p - hit) / vec2(pr, pr * 0.16));
    light += col * (1.0 - smoothstep(0.0, 1.0, ell)) * 0.5 * drive * power * 0.8;
    light += col * (1.0 - smoothstep(0.0, 26.0, length(p - origin))) * power;
  }
  acc.a = clamp(acc.a + maxc(light) * (1.0 - acc.a), 0.0, 1.0);
  acc.rgb = min(acc.rgb + light, vec3(acc.a));
  o = acc;
}`;

// ---- Tunnel ------------------------------------------------------------------------------------------------------------------------------------------------------------

const TUNNEL_RINGS = 14;
const TUNNEL_DECL = 'uniform vec4 u_tn; uniform vec4 u_tw;';
const TUNNEL_BODY = `float hs(float id, float salt) { return h21(vec2(id * 1.37 + salt, salt * 3.1 + 0.5)); }
void main() {
  vec2 p = v_p; vec2 c = u_tn.xy; float R = u_tn.z, unit = u_tn.w;
  float twist = u_tw.x, spreadK = u_tw.y, run = u_tw.z, drift = u_tw.w;
  vec4 acc = vec4(0.0);
  vec3 warm = vec3(1.0, 0.745, 0.353), grey = vec3(150.0, 150.0, 170.0) / 255.0;
  vec2 d = p - c; float dl = length(d);
  for (int i = 0; i < ${TUNNEL_RINGS}; i++) {
    float q = run + float(i) / ${TUNNEL_RINGS}.0, z = fract(q), id = floor(q) * ${TUNNEL_RINGS}.0 + float(i);
    float fade = pow(sin(3.14159265 * min(1.0, z * 1.1)), 0.9);
    if (fade < 0.01) continue;
    float r = R * pow(z, spreadK) * 0.8 + 3.0;
    float rot = u_pos * 0.006 + z * twist + hs(id, 5.0) * TAU;
    float wheel = mod(id * 0.37 + drift, 4.0);
    int w0 = int(floor(wheel)) % 4;
    vec3 col = mix(mix(mix(u_pal[w0 % 3], u_pal[(w0 + 1) % 3], fract(wheel)), grey, 0.3), warm, 0.5 * u_sp);
    float sides = 4.0 + floor(hs(id, 7.0) * 5.0), rnd = 0.12 + 0.2 * hs(id, 9.0);
    vec2 q2 = mat2(cos(-rot), -sin(-rot), sin(-rot), cos(-rot)) * d;
    float an = TAU / sides, bn = mod(atan(q2.y, q2.x) + 0.5 * an, an) - 0.5 * an;
    float dpoly = dl * cos(bn) - r * cos(0.5 * an), dcirc = dl - r;
    float dist = abs(mix(dpoly, dcirc, clamp(rnd * 1.2, 0.0, 1.0)));
    float zz = pow(z, 1.5);
    float lw1 = (4.0 + 16.0 * zz) * unit * (1.0 + 0.5 * u_au.y), lw2 = (1.2 + 4.5 * zz) * unit * (1.0 + 0.4 * u_kick.x);
    float boost = 1.0 + 0.6 * u_kick.x + 0.25 * u_au.w;
    over(acc, col, 0.2 * fade * boost * cov(dist, lw1 * 0.5));
    over(acc, col, 0.6 * fade * boost * cov(dist, lw2 * 0.5));
  }
  float m = min(u_res.x, u_res.y);
  over(acc, mix(u_pal[3], warm, 0.5 * u_sp), (0.12 + 0.12 * u_dens + 0.18 * u_au.y) * (1.0 - smoothstep(0.0, m * 0.3, dl)));
  o = acc;
}`;

function spotlightsPort(gl) {
  const beam = new Float32Array(MAX_BEAMS * 4), bcol = new Float32Array(MAX_BEAMS * 3), mel = { pitch: 0.5, energy: 0 };
  return fullScreenPort(gl, 'spotlights', SPOT_BODY, {
    decl: SPOT_DECL,
    extra(pr, s, data, w, h) {
      const pal = data.palette, layers = data.layers ?? [];
      const n = Math.min(MAX_BEAMS, Math.max(w > 1100 ? 8 : 6, layers.length)); // more beams than instruments: an instrument lights every few beams across the stage
      const len = Math.hypot(w * 0.35, h) * 1.2;
      const drive = clamp(0.8 + 0.3 * s.density + 0.25 * s.vocal + 0.15 * s.sp, 0, 1.2); // (no flash on the kicks: it was in the way)
      const warmK = s.sp * 0.65;
      for (let i = 0; i < n; i++) {
        const layer = layers.length ? layers[i % layers.length] : undefined;
        const ang = beamAngle(i, n, s.beat.pos) * (1.35 + 0.35 * s.sp);
        const base = layer ? layerColor(layer.kind, i, pal) : pal.v[i % 4];
        const col = mixRgb(layer ? tint(base, 0.3) : base, [255, 190, 90], warmK);
        const power = layer ? (layer.shown !== false ? 0.55 + 0.45 * melodyAt(layer.events, s.t, layerGain(layer.kind), mel).energy : 0.2) : 1;
        const half = (0.17 + 0.03 * s.vocal + 0.03 * s.density + 0.03 * s.audio.bass) * (0.8 + 0.4 * power);
        beam.set([(w * (i + 0.5)) / n, ang, half, power], i * 4);
        bcol.set(n255(col), i * 3);
      }
      gl.uniform4fv(pr.u.u_beam, beam); gl.uniform3fv(pr.u.u_bcol, bcol); gl.uniform1i(pr.u.u_nb, n);
      gl.uniform4f(pr.u.u_sl, drive, len, h * (0.34 + 0.06 * s.vocal), 0);
    },
  });
}

function tunnelPort(gl) {
  let phase = 0, lastClock = null;
  return fullScreenPort(gl, 'tunnel', TUNNEL_BODY, {
    decl: TUNNEL_DECL,
    extra(pr, s, data, w, h) {
      const dt = lastClock === null ? 0 : Math.min(0.1, Math.max(0, s.clock - lastClock));
      lastClock = s.clock;
      phase += dt * (0.02 * s.audio.bass + 0.05 * s.audio.kick); // the bass and the kicks push the rings a little faster
      const cx = w / 2 + Math.sin(s.beat.pos * 0.03) * w * 0.025, cy = h / 2 + Math.cos(s.beat.pos * 0.022) * h * 0.025;
      const R = Math.hypot(w, h) * 0.62;
      const sec = data.sections ?? [];
      const twist = sectionValue(sec, s.t, s.section, (k) => 0.3 + ((k * 7) % 5) * 0.12, 3);
      const spread = sectionValue(sec, s.t, s.section, (k) => 1.7 + ((k * 3) % 4) * 0.2, 3);
      gl.uniform4f(pr.u.u_tn, cx, cy, R, Math.min(w, h) / 900);
      gl.uniform4f(pr.u.u_tw, twist, spread, s.beat.pos * 0.035 + s.travel * 0.08 + phase, s.t / 45);
    },
  });
}

export const STAGE_PORTS = {
  lava: (gl) => fullScreenPort(gl, 'lava', BODIES.lava, CALM),
  kaleido: (gl) => fullScreenPort(gl, 'kaleido', BODIES.kaleido, CALM),
  smoke: (gl) => fullScreenPort(gl, 'smoke', BODIES.smoke, CALM),
  galaxy: (gl) => fullScreenPort(gl, 'galaxy', BODIES.galaxy, CALM),
  synthwave: (gl) => fullScreenPort(gl, 'synthwave', BODIES.synthwave),
  spotlights: spotlightsPort,
  tunnel: tunnelPort,
};
