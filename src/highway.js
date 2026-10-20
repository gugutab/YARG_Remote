// Canvas renderer for a chart. Drawing is a pure function of the playback time,
// so seek/pause just means re-rendering at a different `t`.

import { sanitizeSizes, fitWidths } from './panesizes.js';
import { PER_INSTRUMENT_BASES, instrumentDefaults } from './perinstrument.js';
import {
  NOTE_PALETTE, BOTTOM_FADE_STOPS, EDGE_FADE_STOPS, LYRIC_RAMP_STOPS,
  STAR_POWER_GOLD,
  STAR_POWER_BAND,
  SOLO_BAND,
  KICK_BAR_HALF_H,
  DOUBLE_KICK_GAP,
  ACCENT_OUTLINE_WIDTH,
  ACCENT_OUTLINE_DARKEN,
  GHOST_ALPHA,
  DISABLED_FILTER,
  ROLL_COLORS,
  FILL_COLORS,
  FADE_SEC,
  BASE_LOOKAHEAD_SEC,
  laneLookFactor,
  ENTRY_MARGIN_SEC,
  HIT_Y,
  firstVisibleIndex,
  tintWhite,
  darken,
  withAlpha,
  breAlpha,
  drawYNote,
  YNOTE_SIDE_2D,
  drawCymbalFace,
  NOTE_RECT_W,
  NOTE_RECT_H,
  firstIndexAtOrAfter,
  exitTime,
  heldAmount,
  HIT_FLASH_SEC,
  BAR_FLASH_SEC,
  PAD_FILL_ALPHA,
  PAD_RING_ALPHA,
  padAlphas,
  beatLineStyles,
  HELD_SCALE,
  noteShape,
  fillHalo,
  spansOfKind,
  fillTailHalo,
  noteScale,
  noteColor,
  tailShimmer,
  heldPulse,
  fadeGradient,
  boardBase,
} from './gfx.js';
export { firstVisibleIndex } from './gfx.js';
import { renderLanes3D } from './highway3d.js';
import { buildKaraokeLines, karaokeAt, syllableProgress } from './karaoke.js';
import { countdownColors, vocalColors, mixHex } from './uicolors.js';
import { waitCountdowns, countdownAt, countdownAlpha, measureStarts, measuresLeft, COUNTDOWN_HIDE_SEC, MIN_COUNTDOWN_SEC } from './countdown.js';

const RECT_WIDEN_2D = 1.18;
// (a loop, not Math.max(...spread): a spread of >~120k notes throws a RangeError)
function longestNote(notes) {
  let m = 0;
  for (let i = 0; i < notes.length; i++) { const l = notes[i].length || 0; if (l > m) m = l; }
  return m;
}
const MIN_PANE_PX = 140; // no fretboard window is narrower than this (dragDivider keeps the same floor)
const REST_BACK_SEC = 1; // after a long rest the track is back this long before the next note appears at the far edge
const REST_BOARD_MIN = 0.2; // a fretboard's dark base keeps this fraction of its opacity at the deepest part of a rest
const FILL_KINDS = Object.keys(FILL_COLORS);
const ROLL_TYPES = Object.keys(ROLL_COLORS);
const HOPO_DOT = 'rgba(255,255,255,0.9)'; // the alpha of a HOPO dot while its note has not been hit yet (0.9 * (1 - 0))
let FLASH_2D = new Float64Array(16); // scratch of renderLanes: the light of each pad
// The time-to-pixel mapping of the current renderLanes call (it was a closure made on every frame and every pane).
let LY_HIT = 0;
let LY_T = 0;
let LY_PPS = 1;
const laneY = (time) => LY_HIT - (time - LY_T) * LY_PPS;
// The mapping of the vocal chart of the current renderVocals call: time -> x and pitch -> y (closures made on every frame before).
let VOC_HIT_X = 0;
let VOC_T = 0;
let VOC_PPS = 1;
let VOC_LO = 0;
let VOC_HI = 1;
let VOC_TOP = 0;
let VOC_BOTTOM = 0;
const vocX = (time) => VOC_HIT_X + (time - VOC_T) * VOC_PPS;
const vocY = (p) => VOC_BOTTOM - ((p - VOC_LO) / (VOC_HI - VOC_LO)) * (VOC_BOTTOM - VOC_TOP);
const fontStrings = new Map(); // size -> '600 <size>px system-ui'
const lyricFont = (size) => {
  let f = fontStrings.get(size);
  if (f === undefined) {
    if (fontStrings.size >= 32) fontStrings.clear();
    fontStrings.set(size, (f = `600 ${size}px system-ui`));
  }
  return f;
};
const trackStyles = new Map(); // alpha -> [black, white] fill styles of trackBase
const NO_SHIFTS = [];
const NO_BEATS = [];
const VOC_GLOW_HOLD = 0.22; // seconds the vocal hit glow stays after the voice stops (a shorter gap does not dim it at all)
const VOC_GLOW_FADE = 0.35; // and then fades out over this long
const REPLAY_ALPHA = 0.5; // (they are also drawn almost without colour: DISABLED_FILTER)
const PERC_HOLD = 0.4; // seconds a percussion hit stays on the hit line (its quick pulse)
const PERC_RINGS = [[0, 1.9, 3.5], [0.18, 1.4, 2]]; // percussion hit: [delay, growth, width] of the two rings

// Speed of the vocal chart in pixels per second at the default neck speed: a 1000 px wide window shows 2.5 s ahead, a wider one more.
const VOCAL_PX_PER_SEC = (1000 * 0.85) / BASE_LOOKAHEAD_SEC;

