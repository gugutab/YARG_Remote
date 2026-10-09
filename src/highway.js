// Canvas renderer for a chart. Drawing is a pure function of the playback time,
// so seek/pause just means re-rendering at a different `t`.

import {
  GUITAR_LANE_COLORS,
  KICK_COLOR,
  OPEN_COLOR,
  HARMONY_COLORS,
  KICK_BAR_HALF_H,
  DOUBLE_KICK_GAP,
  TAP_COLOR,
  ACCENT_OUTLINE_WIDTH,
  ACCENT_OUTLINE_DARKEN,
  GHOST_ALPHA,
  ROLL_COLORS,
  FADE_SEC,
  BASE_LOOKAHEAD_SEC,
  ENTRY_MARGIN_SEC,
  HIT_Y,
  firstVisibleIndex,
  tintWhite,
  darken,
  withAlpha,
} from './gfx.js';
export { firstVisibleIndex } from './gfx.js';
import { renderLanes3D } from './highway3d.js';

export class Highway {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.chart = null;
    this.maxLength = 0; // longest sustain in the current chart, in seconds
    this.view = '2d';
    this.neck = 1; // neck speed: scales distance between notes only; timing is unchanged
  }

  // '2d' (flat) or '3d' (perspective). Vocals have no highway and always use the flat view.
  setView(view) {
    this.view = view === '3d' ? '3d' : '2d';
  }

  setNeckSpeed(value) {
    this.neck = value;
  }

  setChart(chart) {
    this.chart = chart;
    this.maxLength = chart ? Math.max(0, ...chart.notes.map((n) => n.length || 0)) : 0;
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

    if (!this.chart) return; // the page shows its own welcome / loading overlay
    if (this.chart.mode === 'vocals') this.renderVocals(t, w, h);
    else if (this.view === '3d') renderLanes3D(this, t, w, h);
    else this.renderLanes(t, w, h);
  }

  renderLanes(t, w, h) {
    const g = this.g;
    const chart = this.chart;
    const laneW = Math.min(90, (w * 0.8) / chart.lanes);
    const x0 = (w - laneW * chart.lanes) / 2;
    const hitY = h * HIT_Y;
    const pxPerSec = (hitY / BASE_LOOKAHEAD_SEC) * this.neck;
    const yOf = (time) => hitY - (time - t) * pxPerSec;
    // Notes are drawn from this far ahead, so the ones past the top edge are already walking in.
    const ahead = hitY / pxPerSec + ENTRY_MARGIN_SEC;

    // star power / solo bands
    this.fillSpans(chart.starPower, t, ahead, yOf, x0, laneW * chart.lanes, h, 'rgba(60,160,255,0.12)');
    this.fillSpans(chart.solos, t, ahead, yOf, x0, laneW * chart.lanes, h, 'rgba(255,190,60,0.10)');
    // drum rolls: one band per roll type (kick roll, tremolo lane, trill lane)
    for (const [type, color] of Object.entries(ROLL_COLORS)) {
      this.fillSpans((chart.rolls || []).filter((r) => r.type === type), t, ahead, yOf, x0, laneW * chart.lanes, h, color);
    }

    // beat lines
    for (const b of chart.beats) {
      if (b.time > t + ahead) continue;
      const y = yOf(b.time);
      if (y > h) continue; // already below the screen; lines above the top are clipped by the canvas
      g.fillStyle = b.measure ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
      g.fillRect(x0, y, laneW * chart.lanes, b.measure ? 2 : 1);
    }

    // lane guides
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < chart.lanes; i++) {
      if (i % 2 === 0) g.fillRect(x0 + i * laneW, 0, laneW, hitY);
    }

    // hit line sits under the notes, so notes passing over it stay visible
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(x0 - 6, hitY, laneW * chart.lanes + 12, 3);

    // sustains first, then heads
    const from = firstVisibleIndex(chart.notes, t, this.maxLength);
    const visible = [];
    for (let i = from; i < chart.notes.length && chart.notes[i].time <= t + ahead; i++) {
      visible.push(chart.notes[i]);
    }
    const radius = Math.min(laneW * 0.36, 26);
    const colors = chart.laneColors || GUITAR_LANE_COLORS;
    // kick (lane -1) is a bar across all columns, not a column
    // pedal bars go behind the other notes and sustains
    for (const n of visible) {
      if (n.lane >= 0 && !n.open) continue;
      const past = t - n.time;
      if (past > FADE_SEC) continue;
      const k = Math.max(0, past) / FADE_SEC; // same exit animation as the other heads
      const cy = yOf(Math.max(n.time, t));
      const full = laneW * chart.lanes;
      const height = KICK_BAR_HALF_H * 2 * (1 + 0.4 * k);
      g.globalAlpha = 1 - k;
      g.fillStyle = tintWhite(n.open ? OPEN_COLOR : KICK_COLOR, k);
      // double kick: a second bar stacked above the first
      const bars = n.doubleKick ? [0, -(height + DOUBLE_KICK_GAP)] : [0];
      for (const dy of bars) g.fillRect(x0, cy + dy - height / 2, full, height);
    }
    g.globalAlpha = 1;

    for (const n of visible) {
      if (!n.length || n.lane < 0) continue;
      const yTop = yOf(n.time + n.length);
      const yBot = yOf(Math.max(n.time, t));
      if (n.open) {
        g.fillStyle = withAlpha(OPEN_COLOR, 0.35);
        g.fillRect(x0, yTop, laneW * chart.lanes, Math.max(0, yBot - yTop));
        continue;
      }
      const cx = x0 + (n.lane + 0.5) * laneW;
      g.fillStyle = withAlpha(colors[n.lane], 0.55);
      g.fillRect(cx - radius * 0.35, yTop, radius * 0.7, Math.max(0, yBot - yTop));
    }

    // Heads. Once a note reaches the hit line it stops moving and plays its exit animation:
    // it grows, fades and turns white over FADE_SEC, for pedals too.
    for (const n of visible) {
      if (n.lane < 0 || n.open) continue; // pedals and open notes are drawn above, behind the other notes
      const past = t - n.time;
      if (past > FADE_SEC) continue;
      const k = Math.max(0, past) / FADE_SEC; // 0 at the hit line, 1 when gone
      const cy = yOf(Math.max(n.time, t)); // parked on the hit line during the exit
      const white = k;
      // ghost notes are dimmed, accents are larger (YARG draws them the same way)
      g.globalAlpha = (1 - k) * (n.ghost ? GHOST_ALPHA : 1);
      const cx = x0 + (n.lane + 0.5) * laneW;
      const r = radius * (1 + 0.4 * k);
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fillStyle = tintWhite(n.tap ? TAP_COLOR : colors[n.lane], white);
      g.fill();
      // accent: same size, with a thicker outline in a darker shade of the note's colour
      g.lineWidth = n.accent ? ACCENT_OUTLINE_WIDTH : 2;
      g.strokeStyle = n.accent ? darken(colors[n.lane], ACCENT_OUTLINE_DARKEN) : 'rgba(0,0,0,0.5)';
      g.stroke();
      if (n.hopo) { // guitar HOPO: a white dot in the head
        g.beginPath();
        g.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
        g.fillStyle = `rgba(255,255,255,${0.9 * (1 - k)})`;
        g.fill();
      }
      if (n.cymbal) { // pro drums: cymbal = ring with a white outline, tom = solid pad
        g.beginPath();
        g.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        g.fillStyle = '#0d1117';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = '#ffffff';
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  // Vocals: pitch on the vertical axis, time on the horizontal axis. Lead notes are bars, harmonies
  // are lighter bars behind them, percussion is a row of diamonds, and lyrics sit under the notes.
  renderVocals(t, w, h) {
    const g = this.g;
    const chart = this.chart;
    const hitX = w * 0.15;
    const pxPerSec = (w * 0.85) / BASE_LOOKAHEAD_SEC;
    const [lo, hi] = [36, 84];
    const top = h * 0.08; // pitch area: top 8% to 76% of the canvas
    const bottom = h * 0.76;
    const yOfPitch = (p) => bottom - ((p - lo) / (hi - lo)) * (bottom - top);
    const lyricY = bottom + h * 0.04; // lyrics sit right under the note area
    const percussionY = h * 0.92;
    const xOf = (time) => hitX + (time - t) * pxPerSec;
    const ahead = BASE_LOOKAHEAD_SEC + ENTRY_MARGIN_SEC;

    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(hitX - 2, 0, 3, h);

    // harmonies first, so the lead is drawn on top
    for (const harmony of chart.harmonies || []) {
      g.fillStyle = HARMONY_COLORS[harmony.part] || HARMONY_COLORS[1];
      for (const n of harmony.notes) {
        if (n.end < t - 0.2 || n.time > t + ahead) continue;
        const x1 = xOf(n.time);
        const x2 = Math.max(x1 + 6, xOf(n.end));
        g.fillRect(x1, yOfPitch(n.pitch) - 4, x2 - x1, 8);
      }
    }

    for (const n of chart.notes) {
      if (n.end < t - 0.2 || n.time > t + ahead) continue;
      const x1 = xOf(n.time);
      const x2 = Math.max(x1 + 6, xOf(n.end));
      g.fillStyle = n.time <= t && n.end >= t ? '#f5c518' : '#5b8def';
      g.fillRect(x1, yOfPitch(n.pitch) - 6, x2 - x1, 12);
    }

    // percussion: a diamond per hit, white when played, grey when not
    for (const p of chart.percussion || []) {
      if (p.time < t - 0.2 || p.time > t + ahead) continue;
      const x = xOf(p.time);
      g.beginPath();
      g.moveTo(x, percussionY - 7);
      g.lineTo(x + 6, percussionY);
      g.lineTo(x, percussionY + 7);
      g.lineTo(x - 6, percussionY);
      g.closePath();
      g.fillStyle = p.played ? '#e6edf3' : '#6e7681';
      g.fill();
    }

    // lyrics under the notes, each at its start time
    g.font = '18px system-ui';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (const l of chart.lyrics) {
      if (l.time < t - 0.3 || l.time > t + ahead) continue;
      g.fillStyle = l.time <= t ? '#f5c518' : '#e6edf3';
      g.fillText(l.text, xOf(l.time), lyricY);
    }
    g.textBaseline = 'alphabetic';
  }

  fillSpans(spans, t, ahead, yOf, x0, width, h, color) {
    this.g.fillStyle = color;
    for (const s of spans) {
      if (s.start > t + ahead) continue;
      const top = yOf(s.end);
      const bottom = yOf(s.start);
      if (top > h || bottom < 0) continue;
      this.g.fillRect(x0, top, width, bottom - top);
    }
  }
}
