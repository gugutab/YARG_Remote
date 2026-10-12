// Visualizers: animated backgrounds drawn once behind every fretboard (Highway.setVisualizer).
//
// Everything is a pure function of the song time `t` (plus the song's data), never of the wall clock or of previous frames, so a
// paused song freezes the picture and a seek (or the seek animation rushing through the song) just lands on the right frame.
// The helpers up to "Registry" are pure and tested (test/visualizers.test.js); the browser parts (cover loading, the driver)
// come after them.

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v) => v - Math.floor(v);

// ---------- Small maths ----------

// Deterministic pseudo random number in [0, 1) from an integer (and a salt): the same star / ember every frame.
export function hash01(n, salt = 0) {
  let x = (Math.imul((n | 0) + 1, 0x9e3779b1) ^ Math.imul((salt | 0) + 7, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

export function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// ---------- Palette ----------

// Dominant colours of an RGBA pixel array (a small downscale of the cover). Pixels are bucketed 3 bits per channel and weighted by
// saturation, so a mostly grey or black cover still yields its coloured accent. Returns up to `count` clearly different colours
// (most to least dominant), the most saturated one as `accent`, and the average brightness (0..1).
export function extractPalette(pixels, count = 4) {
  const buckets = new Map();
  let luma = 0;
  let n = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b);
    const sat = max ? (max - Math.min(r, g, b)) / max : 0;
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    n++;
    const w = 0.15 + sat * (max > 40 ? 1 : 0.2); // near-black pixels carry no colour
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    let e = buckets.get(key);
    if (!e) buckets.set(key, (e = { w: 0, r: 0, g: 0, b: 0 }));
    e.w += w; e.r += r * w; e.g += g * w; e.b += b * w;
  }
  if (n === 0) return null;
  const ranked = [...buckets.values()].sort((a, b) => b.w - a.w).map((e) => [e.r / e.w, e.g / e.w, e.b / e.w].map(Math.round));
  const colors = [];
  for (const c of ranked) {
    if (colors.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 70)) colors.push(c);
    if (colors.length >= count) break;
  }
  while (colors.length < count) { // a flat cover: invent the missing ones by turning the hue of the dominant colour
    const [h, s, l] = rgbToHsl(colors[0]);
    colors.push(hslToRgb([(h + 50 * colors.length) % 360, Math.max(s, 0.35), l]));
  }
  const score = (c) => { const [, s, l] = rgbToHsl(c); return s * (1 - Math.abs(l - 0.5)); };
  const accent = colors.reduce((best, c) => (score(c) > score(best) ? c : best), colors[0]);
  return finishPalette({ colors, accent, brightness: luma / n / 255 });
}

// Brightens a colour so it reads on a dark stage: lightness 0.52-0.68, saturation at least 0.55.
export function vivid(c) {
  const [h, s, l] = rgbToHsl(c);
  return hslToRgb([h, Math.max(s, 0.55), Math.min(0.68, Math.max(0.52, l))]);
}

function finishPalette(p) {
  p.v = p.colors.map(vivid); // what the visualizers draw with
  p.va = vivid(p.accent);
  return p;
}

// A palette from nothing but the song's name, for songs without a cover.
export function fallbackPalette(seed = 0) {
  const h = hash01(seed) * 360;
  const colors = [h, h + 40, h + 170, h + 300].map((x) => hslToRgb([x % 360, 0.65, 0.5]));
  return finishPalette({ colors, accent: colors[1], brightness: 0.4 });
}

// ---------- Beats ----------

// Index of the last beat at or before t, or -1.
export function beatIndexAt(beats, t) {
  let lo = 0;
  let hi = beats.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid].time <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

