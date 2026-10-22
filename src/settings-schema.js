// What can be customised, section by section. Every item is one setting (or, for `custom` items, a group of settings
// edited by a purpose-built control). settings-ui.js turns this into the settings page; app.js applies the values.
//
// item: { id, type, label, help, default, ... }
//   type 'toggle'                          on/off
//   type 'choice'  options: [{value,label}]  one of a few values (segmented control; a list when there are many)
//   type 'range'   min, max, step, unit      a slider
//   type 'color'                             a #rrggbb colour
//   type 'custom'  render(host, ctx), ids    a purpose-built control (theme studio, chip picker, ...) for the settings in `ids`
//   type 'multi'   options, minItems         a set of chips (an array of option values; fewer than minItems falls back to the default)
//   `when(get)` dims the item unless it returns true; `keywords` feed the search box (with the label, help, group and section
//   title); `group` is an optional sub-heading (consecutive items of one group sit together).
//
// Ids are stored and exported: never rename or remove one without an entry in RENAMES (below).

import { PRESETS, THEME_KEYS, isHex } from './themes.js';
import { ACTIONS } from './shortcuts.js';
import { VISUALIZERS, showsStage } from './visualizers.js';
import { NECK_VALUES, NECK_MIN, NECK_MAX, neckIndex } from './neckscale.js';
import { DETAIL_CHIPS } from './songinfo.js';
import { PALETTES, DEFAULT_LANE_COLORS, cleanLaneColors } from './palette.js';
import { cleanPerInstrument } from './perinstrument.js';

