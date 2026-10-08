// Canvas renderer for a chart. Drawing is a pure function of the playback time,
// so seek/pause just means re-rendering at a different `t`.
const GUITAR_LANE_COLORS = ['#3fbf3f', '#e5392b', '#f5c518', '#2f80ed', '#f2861e'];
const LOOKAHEAD_SEC = 2.5; // how far ahead the highway shows notes
const HIT_Y = 0.88; // hit line position as a fraction of canvas height

export class Highway {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.chart = null;
  }

  setChart(chart) {
    this.chart = chart;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  render(t) {
    const { w, h } = this.resize();
    const g = this.g;
    g.fillStyle = '#0d1117';
    g.fillRect(0, 0, w, h);

    if (!this.chart) {
      g.fillStyle = '#8b949e';
      g.font = '16px system-ui';
      g.textAlign = 'center';
      g.fillText('Selecione uma música', w / 2, h / 2);
      return;
    }
    if (this.chart.mode === 'vocals') this.renderVocals(t, w, h);
    else this.renderLanes(t, w, h);
  }

  renderLanes(t, w, h) {
    const g = this.g;
    const chart = this.chart;
    const laneW = Math.min(90, (w * 0.8) / chart.lanes);
    const x0 = (w - laneW * chart.lanes) / 2;
    const hitY = h * HIT_Y;
    const pxPerSec = hitY / LOOKAHEAD_SEC;
    const yOf = (time) => hitY - (time - t) * pxPerSec;

    // star power / solo bands
    this.fillSpans(chart.starPower, t, yOf, x0, laneW * chart.lanes, h, 'rgba(60,160,255,0.12)');
    this.fillSpans(chart.solos, t, yOf, x0, laneW * chart.lanes, h, 'rgba(255,190,60,0.10)');

    // beat lines
    for (const b of chart.beats) {
      if (b.time < t - 0.05 || b.time > t + LOOKAHEAD_SEC) continue;
      const y = yOf(b.time);
      g.fillStyle = b.measure ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
      g.fillRect(x0, y, laneW * chart.lanes, b.measure ? 2 : 1);
    }

    // lane guides
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < chart.lanes; i++) {
      if (i % 2 === 0) g.fillRect(x0 + i * laneW, 0, laneW, hitY);
    }

    // sustains first, then heads
    const from = firstIndexAtOrAfter(chart.notes, t - 0.3);
    const visible = [];
    for (let i = from; i < chart.notes.length && chart.notes[i].time <= t + LOOKAHEAD_SEC; i++) {
      visible.push(chart.notes[i]);
    }
    const radius = Math.min(laneW * 0.36, 26);
    const colors = chart.laneColors || GUITAR_LANE_COLORS;
    for (const n of visible) {
      if (!n.length) continue;
      const cx = x0 + (n.lane + 0.5) * laneW;
      const yTop = yOf(n.time + n.length);
      const yBot = yOf(Math.max(n.time, t));
      g.fillStyle = withAlpha(colors[n.lane], 0.55);
      g.fillRect(cx - radius * 0.35, yTop, radius * 0.7, Math.max(0, yBot - yTop));
    }
    for (const n of visible) {
      if (n.time < t - 0.05) continue;
      const cx = x0 + (n.lane + 0.5) * laneW;
      const cy = yOf(n.time);
      g.beginPath();
      g.arc(cx, cy, radius, 0, Math.PI * 2);
      g.fillStyle = colors[n.lane];
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.stroke();
      if (n.cymbal) { // pro drums: cymbal = ring with a white outline, tom = solid pad
        g.beginPath();
        g.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
        g.fillStyle = '#0d1117';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = '#ffffff';
        g.stroke();
      }
    }

    // hit line
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(x0 - 6, hitY, laneW * chart.lanes + 12, 3);
  }

  renderVocals(t, w, h) {
    const g = this.g;
    const chart = this.chart;
    const hitX = w * 0.15;
    const pxPerSec = (w * 0.85) / LOOKAHEAD_SEC;
    const [lo, hi] = [36, 84];
    const yOfPitch = (p) => h * 0.9 - ((p - lo) / (hi - lo)) * h * 0.8;
    const xOf = (time) => hitX + (time - t) * pxPerSec;

    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(hitX - 2, 0, 3, h);

    for (const n of chart.notes) {
      if (n.end < t - 0.2 || n.time > t + LOOKAHEAD_SEC) continue;
      const x1 = xOf(n.time);
      const x2 = Math.max(x1 + 6, xOf(n.end));
      g.fillStyle = n.time <= t && n.end >= t ? '#f5c518' : '#5b8def';
      g.fillRect(x1, yOfPitch(n.pitch) - 6, x2 - x1, 12);
    }

    g.font = '18px system-ui';
    g.textAlign = 'left';
    g.fillStyle = '#e6edf3';
    for (const l of chart.lyrics) {
      if (l.time < t - 0.3 || l.time > t + LOOKAHEAD_SEC) continue;
      g.fillText(l.text, xOf(l.time), h * 0.06);
    }
  }

  fillSpans(spans, t, yOf, x0, width, h, color) {
    this.g.fillStyle = color;
    for (const s of spans) {
      if (s.end < t - 0.1 || s.start > t + LOOKAHEAD_SEC) continue;
      const top = yOf(s.end);
      const bottom = yOf(s.start);
      this.g.fillRect(x0, top, width, Math.max(0, Math.min(h, bottom) - Math.max(0, top)));
    }
  }
}

function firstIndexAtOrAfter(notes, time) {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < time) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
