// The values the neck (chart) speed sliders can take: steps of 0.2 up to 2, then steps of 0.5 up to 5. The sliders work on the index of this list.
export const NECK_VALUES = [0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 4.5, 5];
export const NECK_MIN = NECK_VALUES[0];
export const NECK_MAX = NECK_VALUES[NECK_VALUES.length - 1];

// Index of the allowed value nearest to `v` (a saved 1.35 or 0.5 from an older version lands on the closest step).
export function neckIndex(v) {
  let best = 0;
  for (let i = 1; i < NECK_VALUES.length; i++) if (Math.abs(NECK_VALUES[i] - v) < Math.abs(NECK_VALUES[best] - v)) best = i;
  return best;
}
export const neckAt = (i) => NECK_VALUES[Math.min(NECK_VALUES.length - 1, Math.max(0, Math.round(Number(i)) || 0))];
export const snapNeck = (v) => NECK_VALUES[neckIndex(v)];
