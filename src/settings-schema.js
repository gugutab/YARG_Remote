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
    id: 'general', title: 'General', icon: 'gear',
    description: 'What the app does when it starts and when a song opens.',
    items: [
      { id: 'general.restoreLast', type: 'toggle', label: 'Reopen the last song', help: 'At startup, open the song you were on.', default: false, keywords: 'startup resume session' },
      { id: 'general.autoplay', type: 'toggle', label: 'Play as soon as a song has loaded', help: 'Skips the Play button on the details screen.', default: false, keywords: 'autoplay start' },
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