export const FONT_OPTIONS = [
  { value: 'system', label: 'System', css: "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { value: 'humanist', label: 'Humanist', css: "'Trebuchet MS', 'Gill Sans', Verdana, sans-serif" },
  { value: 'serif', label: 'Serif', css: "Georgia, 'Times New Roman', serif" },
  { value: 'mono', label: 'Monospace', css: "ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', monospace" },
];

// The system's reduced-motion preference, for the `when` of the motion switches (Reduce motion: Auto follows it). app.js sets the
// probe (it caches the media query); without one (the unit tests) there is no system preference.
let osReducedMotion = () => false;
export function setMotionProbe(fn) { osReducedMotion = fn; }
const motionOff = (get) => { const m = get('ui.reduceMotion'); return m === 'on' || (m === 'auto' && !!osReducedMotion()); };

export const SECTIONS = [
  {
    id: 'appearance', title: 'Appearance', icon: 'palette',
    description: 'Colours, fonts and the general look of the app.',
    items: [
      { id: 'theme', type: 'custom', ids: ['theme.preset', 'theme.overrides', 'theme.saved'], label: 'Theme', keywords: 'colour color dark light preset accent background palette saved import export' },
      { id: 'ui.radius', type: 'range', label: 'Corner roundness', help: 'How round cards, panels, buttons and menus are: 0 is square.', min: 0, max: 20, step: 1, unit: 'px', default: 10, keywords: 'shape corners radius rounded' },
      { id: 'ui.font', type: 'choice', label: 'Font', help: 'The typeface of the menus, lists and windows.', options: FONT_OPTIONS.map(({ value, label }) => ({ value, label })), default: 'system', keywords: 'typeface text letters' },
      { id: 'ui.barPosition', type: 'choice', label: 'Player bar position', help: 'Where the bar with the title, the controls and the seek bar sits: under the tracks (the seek bar is on its top edge) or above them.', options: [{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }], default: 'bottom', keywords: 'menu top bar controls seek layout' },
      { id: 'highway.barHidden', type: 'choice', label: 'Player bar at startup', help: 'Full height, just the seek bar (key B switches), or the height it had when you left (drag the handle above the bar to resize it).', options: [{ value: 'shown', label: 'Full' }, { value: 'hidden', label: 'Seek bar only' }, { value: 'last', label: 'As I left it' }], default: 'last', keywords: 'compact bar hide' },
      { id: 'ui.barPeek', type: 'toggle', label: 'Show the full bar on activity', help: 'When the bar is at its smallest (just the seek bar), moving the mouse or swiping up shows the full bar over the stage for a moment.', default: true, keywords: 'peek reveal bar hide mouse swipe' },
      { id: 'ui.barPeekDelay', type: 'range', label: 'Close it after', help: 'How long the full bar stays once nothing moves (it stays while the mouse is over it or a menu is open).', min: 1, max: 10, step: 0.5, unit: 's', default: 2.5, when: (get) => get('ui.barPeek') !== false, keywords: 'peek delay seconds bar' },
      { id: 'ui.reduceMotion', type: 'choice', label: 'Reduce motion', help: 'Auto follows your system\'s reduced-motion setting. On turns off the animations here and the animated jumps and motion blur of the Highway, whatever their switches say; Off lets each switch decide.', options: [{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], default: 'auto', keywords: 'motion animation accessibility reduced' },
      { id: 'ui.animations', type: 'toggle', label: 'Animations', help: 'Fades and slides in the interface.', default: true, keywords: 'motion transition reduce', when: (get) => !motionOff(get) },
    ],
  },
  {
    id: 'library', title: 'Library and cards', icon: 'list',
    description: 'How the song list looks and what each card shows.',
    items: [
      { id: 'library.cardStyle', group: 'List', type: 'choice', label: 'Card style', options: [{ value: 'compact', label: 'Compact' }, { value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }], default: 'normal' },
      { id: 'library.sort', group: 'List', type: 'choice', label: 'Sort by', options: [{ value: 'title', label: 'Title' }, { value: 'artist', label: 'Artist' }, { value: 'album', label: 'Album' }, { value: 'pack', label: 'Pack' }, { value: 'year', label: 'Year' }, { value: 'length', label: 'Length' }, { value: 'recent', label: 'Recently played' }, { value: 'plays', label: 'Most played' }], default: 'title', help: 'Also changes when you use the sort menu in the library. Songs never played come last in Recently played and Most played.' },
      { id: 'library.sortDesc', group: 'List', type: 'toggle', label: 'Reverse the order', default: false },
      { id: 'library.columns', group: 'List', type: 'choice', label: 'Columns', help: 'Auto adds columns as soon as two cards fit.', options: [{ value: 'auto', label: 'Auto' }, { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }], default: 'auto' },
      { id: 'library.searchRelevance', group: 'List', type: 'toggle', label: 'Best match first while searching', help: 'With text in the search box, the closest matches (title first, then artist and album) come first instead of the chosen sort.', default: true, keywords: 'search relevance order rank' },
      { id: 'library.dividers', group: 'List', type: 'toggle', label: 'Group headers', help: 'A heading for each letter, artist, pack, decade or length range.', default: true, keywords: 'divider section' },
      { id: 'library.rail', group: 'List', type: 'toggle', label: 'Scroll index', help: 'The strip with letters and ticks next to the scrollbar.', default: true, keywords: 'rail scrollbar' },
      { id: 'library.history', group: 'List', type: 'toggle', label: 'Remember what I played', help: 'Keeps, in this browser only, when you last played each song and how many times (a play is 10 seconds or more of the chart). Used by the Recently played and Most played sorts and shown in the song details. Clear it in Data and backup.', default: true, keywords: 'history recent played plays count practice log' },
      { id: 'library.thumbs', group: 'Size', type: 'toggle', label: 'Album covers', help: 'Normal and large cards.', default: true, keywords: 'thumbnails images' },
      { id: 'library.cardScale', group: 'Size', type: 'range', label: 'Card size', help: 'Cover size and spacing of the cards.', min: 70, max: 140, step: 5, unit: '%', default: 100 },
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
      { id: 'details.sections', group: 'Sections', type: 'multi', minItems: 1, label: 'Sections shown', help: 'At least one stays on.', options: [{ value: 'listen', label: 'Listen' }, { value: 'instruments', label: 'Instrument and difficulty' }, { value: 'adjust', label: 'Speed' }, { value: 'volume', label: 'Stem volume' }, { value: 'extra', label: 'Other song.ini properties' }], default: ['listen', 'instruments', 'adjust', 'volume', 'extra'], keywords: 'cards hide show' },
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
    id: 'performance', title: 'Performance', icon: 'speed',
    description: 'Frame rate and drawing quality, for phones (battery and heat) and weak graphics cards. The defaults change nothing on a fast machine.',
    items: [
      { id: 'perf.fpsCap', type: 'choice', label: 'Frame rate limit', help: 'How often the tracks are redrawn. Auto follows your screen. A lower limit saves battery and keeps a phone cooler; the music, the clock and the seek bar are not affected.', options: [{ value: 'auto', label: 'Auto' }, { value: 30, label: '30' }, { value: 45, label: '45' }, { value: 60, label: '60' }, { value: 90, label: '90' }], default: 'auto', keywords: 'fps frame rate cap limit battery heat phone' },
      { id: 'perf.economy', type: 'toggle', label: 'Economy mode', help: 'While on, turns off the costly extras without changing their own settings: the background visualizer, the motion blur on jumps and the held note pulse (their rows are dimmed), and draws the tracks at 75% of the render quality.', default: false, keywords: 'battery saver low power phone weak gpu' },
      { id: 'perf.renderScale', type: 'choice', label: 'Render quality', help: 'How many pixels the tracks and the visualizer are drawn with. Auto and High: up to 2 screen pixels per point (the usual); Medium up to 1.5; Low 1 (much lighter, a little softer on sharp screens).', options: [{ value: 'auto', label: 'Auto' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }], default: 'auto', keywords: 'resolution dpr pixel ratio scale sharp blurry gpu' },
      { id: 'perf.adaptive', type: 'toggle', label: 'Adapt quality to the frame rate', help: 'When the frame rate stays under the target (the limit above, or 60) for a few seconds while a song plays, lowers the quality one step at a time: fewer motion blur samples, a lighter visualizer, render quality 1.5, then 1, then no visualizer. It goes back up after about 10 s with room to spare. Nothing changes while the target is held.', default: true, keywords: 'adaptive dynamic automatic quality fps resolution' },
    ],
  },
  {
    id: 'highway', title: 'Highway', icon: 'guitar',
    description: 'The note chart. The view and note shape also change when you use the chart buttons.',
    items: [
      { id: 'highway.view', group: 'View', type: 'choice', label: 'View', options: [{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }], default: '3d', keywords: '3d perspective flat 2d' },
      { id: 'highway.leftHanded', group: 'View', type: 'toggle', label: 'Left-handed lanes', help: 'Mirrors the lanes of the guitar, bass, keys and drum windows left to right: the first lane (green) is on the right. This is the starting choice of every window; each instrument can differ (its View window on the start screen and details, or Highway, Per-instrument starting view). Vocals are not changed.', default: false, keywords: 'mirror flip reverse left handed lefty' },
      { id: 'highway.perspective', group: 'View', type: 'range', label: '3D perspective', help: 'How strongly the 3D road narrows towards the horizon: 100 is the classic look.', min: 60, max: 160, step: 5, unit: '%', default: 120, keywords: 'perspective 3d camera depth narrow horizon' },
      { id: 'highway.curve', group: 'View', type: 'range', label: '3D curve', help: 'Bends the road downward as it goes away, like a track curving over a hill. 0 is flat.', min: 0, max: 100, step: 5, unit: '%', default: 40, keywords: 'curve bend curved hill 3d camera road' },
      { id: 'highway.noteStyle', group: 'View', type: 'choice', label: 'Note shape', help: 'Circles are the classic round heads; Rectangles are the chrome-capped note. Also the N key and the chart menu.', options: [{ value: 'round', label: 'Circles' }, { value: 'rect', label: 'Rectangles' }], default: 'rect', keywords: 'circle rectangle round shape note head' },
      { id: 'highway.vocalView', group: 'View', type: 'choice', label: 'Vocal view', help: 'Notes shows the pitch bars with the lyrics; Karaoke shows only the lyrics. Key: K.', options: [{ value: 'track', label: 'Notes' }, { value: 'karaoke', label: 'Karaoke' }], default: 'track', keywords: 'karaoke lyrics' },
      { id: 'highway.paneMin', group: 'View', type: 'range', label: 'Narrowest track', help: 'With several tracks on screen, each one gets at least this width; the others wait outside (swipe, or [ and ]).', min: 200, max: 600, step: 20, unit: 'px', default: 280, keywords: 'window width split fretboard' },
      { id: 'highway.perInstrument', group: 'Per instrument', type: 'custom', ids: ['highway.perInstrument'], label: 'Starting view of each instrument', help: 'The view, note shape and neck speed a window of that instrument starts with; Default uses the settings above. The chart menu of a window still changes it until the next song.', keywords: 'instrument guitar bass drums keys vocals view 2d 3d note shape neck speed default per' },
      { id: 'highway.noteScale', group: 'Notes', type: 'range', label: 'Note size', help: 'The size of the note heads and of the hit pads, in 2D and 3D.', min: 70, max: 130, step: 5, unit: '%', default: 100, keywords: 'note head gem size bigger smaller pads' },
      { id: 'highway.noteBase', group: 'Notes', type: 'range', label: 'Note base height', help: 'How tall the dark base under a rectangular note is drawn (0 hides it). Rectangles only.', min: 0, max: 200, step: 10, unit: '%', default: 100, keywords: 'rectangle note base side depth thickness' },
      { id: 'highway.noteCut', group: 'Notes', type: 'range', label: 'Rectangle note height cut', help: 'How much of the top of a rectangular note is cut off: 0 is the full design, higher is flatter. Rectangles only.', min: 0, max: 40, step: 1, unit: '%', default: 33, keywords: 'rectangle note height flat cut top' },
      { id: 'highway.sustainWidth', group: 'Notes', type: 'range', label: 'Sustain width', help: 'How wide the tail of a long note is.', min: 50, max: 150, step: 5, unit: '%', default: 100, keywords: 'sustain tail long note width' },
      { id: 'highway.kickBarHeight', group: 'Notes', type: 'range', label: 'Kick and open bar thickness', help: 'How thick the bar across the track of a kick drum or an open note is.', min: 50, max: 200, step: 10, unit: '%', default: 100, keywords: 'kick pedal bass drum open bar thickness height' },
      { id: 'highway.padLook', group: 'Notes', type: 'range', label: 'Hit pad strength', help: 'How solid the hit pads at the bottom of the track are while nothing is hit.', min: 50, max: 150, step: 5, unit: '%', default: 100, keywords: 'pads strikeline hit line opacity' },
      { id: 'highway.fast3dNotes', group: 'Notes', type: 'toggle', label: 'Faster 3D notes (experimental)', help: 'Experimental. The rectangular notes and cymbals of the 3D view already come from cached pictures up to a medium size; this draws the largest (nearest) ones that way too, at the price of slightly softer edges. Off draws those in full.', default: false, keywords: 'performance fast speed 3d notes sprite cache gpu' },
      { id: 'highway.webgl3d', group: 'Notes', type: 'toggle', label: 'WebGL notes (experimental)', help: 'Experimental prototype. Draws the cached note heads of the 3D view with WebGL2, all in one instanced draw call, instead of one canvas copy each. Everything else (tails, bars, hit line, bursts) stays as is. Falls back to the normal drawing if WebGL2 is not available.', default: false, keywords: 'performance fast speed 3d notes gpu webgl instanced' },
      { id: 'highway.tailStyle', group: 'Notes', type: 'choice', label: 'Sustain style (3D)', help: 'How the tail of a long note looks in the 3D view. Flow: a lighter core with a rounded tip, and while the note is held chevrons run down it into the hit line. Classic: a flat strip that brightens and glows while held.', options: [{ value: 'flow', label: 'Flow' }, { value: 'classic', label: 'Classic' }], default: 'flow', keywords: 'sustain tail long note style flow chevrons animation classic' },
      { id: 'highway.hitAnimation', group: 'Notes', type: 'choice', label: 'Hit animation (3D)', help: 'What a note does when it reaches the hit line in the 3D view. Burst: it shrinks into the line while a ring spreads over the road and sparks fly up from the lane. Classic: it swells, whitens and fades.', options: [{ value: 'burst', label: 'Burst' }, { value: 'classic', label: 'Classic' }], default: 'burst', keywords: 'hit animation effect sparks ring explosion fade note' },
      { id: 'highway.heldPulse', group: 'Notes', type: 'toggle', label: 'Held note pulse', help: 'While a long note is held, its head swells slightly, its tail shimmers and its pad flickers. Off keeps them still.', default: true, keywords: 'sustain held wobble shimmer pulse flicker motion', when: (get) => !get('perf.economy') },
      { id: 'highway.palette', group: 'Colours', type: 'choice', label: 'Note colours', help: 'The colours of the five lanes (and of kicks, open and tap notes). Colour-blind safe keeps the lanes apart with red-green and blue-yellow colour blindness.', options: PALETTES.map(({ id, label }) => ({ value: id, label })), default: 'yarg', keywords: 'colour color palette lanes frets colour-blind colorblind deuteranopia protanopia tritanopia accessibility high contrast custom' },
      { id: 'highway.laneColors', group: 'Colours', type: 'custom', ids: ['highway.laneColors'], label: 'Custom lane colours', help: 'Green, red, yellow, blue and orange lanes, left to right (drums use the same colours for their pads).', keywords: 'colour color custom lanes frets picker', when: (get) => get('highway.palette') === 'custom' },
      { id: 'highway.trackOpacity', group: 'Track and bands', type: 'range', label: 'Track opacity', help: 'How solid the track behind the notes is: higher hides more of the background and visualizer.', min: 0, max: 100, step: 5, unit: '%', default: 75, keywords: 'transparent fretboard' },
      { id: 'highway.starPowerBand', group: 'Track and bands', type: 'toggle', label: 'Star power highlight', help: 'Tints the track under a star power phrase (gold). Off by default: the notes of the phrase already stand out.', default: false, keywords: 'star power overlay background band gold overdrive' },
      { id: 'highway.fillBand', group: 'Track and bands', type: 'toggle', label: 'Drum fill track colour', help: 'Lights the track (green, fading at both ends, with a bright line at the start and end of the phrase) during a drum fill. The big rock ending band is not affected.', default: true, keywords: 'drum fill overlay background band green activation' },
      { id: 'highway.hitLine', group: 'Track and bands', type: 'toggle', label: 'Hit line bar', help: 'A fixed bar across the board at the hit line, as thick as the pedal and open bars, with a border at each end. It stays in place as the notes pass over it.', default: true, keywords: 'hit line bar strike line frets pads border' },
      { id: 'highway.bandBorders', group: 'Track and bands', type: 'toggle', label: 'Band side borders', help: 'Thick borders on both sides of the board along the star power, solo, roll and big rock ending bands (and the green ones of a drum fill), in the colour of each band.', default: true, keywords: 'border edge side star power solo roll bre band frame' },
      { id: 'highway.fillActivation', group: 'Track and bands', type: 'toggle', label: 'Highlight fill activation notes', help: 'Marks the note a drum fill leads into (the star power activation note, as in YARG) with a glow and a ring, and lights every pad when it arrives. Drums only.', default: true, keywords: 'drum fill star power activation note flash pads' },
      { id: 'highway.soloBand', group: 'Track and bands', type: 'toggle', label: 'Solo highlight', help: 'Tints the track (blue) during a guitar or drum solo.', default: true, keywords: 'solo overlay background band blue' },
      { id: 'highway.breBand', group: 'Track and bands', type: 'choice', label: 'Big rock ending colours', help: 'The lanes are tinted in their own colours during a big rock ending: pulsing, steady, or not at all. With Reduce motion on, Pulsing is drawn steady.', options: [{ value: 'pulse', label: 'Pulsing' }, { value: 'steady', label: 'Steady' }, { value: 'off', label: 'Off' }], default: 'pulse', keywords: 'big rock ending bre coda flashing pulse band accessibility' },
      { id: 'highway.beatLines', group: 'Track and bands', type: 'choice', label: 'Beat lines', help: 'The lines across the track on every beat (stronger on the first beat of a measure).', options: [{ value: 'off', label: 'Off' }, { value: 'subtle', label: 'Subtle' }, { value: 'normal', label: 'Normal' }, { value: 'strong', label: 'Strong' }], default: 'normal', keywords: 'beat measure bar lines grid' },
      { id: 'highway.laneStripes', group: 'Track and bands', type: 'toggle', label: 'Lane stripes', help: 'Every other lane is a little lighter, so the lanes are easy to tell apart.', default: true, keywords: 'lanes stripes alternate columns' },
      { id: 'highway.countdown', group: 'Countdown', type: 'toggle', label: 'Countdown during long rests', help: 'While an instrument has nothing to play for a while (9 s or more by default), show the time until its next note.', default: true, keywords: 'wait rest countdown' },
      { id: 'highway.countdownMin', group: 'Countdown', type: 'choice', label: 'Shortest rest with a countdown', help: 'A rest at least this long gets a countdown. YARG uses 9 seconds.', options: [{ value: 5, label: '5 s' }, { value: 9, label: '9 s' }, { value: 15, label: '15 s' }], default: 9, keywords: 'wait rest countdown length minimum seconds', when: (get) => get('highway.countdown') },
      { id: 'highway.countdownUnit', group: 'Countdown', type: 'choice', label: 'Countdown shows', help: 'The number in the countdown: the measures left (YARG\'s default) or the seconds left.', options: [{ value: 'measures', label: 'Measures' }, { value: 'seconds', label: 'Seconds' }], default: 'measures', when: (get) => get('highway.countdown') },
      { id: 'highway.countdownColors', group: 'Countdown', type: 'choice', label: 'Countdown colours', help: 'Coloured from the theme, the fixed blue and green of the first versions, or from a colour you pick.', options: [{ value: 'theme', label: 'Theme' }, { value: 'classic', label: 'Classic' }, { value: 'custom', label: 'Custom' }], default: 'theme', when: (get) => get('highway.countdown') },
      { id: 'highway.countdownColor', group: 'Countdown', type: 'color', label: 'Countdown colour', default: '#2f80ed', when: (get) => get('highway.countdown') && get('highway.countdownColors') === 'custom' },
      { id: 'highway.vocalColors', group: 'Vocals', type: 'choice', label: 'Vocal colours', help: 'The vocal notes, harmonies, lyrics and percussion: coloured from the theme, the fixed blue and green of the first versions, or from a colour you pick.', options: [{ value: 'theme', label: 'Theme' }, { value: 'classic', label: 'Classic' }, { value: 'custom', label: 'Custom' }], default: 'theme' },
      { id: 'highway.vocalColor', group: 'Vocals', type: 'color', label: 'Vocal colour', default: '#5b8def', when: (get) => get('highway.vocalColors') === 'custom' },
      { id: 'highway.lyricsAbove', group: 'Vocals', type: 'range', label: 'Lyrics above the line being sung', help: 'How much of the lyric sheets (karaoke) shows the lines before the current one, as a share of their height.', min: 0, max: 40, step: 1, unit: '%', default: 12 },
      { id: 'highway.lyricSize', group: 'Vocals', type: 'range', label: 'Lyrics size', help: 'The size of the lyrics under the vocal notes and in the karaoke sheets.', min: 70, max: 160, step: 5, unit: '%', default: 100, keywords: 'lyrics text font size karaoke words' },
      { id: 'highway.lyricOutline', group: 'Vocals', type: 'toggle', label: 'Lyrics outline', help: 'A dark edge around the letters of the lyrics, so they read over any background.', default: true, keywords: 'lyrics outline stroke shadow contrast' },
      { id: 'highway.seekAnimation', group: 'Motion', type: 'toggle', label: 'Animate jumps in the song', help: 'When you seek or jump to a section, the notes scroll to the new place instead of snapping.', default: true, when: (get) => !motionOff(get) },
      { id: 'highway.motionBlur', group: 'Motion', type: 'toggle', label: 'Motion blur on jumps', help: 'While the notes rush to the new place after a seek, draw a trail behind them.', default: true, when: (get) => !motionOff(get) && get('highway.seekAnimation') && !get('perf.economy') },
      { id: 'highway.neck', group: 'Motion', type: 'range', label: 'Note spacing (neck speed)', help: 'Only the spacing of the notes, not the music speed. Each track\'s own neck speed control resets to this value.', values: NECK_VALUES, min: NECK_MIN, max: NECK_MAX, unit: '×', default: 1.2, keywords: 'scroll speed spacing approach' },
      { id: 'highway.visualizer', group: 'Visualizer', type: 'choice', label: 'Background visualizer', help: 'An animation behind all the tracks, driven by the album art, the beats and the notes. Key: G.', options: VISUALIZERS.map((v) => ({ value: v.id, label: v.label })), default: 'none', keywords: 'background animation aurora synthwave warp rings equalizer embers cover radial spotlights tunnel', when: (get) => !get('perf.economy') },
      { id: 'highway.visualizerQuality', group: 'Visualizer', type: 'choice', label: 'Visualizer quality', help: 'The background is drawn at a lower resolution and stretched: lower is much lighter on the graphics card (the album art always stays sharp).', options: [{ value: 'high', label: 'High (full resolution)' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low (lightest)' }], default: 'medium', when: (get) => get('highway.visualizer') !== 'none' },
      { id: 'highway.visualizerFps', group: 'Visualizer', type: 'choice', label: 'Visualizer frame rate', help: 'How often the background is redrawn. Lower is lighter on the graphics card (the tracks are not affected). Unlimited redraws it on every frame of your screen, even above 60.', options: [{ value: '20', label: '20 frames per second' }, { value: '30', label: '30 frames per second' }, { value: '60', label: '60 frames per second' }, { value: 'unlimited', label: 'Unlimited (every screen frame)' }], default: '60', when: (get) => get('highway.visualizer') !== 'none' },
      { id: 'highway.visualizerOpacity', group: 'Visualizer', type: 'range', label: 'Visualizer opacity', help: 'How strongly the visualizer shows over the stage colour (the notes are not affected). 100 is full.', min: 0, max: 100, step: 1, unit: '%', default: 100, when: (get) => get('highway.visualizer') !== 'none' },
      { id: 'highway.visualizerBlur', group: 'Visualizer', type: 'range', label: 'Visualizer blur', help: 'Blurs the visualizer (not the notes). 0 is sharp.', min: 0, max: 40, step: 1, unit: 'px', default: 0, when: (get) => get('highway.visualizer') !== 'none' },
      { id: 'highway.stageColorOn', group: 'Visualizer', type: 'toggle', label: 'Custom stage colour', help: 'Use your own colour behind the tracks instead of the chart background of the theme (also in the visualizer menu). Hidden while the selected visualizer covers the stage colour (Album art).', default: false, when: (get) => showsStage(get('highway.visualizer')) },
      { id: 'highway.stageColor', group: 'Visualizer', type: 'color', label: 'Stage colour', default: '#0d1117', when: (get) => get('highway.stageColorOn') && showsStage(get('highway.visualizer')) },
    ],
  },
  {
    id: 'general', title: 'General', icon: 'gear',
    description: 'What the app does when it starts, when a song opens, plays, pauses and ends.',
    items: [
      { id: 'general.restoreLast', group: 'Startup', type: 'toggle', label: 'Reopen the last song', help: 'At startup, open the song you were on.', default: false, keywords: 'startup resume session' },
      { id: 'general.autoplay', group: 'Startup', type: 'toggle', label: 'Load and play as soon as I pick a song', help: 'Skips the Play button: the loading screen appears right away.', default: false, keywords: 'autoplay start' },
      { id: 'general.rememberInstruments', group: 'Startup', type: 'toggle', label: 'Remember the last instruments and difficulties', help: 'A new song opens with the instruments (and the difficulty of each) you used last, when the song has them.', default: true, keywords: 'instrument difficulty last remember' },
      { id: 'playback.linkAutoplay', group: 'Startup', type: 'toggle', label: 'Start songs opened from a link', help: 'A song opened by a link (or the first Play) shows the start screen: the audio loads in its Play button, then after 3 seconds the song starts by itself. Off: it waits for you to press Play. (Browsers only allow the sound to start by itself after you have clicked or pressed a key on the page.)', default: true, keywords: 'autoplay link start screen' },
      { id: 'playback.resumeRewind', group: 'Playback', type: 'toggle', label: 'Rewind 1 s when resuming and when a loop restarts', help: 'Like YARG: Play after a pause goes back one second (the screen rewinds in half a second) and plays on; a loop also restarts one second before its start. The notes of that second are drawn dim, until the song passes the point where you paused (or the loop start).', default: true, keywords: 'pause resume rewind replay' },
      { id: 'playback.seekRewind', group: 'Playback', type: 'toggle', label: 'Land 1 s early when seeking', help: 'A seek (the seek bar, sections) lands one second before the chosen point and plays on; the notes of that second are drawn dim, until the song reaches the point you chose. Not used with a loop.', default: false, keywords: 'seek rewind replay' },
      { id: 'playback.keepAwake', group: 'Playback', type: 'toggle', label: 'Keep the screen awake while playing', help: 'Asks the browser not to dim or lock the screen during a song (phones and tablets). Needs a browser with the Screen Wake Lock API.', default: true, keywords: 'wake lock sleep screen dim phone tablet' },
      { id: 'playback.pauseOnFocusLoss', group: 'Playback', type: 'toggle', label: 'Pause when the window loses focus', help: 'The song pauses when you switch to another window or tab (a Play afterwards resumes it, with the rewind above). YARG turns this on by default.', default: false, keywords: 'focus blur hidden tab background pause' },
      { id: 'playback.muteOnFocusLoss', group: 'Playback', type: 'toggle', label: 'Mute when the window loses focus', help: 'The sound is muted while you are in another window or tab and comes back when you return. Your saved volume and mute are not changed.', default: false, keywords: 'focus blur hidden tab background mute' },
      { id: 'playback.startDelay', group: 'Playback', type: 'range', label: 'Start delay', help: 'A song played from the very beginning waits this long (the tracks stay at the start) before the sound begins. YARG uses 2 s; 0 starts at once.', min: 0, max: 3, step: 0.5, unit: 's', default: 0, keywords: 'wait countdown start intro' },
      { id: 'playback.loopRestartDelay', group: 'Playback', type: 'range', label: 'Loop restart delay', help: 'When a loop reaches its end, the song waits this long in silence (the tracks stay at the loop end) before it restarts. YARG waits 2 s before restarting a practice section; 0 restarts at once.', min: 0, max: 5, step: 0.5, unit: 's', default: 0, keywords: 'loop practice section restart wait pause' },
      { id: 'practice.trainer', group: 'Practice', type: 'toggle', label: 'Speed trainer while looping', help: 'While an A-B loop is on (key R), the song starts at the start speed and gets faster by one step after every few passes of the loop, up to the target speed. Turning it off or ending the loop keeps the speed it reached. Also in the speed menu of the player bar.', default: false, keywords: 'speed trainer ramp tempo practice loop faster slow down auto increase' },
      { id: 'practice.trainerStart', group: 'Practice', type: 'range', label: 'Trainer start speed', help: 'The speed a loop starts at when the trainer is on.', min: 20, max: 100, step: 5, unit: '%', default: 60, keywords: 'speed trainer ramp start slow', when: (get) => get('practice.trainer') },
      { id: 'practice.trainerTarget', group: 'Practice', type: 'range', label: 'Trainer target speed', help: 'The trainer stops getting faster at this speed. A target at or below the start speed keeps the start speed.', min: 50, max: 200, step: 5, unit: '%', default: 100, keywords: 'speed trainer ramp target goal', when: (get) => get('practice.trainer') },
      { id: 'practice.trainerStep', group: 'Practice', type: 'range', label: 'Trainer step', help: 'How much faster each step is.', min: 5, max: 25, step: 5, unit: '%', default: 5, keywords: 'speed trainer ramp step increment', when: (get) => get('practice.trainer') },
      { id: 'practice.trainerPasses', group: 'Practice', type: 'range', label: 'Passes before each step', help: 'How many times the loop plays at one speed before the next step (there is no hit detection: every completed pass counts).', min: 1, max: 10, step: 1, default: 2, keywords: 'speed trainer ramp passes repeats clean', when: (get) => get('practice.trainer') },
      { id: 'playback.pausePanel', group: 'Pause and end', type: 'toggle', label: 'Quick settings while paused', help: 'While the song is paused, a small panel in the middle of the stage shows speed, metronome, master volume and a Resume button (like the quick settings of the YARG pause menu). Esc closes it.', default: false, keywords: 'pause menu panel quick volume speed' },
      { id: 'playback.pauseInfo', group: 'Pause and end', type: 'toggle', label: 'Show the song information when paused', help: 'Pausing shows the song window (cover, title, details) with a Play button and an on/off button for every instrument. Not shown with the quick settings panel (that one takes its place).', default: true, keywords: 'pause song information instruments' },
      { id: 'general.endScreen', group: 'Pause and end', type: 'toggle', label: 'Show the end-of-song window', help: 'When a song ends, a window replaces the tracks with facts about each instrument and a few songs to play next. Off: the song just stops (the play button still turns into Restart).', default: true, keywords: 'end finish outro recommendations next restart' },
      { id: 'playback.songInfoOverlay', group: 'Pause and end', type: 'toggle', label: 'Song information when a song starts', help: 'The title, artist, album, year and genre fade in over the tracks at the start of a song and fade out a few seconds later.', default: true, keywords: 'title artist overlay intro' },
      { id: 'playback.keepSongInfo', group: 'Pause and end', type: 'toggle', label: 'Keep the song information visible', help: 'The overlay stays on screen until the song is closed.', default: false, when: (get) => get('playback.songInfoOverlay'), keywords: 'title artist overlay' },
      { id: 'audio.latency', group: 'Audio', type: 'range', label: 'Audio latency', help: 'Shifts the notes against the sound, in milliseconds: positive = the notes arrive later. It is the starting chart delay of every song (the sync check of the welcome screen sets it; Settings, Data and backup, Run setup again).', min: -300, max: 300, step: 5, unit: ' ms', default: 0, keywords: 'sync calibrate calibration delay offset lag bluetooth latency' },
      { id: 'audio.metronome', group: 'Audio', type: 'toggle', label: 'Metronome', help: 'A click on every beat of the song (the first beat of a measure is higher), at any speed. Off = muted: the speaker in the metronome window and the M key flip it, and a volume of 0 is silent too.', default: false, keywords: 'metronome click beat tempo' },
      { id: 'audio.metronomeVolume', group: 'Audio', type: 'range', label: 'Metronome volume', help: 'How loud the click is, before the master volume.', min: 0, max: 100, step: 5, unit: '%', default: 50, keywords: 'metronome click volume' },
      { id: 'audio.metronomeSound', group: 'Audio', type: 'choice', label: 'Metronome sound', options: [{ value: 'click', label: 'Click' }, { value: 'woodblock', label: 'Woodblock' }, { value: 'beep', label: 'Beep' }], default: 'click', keywords: 'metronome click woodblock beep' },
      { id: 'audio.rememberVolumes', group: 'Audio', type: 'toggle', label: 'Remember each track\'s volume', help: 'Guitar, bass, drums, vocals and the others keep the level you set on the next song.', default: true, keywords: 'volume mixer stems remember' },
      { id: 'audio.censor', group: 'Audio', type: 'toggle', label: 'Use clean (censored) audio when available', help: 'Songs with both explicit and clean stems (song_clean, vocals_explicit, ...) play one version, never both. Off plays the explicit one. Applies the next time a song is opened.', default: false, keywords: 'explicit clean censored profanity stems' },
    ],
  },
  {
    id: 'advanced', title: 'Advanced', icon: 'pulse',
    description: 'Tools for checking how the app performs.',
    items: [
      { id: 'perf.overlay', type: 'choice', label: 'Performance overlay', help: 'FPS and other meters over the tracks. Key: P cycles off, compact, detailed.', options: [{ value: 'off', label: 'Off' }, { value: 'compact', label: 'FPS' }, { value: 'detailed', label: 'Detailed' }], default: 'off', keywords: 'fps frame rate performance meter debug' },
      { id: 'perf.position', type: 'choice', label: 'Overlay position', options: [{ value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' }, { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }], default: 'bottom-right', when: (get) => get('perf.overlay') !== 'off' },
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
      { id: 'data.tools', type: 'custom', ids: [], label: 'Settings backup', keywords: 'export import reset backup restore default clear cache favourites starred history' },
    ],
  },
];

// Defaults of every setting, collected from the schema (custom items list their ids and defaults in `defaults`).
const CUSTOM_DEFAULTS = {
  'theme.preset': 'dark',
  'theme.overrides': {},
  'theme.saved': [],
  'shortcuts.bindings': {},
  'highway.laneColors': [...DEFAULT_LANE_COLORS],
  'highway.perInstrument': {},
};

export function buildDefaults(sections = SECTIONS) {
  const out = { ...CUSTOM_DEFAULTS };
  for (const s of sections) for (const it of s.items) if (it.type !== 'custom') out[it.id] = it.default;
  return out;
}

// The schema item of a setting id (not the custom items' inner ids), or undefined.
export function itemById(id, sections = SECTIONS) {
  for (const s of sections) for (const it of s.items) if (it.id === id && it.type !== 'custom') return it;
  return undefined;
}

// Version of the stored / exported settings. Data without one is version 1 (the first exports). Bump it when a migration needs
// to know where the data came from; plain renames do not (they apply to data of any version).
export const SETTINGS_VERSION = 2;

// Renamed or replaced setting ids: { oldId: 'newId' } or { oldId: { id: 'newId', value: (old) => newValue } }. Applied to the
// stored settings and to imported files before validation (settings.js `migrate`); a value that then fails validation is
// dropped like any other. A removed id needs no entry (unknown ids are ignored).
export const RENAMES = {};

export const PRESET_NAMES =Object.fromEntries(PRESETS.map((p) => [p.id, p.name]));

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
      if (Array.isArray(it.values)) return { ok: true, value: it.values[neckIndex(v)] }; // (a list of allowed values: the nearest one)
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
      const out = [...new Set(value.filter((x) => allowed.has(x)))];
      return out.length >= (it.minItems ?? 0) ? { ok: true, value: out } : { ok: false }; // too few: the caller falls back to the default
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
  'highway.laneColors': (v) => { const c = cleanLaneColors(v); return c ? { ok: true, value: c } : { ok: false }; },
  'highway.perInstrument': (v) => cleanPerInstrument(v),
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