// Where t falls in the beat grid. `pos` is the continuous beat count (beat 0 starts at beats[0]; before and after the grid it
// continues at the nearest tempo), so motion tied to `pos` follows the tempo, speeds up and slows down with it and never jumps.
// phase 0..1 inside the beat; pulse 1 -> 0 over the beat (a punch on the beat); measurePhase / measurePulse the same over the bar.
export function beatInfo(beats, t, out = {}) {
  const n = beats.length;
  let pos;
  let interval;
  let i = -1;
  if (n === 0) { interval = 0.5; pos = t / interval; } // no grid: 120 BPM
  else {
    i = beatIndexAt(beats, t);
    if (i < 0) { interval = n > 1 ? beats[1].time - beats[0].time : 0.5; pos = (t - beats[0].time) / Math.max(0.05, interval); }
    else if (i === n - 1) { interval = n > 1 ? beats[i].time - beats[i - 1].time : 0.5; pos = i + (t - beats[i].time) / Math.max(0.05, interval); }
    else { interval = beats[i + 1].time - beats[i].time; pos = i + (t - beats[i].time) / Math.max(0.05, interval); }
  }
  interval = Math.max(0.05, interval);
  const index = Math.floor(pos);
  const phase = pos - index;
  let measurePhase = ((((index % 4) + 4) % 4) + phase) / 4; // no bar markers: four beats to a bar
  let measureBeat = false;
  if (i >= 0 && i < n - 1) {
    let a = -1;
    let b = -1;
    for (let k = i, c = 0; k >= 0 && c < 16; k--, c++) if (beats[k].measure) { a = k; break; }
    for (let k = i + 1, c = 0; k < n && c < 16; k++, c++) if (beats[k].measure) { b = k; break; }
    if (a >= 0 && b > a) measurePhase = clamp01((t - beats[a].time) / Math.max(0.05, beats[b].time - beats[a].time));
    measureBeat = beats[i].measure === true;
  }
  out.pos = pos;
  out.index = index;
  out.phase = phase;
  out.interval = interval;
  out.bpm = 60 / interval;
  out.pulse = (1 - phase) ** 3;
  out.measurePhase = measurePhase;
  out.measurePulse = (1 - measurePhase) ** 4;
  out.measureBeat = measureBeat;
  return out;
}

// ---------- Note density ----------

// Notes per second in `bin`-second slots over the song (chords and notes at the same time count once), lightly smoothed.
// `ref` is the level that counts as "busy" (the 90th percentile of the non-empty slots), `cum` the integral of
// (0.3 + normalised density), which is how far a "travelling" effect (warp, embers) has moved at each slot boundary.
export function densityHistogram(times, duration, bin = 1) {
  const n = Math.max(2, Math.ceil(duration / bin) + 1);
  const counts = new Float32Array(n);
  const sorted = Float64Array.from(times).sort();
  let last = -Infinity;
  for (const tm of sorted) {
    if (tm - last < 1e-4) continue;
    last = tm;
    const k = Math.floor(tm / bin);
    if (k >= 0 && k < n) counts[k]++;
  }
  const bins = new Float32Array(n);
  for (let k = 0; k < n; k++) bins[k] = ((counts[k - 1] || 0) + 2 * counts[k] + (counts[k + 1] || 0)) / 4 / bin;
  const nonEmpty = Array.from(bins).filter((v) => v > 0).sort((a, b) => a - b);
  const ref = Math.max(1, nonEmpty.length ? nonEmpty[Math.floor(nonEmpty.length * 0.9)] : 1);
  const cum = new Float32Array(n + 1);
  for (let k = 0; k < n; k++) cum[k + 1] = cum[k] + (0.3 + clamp01(bins[k] / ref)) * bin;
  return { bins, bin, ref, cum };
}

// Density at t, 0..1 (1 = as busy as the song gets), interpolated between slot centres.
export function densityAt(d, t) {
  const x = t / d.bin - 0.5;
  const k = Math.floor(x);
  const f = x - k;
  const at = (i) => clamp01(d.bins[Math.max(0, Math.min(d.bins.length - 1, i))] / d.ref);
  return at(k) * (1 - f) + at(k + 1) * f;
}

// The travelled distance at t: grows steadily, faster where the music is dense. Continuous, so jumps in t are fine.
export function travelAt(d, t) {
  if (t <= 0) return t * 0.3;
  const x = t / d.bin;
  const k = Math.floor(x);
  if (k >= d.bins.length) return d.cum[d.bins.length] + (t - d.bins.length * d.bin) * 0.3;
  return d.cum[k] + (x - k) * (0.3 + clamp01(d.bins[k] / d.ref)) * d.bin;
}

// ---------- Spans, notes ----------

// 0..1: how deep t is inside any of the spans [{start, end}] (eases in and out over `ramp` seconds).
export function spanAmount(spans, t, ramp = 0.4) {
  let best = 0;
  for (const s of spans) {
    if (t < s.start || t > s.end) continue;
    best = Math.max(best, Math.min(1, (t - s.start) / ramp, (s.end - t) / ramp));
  }
  return best;
}

// Everything the chart plays as one time-sorted list for the "spectrum": times, ends and a 0..1 position along the spectrum.
// Each chart gets its own band (instruments side by side); lanes spread inside it (the drum kick at its low end), vocals by pitch.
export function buildEvents(charts) {
  const rows = [];
  const bands = charts.length || 1;
  charts.forEach((chart, ci) => {
    const lo = ci / bands;
    const span = 1 / bands;
    const vocal = chart.mode === 'vocals';
    for (const n of chart.notes) {
      const p = vocal ? clamp01(((n.pitch ?? 60) - 36) / 48) : n.lane < 0 ? 0.03 : clamp01(((n.lane ?? 0) + 0.5) / Math.max(1, chart.lanes || 5));
      rows.push([n.time, Math.max(n.end ?? n.time, n.time), lo + p * span]);
    }
  });
  rows.sort((a, b) => a[0] - b[0]);
  const times = new Float64Array(rows.length);
  const ends = new Float64Array(rows.length);
  const pos = new Float32Array(rows.length);
  let maxLen = 0;
  rows.forEach(([a, b, p], i) => { times[i] = a; ends[i] = b; pos[i] = p; maxLen = Math.max(maxLen, b - a); });
  return { times, ends, pos, count: rows.length, maxLen: Math.min(maxLen, 4) };
}

