// The colours of the vocal view and of the wait countdowns. Three modes (the settings `highway.vocalColors` / `highway.countdownColors`):
//   'theme'   (default) derived from the active theme: its accent, text, secondary text and panel colours;
//   'classic' the fixed blue / green of the first versions;
//   'custom'  the accent is the colour the user picked, the rest is derived from it the same way as for a theme.
// Pure functions over '#rrggbb' strings (no DOM): `theme` is { accent, text, muted, panel }.

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const parse = (hex) => {
  const n = parseInt(String(hex).replace('#', '').padStart(6, '0').slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r, g, b) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
export const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function mixHex(a, b, t) {
  const A = parse(a);
  const B = parse(b);
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

// Hue rotation by `deg` degrees, keeping saturation and lightness (a grey stays grey).
export function shiftHue(hex, deg) {
  const [r, g, b] = parse(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return hex;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h * 60 + deg) % 360) + 360) % 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    const k = (t + 360) % 360;
    if (k < 60) return p + ((q - p) * k) / 60;
    if (k < 180) return q;
    if (k < 240) return p + ((q - p) * (240 - k)) / 60;
    return p;
  };
  return toHex(f(h + 120) * 255, f(h) * 255, f(h - 120) * 255);
}

const CLASSIC_COUNTDOWN = {
  ring: '#6cb6ff', urgent: '#13f0a6', text: '#ffffff', urgentText: '#13f0a6', fill: '#080b10', fillAlpha: 0.72,
  track: '#ffffff', trackAlpha: 0.14, dimRing: '#7d8590', dimText: '#8b949e',
};
const CLASSIC_VOCAL = {
  lead: '#5b8def', leadLit: '#9fd0ff', harmony: { 1: '#3fbf9f', 2: '#2fa8a8', 3: '#8fd6c4' },
  lyrics: ['#ffffff', '#13f0a6', '#595959'], lyrics2: ['#9fe3d0', '#2fd9c4', '#4b6b66'],
  present: '#13f0a6', frame: '#6cb6ff', perc: { glow: '#6cb6ff', ring: '#bfe9ff', ball: '#e6edf3', lit: '#6cb6ff' },
};

const accentOf = (mode, custom, theme) => (mode === 'custom' && isHex(custom) ? custom : theme.accent);

export function countdownColors(mode, custom, theme) {
  if (mode === 'classic' || !theme) return CLASSIC_COUNTDOWN;
  const accent = accentOf(mode, custom, theme);
  const urgent = mixHex(accent, '#ffffff', 0.45);
  return {
    ring: accent, urgent, text: theme.text, urgentText: urgent, fill: theme.panel, fillAlpha: 0.86,
    track: theme.text, trackAlpha: 0.14, dimRing: theme.muted, dimText: theme.muted,
  };
}

// The colours of the lyrics never follow the theme or the picked colour (a light theme must not turn the words dark): they are always the ones the dark theme gives.
const DARK_THEME = { accent: '#2f80ed', text: '#e6edf3', muted: '#8b949e', panel: '#161b22' };
const DARK_LIGHT = mixHex(DARK_THEME.accent, '#ffffff', 0.4);
const LYRICS = [DARK_THEME.text, DARK_LIGHT, mixHex(DARK_THEME.muted, DARK_THEME.panel, 0.45)];
const LYRICS2 = [mixHex(DARK_THEME.text, DARK_THEME.accent, 0.45), mixHex(DARK_THEME.accent, DARK_THEME.text, 0.25), mixHex(DARK_THEME.muted, DARK_THEME.panel, 0.6)];

export function vocalColors(mode, custom, theme) {
  if (mode === 'classic' || !theme) return CLASSIC_VOCAL;
  const accent = accentOf(mode, custom, theme);
  const light = mixHex(accent, '#ffffff', 0.4);
  return {
    lead: accent,
    leadLit: light,
    harmony: { 1: shiftHue(accent, 40), 2: shiftHue(accent, -40), 3: mixHex(shiftHue(accent, 80), '#ffffff', 0.3) },
    lyrics: LYRICS,
    lyrics2: LYRICS2,
    present: DARK_LIGHT,
    frame: accent,
    perc: { glow: accent, ring: mixHex(accent, '#ffffff', 0.7), ball: theme.text, lit: accent },
  };
}
