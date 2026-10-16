// The saved sizes of the fretboard windows (localStorage 'yargremote.paneSizes') come from outside the app: anything that is not a sane
// number is ignored, so a hostile or stale value cannot make a window zero-sized.
export const WEIGHT_MIN = 0.05;
export const WEIGHT_MAX = 20;
export const VOCAL_H_MIN = 90; // the same floor dragDivider uses for the vocal band

export function sanitizeSizes(sizes) {
  const weights = {};
  const src = sizes?.weights;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [key, w] of Object.entries(src)) {
      if (typeof w === 'number' && Number.isFinite(w)) weights[key] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w));
    }
  }
  const h = sizes?.vocalH;
  const vocalH = typeof h === 'number' && Number.isFinite(h) && h >= VOCAL_H_MIN ? h : null;
  return { weights, vocalH };
}
