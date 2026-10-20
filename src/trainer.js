// Speed trainer (auto-ramp) while an A-B loop repeats: pure rules. The app has no hit detection, so a "pass" is one completed loop wrap.
// After `passes` wraps at one speed the speed goes up by `step` (snapped to the speed slider's 0.05 grid, never past `target`) and the
// count starts again. Speeds are rates (1 = normal speed); the settings hold percents (trainerConfig converts).

export const SPEED_MIN = 0.2; // the speed slider's range and step (index.html `data-setting="speed"`)
export const SPEED_MAX = 2;
export const SPEED_GRID = 0.05;
const EPS = 1e-6;

// A speed clamped to the slider's range and snapped to its grid.
export function snapSpeed(v) {
  const c = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number.isFinite(v) ? v : 1));
  return Number((Math.round(c / SPEED_GRID) * SPEED_GRID).toFixed(2));
}

// The trainer settings (percent) as rates. `get` reads a setting id.
export function trainerConfig(get) {
  return {
    start: get('practice.trainerStart') / 100,
    target: get('practice.trainerTarget') / 100,
    step: get('practice.trainerStep') / 100,
    passes: get('practice.trainerPasses'),
  };
}

const passesOf = (cfg) => Math.max(1, Math.round(cfg.passes) || 1);

// Entering trainer mode: the speed jumps to the start value. A target at or below the start is done at once (no ramp down).
export function startTrainer(cfg) {
  const speed = snapSpeed(cfg.start);
  return { speed, passes: 0, stepped: false, done: speed >= snapSpeed(cfg.target) - EPS };
}

// The state after `event`. Only { type: 'wrap' } counts a pass; `event.speed` is the speed now playing (the user may have moved the
// slider since: the ramp goes on from there). Returns { speed, passes, stepped, done }: `stepped` = the speed went up on this wrap,
// `done` = the speed is at (or above) the target, so nothing changes any more.
export function nextTrainerState(state, event, cfg) {
  const cur = Number.isFinite(event?.speed) ? event.speed : state.speed;
  const target = snapSpeed(cfg.target);
  if (cur >= target - EPS) return { speed: cur, passes: 0, stepped: false, done: true };
  if (event?.type !== 'wrap') return { speed: cur, passes: state.passes, stepped: false, done: false };
  const passes = state.passes + 1;
  if (passes < passesOf(cfg)) return { speed: cur, passes, stepped: false, done: false };
  // (a step under the grid would snap back to the same speed; a speed off the grid moves at least half a grid step up)
  const next = Math.min(target, snapSpeed(cur + Math.max(SPEED_GRID, cfg.step || 0)));
  return { speed: next, passes: 0, stepped: next > cur + EPS, done: next >= target - EPS };
}

const pct = (v) => `${Math.round(v * 100)}%`;

// The status line of the speed popover. `on` = the setting, `looping` = an A-B loop is on, `state` = the running trainer (or null).
export function trainerStatus({ on, looping, state, cfg }) {
  if (!on) return 'Off: the speed stays where you put it.';
  const target = snapSpeed(cfg.target);
  if (!looping || !state) return `Starts with a loop (R): ${pct(snapSpeed(cfg.start))} → ${pct(target)}, +${pct(cfg.step)} every ${passesOf(cfg)} ${passesOf(cfg) === 1 ? 'pass' : 'passes'}.`;
  if (state.done || state.speed >= target - EPS) return `Target reached: ${pct(state.speed)}`;
  return `Pass ${Math.min(state.passes + 1, passesOf(cfg))}/${passesOf(cfg)} at ${pct(state.speed)} → ${pct(target)}`;
}

// The note shown when the speed steps up.
export function stepNote(state) {
  return state.done ? `Speed ${pct(state.speed)} (target reached)` : `Speed ${pct(state.speed)}`;
}
