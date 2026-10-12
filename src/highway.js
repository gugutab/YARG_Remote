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
  FILL_COLORS,
  FADE_SEC,
  BASE_LOOKAHEAD_SEC,
  ENTRY_MARGIN_SEC,
  HIT_Y,
  firstVisibleIndex,
  tintWhite,
  darken,
  withAlpha,
  firstIndexAtOrAfter,
  exitTime,
  heldAmount,
  HIT_FLASH_SEC,
  BAR_FLASH_SEC,
  PAD_FILL_ALPHA,
  PAD_RING_ALPHA,
  noteShape,
  fillHalo,
  fillTailHalo,
  noteScale,
  noteColor,
  tailShimmer,
  heldPulse,
} from './gfx.js';
export { firstVisibleIndex } from './gfx.js';
import { renderLanes3D } from './highway3d.js';
import { buildKaraokeLines, karaokeAt, syllableProgress } from './karaoke.js';
import { waitCountdowns, countdownAt } from './countdown.js';

const RECT_WIDEN_2D = 1.18;
const VOCAL_LEAD = '#5b8def'; // lead vocal notes

export class Highway {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.chart = null;
    this.maxLength = 0; // longest sustain in the current chart, in seconds
    this.view = '2d';
    this.noteStyle = 'round'; // 'round' or 'rect' (rounded rectangles)
    this.neck = 1.2; // neck speed (the app default): scales distance between notes only; timing is unchanged
    this.bg = '#0d1117'; // chart background and the colour its fades dissolve into (the theme's "stage" colour)
    this.bgRgb = '13, 17, 23';
    this.panes = []; // every chart on screen: [{ chart, label, maxLength, vRange }]; vocals draw across the top, the rest side by side
    this.paneMin = 280; // narrowest a fretboard may get before the others move out of view (swipe to bring them in)
    this.focus = 0; // first fretboard in view when they do not all fit
    this.perScreen = 1;
    this.sheets = []; // the lyric sheets on screen this frame: { x, y, w, h, step, hits, state } (canvas coordinates)
    this.countdowns = true; // show the wait countdowns
    this.weights = {}; // relative width of each fretboard, by pane key (dragging the dividers between them changes it)
    this.vocalH = null; // height of the vocal band in px, once the user dragged its divider (null: the default)
    this.dividers = []; // the draggable dividers drawn this frame
    this.hover = null; // the divider under the pointer
    this.sheetPeek = 0.12; // share of a lyric sheet's height that shows the lines before the one in focus
    this.delay = 0; // the chart delay, so times shown on the lyrics match the seek bar
    this.pointer = null; // the pointer over the canvas, for the "play from here" button on the lyrics: { x, y, t0, key, shown }
    this.onResize = null; // called when a drag ends, so the page can keep the sizes
    this.layout = { w: 0, sum: 1, keys: [] };
    this.vocalView = 'track'; // 'track' (notes + lyrics) or 'karaoke' (the lyrics alone)
  }

  setBackground(hex) {
    const n = parseInt(hex.slice(1), 16);
    this.bg = hex;
    this.bgRgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }

  // '2d' (flat) or '3d' (perspective). Vocals have no highway and always use the flat view.
  setView(view) {
    this.view = view === '3d' ? '3d' : '2d';
  }

  setNoteStyle(style) {
    this.noteStyle = style === 'rect' ? 'rect' : 'round';
  }

  setNeckSpeed(value) {
    this.neck = value;
  }

  setChart(chart) {
    this.setCharts(chart ? [{ chart }] : []);
  }

  // items: [{ chart, label }]. The first lane chart keeps the view when the others do not fit.
  setCharts(items) {
    this.panes = items.map(({ chart, label, key }) => {
      markStarPowerNotes(chart);
      return { chart, label: label ?? '', key: key ?? label ?? '', maxLength: Math.max(0, ...chart.notes.map((n) => n.length || 0)), vRange: null }; // the vocal range is re-fitted per chart
    });
    this.chart = this.panes[0]?.chart ?? null;
    this.focus = 0;
  }

  setPaneMin(px) {
    this.paneMin = Math.max(120, px);
  }

  setVocalView(view) {
    this.vocalView = view === 'karaoke' ? 'karaoke' : 'track';
  }

  laneCount() {
    return this.panes.filter((p) => p.chart.mode !== 'vocals').length;
  }

  // Swipe: brings the next (or previous) fretboard into view when they do not all fit. Returns whether it moved.
  shiftFocus(delta) {
    const total = this.laneCount();
    const next = Math.max(0, Math.min(Math.max(0, total - this.perScreen), this.focus + delta));
    const moved = next !== this.focus;
    this.focus = next;
    return moved;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // phones report 3+; 2 is plenty and keeps the fill rate low
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
    g.fillStyle = this.bg;
    g.fillRect(0, 0, w, h);

    this.sheets = [];
    this.dividers = [];
    if (!this.panes.length) return; // the page shows its own welcome / loading overlay
    const vocal = this.panes.find((p) => p.chart.mode === 'vocals');
    const lanes = this.panes.filter((p) => p.chart.mode !== 'vocals');
    const many = this.panes.length > 1;
    if (!lanes.length) { // vocals alone
      this.vocalAlone = true;
      if (this.vocalView === 'karaoke') this.drawPane(vocal, t, 0, 0, w, h, many); // the lyrics fill the stage (renderKaraoke)
      else { // the chart keeps the height it has next to other charts; the rest of the lyrics fill the space below
        const vh = this.bandHeight(h, Math.min(h * 0.34, 280));
        this.drawPane(vocal, t, 0, 0, w, vh, many);
        this.drawDivider({ type: 'row', y: vh - 1, w });
        g.save();
        g.beginPath();
        g.rect(0, vh, w, h - vh);
        g.clip();
        g.translate(0, vh);
        if ((vocal.chart.lyrics2 || []).length > 0) this.renderSheetsSplit(t, w, h - vh, vocal, 0, vh); // harmony: one sheet per voice
        else this.renderLyricSheet(t, w, h - vh, this.karaokeLines(vocal, 'main'), this.sheetState(vocal, 'main'), 0, vh, this.lyricCtx(vocal));
        g.restore();
      }
      this.vocalAlone = false;
      return;
    }
    let top = 0;
    if (vocal) { // vocals use the top of the other tracks
      top = this.bandHeight(h, (this.vocalView === 'karaoke' ? Math.min(h * 0.3, 230) : Math.min(h * 0.34, 280)) - 20); // 20 px shorter than the band of vocals alone
      this.drawPane(vocal, t, 0, 0, w, top, many);
      this.drawDivider({ type: 'row', y: top - 1, w });
    }
    const per = Math.max(1, Math.min(lanes.length, Math.floor(w / this.paneMin)));
    this.perScreen = per;
    this.focus = Math.max(0, Math.min(this.focus, lanes.length - per));
    const shown = lanes.slice(this.focus, this.focus + per);
    const weightOf = (pane) => this.weights[pane.key] ?? 1;
    const sum = shown.reduce((acc, pane) => acc + weightOf(pane), 0);
    this.layout = { w, sum, keys: shown.map((pane) => pane.key) };
    let x = 0;
    shown.forEach((pane, i) => {
      const pw = (w * weightOf(pane)) / sum;
      this.drawPane(pane, t, x, top, pw, h - top, many);
      if (i > 0) this.drawDivider({ type: 'col', x: Math.round(x), y: top, h: h - top, a: shown[i - 1].key, b: pane.key });
      x += pw;
    });
    if (lanes.length > per) this.drawPaneDots(lanes.length, per, w, h);
  }

  // The height of the vocal band: the default, or what the user dragged it to (kept within sensible limits).
  bandHeight(h, fallback) {
    const base = this.vocalH ?? fallback;
    return Math.round(Math.max(90, Math.min(h - 160, base)));
  }

  // A divider between two panes: a thin line, brighter while the pointer is over it or it is being dragged.
  drawDivider(d) {
    const g = this.g;
    const hot = this.hover && this.hover.type === d.type && this.hover.a === d.a && this.hover.b === d.b;
    this.dividers.push(d);
    g.fillStyle = hot ? 'rgba(108,182,255,0.9)' : 'rgba(255,255,255,0.12)';
    if (d.type === 'row') g.fillRect(0, d.y, d.w, hot ? 3 : 1);
    else g.fillRect(d.x - (hot ? 1 : 0), d.y, hot ? 3 : 1, d.h);
  }

  // The divider under the canvas point (x, y), within `slop` px, or null.
  dividerAt(x, y, slop = 6) {
    return this.dividers.find((d) => (d.type === 'row' ? Math.abs(y - d.y) <= slop : Math.abs(x - d.x) <= slop && y >= d.y && y <= d.y + d.h)) ?? null;
  }

  // Drag a divider by (dx, dy) px: a column divider moves width between its two fretboards, a row divider changes the band height.
  dragDivider(d, dx, dy) {
    if (d.type === 'row') {
      const h = this.canvas.clientHeight;
      this.vocalH = Math.round(Math.max(90, Math.min(h - 160, (this.vocalH ?? d.y + 1) + dy)));
      return;
    }
    const { w, sum } = this.layout;
    const perWeight = w / sum; // px per unit of weight
    const wa = (this.weights[d.a] ?? 1) * perWeight;
    const wb = (this.weights[d.b] ?? 1) * perWeight;
    const min = Math.min(140, (wa + wb) / 2);
    const na = Math.max(min, Math.min(wa + wb - min, wa + dx));
    this.weights[d.a] = na / perWeight;
    this.weights[d.b] = (wa + wb - na) / perWeight;
  }

  // Back to the default sizes (double click on a divider: just that one; no argument: all).
  resetSizes(d) {
    if (!d) { this.weights = {}; this.vocalH = null; return; }
    if (d.type === 'row') this.vocalH = null;
    else { delete this.weights[d.a]; delete this.weights[d.b]; }
  }

  getSizes() {
    return { weights: this.weights, vocalH: this.vocalH };
  }

  setSizes(sizes) {
    this.weights = sizes?.weights && typeof sizes.weights === 'object' ? { ...sizes.weights } : {};
    this.vocalH = Number.isFinite(sizes?.vocalH) ? sizes.vocalH : null;
  }

  // One chart in the rectangle (x, y, pw, ph): the drawing code sees a canvas of that size.
  drawPane(pane, t, x, y, pw, ph, labelled) {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(x, y, pw, ph);
    g.clip();
    g.translate(x, y);
    this.chart = pane.chart;
    this.maxLength = pane.maxLength;
    this.vRange = pane.vRange;
    if (pane.chart.mode === 'vocals') {
      if (this.vocalView === 'karaoke') this.renderKaraoke(t, pw, ph, pane);
      else this.renderVocals(t, pw, ph);
    } else if (this.view === '3d') renderLanes3D(this, t, pw, ph);
    else this.renderLanes(t, pw, ph);
    pane.vRange = this.vRange;
    if (!(pane.chart.mode === 'vocals' && this.vocalView === 'karaoke')) this.drawCountdown(pane, t, pw, ph);
    if (labelled && pane.label) {
      g.font = '600 12px system-ui';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      const tw = g.measureText(pane.label).width;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath();
      if (g.roundRect) g.roundRect(8, 8, tw + 16, 22, 11);
      else g.rect(8, 8, tw + 16, 22);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillText(pane.label, 16, 19);
      g.textBaseline = 'alphabetic';
    }
    g.restore();
  }

  // The wait countdown: while the chart has nothing to play for 9 s or more, the seconds until its next note, in a ring that
  // empties (YARG's WaitCountdown). Drawn over the pane's centre.
  // The rests of the lyric views (karaoke): percussion hits are no singing.
  lyricGaps(pane) {
    pane.countdownsLyrics ??= waitCountdowns(pane.chart, { percussion: false });
    return this.countdowns ? pane.countdownsLyrics : [];
  }

  // What the sheet's side rail shows: the rests (also when the countdowns are off), the percussion sections and the length.
  lyricCtx(pane) {
    pane.railCtx ??= (() => {
      const hits = (pane.chart.percussion || []).map((x) => x.time).sort((a, b) => a - b);
      const perc = [];
      let startI = 0;
      for (let k = 1; k <= hits.length; k++) {
        if (k === hits.length || hits[k] - hits[k - 1] > 3) { // a section: hits at most 3 s apart, at least 4 of them
          if (k - startI >= 4) perc.push({ start: hits[startI], end: hits[k - 1] });
          startI = k;
        }
      }
      const lines = this.karaokeLines(pane, 'main');
      const duration = Math.max(pane.chart.duration || 0, lines.length ? lines[lines.length - 1].end : 0, hits.length ? hits[hits.length - 1] : 0, 1);
      return { pauses: waitCountdowns(pane.chart, { percussion: false }), perc, duration };
    })();
    return { gaps: this.lyricGaps(pane), ...pane.railCtx };
  }

  // The countdown running for a pane at `t`: { remaining, total } or null.
  countdownState(pane, t, lyrics = false) {
    if (!this.countdowns) return null;
    if (lyrics) pane.countdownsLyrics ??= waitCountdowns(pane.chart, { percussion: false }); // karaoke: percussion hits are no singing
    else pane.countdowns ??= waitCountdowns(pane.chart);
    const c = countdownAt(lyrics ? pane.countdownsLyrics : pane.countdowns, t);
    return c && c.remaining >= 0.25 ? c : null;
  }

  // The countdown badge: a ring that empties around the seconds left, centred at (cx, cy).
  drawCountdownBadge(cx, cy, r, c) {
    const g = this.g;
    const fadeIn = Math.min(1, (c.total - c.remaining) / 0.5); // eases in at the start of the gap, out as the notes return
    const fadeOut = Math.min(1, c.remaining / 0.6);
    const secs = c.dim ? Math.round(c.total) : Math.ceil(c.remaining); // a dim badge (past / future) shows the length of the rest
    const urgent = !c.dim && c.remaining <= 3.05;
    g.save();
    g.globalAlpha *= c.dim ?? Math.min(fadeIn, fadeOut);
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(8,11,16,0.72)';
    g.fill();
    g.lineWidth = Math.max(3, r * 0.1);
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.stroke();
    g.beginPath(); // what is left of the gap
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (c.remaining / c.total));
    g.strokeStyle = c.dim ? '#7d8590' : urgent ? '#13f0a6' : '#6cb6ff'; // past and future countdowns are all grey
    g.lineCap = 'round';
    g.stroke();
    g.fillStyle = c.dim ? '#8b949e' : urgent ? '#13f0a6' : '#ffffff';
    g.font = `700 ${Math.round(r * 1.05)}px system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(secs), cx, cy + r * 0.04);
    g.textBaseline = 'alphabetic';
    g.restore();
  }

  // The vertical middle of the vocal chart: of the whole band, or of what is below the second lyric line (harmony charts).
  vocalCenterY(chart, h) {
    if (!(chart.lyrics2 || []).length) return h / 2;
    const secondSize = Math.max(15, Math.min(26, h * 0.08));
    const top = secondSize * 0.85 + 6 + secondSize * 0.75;
    return (top + h) / 2;
  }

  // The wait countdown of a chart pane (YARG's WaitCountdown), over the centre; in the vocal notes view it sits to the left of
  // the hit line, where the notes are not. (Karaoke shows it beside the next line instead, see renderLyricSheet.)
  drawCountdown(pane, t, w, h) {
    const c = this.countdownState(pane, t);
    if (!c) return;
    if (pane.chart.mode === 'vocals') {
      const hitX = w * 0.15;
      const r = Math.max(18, Math.min(hitX * 0.4, h * 0.2, 60));
      this.drawCountdownBadge(hitX / 2, this.vocalCenterY(pane.chart, h), r, c); // same height as the percussion
      return;
    }
    this.drawCountdownBadge(w / 2, h * 0.4, Math.max(26, Math.min(h * 0.2, w * 0.2, 70)), c);
  }

  // Small dots at the bottom: how many fretboards there are and which ones are in view (swipe sideways to change).
  drawPaneDots(total, per, w, h) {
    const g = this.g;
    const gap = 14;
    const x0 = w / 2 - ((total - 1) * gap) / 2;
    for (let i = 0; i < total; i++) {
      const on = i >= this.focus && i < this.focus + per;
      g.beginPath();
      g.arc(x0 + i * gap, h - 10, on ? 4 : 3, 0, Math.PI * 2);
      g.fillStyle = on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
      g.fill();
    }
  }

  // One karaoke line centred at cy: white, with the sung part filled teal (progressAt = the time, or null for a waiting line).
  drawKaraokeLine(line, size, w, cy, alpha, progressAt) {
    const g = this.g;
    const width = (s) => {
      g.font = `700 ${s}px system-ui`;
      const gw = g.measureText(' ').width;
      let total = 0;
      for (const syl of line.syl) total += g.measureText(syl.text).width + (syl.join ? 0 : gw);
      return total - gw;
    };
    let sz = size;
    while (width(sz) > w * 0.92 && sz > 12) sz -= 1;
    const total = width(sz); // leaves the font set
    const gw = g.measureText(' ').width;
    let x = (w - total) / 2;
    const prog = progressAt === null ? null : syllableProgress(line, progressAt);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    line.syl.forEach((syl, i) => {
      const sw = g.measureText(syl.text).width;
      g.lineWidth = Math.max(3, sz * 0.14);
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.strokeText(syl.text, x, cy);
      g.fillStyle = `rgba(255,255,255,${alpha})`;
      g.fillText(syl.text, x, cy);
      const p = prog ? prog[i] : 0;
      if (p > 0) { // the sung part
        g.save();
        g.beginPath();
        g.rect(x, cy - sz, sw * p, sz * 2);
        g.clip();
        g.fillStyle = '#13f0a6';
        g.fillText(syl.text, x, cy);
        g.restore();
      }
      x += sw + (syl.join ? 0 : gw);
    });
    g.textBaseline = 'alphabetic';
    return { x: (w - total) / 2, total };
  }

  // Lines of a lyric list, cached per pane. 'main' = the merged static lyrics (YARG's), 'v1' = the lead voice's own words,
  // 'v2' = the other voices' own words (harmony charts).
  karaokeLines(pane, key = 'main') {
    pane.kl ??= {};
    if (!pane.kl[key]) {
      const c = pane.chart;
      pane.kl[key] = key === 'v2' ? buildKaraokeLines(c.lyrics2 || [])
        : key === 'v1' ? buildKaraokeLines(c.lyrics1?.length ? c.lyrics1 : c.lyrics || [])
          : buildKaraokeLines(c.lyrics || [], c.phrases);
    }
    return pane.kl[key];
  }

  sheetState(pane, key) {
    pane.ss ??= {};
    return (pane.ss[key] ??= { pos: null, manual: 0, touched: 0, at: 0 });
  }

  // The rows of a lyric sheet: the lines, with a countdown row before each line that follows a long rest (every rest, the
  // ones already gone and the ones to come, not only the running one). `gaps` are the wait countdowns without percussion.
  sheetRows(lines, gaps) {
    const rows = [];
    let gi = 0;
    for (let i = 0; i < lines.length; i++) {
      let best = null;
      while (gi < gaps.length && gaps[gi].end <= lines[i].start + 0.3) { // the rests that end where this line starts
        const gap = gaps[gi++];
        if (!best || gap.end - gap.start > best.end - best.start) best = gap;
      }
      if (best) rows.push({ type: 'cd', gap: best, before: i });
      rows.push({ type: 'line', i });
    }
    return rows;
  }

  // A lyric sheet that scrolls, drawn at the current origin of the canvas (which sits at x0, y0 of the whole canvas): it
  // follows the line being sung (that line is filled as it goes, and bigger); wheel / drag moves it by hand and it glides
  // back to the singer a few seconds after you stop. Clicking a line seeks to it. Rests of 9 s or more get a countdown row
  // between the lines: ring and seconds counting down while it runs, the length of the rest before and after.
  renderLyricSheet(t, w, h, lines, state, x0 = 0, y0 = 0, ctx = { gaps: [], pauses: [], perc: [], duration: 1 }) {
    const gaps = ctx.gaps;
    const g = this.g;
    const sheet = { x: x0, y: y0, w, h, step: 0, hits: [], state };
    this.sheets.push(sheet);
    if (!lines.length) {
      g.font = '600 16px system-ui';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText('No lyrics here', w / 2, h / 2);
      return;
    }
    if (state.rowsFor !== lines || state.rowsGaps !== gaps) { // rebuilt when the lyrics change
      state.rows = this.sheetRows(lines, gaps);
      state.rowOfLine = new Map(state.rows.map((row, r) => [row.type === 'line' ? row.i : -1 - r, r]));
      state.rowsFor = lines;
      state.rowsGaps = gaps;
    }
    const rows = state.rows;
    const rowOf = (i) => state.rowOfLine.get(i) ?? 0;
    let idx = -1;
    for (let i = 0; i < lines.length && lines[i].start <= t + 0.25; i++) idx = i;
    const singing = idx >= 0 && t <= lines[idx].end + 2.5;
    const first = singing ? idx : idx + 1;
    let focusRow = Math.min(rows.length - 1, rowOf(Math.min(first, lines.length - 1)));
    const before = rows[focusRow - 1]; // a running countdown right before the next line takes the focus
    if (!singing && before?.type === 'cd' && t >= before.gap.start && t < before.gap.end) focusRow -= 1;
    const now = performance.now();
    const dt = Math.min(0.25, (now - (state.at || now)) / 1000);
    state.at = now;
    if (state.lastT != null && Math.abs(t - state.lastT) > 1.5) state.following = true; // the music jumped (a seek): follow it again
    state.lastT = t;
    if (state.following === false) state.hold = Math.max(0, Math.min(rows.length - 1, state.hold ?? focusRow)); // the sheet stays where you put it
    const target = state.following === false ? state.hold : focusRow;
    if (state.pos == null || !Number.isFinite(state.pos) || Math.abs(target - state.pos) > 40) state.pos = target;
    else state.pos += (target - state.pos) * (1 - Math.exp(-dt / 0.12));
    // Sizes: the font stays the same (it does not follow the height) while the previous, current and next lines fit; it only
    // shrinks when they cannot.
    const peekPx = h * this.sheetPeek; // how much of the lines before the focus shows at the top: a share of the sheet's height
    let big = Math.max(18, Math.min(46, w * 0.06));
    let small = Math.max(14, big * 0.72);
    let step = Math.max(small * 1.55, big * 1.15);
    while (big > 16 && peekPx - small * 0.5 + step * 2 + small * 0.6 > h) {
      big -= 2;
      small = Math.max(12, big * 0.72);
      step = Math.max(small * 1.55, big * 1.15);
    }
    sheet.step = step;
    const top = peekPx - small * 0.5 + step; // where the row in focus sits (the row before it ends `peekPx` from the top)
    const badgeR = Math.max(14, Math.min(step * 0.38, 30));
    let hovered = null; // the row under the resting pointer, if any
    let seenFrom = Infinity;
    let seenTo = -Infinity; // the time range of the lines on screen, for the rail
    const from = Math.max(0, Math.floor(state.pos) - 1 - Math.ceil(peekPx / step));
    for (let r = from; r < rows.length; r++) {
      const y = top + (r - state.pos) * step;
      if (y - step / 2 > h) break;
      if (y + small * 0.7 < 0) continue; // only rows fully above the edge are skipped: the one before the focus shows its lower half
      const row = rows[r];
      if (row.type === 'cd') {
        const { start, end } = row.gap;
        const total = end - start;
        if (t >= start && t < end) {
          if (end - t >= 0.25) this.drawCountdownBadge(w / 2, y, badgeR, { remaining: end - t, total });
        } else this.drawCountdownBadge(w / 2, y, badgeR, { remaining: total, total, dim: t >= end ? 0.28 : 0.55 }); // past / to come
        sheet.hits.push({ y: y + y0, half: step / 2, time: start });
        hovered = this.hoverRow(sheet, x0, y0, y, step, start, w / 2 + badgeR) ?? hovered;
        continue;
      }
      const i = row.i;
      seenFrom = Math.min(seenFrom, lines[i].start);
      seenTo = Math.max(seenTo, lines[i].end);
      const cur = singing && i === idx;
      const past = i < first ? 0.3 : Math.max(0.3, 0.7 - Math.max(0, i - first) * 0.06);
      const shown = this.drawKaraokeLine(lines[i], cur ? big : small, w, y, cur ? 0.95 : past, cur ? t : null);
      sheet.hits.push({ y: y + y0, half: step / 2, time: lines[i].start });
      hovered = this.hoverRow(sheet, x0, y0, y, step, lines[i].start, shown.x + shown.total) ?? hovered;
    }
    const fade = Math.min(92, h * 0.32); // the lines dissolve into the background at the top and bottom edges: opaque at the very edge, easing out
    const ramp = []; // [position from the edge, opacity of the background]: opaque at the very edge, then a smootherstep over the whole band, which eases both ends
    for (let n = 0; n <= 16; n++) {
      const pos = n / 16;
      const u = Math.pow(pos, 0.7); // spreads the fade over the whole band: the text is covered at the very edge and fully back where the band ends
      ramp.push([pos, 1 - u * u * u * (u * (u * 6 - 15) + 10)]);
    }
    const fadeIn = g.createLinearGradient(0, 0, 0, fade);
    const fadeOut = g.createLinearGradient(0, h, 0, h - fade);
    for (const [pos, alpha] of ramp) {
      fadeIn.addColorStop(pos, `rgba(${this.bgRgb},${alpha})`);
      fadeOut.addColorStop(pos, `rgba(${this.bgRgb},${alpha})`);
    }
    g.fillStyle = fadeIn;
    g.fillRect(0, 0, w, fade);
    g.fillStyle = fadeOut;
    g.fillRect(0, h - fade, w, fade);
    // The jump button: it slides and fades in when the pointer has rested on a row, and out when it leaves.
    const jump = (this.jump ??= { k: 0, target: 0, spec: null, at: 0 });
    const sheetKey = `${x0},${y0}`;
    if (hovered && this.pointer?.shown && this.pointer.key === hovered.key) {
      const label = this.fmtTime(hovered.time + this.delay); // the time it jumps to, as the seek bar shows it
      g.font = '600 12.5px system-ui';
      const bw = g.measureText(label).width + 44;
      const bh = 26;
      jump.spec = { key: sheetKey, label, bw, bh, bx: Math.min(hovered.right + 16, w - bw - 34), by: hovered.y - bh / 2, time: hovered.time }; // right of the text, clear of the rail
      jump.target = 1;
    } else if (jump.spec?.key === sheetKey) jump.target = 0;
    if (jump.spec?.key === sheetKey) {
      const nowJ = performance.now();
      const dtJ = Math.min(0.1, (nowJ - (jump.at || nowJ)) / 1000);
      jump.at = nowJ;
      jump.k += (jump.target - jump.k) * (1 - Math.exp(-dtJ / 0.07));
      if (jump.target === 0 && jump.k < 0.02) jump.spec = null;
      else {
        const { label, bw, bh, bx, by } = jump.spec;
        const pt = this.pointer;
        const hot = jump.target === 1 && !!pt && pt.x >= x0 + bx && pt.x <= x0 + bx + bw && pt.y >= y0 + by && pt.y <= y0 + by + bh; // the pointer is on the button
        const k = jump.k;
        g.save();
        g.globalAlpha = k;
        g.translate(bx + bw / 2 - (1 - k) * 10, by + bh / 2); // comes in from the left, growing
        g.scale(0.82 + 0.18 * k, 0.82 + 0.18 * k);
        g.translate(-(bx + bw / 2), -(by + bh / 2));
        g.fillStyle = hot ? 'rgba(58,92,140,0.98)' : 'rgba(30,40,55,0.95)';
        g.beginPath();
        if (g.roundRect) g.roundRect(bx, by, bw, bh, 13);
        else g.rect(bx, by, bw, bh);
        g.fill();
        g.lineWidth = hot ? 1.5 : 1;
        g.strokeStyle = hot ? '#9fd0ff' : 'rgba(108,182,255,0.6)';
        g.stroke();
        g.fillStyle = hot ? '#ffffff' : '#cfe6ff';
        g.fillRect(bx + 11, by + bh / 2 - 5, 2, 10); // the jump-to icon: a triangle running to a bar
        g.beginPath();
        g.moveTo(bx + 16, by + bh / 2 - 5);
        g.lineTo(bx + 16, by + bh / 2 + 5);
        g.lineTo(bx + 24, by + bh / 2);
        g.closePath();
        g.fill();
        g.font = '600 12.5px system-ui';
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(label, bx + 31, by + bh / 2 + 1);
        g.textBaseline = 'alphabetic';
        g.restore();
        if (jump.target === 1 && k > 0.5) sheet.playBtn = { x: x0 + bx, y: y0 + by, w: bw, h: bh, time: jump.spec.time };
      }
    }
    this.drawSheetRail(t, w, h, ctx, rows, lines, seenFrom, seenTo);
    if (state.following === false) { // back to following the singer
      const label = 'Autoscroll';
      g.font = '600 13px system-ui';
      const bw = g.measureText(label).width + 28;
      const bh = 30;
      const bx = (w - bw) / 2;
      const by = h - bh - 14;
      g.fillStyle = 'rgba(30,40,55,0.92)';
      g.beginPath();
      if (g.roundRect) g.roundRect(bx, by, bw, bh, 15);
      else g.rect(bx, by, bw, bh);
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(108,182,255,0.7)';
      g.stroke();
      g.fillStyle = '#cfe6ff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, bx + bw / 2, by + bh / 2 + 1);
      g.textBaseline = 'alphabetic';
      sheet.button = { x: x0 + bx, y: y0 + by, w: bw, h: bh };
    }
  }

  // The rail at the right edge of a sheet: the whole song top to bottom, like a seek bar you cannot touch. Shows how far the
  // song is (fill and a marker with the percentage), the rests (grey bands), the percussion sections (light bands), where
  // the singing enters again (green ticks) and the part of the song the sheet shows now (the bracket).
  drawSheetRail(t, w, h, ctx, rows, lines, seenFrom, seenTo) {
    const g = this.g;
    const dur = ctx.duration;
    if (!(dur > 0) || h < 80) return;
    const rx = w - 18;
    const rw = 6;
    const y0 = 12;
    const y1 = h - 12;
    const yOf = (time) => y0 + (Math.max(0, Math.min(dur, time)) / dur) * (y1 - y0);
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(rx, y0, rw, y1 - y0);
    g.fillStyle = 'rgba(108,182,255,0.28)'; // how much of the song has played
    g.fillRect(rx, y0, rw, Math.max(0, yOf(t) - y0));
    for (const gap of ctx.pauses) { // rests
      g.fillStyle = 'rgba(139,148,158,0.55)';
      g.fillRect(rx, yOf(gap.start), rw, Math.max(2, yOf(gap.end) - yOf(gap.start)));
    }
    for (const sec of ctx.perc) { // percussion sections
      g.fillStyle = 'rgba(230,237,243,0.8)';
      g.fillRect(rx + 1, yOf(sec.start), rw - 2, Math.max(2, yOf(sec.end) - yOf(sec.start)));
    }
    g.fillStyle = '#13f0a6';
    for (const row of rows) { // entries: the singing starts after a rest
      if (row.type === 'cd') g.fillRect(rx - 7, Math.round(yOf(row.gap.end)), 6, 2);
    }
    if (seenTo > seenFrom) { // what the sheet shows now
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1;
      g.strokeRect(rx - 2.5, yOf(seenFrom), rw + 5, Math.max(6, yOf(seenTo) - yOf(seenFrom)));
    }
    const my = yOf(t); // where the song is
    g.fillStyle = '#ffffff';
    g.fillRect(rx - 3, my - 1, rw + 6, 2);
    g.font = '600 10px system-ui';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(`${Math.round(Math.max(0, Math.min(1, t / dur)) * 100)}%`, rx - 10, Math.min(y1 - 6, Math.max(y0 + 6, my)));
    g.textBaseline = 'alphabetic';
    g.restore();
  }

  // The sheet under the canvas point (x, y), or null.
  sheetAt(x, y) {
    return this.sheets.find((s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) ?? null;
  }

  // Wheel / drag over a sheet (`lines` = how many lines to move).
  scrollSheet(sheet, lines) {
    if (this.pointer) { this.pointer.shown = false; this.pointer.key = null; }
    const st = sheet.state;
    if (st.following !== false) { st.following = false; st.hold = st.pos ?? 0; } // scrolling by hand stops the autoscroll
    st.hold = Math.max(0, Math.min((st.rows?.length ?? 1) - 1, st.hold + lines));
  }

  // The sheet whose "Autoscroll" button is under the canvas point (x, y), or null.
  sheetButtonAt(x, y) {
    return this.sheets.find((sh) => sh.button && x >= sh.button.x && x <= sh.button.x + sh.button.w && y >= sh.button.y && y <= sh.button.y + sh.button.h) ?? null;
  }

  resumeSheet(sheet) {
    sheet.state.following = true;
  }

  // Is the pointer over this row of a sheet? If it is, remember which row, and when it stays there for 0.6 s the page shows
  // the "Play from here" button. Returns { key, time, y } (y in sheet coordinates) or null.
  hoverRow(sheet, x0, y0, y, step, time, right) {
    const pt = this.pointer;
    if (!pt || pt.x < x0 || pt.x >= x0 + sheet.w || Math.abs(pt.y - (y + y0)) > step / 2) return null;
    const key = `${x0},${y0},${time}`;
    if (pt.key !== key) { pt.key = key; pt.shown = false; pt.t0 = performance.now(); } // another row: wait again
    else if (!pt.shown && performance.now() - pt.t0 >= 600) pt.shown = true;
    return { key, time, y, right };
  }

  fmtTime(sec) {
    const m = Math.floor(Math.max(0, sec) / 60);
    return `${m}:${String(Math.floor(Math.max(0, sec) % 60)).padStart(2, '0')}`;
  }

  // The pointer moved over the canvas: a real move (more than 4 px) restarts the wait for the button.
  pointerAt(x, y) {
    const pt = this.pointer;
    if (pt && Math.hypot(x - pt.x, y - pt.y) <= 4) return;
    this.pointer = { x, y, t0: performance.now(), key: pt?.key ?? null, shown: pt?.shown ?? false };
    if (this.sheetPlayButtonAt(x, y)) this.pointer.t0 = pt?.t0 ?? performance.now(); // moving onto the button keeps it
  }

  // The sheet whose "Play from here" button is under the canvas point (x, y), or null.
  sheetPlayButtonAt(x, y) {
    return this.sheets.find((sh) => sh.playBtn && x >= sh.playBtn.x && x <= sh.playBtn.x + sh.playBtn.w && y >= sh.playBtn.y && y <= sh.playBtn.y + sh.playBtn.h) ?? null;
  }

  // Two lyric sheets, VOCAL 1 (the lead's words) and VOCAL 2 (the other voices'), side by side in a wide area and one above
  // the other in a narrow one. The area is at (x0, y0) of the canvas and the origin is already there.
  renderSheetsSplit(t, w, h, pane, x0, y0) {
    const g = this.g;
    const cols = w >= 760 && w >= h * 1.1;
    const caption = (text, x, y) => {
      g.font = '700 12px system-ui';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fillText(text, x, y);
      g.textBaseline = 'alphabetic';
    };
    [['v1', 'VOCAL 1'], ['v2', 'VOCAL 2']].forEach(([key, name], k) => {
      const bw = cols ? w / 2 : w;
      const bh = cols ? h : h / 2;
      const bx = cols ? k * bw : 0;
      const by = cols ? 0 : k * bh;
      g.save();
      g.beginPath();
      g.rect(bx, by, bw, bh);
      g.clip();
      g.translate(bx, by);
      this.renderLyricSheet(t, bw, bh, this.karaokeLines(pane, key), this.sheetState(pane, key), x0 + bx, y0 + by, this.lyricCtx(pane));
      caption(name, 12, 14);
      g.restore();
    });
    g.fillStyle = 'rgba(255,255,255,0.12)';
    if (cols) g.fillRect(Math.round(w / 2), 0, 1, h);
    else g.fillRect(0, Math.round(h / 2), w, 1);
  }

  // Karaoke: only the lyrics, as a sheet that scrolls (two sheets, vocal 1 and vocal 2, when the harmony voices have words of
  // their own), alone on the stage or in the band above the other charts.
  renderKaraoke(t, w, h, pane) {
    if ((pane.chart.lyrics2 || []).length > 0) this.renderSheetsSplit(t, w, h, pane, 0, 0);
    else this.renderLyricSheet(t, w, h, this.karaokeLines(pane, 'main'), this.sheetState(pane, 'main'), 0, 0, this.lyricCtx(pane));
  }

  renderLanes(t, w, h) {
    const g = this.g;
    const chart = this.chart;
    const laneW = Math.min(Math.min(190, Math.max(90, h * 0.13)), (w * 0.8) / chart.lanes); // lanes grow with the stage height on big screens
    const x0 = (w - laneW * chart.lanes) / 2;
    const hitY = h * HIT_Y;
    const pxPerSec = (hitY / BASE_LOOKAHEAD_SEC) * this.neck;
    const yOf = (time) => hitY - (time - t) * pxPerSec;
    // Notes are drawn from this far ahead, so the ones past the top edge are already walking in.
    const ahead = hitY / pxPerSec + ENTRY_MARGIN_SEC;

    // star power / solo bands
    this.fillSpans(chart.starPower, t, ahead, yOf, x0, laneW * chart.lanes, h, 'rgba(60,160,255,0.12)');
    this.fillSpans(chart.solos, t, ahead, yOf, x0, laneW * chart.lanes, h, 'rgba(255,190,60,0.10)');
    // drum fills / big rock endings (YARG activation phrases and BRE), a faint band under the notes
    for (const [kind, color] of Object.entries(FILL_COLORS)) {
      this.fillSpans((chart.fills || []).filter((f) => f.kind === kind), t, ahead, yOf, x0, laneW * chart.lanes, h, color);
    }
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
      if (i % 2 === 0) g.fillRect(x0 + i * laneW, 0, laneW, h); // down to the bottom edge, where it fades out
    }
    // (there is no hit line: the pads mark the spot)

    // sustains first, then heads
    const from = firstVisibleIndex(chart.notes, t, this.maxLength);
    const visible = [];
    for (let i = from; i < chart.notes.length && chart.notes[i].time <= t + ahead; i++) {
      visible.push(chart.notes[i]);
    }
    const radius = Math.min(laneW * 0.36, 26);
    const colors = chart.laneColors || GUITAR_LANE_COLORS;
    const wide = this.noteStyle === 'rect' ? RECT_WIDEN_2D : 1; // 2D rounded rectangles are a bit wider than the shared shape

    // hit pads, like the 3D view: a ring per lane at the hit line, lit when a note is hit, while a long note is held,
    // and (every pad) on a pedal or open hit
    const flash = new Array(chart.lanes).fill(0);
    let barFlash = 0;
    for (const n of visible) {
      const past = t - n.time;
      if (past < 0) continue;
      if (n.lane >= 0 && !n.open) {
        if (past < HIT_FLASH_SEC) flash[n.lane] = Math.max(flash[n.lane], 1 - past / HIT_FLASH_SEC);
        flash[n.lane] = Math.max(flash[n.lane], heldAmount(n, t) * (0.75 + 0.15 * Math.sin(t * 22)));
      } else if (past < BAR_FLASH_SEC) {
        barFlash = Math.max(barFlash, 1 - past / BAR_FLASH_SEC);
      }
    }
    for (let i = 0; i < chart.lanes; i++) {
      g.beginPath();
      const cymbalLane = chart.laneKinds?.[i] === 'cymbal'; // extended drums: the cymbal lanes have triangle pads
      noteShape(g, x0 + (i + 0.5) * laneW, hitY, radius * 1.05 * (cymbalLane ? 1 : wide), radius * 1.05, cymbalLane ? 'tri' : this.noteStyle);
      g.fillStyle = withAlpha(colors[i], Math.min(0.9, PAD_FILL_ALPHA + 0.5 * flash[i] + 0.35 * barFlash));
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = withAlpha(colors[i], Math.min(1, PAD_RING_ALPHA + (1 - PAD_RING_ALPHA) * Math.max(flash[i], barFlash)));
      g.stroke();
    }

    // kick (lane -1) is a bar across all columns, not a column
    // pedal bars go behind the other notes and sustains
    for (const n of visible) {
      if (n.lane >= 0 && !n.open) continue;
      const past = t - exitTime(n); // long notes: the exit starts when the tail ends
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
      const rad = radius * noteScale(n); // HOPO notes are smaller
      // held (active): the whole tail is lighter, more opaque and slowly brightens and dims (no extra shapes)
      const amt = heldAmount(n, t); // fades in after the hit
      g.fillStyle = withAlpha(noteColor(n, colors), 0.55 + 0.25 * amt);
      g.fillRect(cx - rad * 0.35, yTop, rad * 0.7, Math.max(0, yBot - yTop));
      if (amt > 0) {
        g.fillStyle = `rgba(255,255,255,${amt * (0.3 + 0.12 * tailShimmer(t))})`;
        g.fillRect(cx - rad * 0.35, yTop, rad * 0.7, Math.max(0, yBot - yTop));
        // soft halo around the tail while it is played, with a rounded end (the cap only if the end is on screen)
        g.globalCompositeOperation = 'lighter';
        fillTailHalo(g, noteColor(n, colors), cx, rad * 0.35, rad * 1.1, yTop, yBot, 0.11 * amt, n.time + n.length <= t + ahead);
        g.globalCompositeOperation = 'source-over';
      }
    }

    // Heads. Once a note reaches the hit line it stops moving and plays its exit animation:
    // it grows, fades and turns white over FADE_SEC, for pedals too.
    for (const n of visible) {
      if (n.lane < 0 || n.open) continue; // pedals and open notes are drawn above, behind the other notes
      const past = t - exitTime(n); // long notes: the exit starts when the tail ends
      if (past > FADE_SEC) continue;
      const k = Math.max(0, past) / FADE_SEC; // 0 at the hit line, 1 when gone
      const cy = yOf(Math.max(n.time, t)); // parked on the hit line during the exit
      const amt = heldAmount(n, t);
      const white = Math.min(1, k + amt * (0.32 + 0.12 * tailShimmer(t))); // an active long note's head is lighter, like its tail
      // ghost notes are dimmed, accents are larger (YARG draws them the same way)
      g.globalAlpha = (1 - k) * (n.ghost ? GHOST_ALPHA : 1);
      const cx = x0 + (n.lane + 0.5) * laneW;
      const r = radius * noteScale(n) * (1 + 0.4 * k) * (1 + (heldPulse(t) - 1) * amt);
      if (amt > 0) { // a soft halo while the note is held
        g.globalCompositeOperation = 'lighter';
        g.save();
        g.translate(cx, cy);
        fillHalo(g, noteColor(n, colors), r * 0.7, r * 1.7, 0.45 * amt); // radial fade-out
        g.restore();
        g.globalCompositeOperation = 'source-over';
      }
      g.beginPath();
      noteShape(g, cx, cy, n.cymbal ? r : r * wide, r, n.cymbal ? 'tri' : this.noteStyle); // cymbals: rounded triangle
      g.fillStyle = tintWhite(n.sp ? noteColor(n, colors) : n.tap ? TAP_COLOR : colors[n.lane], white);
      g.fill();
      // accent: same size, with a thicker outline in a darker shade of the note's colour
      g.lineWidth = n.accent ? ACCENT_OUTLINE_WIDTH : n.sp ? 4 : 2;
      g.strokeStyle = n.accent ? darken(colors[n.lane], ACCENT_OUTLINE_DARKEN) : n.sp ? colors[n.lane] : 'rgba(0,0,0,0.5)'; // star power keeps the lane colour as its outline
      g.stroke();
      if (n.hopo) { // guitar HOPO: a white dot in the head
        g.beginPath();
        noteShape(g, cx, cy, r * 0.35, r * 0.35, this.noteStyle);
        g.fillStyle = `rgba(255,255,255,${0.9 * (1 - k)})`;
        g.fill();
      }
    }
    g.globalAlpha = 1;

    // a very short fade at the bottom: the board dissolves right below the pads
    const bottomFade = Math.min(h - hitY, radius * 1.05 + 28);
    const fadeStart = Math.max(hitY + radius * 1.05, h - bottomFade);
    if (h - fadeStart > 2) {
      const bf = g.createLinearGradient(0, fadeStart, 0, h);
      for (const [at, a] of [[0, 0], [0.3, 0.2], [0.6, 0.6], [0.85, 0.92], [1, 1]]) bf.addColorStop(at, `rgba(${this.bgRgb},${a})`);
      g.fillStyle = bf;
      g.fillRect(0, fadeStart, w, h - fadeStart);
    }

    // the board and the notes entering from the top dissolve into the background (an eased fade)
    const fadeH = h * 0.2;
    const fade = g.createLinearGradient(0, 0, 0, fadeH);
    for (const [at, a] of [[0, 1], [0.25, 0.85], [0.5, 0.5], [0.75, 0.17], [1, 0]]) fade.addColorStop(at, `rgba(${this.bgRgb},${a})`);
    g.fillStyle = fade;
    g.fillRect(0, 0, w, fadeH);
  }

  // Vocals: pitch on the vertical axis, time on the horizontal axis. Lead notes are bars, harmonies
  // are lighter bars behind them, percussion is a row of diamonds, and lyrics sit under the notes.
  renderVocals(t, w, h) {
    const g = this.g;
    const chart = this.chart;
    const hitX = w * 0.15;
    const pxPerSec = (w * 0.85) / BASE_LOOKAHEAD_SEC;
    const [lo, hi] = this.vocalRange(t, BASE_LOOKAHEAD_SEC + 1.5);
    const second = (chart.lyrics2 || []).length > 0; // harmony charts: the other voices' own words get a line above the chart
    const secondSize = Math.max(15, Math.min(26, h * 0.08));
    const secondY = secondSize * 0.85 + 6;
    const top = second ? secondY + secondSize * 0.75 : h * 0.08; // pitch area: below the second lyric line, if any, to 76% of the canvas
    const fontSize = Math.max(18, Math.min(30, h * 0.095)); // lyric size, grows with the band
    const lyricY = h - fontSize * 0.5 - 10; // the lyrics sit 10 px above the bottom edge
    const bottom = lyricY - fontSize * 0.5 - 16; // and 16 px of air between them and the notes
    const yOfPitch = (p) => bottom - ((p - lo) / (hi - lo)) * (bottom - top);
    const mid = (top + bottom) / 2; // talkies (unpitched notes) sit in the middle of the pitch area
    const percussionY = this.vocalCenterY(chart, h); // percussion hits sit in the vertical middle of the chart
    const xOf = (time) => hitX + (time - t) * pxPerSec;
    const ahead = BASE_LOOKAHEAD_SEC + ENTRY_MARGIN_SEC;
    const behind = hitX / pxPerSec + 0.5; // how long after the hit line a note is still on the stage (it scrolls off the left edge)

    // beat and measure lines, vertical (the same marks the lane charts have), behind everything else
    for (const b of chart.beats || []) {
      if (b.time < t - behind || b.time > t + ahead) continue;
      g.fillStyle = b.measure ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
      const lw = b.measure ? 2 : 1;
      g.fillRect(Math.round(xOf(b.time) - lw / 2), 0, lw, h); // centred on the beat, so what sits on it (percussion) lines up
    }

    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(hitX - 2, 0, 3, h);

    // harmonies first, so the lead is drawn on top
    for (const harmony of chart.harmonies || []) {
      const base = HARMONY_COLORS[harmony.part] || HARMONY_COLORS[1];
      this.vocalNotes(harmony.notes, t, ahead, behind, xOf, yOfPitch, [top, bottom], 4, [tintWhite(base, 0.7), base], hitX); // the part past the hit line is lit, like the lead's
    }
    this.vocalNotes(chart.notes, t, ahead, behind, xOf, yOfPitch, [top, bottom], 6, [tintWhite(VOCAL_LEAD, 0.6), VOCAL_LEAD], hitX); // lit: a lighter shade of the note's own colour

    // percussion: a drum-head marker per hit, in the vertical middle of the chart; a hit flashes when it crosses the line and
    // then dims as it scrolls off.
    for (const p of chart.percussion || []) {
      if (p.time < t - behind || p.time > t + ahead) continue;
      const x = xOf(p.time);
      const past = t - p.time;
      const r = Math.max(14, Math.min(22, h * 0.08)); // percussion marker radius
      const k = past > 0 ? Math.min(1, past / 0.5) : 0; // 0..1 over the half second after the hit
      g.save();
      g.globalAlpha = past > 0.5 ? 0.4 : 1;
      if (past > 0 && past < 0.5) {
        const fade = 1 - k;
        const glow = g.createRadialGradient(x, percussionY, r * 0.4, x, percussionY, r * (2.2 + k));
        glow.addColorStop(0, `rgba(108,182,255,${0.55 * fade})`);
        glow.addColorStop(1, 'rgba(108,182,255,0)');
        g.fillStyle = glow;
        g.beginPath();
        g.arc(x, percussionY, r * (2.2 + k), 0, Math.PI * 2);
        g.fill();
        for (const [delay, grow, width] of [[0, 1.9, 3.5], [0.18, 1.4, 2]]) { // two rings going out, one after the other
          const q = Math.max(0, Math.min(1, (k - delay) / (1 - delay)));
          if (q <= 0) continue;
          g.beginPath();
          g.arc(x, percussionY, r * (1 + q * grow), 0, Math.PI * 2);
          g.lineWidth = width * (1 - q) + 0.5;
          g.strokeStyle = `rgba(191,233,255,${0.9 * (1 - q)})`;
          g.stroke();
        }
        g.lineCap = 'round';
        for (let n = 0; n < 8; n++) { // short spokes flying out
          const a = (n * Math.PI) / 4 + Math.PI / 8;
          const from = r * (1.15 + k * 1.1);
          const to = from + r * 0.55 * fade;
          g.beginPath();
          g.moveTo(x + Math.cos(a) * from, percussionY + Math.sin(a) * from);
          g.lineTo(x + Math.cos(a) * to, percussionY + Math.sin(a) * to);
          g.lineWidth = 3 * fade + 0.5;
          g.strokeStyle = `rgba(191,233,255,${0.9 * fade})`;
          g.stroke();
        }
      }
      const pop = past > 0 && past < 0.2 ? 1 + 0.5 * Math.sin((Math.PI * past) / 0.2) : 1; // the ball swells and settles
      const lit = past > 0 && past < 0.35 ? 1 - past / 0.35 : 0; // and flashes from blue-white back to white
      g.beginPath();
      g.arc(x, percussionY, r * pop, 0, Math.PI * 2);
      g.fillStyle = lit > 0 ? `rgb(${Math.round(230 - 122 * lit)},${Math.round(237 - 55 * lit)},255)` : '#e6edf3';
      g.fill();
      g.beginPath();
      g.arc(x, percussionY, r * 0.5 * pop, 0, Math.PI * 2);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(13,17,23,0.55)';
      g.stroke();
      g.restore();
    }

    // lyrics under the notes, each at its start time
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    // One row of syllables. Colours as in YARG's static lyrics (VocalStaticLyricPhraseElement): past grey, present teal,
    // future white. A syllable never overlaps the one before it.
    const lyricRow = (list, y, size, [future, present, past]) => {
      g.font = `600 ${size}px system-ui`;
      let prevRight = -Infinity;
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        if (l.time < t - behind - 3) continue; // (a few syllables before the window still push the next ones along)
        if (l.time > t + ahead) break;
        const x = Math.max(xOf(l.time), prevRight + 5);
        prevRight = x + g.measureText(l.text).width;
        if (l.time < t - behind - 0.8) continue;
        const sungUntil = l.end > l.time ? l.end : list[i + 1]?.time ?? Infinity; // the paired note's end, else the next syllable
        g.fillStyle = l.time > t ? future : t < sungUntil ? present : past;
        g.fillText(l.text, x, y);
      }
    };
    lyricRow(second && chart.lyrics1?.length ? chart.lyrics1 : chart.lyrics, lyricY, fontSize, ['#ffffff', '#13f0a6', '#595959']); // with a second line, the first one is the lead's own words
    if (second) lyricRow(chart.lyrics2, secondY, secondSize, ['#9fe3d0', '#2fd9c4', '#4b6b66']); // the other voices, above the chart
    g.textBaseline = 'alphabetic';
  }

  // Notes of a vocal part: rounded pitched bars, a ribbon joining a pitch slide to the note before it (same colour as the
  // notes), and talkies (unpitched notes, '#', '^', '*') as a dashed box in the middle of the pitch area.
  // colors = [passed, idle]: the part of a note that is past the hit line is painted `passed`. null keeps the current fill.
  vocalNotes(notes, t, ahead, behind, xOf, yOfPitch, area, half, colors, hitX) {
    const g = this.g;
    const keep = g.fillStyle;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const prev = notes[i - 1];
      const joined = n.slide && prev && !prev.talkie && prev.time <= t + ahead; // a continuation shows with the note it continues
      if (n.end < t - behind || (n.time > t + ahead && !joined)) continue; // a note stays until it has left the stage on the left
      const x1 = xOf(n.time);
      const x2 = Math.max(x1 + 6, xOf(n.end));
      const bw = x2 - x1;
      const y = yOfPitch(n.pitch);
      const shape = (color) => {
        g.fillStyle = color;
        g.strokeStyle = color;
        if (n.talkie) {
          g.save();
          g.globalAlpha *= 0.35;
          g.fillRect(x1, area[0], bw, area[1] - area[0]); // a free note fills the whole chart area above the lyrics
          g.restore();
          g.setLineDash([4, 3]);
          g.lineWidth = 2;
          g.strokeRect(x1, area[0], bw, area[1] - area[0]);
          g.setLineDash([]);
          return;
        }
        if (n.slide && prev && !prev.talkie) { // continues the previous note: a smooth ribbon from its end to this note's start
          const xa = xOf(prev.end);
          const ya = yOfPitch(prev.pitch);
          const lead = Math.min(10, half * 1.5); // tucks under both bars so no seam shows
          const xs = xa - lead;
          const xe = x1 + lead;
          const tw = xe - xs; // the pitch glides over the whole gap, a smooth S, instead of jumping
          const xc = xe - tw;
          const cx = xc + tw / 2;
          g.beginPath();
          g.moveTo(xs, ya - half);
          g.lineTo(xc, ya - half);
          g.bezierCurveTo(cx, ya - half, cx, y - half, xe, y - half);
          g.lineTo(xe, y + half);
          g.bezierCurveTo(cx, y + half, cx, ya + half, xc, ya + half);
          g.lineTo(xs, ya + half);
          g.closePath();
          g.fill();
        }
        g.beginPath();
        if (g.roundRect) g.roundRect(x1, y - half, bw, half * 2, Math.min(half, bw / 2));
        else g.rect(x1, y - half, bw, half * 2);
        g.fill();
      };
      shape(colors ? colors[1] : keep);
      if (colors && (joined ? xOf(prev.end) : x1) < hitX) { // (the ribbon of a continuation starts at the previous note's end) // only the part that has crossed the hit line changes colour
        g.save();
        g.beginPath();
        g.rect(-1e4, -1e4, hitX + 1e4, 2e4);
        g.clip();
        shape(colors[0]);
        g.restore();
      }
    }
  }

  // Lowest and highest pitched note of the whole chart (and its harmonies), cached per chart.
  vocalFullRange() {
    const chart = this.chart;
    if (!chart.fullRange) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const list of [chart.notes, ...(chart.harmonies || []).map((h) => h.notes)]) {
        for (const n of list) {
          if (n.talkie) continue;
          lo = Math.min(lo, n.pitch);
          hi = Math.max(hi, n.pitch);
        }
      }
      chart.fullRange = lo === Infinity ? [48, 72] : [lo, hi];
    }
    return chart.fullRange;
  }

  // Pitch range shown by the vocal view. Charts with range shifts (note 0, [range_shift], '%' lyrics; YARG.Core
  // GetRangeShifts) use the range of the shift in force at `t`; the others keep one range for the whole song.
  // Either way: at least 20 semitones tall, padded by 10% on each side, and eased slowly so the rare range
  // changes slide instead of jumping (over the length of the shift when the chart gives one).
  vocalRange(t, windowSec) {
    let lo = Infinity;
    let hi = -Infinity;
    let slide = 0.6; // easing time constant, seconds (calm: the view should move rarely)
    const shifts = this.chart.rangeShifts || [];
    if (shifts.length > 1) {
      let active = shifts[0];
      for (const r of shifts) if (r.time <= t) active = r;
      [lo, hi] = [active.min, active.max];
      slide = Math.max(slide, active.length / 3);
    } else {
      [lo, hi] = this.vocalFullRange(); // no range shifts: the range of the whole song, so the view stays still
    }
    if (lo === Infinity) [lo, hi] = this.vRange || [48, 72]; // nothing ahead: keep the last range
    lo -= 0.75; // half a note width of padding, like NOTE_WIDTH_MULTIPLIER / 2
    hi += 0.75;
    if (hi - lo < 20) {
      const mid = (hi + lo) / 2;
      lo = mid - 10;
      hi = mid + 10;
    }
    const pad = (hi - lo) * 0.1;
    const target = [lo - pad, hi + pad];
    const now = performance.now();
    const dt = Math.min(0.25, (now - (this.vRangeAt || now)) / 1000);
    this.vRangeAt = now;
    if (!this.vRange || dt === 0) this.vRange = this.vRange || target;
    const k = 1 - Math.exp(-dt / slide);
    this.vRange = [this.vRange[0] + (target[0] - this.vRange[0]) * k, this.vRange[1] + (target[1] - this.vRange[1]) * k];
    return this.vRange;
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

// Flags the notes that sit inside a star power phrase (n.sp), so both views can colour them like YARG does.
// Spans and notes are both sorted by time.
export function markStarPowerNotes(chart) {
  const spans = chart.starPower || [];
  let i = 0;
  for (const n of chart.notes) {
    while (i < spans.length && spans[i].end <= n.time) i++;
    n.sp = i < spans.length && n.time >= spans[i].start;
  }
}
