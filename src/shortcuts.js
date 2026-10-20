// Keyboard shortcuts: the list of actions with their default keys, the user's overrides and the key <-> text helpers.
// Pure logic (no DOM), so it is tested without a browser. A key is written as KeyboardEvent.code with an optional
// "Shift+" prefix ("Space", "KeyG", "Shift+KeyG", "BracketLeft"): it follows the physical key, not the keyboard layout.
// Overrides live in the `shortcuts.bindings` setting: { actionId: combo }, with '' meaning "no key".

export const ACTIONS = [
  { id: 'playPause', group: 'Playback', label: 'Play / pause', key: 'Space' },
  { id: 'back5', group: 'Playback', label: 'Back 5 seconds', key: 'ArrowLeft' },
  { id: 'forward5', group: 'Playback', label: 'Forward 5 seconds', key: 'ArrowRight' },
  { id: 'prevSection', group: 'Playback', label: 'Previous section', key: 'Shift+BracketLeft' },
  { id: 'nextSection', group: 'Playback', label: 'Next section', key: 'Shift+BracketRight' },
  { id: 'loop', group: 'Playback', label: 'Loop the current section', key: 'KeyR' },
  { id: 'loopStart', group: 'Playback', label: 'Set the loop start (A) here', key: 'KeyA' },
  { id: 'loopEnd', group: 'Playback', label: 'Set the loop end (B) here', key: 'KeyS' },
  { id: 'metronome', group: 'Playback', label: 'Metronome on / off', key: 'KeyM' },
  { id: 'speedDown', group: 'Playback', label: 'Slower by 5 %', key: 'Minus' },
  { id: 'speedUp', group: 'Playback', label: 'Faster by 5 %', key: 'Equal' },
  { id: 'speedReset', group: 'Playback', label: 'Normal speed (1×)', key: 'Digit0' },
  { id: 'focusPrev', group: 'Windows', label: 'Previous fretboard window', key: 'BracketLeft' },
  { id: 'focusNext', group: 'Windows', label: 'Next fretboard window', key: 'BracketRight' },
  { id: 'view3d', group: 'Windows', label: 'Switch 2D / 3D', key: 'KeyV' },
  { id: 'noteStyle', group: 'Windows', label: 'Switch note shape (circles / rectangles)', key: 'KeyN' },
  { id: 'vocalView', group: 'Windows', label: 'Vocals: switch notes / karaoke', key: 'KeyK' },
  { id: 'visualizerNext', group: 'Windows', label: 'Next visualizer', key: 'KeyG' },
  { id: 'visualizerPrev', group: 'Windows', label: 'Previous visualizer', key: 'Shift+KeyG' },
  { id: 'search', group: 'Panels', label: 'Search the library', key: 'Slash' },
  { id: 'library', group: 'Panels', label: 'Show / hide the library', key: 'KeyL' },
  { id: 'details', group: 'Panels', label: 'Song details / chart', key: 'KeyI' },
  { id: 'topBar', group: 'Panels', label: 'Expand / compact the player bar', key: 'KeyB' },
  { id: 'fullscreen', group: 'Panels', label: 'Full screen', key: 'KeyF' },
  { id: 'settings', group: 'Panels', label: 'Open / close the settings', key: 'Comma' },
  { id: 'perf', group: 'Panels', label: 'Performance overlay', key: 'KeyP' },
];

export const SHORTCUT_GROUPS = [...new Set(ACTIONS.map((a) => a.group))];

// Keys that never take part: modifiers on their own, Escape (it always closes things) and Tab (it moves the focus).
const IGNORED = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$|^Escape$|^Tab$|^CapsLock$/;

// The combo of a keydown event, or null when it is not bindable.
export function comboOf(e) {
  if (!e?.code || IGNORED.test(e.code)) return null;
  return `${e.shiftKey ? 'Shift+' : ''}${e.code}`;
}

// action id -> combo ('' = no key): the defaults, overridden by `bindings`.
export function effectiveBindings(bindings = {}) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = typeof bindings[a.id] === 'string' ? bindings[a.id] : a.key;
  return out;
}

// The action a combo triggers (the first one if two share it), or null.
export function actionFor(bindings, combo) {
  if (!combo) return null;
  const eff = effectiveBindings(bindings);
  for (const a of ACTIONS) if (eff[a.id] === combo) return a.id;
  return null;
}

// Drops the overrides equal to a default (or of unknown actions), so only real changes are stored.
export function tidy(bindings) {
  const out = {};
  for (const a of ACTIONS) if (typeof bindings[a.id] === 'string' && bindings[a.id] !== a.key) out[a.id] = bindings[a.id];
  return out;
}

// Binds `combo` to `id`. Another action already using it swaps keys with `id` (it gets `id`'s old key).
// Returns the new overrides and the id of the action that was swapped, if any.
export function assign(bindings, id, combo) {
  const eff = effectiveBindings(bindings);
  const next = { ...bindings };
  let swapped = null;
  if (combo) {
    swapped = ACTIONS.find((a) => a.id !== id && eff[a.id] === combo)?.id ?? null;
    if (swapped) next[swapped] = eff[id];
  }
  next[id] = combo;
  return { bindings: tidy(next), swapped };
}

const NAMES = {
  Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', BracketLeft: '[', BracketRight: ']', Comma: ',',
  Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=', Enter: 'Enter', Backspace: 'Backspace',
};

// A combo for people: "Shift+KeyG" -> "Shift + G".
export function formatCombo(combo) {
  if (!combo) return 'Not set';
  return combo.split('+').map((p) => NAMES[p] ?? p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')).join(' + ');
}
