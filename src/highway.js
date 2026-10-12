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

const RECT_WIDEN_2D = 1.18;

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
    this.sheetRect = null; // where the lyric sheet is (canvas coordinates), when it is on screen
    this.sheetManual = 0; // lines the user scrolled away from the singer
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
    this.panes = items.map(({ chart, label }) => {
      markStarPowerNotes(chart);
      return { chart, label: label ?? '', maxLength: Math.max(0, ...chart.notes.map((n) => n.length || 0)), vRange: null }; // the vocal range is re-fitted per chart
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

    this.sheetRect = null;
    this.sheetHits = [];
    if (!this.panes.length) return; // the page shows its own welcome / loading overlay
    const vocal = this.panes.find((p) => p.chart.mode === 'vocals');
    const lanes = this.panes.filter((p) => p.chart.mode !== 'vocals');
    const many = this.panes.length > 1;
    if (!lanes.length) { // vocals alone
      this.vocalAlone = true;
      if (this.vocalView === 'karaoke') this.drawPane(vocal, t, 0, 0, w, h, many); // the lyrics fill the stage (renderKaraoke)
      else { // the chart keeps the height it has next to other charts; the rest of the lyrics fill the space below
        const vh = Math.round(Math.min(h * 0.34, 280));
        this.drawPane(vocal, t, 0, 0, w, vh, many);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(0, vh - 1, w, 1);
        g.save();
        g.beginPath();
        g.rect(0, vh, w, h - vh);
        g.clip();
        g.translate(0, vh);
        this.renderLyricSheet(t, w, h - vh, vocal, vh);
        g.restore();
      }
      this.vocalAlone = false;
      return;
    }
    let top = 0;
    if (vocal) { // vocals use the top of the other tracks
      top = Math.round(this.vocalView === 'karaoke' ? Math.min(h * 0.3, 230) : Math.min(h * 0.34, 280)) - 20; // 20 px shorter than the band of vocals alone
      this.drawPane(vocal, t, 0, 0, w, top, many);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, top - 1, w, 1);
    }
    const per = Math.max(1, Math.min(lanes.length, Math.floor(w / this.paneMin)));
    this.perScreen = per;
    this.focus = Math.max(0, Math.min(this.focus, lanes.length - per));
    const pw = w / per;
    for (let i = 0; i < per; i++) {
      const pane = lanes[this.focus + i];
      this.drawPane(pane, t, i * pw, top, pw, h - top, many);
      if (i > 0) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(Math.round(i * pw), top, 1, h - top); }
    }
    if (lanes.length > per) this.drawPaneDots(lanes.length, per, w, h);
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
  }

  karaokeLines(pane) {
    pane.karaoke ??= buildKaraokeLines(pane.chart.lyrics || [], pane.chart.phrases);
    return pane.karaoke;
  }

  // The lyrics as a sheet that scrolls: it follows the line being sung (the current line is filled as it goes and bigger);
  // wheel / drag moves it by hand, and it glides back to the singer a few seconds after you stop. Clicking a line seeks to it.
  renderLyricSheet(t, w, h, pane, yOff = 0) {
    const g = this.g;
    const lines = this.karaokeLines(pane);
    this.sheetRect = { y: yOff, h };
    this.sheetHits = [];
    if (!lines.length) {
      g.font = '600 16px system-ui';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText('No lyrics in this chart', w / 2, h / 2);
      return;
    }
    let idx = -1;
    for (let i = 0; i < lines.length && lines[i].start <= t + 0.25; i++) idx = i;
    const singing = idx >= 0 && t <= lines[idx].end + 2.5;
    const first = singing ? idx : idx + 1;
    const now = performance.now();
    if (this.sheetManual && now - this.sheetTouched > 3500) this.sheetManual = 0; // back to following the singer
    const target = Math.max(0, Math.min(lines.length - 1, first + this.sheetManual));
    const dt = Math.min(0.25, (now - (this.sheetAt || now)) / 1000);
    this.sheetAt = now;
    if (this.sheetPos == null || !Number.isFinite(this.sheetPos) || Math.abs(target - this.sheetPos) > 40) this.sheetPos = target;
    else this.sheetPos += (target - this.sheetPos) * (1 - Math.exp(-dt / 0.12));
    const big = Math.max(18, Math.min(h * 0.16, 46, w * 0.06));
    const small = Math.max(14, big * 0.72);
    const step = Math.max(small * 1.55, big * 1.15);
    this.sheetStep = step;
    const top = big * 0.95;
    const from = Math.max(0, Math.floor(this.sheetPos) - 1);
    for (let i = from; i < lines.length; i++) {
      const y = top + (i - this.sheetPos) * step;
      if (y - step / 2 > h) break;
      if (y - small * 0.6 < 0) continue; // a row cut by the top edge would look broken
      const cur = singing && i === idx;
      const past = i < first ? 0.3 : Math.max(0.3, 0.7 - Math.max(0, i - first) * 0.06);
      this.drawKaraokeLine(lines[i], cur ? big : small, w, y, cur ? 0.95 : past, cur ? t : null);
      this.sheetHits.push({ y: y + yOff, half: step / 2, time: lines[i].start });
    }
  }

  // Wheel / drag over the sheet (`lines` = how many lines to move).
  scrollSheet(lines) {
    if (!this.sheetRect) return;
    this.sheetManual = (this.sheetManual || 0) + lines;
    this.sheetTouched = performance.now();
  }

  // Is the canvas point (x, y) over the lyric sheet?
  overSheet(y) {
    return !!this.sheetRect && y >= this.sheetRect.y && y < this.sheetRect.y + this.sheetRect.h;
  }

  // The start time (chart seconds) of the lyric line drawn at canvas height y, or null.
  sheetLineAt(y) {
    const hit = (this.sheetHits || []).find((r) => Math.abs(y - r.y) <= r.half);
    return hit ? hit.time : null;
  }

  // Karaoke: only the lyrics. Alone, they fill the stage as a sheet; next to other charts the line being sung and the next one.
  renderKaraoke(t, w, h, pane) {
    const g = this.g;
    if (this.vocalAlone) {
      this.renderLyricSheet(t, w, h, pane, 0);
      return;
    }
    const lines = this.karaokeLines(pane);
    if (!lines.length) {
      g.font = '600 16px system-ui';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText('No lyrics in this chart', w / 2, h / 2);
      return;
    }
    const { current, next } = karaokeAt(lines, t);
    const big = Math.max(18, Math.min(h * 0.2, 54, w * 0.07));
    if (current) this.drawKaraokeLine(current, big, w, h * 0.42, 0.95, t);
    if (next) this.drawKaraokeLine(next, big * 0.72, w, current ? h * 0.74 : h * 0.5, current ? 0.55 : 0.8, null);
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
    const top = h * 0.08; // pitch area: top 8% to 76% of the canvas
    const bottom = h * 0.76;
    const yOfPitch = (p) => bottom - ((p - lo) / (hi - lo)) * (bottom - top);
    const mid = (top + bottom) / 2; // talkies (unpitched notes) sit in the middle of the pitch area
    const lyricY = bottom + h * 0.04; // lyrics sit right under the note area
    const percussionY = h * 0.92;
    const xOf = (time) => hitX + (time - t) * pxPerSec;
    const ahead = BASE_LOOKAHEAD_SEC + ENTRY_MARGIN_SEC;
    const behind = hitX / pxPerSec + 0.5; // how long after the hit line a note is still on the stage (it scrolls off the left edge)

    // beat and measure lines, vertical (the same marks the lane charts have), behind everything else
    for (const b of chart.beats || []) {
      if (b.time < t - behind || b.time > t + ahead) continue;
      g.fillStyle = b.measure ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
      g.fillRect(Math.round(xOf(b.time)), 0, b.measure ? 2 : 1, h);
    }

    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(hitX - 2, 0, 3, h);

    // harmonies first, so the lead is drawn on top
    for (const harmony of chart.harmonies || []) {
      const base = HARMONY_COLORS[harmony.part] || HARMONY_COLORS[1];
      this.vocalNotes(harmony.notes, t, ahead, behind, xOf, yOfPitch, mid, 4, [tintWhite(base, 0.7), base], hitX); // the part past the hit line is lit, like the lead's
    }
    this.vocalNotes(chart.notes, t, ahead, behind, xOf, yOfPitch, mid, 6, ['#f5c518', '#5b8def'], hitX);

    // percussion: a diamond per hit, white when played, grey when not
    for (const p of chart.percussion || []) {
      if (p.time < t - behind || p.time > t + ahead) continue;
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
    // colours as in YARG's static lyrics (VocalStaticLyricPhraseElement): past grey, present teal, future white
    const lyrics = chart.lyrics;
    for (let i = 0; i < lyrics.length; i++) {
      const l = lyrics[i];
      if (l.time < t - behind - 0.8 || l.time > t + ahead) continue;
      const sungUntil = l.end > l.time ? l.end : lyrics[i + 1]?.time ?? Infinity; // the paired note's end, else the next syllable
      g.fillStyle = l.time > t ? '#ffffff' : t < sungUntil ? '#13f0a6' : '#595959';
      g.fillText(l.text, xOf(l.time), lyricY);
    }
    g.textBaseline = 'alphabetic';
  }

  // Notes of a vocal part: rounded pitched bars, a ribbon joining a pitch slide to the note before it (same colour as the
  // notes), and talkies (unpitched notes, '#', '^', '*') as a dashed box in the middle of the pitch area.
  // colors = [passed, idle]: the part of a note that is past the hit line is painted `passed`. null keeps the current fill.
  vocalNotes(notes, t, ahead, behind, xOf, yOfPitch, mid, half, colors, hitX) {
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
          g.fillRect(x1, mid - half * 2, bw, half * 4);
          g.restore();
          g.setLineDash([4, 3]);
          g.lineWidth = 2;
          g.strokeRect(x1, mid - half * 2, bw, half * 4);
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