// First index whose time is at least `t`.
export function lowerBound(times, t) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// How hard the chart is hitting right now, 0..1: onsets in the last 0.25 s, newest strongest.
export function hitLevel(events, t) {
  let sum = 0;
  for (let i = lowerBound(events.times, t - 0.25); i < events.count && events.times[i] <= t; i++) sum += 1 - (t - events.times[i]) / 0.25;
  return 1 - Math.exp(-sum * 0.6);
}

// Singing right now (1), fading out for a third of a second afterwards. `notes` sorted by time.
export function vocalLevel(notes, t) {
  let lo = 0;
  let hi = notes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (let k = found; k >= 0 && k > found - 3; k--) { // a long note may have ended before the last one started
    const end = notes[k].end ?? notes[k].time;
    if (t <= end) return 1;
    if (k === found) { const lvl = Math.exp(-(t - end) / 0.35); if (lvl > 0.02) return lvl; }
  }
  return 0;
}

// 1 right after a time in the sorted list, fading over `tau` seconds.
export function pulseAfter(times, t, tau = 0.25) {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found < 0 ? 0 : Math.exp(-(t - times[found]) / tau);
}

export function sectionAt(sections, t) {
  let idx = 0;
  for (let i = 0; i < sections.length; i++) if (sections[i].time <= t) idx = i;
  return idx;
}

// Bars of the "spectrum": the energy each of `bars` positions gets from the notes sounding around t (held notes hold their level,
// ended ones decay), as a soft blob around the note's position. Writes into `out` (a Float32Array of `bars`).
export function spectrumAt(events, t, bars, out, spread = 3) {
  out.fill(0, 0, bars);
  const from = lowerBound(events.times, t - 1.4 - events.maxLen);
  for (let i = from; i < events.count && events.times[i] <= t + 0.02; i++) {
    const age = t - events.times[i];
    const held = Math.max(0, events.ends[i] - events.times[i]);
    const e = age <= Math.min(held, 4) ? 1 : Math.exp(-(age - Math.min(held, 4)) / 0.22);
    if (e < 0.03) continue;
    const c = events.pos[i] * (bars - 1);
    const lo = Math.max(0, Math.floor(c - 2 * spread));
    const hi = Math.min(bars - 1, Math.ceil(c + 2 * spread));
    for (let b = lo; b <= hi; b++) out[b] += e * Math.exp(-((b - c) ** 2) / (2 * spread * spread));
  }
  return out;
}

// ---------- Song data ----------

// All the data the visualizers read, built once per song and chart set (not per frame).
// song: { title, artist, genre, year, length, bpmRange }; charts: the charts on screen (buildChart results).
export function buildSongData({ song = {}, charts = [] } = {}) {
  const lanes = charts.filter((c) => c.mode !== 'vocals');
  const vocal = charts.find((c) => c.mode === 'vocals') ?? null;
  const main = lanes[0] ?? vocal ?? charts[0] ?? null;
  let duration = song.length || 0;
  for (const c of charts) duration = Math.max(duration, c.duration || 0, c.notes.length ? c.notes[c.notes.length - 1].time : 0);
  duration = Math.max(1, duration);
  const timesOf = (list) => list.flatMap((c) => c.notes.map((n) => n.time));
  const merged = (key) => lanes.flatMap((c) => c[key] || []).sort((a, b) => a.start - b.start);
  const seed = hashText(`${song.title ?? ''}|${song.artist ?? ''}`);
  const bpm = song.bpmRange ? (song.bpmRange[0] + song.bpmRange[1]) / 2 : 120;
  return {
    title: song.title ?? '', artist: song.artist ?? '', genre: song.genre ?? '', year: song.year ?? '', bpm, duration, seed,
    beats: charts.find((c) => c.beats?.length)?.beats ?? [],
    sections: main?.sections ?? [],
    density: densityHistogram(timesOf(lanes.length ? lanes : charts), duration),
    events: buildEvents(charts),
    starPower: merged('starPower'),
    solos: merged('solos'),
    vocalNotes: vocal ? vocal.notes : [],
    percussion: vocal ? (vocal.percussion || []).map((p) => p.time).sort((a, b) => a - b) : [],
    palette: fallbackPalette(seed),
    coverCanvas: null, // a small blurred square of the cover, once it is loaded
    coverKey: null,
  };
}

