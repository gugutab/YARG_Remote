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

// Widths of the panes side by side: shares by weight of `total`, but never below `min` (a stored extreme weight cannot leave a sliver).
// Panes under the minimum are pinned to it and the rest share what is left by weight; if even the minimums do not fit, the width is split evenly.
export function fitWidths(weights, total, min) {
  const n = weights.length;
  if (!n) return [];
  if (!(total > 0) || total <= n * min) return weights.map(() => total / n);
  const widths = new Array(n).fill(0);
  const pinned = new Array(n).fill(false);
  for (let round = 0; round < n; round++) {
    const free = weights.reduce((acc, w, i) => (pinned[i] ? acc : acc + w), 0);
    const room = total - pinned.reduce((acc, on) => acc + (on ? min : 0), 0);
    let changed = false;
    weights.forEach((w, i) => {
      if (pinned[i]) { widths[i] = min; return; }
      widths[i] = free > 0 ? (room * w) / free : room / n;
      if (widths[i] < min) { pinned[i] = true; changed = true; }
    });
    if (!changed) break;
  }
  return widths;
}
