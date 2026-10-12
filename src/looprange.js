// Pure logic for the A-B loop on the seek bar. Every time here is player time (seconds on the seek bar), not chart time.

export const MIN_LOOP = 1; // shortest loop, seconds

// Boundaries the loop handles snap to: the song start, every section start and the song end (sorted, unique).
export function snapPoints(sectionStarts, duration) {
  const set = new Set([0, duration]);
  for (const s of sectionStarts) if (s >= 0 && s <= duration) set.add(s);
  return [...set].sort((a, b) => a - b);
}

// Moves `time` to the nearest point when it is within `thresholdPx` on screen (`pxPerSec` converts); otherwise unchanged.
export function snapTime(time, points, pxPerSec, thresholdPx = 10) {
  if (!(pxPerSec > 0)) return time;
  let best = time;
  let bestPx = thresholdPx;
  for (const p of points) {
    const px = Math.abs(p - time) * pxPerSec;
    if (px <= bestPx) { best = p; bestPx = px; }
  }
  return best;
}

// Moves one end of the range to `time`, keeping it inside [0, duration] and at least `minLen` long
// (the other end never moves). which: 'start' | 'end'.
export function clampLoop(which, time, range, duration, minLen = MIN_LOOP) {
  const len = Math.min(minLen, duration);
  if (which === 'start') return { start: Math.max(0, Math.min(time, range.end - len)), end: range.end };
  return { start: range.start, end: Math.min(duration, Math.max(time, range.start + len)) };
}

// The loop to start around time `t`: the current section (its start to the next section's start, the song end for
// the last one). `starts` are the section starts, sorted. With no sections: t +- `half` seconds clamped to the song.
export function currentSectionRange(starts, t, duration, half = 10) {
  if (!starts.length) return clampWhole(t - half, t + half, duration);
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= t) i++;
  return clampWhole(starts[i], i + 1 < starts.length ? starts[i + 1] : duration, duration);
}

// The range of section `i` (its start to the next start, the song end for the last one).
export function sectionRange(starts, i, duration) {
  if (i < 0 || i >= starts.length) return null;
  return clampWhole(starts[i], i + 1 < starts.length ? starts[i + 1] : duration, duration);
}

// Loop button of a section row: with no loop, loop that section; with a loop, a section outside it extends it to
// include that section (section A to section D), a section already inside it narrows the loop to that section alone.
export function loopForSection(current, sec) {
  if (!current) return sec;
  const inside = sec.start >= current.start - 1e-6 && sec.end <= current.end + 1e-6;
  if (inside) return sec;
  return { start: Math.min(current.start, sec.start), end: Math.max(current.end, sec.end) };
}

// Should playback jump back to the loop start now? Only when it leaves the end of the region from inside it between
// two consecutive readings (`prev` -> `t`, small step). `ahead` is a look-ahead (seconds) so the audio restart is
// not heard late. A loop is dormant while playback is outside the region (e.g. after a seek past it): it re-arms when
// playback is inside again, because the wrap needs `prev` inside.
export function shouldWrap(range, prev, t, ahead = 0, maxStep = 1) {
  if (!range || prev == null) return false;
  const end = range.end - ahead;
  const step = t - prev;
  return prev >= range.start && prev < end && t >= end && step >= 0 && step <= maxStep;
}

function clampWhole(a, b, duration) {
  const start = Math.max(0, Math.min(a, duration));
  const end = Math.max(start, Math.min(b, duration));
  return { start, end };
}
