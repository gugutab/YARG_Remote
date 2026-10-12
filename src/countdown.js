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