// ---------- Visualizers ----------
// create(ctx) -> { draw(g, s) }. g is a 2D context in CSS pixels covering the whole chart canvas; s is the frame state:
// t, w, h, dpr, beat (beatInfo), density, travel, sp (star power 0..1), solo, vocal, perc, hit, section, clock (wall seconds,
// only for a subtle idle drift). ctx.song is the song data above (its palette changes in place when the cover has loaded).

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Caches one value per (key) and rebuilds when the key changes: gradients depend on the size and the palette.
function memo() {
  let key = null;
  let value = null;
  return (k, build) => { if (k !== key) { key = k; value = build(); } return value; };
}

// A soft round sprite in one colour, drawn with 'lighter' for glowing dots.
function glowSprite(c) {
  const s = makeCanvas(48, 48);
  const o = s.getContext('2d');
  const grad = o.createRadialGradient(24, 24, 0, 24, 24, 24);
  grad.addColorStop(0, rgba([255, 255, 255], 0.95));
  grad.addColorStop(0.18, rgba(c, 0.85));
  grad.addColorStop(0.5, rgba(c, 0.25));
  grad.addColorStop(1, rgba(c, 0));
  o.fillStyle = grad;
  o.fillRect(0, 0, 48, 48);
  return s;
}

const coverViz = (ctx) => {
  const fallback = memo();
  return {
    draw(g, s) {
      const { w, h } = s;
      const song = ctx.song;
      const cv = song.coverCanvas;
      if (!cv) { // no cover: a slow palette gradient instead
        g.fillStyle = fallback(`${w}x${h}${song.palette.v[0]}`, () => {
          const gr = g.createLinearGradient(0, 0, w, h);
          gr.addColorStop(0, rgba(song.palette.v[0], 0.6));
          gr.addColorStop(1, rgba(song.palette.v[2], 0.6));
          return gr;
        });
        g.fillRect(0, 0, w, h);
        return;
      }
      const size = Math.max(w, h) * 1.08;
      g.save();
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.translate(w / 2 + Math.sin(s.t * 0.05 + s.clock * 0.07) * w * 0.05, h / 2 + Math.cos(s.t * 0.043 + s.clock * 0.05) * h * 0.05);
      g.scale(1.02 + 0.03 * Math.sin(s.t * 0.06), 1.02 + 0.03 * Math.sin(s.t * 0.06));
      g.drawImage(cv, -size / 2, -size / 2, size, size);
      g.globalCompositeOperation = 'lighter'; // a flash on the beat, a little bigger than the picture under it
      g.globalAlpha = 0.18 * s.beat.pulse + 0.1 * s.beat.measurePulse + 0.1 * s.hit;
      g.drawImage(cv, -size * 0.53, -size * 0.53, size * 1.06, size * 1.06);
      g.restore();
    },
  };
};

const auroraViz = (ctx) => {
  const grads = memo();
  const sky = memo();
  return {
    draw(g, s) {
      const { w, h } = s;
      const pal = ctx.song.palette;
      g.save();
      g.fillStyle = sky(`${h}${pal.v[0]}`, () => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, rgba(pal.v[2], 0.16));
        gr.addColorStop(1, rgba(pal.v[0], 0.3));
        return gr;
      });
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      const drive = 0.55 + 0.45 * s.density + 0.4 * s.sp;
      const gradSet = grads(`${w}x${h}${pal.v.join()}`, () => pal.v.map((c) => {
        const gr = g.createLinearGradient(0, 0, 0, h * 0.7);
        gr.addColorStop(0, rgba(c, 0));
        gr.addColorStop(0.4, rgba(c, 0.8));
        gr.addColorStop(1, rgba(c, 0));
        return gr;
      }));
      const step = 6; // px between the points of a ribbon's edge (the curves are smooth: this is plenty at full resolution)
      for (let k = 0; k < 4; k++) {
        const ph = s.beat.pos * 0.16 * (1 + k * 0.25) + k * 2.1 + ctx.song.seed % 7;
        const base = h * (0.1 + 0.2 * k) + s.vocal * h * 0.04;
        const amp = h * (0.06 + 0.025 * k) * (0.8 + s.density * 0.7);
        const thick = h * (0.3 + 0.06 * k);
        const f = 0.04 / 6 * (1 + 0.3 * k); // radians per px
        g.save();
        g.translate(0, base - h * 0.1);
        g.globalAlpha = Math.min(1, 0.5 * drive);
        g.fillStyle = gradSet[k % gradSet.length];
        g.beginPath();
        const up = [];
        for (let x = 0; x <= w + step; x += step) {
          const y = Math.sin(x * f + ph) * amp + Math.sin(x * f * 2.3 - ph * 1.7) * amp * 0.4;
          up.push(y);
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        for (let i = up.length - 1; i >= 0; i--) g.lineTo(i * step, up[i] * 0.6 + thick);
        g.closePath();
        g.fill();
        g.restore();
      }
      g.restore();
    },
  };
};

