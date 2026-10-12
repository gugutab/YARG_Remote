// The performance overlay on the stage: a small chip with FPS (compact) or every meter (detailed).
// Pure DOM; app.js feeds it a PerfMeter and a few probes, and it repaints at most 4 times per second.
export const PERF_MODES = ['off', 'compact', 'detailed'];
export const PERF_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const UPDATE_MS = 250;

export function createPerfOverlay({ stage, meter, probes, onCycle }) {
  const el = document.createElement('div');
  el.className = 'perf-overlay';
  el.hidden = true;
  el.title = 'Performance meters. Click or press P to change the detail.';
  const fpsEl = document.createElement('div');
  fpsEl.className = 'perf-fps';
  const detail = document.createElement('pre');
  detail.className = 'perf-detail';
  const graph = document.createElement('canvas');
  graph.className = 'perf-graph';
  graph.width = 120; graph.height = 28;
  el.append(fpsEl, graph, detail);
  stage.append(el);
  el.addEventListener('click', () => onCycle?.());

  let mode = 'off';
  let lastPaint = 0;
  let longTasks = 0;
  try {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      new PerformanceObserver((list) => { longTasks += list.getEntries().length; }).observe({ entryTypes: ['longtask'] });
    }
  } catch { /* not supported */ }

  const color = (fps) => (fps >= 55 ? '#3fb950' : fps >= 30 ? '#d29922' : '#f85149');
  const f1 = (n) => n.toFixed(1);

  function paintGraph(series) {
    const g = graph.getContext('2d');
    g.clearRect(0, 0, graph.width, graph.height);
    const top = 50; // ms at the top of the graph
    const y = (ms) => graph.height - Math.min(1, ms / top) * graph.height;
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y(16.7)); g.lineTo(graph.width, y(16.7)); g.stroke(); // the 60 fps line
    const base = graph.width - series.length;
    series.forEach((ms, i) => {
      g.fillStyle = ms > 33 ? '#f85149' : ms > 20 ? '#d29922' : '#3fb950';
      g.fillRect(base + i, y(ms), 1, graph.height - y(ms));
    });
  }

  function paint(now) {
    const s = meter.stats();
    fpsEl.textContent = `${Math.round(s.fps)} FPS`;
    fpsEl.style.color = color(s.fps);
    if (mode !== 'detailed') return;
    paintGraph(meter.series());
    const p = probes();
    const lines = [
      `frame  avg ${f1(s.avg)}  p95 ${f1(s.p95)}  max ${f1(s.max)} ms`,
      `draw   avg ${f1(s.drawAvg)}  max ${f1(s.drawMax)} ms`,
      `dropped ${s.dropped} / ${s.samples} frames   long tasks ${longTasks}`,
      `music clock jitter  max ${s.clockMax.toFixed(1)} ms  rms ${s.clockRms.toFixed(1)} ms`,
      `canvas ${p.canvas}  dpr ${p.dpr}`,
      `panes ${p.panes}${p.notes != null ? `  notes ${p.notes}` : ''}`,
    ];
    if (p.heap) lines.push(`heap   ${p.heap}`);
    lines.push(p.latency != null ? `audio latency ${p.latency}` : 'audio latency n/a');
    detail.textContent = lines.join('\n');
  }

  return {
    setMode(m) {
      mode = PERF_MODES.includes(m) ? m : 'off';
      el.hidden = mode === 'off';
      el.dataset.mode = mode;
      lastPaint = 0;
    },
    setPosition(p) { el.dataset.pos = PERF_POSITIONS.includes(p) ? p : 'bottom-right'; },
    // Call every frame; repaints only 4 times per second and only while visible.
    tick(now) {
      if (mode === 'off' || now - lastPaint < UPDATE_MS) return;
      lastPaint = now;
      paint(now);
    },
  };
}
