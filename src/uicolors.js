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

// A colour of the same family as `hex` turned by `deg` degrees on the wheel and kept vivid: saturation 0.55-0.85 and lightness 0.52-0.66, so a harmony voice never comes out muddy or
// neon whatever the theme, and a grey theme (no hue to turn) gets a calm blue as the starting hue.
export function vividHue(hex, deg) {
  const [r, g, b] = parse(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let l = (max + min) / 2;
  const d = max - min;
  let s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = d === 0 ? 215 : max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  if (d !== 0) h *= 60;
  if (s < 0.12) s = 0.6;
  h = (((h + deg) % 360) + 360) % 360;
  s = Math.min(0.85, Math.max(0.55, s));
  l = Math.min(0.66, Math.max(0.52, l));
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
  lead: '#5b8def', leadLit: '#9fd0ff', harmony: { 1: '#00ccff', 2: '#ff8500', 3: '#ffdb00' }, // YARG's harmony colours
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

// The base colours of the lyrics (the words not yet sung, and the dim ones) never follow the theme (a light theme must not turn the words dark): they are always the
// ones the dark theme gives. The colour of the sung part is the one that follows the accent (the theme's, or the picked one).
const DARK_THEME = { accent: '#2f80ed', text: '#e6edf3', muted: '#8b949e', panel: '#161b22' };
const LYRIC_BASE = DARK_THEME.text;
const LYRIC_DIM = mixHex(DARK_THEME.muted, DARK_THEME.panel, 0.45);
const LYRIC2_BASE = (accent) => mixHex(DARK_THEME.text, accent, 0.45);
const LYRIC2_DIM = mixHex(DARK_THEME.muted, DARK_THEME.panel, 0.6);

export function vocalColors(mode, custom, theme) {
  if (mode === 'classic' || !theme) return CLASSIC_VOCAL;
  const accent = accentOf(mode, custom, theme);
  const light = mixHex(accent, '#ffffff', 0.4);
  return {
    lead: accent,
    leadLit: light,
    harmony: { 1: vividHue(accent, 150), 2: vividHue(accent, 62), 3: vividHue(accent, -62) }, // (the second and third voices sit 62 degrees either side of the lead on the wheel: easy to tell apart)
    lyrics: [LYRIC_BASE, light, LYRIC_DIM],
    lyrics2: [LYRIC2_BASE(accent), mixHex(accent, DARK_THEME.text, 0.25), LYRIC2_DIM],
    present: light,
    frame: accent,
    perc: { glow: accent, ring: mixHex(accent, '#ffffff', 0.7), ball: theme.text, lit: accent },
  };
}
