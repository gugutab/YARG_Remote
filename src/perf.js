// Rolling-window performance collector (no DOM). Feed it one call per animation frame with a timestamp (ms)
// and the time the highway draw took (ms); read the numbers with stats().
export const WINDOW_MS = 1000; // the span fps, drops and draw times are averaged over
export const HISTORY = 120; // frame times kept for the graph

export class PerfMeter {
  constructor({ windowMs = WINDOW_MS, history = HISTORY } = {}) {
    this.windowMs = windowMs;
    this.size = history;
    this.last = null; // previous frame timestamp
    this.frames = []; // { at, dt, draw } inside the window
    this.ring = new Float32Array(history); // last frame times, oldest overwritten
    this.count = 0; // frames recorded in total
  }

  // `at`: frame timestamp (ms); `draw`: ms spent in the highway render for this frame.
  frame(at, draw = 0) {
    if (this.last !== null) {
      const dt = at - this.last;
      this.frames.push({ at, dt, draw });
      this.ring[this.count % this.size] = dt;
      this.count++;
    }
    this.last = at;
    const min = at - this.windowMs;
    let drop = 0;
    while (drop < this.frames.length && this.frames[drop].at < min) drop++;
    if (drop) this.frames.splice(0, drop);
  }

  // Frame times in order, oldest first (at most `history`).
  series() {
    const n = Math.min(this.count, this.size);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.ring[(this.count - n + i) % this.size];
    return out;
  }

  stats() {
    const f = this.frames;
    if (!f.length) return { fps: 0, avg: 0, p95: 0, max: 0, dropped: 0, drawAvg: 0, drawMax: 0, samples: 0 };
    const dts = f.map((x) => x.dt);
    const sorted = [...dts].sort((a, b) => a - b);
    const sum = dts.reduce((a, b) => a + b, 0);
    const median = sorted[Math.floor(sorted.length / 2)];
    const dropped = dts.filter((d) => d > 25 || d > median * 1.5).length;
    const draws = f.map((x) => x.draw);
    return {
      fps: sum > 0 ? (f.length * 1000) / sum : 0,
      avg: sum / f.length,
      p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
      max: sorted[sorted.length - 1],
      dropped,
      drawAvg: draws.reduce((a, b) => a + b, 0) / draws.length,
      drawMax: Math.max(...draws),
      samples: f.length,
    };
  }

  reset() { this.last = null; this.frames = []; this.count = 0; }
}
