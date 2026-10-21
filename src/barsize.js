// Height of the player bar: the user drags a handle on the bar's stage-facing edge. Pure helpers (no DOM) so they can be tested.
// Heights are the bar's box height in px. The range runs from just the seek bar (BAR_MIN) to the full bar (the maximum is passed in:
// it follows --bar-h, which depends on the window width and on where the bar sits).
export const BAR_MIN = 16; // the seek bar and a little air; nothing else is shown
export const BAR_COMPACT_AT = 56; // from here up the one-row (compact) layout fits
export const BAR_FULL_SLACK = 8; // within this many px of the maximum the two-row (full) layout is used
export const BAR_STEP = 8; // keyboard step

export function clampHeight(h, max, min = BAR_MIN) {
  const hi = Math.max(min, Number.isFinite(max) ? max : min);
  const v = Number(h);
  if (!Number.isFinite(v)) return hi;
  return Math.min(hi, Math.max(min, Math.round(v)));
}

// What the bar shows at a height: 'min' = only the seek bar, 'compact' = the one-row layout, 'full' = both rows with the cover.
export function barLevel(h, max) {
  if (h >= max - BAR_FULL_SLACK && max - BAR_FULL_SLACK >= BAR_COMPACT_AT) return 'full';
  return h >= BAR_COMPACT_AT ? 'compact' : 'min';
}

// Stored form: 'max' while the bar is full height (so it follows the window's maximum), else the px.
export function serializeHeight(h, max) {
  return h >= max ? 'max' : String(Math.round(h));
}

// Reads the stored height. `legacy` is the old 'barHidden' value ('1' = compact then, now the minimum). Returns null when nothing is stored.
export function parseStoredHeight(value, legacy, max, min = BAR_MIN) {
  if (value === 'max') return clampHeight(max, max, min);
  if (typeof value === 'string' && /^\d{1,4}$/.test(value)) return clampHeight(Number(value), max, min);
  if (legacy === '1') return min;
  if (legacy === '0') return clampHeight(max, max, min);
  return null;
}

// Height after a keyboard key (ArrowUp/Down are relative to `growKey`, the one that grows the bar), or null when the key is not for the handle.
export function keyHeight(key, h, max, growKey = 'ArrowUp', min = BAR_MIN) {
  if (key === 'Home') return min;
  if (key === 'End') return clampHeight(max, max, min);
  if (key === 'ArrowUp' || key === 'ArrowDown') return clampHeight(h + (key === growKey ? BAR_STEP : -BAR_STEP), max, min);
  return null;
}
