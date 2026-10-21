// Performance modes (Settings, Performance): the frame-rate cap, the render resolution of the chart canvases and the adaptive
// quality controller. The pure parts (createFrameCap, resolveDpr, createAdaptive, adaptiveEffects) are tested in
// test/quality.test.js; app.js feeds the live inputs (setQualityInputs) and every chart canvas sizes itself with renderDpr().

// ---- Render resolution ----

// Device pixels per CSS pixel, at most, for each perf.renderScale choice. Auto is the long-standing cap (phones report 3+; 2 is
// plenty and keeps the fill rate low).
export const DPR_CAPS = { auto: 2, high: 2, medium: 1.5, low: 1 };
export const ECONOMY_DPR_FACTOR = 0.75; // economy mode draws at 75% of the chosen resolution

// The canvas resolution from the device ratio, the user's choice, economy mode and the adaptive cap (which only ever lowers it).
export function resolveDpr({ device = 1, scale = 'auto', economy = false, adaptiveCap = Infinity } = {}) {
  const d = Number.isFinite(device) && device > 0 ? device : 1;
  const dpr = Math.min(d, DPR_CAPS[scale] ?? DPR_CAPS.auto, adaptiveCap > 0 ? adaptiveCap : Infinity);
  return economy ? dpr * ECONOMY_DPR_FACTOR : dpr;
}

const inputs = { scale: 'auto', economy: false, adaptiveCap: Infinity };
export function setQualityInputs(next) { Object.assign(inputs, next); }
// The resolution every chart canvas uses now (highway, pane layers, visualizer background).
export function renderDpr() { return resolveDpr({ device: globalThis.devicePixelRatio || 1, ...inputs }); }

// ---- Frame-rate cap ----

// Decides, on each requestAnimationFrame callback, whether this one draws. A time accumulator, so a cap the display rate does not
// divide (45 on 60 Hz, 60 on 144 Hz) still averages the cap, with a little slack for the jitter of the frame timestamps (a 60 Hz
// tick of 16.5 ms still counts for a 60 cap). After a long gap (idle, a hitch) it draws at once and starts over: no catch-up burst.
export const FRAME_CAP_SLACK_MS = 3;
export function createFrameCap() {
  let fps = 0;
  let acc = 0;
  let last = null;
  return {
    get fps() { return fps; },
    set(capFps) { fps = Number(capFps) > 0 ? Number(capFps) : 0; acc = 0; last = null; },
    ready(ts) {
      if (!fps) return true;
      if (last === null || !(ts >= last)) { last = ts; acc = 0; return true; }
      const budget = 1000 / fps;
      const slack = Math.min(FRAME_CAP_SLACK_MS, budget * 0.2);
      const dt = ts - last;
      last = ts;
      if (dt > budget * 2) { acc = 0; return true; }
      acc += dt;
      if (acc + slack < budget) return false;
      acc = Math.min(acc - budget, budget);
      return true;
    },
  };
}

// ---- Adaptive quality ----

// The steps, from full quality down. Each level keeps the cuts of the ones before it.
export const ADAPTIVE_STEPS = ['Full quality', 'Fewer motion blur samples', 'Lighter visualizer', 'Render quality 1.5', 'Render quality 1', 'Visualizer off'];
export const ADAPTIVE_MAX = ADAPTIVE_STEPS.length - 1;
export function adaptiveEffects(level) {
  return {
    blurMax: level >= 1 ? 3 : Infinity, // motion blur samples (each one is a whole chart draw)
    vizFactor: level >= 2 ? 0.5 : 1, // the visualizer's own resolution (its quality setting), halved
    dprCap: level >= 4 ? 1 : level >= 3 ? 1.5 : Infinity,
    vizOff: level >= 5,
  };
}

// The target frame time the controller holds the frames to: the cap, or 60 fps (never more: a fast screen at 100+ Hz that "only"
// reaches 90 fps is not a weak device, and lowering its quality would change the look on a good machine).
export const adaptiveBudget = (capFps) => Math.max(1000 / 60, capFps > 0 ? 1000 / capFps : 0);

export const ADAPTIVE_DEFAULTS = {
  alpha: 0.1, // EMA weight of a new frame (about 10 frames)
  downRatio: 1.25, // slow: the average frame interval above 1.25x the budget...
  downAfterMs: 2500, // ...for 2.5 s: one step down
  upRatio: 1.1, // comfortable: the interval holds the budget...
  upWorkRatio: 0.7, // ...and the drawing takes under 0.7x of it...
  upAfterMs: 10000, // ...for 10 s: one step back up
  dwellMs: 3000, // no change sooner than this after the last one
  warmupMs: 1000, // frames ignored after a seek, a resize, a resume, a level change
  outlierMs: 250, // a single frame longer than this (a hitch, a hidden tab) is ignored; a gap this long restarts the averages
  revertMs: 30000, // a step down this soon after a step up means the step up was wrong...
  backoff: 6, // ...so the next step up waits this many times longer (up to backoffMax times)
  backoffMax: 60,
};

// feed(now, intervalMs, workMs, budgetMs) with every drawn frame while the song plays; quiet(now) while it does not (paused, hidden,
// seeking) and after a seek or a resize. Returns the level (0 = full quality .. ADAPTIVE_MAX).
export function createAdaptive(options = {}) {
  const o = { ...ADAPTIVE_DEFAULTS, ...options };
  let level = 0;
  let ema = null;
  let emaWork = null;
  let slowSince = null;
  let fastSince = null;
  let lastAt = null;
  let quietUntil = -Infinity;
  let changedAt = -Infinity;
  let lastUpAt = -Infinity;
  let backoff = 1;
  const restart = () => { ema = null; emaWork = null; slowSince = null; fastSince = null; lastAt = null; };
  const quiet = (now, ms = o.warmupMs) => { quietUntil = Math.max(quietUntil, now + ms); restart(); };
  return {
    get level() { return level; },
    quiet,
    reset() { level = 0; backoff = 1; quietUntil = -Infinity; changedAt = -Infinity; lastUpAt = -Infinity; restart(); },
    feed(now, interval, work, budget) {
      if (!(interval > 0) || interval > o.outlierMs || !(budget > 0)) return level; // an outlier frame: not a trend
      if (now < quietUntil) return level;
      if (lastAt !== null && now - lastAt > o.outlierMs) restart(); // frames stopped for a while: start over
      lastAt = now;
      const w = Number.isFinite(work) && work > 0 ? work : 0;
      ema = ema === null ? interval : ema + o.alpha * (interval - ema);
      emaWork = emaWork === null ? w : emaWork + o.alpha * (w - emaWork);
      const slow = ema > budget * o.downRatio;
      const fast = ema <= budget * o.upRatio && emaWork <= budget * o.upWorkRatio;
      slowSince = slow ? (slowSince ?? now) : null;
      fastSince = fast ? (fastSince ?? now) : null;
      if (now - changedAt < o.dwellMs) return level;
      if (slow && level < ADAPTIVE_MAX && now - slowSince >= o.downAfterMs) {
        if (now - lastUpAt < o.revertMs) backoff = Math.min(o.backoffMax, backoff * o.backoff);
        level++;
        changedAt = now;
        quiet(now);
      } else if (fast && level > 0 && now - fastSince >= o.upAfterMs * backoff) {
        level--;
        changedAt = now;
        lastUpAt = now;
        quiet(now);
      }
      return level;
    },
  };
}