const synthViz = (ctx) => {
  const skyGrad = memo();
  const sunGrad = memo();
  let sun = null;
  return {
    draw(g, s) {
      const { w, h } = s;
      const pal = ctx.song.palette;
      const hor = Math.round(h * 0.55);
      const cx = w / 2;
      const [c0, c1] = [pal.v[0], pal.va];
      g.fillStyle = skyGrad(`${h}${c0}${c1}`, () => {
        const gr = g.createLinearGradient(0, 0, 0, hor);
        gr.addColorStop(0, rgba(c0, 0.1));
        gr.addColorStop(1, rgba(c1, 0.5));
        return gr;
      });
      g.fillRect(0, 0, w, hor);
      // the sun: a disc cut into stripes that crawl down, pulsing on every bar (drawn on its own canvas so the cuts are see-through)
      const baseR = Math.min(w, h) * 0.2;
      const R = baseR * (1 + 0.07 * s.beat.measurePulse + 0.02 * s.beat.pulse);
      const sy = hor - R * 0.5;
      const side = Math.max(16, Math.ceil(baseR * 2));
      if (!sun || sun.width !== side) sun = makeCanvas(side, side);
      const o = sun.getContext('2d');
      o.globalCompositeOperation = 'source-over';
      o.clearRect(0, 0, side, side);
      const sg = sunGrad(`${side}${c0}${c1}`, () => {
        const gr = o.createLinearGradient(0, 0, 0, side);
        gr.addColorStop(0, rgba([255, 226, 120], 1));
        gr.addColorStop(0.55, rgba([255, 120, 90].map((v, i) => Math.round(v * 0.6 + c1[i] * 0.4)), 1)); // a warm sun, tinted by the cover
        gr.addColorStop(1, rgba([230, 60, 150].map((v, i) => Math.round(v * 0.6 + c0[i] * 0.4)), 1));
        return gr;
      });
      o.fillStyle = sg;
      o.beginPath();
      o.arc(side / 2, side / 2, side / 2, 0, TAU);
      o.fill();
      o.globalCompositeOperation = 'destination-out';
      const crawl = fract(s.beat.pos / 8);
      for (let k = -1; k < 9; k++) { // stripes below the middle, wider towards the bottom
        const u = (k + crawl) / 8;
        const y = side * (0.5 + 0.5 * u);
        if (y < side * 0.5) continue;
        o.fillRect(0, y, side, Math.max(1, side * 0.045 + side * 0.07 * u));
      }
      g.drawImage(sun, cx - R, sy - R, R * 2, R * 2);
      g.save();
      g.globalCompositeOperation = 'lighter';
      const glow = g.createRadialGradient(cx, sy, R * 0.6, cx, sy, R * 2.2);
      glow.addColorStop(0, rgba(c1, 0.2 + 0.25 * s.beat.measurePulse + 0.2 * s.sp));
      glow.addColorStop(1, rgba(c1, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, w, hor);
      g.restore();
      // the ground and its grid, rolling towards the viewer one cell every two beats
      g.fillStyle = 'rgba(8,4,24,0.55)';
      g.fillRect(0, hor, w, h - hor);
      const lineA = 0.5 + 0.35 * s.beat.pulse + 0.2 * s.sp;
      g.lineWidth = 1.5;
      g.strokeStyle = rgba(c1, 0.55 * lineA);
      g.beginPath();
      for (let i = -14; i <= 14; i++) {
        g.moveTo(cx + i * w * 0.012, hor);
        g.lineTo(cx + i * w * 0.14, h);
      }
      const roll = fract(s.beat.pos / 2);
      const rows = 12;
      for (let k = 0; k < rows; k++) {
        const z = (k + 1 - roll) / rows;
        const y = hor + (h - hor) * z * z * z;
        g.moveTo(0, y);
        g.lineTo(w, y);
      }
      g.stroke();
      g.strokeStyle = rgba(c0, 0.4 * lineA);
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, hor);
      g.lineTo(w, hor);
      g.stroke();
    },
  };
};

