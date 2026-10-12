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

import { PRESETS } from './themes.js';
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
    description: 'The screen that opens when you pick a song.',
    items: [
      { id: 'details.chips', group: 'Header', type: 'multi', label: 'Information chips', help: 'Which facts appear under the title (when the song has them).', options: DETAIL_CHIPS, default: ['pack', 'album', 'track', 'length', 'charter', 'genre', 'year', 'bpm'], keywords: 'header pack album year genre charter bpm' },
      { id: 'details.cover', group: 'Header', type: 'choice', label: 'Album cover', help: 'Auto is bigger on large screens.', options: [{ value: 'auto', label: 'Auto' }, { value: 'none', label: 'Hidden' }, { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }], default: 'auto' },
      { id: 'details.quote', group: 'Header', type: 'toggle', label: 'Loading phrase', help: 'The quote some songs carry in song.ini.', default: true },
      { id: 'details.sections', group: 'Sections', type: 'multi', label: 'Sections shown', options: [{ value: 'listen', label: 'Listen' }, { value: 'specials', label: 'Special notes' }, { value: 'instruments', label: 'Instrument and difficulty' }, { value: 'adjust', label: 'Settings' }, { value: 'volume', label: 'Stem volume' }, { value: 'extra', label: 'Other song.ini properties' }], default: ['listen', 'specials', 'instruments', 'adjust', 'volume', 'extra'], keywords: 'cards hide show' },
      { id: 'details.layout', group: 'Sections', type: 'choice', label: 'Lower cards', help: 'Settings, stem volume and properties: side by side, or one under the other.', options: [{ value: 'columns', label: 'Two columns' }, { value: 'stacked', label: 'One column' }], default: 'columns' },
      { id: 'details.stemNames', group: 'Sections', type: 'choice', label: 'Instrument names in Stem volume', options: [{ value: 'auto', label: 'When wide' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }], default: 'auto' },
      { id: 'details.maxWidth', group: 'Size', type: 'range', label: 'Maximum width', help: 'The content stops growing at this width on big screens.', min: 800, max: 2400, step: 50, unit: 'px', default: 1400 },
      { id: 'details.compact', group: 'Size', type: 'toggle', label: 'Compact spacing', help: 'Tighter cards, so more fits on the screen.', default: false },
    ],
  },
  {
    id: 'panels', title: 'Panels', icon: 'panels',
    description: 'The library (left) and the song (right) can each be closed and reopened. Keys: L library, D song panel.',
    items: [
      { id: 'panels.libraryStart', group: 'At startup', type: 'choice', label: 'Library panel', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'last', label: 'As I left it' }], default: 'open' },
      { id: 'panels.songStart', group: 'At startup', type: 'choice', label: 'Song panel', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'last', label: 'As I left it' }], default: 'open' },
      { id: 'panels.openSongOnSelect', group: 'Behaviour', type: 'toggle', label: 'Open the song panel when I pick a song', help: 'Only matters when the song panel is closed.', default: true },
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
      { id: 'highway.countdown', type: 'toggle', label: 'Wait countdowns', help: 'While an instrument has nothing to play for 9 s or more, show the seconds until its next note.', default: true },
      { id: 'highway.lyricsAbove', type: 'range', label: 'Lyrics above the line being sung', help: 'How much of the lyric sheets (karaoke) shows the lines before the current one, as a share of their height.', min: 0, max: 40, step: 1, unit: '%', default: 12 },
      { id: 'highway.seekAnimation', type: 'toggle', label: 'Animate jumps in the song', help: 'When you seek or jump to a section, the notes scroll to the new place instead of snapping.', default: true },
      { id: 'highway.motionBlur', type: 'toggle', label: 'Motion blur on jumps', help: 'While the notes rush to the new place after a seek, draw a trail behind them.', default: true, when: (get) => get('highway.seekAnimation') },
      { id: 'highway.visualizer', type: 'choice', label: 'Background visualizer', help: 'An animation behind all the fretboards, driven by the album art, the beats and the notes. Key: G.', options: VISUALIZERS.map((v) => ({ value: v.id, label: v.label })), default: 'none', keywords: 'background animation aurora synthwave warp rings equalizer embers cover radial spotlights tunnel' },
      { id: 'highway.visualizerBlur', type: 'range', label: 'Visualizer blur', help: 'Blurs the visualizer (not the notes). 0 is sharp.', min: 0, max: 40, step: 1, unit: 'px', default: 0, when: (get) => get('highway.visualizer') !== 'none' },
      { id: 'highway.trackOpacity', type: 'range', label: 'Fretboard opacity', help: 'How solid the board behind the notes is: higher hides more of the background and visualizer.', min: 0, max: 100, step: 5, unit: '%', default: 50 },
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
      { id: 'audio.censor', type: 'toggle', label: 'Use clean (censored) audio when available', help: 'Songs with both explicit and clean stems (song_clean, vocals_explicit, ...) play one version, never both. Off plays the explicit one. Applies the next time a song is opened.', default: false, keywords: 'explicit clean censored profanity stems' },
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
};

export function buildDefaults(sections = SECTIONS) {
  const out = { ...CUSTOM_DEFAULTS };
  for (const s of sections) for (const it of s.items) if (it.type !== 'custom') out[it.id] = it.default;
  return out;
}

export const PRESET_NAMES = Object.fromEntries(PRESETS.map((p) => [p.id, p.name]));
