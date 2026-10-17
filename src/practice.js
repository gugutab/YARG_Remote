// Pure rules for practice mode: setting a loop end where the playhead is, and the "restarting" note. Times are player time (seconds).
import { MIN_LOOP } from './looprange.js';

// Sets one end of the loop (which: 'start' = A, 'end' = B) at `time`. With no loop, A makes [time, duration] and B makes [0, time].
// An end set past the other one swaps them (A after B: the old B becomes the start). Returns the new range, or null when the result
// would be shorter than `minLen` (the caller keeps what it had).
export function setLoopPoint(range, which, time, duration, minLen = MIN_LOOP) {
  const t = Math.max(0, Math.min(time, duration));
  let a;
  let b;
  if (!range) [a, b] = which === 'start' ? [t, duration] : [0, t];
  else {
    const other = which === 'start' ? range.end : range.start;
    [a, b] = t <= other ? [t, other] : [other, t];
  }
  return b - a >= Math.min(minLen, duration) - 1e-9 ? { start: a, end: b } : null;
}

// "Restarting loop in N": the whole seconds left, never below 1 while any time is left.
export function restartNote(leftSec) {
  return leftSec > 0 ? `Restarting loop in ${Math.ceil(leftSec - 1e-9)}` : '';
}

// Should the quick-settings panel be on screen? `s` holds the app's state; every reason to stay hidden is one flag (`infoVisible`: the song info
// overlay is still on screen, the panel waits until it has faded).
export function pausePanelWanted(s) {
  return !!(s.enabled && s.pausedByUser && !s.playing && s.ready && !s.waiting && !s.listen && !s.background && !s.liveStage
    && !s.ended && !s.hidden && !s.focusLost && !s.overlayOpen && !s.infoVisible && !s.dismissed);
}
