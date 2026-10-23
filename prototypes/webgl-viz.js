// Prototype: the three heaviest background visualizers (Beat rings, Aurora, Warp) in two renderers over the same song state: the app's 2D canvas code (createDriver, as
// the page's background canvas runs it) and WebGL 2 ports (src/visualizers-gl.js).
//   npm start      http://localhost:8080/prototypes/webgl-viz.html?viz=aurora&mode=both&t=62&paused=1
//   params: viz=rings|aurora|warp   mode=both|canvas|webgl   t=<start seconds>   paused=1   scale=0.6 (the app draws its background at this fraction of the resolution)
//           song=<library folder>   bench=6 (a measured run of 6 s: window.__bench)
// The song's notes.mid comes from the app's server (/songs/<folder>/notes.mid); its guitar, bass, drums and vocals are the layers.
import { parseMidi } from '../src/midi.js';
import { buildChart, instrumentOptions, DIFFICULTIES } from '../src/chart.js';
import { createDriver, VISUALIZERS } from '../src/visualizers.js';
import { createAudioFeatures } from '../src/audio-features.js';
import { PORTS } from '../src/visualizers-gl.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const song = params.get('song') || 'Rock Band 1/Black Sabbath (WaveGroup) - Paranoid';
const scale = Number(params.get('scale') || 0.6);
const benchSecs = Number(params.get('bench') || 0);
const STAGE_RGB = '13, 17, 23';
$('viz').innerHTML = VISUALIZERS.filter((v) => v.id !== 'none').map((v) => `<option value="${v.id}">${v.label}${PORTS[v.id] ? ' (GL)' : ''}</option>`).join('');
$('viz').value = params.get('viz') || 'rings';
$('mode').value = params.get('mode') || 'both';

const KINDS = { guitar: 'guitar', bass: 'bass', rhythm: 'rhythm', keys: 'keys', vocals: 'mic' };
const charts = [], kinds = [];
async function load() {
  const res = await fetch(`/songs/${song.split('/').map(encodeURIComponent).join('/')}/notes.mid`);
  if (!res.ok) throw new Error(`notes.mid: ${res.status}`);
  const midi = parseMidi(new Uint8Array(await res.arrayBuffer()));
  const opts = instrumentOptions(midi);
  const diff = DIFFICULTIES[3];
  for (const id of ['guitar', 'bass', 'drums-pro', 'vocals']) {
    const ins = opts.find((o) => o.id === id);
    const chart = ins ? buildChart(midi, ins, diff, {}) : null;
    if (chart) { charts.push(chart); kinds.push(id.startsWith('drums') ? 'drum' : KINDS[id] ?? ''); }
  }
}
// A made-up sound (a kick twice a second, a snare off the beat, a pad, a hi-hat shimmer) through the real feature extractor, so the visualizers can be seen listening (?audio=0 turns it off).
const features = createAudioFeatures();
const FFT = 2048, SR = 48000, spectrumBytes = new Uint8Array(FFT / 2);
const fakeAudio = (now) => {
  if (params.get('audio') === '0') return features.update(null, 0, FFT, now);
  const bt = songTime * 2, kick = Math.exp(-(bt % 1) * 7), snare = Math.exp(-(((bt + 0.5) % 1)) * 9) * (Math.floor(bt) % 2 ? 1 : 0.3);
  for (let i = 0; i < spectrumBytes.length; i++) {
    const hz = (i * SR) / FFT;
    let v = 40 * Math.exp(-hz / 3000) + 70 * Math.exp(-((hz - 440 * (1 + Math.floor(songTime % 4) * 0.25)) ** 2) / 60000) * (0.6 + 0.4 * Math.sin(songTime * 3));
    v += 190 * kick * Math.exp(-hz / 90) + 150 * snare * Math.exp(-((hz - 1800) ** 2) / 4e6) + 60 * (0.5 + 0.5 * Math.sin(songTime * 30 + hz * 0.01)) * (hz > 6000 ? 1 : 0.2) * 0.5;
    spectrumBytes[i] = Math.max(0, Math.min(255, v));
  }
  return features.update(spectrumBytes, SR, FFT, now);
};
const driver = createDriver({ getAudio: fakeAudio, getSource: () => ({ key: 'k', song: { title: 'Paranoid', artist: 'Black Sabbath' }, charts, kinds, shown: charts.map(() => true) }) });

