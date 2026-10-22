// Visualizers: animated backgrounds drawn once behind every fretboard (Highway.setVisualizer).
//
// Everything is a pure function of the song time `t` (plus the song's data), never of the wall clock or of previous frames, so a
// paused song freezes the picture and a seek (or the seek animation rushing through the song) just lands on the right frame.
// The helpers up to "Registry" are pure and tested (test/visualizers.test.js); the browser parts (cover loading, the driver)
// come after them.

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v) => v - Math.floor(v);
const clampRange = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------- Small maths ----------

// Deterministic pseudo random number in [0, 1) from an integer (and a salt): the same star / ember every frame.
export function hash01(n, salt = 0) {
  let x = (Math.imul((n | 0) + 1, 0x9e3779b1) ^ Math.imul((salt | 0) + 7, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rgbToHsl([r, g, b]) {
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

function hslToRgb([h, s, l]) {
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
function vivid(c) {
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
// `shared`: every chart uses the whole 0..1 range (the layered equalizer: one set of events per instrument) instead of a band of its own.
// A vocal chart also counts the notes of its harmony parts (HARM1-3).
export function buildEvents(charts, { shared = false } = {}) {
  const rows = [];
  const bands = shared ? 1 : charts.length || 1;
  charts.forEach((chart, ci) => {
    const lo = shared ? 0 : ci / bands;
    const span = 1 / bands;
    const vocal = chart.mode === 'vocals';
    const notes = vocal && chart.harmonies?.length ? [...chart.notes, ...chart.harmonies.flatMap((h) => h.notes || [])] : chart.notes;
    for (const n of notes) {
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

// The colour of each instrument's layer (the equalizer): a fixed hue per instrument, so a guitar is always green and the drums orange.
// The instruments' reactions are exaggerated, the voice's (lead and harmony) are not: the same rule in every visualizer that follows the notes.
export const INSTRUMENT_GAIN = 1.7;
export const layerGain = (kind) => (kind === 'mic' || kind === 'harmony' ? 1 : INSTRUMENT_GAIN);
export const tint = (c, k) => [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k]; // towards white by k (0..1)
// `kind` is the pane's icon name (guitar, bass, drum, mic, harmony, keys, rhythm); an unknown one takes a colour from the palette.
export const INSTRUMENT_COLORS = {
  guitar: [26, 128, 90], bass: [36, 88, 186], drum: [190, 66, 36], mic: [196, 154, 30], harmony: [176, 112, 40], keys: [104, 58, 182], rhythm: [20, 124, 112],
}; // (a darker, deeper palette: the bright part of the picture is the cap at the tip of each bar)
export const INSTRUMENT_NAMES = { guitar: 'Guitar', bass: 'Bass', drum: 'Drums', mic: 'Vocals', harmony: 'Harmony', keys: 'Keys', rhythm: 'Rhythm' };
export const layerColor = (kind, index, palette) => INSTRUMENT_COLORS[kind] ?? palette?.v?.[index % (palette.v.length || 1)] ?? [200, 200, 200];

// First index whose time is at least `t`.
function lowerBound(times, t) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// How hard the chart is hitting right now, 0..1: onsets in the last 0.25 s, newest strongest.
export function hitLevel(events, t, gain = 1) {
  let sum = 0;
  for (let i = lowerBound(events.times, t - 0.25); i < events.count && events.times[i] <= t; i++) sum += 1 - (t - events.times[i]) / 0.25;
  return 1 - Math.exp(-sum * 0.6 * gain);
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

function sectionAt(sections, t) {
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

// The melody of a set of events at t: `pitch` is the (smoothed) height of the notes played lately, 0..1 (a note counts for about a second after it ends, so the
// value glides from note to note and rests at the middle with no notes), and `energy` how much is being played, 0..1. A note fades in over 0.12 s, so both are
// continuous in t. Writes into `out`.
export function melodyAt(events, t, gain = 1, out = {}) {
  let sw = 0;
  let sp = 0;
  const from = lowerBound(events.times, t - 4 - events.maxLen);
  for (let i = from; i < events.count && events.times[i] <= t; i++) {
    const age = t - events.times[i];
    const held = Math.min(4, Math.max(0, events.ends[i] - events.times[i]));
    const w = Math.exp(-Math.max(0, age - held) / 0.8) * Math.min(1, age / 0.12);
    if (w < 0.01) continue;
    sw += w;
    sp += w * events.pos[i];
  }
  out.pitch = (sp + 0.5 * 0.12) / (sw + 0.12);
  out.energy = 1 - Math.exp(-sw * 0.45 * gain);
  return out;
}

// ---------- Shapes of the newer effects (pure) ----------

// Album art as cloth: how the strip at u (0..1 across the picture) is moved. Two travelling sine waves whose phase is the beat
// position (tempo-locked) plus a slow drift of the song time. dy -1..1 (vertical offset, in units of the amplitude), slope -1..1
// (how steep the wave is there: the light/shade of the fabric), sy a tiny vertical scale around 1, rx -1..1 (horizontal ripple).
export function clothAt(u, pos, t, out = {}) {
  const p1 = u * TAU * 0.85 - pos * 0.8;
  const p2 = u * TAU * 1.9 - pos * 1.35 - t * 0.2 + 1.7;
  out.dy = 0.65 * Math.sin(p1) + 0.35 * Math.sin(p2);
  out.slope = (0.65 * Math.cos(p1) * 0.85 + 0.35 * Math.cos(p2) * 1.9) / (0.65 * 0.85 + 0.35 * 1.9);
  out.sy = 1 + 0.008 * Math.sin(p2 + 1);
  out.rx = Math.sin(u * TAU * 1.3 - pos * 0.7 + 0.6);
  return out;
}

// The bars of a circular spectrum: 2m bars mirrored left and right, angle 0 pointing up at the top and growing downwards on each
// side. angle[i] is in radians (canvas angle), bin[i] the spectrum bar (0..m-1) it shows.
export function radialLayout(m) {
  const angle = new Float32Array(2 * m);
  const bin = new Uint16Array(2 * m);
  for (let k = 0; k < m; k++) {
    const a = (k + 0.5) / m * Math.PI;
    angle[k] = -Math.PI / 2 + a; // right side, from the top down
    bin[k] = k;
    angle[2 * m - 1 - k] = -Math.PI / 2 - a; // left side, the mirror image
    bin[2 * m - 1 - k] = k;
  }
  return { angle, bin };
}

// Stage light i of `count`: its angle (radians off straight down, positive towards +x). Each beam swings around its own rest
// angle (a fan that leans towards the centre) with its own period in beats, so the sweep follows the tempo.
const BEAM_BEATS = [16, 24, 32, 20, 28, 12];
export function beamAngle(i, count, pos) {
  const x = count > 1 ? i / (count - 1) - 0.5 : 0; // -0.5 .. 0.5 across the stage
  return -x * 0.45 + (0.32 + 0.06 * (i % 3)) * Math.sin(pos * TAU / BEAM_BEATS[i % BEAM_BEATS.length] + i * 1.9);
}

// A value that depends on the section (fn(index)) and eases to the new one over `ramp` seconds after the section starts.
export function sectionValue(sections, t, index, fn, ramp = 2) {
  const cur = fn(index);
  const sec = sections[index];
  if (!sec || index <= 0) return cur;
  const k = clamp01((t - sec.time) / ramp);
  const e = k * k * (3 - 2 * k);
  const prev = fn(index - 1);
  return prev + (cur - prev) * e;
}

// ---------- Song data ----------

// All the data the visualizers read, built once per song and chart set (not per frame).
// song: { title, artist, genre, year, length, bpmRange }; charts: the charts on screen (buildChart results).
export function buildSongData({ song = {}, charts = [], kinds = [], layerCharts = null, shown = [] } = {}) {
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
    avgBpm: (() => { const b = charts.find((c) => c.beats?.length)?.beats; return b && b.length > 8 && b[b.length - 1].time > b[0].time ? clampRange(((b.length - 1) / (b[b.length - 1].time - b[0].time)) * 60, 40, 240) : 120; })(), // the song's average tempo
    sections: main?.sections ?? [],
    density: densityHistogram(timesOf(lanes.length ? lanes : charts), duration),
    events: buildEvents(charts),
    // one set of events per instrument (the layered equalizer); `layerCharts` lists the charts of every layer (the vocal layer has the lead and the harmony),
    // `shown` marks the instruments that are on screen
    layers: (layerCharts ?? charts.map((c) => [c])).map((cs, i) => ({ kind: kinds[i] ?? '', events: buildEvents(cs, { shared: true }), shown: shown[i] !== false })),
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

// The cover as a flag in a soft breeze: drawn in vertical strips that rise and fall on two travelling waves (clothAt), with the
// slope of the wave shading the strips lighter or darker, so it reads as fabric while the picture stays recognisable.
const CLOTH_STRIPS = 48;
const coverViz = (ctx) => {
  const fallback = memo();
  const c = { dy: new Float32Array(CLOTH_STRIPS + 1), slope: new Float32Array(CLOTH_STRIPS + 1), sy: new Float32Array(CLOTH_STRIPS + 1), rx: new Float32Array(CLOTH_STRIPS + 1) };
  const edge = {};
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
      const size = Math.max(w, h) * 1.2; // the picture is always 20 % larger than the screen (its larger side), so there is room to pan over it
      const zoom = 1;
      const amp = (h * 0.02 * (0.85 + 0.3 * s.density)) / zoom; // 1.7-2.3% of the height
      const rip = size * 0.003;
      for (let i = 0; i <= CLOTH_STRIPS; i++) {
        clothAt(i / CLOTH_STRIPS, s.beat.pos, s.t, edge);
        c.dy[i] = edge.dy; c.slope[i] = edge.slope; c.sy[i] = edge.sy; c.rx[i] = edge.rx;
      }
      g.save();
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      // The camera pans organically over the whole picture, also the parts that are off screen (the cover is a square cropped to the
      // window): each axis is three slow waves of unrelated speeds added together (so the path never repeats in an obvious loop and never moves in a
      // straight line), reaching as far as the edge without showing it. Song time only: it stands still when the music is paused.
      const room = (view) => Math.max(view * 0.03, (size * zoom - view) / 2 - amp * zoom * 1.5);
      const wander = (t, f, ph) => 0.55 * Math.sin(t * f[0] + ph[0]) + 0.3 * Math.sin(t * f[1] + ph[1]) + 0.15 * Math.sin(t * f[2] + ph[2]); // -1..1
      g.translate(w / 2 + wander(s.bt, [0.1, 0.23, 0.39], [0.6, 2.1, 4.4]) * room(w), h / 2 + wander(s.bt, [0.08, 0.19, 0.33], [2.2, 0.4, 3.3]) * room(h));
      g.scale(zoom, zoom);
      const x0 = -size / 2;
      const y0 = -size / 2;
      const overlap = 1 / zoom; // one screen pixel, so no seam shows between two strips
      const srcW = cv.width / CLOTH_STRIPS;
      const xs = (i) => x0 + (i / CLOTH_STRIPS) * size + c.rx[i] * rip;
      for (let i = 0; i < CLOTH_STRIPS; i++) {
        const xa = xs(i);
        const dw = xs(i + 1) - xa + overlap;
        const sy = (c.sy[i] + c.sy[i + 1]) / 2;
        const hh = size * sy;
        const dy = (c.dy[i] + c.dy[i + 1]) / 2;
        const sx = i * srcW;
        const sw = Math.min(srcW + (overlap * srcW) / Math.max(1, dw - overlap), cv.width - sx);
        g.drawImage(cv, sx, 0, sw, cv.height, xa, y0 + dy * amp - (hh - size) / 2, dw, hh);
      }
      for (let i = 0; i < CLOTH_STRIPS; i++) { // light on the slopes that face up, shade on the others
        const sl = (c.slope[i] + c.slope[i + 1]) / 2;
        const xa = xs(i);
        g.fillStyle = sl > 0 ? `rgba(255,255,255,${(sl * 0.16).toFixed(3)})` : `rgba(0,0,0,${(-sl * 0.2).toFixed(3)})`;
        g.fillRect(xa, y0 - amp, xs(i + 1) - xa + overlap, size + amp * 2);
      }
      g.restore();
    },
  };
};

// Aurora: ribbons of light drifting across the night sky, one per instrument, in the instrument's colour. Unlike the equalizer (bars along the pitch axis)
// the ribbon is one flowing line: its HEIGHT in the sky is the melody the instrument is playing (a high note lifts it, a low one lets it sink, gliding from
// note to note, resting in the middle when it is silent), and how much it plays makes it wider, brighter and more wavy. The waves travel along it on the SONG
// time (never the beat count or a single hit, which made the first version jump), so the motion is steady and only happens when the music does. Instruments
// that are not on screen are faint. Star power warms the colours.
const AURORA_POINTS = 28;
const AURORA_GLOW_DIV = 3; // the two wide, faint glow passes are drawn on a canvas this many times smaller (they are soft: nothing shows) and scaled up
const auroraViz = (ctx) => {
  const mel = Array.from({ length: 8 }, () => ({ pitch: 0.5, energy: 0 }));
  const sky = memo();
  let glow = null;
  return {
    draw(g, s) {
      const { w, h } = s;
      const song = ctx.song;
      const pal = song.palette;
      const layers = song.layers?.length ? song.layers : [0, 1, 2].map((k) => ({ kind: '', events: song.events, shown: true, fallback: k }));
      const L = Math.min(layers.length, mel.length);
      g.save();
      g.fillStyle = sky(`${h}${pal.v[0]}${pal.v[2]}`, () => { // the night sky
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, rgba(pal.v[2], 0.16));
        gr.addColorStop(1, rgba(pal.v[0], 0.24));
        return gr;
      });
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const gw = Math.max(16, Math.ceil(w / AURORA_GLOW_DIV)), gh = Math.max(16, Math.ceil(h / AURORA_GLOW_DIV));
      if (!glow || glow.width !== gw || glow.height !== gh) glow = makeCanvas(gw, gh);
      const o = glow.getContext('2d');
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.clearRect(0, 0, gw, gh);
      o.globalCompositeOperation = 'source-over';
      o.lineCap = 'round';
      o.lineJoin = 'round';
      o.setTransform(gw / w, 0, 0, gh / h, 0, 0);
      const step = w / AURORA_POINTS;
      for (let li = 0; li < L; li++) {
        const layer = layers[li];
        const on = layer.shown !== false;
        const m = melodyAt(layer.events, s.t, layerGain(layer.kind), mel[li]);
        const kindColor = layer.fallback === undefined ? layerColor(layer.kind, li, pal) : pal.v[layer.fallback % pal.v.length];
        const col = mixRgb(tint(kindColor, 0.1), [255, 200, 120], 0.15 * s.sp).map(Math.round);
        const e = m.energy;
        const y0 = h * (0.86 - 0.72 * m.pitch) + Math.sin(s.bt * 0.17 + li * 1.9) * h * 0.05; // the melody: high notes are high in the sky (the whole height is used), with a slow drift
        const amp = h * (0.055 + 0.14 * e) * (0.8 + 0.4 * s.density) * (0.8 + 0.25 * s.tempo); // a faster part waves a little taller too
        const thick = h * (0.016 + 0.04 * e);
        const ph = li * 2.3 + song.seed % 7;
        const f1 = 0.0042 + li * 0.0006; // radians per px
        const f2 = f1 * 2.6;
        const f3 = f1 * 4.3;
        const v1 = (0.7 + li * 0.15) * (li % 2 ? -1 : 1); // radians per second: the waves travel along the ribbon, each one its own way
        const v2 = 0.5 + li * 0.1;
        const v3 = -0.9 - li * 0.08;
        const k0 = on ? 1 : 0.22;
        for (let strand = 0; strand < 3; strand++) { // three strands per instrument, a little apart and out of step: a wide veil instead of a single line
          const off = (strand - 1) * thick * 2.6;
          const sph = ph + strand * 1.3;
          const path = new Path2D();
          let px = 0;
          let py = 0;
          for (let k = 0; k <= AURORA_POINTS; k++) {
            const x = k * step;
            const y = y0 + off + Math.sin(x * f1 - s.bt * v1 + sph) * amp + Math.sin(x * f2 + s.bt * v2 + sph * 1.7) * amp * 0.5 + Math.sin(x * f3 + s.bt * v3 + sph * 0.6) * amp * 0.22;
            if (k === 0) path.moveTo(x, y); else path.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); // (smoothed through the midpoints: fewer points than straight segments need)
            px = x; py = y;
          }
          path.lineTo(px, py);
          const a = k0 * (0.55 + 0.6 * e);
          o.lineWidth = thick * 2.6; o.strokeStyle = rgba(col, 0.03 * a); o.stroke(path); // soft glow: the same line stroked wide and faint, then narrower (both on the small canvas), then narrow and bright (at full size)
          o.lineWidth = thick * 1.2; o.strokeStyle = rgba(col, 0.075 * a); o.stroke(path);
          g.lineWidth = thick * 0.4; g.strokeStyle = rgba(col, 0.15 * a); g.stroke(path);
        }
      }
      g.globalCompositeOperation = 'lighter'; // (the one additive blend: the soft glow over the sky)
      g.drawImage(glow, 0, 0, w, h);
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
        const born = clamp01(u / 0.2); // a stripe is born thin at the middle of the sun and grows to its width on the way down (it used to appear at full width)
        const grow = born * born * (3 - 2 * born);
        if (grow > 0.02) o.fillRect(0, y, side, (side * 0.045 + side * 0.07 * u) * grow);
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
const warpViz = (ctx) => {
  const mel = Array.from({ length: 8 }, () => ({ pitch: 0.5, energy: 0 }));
  const glowNow = [0, 0, 0]; // the glow colour eases towards its target over about a second (a change of who plays most must not jump)
  let glowAt = -1;
  return {
    // The stars belong to the instruments of the song (star i takes layer i % layers): an instrument's stars are in its colour and stretch into longer, brighter
    // streaks as it plays (a slow swell of its energy, instruments exaggerated, the voice not), so the field breathes with who is playing; the vanishing
    // point leans towards the pitch of the melody (high notes pull it up). Without layers: the palette's stars as before.
    draw(g, s) {
      const { w, h } = s;
      const pal = ctx.song.palette;
      const layers = ctx.song.layers ?? [];
      const L = Math.min(layers.length, mel.length);
      let lean = 0;
      let total = 0;
      for (let li = 0; li < L; li++) {
        const m = melodyAt(layers[li].events, s.t, layerGain(layers[li].kind), mel[li]);
        if (layers[li].shown !== false) { lean += (0.5 - m.pitch) * m.energy; total += m.energy; }
      }
      const cx = w / 2 + Math.sin(s.bt * 0.11) * w * 0.03;
      const cy = h / 2 + Math.cos(s.bt * 0.09) * h * 0.03 + (total > 0 ? (lean / total) * Math.min(1, total) * h * 0.14 : 0);
      const R = Math.hypot(w, h) * 0.53;
      const busy = L ? Math.min(1, total / 2) : s.density; // how much the instruments on screen play together
      const streak = (0.015 + 0.06 * Math.max(s.density, busy) + 0.04 * s.sp) * (0.75 + 0.35 * s.tempo);
      const hot = [170, 225, 255]; // star power turns the stars icy, blended in by how far into the phrase we are (s.sp eases 0..1), never switched
      g.save();
      g.lineCap = 'round';
      const travel = s.travel * 0.1 + s.bt * 0.04; // the density's travel plus the tempo's own: a fast part rushes, a slow one drifts
      const groups = L || 2;
      for (let gi = 0; gi < groups; gi++) {
        const layer = L ? layers[gi] : null;
        const e = layer ? mel[gi].energy : 0.5;
        const on = layer ? layer.shown !== false : true;
        const col = mixRgb(layer ? tint(layerColor(layer.kind, gi, pal), 0.5) : gi === 0 ? [235, 240, 255] : pal.v[1], hot, s.sp);
        const stretch = layer ? 0.55 + 1.5 * e : 1; // this instrument's streaks
        const alpha = layer ? (on ? 0.5 + 0.5 * e : 0.2) : 1;
        for (let band = 0; band < 3; band++) { // by brightness band, so a whole band is one path
          g.beginPath();
          for (let i = gi; i < STARS; i += groups) {
            const z = fract(hash01(i, 1) + travel);
            if (Math.min(2, Math.floor(z * 3)) !== band) continue;
            const a = hash01(i, 2) * TAU;
            const z0 = Math.max(0, z - streak * stretch * (0.5 + z));
            const r1 = z ** 1.9 * R;
            const r0 = z0 ** 1.9 * R;
            g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
            g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          }
          g.strokeStyle = rgba(col, Math.min(1, (0.35 + band * 0.25) * alpha));
          g.lineWidth = (1 + band * 0.9) * (layer ? 0.8 + 0.5 * e : 1);
          g.stroke();
        }
      }
      g.restore();
      let tr = pal.v[0][0]; let tg = pal.v[0][1]; let tb = pal.v[0][2];
      if (L && total > 0) { // the instruments' colours weighted by how much each plays (continuous: no switch between "the most active" ones)
        let sum = 0; tr = 0; tg = 0; tb = 0;
        for (let li = 0; li < L; li++) {
          const c = tint(layerColor(layers[li].kind, li, pal), 0.2);
          const wgt = mel[li].energy ** 2;
          tr += c[0] * wgt; tg += c[1] * wgt; tb += c[2] * wgt; sum += wgt;
        }
        if (sum > 0) { tr /= sum; tg /= sum; tb /= sum; }
      }
      const dt = glowAt < 0 ? 9 : clampRange(s.clock - glowAt, 0, 0.25);
      glowAt = s.clock;
      const ease = 1 - Math.exp(-dt / 0.9);
      glowNow[0] += (tr - glowNow[0]) * ease; glowNow[1] += (tg - glowNow[1]) * ease; glowNow[2] += (tb - glowNow[2]) * ease;
      const glowCol = mixRgb(glowNow, hot, s.sp);
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * (0.5 + 0.1 * busy));
      glow.addColorStop(0, rgba(glowCol, 0.16 + 0.3 * s.sp + 0.2 * busy));
      glow.addColorStop(1, rgba(glowCol, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);
      if (s.sp > 0) { // star power: a flash on every beat
        g.fillStyle = rgba([180, 225, 255], 0.1 * s.sp * s.beat.pulse);
        g.fillRect(0, 0, w, h);
      }
    },
  };
};

// The beat rings alive at t, newest first: a ring is born at exactly the time of its beat in the chart's beat map (age 0, the moment the note of that
// beat reaches the hit line: `t` is the highway's time, chart delay already taken off) and lives `life` seconds. With no beat map it uses an even grid of
// `interval` seconds. Fills and returns `out` (entries are reused): { index, age, measure }.
export function ringsAt(beats, t, interval, life, out = []) {
  const grid = beats.length > 0;
  let n = 0;
  for (let i = grid ? beatIndexAt(beats, t) : Math.floor(t / interval); (grid ? i >= 0 : true) && n < 40; i--) {
    const age = t - (grid ? beats[i].time : i * interval);
    if (age > life) break;
    if (age < 0) continue;
    const e = (out[n] ??= { index: 0, age: 0, measure: false });
    e.index = i; e.age = age; e.measure = grid ? beats[i].measure === true : ((i % 4) + 4) % 4 === 0;
    n++;
  }
  out.length = n;
  return out;
}

// Beat rings: a ring leaves the centre on every beat (bigger and brighter on the first beat of a bar, with a wide faint halo behind it as a trail), a soft swell
// of the core at the start of every bar, and three orbits whose marker turns once per beat, per two beats and per bar, so each is at the top exactly on
// the beat it counts and lights up there.
const ringsViz = (ctx) => {
  const alive = [];
  return {
    draw(g, s) {
      const { w, h } = s;
      const pal = ctx.song.palette;
      const beats = ctx.song.beats;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(w, h) * 0.55;
      const life = Math.min(4, 14 * s.beat.interval); // seconds a ring lives
      const speed = maxR / life;
      const unit = Math.min(w, h) / 760;
      const bar = (1 - s.beat.measurePhase) ** 5; // a swell at the downbeat that fades over the bar (the driver's measurePulse is switched off)
      g.save();
      g.globalCompositeOperation = 'source-over';
      g.lineCap = 'round';
      const rings = ringsAt(beats, s.t, s.beat.interval, life, alive);
      for (let r = 0; r < rings.length; r++) {
        const { index: i, age, measure } = rings[r];
        const k = 1 - age / life;
        const col = measure ? pal.va : pal.v[((i % 3) + 3) % 3];
        const rad = (12 + age * speed) * (measure ? 1 + 0.05 * bar : 1);
        const a = Math.min(1, k ** 1.2 * (measure ? 1.1 : 0.9));
        g.beginPath();
        g.arc(cx, cy, rad, 0, TAU);
        g.strokeStyle = rgba(col, a * 0.16); // the trail: a wide faint stroke under the line
        g.lineWidth = (measure ? 30 : 14) * (0.4 + k) * unit;
        g.stroke();
        g.strokeStyle = rgba(col, a);
        g.lineWidth = (measure ? 7 : 2.6) * (0.5 + k) * unit;
        g.stroke();
      }
      const orbits = [[0.17, s.beat.phase, pal.v[0]], [0.27, ((((s.beat.index % 2) + 2) % 2) + s.beat.phase) / 2, pal.v[1]], [0.38, s.beat.measurePhase, pal.va]]; // [size, turn 0..1, colour]
      for (let o = 0; o < orbits.length; o++) {
        const [size, frac, col] = orbits[o];
        const rad = Math.min(w, h) * size;
        const ang = -Math.PI / 2 + frac * TAU;
        const flash = (1 - frac) ** 6; // brightest at the top, just after the beat it counts
        g.strokeStyle = rgba(col, 0.1);
        g.lineWidth = 1.5 * unit;
        g.beginPath();
        g.arc(cx, cy, rad, 0, TAU);
        g.stroke();
        g.strokeStyle = rgba(col, 0.38); // the marker's tail, fading behind it
        g.lineWidth = 3.5 * unit;
        g.beginPath();
        g.arc(cx, cy, rad, ang - 0.9, ang);
        g.stroke();
        const px = cx + Math.cos(ang) * rad;
        const py = cy + Math.sin(ang) * rad;
        g.fillStyle = rgba(col, 0.25 + 0.3 * flash);
        g.beginPath();
        g.arc(px, py, (9 + 8 * flash) * unit, 0, TAU);
        g.fill();
        g.fillStyle = rgba(tint(col, 0.5), 0.9);
        g.beginPath();
        g.arc(px, py, 3.6 * unit, 0, TAU);
        g.fill();
      }
      if (s.perc > 0.02) { // percussion hits: a quick bright ring
        g.strokeStyle = rgba([255, 255, 255], s.perc * 0.5);
        g.lineWidth = 3 * unit;
        g.beginPath();
        g.arc(cx, cy, 30 + (1 - s.perc) * maxR * 0.35, 0, TAU);
        g.stroke();
      }
      g.globalCompositeOperation = 'lighter'; // (the one additive blend: the soft core)
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * (0.2 + 0.03 * bar));
      core.addColorStop(0, rgba(pal.va, 0.22 + 0.3 * bar + 0.2 * s.hit));
      core.addColorStop(1, rgba(pal.va, 0));
      g.fillStyle = core;
      g.fillRect(0, 0, w, h);
      g.restore();
    },
  };
};

// The MIDI equalizer: one equalizer per instrument of the song (all of them, whether or not its fretboard is on screen), each in its own colour. They all
// hang from the same top edge, but each is taller than the one before (the first instrument has the shortest bars, the last the tallest). Each layer is
// a half-transparent veil over the taller ones behind it, so where bars overlap the colours blend into new ones (green over blue into teal, orange
// under yellow into gold) and keep their saturation (added together they would wash out to white). The instruments on screen are drawn in full, with echoes and a peak cap; the others are a faint plain version. A vocal layer
// counts the lead and the harmony notes.
// Cheap on purpose: each layer is a few paths filled once (not a gradient and a rectangle per bar), and the colour ramp is one gradient per layer,
// reused for all its bars (the colour follows the depth below the top edge).
const EQ_MAX_BARS = 96;
const eqViz = (ctx) => {
  const bufs = Array.from({ length: 8 }, () => ({ now: new Float32Array(EQ_MAX_BARS), past: new Float32Array(EQ_MAX_BARS), peak: new Float32Array(EQ_MAX_BARS), ramp: null, rampKey: '' }));
  const levelOf = (gain) => (v) => Math.min(1.3, 1 - Math.exp(-v * 1.1 * gain));
  return {
    draw(g, s) {
      const { w, h } = s;
      const pal = ctx.song.palette;
      const layers = ctx.song.layers?.length ? ctx.song.layers : [{ kind: '', events: ctx.song.events, shown: true }];
      const L = Math.min(layers.length, bufs.length);
      const n = Math.max(32, Math.min(EQ_MAX_BARS, Math.round(w / 16)));
      const bw = w / n;
      const spread = Math.max(3, n / 14); // each note lights a wide soft hill, so the bars fill the whole width
      const lit = layers.slice(0, L).filter((l) => l.shown !== false).length;
      const echoes = lit <= 2 ? [0.09, 0.2, 0.34] : [0.14];
      const peakSteps = lit <= 2 ? 6 : 3;
      const heightOf = (li) => h * (L === 1 ? 0.9 : 0.28 + 0.62 * (li / (L - 1))); // the tallest bar of a layer: growing with the layer
      g.save();
      g.globalCompositeOperation = L > 1 ? 'source-over' : 'lighter';
      // the faint layers first (behind), then the lit ones; each group from the tallest layer (back) to the shortest (front)
      const order = [...Array(L).keys()].sort((x, y) => (layers[x].shown !== false) - (layers[y].shown !== false) || y - x);
      for (const li of order) {
        const { kind, events } = layers[li];
        const on = layers[li].shown !== false;
        const b = bufs[li];
        const { now, past, peak } = b;
        const col = layerColor(kind, li, pal);
        const maxH = heightOf(li) * (1 + 0.045 * Math.cos((s.beat.pos + li * 0.25) * TAU)); // the layer breathes once per beat, gently (a slow cosine, no flash)
        const level = levelOf(layerGain(kind)); // the instruments' bars are exaggerated, the voice's are not
        spectrumAt(events, s.t, n, now, spread);
        const idleAt = (k) => 0.04 + 0.03 * Math.sin(k * 0.45 + s.beat.pos * 1.3 + li);
        if (!on) { // an instrument that is not on screen: a faint plain version
          g.fillStyle = rgba(col, 0.15);
          for (let k = 0; k < n; k++) g.fillRect(k * bw + bw * 0.12, 0, bw * 0.76, Math.min(1.3, level(now[k]) + idleAt(k)) * maxH);
          continue;
        }
        const key = `${Math.round(maxH)}|${col}|${L}`;
        if (b.rampKey !== key) { // the colour ramp of this layer: stronger at the top edge, softer towards the tips
          const gr = g.createLinearGradient(0, 0, 0, maxH);
          gr.addColorStop(0, rgba(col, L > 1 ? 0.6 : 0.62));
          gr.addColorStop(1, rgba(col, L > 1 ? 0.5 : 0.38));
          b.ramp = gr;
          b.rampKey = key;
        }
        peak.fill(0, 0, n); // the highest level over the last 0.5 s, shown as a cap that "falls"
        for (let k = 0; k <= peakSteps; k++) {
          spectrumAt(events, s.t - k * 0.1, n, past, spread);
          for (let x = 0; x < n; x++) peak[x] = Math.max(peak[x], level(past[x]) - k * 0.05);
        }
        echoes.forEach((dt, e) => { // trails: the same spectrum a moment earlier, longer and fainter
          spectrumAt(events, s.t - dt, n, past, spread);
          g.fillStyle = rgba(col, 0.16 - e * 0.04);
          for (let k = 0; k < n; k++) g.fillRect(k * bw + bw * 0.1, 0, bw * 0.8, Math.min(1.3, level(past[k]) + 0.03) * maxH * (1 + 0.06 * (e + 1)));
        });
        g.fillStyle = b.ramp;
        for (let k = 0; k < n; k++) g.fillRect(k * bw + bw * 0.12, 0, bw * 0.76, Math.min(1.3, level(now[k]) + idleAt(k)) * maxH);
        g.fillStyle = rgba(tint(col, 0.72), 0.95); // the tips and the peak caps: a light version of the colour, the brightest part of the picture
        for (let k = 0; k < n; k++) {
          const bh = Math.min(1.3, level(now[k]) + idleAt(k)) * maxH;
          g.fillRect(k * bw + bw * 0.12, bh - 4, bw * 0.76, 4);
          const ph = Math.min(1.3, peak[k] + idleAt(k)) * maxH;
          if (ph > bh + 6) g.fillRect(k * bw + bw * 0.12, ph - 3, bw * 0.76, 3);
        }
      }
      g.restore();
    },
  };
};

const EMBERS = 150;
const embersViz = (ctx) => {
  const melTmp = { pitch: 0.5, energy: 0 };
  const sprites = memo();
  const glow = memo();
  return {
    // The sparks belong to the instruments of the song (a spark's colour is its instrument's, lightened to glow), and an instrument's sparks flare as it plays
    // (exaggerated for the instruments, not for the voice); those of an instrument that is not on screen are dim. Without layers: the palette's sparks.
    draw(g, s) {
      const { w, h } = s;
      const pal = ctx.song.palette;
      const layers = ctx.song.layers ?? [];
      const cols = layers.length ? layers.map((l, i) => tint(layerColor(l.kind, i, pal), 0.35)) : [pal.va, pal.v[0], pal.v[1], [255, 220, 150]];
      const set = sprites(`${pal.v.join()}|${cols.join('|')}`, () => cols.map(glowSprite));
      const heat = layers.map((l) => (l.shown !== false ? 0.55 + 0.75 * melodyAt(l.events, s.t, layerGain(l.kind), melTmp).energy : 0.22)); // how lively each instrument's sparks are: a slow swell, not a flash per note
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
        const phase = fract(hash01(i, 1) + (s.travel * 0.9 + s.bt * 0.5) / life);
        const x = hash01(i, 2) * w + Math.sin(phase * TAU * 1.5 + hash01(i, 4) * 20) * w * 0.02;
        const y = h * (1.05 - phase * 1.15);
        const own = heat.length ? heat[i % heat.length] : 1;
        const size = (10 + hash01(i, 5) * 28) * (1 - phase * 0.55) * (1 + s.hit * 0.35) * (0.8 + 0.35 * Math.min(1.5, own));
        g.globalAlpha = Math.min(1, Math.sin(phase * Math.PI) * (0.5 + 0.5 * Math.sin(s.t * 5 + hash01(i, 6) * 30) ** 2) * (0.55 + 0.45 * s.beat.pulse) * Math.min(1.4, own));
        g.drawImage(set[heat.length ? i % set.length : i & 3], x - size, y - size, size * 2, size * 2);
      }
      g.restore();
    },
  };
};

const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// A circular equalizer around a spinning record: the same wide hills, echoes and peak caps as the MIDI equalizer, mirrored on both
// sides and bent into a ring. The record is the cover (or a palette disc), turning with the tempo.
const RADIAL_BINS = 40; // spectrum bars per side
const radialViz = (ctx) => {
  const lay = radialLayout(RADIAL_BINS);
  const bufs = Array.from({ length: 8 }, () => ({ now: new Float32Array(RADIAL_BINS), past: new Float32Array(RADIAL_BINS), peak: new Float32Array(RADIAL_BINS) }));
  const disc = memo();
  const M = RADIAL_BINS;
  const levelOf = (gain) => (v) => Math.min(1.3, 1 - Math.exp(-v * 1.1 * gain));
  return {
    // The same rules as the MIDI equalizer: one set of bars per instrument of the song, all starting at the record's edge, each longer than the one before and
    // the longest drawn first (behind), in the instrument's own (dark) colour with a light tip; the instruments on screen are full, the others faint; the
    // instruments' bars are exaggerated, the voice's are not.
    draw(g, s) {
      const { w, h } = s;
      const song = ctx.song;
      const pal = song.palette;
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h);
      const discR = base * 0.2;
      const ringR = discR * (1.14 + 0.012 * Math.cos(s.beat.pos * TAU)); // the ring breathes once per beat (the record keeps its size)
      const layers = song.layers?.length ? song.layers : [{ kind: '', events: song.events, shown: true }];
      const L = Math.min(layers.length, bufs.length);
      const spread = Math.max(2.5, M / 14);
      const idle = (b, li) => 0.05 + 0.035 * Math.sin(b * 0.5 + s.beat.pos * 1.3 + li);
      // The bars reach towards the screen edge in their own direction (not a fixed length): along the width there is much more room than along the height, so the
      // spectrum fills the screen as an ellipse around the (unchanged) record. A layer's share of that room grows with the layer.
      const fracOf = (li) => (L === 1 ? 1.2 : 0.75 + 0.65 * (li / (L - 1)));
      const room = bufs.room ?? (bufs.room = new Float32Array(2 * M));
      for (let k = 0; k < 2 * M; k++) {
        const c = Math.abs(Math.cos(lay.angle[k]));
        const sn = Math.abs(Math.sin(lay.angle[k]));
        room[k] = Math.max(base * 0.05, Math.min(c > 1e-6 ? cx / c : Infinity, sn > 1e-6 ? cy / sn : Infinity) - ringR - 4);
      }
      const N = 2 * M;
      const bw = (TAU * ringR) / N * 0.64;
      const order = [...Array(L).keys()].sort((x, y) => (layers[x].shown !== false) - (layers[y].shown !== false) || y - x); // faint first, tallest first
      g.save();
      g.globalCompositeOperation = L > 1 ? 'source-over' : 'lighter';
      g.lineJoin = 'round';
      g.lineCap = 'butt';
      g.lineWidth = bw;
      for (const li of order) {
        const { kind, events } = layers[li];
        const on = layers[li].shown !== false;
        const { now, past, peak } = bufs[li];
        const col = layerColor(kind, li, pal);
        const frac = fracOf(li);
        const level = levelOf(layerGain(kind));
        spectrumAt(events, s.t, M, now, spread);
        g.beginPath(); // the bars of the layer: one path
        for (let k = 0; k < N; k++) {
          const b = lay.bin[k];
          const a = lay.angle[k];
          const len = Math.min(room[k], Math.min(1.3, level(now[b]) + idle(b, li)) * frac * room[k]);
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          g.moveTo(cx + cos * ringR, cy + sin * ringR);
          g.lineTo(cx + cos * (ringR + len), cy + sin * (ringR + len));
        }
        g.strokeStyle = rgba(col, on ? (L > 1 ? 0.62 : 0.9) : 0.15);
        g.stroke();
        if (!on) continue;
        peak.fill(0);
        for (let k = 0; k <= 4; k++) {
          spectrumAt(events, s.t - k * 0.1, M, past, spread);
          for (let b = 0; b < M; b++) peak[b] = Math.max(peak[b], level(past[b]) - k * 0.05);
        }
        g.beginPath(); // the tips and the peak caps: a light tint of the colour, the brightest part
        for (let k = 0; k < N; k++) {
          const b = lay.bin[k];
          const a = lay.angle[k];
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          const bar = Math.min(room[k], Math.min(1.3, level(now[b]) + idle(b, li)) * frac * room[k]);
          g.moveTo(cx + cos * (ringR + bar - 4), cy + sin * (ringR + bar - 4));
          g.lineTo(cx + cos * (ringR + bar), cy + sin * (ringR + bar));
          const cap = Math.min(room[k], Math.min(1.3, peak[b] + idle(b, li)) * frac * room[k]);
          if (cap > bar + 6) {
            g.moveTo(cx + cos * (ringR + cap - 3), cy + sin * (ringR + cap - 3));
            g.lineTo(cx + cos * (ringR + cap), cy + sin * (ringR + cap));
          }
        }
        g.strokeStyle = rgba(tint(col, 0.72), 0.95);
        g.stroke();
      }
      g.restore();
      // the record: dark backing, the cover (or palette) turning with the tempo, grooves and sheen that stay put, a tiny hole
      g.save();
      const spin = s.beat.pos * 0.12;
      g.fillStyle = 'rgba(6,6,10,0.9)';
      g.beginPath();
      g.arc(cx, cy, discR * 1.05, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(cx, cy, discR, 0, TAU);
      g.clip();
      g.translate(cx, cy);
      g.rotate(spin);
      if (song.coverCanvas) {
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(song.coverCanvas, -discR, -discR, discR * 2, discR * 2);
      } else {
        g.fillStyle = disc(`${discR}${pal.v.join()}`, () => {
          const gr = g.createLinearGradient(-discR, 0, discR, 0);
          pal.v.forEach((c, k) => gr.addColorStop(k / 3, rgba(c, 1)));
          return gr;
        });
        g.fillRect(-discR, -discR, discR * 2, discR * 2);
      }
      g.rotate(-spin);
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < 9; k++) {
        const r = discR * (0.28 + 0.078 * k);
        g.moveTo(r, 0);
        g.arc(0, 0, r, 0, TAU);
      }
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.07)'; // the shine of the vinyl: two opposite wedges
      for (const a of [-0.9, Math.PI - 0.9]) {
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, discR, a, a + 0.55);
        g.closePath();
        g.fill();
      }
      g.restore();
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, discR, 0, TAU);
      g.stroke();
      g.fillStyle = 'rgba(8,8,12,0.95)';
      g.beginPath();
      g.arc(cx, cy, discR * 0.045, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.arc(cx, cy, discR * 0.045, 0, TAU);
      g.stroke();
      g.restore();
    },
  };
};

// Sprites per beam colour (cone, floor pool, lamp), built once and drawn scaled: a beam used to need nine gradients and three big triangle fills a frame.
function colourSprites(col) {
  const key = col.join(',');
  let sp = colourSprites.cache.get(key);
  if (sp) return sp;
  if (colourSprites.cache.size >= 48) colourSprites.cache.clear();
  const cone = makeCanvas(96, 160);
  const o = cone.getContext('2d');
  o.globalCompositeOperation = 'lighter';
  const gr = o.createLinearGradient(0, 0, 0, 160);
  gr.addColorStop(0, rgba(col, 0.75));
  gr.addColorStop(0.55, rgba(col, 0.22));
  gr.addColorStop(1, rgba(col, 0));
  o.fillStyle = gr;
  [[0.25, 0.5], [0.5, 0.35], [1, 0.16]].forEach(([rel, a]) => { // soft edges: nested cones (half-widths 1/4, 1/2 and all of the sprite)
    o.globalAlpha = a;
    o.beginPath();
    o.moveTo(48, 0);
    o.lineTo(48 - 48 * rel, 160);
    o.lineTo(48 + 48 * rel, 160);
    o.closePath();
    o.fill();
  });
  const pool = makeCanvas(64, 64);
  const po = pool.getContext('2d');
  const pg = po.createRadialGradient(32, 32, 0, 32, 32, 32);
  pg.addColorStop(0, rgba(col, 1));
  pg.addColorStop(1, rgba(col, 0));
  po.fillStyle = pg;
  po.fillRect(0, 0, 64, 64);
  const lamp = makeCanvas(52, 52);
  const lo = lamp.getContext('2d');
  const lg = lo.createRadialGradient(26, 26, 0, 26, 26, 26);
  lg.addColorStop(0, 'rgba(255,255,255,0.8)');
  lg.addColorStop(0.3, rgba(col, 0.5));
  lg.addColorStop(1, rgba(col, 0));
  lo.fillStyle = lg;
  lo.fillRect(0, 0, 52, 52);
  sp = { cone, pool, lamp };
  colourSprites.cache.set(key, sp);
  return sp;
}
colourSprites.cache = new Map();

// Stage lights hanging from the top edge, each sweeping on its own period of beats (beamAngle), in the cover colours and added
// together. Busy music and singing make them brighter and wider; star power turns them warm and widens the sweep.
const spotViz = (ctx) => {
  const haze = memo();
  const melTmp = { pitch: 0.5, energy: 0 };
  return {
    // One beam per instrument of the song (at least three), each in the instrument's colour and as strong as the instrument is playing (the instruments'
    // reactions are exaggerated, the voice's are not); an instrument that is not on screen has a faint beam. Without layers: the palette's beams.
    draw(g, s) {
      const { w, h } = s;
      const pal = ctx.song.palette;
      const layers = ctx.song.layers ?? [];
      const n = Math.max(w > 1100 ? 8 : 6, layers.length); // more beams than instruments: an instrument lights every few beams across the stage
      const len = Math.hypot(w * 0.35, h) * 1.2; // long enough to cross the whole stage when tilted
      const drive = clamp01(0.8 + 0.3 * s.density + 0.25 * s.vocal + 0.15 * s.sp);
      const warmK = Math.round(s.sp * 8) / 8 * 0.65; // (in steps: the beam sprites are cached per colour)
      g.save();
      g.fillStyle = haze(`${h}${pal.v[2]}${pal.va}`, () => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, rgba(pal.v[2], 0.14));
        gr.addColorStop(0.6, rgba(pal.v[2], 0.04));
        gr.addColorStop(1, rgba(pal.va, 0.12));
        return gr;
      });
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      const warm = [255, 190, 90];
      for (let i = 0; i < n; i++) {
        const layer = layers.length ? layers[i % layers.length] : undefined;
        const x = (w * (i + 0.5)) / n;
        const ang = beamAngle(i, n, s.beat.pos) * (1.35 + 0.35 * s.sp); // wider sweeps
        const base = layer ? layerColor(layer.kind, i, pal) : pal.v[i % 4];
        const col = mixRgb(layer ? tint(base, 0.3) : base, warm, warmK).map((v) => Math.round(v / 4) * 4); // (a beam is light: a lighter version of the instrument's colour)
        const power = layer ? (layer.shown !== false ? 0.55 + 0.45 * melodyAt(layer.events, s.t, layerGain(layer.kind), melTmp).energy : 0.2) : 1; // a slow swell (the energy glides over about a second), never a flash on every note
        const half = (0.17 + 0.03 * s.vocal + 0.03 * s.density) * (0.8 + 0.4 * power); // wide cones: they overlap and fill the stage // half-opening of the cone, radians
        const sp = colourSprites(col);
        g.save();
        g.translate(x, -4);
        g.rotate(-ang);
        const hw = Math.tan(half * 2) * len;
        g.globalAlpha = Math.min(1, drive * 1.7 * power);
        g.drawImage(sp.cone, -hw, 0, hw * 2, len);
        g.restore();
        const hitX = x + Math.tan(ang) * h * 0.97; // the pool of light on the floor
        const pr = h * (0.34 + 0.06 * s.vocal);
        g.globalAlpha = 0.5 * drive * power;
        g.drawImage(sp.pool, hitX - pr, h * 0.97 - pr * 0.16, pr * 2, pr * 0.32);
        g.globalAlpha = power; // the fixture
        g.drawImage(sp.lamp, x - 26, -26);
        g.globalAlpha = 1;
      }
      g.restore();
    },
  };
};

// Rounded polygons rushing at the viewer. Ring i sits at depth fract(travel + i/N); the travel advances with the tempo and goes
// faster through busy parts, so the picture is a pure function of the song time. Rings fade in far away and out up close, take the
// palette colours in turn, and the twist along the tunnel changes with the section.
const TUNNEL_RINGS = 14;
function roundedPolygon(g, cx, cy, r, sides, rot, round) {
  const pts = [];
  for (let k = 0; k < sides; k++) pts.push([cx + Math.cos(rot + (k / sides) * TAU) * r, cy + Math.sin(rot + (k / sides) * TAU) * r]);
  const rad = r * round;
  const last = pts[sides - 1];
  g.moveTo((last[0] + pts[0][0]) / 2, (last[1] + pts[0][1]) / 2);
  for (let k = 0; k < sides; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % sides];
    g.arcTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, rad);
  }
  g.closePath();
}
const tunnelViz = (ctx) => ({
  draw(g, s) {
    const { w, h } = s;
    const song = ctx.song;
    const pal = song.palette;
    const cx = w / 2 + Math.sin(s.beat.pos * 0.03) * w * 0.025;
    const cy = h / 2 + Math.cos(s.beat.pos * 0.022) * h * 0.025;
    const R = Math.hypot(w, h) * 0.62;
    // Calm on purpose: slow travel and turning, soft colours, low contrast (the rings were bright and fast and tired the eyes). Variety comes from the sections and
    // slowly over time, never from a switch: every ring keeps its own shape and colour for its whole life (they are chosen from its number), the twist and the
    // spacing ease between sections, and the colour wheel drifts with the song time.
    const twist = sectionValue(song.sections, s.t, s.section, (k) => 0.3 + ((k * 7) % 5) * 0.12, 3);
    const spread = sectionValue(song.sections, s.t, s.section, (k) => 1.7 + ((k * 3) % 4) * 0.2, 3); // how the rings crowd towards the distance (radius ~ depth^spread)
    const run = s.beat.pos * 0.035 + s.travel * 0.08;
    const unit = Math.min(w, h) / 900;
    const warm = [255, 190, 90];
    const drift = s.t / 45; // one slow turn of the colour wheel in about three minutes
    g.save();
    g.globalCompositeOperation = 'source-over';
    g.lineJoin = 'round';
    for (let i = 0; i < TUNNEL_RINGS; i++) {
      const q = run + i / TUNNEL_RINGS;
      const z = fract(q);
      const id = Math.floor(q) * TUNNEL_RINGS + i; // this ring's number: its own shape and colour for good
      const fade = Math.sin(Math.PI * Math.min(1, z * 1.1)) ** 0.9; // fades in at the far end, out close up
      if (fade < 0.01) continue;
      const r = R * z ** spread * 0.8 + 3;
      const rot = s.beat.pos * 0.006 + z * twist + hash01(id, 5) * TAU;
      const wheel = (((id * 0.37 + drift) % 4) + 4) % 4;
      const c0 = pal.v[Math.floor(wheel) % 4];
      const c1 = pal.v[(Math.floor(wheel) + 1) % 4];
      const col = mixRgb(mixRgb(mixRgb(c0, c1, wheel % 1), [150, 150, 170], 0.3), warm, 0.5 * s.sp).map(Math.round); // (softened towards grey)
      const sides = 4 + Math.floor(hash01(id, 7) * 5); // squares to octagons
      const round = 0.12 + 0.2 * hash01(id, 9);
      g.beginPath();
      roundedPolygon(g, cx, cy, r, sides, rot, round);
      g.strokeStyle = rgba(col, 0.2 * fade);
      g.lineWidth = (4 + 16 * z ** 1.5) * unit;
      g.stroke();
      g.strokeStyle = rgba(col, 0.6 * fade);
      g.lineWidth = (1.2 + 4.5 * z ** 1.5) * unit;
      g.stroke();
    }
    g.globalCompositeOperation = 'lighter'; // (the one additive blend: the soft core)
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.3);
    core.addColorStop(0, rgba(mixRgb(pal.va, warm, 0.5 * s.sp), 0.12 + 0.12 * s.density));
    core.addColorStop(1, rgba(pal.va, 0));
    g.fillStyle = core;
    g.fillRect(0, 0, w, h);
    g.restore();
  },
});

// ---------- Registry ----------

export const VISUALIZERS = [
  { id: 'none', label: 'None', hint: 'Plain background', swatch: 'transparent', create: null },
  { id: 'cover', label: 'Album art', hint: 'The cover, waving softly like cloth', swatch: 'linear-gradient(135deg,#6b5b95,#d9822b)', create: coverViz, opaque: true },
  { id: 'aurora', label: 'Aurora', hint: 'Flowing ribbons in the cover colours', swatch: 'linear-gradient(135deg,#0f9b8e,#6a4fc2)', create: auroraViz, maxScale: 0.5 },
  { id: 'synthwave', label: 'Synthwave', hint: 'Grid and sun, rolling with the beats', swatch: 'linear-gradient(180deg,#ff5fa2,#ffb347 55%,#3a1c71)', create: synthViz },
  { id: 'warp', label: 'Warp', hint: 'Stars that rush faster in busy parts', swatch: 'radial-gradient(circle,#fff 0 6%,#4a6fd8 40%,#0a1030)', create: warpViz },
  { id: 'rings', label: 'Beat rings', hint: 'A ring on every beat, a swell on every bar', swatch: 'repeating-radial-gradient(circle,#7fd1ff 0 3px,#10203a 3px 9px)', create: ringsViz },
  { id: 'equalizer', label: 'MIDI equalizer', hint: 'Bars driven by the notes being played', swatch: 'linear-gradient(90deg,#3ddc97 0 20%,#ffd23f 20% 40%,#ff7043 40% 60%,#ffd23f 60% 80%,#3ddc97 80%)', create: eqViz },
  { id: 'embers', label: 'Embers', hint: 'Sparks rising with the energy', swatch: 'radial-gradient(circle at 50% 80%,#ffb347,#8b1e1e 55%,#1a0a0a)', create: embersViz },
  { id: 'radial', label: 'Radial spectrum', hint: 'A ring of bars around a spinning record', swatch: 'radial-gradient(circle,#222 0 22%,#f6c344 24% 30%,#222 32% 40%,#ff6b9d 42% 62%,#14142a 64%)', create: radialViz },
  { id: 'spotlights', label: 'Spotlights', hint: 'Stage lights sweeping with the tempo', swatch: 'conic-gradient(from 160deg at 50% 0,#0a0a1a 0 4%,#ffd36b 10%,#0a0a1a 18% 30%,#7fd1ff 36%,#0a0a1a 44% 56%,#ff7aa8 62%,#0a0a1a 70%)', create: spotViz, maxScale: 0.5 },
  { id: 'tunnel', label: 'Tunnel', hint: 'Rounded rings rushing towards you', swatch: 'repeating-radial-gradient(circle,#0b0b1e 0 3px,#6be0d0 3px 5px,#0b0b1e 5px 9px,#c06bff 9px 11px)', create: tunnelViz },
];

export const VISUALIZER_IDS = VISUALIZERS.map((v) => v.id);

// Whether the stage colour ("Background") can be seen with this visualizer: None shows it plainly and the translucent effects let it through; the album art
// is opaque and covers it, so its "Background" control would change nothing.
export const showsStage = (id) => VISUALIZERS.find((v) => v.id === id)?.opaque !== true;

// Milliseconds spent drawing each visualizer (running average), for checking the cost: import('./visualizers.js').stats
export const stats = {};

// ---------- Browser side: cover and driver ----------

// Loads the cover and returns { palette, canvas }: the palette from a 32x32 downscale, the canvas a 64x64 blurred square.
async function loadCover(url) {
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
// Draws the chosen visualizer (unblurred: the app blurs it with the CSS #bgGlass layer). Nothing is laid over it: the stage colour (`s.stage`, 'r, g, b') is only offered to the effects that want it.
export function createDriver({ getSource }) {
  const tA = {};
  const tB = {};
  const state = { bt: 0, bpm: 120, tempo: 1, t: 0, w: 0, h: 0, dpr: 1, beat: {}, density: 0, travel: 0, sp: 0, solo: 0, vocal: 0, perc: 0, hit: 0, section: 0, clock: 0 };
  let id = 'none';
  let data = null;
  let dataKey = null;
  let viz = null;
  let vizFor = null;
  let failed = false;
  let coverToken = 0;
  const driver = {
    quality: 0.6, // resolution of the background canvas (fraction of full); the album art always keeps the full resolution
    get scale() { return id === 'cover' || id === 'none' ? 1 : Math.min(driver.quality, VISUALIZERS.find((v) => v.id === id)?.maxScale ?? 1); }, // (soft effects cap their own resolution)
    get id() { return id; },
    select(next) {
      id = VISUALIZER_IDS.includes(next) ? next : 'none';
      viz = null;
      failed = false;
    },
    // The draw function for Highway, or null when nothing is selected.
    get fn() { return id === 'none' ? null : driver.draw; },
    // Brings the song data and the shared state (`driver.data`, `driver.state`: the clock, the beat, the density, star power...) up to time t. draw() does this and then
    // draws; a renderer of its own (the WebGL prototype) calls it and draws from the state. Returns false while there is nothing to draw.
    prepare(w, h, t, bgRgb, dpr = 1) {
      const src = getSource();
      if (!src?.charts?.length) return false;
      if (dataKey !== src.key) {
        dataKey = src.key;
        const prev = data;
        data = buildSongData({ song: src.song, charts: src.charts, kinds: src.kinds, layerCharts: src.layerCharts, shown: src.shown });
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
      const s = state;
      s.t = t; s.w = w; s.h = h;
      s.stage = bgRgb; // the stage colour, 'r, g, b': for effects that want to use it
      s.dpr = dpr;
      s.clock = performance.now() / 1000;
      beatInfo(data.beats, t, s.beat);
      s.beat.pulse = 0; // no punch on the beat (it read as flicker); the tempo-locked motion (beat.pos) stays
      // The tempo: `bt` is the beat count in units of a 120 BPM second (it runs faster in a fast part, slower in a slow one, continuously: the clock of every
      // motion that should follow the music's pace); `bpm` the tempo around t (over +-1.2 s, so a tempo change glides), `tempo` its ratio to the song's average.
      s.bt = s.beat.pos * 0.5;
      const bA = beatInfo(data.beats, t - 1.2, tA).pos;
      const bB = beatInfo(data.beats, t + 1.2, tB).pos;
      s.bpm = clampRange(((bB - bA) / 2.4) * 60, 30, 300);
      s.tempo = clampRange(s.bpm / (data.avgBpm || 120), 0.5, 2);
      s.beat.measurePulse = 0;
      s.density = densityAt(data.density, t);
      s.travel = travelAt(data.density, t);
      s.sp = spanAmount(data.starPower, t);
      s.solo = spanAmount(data.solos, t);
      s.vocal = vocalLevel(data.vocalNotes, t);
      s.perc = pulseAfter(data.percussion, t, 0.3);
      s.hit = data.layers.length ? Math.max(...data.layers.map((l) => (l.shown ? hitLevel(l.events, t, layerGain(l.kind)) : 0))) : hitLevel(data.events, t); // (the instruments on screen, exaggerated)
      s.section = sectionAt(data.sections, t);
      return true;
    },
    get state() { return state; },
    get data() { return data; },
    draw(g, w, h, t, bgRgb) {
      if (id === 'none' || failed) return;
      const t0 = performance.now();
      if (!driver.prepare(w, h, t, bgRgb, g.getTransform().a || 1)) return;
      if (!viz || vizFor !== id) {
        viz = VISUALIZERS.find((v) => v.id === id).create({ song: data });
        vizFor = id;
      }
      g.save();
      try {
        viz.draw(g, state); // (the blur is the CSS #bgGlass layer, not drawn here)
      } catch (err) {
        failed = true; // never take the whole chart down with a background
        console.error('Visualizer failed:', err);
      }
      g.restore();
      const ms = performance.now() - t0;
      stats[id] = stats[id] === undefined ? ms : stats[id] * 0.9 + ms * 0.1;
    },
  };
  return driver;
}
