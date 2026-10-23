// Prototype: the note highway (the 3D view with rectangular notes) drawn with WebGL 2 instead of the canvas 2D context.
//
//   python -m http.server 8130      (from the repository root), or the app's own server (npm start), which serves this folder too and adds a song picker
//   http://localhost:8130/prototypes/webgl-fretboard.html                      pick a notes.mid, or ?synth=60 for 60 synthetic notes a second
//   ...webgl-fretboard.html?midi=../path/notes.mid&parts=guitar,bass,drums-pro&diff=3&at=61&paused=1     panes side by side, a still picture at 61 s
//   ...&bench=6      a measured run of 6 s (window.__bench: fps, JS ms per frame, notes in view)
//
// What it is: a harness for GLBoard (src/highway-gl.js), the WebGL 2 renderer the app can use for its fretboards (setting highway.renderer): chart in, panes side by side
// out, a background visualizer (?viz=rings|aurora|warp), a benchmark (?bench=6) and a song picker. The drawing itself lives in src/highway-gl.js.
import { parseMidi } from '../src/midi.js';
import { buildChart, instrumentOptions, DIFFICULTIES } from '../src/chart.js';
import { GLBoard } from '../src/highway-gl.js';
import { NOTE_PALETTE, laneLookFactor } from '../src/gfx.js';
import { createDriver } from '../src/visualizers.js';
import { PORTS } from './webgl-viz-ports.js';

const DEPTH_SEC = 3.2; // seconds between the hit line and the far edge at neck speed 1 (the app's DEPTH_SEC)
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

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

// ---- the board ------------------------------------------------------------------------------------------------------------------------------------------------

const canvas = $('gl');
const board = GLBoard.create(canvas);
if (!board) { $('hud').textContent = 'WebGL 2 is not available in this browser.'; throw new Error('no WebGL 2'); }
const gl = board.gl;
// The 3D note models of YARG (prototypes/yarg-notes: notes.json from scripts/pack-note-meshes.mjs and the two textures; see NOTICE.md): loaded in the background, the checkbox "3D notes" shows them once they are there.
(async () => {
  try {
    const img = (name) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `yarg-notes/${name}.png`; });
    const [meshes, NormalNote, CymbalNote, NormalNoteShine, CymbalNoteShine] = await Promise.all([fetch('yarg-notes/notes.json').then((r) => r.json()), img('NormalNote'), img('CymbalNote'), img('NormalNoteShine'), img('CymbalNoteShine')]);
    board.setMeshes(meshes, { NormalNote, CymbalNote, NormalNoteShine, CymbalNoteShine });
  } catch (e) { console.warn('3D note models not loaded:', e); }
})();
const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const BEATS = ['rgba(255,255,255,0.5)', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0.15)']; // (the app's normal beat lines)
const curve = Number(params.get('curve') ?? 0.4);

