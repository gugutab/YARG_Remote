// Per-instrument starting options of a track window (setting highway.perInstrument): the view, the note shape and the neck speed
// that a guitar, bass, ... window starts with instead of the global ones. Pure: validated here, applied by Highway.paneOpt (a
// window's own chart-menu choice still wins over it during the session; the menu's reset returns to it).

export const PER_INSTRUMENT_BASES = ['guitar', 'bass', 'rhythm', 'keys', 'drums', 'vocals'];
export const NECK_MIN = 0.5;
export const NECK_MAX = 3;
const VIEWS = ['2d', '3d'];
const STYLES = ['round', 'rect'];
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

// One instrument's options cleaned: only view '2d'|'3d', noteStyle 'round'|'rect', neck a number in 0.5..3 (one decimal); anything
// else is dropped. Returns a new object (possibly empty).
function cleanEntry(e) {
  const out = {};
  if (!isPlainObject(e)) return out;
  if (VIEWS.includes(e.view)) out.view = e.view;
  if (STYLES.includes(e.noteStyle)) out.noteStyle = e.noteStyle;
  if (typeof e.neck === 'number' && Number.isFinite(e.neck) && e.neck >= NECK_MIN && e.neck <= NECK_MAX) out.neck = Math.round(e.neck * 10) / 10;
  return out;
}

// The whole setting cleaned: { ok, value } like the schema's validators. Not an object: not ok. Unknown instruments, unknown
// fields and bad values are dropped; an instrument left with nothing is dropped too.
export function cleanPerInstrument(v) {
  if (!isPlainObject(v)) return { ok: false };
  const out = {};
  for (const k of PER_INSTRUMENT_BASES) {
    if (!Object.hasOwn(v, k)) continue;
    const e = cleanEntry(v[k]);
    if (Object.keys(e).length) out[k] = e;
  }
  return { ok: true, value: out };
}

// The starting options of a window of instrument `baseKey` (chart.js option.base: guitar, bass, rhythm, keys, drums, vocals):
// { view?, noteStyle?, neck? }, only what the user set. `settings` is the settings store (get(id)) or the setting's value itself.
export function instrumentDefaults(settings, baseKey) {
  const all = typeof settings?.get === 'function' ? settings.get('highway.perInstrument') : settings;
  if (!isPlainObject(all) || !PER_INSTRUMENT_BASES.includes(baseKey)) return {};
  return cleanEntry(all[baseKey]);
}
