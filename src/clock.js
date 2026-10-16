// Chart clock helpers for the worklet player (pure, tested in Node).
//
// The worklet reports (audio time, source position in seconds) pairs. The position being HEARD at audio time T is usually a
// little before the newest report (the worklet renders ahead of the speakers), so it is read by interpolating the
// recent history instead of extrapolating with the current speed: that stays exact across speed changes.

// history: [{ time, pos }] in increasing time (both in seconds); returns the source position at audio time T.
// `rate` is only used beyond the newest report (or before the oldest one).
export function positionAt(history, T, rate) {
  const n = history.length;
  if (n === 0) return 0;
  const last = history[n - 1];
  if (T >= last.time) return last.pos + (T - last.time) * rate;
  let i = n - 1;
  while (i > 0 && history[i - 1].time > T) i--;
  if (i === 0) return history[0].pos + (T - history[0].time) * rate;
  const a = history[i - 1];
  const b = history[i];
  const span = b.time - a.time || 1;
  return a.pos + ((b.pos - a.pos) * (T - a.time)) / span;
}

// Keeps roughly the last `seconds` of audio time.
export function trimHistory(history, seconds = 3) {
  const newest = history[history.length - 1];
  if (!newest) return;
  let drop = 0;
  while (drop < history.length - 1 && history[drop].time < newest.time - seconds) drop++;
  if (drop) history.splice(0, drop);
}

// ---- Idle audio device ----
export const SUSPEND_AFTER_MS = 30000; // paused this long: the AudioContext is suspended (the worklet would render silence at ~345 blocks/s)
export const RESUME_TIMEOUT_MS = 1500; // ctx.resume() can stay pending forever without a user gesture: play() gives up after this

// Has the player been paused long enough to suspend the audio device? pausedSince: performance.now() of the pause (null: not paused).
export function suspendDue(playing, pausedSince, now, afterMs = SUSPEND_AFTER_MS) {
  return !playing && pausedSince != null && now - pausedSince >= afterMs;
}

// Resolves true when `promise` settled within `ms` (false on a timeout or a rejection).
export function settlesWithin(promise, ms) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  return Promise.race([Promise.resolve(promise).then(() => true, () => false), late]).finally(() => clearTimeout(timer));
}
