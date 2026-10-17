// What can be customised, section by section. Every item is one setting (or, for `custom` items, a group of settings
// edited by a purpose-built control). settings-ui.js turns this into the settings page; app.js applies the values.
//
// item: { id, type, label, help, default, ... }
//   type 'toggle'                          on/off
//   type 'choice'  options: [{value,label}]  one of a few values (segmented control; a list when there are many)
//   type 'range'   min, max, step, unit      a slider
//   type 'color'                             a #rrggbb colour
//   type 'custom'  render(host, ctx), ids    a purpose-built control (theme studio, chip picker, ...) for the settings in `ids`
//   `when(get)` hides the item unless it returns true; `keywords` feed the search box.

import { PRESETS, THEME_KEYS, isHex } from './themes.js';
import { ACTIONS } from './shortcuts.js';
import { VISUALIZERS } from './visualizers.js';
import { DETAIL_CHIPS } from './songinfo.js';

export const FONT_OPTIONS = [
  { value: 'system', label: 'System', css: "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { value: 'humanist', label: 'Humanist', css: "'Trebuchet MS', 'Gill Sans', Verdana, sans-serif" },
  { value: 'serif', label: 'Serif', css: "Georgia, 'Times New Roman', serif" },
  { value: 'mono', label: 'Monospace', css: "ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', monospace" },
];

export const SECTIONS = [
  {
    id: 'appearance', title: 'Appearance', icon: 'palette',
    description: 'Colours, fonts and the general look of the app.',
    items: [
      { id: 'theme', type: 'custom', ids: ['theme.preset', 'theme.overrides', 'theme.saved'], label: 'Theme', keywords: 'colour color dark light preset accent background palette saved import export' },
      { id: 'ui.radius', type: 'range', label: 'Corner roundness', help: 'How round cards, panels and menus are.', min: 0, max: 20, step: 1, unit: 'px', default: 10 },
      { id: 'ui.font', type: 'choice', label: 'Font', options: FONT_OPTIONS.map(({ value, label }) => ({ value, label })), default: 'system' },
      { id: 'ui.barPosition', type: 'choice', label: 'Player bar position', help: 'Where the bar with the title, the controls and the seek bar sits: under the fretboards (the seek bar is on its top edge) or above them.', options: [{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }], default: 'bottom', keywords: 'menu top bar controls seek' },
      { id: 'ui.animations', type: 'toggle', label: 'Animations', help: 'Fades and slides in the interface. Turn off to reduce motion.', default: true, keywords: 'motion transition reduce' },
    ],
  },
  {
    id: 'library', title: 'Library and cards', icon: 'list',
    description: 'How the song list looks and what each card shows.',
    items: [
      { id: 'library.cardStyle', group: 'List', type: 'choice', label: 'Card style', options: [{ value: 'compact', label: 'Compact' }, { value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }], default: 'normal' },
      { id: 'library.sort', group: 'List', type: 'choice', label: 'Sort by', options: [{ value: 'title', label: 'Title' }, { value: 'artist', label: 'Artist' }, { value: 'album', label: 'Album' }, { value: 'pack', label: 'Pack' }, { value: 'year', label: 'Year' }, { value: 'length', label: 'Length' }], default: 'title', help: 'Also changes when you use the sort menu in the library.' },
      { id: 'library.sortDesc', group: 'List', type: 'toggle', label: 'Reverse the order', default: false },
      { id: 'library.columns', group: 'List', type: 'choice', label: 'Columns', help: 'Auto adds columns as soon as two cards fit.', options: [{ value: 'auto', label: 'Auto' }, { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }], default: 'auto' },
      { id: 'library.searchRelevance', group: 'List', type: 'toggle', label: 'Best match first while searching', help: 'With text in the search box, the closest matches (title first, then artist and album) come first instead of the chosen sort.', default: true, keywords: 'search relevance order rank' },
      { id: 'library.dividers', group: 'List', type: 'toggle', label: 'Group headers', help: 'A heading for each letter, artist, pack, decade or length range.', default: true, keywords: 'divider section' },
      { id: 'library.rail', group: 'List', type: 'toggle', label: 'Scroll index', help: 'The strip with letters and ticks next to the scrollbar.', default: true, keywords: 'rail scrollbar' },
      { id: 'library.thumbs', group: 'Size', type: 'toggle', label: 'Album covers', help: 'Normal and large cards.', default: true, keywords: 'thumbnails images' },
      { id: 'library.cardScale', group: 'Size', type: 'range', label: 'Card size', help: 'Cover size and spacing of the cards.', min: 70, max: 140, step: 5, unit: '%', default: 100, format: (v) => String(v) },
      { id: 'library.iconSize', group: 'Size', type: 'range', label: 'Instrument icons', min: 12, max: 24, step: 1, unit: 'px', default: 15 },
      { id: 'cards.compact.artist', group: 'Compact cards', type: 'toggle', label: 'Artist', default: true },
      { id: 'cards.compact.pack', group: 'Compact cards', type: 'toggle', label: 'Pack', default: false },
      { id: 'cards.normal.artist', group: 'Normal cards', type: 'toggle', label: 'Artist', default: true },
      { id: 'cards.normal.pack', group: 'Normal cards', type: 'toggle', label: 'Pack (top right)', default: true },
      { id: 'cards.normal.icons', group: 'Normal cards', type: 'toggle', label: 'Instrument icons', help: 'Hover an icon for the instrument and its difficulty.', default: true },
      { id: 'cards.large.album', group: 'Large cards', type: 'toggle', label: 'Album', default: true },
      { id: 'cards.large.year', group: 'Large cards', type: 'toggle', label: 'Year', default: true },
      { id: 'cards.large.length', group: 'Large cards', type: 'toggle', label: 'Length', default: true },
      { id: 'cards.large.genre', group: 'Large cards', type: 'toggle', label: 'Genre', default: true },
      { id: 'cards.large.charter', group: 'Large cards', type: 'toggle', label: 'Charter', default: false },
      { id: 'cards.large.pack', group: 'Large cards', type: 'toggle', label: 'Pack', default: true },
      { id: 'cards.large.instruments', group: 'Large cards', type: 'toggle', label: 'Instruments', default: true },
      { id: 'cards.large.levels', group: 'Large cards', type: 'toggle', label: 'Difficulty bars', help: 'The six bars next to each instrument.', default: true, when: (get) => get('cards.large.instruments') },
    ],
  },
  {
    id: 'details', title: 'Song details', icon: 'info',
    description: 'The window that opens when you pick a song. Key: I shows or hides it.',
    items: [
      { id: 'details.chips', group: 'Header', type: 'multi', label: 'Information chips', help: 'Which facts appear under the title (when the song has them).', options: DETAIL_CHIPS, default: ['pack', 'album', 'track', 'length', 'charter', 'genre', 'year', 'bpm'], keywords: 'header pack album year genre charter bpm' },
      { id: 'details.cover', group: 'Header', type: 'choice', label: 'Album cover', help: 'Auto is bigger on large screens.', options: [{ value: 'auto', label: 'Auto' }, { value: 'none', label: 'Hidden' }, { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }], default: 'auto' },
      { id: 'details.quote', group: 'Header', type: 'toggle', label: 'Loading phrase', help: 'The quote some songs carry in song.ini.', default: true },
      { id: 'details.sections', group: 'Sections', type: 'multi', label: 'Sections shown', options: [{ value: 'listen', label: 'Listen' }, { value: 'instruments', label: 'Instrument and difficulty' }, { value: 'adjust', label: 'Speed' }, { value: 'volume', label: 'Stem volume' }, { value: 'extra', label: 'Other song.ini properties' }], default: ['listen', 'instruments', 'adjust', 'volume', 'extra'], keywords: 'cards hide show' },
      { id: 'details.layout', group: 'Sections', type: 'choice', label: 'Lower cards', help: 'Settings, stem volume and properties: side by side, or one under the other.', options: [{ value: 'columns', label: 'Two columns' }, { value: 'stacked', label: 'One column' }], default: 'columns' },
      { id: 'details.stemNames', group: 'Sections', type: 'choice', label: 'Instrument names in Stem volume', options: [{ value: 'auto', label: 'When wide' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }], default: 'auto' },
      { id: 'details.maxWidth', group: 'Size', type: 'range', label: 'Maximum width', help: 'The details pane of the library window stops growing at this width on big screens (up to 4K, 3840 px).', min: 600, max: 3840, step: 40, unit: 'px', default: 1400 },
      { id: 'details.compact', group: 'Size', type: 'toggle', label: 'Compact spacing', help: 'Tighter cards, so more fits on the screen.', default: false },
    ],
  },
  {
    id: 'panels', title: 'Panels', icon: 'panels',
    description: 'The library is a window floating over the chart, on the left. Key: L shows or hides it.',
    items: [
      { id: 'panels.libraryStart', group: 'At startup', type: 'choice', label: 'Library window', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'last', label: 'As I left it' }], default: 'open' },
      { id: 'panels.libraryAutoHide', group: 'Behaviour', type: 'toggle', label: 'Hide the library when I pick a song', help: 'The library window closes once a song is chosen; reopen it with L. Always on for a phone.', default: false },
    ],
  },
  {
    id: 'highway', title: 'Highway', icon: 'palette',
    description: 'The note chart. The view and note shape also change when you use the chart buttons.',
    items: [
      { id: 'highway.view', type: 'choice', label: 'View', options: [{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }], default: '3d' },
      { id: 'highway.noteStyle', type: 'choice', label: 'Note shape', options: [{ value: 'round', label: 'Circles' }, { value: 'rect', label: 'Rounded' }], default: 'rect' },
      { id: 'highway.vocalView', type: 'choice', label: 'Vocal view', help: 'Notes shows the pitch bars with the lyrics; Karaoke shows only the lyrics. Key: K.', options: [{ value: 'track', label: 'Notes' }, { value: 'karaoke', label: 'Karaoke' }], default: 'track' },
      { id: 'highway.paneMin', type: 'range', label: 'Narrowest fretboard', help: 'With several fretboards on screen, each one gets at least this width; the others wait outside (swipe, or [ and ]).', min: 200, max: 600, step: 20, unit: 'px', default: 280 },
      { id: 'highway.countdownUnit', type: 'choice', label: 'Countdown shows', help: 'The number in the wait countdown: the measures left (YARG\'s default) or the seconds left.', options: [{ value: 'measures', label: 'Measures' }, { value: 'seconds', label: 'Seconds' }], default: 'measures', when: (get) => get('highway.countdown') },
      { id: 'highway.countdown', type: 'toggle', label: 'Wait countdowns', help: 'While an instrument has nothing to play for 9 s or more, show the seconds until its next note.', default: true },
      { id: 'highway.lyricsAbove', type: 'range', label: 'Lyrics above the line being sung', help: 'How much of the lyric sheets (karaoke) shows the lines before the current one, as a share of their height.', min: 0, max: 40, step: 1, unit: '%', default: 12 },
      { id: 'highway.seekAnimation', type: 'toggle', label: 'Animate jumps in the song', help: 'When you seek or jump to a section, the notes scroll to the new place instead of snapping.', default: true },
      { id: 'highway.motionBlur', type: 'toggle', label: 'Motion blur on jumps', help: 'While the notes rush to the new place after a seek, draw a trail behind them.', default: true, when: (get) => get('highway.seekAnimation') },
      { id: 'highway.visualizer', type: 'choice', label: 'Background visualizer', help: 'An animation behind all the fretboards, driven by the album art, the beats and the notes. Key: G.', options: VISUALIZERS.map((v) => ({ value: v.id, label: v.label })), default: 'none', keywords: 'background animation aurora synthwave warp rings equalizer embers cover radial spotlights tunnel' },
      { id: 'highway.visualizerQuality', type: 'choice', label: 'Visualizer quality', help: 'The background is drawn at a lower resolution and stretched: lower is much lighter on the graphics card (the album art always stays sharp).', options: [{ value: 'high', label: 'High (full resolution)' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low (lightest)' }], default: 'medium', when: (get) => get('highway.visualizer') !== 'none' },
      { id: 'highway.visualizerFps', type: 'choice', label: 'Visualizer frame rate', help: 'How often the background is redrawn. Lower is lighter on the graphics card (the fretboards are not affected). Unlimited redraws it on every frame of your screen, even above 60.', options: [{ value: '20', label: '20 frames per second' }, { value: '30', label: '30 frames per second' }, { value: '60', label: '60 frames per second' }, { value: 'unlimited', label: 'Unlimited (every screen frame)' }], default: '60', when: (get) => get('highway.visualizer') !== 'none' },
      { id: 'highway.visualizerOpacity', type: 'range', label: 'Visualizer opacity', help: 'How strongly the visualizer shows over the stage colour (the notes are not affected). 100 is full.', min: 0, max: 100, step: 1, unit: '%', default: 100, when: (get) => get('highway.visualizer') !== 'none' },
      { id: 'highway.visualizerBlur', type: 'range', label: 'Visualizer blur', help: 'Blurs the visualizer (not the notes). 0 is sharp.', min: 0, max: 40, step: 1, unit: 'px', default: 0, when: (get) => get('highway.visualizer') !== 'none' },
      { id: 'highway.trackOpacity', type: 'range', label: 'Fretboard opacity', help: 'How solid the board behind the notes is: higher hides more of the background and visualizer.', min: 0, max: 100, step: 5, unit: '%', default: 75 },
      { id: 'highway.stageColorOn', type: 'toggle', label: 'Custom stage colour', help: 'Use your own colour behind the fretboards instead of the chart background of the theme (also in the visualizer menu).', default: false },
      { id: 'highway.stageColor', type: 'color', label: 'Stage colour', default: '#0d1117', when: (get) => get('highway.stageColorOn') },
      { id: 'highway.neck', type: 'range', label: 'Starting neck speed', help: 'Only the spacing of the notes, not the music speed.', min: 0.5, max: 3, step: 0.1, unit: '×', default: 1.2 },
      { id: 'perf.overlay', type: 'choice', label: 'Performance overlay', help: 'FPS and other meters over the fretboards. Key: P cycles off, compact, detailed.', options: [{ value: 'off', label: 'Off' }, { value: 'compact', label: 'FPS' }, { value: 'detailed', label: 'Detailed' }], default: 'off', keywords: 'fps frame rate performance meter debug' },
      { id: 'perf.position', type: 'choice', label: 'Overlay position', options: [{ value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' }, { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }], default: 'bottom-right', when: (get) => get('perf.overlay') !== 'off' },
      { id: 'highway.barHidden', type: 'choice', label: 'Top bar at startup', options: [{ value: 'shown', label: 'Shown' }, { value: 'hidden', label: 'Hidden' }, { value: 'last', label: 'As I left it' }], default: 'last' },
    ],
  },
  {
    id: 'general', title: 'General', icon: 'gear',
    description: 'What the app does when it starts and when a song opens.',
    items: [
      { id: 'general.restoreLast', type: 'toggle', label: 'Reopen the last song', help: 'At startup, open the song you were on.', default: false, keywords: 'startup resume session' },
      { id: 'general.autoplay', type: 'toggle', label: 'Load and play as soon as I pick a song', help: 'Skips the Play button: the loading screen appears right away.', default: false, keywords: 'autoplay start' },
      { id: 'general.rememberInstruments', type: 'toggle', label: 'Remember the last instruments and difficulties', help: 'A new song opens with the instruments (and the difficulty of each) you used last, when the song has them.', default: true, keywords: 'instrument difficulty last remember' },
      { id: 'playback.resumeRewind', type: 'toggle', label: 'Rewind 1 s when resuming and when a loop restarts', help: 'Like YARG: Play after a pause goes back one second (the screen rewinds in half a second) and plays on; a loop also restarts one second before its start. The notes of that second are drawn dim, until the song passes the point where you paused (or the loop start).', default: true, keywords: 'pause resume rewind replay' },
      { id: 'playback.seekRewind', type: 'toggle', label: 'Land 1 s early when seeking', help: 'A seek (the seek bar, sections) lands one second before the chosen point and plays on; the notes of that second are drawn dim, until the song reaches the point you chose. Not used with a loop.', default: false, keywords: 'seek rewind replay' },
      { id: 'playback.pauseOnFocusLoss', type: 'toggle', label: 'Pause when the window loses focus', help: 'The song pauses when you switch to another window or tab (a Play afterwards resumes it, with the rewind above). YARG turns this on by default.', default: false, keywords: 'focus blur hidden tab background pause' },
      { id: 'playback.muteOnFocusLoss', type: 'toggle', label: 'Mute when the window loses focus', help: 'The sound is muted while you are in another window or tab and comes back when you return. Your saved volume and mute are not changed.', default: false, keywords: 'focus blur hidden tab background mute' },
      { id: 'playback.startDelay', type: 'range', label: 'Start delay', help: 'A song played from the very beginning waits this long (the fretboards stay at the start) before the sound begins. YARG uses 2 s; 0 starts at once.', min: 0, max: 3, step: 0.5, unit: ' s', default: 0, keywords: 'wait countdown start intro' },
      { id: 'playback.loopRestartDelay', type: 'range', label: 'Loop restart delay', help: 'When a loop reaches its end, the song waits this long in silence (the fretboards stay at the loop end) before it restarts. YARG waits 2 s before restarting a practice section; 0 restarts at once.', min: 0, max: 5, step: 0.5, unit: ' s', default: 0, keywords: 'loop practice section restart wait pause' },
      { id: 'playback.pausePanel', type: 'toggle', label: 'Quick settings while paused', help: 'While the song is paused, a small panel in the middle of the stage shows speed, metronome, master volume and a Resume button (like the quick settings of the YARG pause menu). Esc closes it.', default: false, keywords: 'pause menu panel quick volume speed' },
      { id: 'playback.songInfoOverlay', type: 'toggle', label: 'Song information when a song starts', help: 'The title, artist, album, year and genre fade in over the fretboards at the start of a song and fade out a few seconds later.', default: true, keywords: 'title artist overlay intro' },
      { id: 'playback.keepSongInfo', type: 'toggle', label: 'Keep the song information visible', help: 'The overlay stays on screen until the song is closed.', default: false, when: (get) => get('playback.songInfoOverlay'), keywords: 'title artist overlay' },
      { id: 'general.endScreen', type: 'toggle', label: 'Show the end-of-song window', help: 'When a song ends, a window replaces the fretboards with facts about each instrument and a few songs to play next. Off: the song just stops (the play button still turns into Restart).', default: true, keywords: 'end finish outro recommendations next restart' },
      { id: 'audio.metronome', type: 'toggle', label: 'Metronome', help: 'A click on every beat of the song (the first beat of a measure is higher), at any speed. Also the metronome button in the player bar. Key: M.', default: false, keywords: 'metronome click beat tempo' },
      { id: 'audio.metronomeVolume', type: 'range', label: 'Metronome volume', help: 'How loud the click is, before the master volume.', min: 0, max: 100, step: 5, unit: '%', default: 50, keywords: 'metronome click volume' },
      { id: 'audio.metronomeSound', type: 'choice', label: 'Metronome sound', options: [{ value: 'click', label: 'Click' }, { value: 'woodblock', label: 'Woodblock' }, { value: 'beep', label: 'Beep' }], default: 'click', keywords: 'metronome click woodblock beep' },
      { id: 'audio.rememberVolumes', type: 'toggle', label: 'Remember each track\'s volume', help: 'Guitar, bass, drums, vocals and the others keep the level you set on the next song.', default: true, keywords: 'volume mixer stems remember' },
      { id: 'audio.censor', type: 'toggle', label: 'Use clean (censored) audio when available', help: 'Songs with both explicit and clean stems (song_clean, vocals_explicit, ...) play one version, never both. Off plays the explicit one. Applies the next time a song is opened.', default: false, keywords: 'explicit clean censored profanity stems' },
    ],
  },
  {
    id: 'shortcuts', title: 'Shortcuts', icon: 'keyboard',
    description: 'Every keyboard shortcut of the player. Click a key to change it.',
    items: [
      { id: 'shortcuts.bindings', type: 'custom', ids: ['shortcuts.bindings'], label: 'Keyboard shortcuts', keywords: 'keys keyboard hotkeys bindings keybinds play pause loop section' },
    ],
  },
  {
    id: 'data', title: 'Data and backup', icon: 'database',
    description: 'Export your settings, move them to another browser, or start over.',
    items: [
      { id: 'data.tools', type: 'custom', ids: [], label: 'Settings backup', keywords: 'export import reset backup restore default clear cache' },
    ],
  },
];

// Defaults of every setting, collected from the schema (custom items list their ids and defaults in `defaults`).
const CUSTOM_DEFAULTS = {
  'theme.preset': 'dark',
  'theme.overrides': {},
  'theme.saved': [],
  'shortcuts.bindings': {},
};

export function buildDefaults(sections = SECTIONS) {
  const out = { ...CUSTOM_DEFAULTS };
  for (const s of sections) for (const it of s.items) if (it.type !== 'custom') out[it.id] = it.default;
  return out;
}

export const PRESET_NAMES = Object.fromEntries(PRESETS.map((p) => [p.id, p.name]));

// ---- Validation of stored / imported values ----

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/; // theme ids ("<slug>-<base36 time>"), also the part after "saved:"
const COMBO_RE = /^(Shift\+)?[A-Za-z0-9_]{0,32}$/; // KeyboardEvent.code, optional Shift+, '' = no key
const MAX_SAVED_THEMES = 50;
const MAX_TEXT = 200;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const decimals = (n) => (String(n).split('.')[1] || '').length;

// Returns { ok, value } for one schema item type; `value` is the cleaned value (clamped, snapped, filtered).
function checkItem(it, value) {
  switch (it.type) {
    case 'toggle':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
    case 'range': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false };
      const min = it.min ?? -Infinity;
      const max = it.max ?? Infinity;
      let v = Math.min(max, Math.max(min, value));
      if (it.step > 0 && Number.isFinite(min)) {
        v = min + Math.round((v - min) / it.step) * it.step;
        v = Number(v.toFixed(Math.max(decimals(it.step), decimals(min))));
        v = Math.min(max, Math.max(min, v));
      }
      return { ok: true, value: v };
    }
    case 'choice':
      return it.options.some((o) => o.value === value) ? { ok: true, value } : { ok: false };
    case 'multi': {
      if (!Array.isArray(value)) return { ok: false };
      const allowed = new Set(it.options.map((o) => o.value));
      return { ok: true, value: [...new Set(value.filter((x) => allowed.has(x)))] };
    }
    case 'color':
      return typeof value === 'string' && isHex(value) ? { ok: true, value: value.toLowerCase() } : { ok: false };
    case 'text':
      return typeof value === 'string' && value.length <= MAX_TEXT ? { ok: true, value } : { ok: false };
    default:
      return { ok: false };
  }
}

const presetIds = new Set(['auto', ...PRESETS.map((p) => p.id)]);

// The custom (purpose-built) settings. Their values end up in CSS (colours) and in key matching, so the shapes are strict.
const CUSTOM_CHECKS = {
  'theme.preset': (v) => (typeof v === 'string' && (presetIds.has(v) || (v.startsWith('saved:') && ID_RE.test(v.slice(6)))) ? { ok: true, value: v } : { ok: false }),
  // only the known colour keys, each a #rrggbb colour; anything else is dropped
  'theme.overrides': (v) => {
    if (!isPlainObject(v)) return { ok: false };
    const out = {};
    for (const k of THEME_KEYS) if (Object.hasOwn(v, k) && typeof v[k] === 'string' && isHex(v[k])) out[k] = v[k].toLowerCase();
    return { ok: true, value: out };
  },
  // [{ id, name, scheme, vars }]: at most 50, unique ids, complete valid colour sets
  'theme.saved': (v) => {
    if (!Array.isArray(v)) return { ok: false };
    const out = [];
    const seen = new Set();
    for (const t of v) {
      if (out.length >= MAX_SAVED_THEMES) break;
      if (!isPlainObject(t) || typeof t.id !== 'string' || !ID_RE.test(t.id) || seen.has(t.id)) continue;
      const name = typeof t.name === 'string' ? t.name.trim().slice(0, 40) : '';
      if (!name || !isPlainObject(t.vars) || !THEME_KEYS.every((k) => typeof t.vars[k] === 'string' && isHex(t.vars[k]))) continue;
      seen.add(t.id);
      out.push({ id: t.id, name, scheme: t.scheme === 'light' ? 'light' : 'dark', vars: Object.fromEntries(THEME_KEYS.map((k) => [k, t.vars[k].toLowerCase()])) });
    }
    return { ok: true, value: out };
  },
  // { actionId: combo }: known actions only, string values
  'shortcuts.bindings': (v) => {
    if (!isPlainObject(v)) return { ok: false };
    const out = {};
    for (const a of ACTIONS) if (Object.hasOwn(v, a.id) && typeof v[a.id] === 'string' && COMBO_RE.test(v[a.id])) out[a.id] = v[a.id];
    return { ok: true, value: out };
  },
};

// validate(id, value) -> { ok, value } for every setting of the schema: `ok` false = the value is not acceptable (callers use
// the default / skip the entry), otherwise `value` is the cleaned value. Unknown ids are not ok. Never throws.
export function buildValidator(sections = SECTIONS) {
  const items = new Map();
  for (const s of sections) for (const it of s.items) if (it.type !== 'custom') items.set(it.id, it);
  return (id, value) => {
    try {
      if (typeof id !== 'string') return { ok: false };
      if (Object.hasOwn(CUSTOM_CHECKS, id)) return CUSTOM_CHECKS[id](value);
      const it = items.get(id);
      return it ? checkItem(it, value) : { ok: false };
    } catch {
      return { ok: false };
    }
  };
}