// The background: one of the WebGL visualizer ports (webgl-viz-ports.js) on a canvas under the fretboards, fed by the charts on screen (?viz=rings|aurora|warp,
// ?vizscale=0.6: the fraction of the resolution it is drawn at, as in the app).
const bgCanvas = $('bg');
const bgGl = bgCanvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true });
const vizScale = Number(params.get('vizscale') || 0.6);
const STAGE_RGB = '11, 14, 22';
const KIND = (label) => (label.startsWith('drums') ? 'drum' : label.startsWith('vocals') ? 'mic' : label.split(/[ (]/)[0]);
const driver = createDriver({ getSource: () => ({ key: panes.map((p) => p.label).join('|'), song: { title: 'prototype', artist: '' }, charts: panes.map((p) => p.chart), kinds: panes.map((p) => KIND(p.label)), shown: panes.map(() => true) }) });
const vizPorts = {};
function renderBackground(t) {
  const id = $('viz').value;
  if (id === 'none' || !bgGl || !panes.length) { bgCanvas.style.display = 'none'; return; }
  bgCanvas.style.display = '';
  const w = bgCanvas.clientWidth, h = bgCanvas.clientHeight;
  const W = Math.max(2, Math.round(w * vizScale)), H = Math.max(2, Math.round(h * vizScale));
  if (bgCanvas.width !== W || bgCanvas.height !== H) { bgCanvas.width = W; bgCanvas.height = H; }
  bgGl.viewport(0, 0, W, H);
  bgGl.enable(bgGl.BLEND);
  bgGl.clearColor(0, 0, 0, 0);
  bgGl.clear(bgGl.COLOR_BUFFER_BIT);
  driver.select(id);
  if (driver.prepare(w, h, t, STAGE_RGB, 1)) (vizPorts[id] ??= PORTS[id](bgGl)).draw(driver.state, driver.data, w, h, vizScale);
}

// The optional effects of the board (?fx=taper,fog,... lists the ones that start on; no ?fx: the checkboxes' own state, all on but the relief road), one checkbox each.
const FX = {};
for (const box of document.querySelectorAll('[data-fx]')) {
  if (params.get('fx') !== null) box.checked = params.get('fx').split(',').includes(box.dataset.fx);
  FX[box.dataset.fx] = box.checked;
  box.addEventListener('change', () => { FX[box.dataset.fx] = box.checked; });
}

if (params.get('model')) $('model').value = params.get('model');
if (params.get('side')) $('side').value = params.get('side');

function render(t) {
  renderBackground(t);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(2, canvas.clientWidth), H = Math.max(2, canvas.clientHeight);
  board.begin(W, H, dpr, '1');
  const P = panes.length, pw = Math.floor(W / P);
  panes.forEach((p, i) => {
    const w = i === P - 1 ? W - i * pw : pw;
    board.drawPane(p.chart, t, { x: i * pw, y: 0, w, h: H }, {
      neck: Number($('neck').value), perspective: Number($('persp').value), curve, noteSize: 1, sustainWidth: 1, kickBar: 1, hitLine: params.get('hitline') !== '0', laneStripes: true,
      trackOpacity: 0.75, boardK: 1, leftHanded: params.get('lefty') === '1', heldMotion: true, starPowerBand: true, soloBand: true, fillBand: true, breBand: 'pulse', bandBorders: true,
      side: Number($('side').value), fx: { ...FX, solid: FX.solid ? $('model').value : false }, beatStyle: BEATS, windowSec: (DEPTH_SEC / Number($('neck').value)) * laneLookFactor(H),
    });
  });
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
const inView = () => board.drawn;

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
      window.__bench = JSON.stringify({ renderer: 'webgl', panes: panes.length, fps: +(1000 / avg(d)).toFixed(1), fps1pctLow: +(1000 / avg([...d].sort((x, y) => x - y).slice(Math.floor(d.length * 0.99)))).toFixed(1), over20ms: d.filter((x) => x > 20).length, jsMeanMs: +avg(j).toFixed(3), jsP95Ms: +p95(j).toFixed(3), notesInView: Math.round(avg(n)), totalNotes: panes.reduce((s, p) => s + p.chart.notes.length, 0), viewport: `${canvas.width}x${canvas.height}` });
    }
  }
  requestAnimationFrame(frame);
}

setInterval(() => {
  const fps = 1000 / (avg(stats.frames) || 1);
  $('hud').innerHTML = `<b>WebGL 2</b> &nbsp; ${panes.map((p) => `${p.label} ${p.chart.notes.length}`).join(' | ') || '…'} notes<br>` +
    `fps <b>${fps.toFixed(0)}</b> &nbsp; JS per frame <b>${avg(stats.js).toFixed(3)} ms</b> (p95 ${p95(stats.js).toFixed(3)}) &nbsp; ${panes.length} pane${panes.length === 1 ? '' : 's'}<br>` +
    `GPU per frame <b>${stats.gpu.length ? avg(stats.gpu).toFixed(3) + ' ms' : 'n/a'}</b><br>` +
    `notes in view <b>${Math.round(avg(stats.notes))}</b> &nbsp; draw calls <b>${board.calls}</b>`;
}, 250);

// ---- controls ---------------------------------------------------------------------------------------------------------------------------------------------------

function fillSelectors() {
  $('diff').innerHTML = DIFFICULTIES.map((d, i) => `<option value="${i}">${d.label || d.id}</option>`).join('');
  $('diff').value = params.get('diff') ?? '3';
  const opts = midi ? instrumentOptions(midi).filter((o) => o.id !== 'vocals') : [];
  $('partsList').innerHTML = opts.map((o) => `<option value="${o.id}">${o.label || o.id}</option>`).join('');
}
function reload() {
  for (const p of panes) board.release(p.chart);
  panes = chartsToShow().map(({ label, chart }) => ({ label, chart }));
  duration = Math.max(1, ...panes.map((p) => p.chart.duration || 0));
  $('seek').max = duration;
  songTime = Math.min(songTime, duration);
}
if (params.get('viz')) $('viz').value = params.get('viz');
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
