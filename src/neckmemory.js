// The chart (neck) speed the user chose, kept between visits: the global slider value and the speed of each instrument's own window.
// { global?: number, base?: number, panes: { [instrument]: number } }. `base` is the highway.neck setting the global value was chosen over: when
// that setting changes later, the new starting value wins and the old choice is dropped.
export const NECK_KEY = 'yargremote.neck';
import { NECK_MIN, NECK_MAX } from './neckscale.js';
export { NECK_MIN, NECK_MAX };
const PANE_KEY = /^[a-z0-9_-]{1,24}$/i;

const valid = (v) => typeof v === 'number' && Number.isFinite(v) && v >= NECK_MIN && v <= NECK_MAX;
const round1 = (v) => Math.round(v * 10) / 10;

export function cleanNeck(value) {
  const out = { panes: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  if (valid(value.global) && valid(value.base)) { out.global = round1(value.global); out.base = round1(value.base); }
  if (value.panes && typeof value.panes === 'object' && !Array.isArray(value.panes)) {
    for (const [k, v] of Object.entries(value.panes)) if (PANE_KEY.test(k) && valid(v)) out.panes[k] = round1(v);
  }
  return out;
}

export function parseNeck(raw) {
  try { return cleanNeck(JSON.parse(raw)); } catch { return { panes: {} }; }
}

export const serializeNeck = (state) => JSON.stringify(cleanNeck(state));

// The global value to restore at start: the saved one, only while the starting setting is still the one it was chosen over.
export function restoredGlobal(state, startingNeck) {
  return state.global !== undefined && state.base !== undefined && Math.abs(state.base - startingNeck) < 1e-9 ? state.global : undefined;
}

export function loadNeck(storage) {
  try { return parseNeck(storage?.getItem(NECK_KEY)); } catch { return { panes: {} }; }
}

export function saveNeck(storage, state) {
  try { storage?.setItem(NECK_KEY, serializeNeck(state)); } catch { /* optional */ }
}