const STARS = 220;
const warpViz = (ctx) => ({
  draw(g, s) {
    const { w, h } = s;
    const pal = ctx.song.palette;
    const cx = w / 2 + Math.sin(s.t * 0.11) * w * 0.03;
    const cy = h / 2 + Math.cos(s.t * 0.09) * h * 0.03;
    const R = Math.hypot(w, h) * 0.53;
    const streak = 0.015 + 0.06 * s.density + 0.04 * s.sp;
    const hot = s.sp > 0 ? [170, 225, 255] : null;
    const cols = [hot ?? [235, 240, 255], hot ?? pal.v[1]];
    g.save();
    g.lineCap = 'round';
    const travel = s.travel * 0.1;
    for (let band = 0; band < 3; band++) { // by brightness band, so a whole band is one path
      for (let ci = 0; ci < 2; ci++) {
        g.beginPath();
        for (let i = ci; i < STARS; i += 2) {
          const z = fract(hash01(i, 1) + travel);
          if (Math.min(2, Math.floor(z * 3)) !== band) continue;
          const a = hash01(i, 2) * TAU;
          const z0 = Math.max(0, z - streak * (0.5 + z));
          const r1 = z ** 1.9 * R;
          const r0 = z0 ** 1.9 * R;
          g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        }
        g.strokeStyle = rgba(cols[ci], 0.35 + band * 0.25);
        g.lineWidth = 1 + band * 0.9;
        g.stroke();
      }
    }
    g.restore();
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.5);
    glow.addColorStop(0, rgba(hot ?? pal.v[0], 0.18 + 0.3 * s.sp + 0.15 * s.hit));
    glow.addColorStop(1, rgba(hot ?? pal.v[0], 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    if (s.sp > 0) { // star power: a flash on every beat
      g.fillStyle = rgba([180, 225, 255], 0.1 * s.sp * s.beat.pulse);
      g.fillRect(0, 0, w, h);
    }
  },
});

const ringsViz = (ctx) => ({
  draw(g, s) {
    const { w, h } = s;
    const pal = ctx.song.palette;
    const beats = ctx.song.beats;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(w, h) * 0.55;
    const life = Math.min(4, 14 * s.beat.interval); // seconds a ring lives
    const speed = maxR / life;
    // the rings still alive: the beats before t; with no beat grid, an even 120 BPM one
    const first = beats.length ? beatIndexAt(beats, s.t) : Math.floor(s.beat.pos);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = first, drawn = 0; i >= (beats.length ? 0 : -1e9) && drawn < 40; i--, drawn++) {
      const when = beats.length ? beats[i].time : i * s.beat.interval;
      const age = s.t - when;
      if (age > life) break;
      if (age < 0) continue;
      const measure = beats.length ? beats[i].measure === true : ((i % 4) + 4) % 4 === 0;
      const k = 1 - age / life;
      g.strokeStyle = rgba(measure ? pal.va : pal.v[((i % 3) + 3) % 3], Math.min(1, k ** 1.2 * (measure ? 1.1 : 0.9)));
      g.lineWidth = (measure ? 8 : 3) * (0.5 + k);
      g.beginPath();
      g.arc(cx, cy, 12 + age * speed, 0, TAU);
      g.stroke();
    }
    for (const at of [s.perc]) { // percussion hits: a quick bright ring
      if (at > 0.02) {
        g.strokeStyle = rgba([255, 255, 255], at * 0.5);
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, 30 + (1 - at) * maxR * 0.35, 0, TAU);
        g.stroke();
      }
    }
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.22);
    core.addColorStop(0, rgba(pal.va, 0.25 + 0.45 * s.beat.pulse + 0.2 * s.hit));
    core.addColorStop(1, rgba(pal.va, 0));
    g.fillStyle = core;
    g.fillRect(0, 0, w, h);
    g.restore();
  },
});

