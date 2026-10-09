// Drawing constants and helpers shared by the 2D and 3D highway renderers.
export const GUITAR_LANE_COLORS = ['#79d304', '#ff1d23', '#ffe900', '#00bfff', '#ff8400']; // YARG.Core ColorProfile.Defaults.cs
export const KICK_COLOR = '#f2861e';
export const OPEN_COLOR = '#c800ff'; // YARG's open-note purple
export const STAR_POWER_NOTE = '#ffffff'; // YARG draws notes inside a star power phrase in the star power colour
export const HARMONY_COLORS = { 1: '#3fbf9f', 2: '#2fa8a8', 3: '#8fd6c4' }; // harmony parts 1..3, behind the lead
export const KICK_BAR_HALF_H = 6; // pedal bar is 12 px tall at rest
export const DOUBLE_KICK_GAP = 4; // px between the two bars of a double kick
export const TAP_COLOR = '#b25cff';
export const ACCENT_OUTLINE_WIDTH = 4;
export const ACCENT_OUTLINE_DARKEN = 0.55; // multiplier applied to the note colour for the accent outline
export const GHOST_ALPHA = 0.45;
export const ROLL_COLORS = {
  kick: 'rgba(242,134,30,0.14)',
  tremolo: 'rgba(63,191,63,0.14)',
  trill: 'rgba(245,197,24,0.14)',
};
export const FADE_SEC = 0.25; // how long a note takes to fade out after the hit line
export const BASE_LOOKAHEAD_SEC = 2.5; // time from the top edge to the hit line at neck speed 1
export const ENTRY_MARGIN_SEC = 0.3; // extra window above the top edge, so notes are already moving when they enter
export const HIT_Y = 0.94; // hit line position as a fraction of canvas height

// First note that can still be drawn at time t. Heads stay for FADE_SEC after they pass the hit line,
// and a sustain stays until its end, so look back by the longest sustain in the chart.
// Notes must be sorted by time.
export function firstVisibleIndex(notes, t, maxLength) {
  return firstIndexAtOrAfter(notes, t - FADE_SEC - maxLength);
}

export function firstIndexAtOrAfter(notes, time) {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < time) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function tintWhite(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

export function darken(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c * factor);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

export function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// A long note keeps its head on the hit line while it lasts; the exit animation starts when the tail ends.
export const exitTime = (n) => n.time + (n.length || 0);
export const isHeld = (n, t) => n.length > 0 && t >= n.time && t < n.time + n.length;

// Sparks that flow along a held tail toward the hit line: chart times of the dashes visible in [t, until].
// They drift toward the hit line faster than the scroll (DASH_SPEED seconds of chart time per second).
export const DASH_PERIOD_SEC = 0.15;
export const DASH_SPEED = 0.9;
export function* tailDashes(n, t, until) {
  const phase = (t * DASH_SPEED) % DASH_PERIOD_SEC;
  const end = Math.min(n.time + n.length, until);
  const k0 = Math.ceil((t - n.time + phase) / DASH_PERIOD_SEC);
  for (let tau = n.time + k0 * DASH_PERIOD_SEC - phase; tau < end; tau += DASH_PERIOD_SEC) if (tau >= t) yield tau;
}
export const heldPulse = (t) => 1 + 0.06 * Math.sin(t * 22); // the held head breathes a little
