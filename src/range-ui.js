// Range inputs (sliders): their painted fill (--p), and the mouse wheel over them. Moved out of app.js as is; `installRangeUi()` does what
// app.js used to do at load (wraps the value setters, paints the static sliders, adds the document listeners), so app.js calls it at the same
// point of its start-up. Nothing here touches the DOM at import time.

// Sliders draw their fill and a marker at the default value from two CSS variables: --p (current) and --def.
export function paintRange(input, def) {
  const min = Number(input.min);
  const span = Number(input.max) - min || 1;
  input.style.setProperty('--p', String((Number(input.value) - min) / span));
  if (def !== undefined) input.style.setProperty('--def', String((def - min) / span));
}

// Pure: the value a slider takes after `notches` wheel notches (one step per notch; a slider with more than 100 steps moves 2% of its range),
// clamped and snapped to the step grid, as the string the input is given.
export function wheelValue(value, min, max, step, notches) {
  const move = (max - min) / step > 100 ? (max - min) * 0.02 : step; // fine-grained sliders: 2% of the range
  const next = Math.min(max, Math.max(min, value + notches * move));
  const rounded = Math.round((next - min) / step) * step + min;
  return String(Math.min(max, Math.max(min, +rounded.toFixed(6))));
}

// Pure: the painted fill of a generic slider, 0..1.
export function rangeFraction(value, min, max) {
  const span = max - min || 1;
  return Math.min(1, Math.max(0, (value - min) / span));
}

// The mouse wheel over any slider moves it (up = more, 5 notches... one step per notch; a slider with many steps moves 2% of its range per
// notch); touchpads give fractions, which add up. The seek bar keeps its own wheel (5 s per notch). Listeners elsewhere hear a normal `input`.
const wheelAcc = new WeakMap();
// The (non-passive) listener sits on each range input, not on the document, so scrolling lists never waits for the main thread. It is bound lazily, the first
// time the pointer goes over the slider or it takes the focus (one passive delegated listener each; no MutationObserver over the document).
export function onRangeWheel(e) {
  const el = e.currentTarget;
  if (el.disabled) return;
  e.preventDefault();
  const delta = e.deltaY || e.deltaX;
  const acc = (wheelAcc.get(el) || 0) + -delta / (e.deltaMode === 1 ? 3 : 100);
  const notches = Math.trunc(acc);
  wheelAcc.set(el, acc - notches);
  if (!notches) return;
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const step = Number(el.step) > 0 ? Number(el.step) : 1;
  el.value = wheelValue(Number(el.value), min, max, step, notches);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
// The other sliders (settings, the pause panel, the visualizer menu, the Listen card) get the same custom look: they are painted here, whatever sets their value
// (an input event, a script assigning .value, .min or .max; the static ones once at start, and again when the pointer or the focus reaches them).
// Every such slider is given its value through `.value` after it is built (settings refreshers, syncMetPop, the visualizer menu, the Listen card).
export const GENERIC_RANGE = '.sp-range input[type=range], .pp-row input[type=range], .viz-level input[type=range], .listen input[type=range], .now-playing input[type=range]';
export function paintGenericRange(el) {
  if (!el.matches?.(GENERIC_RANGE)) return;
  el.style.setProperty('--p', String(rangeFraction(Number(el.value), Number(el.min || 0), Number(el.max || 100))));
}
const wheelBound = new WeakSet();
export function reachRange(e) {
  const el = e.target;
  if (el?.type !== 'range' || el.tagName !== 'INPUT') return;
  paintGenericRange(el);
  if (wheelBound.has(el) || el.closest('#seekbox')) return;
  wheelBound.add(el);
  el.addEventListener('wheel', onRangeWheel, { passive: false });
}
// What app.js did at this point of its start-up, in the same order.
export function installRangeUi() {
  for (const prop of ['value', 'min', 'max']) {
    const own = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, prop);
    Object.defineProperty(HTMLInputElement.prototype, prop, { ...own, set(v) { own.set.call(this, v); if (this.type === 'range') paintGenericRange(this); } });
  }
  document.addEventListener('input', (e) => { if (e.target.type === 'range') paintGenericRange(e.target); }, true);
  document.querySelectorAll('input[type=range]').forEach(paintGenericRange);
  document.addEventListener('pointerover', reachRange, { capture: true, passive: true });
  document.addEventListener('focusin', reachRange, true);
}