const EQ_ECHOES = [0.09, 0.2, 0.34]; // seconds back: the delayed copies that trail behind the bars
const eqViz = (ctx) => {
  const now = new Float32Array(96);
  const past = new Float32Array(96);
  const peak = new Float32Array(96);
  const level = (v) => Math.min(1.15, 1 - Math.exp(-v * 1.1));
  return {
    draw(g, s) {
      const { w, h } = s;
      const pal = ctx.song.palette;
      const n = Math.max(32, Math.min(96, Math.round(w / 16)));
      const bw = w / n;
      const spread = Math.max(3, n / 14); // each note lights a wide soft hill, so the bars fill the whole width
      const maxH = h * 0.9; // the bars hang from the top edge and reach most of the way down
      spectrumAt(ctx.song.events, s.t, n, now, spread);
      peak.fill(0, 0, n); // the highest level over the last 0.5 s, shown as a cap that "falls"
      for (let k = 0; k <= 5; k++) {
        spectrumAt(ctx.song.events, s.t - k * 0.1, n, past, spread);
        for (let b = 0; b < n; b++) peak[b] = Math.max(peak[b], level(past[b]) - k * 0.05);
      }
      g.save();
      g.globalCompositeOperation = 'lighter';
      const colorAt = (b, a) => { // the palette across the bars, brighter where it is louder
        const m = b / (n - 1);
        const c = m < 0.5 ? pal.v[0] : pal.va;
        return rgba(c, a);
      };
      EQ_ECHOES.forEach((dt, e) => { // trails: the same spectrum a moment earlier, longer and fainter
        spectrumAt(ctx.song.events, s.t - dt, n, past, spread);
        const a = 0.2 - e * 0.05;
        for (let b = 0; b < n; b++) {
          const v = Math.min(1.15, level(past[b]) + 0.03);
          g.fillStyle = colorAt(b, a);
          g.fillRect(b * bw + bw * 0.1, 0, bw * 0.8, v * maxH * (1 + 0.06 * (e + 1)));
        }
      });
      for (let b = 0; b < n; b++) {
        const idle = 0.04 + 0.03 * Math.sin(b * 0.45 + s.beat.pos * 1.3);
        const v = Math.min(1.15, level(now[b]) + idle);
        const bh = v * maxH;
        const x = b * bw + bw * 0.12;
        const gr = g.createLinearGradient(0, 0, 0, bh);
        gr.addColorStop(0, colorAt(b, 0.35));
        gr.addColorStop(1, colorAt(b, 0.95));
        g.fillStyle = gr;
        g.fillRect(x, 0, bw * 0.76, bh);
        g.fillStyle = 'rgba(255,255,255,0.85)'; // the tip glows
        g.fillRect(x, bh - 3, bw * 0.76, 3);
        const ph = Math.min(1.15, peak[b] + idle) * maxH; // the peak cap
        if (ph > bh + 4) { g.fillStyle = colorAt(b, 0.9); g.fillRect(x, ph - 2, bw * 0.76, 2); }
      }
      g.restore();
    },
  };
};

const EMBERS = 150;
const embersViz = (ctx) => {
  const sprites = memo();
  const glow = memo();
  return {
    draw(g, s) {
      const { w, h } = s;
      const pal = ctx.song.palette;
      const set = sprites(pal.v.join(), () => [pal.va, pal.v[0], pal.v[1], [255, 220, 150]].map(glowSprite));
      g.fillStyle = glow(`${h}${pal.va}`, () => {
        const gr = g.createLinearGradient(0, h, 0, h * 0.4);
        gr.addColorStop(0, rgba(pal.va, 0.35));
        gr.addColorStop(1, rgba(pal.va, 0));
        return gr;
      });
      g.globalAlpha = 0.45 + 0.5 * s.density + 0.3 * s.beat.pulse * s.density;
      g.fillRect(0, h * 0.4, w, h * 0.6);
      const visible = Math.floor(EMBERS * (0.3 + 0.7 * s.density));
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < visible; i++) {
        const life = 5 + hash01(i, 3) * 6; // travel units to cross the screen
        const phase = fract(hash01(i, 1) + (s.travel * 0.9) / life);
        const x = hash01(i, 2) * w + Math.sin(phase * TAU * 1.5 + hash01(i, 4) * 20) * w * 0.02;
        const y = h * (1.05 - phase * 1.15);
        const size = (10 + hash01(i, 5) * 28) * (1 - phase * 0.55) * (1 + s.hit * 0.35);
        g.globalAlpha = Math.sin(phase * Math.PI) * (0.5 + 0.5 * Math.sin(s.t * 5 + hash01(i, 6) * 30) ** 2) * (0.55 + 0.45 * s.beat.pulse);
        g.drawImage(set[i & 3], x - size, y - size, size * 2, size * 2);
      }
      g.restore();
    },
  };
};

// ---------- Registry ----------

export const VISUALIZERS = [
  { id: 'none', label: 'None', hint: 'Plain background', swatch: 'transparent', create: null },
  { id: 'cover', label: 'Album art', hint: 'The cover, blurred, pulsing on the beat', swatch: 'linear-gradient(135deg,#6b5b95,#d9822b)', create: coverViz },
  { id: 'aurora', label: 'Aurora', hint: 'Flowing ribbons in the cover colours', swatch: 'linear-gradient(135deg,#0f9b8e,#6a4fc2)', create: auroraViz },
  { id: 'synthwave', label: 'Synthwave', hint: 'Grid and sun, rolling with the beats', swatch: 'linear-gradient(180deg,#ff5fa2,#ffb347 55%,#3a1c71)', create: synthViz },
  { id: 'warp', label: 'Warp', hint: 'Stars that rush faster in busy parts', swatch: 'radial-gradient(circle,#fff 0 6%,#4a6fd8 40%,#0a1030)', create: warpViz },
  { id: 'rings', label: 'Beat rings', hint: 'A ring for every beat, thicker on bars', swatch: 'repeating-radial-gradient(circle,#7fd1ff 0 3px,#10203a 3px 9px)', create: ringsViz },
  { id: 'equalizer', label: 'MIDI equalizer', hint: 'Bars driven by the notes being played', swatch: 'linear-gradient(90deg,#3ddc97 0 20%,#ffd23f 20% 40%,#ff7043 40% 60%,#ffd23f 60% 80%,#3ddc97 80%)', create: eqViz },
  { id: 'embers', label: 'Embers', hint: 'Sparks rising with the energy', swatch: 'radial-gradient(circle at 50% 80%,#ffb347,#8b1e1e 55%,#1a0a0a)', create: embersViz },
];

