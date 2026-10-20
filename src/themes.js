// Themes: a theme is a set of colours (CSS variables). There are ready-made presets; the user can start from one and
// change any colour, derive a theme from a single accent colour, and save their own themes. Pure functions, no DOM,
// except applyTheme() at the bottom.

// Variables of a theme: bg (page), panel, panel2 (raised areas), line (borders), text, muted, accent, stage (the chart's
// background; it stays dark in light themes because the notes are drawn for a dark board).
export const THEME_KEYS = ['bg', 'panel', 'panel2', 'line', 'text', 'muted', 'accent', 'stage'];
export const THEME_LABELS = {
  bg: 'Page background', panel: 'Panels', panel2: 'Raised areas', line: 'Borders', text: 'Text', muted: 'Secondary text', accent: 'Accent', stage: 'Chart background',
};

export const PRESETS = [
  { id: 'dark', name: 'Dark', scheme: 'dark', vars: { bg: '#0d1117', panel: '#161b22', panel2: '#1c232c', line: '#30363d', text: '#e6edf3', muted: '#8b949e', accent: '#2f80ed', stage: '#0d1117' } },
  { id: 'midnight', name: 'Midnight', scheme: 'dark', vars: { bg: '#0b1020', panel: '#121a30', panel2: '#182244', line: '#26335a', text: '#e8ecff', muted: '#8b97c4', accent: '#6c8cff', stage: '#0a0f1e' } },
  { id: 'oled', name: 'OLED black', scheme: 'dark', vars: { bg: '#000000', panel: '#0b0b0b', panel2: '#151515', line: '#2a2a2a', text: '#f2f2f2', muted: '#8a8a8a', accent: '#3ea6ff', stage: '#000000' } },
  { id: 'nord', name: 'Nord', scheme: 'dark', vars: { bg: '#2b303b', panel: '#3b4252', panel2: '#434c5e', line: '#4c566a', text: '#eceff4', muted: '#a3adc2', accent: '#88c0d0', stage: '#2b303b' } },
  { id: 'solarized', name: 'Solarized dark', scheme: 'dark', vars: { bg: '#002b36', panel: '#073642', panel2: '#0a4352', line: '#19556a', text: '#eee8d5', muted: '#93a1a1', accent: '#2aa198', stage: '#00252e' } },
  { id: 'dracula', name: 'Dracula', scheme: 'dark', vars: { bg: '#1e1f29', panel: '#282a36', panel2: '#313442', line: '#44475a', text: '#f8f8f2', muted: '#a0a4c0', accent: '#bd93f9', stage: '#1a1b24' } },
  { id: 'rock', name: 'Rock red', scheme: 'dark', vars: { bg: '#120c0c', panel: '#1c1313', panel2: '#261a1a', line: '#3a2626', text: '#f3e9e9', muted: '#a89090', accent: '#e5392b', stage: '#0f0a0a' } },
  { id: 'forest', name: 'Forest', scheme: 'dark', vars: { bg: '#0e1411', panel: '#151d18', panel2: '#1c2721', line: '#2a3a31', text: '#e4efe8', muted: '#8aa095', accent: '#3fbf6f', stage: '#0b100d' } },
  { id: 'contrast', name: 'High contrast', scheme: 'dark', vars: { bg: '#000000', panel: '#0a0a0a', panel2: '#1a1a1a', line: '#ffffff', text: '#ffffff', muted: '#d0d0d0', accent: '#ffd400', stage: '#000000' } },
  { id: 'light', name: 'Light', scheme: 'light', vars: { bg: '#f6f8fa', panel: '#ffffff', panel2: '#eef1f4', line: '#d0d7de', text: '#1f2328', muted: '#59636e', accent: '#2f80ed', stage: '#1b222c' } },
  { id: 'paper', name: 'Paper', scheme: 'light', vars: { bg: '#f4efe6', panel: '#fbf8f2', panel2: '#efe8da', line: '#d9cfba', text: '#2b2620', muted: '#7a6f5f', accent: '#b4541a', stage: '#1f1a15' } },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) ?? null;

