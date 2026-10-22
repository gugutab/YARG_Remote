// Idle redraws (pure part; app.js feeds the live state). When the music is paused and nothing moves, the picture would be identical, so the
// frame loop skips the whole draw. The decision lives here so it can be tested without a browser.
export const IDLE_AFTER_MS = 3000; // quiet time (no input, no change to the highway) before frames may be skipped
export const IDLE_REFRESH_MS = 1000; // a slow redraw still runs, to catch what no event announces (a hover tooltip delay, lyric sheet easing)

// `s`: playing, animating (seek animation, drag, countdown/wait in progress, perf overlay on), now, lastInputAt, dirtyAt, lastDrawAt,
// same (the time, canvas size, dpr, panes and chart are the ones of the last draw). True when this frame may keep the last picture.
export function canSkipDraw(s) {
  if (s.playing || s.animating || !s.same) return false;
  if (s.now - Math.max(s.lastInputAt, s.dirtyAt) < IDLE_AFTER_MS) return false;
  return s.now - s.lastDrawAt < IDLE_REFRESH_MS;
}