export const VISUALIZER_IDS = VISUALIZERS.map((v) => v.id);

// Milliseconds spent drawing each visualizer (running average), for checking the cost: import('./visualizers.js').stats
export const stats = {};

// ---------- Browser side: cover and driver ----------

// Loads the cover and returns { palette, canvas }: the palette from a 32x32 downscale, the canvas a 64x64 blurred square.
export async function loadCover(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const small = makeCanvas(32, 32);
  const sg = small.getContext('2d', { willReadFrequently: true });
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  sg.drawImage(img, sx, sy, side, side, 0, 0, 32, 32);
  const palette = extractPalette(sg.getImageData(0, 0, 32, 32).data);
  const px = Math.min(512, side); // a sharp copy (the dark overlay already keeps it from competing with the notes)
  const big = makeCanvas(px, px);
  big.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, px, px);
  return { palette, canvas: big };
}

// What Highway.setVisualizer gets. getSource() -> { key, song, charts, coverUrl }: `key` changes when the charts do.
// Draws the chosen visualizer, then a dark overlay (the intensity setting) so the notes stay readable.
export function createDriver({ getSource }) {
  const state = { t: 0, w: 0, h: 0, dpr: 1, beat: {}, density: 0, travel: 0, sp: 0, solo: 0, vocal: 0, perc: 0, hit: 0, section: 0, clock: 0 };
  let id = 'none';
  let data = null;
  let dataKey = null;
  let viz = null;
  let vizFor = null;
  let failed = false;
  let coverToken = 0;
  const driver = {
    intensity: 0.6,
    get id() { return id; },
    select(next) {
      id = VISUALIZER_IDS.includes(next) ? next : 'none';
      viz = null;
      failed = false;
    },
    // The draw function for Highway, or null when nothing is selected.
    get fn() { return id === 'none' ? null : driver.draw; },
    draw(g, w, h, t, bgRgb) {
      if (id === 'none' || failed) return;
      const t0 = performance.now();
      const src = getSource();
      if (!src?.charts?.length) return;
      if (dataKey !== src.key) {
        dataKey = src.key;
        const prev = data;
        data = buildSongData({ song: src.song, charts: src.charts });
        if (prev && prev.coverKey === src.coverUrl && src.coverUrl) { data.palette = prev.palette; data.coverCanvas = prev.coverCanvas; data.coverKey = prev.coverKey; }
        viz = null;
        if (src.coverUrl && data.coverKey !== src.coverUrl) {
          const token = ++coverToken;
          const want = data;
          loadCover(src.coverUrl).then(({ palette, canvas }) => {
            if (token !== coverToken || !palette) return;
            want.palette = palette; want.coverCanvas = canvas; want.coverKey = src.coverUrl;
            if (data !== want) { data.palette = palette; data.coverCanvas = canvas; data.coverKey = src.coverUrl; }
          }).catch(() => { /* an unreadable cover: keep the fallback palette */ });
        }
      }
      if (!viz || vizFor !== id) {
        viz = VISUALIZERS.find((v) => v.id === id).create({ song: data });
        vizFor = id;
      }
      const s = state;
      s.t = t; s.w = w; s.h = h;
      s.dpr = g.getTransform().a || 1;
      s.clock = performance.now() / 1000;
      beatInfo(data.beats, t, s.beat);
      s.beat.pulse = 0; // no punch on the beat (it read as flicker); the tempo-locked motion (beat.pos) stays
      s.beat.measurePulse = 0;
      s.density = densityAt(data.density, t);
      s.travel = travelAt(data.density, t);
      s.sp = spanAmount(data.starPower, t);
      s.solo = spanAmount(data.solos, t);
      s.vocal = vocalLevel(data.vocalNotes, t);
      s.perc = pulseAfter(data.percussion, t, 0.3);
      s.hit = hitLevel(data.events, t);
      s.section = sectionAt(data.sections, t);
      g.save();
      try {
        viz.draw(g, s);
      } catch (err) {
        failed = true; // never take the whole chart down with a background
        console.error('Visualizer failed:', err);
      }
      g.restore();
      g.fillStyle = `rgba(${bgRgb},${(0.8 - 0.75 * driver.intensity).toFixed(3)})`;
      g.fillRect(0, 0, w, h);
      const ms = performance.now() - t0;
      stats[id] = stats[id] === undefined ? ms : stats[id] * 0.9 + ms * 0.1;
    },
  };
  return driver;
}
