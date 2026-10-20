// The level of a volume control as an icon: the speaker has no waves when off, one when low, two when normal; a thin bar under the button
// fills with the level (full width = the slider's top, 150%), turns amber above 100%; a muted control is red and struck through (see styles.css
// `.lvl-*`); the solo control (everything else silent) is outlined in the accent colour. One look for the bar's volume button, the mixer rows
// and the tile volume buttons.
export const MAX_LEVEL = 1.5;

// -> { icon, fill (0-100, % of the bar), boost, off }
export function levelState(value, off = false) {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  const silent = off || v === 0;
  return {
    icon: silent ? 'volume-off' : v < 0.5 ? 'volume-low' : 'volume',
    fill: silent ? 0 : Math.min(100, Math.round((v / MAX_LEVEL) * 100)),
    boost: !silent && v > 1,
    off: silent,
  };
}

// `members`: the states that make up the control; `all`: every stem state; `silentOf(st)`: whether one is not audible.
export function isSolo(members, all, silentOf) {
  if (!members.length || members.some(silentOf)) return false;
  const mine = new Set(members);
  const others = all.filter((s) => !mine.has(s));
  return others.length > 0 && others.every(silentOf);
}

// Paints one button. `swapIcon`: the button's own svg is a speaker (not an instrument) and follows the level.
export function paintLevel(btn, { value, off = false, solo = false, swapIcon = false }) {
  const s = levelState(value, off);
  btn.classList.add('lvl');
  btn.classList.toggle('lvl-off', s.off);
  btn.classList.toggle('lvl-boost', s.boost);
  btn.classList.toggle('lvl-solo', solo);
  btn.style.setProperty('--lvl', String(s.fill));
  btn.classList.toggle('lvl-swap', swapIcon);
  if (swapIcon) {
    const use = btn.querySelector('svg use');
    const href = `#i-${s.icon}`;
    if (use && use.getAttribute('href') !== href) use.setAttribute('href', href);
  }
  return s;
}
