// First-run welcome: a short dialog with the library, the look of the highway and an audio/visual sync check.
// Pure helpers are exported for the tests; `openOnboarding` builds the DOM and talks to the app through `ctx`.
import { clickParams } from './metronome.js';

export const ONBOARDED_KEY = 'yargremote.onboarded';
export const LATENCY_RANGE = { min: -300, max: 300, step: 5 }; // milliseconds, the audio.latency setting
export const CAL_PERIOD = 1; // seconds between two clicks of the sync check
export const CAL_FLASH = 0.12; // seconds a flash stays lit

// A fresh browser with no saved settings, opened on the plain library (not a song link), and not welcomed before.
export function shouldShowOnboarding({ onboarded = false, changedCount = 0, hash = '' } = {}) {
  if (onboarded || changedCount > 0) return false;
  return !/^#\/song\//.test(hash);
}

// Is the flash lit? `heard` = the audio position that reaches the ears now (audio clock minus the output latency), `delay` = seconds the
// picture is shifted later than the sound (negative = earlier), the click k sounds at k * period.
export function flashLit(heard, delay, period = CAL_PERIOD, length = CAL_FLASH) {
  const t = heard - delay;
  if (!(t >= 0)) return false;
  return t % period < length;
}

export const clampLatency = (ms) => Math.min(LATENCY_RANGE.max, Math.max(LATENCY_RANGE.min, Math.round((Number(ms) || 0) / LATENCY_RANGE.step) * LATENCY_RANGE.step));
export const formatMs = (ms) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms)} ms`;

const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...[].concat(kids));
  return e;
};

// The sync check: a click every second, with a flash that is lit when the click is heard (shifted by the chosen delay).
class SyncCheck {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.ctx = null;
    this.delay = 0;
    this.raf = 0;
    this.timer = 0;
    this.next = 0; // the audio time of the next click to schedule
  }

  get running() { return !!this.ctx; }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.origin = this.ctx.currentTime + 0.2;
    this.next = this.origin;
    const schedule = () => {
      while (this.next < this.ctx.currentTime + 0.5) { this.click(this.next); this.next += CAL_PERIOD; }
    };
    schedule();
    this.timer = setInterval(schedule, 100);
    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      const heard = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0) - this.origin;
      this.onFrame(flashLit(heard, this.delay));
    };
    frame();
  }

  click(at) {
    const p = clickParams('woodblock', false);
    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.0001, at);
    master.gain.exponentialRampToValueAtTime(0.5 * p.peak, at + 0.003);
    master.gain.exponentialRampToValueAtTime(0.0001, at + p.dur);
    master.connect(this.ctx.destination);
    for (const part of p.parts) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = part.type;
      o.frequency.value = part.freq;
      g.gain.value = part.gain;
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + p.dur + 0.02);
    }
  }

  stop() {
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.onFrame(false);
  }
}

// ctx: { prefs, themes: [{ id, name, bg, accent }], palettes: [{ id, label }], pickFolder(), songCount(), openLibrary(), done() }
export function openOnboarding(ctx) {
  const { prefs } = ctx;
  const steps = ['welcome', 'library', 'look', 'sync', 'done'];
  let index = 0;
  let countTimer = 0;
  const sync = new SyncCheck((lit) => flash?.classList.toggle('lit', lit));
  let flash = null;
  const previous = document.activeElement;

  const root = el('div', { class: 'onb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to YARG Remote' });
  const card = el('div', { class: 'onb-card' });
  root.append(card);

  const close = (finished) => {
    clearInterval(countTimer);
    sync.stop();
    try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* optional */ }
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    previous?.focus?.();
    ctx.done?.(finished);
  };
  const go = (i) => { index = Math.max(0, Math.min(steps.length - 1, i)); render(); };

  const dots = () => el('div', { class: 'onb-dots', 'aria-hidden': 'true' }, steps.map((_, i) => el('i', { class: i === index ? 'on' : '' })));
  const nav = ({ next = 'Next', nextDisabled = false } = {}) => el('div', { class: 'onb-nav' }, [
    index > 0 ? el('button', { type: 'button', class: 'chip-btn', text: 'Back', onclick: () => go(index - 1) }) : el('span'),
    el('button', { type: 'button', class: 'chip-btn onb-skip', text: 'Skip setup', onclick: () => close(false) }),
    el('button', { type: 'button', class: 'cta onb-next', text: next, disabled: nextDisabled ? '' : null, onclick: () => (index === steps.length - 1 ? close(true) : go(index + 1)) }),
  ]);
  const seg = (id, options) => {
    const box = el('div', { class: 'seg onb-seg' });
    const paint = () => { for (const b of box.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(prefs.get(id)))); };
    for (const o of options) box.append(el('button', { type: 'button', 'data-v': o.value, text: o.label, onclick: () => { prefs.set(id, o.value); paint(); } }));
    paint();
    return box;
  };

  const views = {
    welcome() {
      return [
        el('h2', { text: 'Welcome to YARG Remote' }),
        el('p', { text: 'Watch and practise Rock Band and YARG songs: the chart scrolls over your stems, with a loop, a speed trainer and the settings to make it yours.' }),
        el('p', { class: 'onb-muted', text: 'Three quick steps: where your songs are, how the highway looks, and a sync check for your speakers or headphones. You can skip any of them and redo them later in Settings, Data and backup.' }),
        nav({ next: 'Start' }),
      ];
    },
    library() {
      const status = el('p', { class: 'onb-status' });
      const refresh = () => {
        const n = ctx.songCount();
        status.textContent = n > 0 ? `${n} songs found. You are set.` : 'No songs yet.';
        status.dataset.ok = String(n > 0);
        const next = card.querySelector('.onb-next');
        if (next) next.textContent = n > 0 ? 'Next' : 'Next without songs';
      };
      countTimer = setInterval(refresh, 500);
      const out = [
        el('h2', { text: 'Your songs' }),
        el('p', { text: 'Point the app at the folder that holds your songs (the one with a folder per song, each with notes.mid or notes.chart and the audio).' }),
        el('button', { type: 'button', class: 'cta onb-pick', text: 'Choose songs folder', onclick: () => ctx.pickFolder() }),
        status,
        el('p', { class: 'onb-muted', text: 'Needs Chrome or Edge to remember the folder. When the app runs from the included server, the songs are already listed.' }),
        nav(),
      ];
      queueMicrotask(refresh);
      return out;
    },
    look() {
      const themes = el('div', { class: 'onb-themes', role: 'group', 'aria-label': 'Theme' });
      const paint = () => { for (const b of themes.children) b.setAttribute('aria-pressed', String(b.dataset.v === prefs.get('theme.preset'))); };
      for (const t of ctx.themes) {
        themes.append(el('button', { type: 'button', class: 'onb-theme', 'data-v': t.id, title: t.name, onclick: () => { prefs.set('theme.preset', t.id); paint(); }, style: `--c-bg:${t.bg};--c-ac:${t.accent}` }, [el('i'), el('span', { text: t.name })]));
      }
      paint();
      return [
        el('h2', { text: 'The look' }),
        el('h3', { text: 'Theme' }), themes,
        el('h3', { text: 'Highway view' }), seg('highway.view', [{ value: '3d', label: '3D' }, { value: '2d', label: '2D' }]),
        el('h3', { text: 'Notes' }), seg('highway.noteStyle', [{ value: 'rect', label: 'Rectangles' }, { value: 'round', label: 'Circles' }]),
        el('h3', { text: 'Note colours' }), seg('highway.palette', ctx.palettes.map((p) => ({ value: p.id, label: p.label }))),
        el('h3', { text: 'Reduce motion' }), seg('ui.reduceMotion', [{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]),
        nav(),
      ];
    },
    sync() {
      flash = el('div', { class: 'onb-flash', 'aria-hidden': 'true' });
      const readout = el('output', { class: 'onb-ms' });
      const input = el('input', { type: 'range', min: LATENCY_RANGE.min, max: LATENCY_RANGE.max, step: LATENCY_RANGE.step, 'aria-label': 'Picture delay in milliseconds' });
      const set = (ms) => {
        ms = clampLatency(ms);
        input.value = ms;
        readout.textContent = formatMs(ms);
        sync.delay = ms / 1000;
        prefs.set('audio.latency', ms);
      };
      input.addEventListener('input', () => set(Number(input.value)));
      const step = (d) => () => set(Number(input.value) + d * LATENCY_RANGE.step);
      const toggle = el('button', { type: 'button', class: 'chip-btn', text: 'Play test clicks', onclick: () => {
        if (sync.running) { sync.stop(); toggle.textContent = 'Play test clicks'; } else { sync.start(); toggle.textContent = 'Stop'; }
      } });
      set(prefs.get('audio.latency'));
      return [
        el('h2', { text: 'Sync check' }),
        el('p', { text: 'Press play: you will hear a click every second while the circle flashes. If the flash comes after the sound, move the slider to the left; if it comes before, to the right. Aim for the two to feel simultaneous.' }),
        flash,
        el('div', { class: 'onb-sync' }, [toggle]),
        el('div', { class: 'onb-slider' }, [
          el('button', { type: 'button', class: 'chip-btn', text: '−5', 'aria-label': 'Earlier', onclick: step(-1) }), input,
          el('button', { type: 'button', class: 'chip-btn', text: '+5', 'aria-label': 'Later', onclick: step(1) }), readout,
        ]),
        el('p', { class: 'onb-muted', text: 'Use the headphones or speakers you play with: Bluetooth adds a lot of delay. The value shifts the notes against the sound and is the Audio latency setting (also a chart delay default).' }),
        nav(),
      ];
    },
    done() {
      const n = ctx.songCount();
      return [
        el('h2', { text: 'You are ready' }),
        el('p', { text: n > 0 ? `${n} songs are waiting in the library. Pick one and press Play.` : 'Choose your songs folder from the library when you are ready.' }),
        el('p', { class: 'onb-muted', text: 'Everything here lives in Settings (the gear, or the comma key), including the setup: Data and backup, Run setup again.' }),
        nav({ next: 'Open the library' }),
      ];
    },
  };

  function render() {
    clearInterval(countTimer);
    if (steps[index] !== 'sync') sync.stop();
    flash = null;
    card.replaceChildren(dots(), ...views[steps[index]]());
    card.querySelector('.onb-next, .onb-pick, input')?.focus?.();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(false); return; }
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button:not([disabled]), input')];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  render();
  return { close: () => close(false) };
}