// --- colour helpers ------------------------------------------------------------------------------------------------
export const isHex = (s) => /^#[0-9a-f]{6}$/i.test(String(s));
function hexToRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
export function mix(hexA, hexB, t) { // t = 0 -> A, 1 -> B
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}
export function luminance(hex) { // 0 (black) .. 1 (white), WCAG relative luminance
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
export const readableOn = (bg) => (luminance(bg) > 0.4 ? '#101418' : '#ffffff'); // text colour for text on a given background
// The unfilled track of a progress fill in the accent colour (the start screen's Play button while it loads): the accent pulled far toward the pole away
// from its text colour (black under white text, white under dark text), so the same text reads on the track and on the fill.
export const accentTrack = (accent) => mix(accent, readableOn(accent) === '#ffffff' ? '#000000' : '#ffffff', 0.72);

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
export function hexToHue(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// A whole theme from one accent colour: neutral surfaces tinted with the accent's hue.
export function deriveTheme(accent, scheme = 'dark') {
  const h = hexToHue(accent);
  if (scheme === 'light') {
    return {
      bg: hslToHex(h, 0.2, 0.96), panel: '#ffffff', panel2: hslToHex(h, 0.18, 0.93), line: hslToHex(h, 0.15, 0.82),
      text: hslToHex(h, 0.2, 0.12), muted: hslToHex(h, 0.1, 0.38), accent, stage: hslToHex(h, 0.25, 0.1),
    };
  }
  return {
    bg: hslToHex(h, 0.25, 0.07), panel: hslToHex(h, 0.22, 0.1), panel2: hslToHex(h, 0.2, 0.14), line: hslToHex(h, 0.18, 0.22),
    text: hslToHex(h, 0.15, 0.93), muted: hslToHex(h, 0.1, 0.62), accent, stage: hslToHex(h, 0.3, 0.05),
  };
}

// --- resolving the active theme --------------------------------------------------------------------------------------
// settings: { preset: 'auto' | preset id | 'saved:<id>', overrides: { key: hex }, saved: [{ id, name, scheme, vars }] }
export function resolveTheme({ preset = 'dark', overrides = {}, saved = [] } = {}, prefersDark = true) {
  let base;
  if (preset === 'auto') base = presetById(prefersDark ? 'dark' : 'light');
  else if (preset.startsWith('saved:')) {
    const s = saved.find((t) => `saved:${t.id}` === preset);
    base = s ? { id: preset, name: s.name, scheme: s.scheme ?? 'dark', vars: s.vars } : presetById('dark');
  } else base = presetById(preset) ?? presetById('dark');
  const vars = { ...base.vars };
  for (const k of THEME_KEYS) if (isHex(overrides[k])) vars[k] = overrides[k];
  return { id: base.id, name: base.name, scheme: base.scheme, vars };
}

// Sets the variables on <html> (inline style beats the stylesheet's :root) and the colour scheme of native controls.
export function applyTheme(theme, root = document.documentElement) {
  const v = theme.vars;
  root.style.setProperty('--bg', v.bg);
  root.style.setProperty('--panel', v.panel);
  root.style.setProperty('--panel-2', v.panel2);
  root.style.setProperty('--line', v.line);
  root.style.setProperty('--text', v.text);
  root.style.setProperty('--muted', v.muted);
  root.style.setProperty('--accent', v.accent);
  root.style.setProperty('--accent-text', readableOn(v.accent)); // text on accent-coloured buttons
  root.style.setProperty('--accent-track', accentTrack(v.accent)); // the unfilled part of an accent progress fill
  root.style.setProperty('--stage', v.stage);
  root.style.setProperty('color-scheme', theme.scheme); // native inputs, scrollbars and select lists follow
  root.dataset.theme = theme.scheme;
  const [r, g, b] = hexToRgb(v.stage);
  root.style.setProperty('--stage-rgb', `${r}, ${g}, ${b}`); // for translucent chart overlays
}