export class Highway {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.mainCtx = this.g; // the context every frame starts from, whatever a failed frame left in this.g
    this.chart = null;
    this.maxLength = 0; // longest sustain in the current chart, in seconds
    this.view = '2d';
    this.noteStyle = 'round'; // 'round' or 'rect' (rounded rectangles)
    this.vizScale = () => 1; // the resolution of the background canvas, 0..1 (set by the app from the visualizer quality)
    this.vizFps = () => Infinity; // how many times per second the background may be redrawn (set by the app from the setting)
    this.bgNext = 0; // the time (ms) from which the background may be redrawn
    this.paneOpts = {}; // per window overrides, see setPaneOpt
    this.instrumentOpts = {}; // per instrument starting options (setting highway.perInstrument), see the perInstrument setter
    this.neck = 1.2; // neck speed (the app default): scales distance between notes only; timing is unchanged
    this.bg = '#0d1117'; // chart background and the colour its fades dissolve into (the theme's "stage" colour)
    this.bgRgb = '13, 17, 23';
    this.panes = []; // every chart on screen: [{ chart, label, maxLength, vRange }]; vocals draw across the top, the rest side by side
    this.paneMin = 280; // narrowest a fretboard may get before the others move out of view (swipe to bring them in)
    this.focus = 0; // first fretboard in view when they do not all fit
    this.perScreen = 1;
    this.paneRects = []; // where each chart is drawn this frame: { key, label, icon, x, y, w, h }
    this.sheets = []; // the lyric sheets on screen this frame: { x, y, w, h, step, hits, state } (canvas coordinates)
    this._countdowns = true; // show the wait countdowns
    this.cdColors = countdownColors('classic'); // the colours of the wait countdowns and of the vocal view (app.js sets them from the theme and the settings: setUiColors)
    this.vocColors = vocalColors('classic');
    this.countdownUnit = 'measures'; // the number in the countdown: 'measures' (YARG's default) or 'seconds'
    this.loopEnd = null; // while a loop runs: the notes after its end are disabled (the loop never plays them)
    this.replayWindow = null; // { from, to }: the stretch replayed after a pause (rewind): its notes are drawn disabled
    this.weights = {}; // relative width of each fretboard, by pane key (dragging the dividers between them changes it)
    this.vocalH = null; // height of the vocal band in px, once the user dragged its divider (null: the default)
    this.dividers = []; // the draggable dividers drawn this frame
    this.hover = null; // the divider under the pointer
    this._sheetPeek = 0.12; // share of a lyric sheet's height that shows the lines before the one in focus
    this._delay = 0; // the chart delay, so times shown on the lyrics match the seek bar
    this.pointer = null; // the pointer over the canvas, for the "play from here" button on the lyrics: { x, y, t0, key, shown }
    this.onResize = null; // called when a drag ends, so the page can keep the sizes
    this.layout = { w: 0, sum: 1, keys: [] };
    this.laneScratch = []; // reused by draw()
    this.shownScratch = [];
    this.weightScratch = [];
    this.rectPool = []; // the objects of paneRects
    this.vocalView = 'track'; // 'track' (notes + lyrics) or 'karaoke' (the lyrics alone)
    this._fillBand = false; // the green band during a drum fill (setting highway.fillBand, off by default; the big rock ending band always shows)
    this._starPowerBand = false; // the gold band under a star power phrase (setting highway.starPowerBand, off by default)
    this._trackOpacity = 0.75; // how opaque the board of a fretboard is (setting highway.trackOpacity)
    // The look of the notes and the board (settings of the Highway "Notes" and "Track and bands" groups; 1 / true = the original look)
    this._noteSize = 1; // note heads and pads (highway.noteScale)
    this._noteBase = 1; // height of the rectangular note's base (highway.noteBase)
    this._sustainWidth = 1; // tail width (highway.sustainWidth)
    this._kickBar = 1; // pedal / open bar thickness (highway.kickBarHeight)
    this._heldMotion = true; // the held note's swell, tail shimmer and pad flicker (highway.heldPulse)
    this._padLook = 1; // opacity of the resting pads (highway.padLook)
    this.padFill = PAD_FILL_ALPHA;
    this.padRing = PAD_RING_ALPHA;
    this._beatLines = 'normal'; // highway.beatLines
    this.beatStyles = { '2d': beatLineStyles('normal', '2d'), '3d': beatLineStyles('normal', '3d') };
    this._laneStripes = true; // the alternate lane tint (highway.laneStripes)
    this._soloBand = true; // highway.soloBand
    this._breBand = 'pulse'; // the big rock ending band: 'off', 'steady' or 'pulse' (highway.breBand, made steady by reduced motion in app.js)
    this._lyricScale = 1; // vocal lyrics size (highway.lyricSize)
    this._lyricOutline = true; // the dark outline under the lyrics (highway.lyricOutline)
    this._countdownMin = MIN_COUNTDOWN_SEC; // shortest rest that gets a countdown (highway.countdownMin)
    this.visualizer = null; // (g, w, h, t, bgRgb) => draws the shared background behind every pane, or null (src/visualizers.js)
    this.dirtyAt = 0; // performance.now() of the last change to what is drawn (see invalidate); the page skips idle redraws until it is old
  }

  // Plain settings the page assigns: each change redraws (the idle skip must not hide it).
  get countdowns() { return this._countdowns; }
  set countdowns(v) { this._countdowns = v; this.invalidate(); }
  get sheetPeek() { return this._sheetPeek; }
  set sheetPeek(v) { this._sheetPeek = v; this.invalidate(); }
  get delay() { return this._delay; }
  set delay(v) { this._delay = v; this.invalidate(); }
  get fillBand() { return this._fillBand; }
  set fillBand(v) { this._fillBand = v; this.invalidate(); }
  get starPowerBand() { return this._starPowerBand; }
  set starPowerBand(v) { this._starPowerBand = v; this.invalidate(); }
  get trackOpacity() { return this._trackOpacity; }
  set trackOpacity(v) { this._trackOpacity = v; this.invalidate(); }
  get noteSize() { return this._noteSize; }
  set noteSize(v) { this._noteSize = v; this.invalidate(); }
  get noteBase() { return this._noteBase; }
  set noteBase(v) { this._noteBase = v; this.invalidate(); }
  get sustainWidth() { return this._sustainWidth; }
  set sustainWidth(v) { this._sustainWidth = v; this.invalidate(); }
  get kickBar() { return this._kickBar; }
  set kickBar(v) { this._kickBar = v; this.invalidate(); }
  get heldMotion() { return this._heldMotion; }
  set heldMotion(v) { this._heldMotion = v; this.invalidate(); }
  get padLook() { return this._padLook; }
  set padLook(v) { this._padLook = v; [this.padFill, this.padRing] = padAlphas(v); this.invalidate(); }
  get beatLines() { return this._beatLines; }
  set beatLines(v) { this._beatLines = v; this.beatStyles = { '2d': beatLineStyles(v, '2d'), '3d': beatLineStyles(v, '3d') }; this.invalidate(); }
  get laneStripes() { return this._laneStripes; }
  set laneStripes(v) { this._laneStripes = v; this.invalidate(); }
  get soloBand() { return this._soloBand; }
  set soloBand(v) { this._soloBand = v; this.invalidate(); }
  get breBand() { return this._breBand; }
  set breBand(v) { this._breBand = v; this.invalidate(); }
  get lyricScale() { return this._lyricScale; }
  set lyricScale(v) { this._lyricScale = v; this.invalidate(); }
  get lyricOutline() { return this._lyricOutline; }
  set lyricOutline(v) { this._lyricOutline = v; this.invalidate(); }
  get countdownMin() { return this._countdownMin; }
  set countdownMin(v) { // the countdown lists are cached per pane: rebuilt with the new minimum
    if (v === this._countdownMin) return;
    this._countdownMin = v;
    for (const p of this.panes) { p.countdowns = undefined; p.countdownsLyrics = undefined; p.railCtx = undefined; }
    this.invalidate();
  }

  // Marks the picture as stale: the page keeps redrawing every frame for a while after this (it skips frames only when paused and idle).
  invalidate() {
    this.dirtyAt = performance.now();
    this.bgNext = 0; // the background is redrawn at once after a change (charts, visualizer, size...)
  }

  // The background visualizer: one drawing for the whole canvas, under all the panes. null removes it.
  setVisualizer(fn) {
    this.visualizer = typeof fn === 'function' ? fn : null;
    this.invalidate();
  }

  setBackground(hex) {
    const n = parseInt(hex.slice(1), 16);
    this.bg = hex;
    this.invalidate();
    if (this.bgCanvas?.parentElement) this.bgCanvas.parentElement.style.background = hex;
    this.bgRgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }

  // '2d' (flat) or '3d' (perspective). Vocals have no highway and always use the flat view.
  setView(view) {
    this.view = view === '3d' ? '3d' : '2d';
    this.invalidate();
  }

  setNoteStyle(style) {
    this.noteStyle = style === 'rect' ? 'rect' : 'round';
    this.invalidate();
  }

  setNeckSpeed(value) {
    this.neck = value;
    this.invalidate();
  }

  // Options of one window (a fretboard or the vocal chart) that override the global ones: view, noteStyle, neck, delay (seconds the
  // notes arrive later). `paneOpt` answers with the override or the global value; clearPaneOpt(null, name) clears it for every window.
  setPaneOpt(key, name, value) {
    (this.paneOpts[key] ??= {})[name] = value;
    this.invalidate();
  }

  clearPaneOpt(key, name) {
    this.invalidate();
    for (const k of key === null ? Object.keys(this.paneOpts) : [key]) if (this.paneOpts[k]) delete this.paneOpts[k][name];
  }

  paneOpt(key, name) {
    const v = this.paneOpts[key]?.[name];
    if (v !== undefined) return v;
    return this.paneDefault(key, name);
  }

  // What a window's option is without its own override: the instrument's starting option (highway.perInstrument; a pane key is the
  // instrument group of app.js, which is the instrument's base: guitar, bass, rhythm, keys, drums, vocals), else the global value.
  paneDefault(key, name) {
    if (name === 'delay') return 0;
    const v = this.instrumentOpts[key]?.[name];
    if (v !== undefined) return v;
    return name === 'view' ? this.view : name === 'noteStyle' ? this.noteStyle : this.neck;
  }

  set perInstrument(value) { // (precomputed: paneOpt runs for every pane on every frame)
    this.instrumentOpts = Object.fromEntries(PER_INSTRUMENT_BASES.map((b) => [b, instrumentDefaults(value, b)]));
    this.invalidate();
  }

  setChart(chart) {
    this.setCharts(chart ? [{ chart }] : []);
  }

  // items: [{ chart, label }]. The first lane chart keeps the view when the others do not fit.
  setCharts(items) {
    this.panes = items.map(({ chart, label, key, icon, chooser }) => {
      if (chooser) return { chooser: true, chart: null, label: '', icon: 'music', key, maxLength: 0, vRange: null }; // a slot the page fills with the instrument cards
      markStarPowerNotes(chart);
      return { chart, label: label ?? '', icon: icon ?? 'music', key: key ?? label ?? '', maxLength: longestNote(chart.notes), vRange: null }; // the vocal range is re-fitted per chart
    });
    this.chart = this.panes.find((p) => p.chart)?.chart ?? null;
    for (const k of Object.keys(this)) { // release the offscreen layers of panes that are gone
      if (k.startsWith('layer:') && !this.panes.some((p) => `layer:${p.key}` === k)) delete this[k];
    }
    if (!this.panes.length) this.blurCanvas = this.vizCanvas = null;
    this.focus = 0;
    this.invalidate();
  }

  setPaneMin(px) {
    this.paneMin = Math.max(120, px);
    this.invalidate();
  }

  setVocalView(view) {
    this.vocalView = view === 'karaoke' ? 'karaoke' : 'track';
    this.invalidate();
  }

  laneCount() {
    return this.panes.filter((p) => p.chart?.mode !== 'vocals').length;
  }

  // Swipe: brings the next (or previous) fretboard into view when they do not all fit. Returns whether it moved.
  shiftFocus(delta) {
    const total = this.laneCount();
    const next = Math.max(0, Math.min(Math.max(0, total - this.perScreen), this.focus + delta));
    const moved = next !== this.focus;
    this.focus = next;
    this.invalidate();
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
    this.g = this.mainCtx;
    try {
      const { w, h } = this.resize();
      this.drawBackground(t);
      this.draw(t, w, h);
    } catch (err) {
      this.recover();
      throw err;
    }
  }

  // After a frame threw: put back everything the drawing code swaps (the context, the layer flags, the saved states and clips of
  // the main canvas) so the next frame starts clean. Assigning the canvas size resets its context state.
  recover() {
    this.g = this.mainCtx;
    this.layered = false;
    this.vizFrame = null;
    this.vocalAlone = false;
    this.canvas.width = this.canvas.width;
  }

  // The page's background canvas (behind the top bar and the fretboards, the full width and height of the main area): it holds the
  // visualizer, and the stage colour is the CSS background of its parent. The fretboard canvas itself is transparent.
  setBackgroundCanvas(canvas) {
    this.bgCanvas = canvas;
    if (canvas?.parentElement) canvas.parentElement.style.background = this.bg;
  }

  drawBackground(t) {
    const c = this.bgCanvas;
    if (!c) return;
    const sc = this.visualizer ? this.vizScale() : 1; // the background is drawn at a fraction of the resolution and stretched by the compositor: far fewer pixels to fill
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * sc;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const resized = c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr);
    if (resized) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    else if (this.visualizer) { // a frame-rate cap: between two redraws the canvas keeps its picture (the drawing is a function of the song time, so skipping is safe)
      const fps = this.vizFps();
      if (Number.isFinite(fps)) {
        const now = performance.now();
        if (now < this.bgNext - 1) return;
        const gap = 1000 / fps;
        this.bgNext = Math.max(this.bgNext + gap, now - gap); // (drift-corrected: 60 on a 144 Hz screen still averages 60)
      }
    }
    const vg = c.getContext('2d');
    vg.setTransform(dpr, 0, 0, dpr, 0, 0);
    vg.clearRect(0, 0, w, h);
    if (this.visualizer && this.panes.length) this.visualizer(vg, w, h, t, this.bgRgb);
  }

  // Motion blur: the chart drawn at several moments of the time that passes during one frame and averaged, so notes that rush
  // by (a seek animation) leave a trail. `times` run from the start of the exposure to the time shown now.
  renderBlur(times) {
    this.g = this.mainCtx;
    const { w, h } = this.resize();
    const main = this.mainCtx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.blurCanvas ??= document.createElement('canvas');
    if (this.blurCanvas.width !== cw || this.blurCanvas.height !== ch) { this.blurCanvas.width = cw; this.blurCanvas.height = ch; }
    const side = this.blurCanvas.getContext('2d');
    const dpr = cw / w;
    try {
      if (this.bgCanvas) { // the page background is drawn once; the samples only hold the fretboards (transparent)
        this.drawBackground(times[times.length - 1]);
        main.save();
        main.setTransform(1, 0, 0, 1, 0, 0);
        main.clearRect(0, 0, cw, ch);
        main.restore();
      } else if (this.visualizer && this.panes.length) { // the background is drawn once and reused by every sample
        this.vizCanvas ??= document.createElement('canvas');
        if (this.vizCanvas.width !== cw || this.vizCanvas.height !== ch) { this.vizCanvas.width = cw; this.vizCanvas.height = ch; }
        const vg = this.vizCanvas.getContext('2d');
        vg.setTransform(dpr, 0, 0, dpr, 0, 0);
        vg.fillStyle = this.bg;
        vg.fillRect(0, 0, w, h);
        this.visualizer(vg, w, h, times[times.length - 1], this.bgRgb);
        this.vizFrame = this.vizCanvas;
      }
      times.forEach((t, i) => {
        this.g = side; // every method draws on this.g
        side.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw(t, w, h);
        main.save();
        main.setTransform(1, 0, 0, 1, 0, 0);
        main.globalAlpha = 1 / (i + 1); // a running average of the samples
        main.drawImage(this.blurCanvas, 0, 0);
        main.restore();
      });
    } catch (err) {
      this.recover();
      throw err;
    } finally {
      this.g = main;
      this.vizFrame = null;
    }
  }

  draw(t, w, h) {
    const g = this.g;
    if (this.bgCanvas) g.clearRect(0, 0, w, h); // (transparent: the background canvas and the stage colour show through)
    else { g.fillStyle = this.bg; g.fillRect(0, 0, w, h); }
    if (!this.bgCanvas && this.visualizer && this.panes.length) {
      if (this.vizFrame) g.drawImage(this.vizFrame, 0, 0, w, h); // motion blur: drawn once for all the samples (renderBlur)
      else this.visualizer(g, w, h, t, this.bgRgb);
    }

    this.sheets = [];
    this.dividers = [];
    this.paneRects.length = 0; // (the rectangle objects are reused from frame to frame, see drawPane)
    if (!this.panes.length) return; // the page shows its own welcome / loading overlay
    let vocal = null; // the first vocal chart, and the other charts in order (loops over scratch arrays: find/filter/slice/map made new ones per frame)
    const lanes = this.laneScratch;
    lanes.length = 0;
    for (let i = 0; i < this.panes.length; i++) {
      const pane = this.panes[i];
      if (pane.chart?.mode === 'vocals') vocal ??= pane;
      else lanes.push(pane);
    }
    if (!lanes.length) { // vocals alone
      this.vocalAlone = true;
      if (this.vocalView === 'karaoke') this.drawPane(vocal, t, 0, 0, w, h); // the lyrics fill the stage (renderKaraoke)
      else { // the chart keeps the height it has next to other charts; the rest of the lyrics fill the space below
        const vh = this.bandHeight(h, (Math.min(h * 0.34, 280) - 20) * 0.8); // (the default is 20% shorter)
        this.drawPane(vocal, t, 0, 0, w, vh);
        this.drawDivider({ type: 'row', y: vh - 1, w });
        g.save();
        g.beginPath();
        g.rect(0, vh, w, h - vh);
        g.clip();
        g.translate(0, vh);
        try {
          if ((vocal.chart.lyrics2 || []).length > 0) this.renderSheetsSplit(t, w, h - vh, vocal, 0, vh); // harmony: one sheet per voice
          else this.renderLyricSheet(t, w, h - vh, this.karaokeLines(vocal, 'main'), this.sheetState(vocal, 'main'), 0, vh, this.lyricCtx(vocal));
        } finally {
          g.restore();
          this.vocalAlone = false;
        }
      }
      this.vocalAlone = false;
      return;
    }
    let top = 0;
    if (vocal) { // vocals use the top of the other tracks
      top = this.bandHeight(h, ((this.vocalView === 'karaoke' ? Math.min(h * 0.3, 230) : Math.min(h * 0.34, 280)) - 40) * 0.8); // 20 px shorter than the band of vocals alone
      this.drawPane(vocal, t, 0, 0, w, top);
      this.drawDivider({ type: 'row', y: top - 1, w });
    }
    const per = Math.max(1, Math.min(lanes.length, Math.floor(w / this.paneMin)));
    this.perScreen = per;
    this.focus = Math.max(0, Math.min(this.focus, lanes.length - per));
    const shown = this.shownScratch;
    const weights = this.weightScratch;
    const keys = this.layout.keys;
    shown.length = weights.length = keys.length = 0;
    let sum = 0;
    for (let i = this.focus; i < this.focus + per && i < lanes.length; i++) {
      const pane = lanes[i];
      const weight = this.weights[pane.key] ?? 1;
      shown.push(pane);
      weights.push(weight);
      keys.push(pane.key);
      sum += weight;
    }
    this.layout.w = w;
    this.layout.sum = sum;
    const widths = fitWidths(weights, w, MIN_PANE_PX); // (no window under a floor, whatever the stored weights say)
    let x = 0;
    for (let i = 0; i < shown.length; i++) {
      const pane = shown[i];
      const pw = widths[i];
      this.drawPane(pane, t, x, top, pw, h - top);
      if (i > 0) this.drawDivider({ type: 'col', x: Math.round(x), y: top, h: h - top, a: shown[i - 1].key, b: pane.key });
      x += pw;
    }
    if (lanes.length > per) this.drawPaneDots(lanes.length, per, w, h);
  }

  // The track of the vocals (the chart and the lyrics): a semi-transparent base in the stage colour, so the words and notes read well
  // over a visualizer or any stage colour.
  trackBase(x, y, w, h, alpha = 0.72) {
    if (alpha <= 0) return;
    const g = this.g;
    let styles = trackStyles.get(alpha); // (the two fill styles of an alpha, kept: the strings were rebuilt on every call)
    if (!styles) {
      if (trackStyles.size >= 32) trackStyles.clear();
      trackStyles.set(alpha, (styles = [`rgba(0,0,0,${alpha})`, `rgba(255,255,255,${(0.03 * alpha / 0.72).toFixed(3)})`]));
    }
    g.fillStyle = styles[0];
    g.fillRect(x, y, w, h);
    g.fillStyle = styles[1];
    g.fillRect(x, y, w, h);
  }

  // An offscreen canvas for one fretboard (its size in device pixels), reused between panes and frames.
  layerFor(pw, ph, dpr, name = 'layer') {
    const lw = Math.max(1, Math.round(pw * dpr));
    const lh = Math.max(1, Math.round(ph * dpr));
    this[name] ??= document.createElement('canvas');
    if (this[name].width !== lw || this[name].height !== lh) { this[name].width = lw; this[name].height = lh; }
    return this[name];
  }

  // Colour stops for an edge fade: while a fretboard is drawn on its own layer the fade erases (alpha), otherwise it paints the stage colour.
  fadeStyle(a) { // (the fade loops use the precomputed stop lists of gfx.js)
    return `rgba(0,0,0,${a})`;
  }

  // The height of the vocal band: the default, or what the user dragged it to (kept within sensible limits).
  bandHeight(h, fallback) {
    const base = this.vocalH ?? fallback;
    return Math.round(Math.max(90, Math.min(h - 160, base)));
  }

  // A divider between two panes: a thin line, brighter while the pointer is over it or it is being dragged.
  // The theme's accent colour (hex), re-read now and then so a theme change shows up.
  themeAccent() {
    const now = performance.now();
    if (!this.accentAt || now - this.accentAt > 500) {
      this.accentAt = now;
      const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      this.accentHex = /^#[0-9a-f]{6}$/i.test(v) ? v : this.accentHex || '#2f81ed';
    }
    return this.accentHex;
  }

  drawDivider(d) {
    const g = this.g;
    const hot = this.hover && this.hover.type === d.type && this.hover.a === d.a && this.hover.b === d.b;
    this.dividers.push(d);
    g.fillStyle = hot ? withAlpha(this.themeAccent(), 0.9) : 'rgba(0,0,0,0.25)'; // (the highlight of a divider under the pointer is the theme's accent)
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
      this.invalidate();
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
    this.invalidate();
  }

  // Back to the default sizes (double click on a divider: just that one; no argument: all).
  resetSizes(d) {
    this.invalidate();
    if (!d) { this.weights = {}; this.vocalH = null; return; }
    if (d.type === 'row') this.vocalH = null;
    else { delete this.weights[d.a]; delete this.weights[d.b]; }
  }

  getSizes() {
    return { weights: this.weights, vocalH: this.vocalH };
  }

  setSizes(sizes) {
    const clean = sanitizeSizes(sizes);
    this.invalidate();
    this.weights = clean.weights;
    this.vocalH = clean.vocalH;
  }

  // One chart in the rectangle (x, y, pw, ph): the drawing code sees a canvas of that size.
  drawPane(pane, t, x, y, pw, ph) {
    const g = this.g;
    const rect = (this.rectPool[this.paneRects.length] ??= {}); // the page puts the instrument tags (or the chooser) here
    rect.key = pane.key;
    rect.label = pane.label;
    rect.icon = pane.icon;
    rect.chooser = !!pane.chooser;
    rect.x = x;
    rect.y = y;
    rect.w = pw;
    rect.h = ph;
    this.paneRects.push(rect);
    if (pane.chooser) { // nothing to draw: the page shows the instrument cards here
      g.fillStyle = 'rgba(255,255,255,0.025)';
      g.fillRect(x, y, pw, ph);
      return;
    }
    if (!(pw >= 1 && ph >= 1)) return; // a zero-size window has nothing to draw (and drawImage of a 0-size canvas throws)
    g.save();
    g.beginPath();
    g.rect(x, y, pw, ph);
    g.clip();
    g.translate(x, y);
    const savedView = this.view;
    const savedNoteStyle = this.noteStyle;
    const savedNeck = this.neck;
    this.neckGlobal = savedNeck; // the default the vocal chart's speed is measured against
    this.view = this.paneOpt(pane.key, 'view');
    this.noteStyle = this.paneOpt(pane.key, 'noteStyle');
    this.neck = this.paneOpt(pane.key, 'neck');
    t -= this.paneOpt(pane.key, 'delay'); // this window's own chart delay
    try {
      this.chart = pane.chart;
      this.curPane = pane;
      this.maxLength = pane.maxLength;
      this.vRange = pane.vRange;
      if (pane.chart.mode === 'vocals') {
        if (this.vocalView === 'karaoke') this.renderKaraoke(t, pw, ph, pane);
        else this.renderVocals(t, pw, ph);
      } else { // the fade at the edges erases the board (it never paints a colour over what is behind: the stage colour or a visualizer)
        const main = g;
        const dpr = this.canvas.width / (this.canvas.clientWidth || 1);
        const layer = this.layerFor(pw, ph, dpr, (pane.layerKey ??= `layer:${pane.key}`)); // one per pane: panes of different sizes would otherwise resize a shared canvas every frame
        const lg = layer.getContext('2d');
        lg.setTransform(1, 0, 0, 1, 0, 0);
        lg.clearRect(0, 0, layer.width, layer.height);
        lg.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.g = lg;
        this.layered = true;
        try {
          if (this.view === '3d') renderLanes3D(this, t, pw, ph);
          else this.renderLanes(t, pw, ph);
        } finally {
          this.g = main;
          this.layered = false;
        }
        main.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, pw, ph);
      }
      pane.vRange = this.vRange;
      if (!(pane.chart.mode === 'vocals' && this.vocalView === 'karaoke')) this.drawCountdown(pane, t, pw, ph);
    } finally {
      this.view = savedView;
      this.noteStyle = savedNoteStyle;
      this.neck = savedNeck;
      g.restore();
    }
  }

  // The wait countdown: while the chart has nothing to play for `countdownMin` (9 s) or more, the seconds until its next note, in a ring that
  // empties (YARG's WaitCountdown). Drawn over the pane's centre.
  // The rests of the lyric views (karaoke): percussion hits are no singing.
  lyricGaps(pane) {
    pane.countdownsLyrics ??= waitCountdowns(pane.chart, { percussion: false, min: this.countdownMin });
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
      return { pauses: waitCountdowns(pane.chart, { percussion: false, min: this.countdownMin }), perc, duration };
    })();
    return { gaps: this.lyricGaps(pane), ...pane.railCtx };
  }

  // The countdown running for a pane at `t`: { remaining, total } or null.
  // How present the track of a pane is, 0..1: it dissolves in a long rest (the length a countdown would run for, whatever the countdown setting says)
  // and is back 1 s before the next note appears at the far edge (`appearIn` = seconds ahead of the hit line at which a note becomes visible).
  restFade(pane, t, appearIn) {
    pane.restWaits ??= waitCountdowns(pane.chart);
    const c = countdownAt(pane.restWaits, t);
    const target = c && c.remaining > appearIn + REST_BACK_SEC ? 0 : 1;
    const st = (pane.restFade ??= { k: 1, at: performance.now() });
    const now = performance.now();
    st.k += (target - st.k) * (1 - Math.exp(-Math.min(0.1, (now - st.at) / 1000) / 0.3));
    st.at = now;
    return st.k;
  }

  // The opacity factor of a fretboard's dark base: REST_BOARD_MIN deep inside a long rest, 1 while there is music.
  restBoard(t, appearIn) {
    return REST_BOARD_MIN + (1 - REST_BOARD_MIN) * (this.curPane ? this.restFade(this.curPane, t, appearIn) : 1);
  }

  setUiColors(countdown, vocal) {
    this.cdColors = countdown;
    this.vocColors = vocal;
    this.leadColors = null; // (the caches of shades of the vocal colours)
    this.harmonyColorCache = null;
    this.invalidate();
  }

  countdownState(pane, t, lyrics = false) {
    if (!this.countdowns) return null;
    if (lyrics) pane.countdownsLyrics ??= waitCountdowns(pane.chart, { percussion: false, min: this.countdownMin }); // karaoke: percussion hits are no singing
    else pane.countdowns ??= waitCountdowns(pane.chart, { min: this.countdownMin });
    const c = countdownAt(lyrics ? pane.countdownsLyrics : pane.countdowns, t);
    if (!c || c.remaining <= COUNTDOWN_HIDE_SEC) return null; // (YARG hides it 1.5 s before the notes: faded out by 1 s)
    let label;
    if (this.countdownUnit === 'measures') {
      pane.measureStarts ??= measureStarts(pane.chart.beats);
      label = measuresLeft(pane.measureStarts, t, t + c.remaining);
    } else label = Math.ceil(c.remaining);
    // The number only counts down while the song plays: a clock that wobbles by a few ms around a measure (or second) boundary (the start of a playback, a seek
    // settling) must not make it flip between two values every frame. Within the same countdown and a small step in time it never goes up.
    const prev = pane.cdLabel;
    const end = t + c.remaining;
    if (prev && Math.abs(prev.end - end) < 0.05 && t >= prev.t - 0.3 && t <= prev.t + 1) label = Math.min(label, prev.label);
    pane.cdLabel = { end, t, label };
    c.label = label;
    return c;
  }

  // The countdown badge: a ring that empties around the seconds left, centred at (cx, cy).
  drawCountdownBadge(cx, cy, r, c) {
    const g = this.g;
    const secs = c.dim ? Math.round(c.total) : c.label ?? Math.ceil(c.remaining); // a dim badge (past / future) shows the length of the rest in seconds; a live one the measures or the seconds left
    const urgent = !c.dim && c.remaining <= 3.05;
    g.save();
    g.globalAlpha *= c.dim ?? countdownAlpha(c); // eases in at the start of the gap and out before the notes return (YARG's fade)
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    const cc = this.cdColors;
    g.fillStyle = withAlpha(cc.fill, cc.fillAlpha);
    g.fill();
    g.lineWidth = Math.max(3, r * 0.1);
    g.strokeStyle = withAlpha(cc.track, cc.trackAlpha);
    g.stroke();
    g.beginPath(); // what is left of the gap
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (c.remaining / c.total));
    g.strokeStyle = c.dim ? cc.dimRing : urgent ? cc.urgent : cc.ring; // past and future countdowns are all grey
    g.lineCap = 'round';
    g.stroke();
    g.fillStyle = c.dim ? cc.dimText : urgent ? cc.urgentText : cc.text;
    g.font = `700 ${Math.round(r * 1.05)}px system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(secs), cx, cy + r * 0.04);
    g.textBaseline = 'alphabetic';
    g.restore();
  }

  // The vertical middle of the pitch area of the vocal chart (the same area `renderVocals` lays the notes out in): below the harmony
  // lyric line, if any, and above the lyrics at the bottom.
  // The pitch area is at most this tall, like YARG's vocal track (aspect ratio between 8:1 and 13:1): wide and low, so the notes
  // sit close to the lyrics. (VocalTrack.cs MIN_ASPECT_RATIO.)
  vocalMaxArea(w) { return Math.max(150, w / 6); }

  vocalCenterY(chart, h, w = Infinity) {
    const second = (chart.lyrics2 || []).length > 0;
    const secondSize = Math.max(15, Math.min(26, h * 0.08)) * this.lyricScale;
    const fontSize = Math.max(24, Math.min(36, h * 0.095)) * this.lyricScale;
    const lyricY = h - fontSize * 0.75;
    const bottom = lyricY - fontSize * 0.5 - 16;
    const top = Math.max(second ? secondSize * 0.75 + secondSize * 0.75 : 8, bottom - this.vocalMaxArea(w));
    return (top + bottom) / 2;
  }

  // The wait countdown of a chart pane (YARG's WaitCountdown), over the centre; in the vocal notes view it sits to the left of
  // the hit line, where the notes are not. (Karaoke shows it beside the next line instead, see renderLyricSheet.)
  drawCountdown(pane, t, w, h) {
    const c = this.countdownState(pane, t);
    if (!c) return;
    if (pane.chart.mode === 'vocals') {
      const hitX = w * 0.15;
      const r = Math.max(18, Math.min(hitX * 0.4, h * 0.2, 60));
      this.drawCountdownBadge(hitX / 2, this.vocalCenterY(pane.chart, h, w), r, c); // same height as the percussion
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
      if (this.lyricOutline) {
        g.lineWidth = Math.max(3, sz * 0.14);
        g.strokeStyle = 'rgba(0,0,0,0.65)';
        g.strokeText(syl.text, x, cy);
      }
      g.fillStyle = `rgba(255,255,255,${alpha})`;
      g.fillText(syl.text, x, cy);
      const p = prog ? prog[i] : 0;
      if (p > 0) { // the sung part
        g.save();
        g.beginPath();
        g.rect(x, cy - sz, sw * p, sz * 2);
        g.clip();
        g.fillStyle = this.vocColors.present;
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
  // back to the singer a few seconds after you stop. Clicking a line seeks to it. Rests of `countdownMin` (9 s) or more get a countdown row
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
    // Sizes: the font stays the same (it does not follow the height) while the previous, current and next lines fit; it only
    // shrinks when they cannot.
    const peekPx = h * this.sheetPeek; // how much of the lines before the focus shows at the top: a share of the sheet's height
    let big = Math.max(18, Math.min(46, w * 0.06)) * this.lyricScale; // (setting highway.lyricSize)
    let small = Math.max(14, big * 0.72);
    let step = Math.max(small * 1.55, big * 1.15);
    while (big > 16 && peekPx - small * 0.5 + step * 2 + small * 0.6 > h) {
      big -= 2;
      small = Math.max(12, big * 0.72);
      step = Math.max(small * 1.55, big * 1.15);
    }
    sheet.step = step;
    const top = peekPx - small * 0.5 + step; // where the row in focus sits (the row before it ends `peekPx` from the top)
    const now = performance.now();
    const dt = Math.min(0.25, (now - (state.at || now)) / 1000);
    state.at = now;
    if (state.lastT != null && Math.abs(t - state.lastT) > 1.5) state.following = true; // the music jumped (a seek): follow it again
    state.lastT = t;
    const margin = Math.min(40, h * 0.12);
    const clampHold = (v) => Math.max(0, Math.min(rows.length - 1, v));
    const rowVisible = (row, hold) => { // is that row on screen (clear of the faded edges) when the sheet is held at `hold`?
      const y = top + (row - hold) * step;
      return y >= margin * 0.8 && y <= h - margin * 0.8;
    };
    if (state.following === false) {
      state.hold = clampHold(state.hold ?? focusRow); // the sheet stays where you put it...
      let visible = rowVisible(focusRow, state.hold);
      if (state.lastFocus !== focusRow && state.lastVisible && !visible) { // ...until the music pushes the current line out of view:
        const below = top + (focusRow - state.hold) * step > h / 2; // then it scrolls just enough to bring it back
        state.hold = clampHold(below ? focusRow - (h - margin - step - top) / step : focusRow - (top + step * 0.2 - top) / step);
        visible = rowVisible(focusRow, state.hold);
      }
      state.lastVisible = visible;
      state.curVisible = visible;
    } else { state.lastVisible = true; state.curVisible = true; }
    state.lastFocus = focusRow;
    const target = state.following === false ? state.hold : focusRow;
    if (state.pos == null || !Number.isFinite(state.pos) || Math.abs(target - state.pos) > 40) state.pos = target;
    else state.pos += (target - state.pos) * (1 - Math.exp(-dt / 0.12));
    const badgeR = Math.max(14, Math.min(step * 0.38, 30));
    let hovered = null; // the row under the resting pointer, if any
    let seenFrom = Infinity;
    let seenTo = -Infinity; // the time range of the lines on screen, for the rail
    // With a visualizer behind, the rows go on their own layer and the edge fades erase them (below), so only the words fade out.
    let rowLayer = null;
    {
      const dpr = this.canvas.width / (this.canvas.clientWidth || 1);
      rowLayer = this.layerFor(w, h, dpr, 'rowLayer');
      const lg = rowLayer.getContext('2d');
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.clearRect(0, 0, rowLayer.width, rowLayer.height);
      lg.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.g = lg;
    }
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
        hovered = this.hoverRow(sheet, x0, y0, y, step, start, w / 2 - badgeR, w / 2 + badgeR, badgeR) ?? hovered;
        continue;
      }
      const i = row.i;
      seenFrom = Math.min(seenFrom, lines[i].start);
      seenTo = Math.max(seenTo, lines[i].end);
      const cur = singing && i === idx;
      const past = i < first ? 0.3 : Math.max(0.3, 0.7 - Math.max(0, i - first) * 0.06);
      const shown = this.drawKaraokeLine(lines[i], cur ? big : small, w, y, cur ? 0.95 : past, cur ? t : null);
      sheet.hits.push({ y: y + y0, half: step / 2, time: lines[i].start });
      hovered = this.hoverRow(sheet, x0, y0, y, step, lines[i].start, shown.x, shown.x + shown.total, (cur ? big : small) * 0.7) ?? hovered;
    }
    const fade = Math.min(92, h * 0.32); // the lines dissolve into the background at the top and bottom edges: opaque at the very edge, easing out
    const eg = rowLayer ? this.g : g; // the layer (to erase) or the stage (to paint over)
    const fadeIn = eg.createLinearGradient(0, 0, 0, fade);
    const fadeOut = eg.createLinearGradient(0, h, 0, h - fade);
    for (const [pos, c] of LYRIC_RAMP_STOPS) { // opaque at the very edge, then a smootherstep (position^0.7) over the whole band, which eases both ends
      fadeIn.addColorStop(pos, c);
      fadeOut.addColorStop(pos, c);
    }
    if (rowLayer) eg.globalCompositeOperation = 'destination-out';
    eg.fillStyle = fadeIn;
    eg.fillRect(0, 0, w, fade);
    eg.fillStyle = fadeOut;
    eg.fillRect(0, h - fade, w, fade);
    if (rowLayer) {
      eg.globalCompositeOperation = 'source-over';
      this.g = g;
      g.drawImage(rowLayer, 0, 0, rowLayer.width, rowLayer.height, 0, 0, w, h);
    }
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
        g.fillStyle = hot ? this.jumpColors().fillHot : this.jumpColors().fill;
        g.beginPath();
        if (g.roundRect) g.roundRect(bx, by, bw, bh, 13);
        else g.rect(bx, by, bw, bh);
        g.fill();
        g.lineWidth = hot ? 1.5 : 1;
        g.strokeStyle = hot ? this.vocColors.leadLit : withAlpha(this.vocColors.frame, 0.6);
        g.stroke();
        g.fillStyle = hot ? '#ffffff' : this.jumpColors().icon;
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
    const rail = this.drawSheetRail(t, w, h, ctx, rows, lines, seenFrom, seenTo);
    // The Autoscroll button (back to following the singer), shown only while the line being sung is off screen: next to the song marker on the rail, bottom centre without a rail.
    // It slides in from the right and fades while the sheet is held, and goes back the same way.
    const nowB = performance.now();
    if (state.following === false && !state.curVisible) state.offSince ??= nowB; // how long the line being sung has been out of view
    else state.offSince = null;
    // only when it has been out of view for a few seconds, so a short exit does not flash the button
    const wantBtn = state.offSince !== null && nowB - state.offSince >= 2500 ? 1 : 0;
    const dtB = Math.min(0.1, (nowB - (state.btnAt || nowB)) / 1000);
    state.btnAt = nowB;
    state.btnK = (state.btnK ?? 0) + (wantBtn - (state.btnK ?? 0)) * (1 - Math.exp(-dtB / 0.07));
    if (!wantBtn && state.btnK < 0.02) state.btnK = 0;
    if (state.btnK > 0) {
      const k = state.btnK;
      const bw = 34;
      const bh = 34;
      const bx = rail ? rail.rx - 10 - bw : (w - bw) / 2;
      const by = rail ? Math.max(rail.y0, Math.min(rail.y1 - bh, rail.my - bh / 2)) : h - bh - 14;
      const ptB = this.pointer;
      const hotB = wantBtn === 1 && !!ptB && ptB.x >= x0 + bx && ptB.x <= x0 + bx + bw && ptB.y >= y0 + by && ptB.y <= y0 + by + bh;
      g.save();
      g.globalAlpha = k;
      g.translate(bx + bw / 2 + (1 - k) * 10, by + bh / 2); // comes in from the right, growing
      g.scale(0.82 + 0.18 * k, 0.82 + 0.18 * k);
      g.translate(-(bx + bw / 2), -(by + bh / 2));
      g.fillStyle = hotB ? this.jumpColors().fillHot : this.jumpColors().fill;
      g.beginPath();
      if (g.roundRect) g.roundRect(bx, by, bw, bh, 17);
      else g.rect(bx, by, bw, bh);
      g.fill();
      g.lineWidth = hotB ? 1.5 : 1;
      g.strokeStyle = hotB ? this.vocColors.leadLit : withAlpha(this.vocColors.frame, 0.7);
      g.stroke();
      g.fillStyle = hotB ? '#ffffff' : this.jumpColors().icon;
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      g.fillRect(cx - 8, cy - 7, 2.5, 14); // the jump-to icon: a triangle running to a bar
      g.beginPath();
      g.moveTo(cx - 3, cy - 7);
      g.lineTo(cx - 3, cy + 7);
      g.lineTo(cx + 8, cy);
      g.closePath();
      g.fill();
      g.restore();
      if (wantBtn && k > 0.5) sheet.button = { x: x0 + bx, y: y0 + by, w: bw, h: bh };
    }
  }

  // The colours of the sheet's two buttons (jump to the next lines, Autoscroll): dark fill tinted with the vocal frame colour (the theme's accent), the icon its light shade.
  jumpColors() {
    const vc = this.vocColors;
    if (this._jumpFor !== vc) {
      this._jumpFor = vc;
      this._jump = { fill: withAlpha(mixHex('#141a24', vc.frame, 0.2), 0.95), fillHot: withAlpha(mixHex('#141a24', vc.frame, 0.5), 0.98), icon: vc.leadLit };
    }
    return this._jump;
  }

  // The rail at the right edge of a sheet: the whole song top to bottom, like a seek bar you cannot touch. Shows how far the
  // song is (fill and a marker with the percentage), the rests (grey bands), the percussion sections (light bands), where
  // the singing enters again (green ticks) and the part of the song the sheet shows now (the bracket).
  drawSheetRail(t, w, h, ctx, rows, lines, seenFrom, seenTo) {
    const g = this.g;
    const dur = ctx.duration;
    if (!(dur > 0) || h < 80) return null;
    const rx = w - 18;
    const rw = 6;
    const y0 = 12;
    const y1 = h - 12;
    const yOf = (time) => y0 + (Math.max(0, Math.min(dur, time)) / dur) * (y1 - y0);
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(rx, y0, rw, y1 - y0);
    for (const gap of ctx.pauses) { // rests
      g.fillStyle = 'rgba(139,148,158,0.55)';
      g.fillRect(rx, yOf(gap.start), rw, Math.max(2, yOf(gap.end) - yOf(gap.start)));
    }
    for (const sec of ctx.perc) { // percussion sections
      g.fillStyle = 'rgba(230,237,243,0.8)';
      g.fillRect(rx + 1, yOf(sec.start), rw - 2, Math.max(2, yOf(sec.end) - yOf(sec.start)));
    }
    g.fillStyle = this.vocColors.present;
    for (const row of rows) { // entries: the singing starts after a rest
      if (row.type === 'cd') g.fillRect(rx - 7, Math.round(yOf(row.gap.end)), 6, 2);
    }
    if (seenTo > seenFrom) { // what the sheet shows now
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1;
      g.strokeRect(rx - 2.5, yOf(seenFrom), rw + 5, Math.max(6, yOf(seenTo) - yOf(seenFrom)));
    }
    const my = yOf(t); // where the song is
    g.fillStyle = 'rgba(0,0,0,0.62)'; // an overlay on the part that has played: what is behind is dimmed, what is ahead is bright
    g.fillRect(rx - 2, y0 - 1, rw + 4, Math.max(0, my - y0 + 1));
    g.fillStyle = '#ffffff';
    g.fillRect(rx - 3, my - 1, rw + 6, 2);
    g.restore();
    return { rx, my, y0, y1 };
  }

  // The sheet under the canvas point (x, y), or null.
  sheetAt(x, y) {
    return this.sheets.find((s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) ?? null;
  }

  // Wheel / drag over a sheet (`lines` = how many lines to move).
  scrollSheet(sheet, lines) {
    this.invalidate();
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
    this.invalidate();
    sheet.state.following = true;
  }

  // Is the pointer over this row of a sheet? If it is, remember which row, and when it stays there for 0.6 s the page shows
  // the "Play from here" button. Returns { key, time, y } (y in sheet coordinates) or null.
  hoverRow(sheet, x0, y0, y, step, time, left, right, halfH) {
    const pt = this.pointer;
    if (!pt) return null;
    // the pointer must be over the text itself (a little slack at its right, towards the button), not anywhere on the line...
    const inText = pt.x >= x0 + left - 10 && pt.x <= x0 + right + 18 && Math.abs(pt.y - (y + y0)) <= halfH;
    // ...or on the button that this row is offering
    const sp = this.jump?.spec;
    const onBtn = !!sp && this.jump.target === 1 && sp.key === `${x0},${y0}` && sp.time === time
      && pt.x >= x0 + sp.bx && pt.x <= x0 + sp.bx + sp.bw && pt.y >= y0 + sp.by && pt.y <= y0 + sp.by + sp.bh;
    if (!inText && !onBtn) return null;
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

  // The opacity of a note's head: disabled notes (the stretch replayed after a rewind, and what comes after the end of a loop) are dim, ghost notes a little less.
  disabledNote(n) {
    return (this.replayWindow !== null && n.time >= this.replayWindow.from && n.time <= this.replayWindow.to) || (this.loopEnd !== null && n.time > this.loopEnd);
  }

  noteAlpha(n) {
    if (this.disabledNote(n)) return REPLAY_ALPHA;
    return n.ghost ? GHOST_ALPHA : 1;
  }

  renderLanes(t, w, h) {
    const g = this.g;
    const chart = this.chart;
    const laneW = Math.min(Math.min(190, Math.max(90, h * 0.13)), (w * 0.8) / chart.lanes); // lanes grow with the stage height on big screens
    const x0 = (w - laneW * chart.lanes) / 2;
    const hitY = h * HIT_Y;
    const pxPerSec = (hitY / (BASE_LOOKAHEAD_SEC * laneLookFactor(h))) * this.neck; // (fixed pixel speed: a taller window shows more lookahead)
    LY_HIT = hitY;
    LY_T = t;
    LY_PPS = pxPerSec;
    // Notes are drawn from this far ahead, so the ones past the top edge are already walking in.
    const ahead = hitY / pxPerSec + ENTRY_MARGIN_SEC;

    // In a long rest the whole board (base, tint, bands, guides) turns more transparent together, so the background shows through
    // instead of the light tint taking over the thinner dark base.
    const boardK = this.restBoard(t, ahead - ENTRY_MARGIN_SEC);
    g.globalAlpha = boardK;
    // star power / solo bands
    if (this.starPowerBand) this.fillSpans(chart.starPower, t, ahead, x0, laneW * chart.lanes, h, STAR_POWER_BAND);
    if (this.soloBand) this.fillSpans(chart.solos, t, ahead, x0, laneW * chart.lanes, h, SOLO_BAND);
    // drum fills / big rock endings (YARG activation phrases and BRE), a faint band under the notes
    for (let i = 0; i < FILL_KINDS.length; i++) {
      if (FILL_KINDS[i] === 'fill' && !this.fillBand) continue;
      if (FILL_KINDS[i] === 'bre' && this.breBand === 'off') continue;
      const spans = spansOfKind(chart, chart.fills, 'kind', FILL_KINDS[i]);
      if (FILL_KINDS[i] === 'bre') { // the big rock ending: every lane in its own colour, pulsing (see breAlpha)
        const cols = chart.laneColors || NOTE_PALETTE.lanes;
        const pulseBre = this.breBand === 'pulse';
        for (let l = 0; l < chart.lanes; l++) this.fillSpans(spans, t, ahead, x0 + l * laneW, laneW, h, withAlpha(cols[l] || cols[0], breAlpha(t, l, chart.lanes, pulseBre)));
      } else this.fillSpans(spans, t, ahead, x0, laneW * chart.lanes, h, FILL_COLORS[FILL_KINDS[i]]);
    }
    // drum rolls: one band per roll type (kick roll, tremolo lane, trill lane)
    for (let i = 0; i < ROLL_TYPES.length; i++) {
      this.fillSpans(spansOfKind(chart, chart.rolls, 'type', ROLL_TYPES[i]), t, ahead, x0, laneW * chart.lanes, h, ROLL_COLORS[ROLL_TYPES[i]]);
    }

    // beat lines
    const beatStyle = this.beatStyles['2d'];
    const beats = beatStyle ? chart.beats : NO_BEATS; // (setting highway.beatLines: off draws none)
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      if (b.time > t + ahead) continue;
      const y = laneY(b.time);
      if (y > h) continue; // already below the screen; lines above the top are clipped by the canvas
      g.fillStyle = b.measure ? beatStyle[0] : b.strong ? beatStyle[1] : beatStyle[2]; // measure, strong beat (the middle of an even measure), weak beat
      g.fillRect(x0, y, laneW * chart.lanes, b.measure ? 2 : b.strong ? 1.5 : 1);
    }

    // lane guides
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < chart.lanes && this.laneStripes; i++) {
      if (i % 2 === 0) g.fillRect(x0 + i * laneW, 0, laneW, h); // down to the bottom edge, where it fades out
    }
    g.globalAlpha = 1;
    // (there is no hit line: the pads mark the spot)

    // sustains first, then heads
    const from = firstVisibleIndex(chart.notes, t, this.maxLength);
    const notes = chart.notes;
    let end = from; // the notes that can be seen are notes[from .. end)
    while (end < notes.length && notes[end].time <= t + ahead) end++;
    const radius = Math.min(laneW * 0.36, 26) * this.noteSize; // (setting highway.noteScale: heads and pads)
    const colors = chart.laneColors || NOTE_PALETTE.lanes;
    const tailW = this.sustainWidth;
    const held = this.heldMotion; // (setting highway.heldPulse: off keeps the held head, tail and pad still)
    const wide = this.noteStyle === 'rect' ? RECT_WIDEN_2D : 1; // 2D rounded rectangles are a bit wider than the shared shape

    // hit pads, like the 3D view: a ring per lane at the hit line, lit when a note is hit, while a long note is held,
    // and (every pad) on a pedal or open hit
    if (FLASH_2D.length < chart.lanes) FLASH_2D = new Float64Array(chart.lanes);
    const flash = FLASH_2D;
    flash.fill(0, 0, chart.lanes);
    let barFlash = 0;
    const shimmer = held ? tailShimmer(t) : 0.5; // (the same for every note of the frame)
    const pulse = held ? heldPulse(t) : HELD_SCALE;
    const flicker = held ? 0.15 * Math.sin(t * 22) : 0;
    for (let vi = from; vi < end; vi++) {
      const n = notes[vi];
      const past = t - n.time;
      if (past < 0) continue;
      if (n.lane >= 0 && !n.open) {
        if (past < HIT_FLASH_SEC) flash[n.lane] = Math.max(flash[n.lane], 1 - past / HIT_FLASH_SEC);
        flash[n.lane] = Math.max(flash[n.lane], heldAmount(n, t) * (0.75 + flicker));
      } else if (past < BAR_FLASH_SEC) {
        barFlash = Math.max(barFlash, 1 - past / BAR_FLASH_SEC);
      }
    }
    for (let i = 0; i < chart.lanes; i++) {
      g.beginPath();
      const cymbalLane = chart.laneKinds?.[i] === 'cymbal'; // extended drums: the cymbal lanes have triangle pads
      noteShape(g, x0 + (i + 0.5) * laneW, hitY, radius * 1.05 * (cymbalLane ? 1 : wide), radius * 1.05, cymbalLane ? 'tri' : this.noteStyle);
      g.fillStyle = withAlpha(colors[i], Math.min(0.9, this.padFill + 0.5 * flash[i] + 0.35 * barFlash));
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = withAlpha(colors[i], Math.min(1, this.padRing + (1 - this.padRing) * Math.max(flash[i], barFlash)));
      g.stroke();
    }

    // kick (lane -1) is a bar across all columns, not a column
    // pedal bars go behind the other notes and sustains
    for (let vi = from; vi < end; vi++) {
      const n = notes[vi];
      g.filter = this.disabledNote(n) ? DISABLED_FILTER : 'none'; // disabled notes lose their colour
      if (n.lane >= 0 && !n.open) continue;
      const past = t - exitTime(n); // long notes: the exit starts when the tail ends
      if (past > FADE_SEC) continue;
      const k = Math.max(0, past) / FADE_SEC; // same exit animation as the other heads
      const cy = laneY(Math.max(n.time, t));
      const full = laneW * chart.lanes;
      const height = KICK_BAR_HALF_H * this.kickBar * 2 * (1 + 0.4 * k); // (setting highway.kickBarHeight)
      g.globalAlpha = 1 - k;
      g.fillStyle = tintWhite(n.open ? NOTE_PALETTE.open : chart.drumKind === 'five' ? NOTE_PALETTE.kick5 : NOTE_PALETTE.kick, k);
      // double kick: a second bar stacked above the first
      g.fillRect(x0, cy + 0 - height / 2, full, height);
      if (n.doubleKick) g.fillRect(x0, cy + -(height + DOUBLE_KICK_GAP) - height / 2, full, height);
    }
    g.globalAlpha = 1;

    for (let vi = from; vi < end; vi++) {
      const n = notes[vi];
      g.filter = this.disabledNote(n) ? DISABLED_FILTER : 'none'; // disabled notes lose their colour
      if (!n.length || n.lane < 0) continue;
      const yTop = laneY(n.time + n.length);
      const yBot = laneY(Math.max(n.time, t));
      if (n.open) {
        g.fillStyle = withAlpha(NOTE_PALETTE.open, 0.35);
        g.fillRect(x0, yTop, laneW * chart.lanes, Math.max(0, yBot - yTop));
        continue;
      }
      const cx = x0 + (n.lane + 0.5) * laneW;
      const rad = radius * noteScale(n); // HOPO notes are smaller
      // held (active): the whole tail is lighter, more opaque and slowly brightens and dims (no extra shapes)
      const amt = heldAmount(n, t); // fades in after the hit
      g.fillStyle = withAlpha(noteColor(n, colors), 0.55 + 0.25 * amt);
      g.fillRect(cx - rad * 0.35 * tailW, yTop, rad * 0.7 * tailW, Math.max(0, yBot - yTop)); // (tailW: setting highway.sustainWidth)
      if (amt > 0) {
        g.fillStyle = `rgba(255,255,255,${amt * (0.3 + 0.12 * shimmer)})`;
        g.fillRect(cx - rad * 0.35 * tailW, yTop, rad * 0.7 * tailW, Math.max(0, yBot - yTop));
        // soft halo around the tail while it is played, with a rounded end (the cap only if the end is on screen)
        g.globalCompositeOperation = 'lighter';
        fillTailHalo(g, noteColor(n, colors), cx, rad * 0.35 * tailW, rad * 1.1, yTop, yBot, 0.11 * amt, n.time + n.length <= t + ahead);
        g.globalCompositeOperation = 'source-over';
      }
    }

    // Heads. Once a note reaches the hit line it stops moving and plays its exit animation:
    // it grows, fades and turns white over FADE_SEC, for pedals too.
    for (let vi = from; vi < end; vi++) {
      const n = notes[vi];
      g.filter = this.disabledNote(n) ? DISABLED_FILTER : 'none'; // disabled notes lose their colour
      if (n.lane < 0 || n.open) continue; // pedals and open notes are drawn above, behind the other notes
      const past = t - exitTime(n); // long notes: the exit starts when the tail ends
      if (past > FADE_SEC) continue;
      const k = Math.max(0, past) / FADE_SEC; // 0 at the hit line, 1 when gone
      const cy = laneY(Math.max(n.time, t)); // parked on the hit line during the exit
      const amt = heldAmount(n, t);
      const white = Math.min(1, k + amt * (0.32 + 0.12 * shimmer)); // an active long note's head is lighter, like its tail
      // ghost notes are dimmed, accents are larger (YARG draws them the same way)
      g.globalAlpha = (1 - k) * this.noteAlpha(n); // disabled while replaying a rewound stretch or after the end of a loop
      const cx = x0 + (n.lane + 0.5) * laneW;
      const r = radius * noteScale(n) * (1 + 0.4 * k) * (1 + (pulse - 1) * amt);
      if (amt > 0) { // a soft halo while the note is held
        g.globalCompositeOperation = 'lighter';
        g.save();
        g.translate(cx, cy);
        fillHalo(g, noteColor(n, colors), r * 0.7, r * 1.7, 0.45 * amt); // radial fade-out
        g.restore();
        g.globalCompositeOperation = 'source-over';
      }
      const faced = !n.cymbal && this.noteStyle === 'rect'; // a note in the rectangular style: the vector note after the design (chrome caps, coloured band, base)
      if (faced) {
        drawYNote(g, cx, cy, r * wide * NOTE_RECT_W, r * NOTE_RECT_H, n, colors[n.lane], tintWhite(n.sp ? noteColor(n, colors) : colors[n.lane], white), 0, YNOTE_SIDE_2D * this.noteBase);
        if (n.accent) {
          g.beginPath();
          noteShape(g, cx, cy, r * wide, r, 'ynote');
          g.lineWidth = ACCENT_OUTLINE_WIDTH;
          g.strokeStyle = darken(colors[n.lane], ACCENT_OUTLINE_DARKEN);
          g.stroke();
        }
        continue;
      }
      g.beginPath();
      const disc = n.cymbal && this.noteStyle === 'rect'; // the rectangular style draws a cymbal as YARG's chrome disc (the circle style keeps the triangle)
      if (disc) noteShape(g, cx, cy, r * 0.95, r * 0.95, 'round');
      else noteShape(g, cx, cy, n.cymbal ? r : r * wide, r, n.cymbal ? 'tri' : this.noteStyle); // cymbals: rounded triangle
      g.fillStyle = tintWhite(n.sp ? noteColor(n, colors) : n.tap ? NOTE_PALETTE.tap : colors[n.lane], white);
      g.fill();
      if (disc) drawCymbalFace(g, cx, cy, r * 0.95, r * 0.95, n, colors[n.lane]);
      // accent: same size, with a thicker outline in a darker shade of the note's colour
      g.lineWidth = n.accent ? ACCENT_OUTLINE_WIDTH : 2;
      g.strokeStyle = n.accent ? darken(colors[n.lane], ACCENT_OUTLINE_DARKEN) : 'rgba(0,0,0,0.5)'; // (star power notes have no coloured outline: the white body and, in the rectangular style, the gold caps mark them)
      g.stroke();
      if (n.hopo) { // guitar HOPO: a white dot in the head (the rectangular style has white strips instead)
        g.beginPath();
        noteShape(g, cx, cy, r * 0.35, r * 0.35, this.noteStyle);
        g.fillStyle = k === 0 ? HOPO_DOT : `rgba(255,255,255,${0.9 * (1 - k)})`;
        g.fill();
      }
    }
    g.globalAlpha = 1;
    g.filter = 'none';

    // a very short fade at the bottom: the board dissolves right below the pads
    const bottomFade = Math.min(h - hitY, radius * 1.05 + 80);
    const fadeStart = Math.max(hitY + radius * 1.05, h - bottomFade);
    if (h - fadeStart > 2) {
      const bf = fadeGradient(g, fadeStart, h, BOTTOM_FADE_STOPS);
      g.globalCompositeOperation = this.layered ? 'destination-out' : 'source-over';
      g.fillStyle = bf;
      g.fillRect(0, fadeStart, w, h - fadeStart);
      g.globalCompositeOperation = 'source-over';
    }

    // the board's neutral dark base, as opaque as the setting says: behind the notes and the guides, and not faded at the edges
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = boardBase(this.trackOpacity * boardK); // (more transparent in a long rest)
    g.fillRect(x0, 0, laneW * chart.lanes, h);
    g.globalCompositeOperation = 'source-over';
    // the board and the notes entering from the top dissolve into the background (an eased fade)
    const fadeH = h * 0.12;
    const fade = fadeGradient(g, 0, fadeH, EDGE_FADE_STOPS); // smootherstep: eases at both ends
    g.globalCompositeOperation = this.layered ? 'destination-out' : 'source-over';
    g.fillStyle = fade;
    g.fillRect(0, 0, w, fadeH);
    g.globalCompositeOperation = 'source-over';
  }

  // Vocals: pitch on the vertical axis, time on the horizontal axis. Lead notes are bars, harmonies
  // are lighter bars behind them, percussion is a row of diamonds, and lyrics sit under the notes.
  renderVocals(t, w, h) {
    const g = this.g;
    const chart = this.chart;
    const hitX = w * 0.15;
    const pxPerSec = VOCAL_PX_PER_SEC * (this.neck / (this.neckGlobal || this.neck)); // a fixed speed in pixels: a wider window shows more music ahead
    const look = (w * 0.85) / pxPerSec; // seconds of music from the hit line to the right edge
    const range = this.vocalRange(t, look + 1.5);
    const lo = range[0];
    const hi = range[1];
    const second = (chart.lyrics2 || []).length > 0; // harmony charts: the other voices' own words get a line above the chart
    const secondSize = Math.max(15, Math.min(26, h * 0.08)) * this.lyricScale; // (setting highway.lyricSize)
    const secondY = secondSize * 0.75; // the harmony line (and its track) sits right at the top edge
    let top = second ? secondY + secondSize * 0.75 : 8; // pitch area: below the second lyric line, if any, down to the lyrics
    const fontSize = Math.max(24, Math.min(36, h * 0.095)) * this.lyricScale; // lyric size, grows with the band
    const lyricY = h - fontSize * 0.75; // the lyrics and their track sit right at the bottom edge of the window
    const bottom = lyricY - fontSize * 0.5 - 16; // and 16 px of air between them and the notes
    top = Math.max(top, bottom - this.vocalMaxArea(w)); // wide and low, like YARG's track: the notes stay close to the lyrics
    // The track: the note area is nearly see-through (the visualizer shows), the rows of lyrics keep their readable base.
    // The lyric track hugs the words, centred on them, and fades away while a percussion section or a rest with a countdown runs.
    // the lyric track goes away during a percussion section or a rest with a countdown, and comes back 1 s before the next words appear at the right edge
    const stK = this.curPane ? this.restFade(this.curPane, t, look) : 1;
    const trackA = 0.3 * stK; // (the 0.15 layer under it is not drawn while it is hidden either)
    this.trackBase(0, 0, w, h, 0.15 * stK);
    if (trackA > 0.004) {
      const mid1 = lyricY; // the middle of the letters (they are drawn with a middle baseline)
      this.trackBase(0, mid1 - fontSize * 0.75, w, fontSize * 1.5, trackA);
      if (second) {
        const mid2 = secondY;
        this.trackBase(0, Math.max(0, mid2 - secondSize * 0.75), w, secondSize * 1.5, trackA);
      }
    }
    VOC_LO = lo;
    VOC_HI = hi;
    VOC_TOP = top;
    VOC_BOTTOM = bottom;
    const semi = (bottom - top) / (hi - lo); // px per semitone
    const leadHalf = Math.max(6, semi * 0.75); // a note is 1.5 semitones thick, as in YARG (CurrentNoteWidth)
    const harmHalf = Math.max(4, leadHalf * 0.67);
    const mid = (top + bottom) / 2; // talkies (unpitched notes) sit in the middle of the pitch area
    const percussionY = this.vocalCenterY(chart, h, w); // percussion hits sit in the vertical middle of the chart
    VOC_HIT_X = hitX;
    VOC_T = t;
    VOC_PPS = pxPerSec;
    const ahead = look + ENTRY_MARGIN_SEC;
    const behind = hitX / pxPerSec + 0.5; // how long after the hit line a note is still on the stage (it scrolls off the left edge)

    // beat and measure lines, vertical (the same marks the lane charts have), behind everything else
    const beats = chart.beats;
    for (let i = 0; beats && i < beats.length; i++) {
      const b = beats[i];
      if (b.time < t - behind || b.time > t + ahead) continue;
      g.fillStyle = b.measure ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
      const lw = b.measure ? 2 : 1;
      g.fillRect(Math.round(vocX(b.time) - lw / 2), 0, lw, h); // centred on the beat, so what sits on it (percussion) lines up
    }

    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(hitX - 2, 0, 3, h);

    // harmonies first, so the lead is drawn on top
    const harmonies = chart.harmonies;
    for (let i = 0; harmonies && i < harmonies.length; i++) {
      const harmony = harmonies[i];
      const base = this.vocColors.harmony[harmony.part] || this.vocColors.harmony[1];
      this.vocalNotes(harmony.notes, t, ahead, behind, harmHalf, this.harmonyColors(harmony.part, base), hitX); // the part past the hit line is lit, like the lead's
    }
    this.vocalNotes(chart.notes, t, ahead, behind, leadHalf, (this.leadColors ??= [tintWhite(this.vocColors.lead, 0.6), this.vocColors.lead]), hitX); // lit: a lighter shade of the note's own colour

    // percussion: a drum-head marker per hit, in the vertical middle of the chart; a hit flashes when it crosses the line and
    // then dims as it scrolls off.
    const percussion = chart.percussion;
    for (let i = 0; percussion && i < percussion.length; i++) {
      const p = percussion[i];
      const past = t - p.time;
      if (past > PERC_HOLD || p.time > t + ahead) continue; // a hit stops on the hit line, pulses there for a moment and is gone (it does not scroll past)
      const x = past > 0 ? hitX : vocX(p.time);
      const r = Math.max(14, Math.min(22, h * 0.08)); // percussion marker radius
      const k = past > 0 ? Math.min(1, past / PERC_HOLD) : 0; // 0..1 over the pulse
      g.save();
      g.globalAlpha = past > PERC_HOLD * 0.7 ? 1 - (past - PERC_HOLD * 0.7) / (PERC_HOLD * 0.3) : 1;
      if (past > 0 && past < PERC_HOLD) {
        const fade = 1 - k;
        const glow = g.createRadialGradient(x, percussionY, r * 0.4, x, percussionY, r * (2.2 + k));
        glow.addColorStop(0, withAlpha(this.vocColors.perc.glow, 0.55 * fade));
        glow.addColorStop(1, withAlpha(this.vocColors.perc.glow, 0));
        g.fillStyle = glow;
        g.beginPath();
        g.arc(x, percussionY, r * (2.2 + k), 0, Math.PI * 2);
        g.fill();
        for (const [delay, grow, width] of PERC_RINGS) { // two rings going out, one after the other
          const q = Math.max(0, Math.min(1, (k - delay) / (1 - delay)));
          if (q <= 0) continue;
          g.beginPath();
          g.arc(x, percussionY, r * (1 + q * grow), 0, Math.PI * 2);
          g.lineWidth = width * (1 - q) + 0.5;
          g.strokeStyle = withAlpha(this.vocColors.perc.ring, 0.9 * (1 - q));
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
          g.strokeStyle = withAlpha(this.vocColors.perc.ring, 0.9 * fade);
          g.stroke();
        }
      }
      const pop = past > 0 && past < 0.12 ? 1 + 0.65 * Math.sin((Math.PI * past) / 0.12) : 1; // a quick beat: the ball swells and settles in 0.12 s
      const lit = past > 0 && past < PERC_HOLD ? 1 - past / PERC_HOLD : 0; // and flashes from blue-white back to white
      g.beginPath();
      g.arc(x, percussionY, r * pop, 0, Math.PI * 2);
      g.fillStyle = lit > 0 ? mixHex(this.vocColors.perc.ball, this.vocColors.perc.lit, lit) : this.vocColors.perc.ball;
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
    this.lyricRow(second && chart.lyrics1?.length ? chart.lyrics1 : chart.lyrics, lyricY, fontSize, this.vocColors.lyrics, t, behind, ahead); // with a second line, the first one is the lead's own words
    if (second) this.lyricRow(chart.lyrics2, secondY, secondSize, this.vocColors.lyrics2, t, behind, ahead); // the other voices, above the chart
    g.textBaseline = 'alphabetic';
  }

  // One row of syllables. Colours as in YARG's static lyrics (VocalStaticLyricPhraseElement): past grey, present teal,
  // future white (`colors` = [future, present, past]). A syllable never overlaps the one before it.
  lyricRow(list, y, size, colors, t, behind, ahead) {
    const g = this.g;
    g.font = lyricFont(size);
    let prevRight = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l.time < t - behind - 3) continue; // (a few syllables before the window still push the next ones along)
      if (l.time > t + ahead) break;
      const x = Math.max(vocX(l.time), prevRight + 5);
      if (l.vw === undefined || l.vwSize !== size) { l.vw = g.measureText(l.text).width; l.vwSize = size; } // (a word's width at one size never changes: no TextMetrics per frame)
      prevRight = x + l.vw;
      if (l.time < t - behind - 0.8) continue;
      const sungUntil = l.end > l.time ? l.end : list[i + 1]?.time ?? Infinity; // the paired note's end, else the next syllable
      if (this.lyricOutline) { // a dark outline under the letters, so they read over any background (setting highway.lyricOutline)
        g.lineWidth = Math.max(3, size * 0.16);
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        g.lineJoin = 'round';
        g.strokeText(l.text, x, y);
      }
      g.fillStyle = l.time > t ? colors[0] : t < sungUntil ? colors[1] : colors[2];
      g.fillText(l.text, x, y);
    }
  }

  // One vocal note in `color` (a talkie box, or a pitched bar with the ribbon from the note it continues).
  vocalShape(n, prev, x1, bw, y, half, color) {
    const g = this.g;
    g.fillStyle = color;
    g.strokeStyle = color;
    if (n.talkie) {
      g.save();
      g.globalAlpha *= 0.35;
      const ty = VOC_TOP + 10; // a little room above the box
      g.fillRect(x1, ty, bw, VOC_BOTTOM - ty); // a free note fills the chart area above the lyrics
      g.restore();
      g.setLineDash([4, 3]);
      g.lineWidth = 2;
      g.strokeRect(x1, ty, bw, VOC_BOTTOM - ty);
      g.setLineDash([]);
      return;
    }
    if (n.slide && prev && !prev.talkie) { // continues the previous note: a smooth ribbon from its end to this note's start
      const xa = vocX(prev.end);
      const ya = vocY(prev.pitch);
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
  }

  // Notes of a vocal part: rounded pitched bars, a ribbon joining a pitch slide to the note before it (same colour as the
  // notes), and talkies (unpitched notes, '#', '^', '*') as a dashed box in the middle of the pitch area.
  // colors = [passed, idle]: the part of a note that is past the hit line is painted `passed`. null keeps the current fill.
  vocalNotes(notes, t, ahead, behind, half, colors, hitX) {
    const g = this.g;
    const keep = g.fillStyle;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const prev = notes[i - 1];
      const joined = n.slide && prev && !prev.talkie && prev.time <= t + ahead; // a continuation shows with the note it continues
      if (n.end < t - behind || (n.time > t + ahead && !joined)) continue; // a note stays until it has left the stage on the left
      const x1 = vocX(n.time);
      const x2 = Math.max(x1 + 6, vocX(n.end));
      const bw = x2 - x1;
      const y = vocY(n.pitch);
      this.vocalShape(n, prev, x1, bw, y, half, colors ? colors[1] : keep);
      if (colors && (joined ? vocX(prev.end) : x1) < hitX) { // (the ribbon of a continuation starts at the previous note's end) // only the part that has crossed the hit line changes colour
        g.save();
        g.beginPath();
        g.rect(-1e4, -1e4, hitX + 1e4, 2e4);
        g.clip();
        this.vocalShape(n, prev, x1, bw, y, half, colors[0]);
        g.restore();
      }
    }
    if (colors) this.vocalHitGlow(notes, t, half, colors[1], hitX);
  }

  // The height of the vocal line at pixel x, from note `n` (and the one before it): the bar of the note, the S-shaped ribbon that joins a slide to the previous
  // note, or the previous note's bar. null when the line is not there.
  vocalLineY(n, prev, x) {
    if (n.talkie) return null;
    const x1 = vocX(n.time);
    const x2 = Math.max(x1 + 6, vocX(n.end));
    if (x >= x1 && x <= x2) return vocY(n.pitch);
    if (n.slide && prev && !prev.talkie) {
      const xa = vocX(prev.end);
      if (x > xa && x < x1) { // on the ribbon: the pitch glides in a smooth S
        const u = (x - xa) / Math.max(1, x1 - xa);
        const b = u * u * (3 - 2 * u);
        const ya = vocY(prev.pitch);
        return ya + (vocY(n.pitch) - ya) * b;
      }
    }
    if (prev && !prev.talkie) {
      const p1 = vocX(prev.time);
      if (x >= p1 && x <= Math.max(p1 + 6, vocX(prev.end))) return vocY(prev.pitch);
    }
    return null;
  }

  // The hit zone while the voice is at the line: a glow a little larger than the thickness of the note, on the line of the voice (it rises, falls and bends with
  // the pitch, also along the ribbons that join the notes), in the note's colour with a lighter heart. Its size and strength vary all the time, from two
  // shimmers of different speeds, so it looks alive but never flashes. It fades in as a note starts and, when the voice stops, stays for a moment (HOLD) and
  // then fades out (FADE): a short gap between two notes does not make it disappear at all.
  vocalHitGlow(notes, t, half, color, hitX) {
    let i = -1;
    for (let k = 0; k < notes.length; k++) { // the last note that has started (a few ms ahead: the fade-in begins just before)
      if (notes[k].time > t + 0.04) break;
      if (!notes[k].talkie) i = k;
    }
    if (i < 0) return;
    const envOf = (n) => { // 0..1: fade in over the start, 1 while sung and held, then the fade-out
      const attack = Math.max(0, Math.min(1, (t - n.time + 0.02) / 0.04)); // a very quick fade in
      const after = t - n.end;
      if (after <= VOC_GLOW_HOLD) return attack;
      return Math.max(0, 1 - (after - VOC_GLOW_HOLD) / VOC_GLOW_FADE) * attack;
    };
    const n = notes[i];
    let prevI = i - 1;
    while (prevI >= 0 && notes[prevI].talkie) prevI--;
    const prev = prevI >= 0 ? notes[prevI] : null;
    let env = envOf(n);
    if (prev) env = Math.max(env, envOf(prev)); // the strength carries over from the previous note while the new one fades in (the position does not: it is always the latest note's)
    if (env <= 0.004) return;
    let y = this.vocalLineY(n, prev, hitX);
    const next = notes[i + 1];
    if (next && !next.talkie && next.slide) y = this.vocalLineY(next, n, hitX) ?? y; // on the ribbon that joins a slide
    if (y === null || y === undefined) y = vocY(n.pitch);
    // The vertical position is animated: it glides to the voice's height (about 60 ms) instead of jumping when the pitch changes; after a seek or a pause of
    // the song it snaps to the new place.
    const st = (this.vocGlowState ??= new WeakMap()).get(notes) ?? { t: -1e9, y };
    const dt = t - st.t;
    st.y = dt > 0 && dt < 0.25 ? st.y + (y - st.y) * (1 - Math.exp(-dt / 0.06)) : y;
    st.t = t;
    this.vocGlowState.set(notes, st);
    y = st.y;
    const g = this.g;
    const v = 0.5 + 0.5 * Math.sin(t * 9 + n.time * 3) * 0.6 + 0.5 * Math.sin(t * 23 + n.time * 7) * 0.4; // 0..1, varying
    const R = Math.max(9, half * 1.7) * (0.3 + 0.7 * env); // scales in and out with the fade
    // A glint, not a halo: a thin vertical streak of light along the hit line and a shorter horizontal one through the note, crossing in a small bright core, all in
    // the note's colour. Each streak is a few stacked ellipses (wide and faint to narrow and strong), and their lengths shimmer.
    // A spike has an arrowhead at each end: straight sides from the tip out to the shoulders (halfway out, the widest part) and back in to a narrow waist at
    // the middle; a few of them stacked, wide and faint to narrow and strong.
    const spike = (len, wid, strength, rot) => {
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const P = (u, w) => [hitX + u * c - w * sn, y + u * sn + w * c]; // a point along (u) and across (w) the spike
      for (let q = 0; q < 4; q++) {
        const k = 1 - q * 0.2;
        const L = len * 0.4 * k; // 60 % shorter than before
        const W = wid * 2.2 * k; // and thicker
        g.globalAlpha = 0.7 * strength * env * (0.1 + q * 0.09); // 30 % more transparent
        g.beginPath();
        let first = true;
        for (const [u, w] of [[L, 0], [L * 0.5, W], [L * 0.12, W * 0.16], [-L * 0.12, W * 0.16], [-L * 0.5, W], [-L, 0], [-L * 0.5, -W], [-L * 0.12, -W * 0.16], [L * 0.12, -W * 0.16], [L * 0.5, -W]]) {
          const p = P(u, w);
          if (first) { g.moveTo(p[0], p[1]); first = false; } else g.lineTo(p[0], p[1]);
        }
        g.closePath();
        g.fill();
      }
    };
    g.save();
    g.fillStyle = '#ffffff'; // white, with transparency (the note's colour is not used)
    // Three crosses, each turned differently and each with its own rotation speed: the upright one (it only rocks), one at 45 degrees and one at 22.5 degrees that
    // keeps turning; lengths wander too (slow sines of different speeds and phases), so the glint turns and breathes and is never the same twice.
    const wob = (f, ph) => Math.sin(t * f + n.time * 5 + ph);
    const rotA = 0.1 * wob(4.3, 1);
    const rotB = Math.PI / 4 + 0.25 * wob(2.6, 5);
    const rotC = Math.PI / 8 + t * 0.7 + 0.2 * wob(3.4, 9);
    spike(R * (3.2 + 0.8 * wob(7, 0)), R * 0.5, 1, rotA + Math.PI / 2); // up and down the line
    spike(R * (2.4 + 0.6 * wob(5.1, 2)), R * 0.38, 0.9, rotA); // sideways through the note
    spike(R * (2.5 + 0.7 * wob(6.2, 4)), R * 0.4, 0.7, rotB);
    spike(R * (2.5 + 0.7 * wob(5.6, 6)), R * 0.4, 0.7, rotB + Math.PI / 2);
    spike(R * (2.0 + 0.6 * wob(6.8, 8)), R * 0.32, 0.55, rotC); // the third cross: shorter, fainter, always turning
    spike(R * (2.0 + 0.6 * wob(5.9, 10)), R * 0.32, 0.55, rotC + Math.PI / 2);
    g.globalAlpha = 0.7 * (0.35 + 0.2 * v) * env; // the core
    g.beginPath();
    g.arc(hitX, y, R * 0.55, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.7 * (0.55 + 0.25 * v) * env;
    g.beginPath();
    g.arc(hitX, y, R * 0.28, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // Lowest and highest pitched note of the whole chart (and its harmonies), cached per chart.
  harmonyColors(part, base) {
    const cache = (this.harmonyColorCache ??= {});
    return (cache[part] ??= [tintWhite(base, 0.7), base]);
  }

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
    const shifts = this.chart.rangeShifts || NO_SHIFTS;
    if (shifts.length > 1) {
      let active = shifts[0];
      for (let i = 0; i < shifts.length; i++) if (shifts[i].time <= t) active = shifts[i];
      lo = active.min;
      hi = active.max;
      slide = Math.max(slide, active.length / 3);
    } else {
      const full = this.vocalFullRange(); // no range shifts: the range of the whole song, so the view stays still
      lo = full[0];
      hi = full[1];
    }
    if (lo === Infinity) { // nothing ahead: keep the last range
      lo = this.vRange ? this.vRange[0] : 48;
      hi = this.vRange ? this.vRange[1] : 72;
    }
    lo -= 0.75; // half a note width of padding, like NOTE_WIDTH_MULTIPLIER / 2
    hi += 0.75;
    if (hi - lo < 20) {
      const mid = (hi + lo) / 2;
      lo = mid - 10;
      hi = mid + 10;
    }
    const pad = (hi - lo) * 0.1;
    const targetLo = lo - pad;
    const targetHi = hi + pad;
    const now = performance.now();
    const dt = Math.min(0.25, (now - (this.vRangeAt || now)) / 1000);
    this.vRangeAt = now;
    if (!this.vRange) this.vRange = [targetLo, targetHi];
    const k = 1 - Math.exp(-dt / slide);
    const vr = this.vRange; // (eased in place: a new array every frame was garbage)
    vr[0] = vr[0] + (targetLo - vr[0]) * k;
    vr[1] = vr[1] + (targetHi - vr[1]) * k;
    return vr;
  }

  fillSpans(spans, t, ahead, x0, width, h, color) {
    this.g.fillStyle = color;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      if (s.start > t + ahead) continue;
      const top = laneY(s.end);
      const bottom = laneY(s.start);
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
