// Wait countdowns: while an instrument has nothing to play for a while, the chart shows how long until its next note.
// Follows YARG.Core Engine/BaseEngine.Generic.cs GetWaitCountdowns and Chart/Events/WaitCountdown.cs.

export const MIN_COUNTDOWN_SEC = 9; // WaitCountdown.MIN_SECONDS: a gap this long (or longer) gets a countdown

// Every note interval of a chart as [start, end] (seconds): lane notes, vocal notes, harmony notes and percussion hits.
function intervals(chart, percussion = true) {
  const list = [];
  const add = (n) => list.push([n.time, Math.max(n.time, n.end ?? n.time + (n.length || 0))]);
  for (const n of chart.notes || []) add(n);
  for (const h of chart.harmonies || []) for (const n of h.notes) add(n);
  if (percussion) for (const p of chart.percussion || []) list.push([p.time, p.time]);
  return list.sort((a, b) => a[0] - b[0]);
}

// -> [{ start, end }]: from the end of the last note (0 at the start of the song) to the next note, for gaps of 9 s or
// more. A big rock ending (coda) cuts a countdown at its start and suppresses the ones after it, as in YARG.
// `percussion: false` leaves the percussion hits out: the lyric views (karaoke) count a percussion section as a rest.
export function waitCountdowns(chart, { percussion = true } = {}) {
  if (!chart) return [];
  const coda = (chart.fills || []).find((f) => f.kind === 'bre')?.start ?? Infinity;
  const out = [];
  let latestEnd = 0;
  for (const [time, end] of intervals(chart, percussion)) {
    if (time - latestEnd >= MIN_COUNTDOWN_SEC && latestEnd < coda) {
      out.push({ start: latestEnd, end: Math.min(time, coda) });
    }
    latestEnd = Math.max(latestEnd, end);
  }
  return out;
}

// The countdown running at `t`: { remaining, total } in seconds, or null.
export function countdownAt(list, t) {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) { // binary search: the last countdown starting at or before t
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= t) lo = mid + 1;
    else hi = mid - 1;
  }
  const c = list[hi];
  if (!c || t >= c.end) return null;
  return { remaining: c.end - t, total: c.end - c.start };
}

// The display rules of YARG's CountdownDisplay (game repo, Gameplay/HUD/CountdownDisplay.cs): shown only while more than HIDE_DELAY + FADE (1.5 s) remain,
// fading in over 0.5 s at the start of the gap and out over 0.5 s as the 1.5 s mark passes (gone at 1 s remaining).
export const COUNTDOWN_HIDE_SEC = 1;
export const COUNTDOWN_FADE_SEC = 0.5;
export function countdownAlpha(c) {
  const fadeIn = Math.min(1, (c.total - c.remaining) / COUNTDOWN_FADE_SEC);
  const fadeOut = Math.max(0, Math.min(1, (c.remaining - COUNTDOWN_HIDE_SEC) / COUNTDOWN_FADE_SEC));
  return Math.min(fadeIn, fadeOut);
}

// The start times of the measures: the beats flagged as a measure start, else every fourth beat (YARG counts measures through the sync track's time signatures).
export function measureStarts(beats) {
  if (!beats?.length) return [];
  const flagged = beats.filter((b) => b.measure).map((b) => b.time);
  return flagged.length > 1 ? flagged : beats.filter((_, i) => i % 4 === 0).map((b) => b.time);
}

// The measure position of t: the index of the measure that has started plus how far into it (continuing at the nearest bar length outside the grid).
export function measurePosition(starts, t) {
  const n = starts.length;
  if (n < 2) return t / 2; // no grid: 2 s bars (120 BPM, 4/4)
  let lo = 0;
  let hi = n - 1;
  let i = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
  if (i < 0) return (t - starts[0]) / Math.max(0.05, starts[1] - starts[0]);
  if (i >= n - 1) return i + (t - starts[i]) / Math.max(0.05, starts[n - 1] - starts[n - 2]);
  return i + (t - starts[i]) / Math.max(0.05, starts[i + 1] - starts[i]);
}

// YARG's "Measures" countdown number: the whole measures left until the measure the notes come back in (the end snapped down to the start of its measure).
export function measuresLeft(starts, t, end) {
  return Math.max(0, Math.ceil(Math.floor(measurePosition(starts, end)) - measurePosition(starts, t)));
}