const c2d = $('c2d'), cgl = $('cgl');
const g2 = c2d.getContext('2d');
const gl = cgl.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2');
const ports = {};
const portFor = (id) => (ports[id] ??= PORTS[id](gl));

let playing = !params.get('paused'), songTime = Number(params.get('t') || 0), last = performance.now();
const stats = { frames: [], js2: [], jsgl: [], gpu: [] };
const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const bench = [];
let benchStart = 0, benchDone = false, gpuQuery = null;

function size(canvas, w, h) {
  const W = Math.max(2, Math.round(w * scale)), H = Math.max(2, Math.round(h * scale));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
}

function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (playing) songTime += dt;
  const mode = $('mode').value, id = $('viz').value;
  c2d.style.display = mode === 'webgl' ? 'none' : '';
  cgl.style.display = mode === 'canvas' ? 'none' : '';
  const cw = mode === 'both' ? $('stage').clientWidth / 2 : $('stage').clientWidth, ch = $('stage').clientHeight;
  let j2 = 0, jg = 0;
  if (charts.length) {
    if (mode !== 'webgl') {
      const a = performance.now();
      size(c2d, cw, ch);
      g2.setTransform(scale, 0, 0, scale, 0, 0);
      g2.clearRect(0, 0, cw, ch);
      driver.select(id);
      driver.draw(g2, cw, ch, songTime, STAGE_RGB);
      j2 = performance.now() - a;
    }
    if (mode !== 'canvas') {
      const a = performance.now();
      size(cgl, cw, ch);
      if (ext && !gpuQuery) { gpuQuery = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, gpuQuery); }
      gl.viewport(0, 0, cgl.width, cgl.height);
      gl.enable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      driver.select(id);
      if (PORTS[id] && driver.prepare(cw, ch, songTime, STAGE_RGB, 1)) portFor(id).draw(driver.state, driver.data, cw, ch, scale);
      if (ext && gpuQuery) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        const q = gpuQuery; gpuQuery = null;
        const poll = () => {
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { stats.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); if (stats.gpu.length > 300) stats.gpu.shift(); }
            gl.deleteQuery(q);
          } else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      }
      jg = performance.now() - a;
    }
  }
  stats.frames.push(dt * 1000); stats.js2.push(j2); stats.jsgl.push(jg);
  for (const k of Object.keys(stats)) if (stats[k].length > 300) stats[k].shift();
  if (benchSecs && !benchDone && charts.length) {
    if (!benchStart) benchStart = now;
    bench.push([dt * 1000, j2, jg]);
    if (now - benchStart > benchSecs * 1000) {
      benchDone = true;
      const body = bench.slice(5), d = body.map((x) => x[0]);
      const cv = mode === 'webgl' ? cgl : c2d;
      window.__bench = JSON.stringify({
        viz: id, mode, fps: +(1000 / avg(d)).toFixed(1), fps1pctLow: +(1000 / avg([...d].sort((x, y) => x - y).slice(Math.floor(d.length * 0.99)))).toFixed(1), over20ms: d.filter((x) => x > 20).length,
        jsMeanMs: +avg(body.map((x) => (mode === 'webgl' ? x[2] : x[1]))).toFixed(3), gpuMeanMs: stats.gpu.length ? +avg(stats.gpu).toFixed(3) : null, canvasPx: `${cv.width}x${cv.height}`,
      });
    }
  }
  requestAnimationFrame(frame);
}
setInterval(() => {
  const fps = 1000 / (avg(stats.frames) || 1);
  $('hud').innerHTML = `<b>${$('viz').selectedOptions[0].textContent}</b> &nbsp; ${$('mode').value} &nbsp; scale ${scale}<br>fps <b>${fps.toFixed(0)}</b><br>` +
    `2D canvas: JS <b>${avg(stats.js2).toFixed(2)} ms</b><br>WebGL: JS <b>${avg(stats.jsgl).toFixed(2)} ms</b> &nbsp; GPU <b>${stats.gpu.length ? avg(stats.gpu).toFixed(2) + ' ms' : 'n/a'}</b>`;
}, 250);
$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; });
$('play').textContent = playing ? 'Pause' : 'Play';
for (const id of ['viz', 'mode']) $(id).addEventListener('change', () => { for (const k of Object.keys(stats)) stats[k].length = 0; });
load().then(() => requestAnimationFrame(frame)).catch((e) => { $('hud').textContent = String(e.message); });
