// The rectangular guitar / drum note as a sprite, drawn from an SVG (the note design: chrome caps that curve in, a lane-coloured body, a dark base in perspective) and rasterised
// once per look (colour + variant) into an offscreen canvas; the highways then draw it with drawImage. Until a sprite is ready the notes use the canvas drawing of gfx.js.
// Variants: plain (strum), white (HOPO, accent: white strips beside the caps), dark (tap, ghost: dark centre between coloured strips), and star power (gold caps, pale body).
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 100" width="440" height="200">
  <defs>
    <path id="cap" d="M39 16 L26 16 C21.5 16 19.6 18 18.6 21.5 L11.8 43 C10.2 48.5 10.1 54 10.8 59.5 L14.9 92 L35.4 92 L35 89 L31.2 60 C30.6 55 30.8 50 31.6 46 L39 16 Z"/>
    <path id="cap-outer" d="M39 16 L26 16 C21.5 16 19.6 18 18.6 21.5 L11.8 43 C10.2 48.5 10.1 54 10.8 59.5 L14.9 92 L35.4 92"/>
    <path id="cap-inner" d="M35.4 92 L35 89 L31.2 60 C30.6 55 30.8 50 31.6 46 L39 16"/>
    <path id="cap-ridge" d="M36 6 L33.6 16 L26.6 45 C25.8 49 25.6 55 26.2 60 L30 89 L31 96"/>
    <clipPath id="clip-cap"><use href="#cap"/></clipPath>
    <clipPath id="clip-body"><use href="#body"/></clipPath>
    <path id="body" d="M36 16 L184 16 L191.4 46 C192.2 50 192.4 55 191.8 60 L188 89 L32 89 L28.2 60 C27.6 55 27.8 50 28.6 46 Z"/>
    <filter id="soft" x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="1.3"/></filter>
    <linearGradient id="g-body" x1="0" y1="16" x2="0" y2="89" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="{{c0}}"/><stop offset="0.12" stop-color="{{c1}}"/><stop offset="0.45" stop-color="{{c2}}"/><stop offset="0.6" stop-color="{{c3}}"/><stop offset="0.92" stop-color="{{c4}}"/><stop offset="1" stop-color="{{c5}}"/>
    </linearGradient>
    <linearGradient id="g-ends" x1="28" y1="0" x2="192" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000" stop-opacity="0.4"/><stop offset="0.1" stop-color="#000" stop-opacity="0"/><stop offset="0.9" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.4"/>
    </linearGradient>
    <linearGradient id="g-cap-v" x1="0" y1="16" x2="0" y2="89" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000" stop-opacity="0.6"/><stop offset="0.38" stop-color="#000" stop-opacity="0"/><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/>
    </linearGradient>
    <radialGradient id="g-spec" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="g-base-top" x1="0" y1="84" x2="0" y2="90.5" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#141414"/><stop offset="1" stop-color="#4a4a4a"/></linearGradient>
    <linearGradient id="g-base-front" x1="0" y1="90.5" x2="0" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3a3a3a"/><stop offset="0.5" stop-color="#1e1e1e"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient>
    <linearGradient id="g-base-ends" x1="14.5" y1="0" x2="205.5" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.06" stop-color="#000" stop-opacity="0"/><stop offset="0.94" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="blur-sm" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="0.8"/></filter>
    <filter id="blur-lg" x="-10%" y="-300%" width="120%" height="700%"><feGaussianBlur stdDeviation="1.8"/></filter>
  </defs>
  <ellipse cx="110" cy="96.5" rx="92.5" ry="2.2" fill="#000" opacity="0.7" filter="url(#blur-lg)"/>
  <path d="M19 84 L201 84 Q203.8 84 204.7 86.5 L205.5 90.5 L14.5 90.5 L15.3 86.5 Q16.2 84 19 84 Z" fill="url(#g-base-top)"/>
  <path d="M19 84 L201 84 Q203.8 84 204.7 86.5 L205.5 90.5 L14.5 90.5 L15.3 86.5 Q16.2 84 19 84 Z" fill="url(#g-base-ends)"/>
  <path d="M18 88.2 L202 88.2" stroke="#000" stroke-width="2.6" stroke-opacity="0.65" stroke-linecap="round" filter="url(#blur-sm)"/>
  <use href="#body" fill="url(#g-body)"/>
  <use href="#body" fill="url(#g-ends)"/>
  {{extra}}
  <g id="capL">
    <g clip-path="url(#clip-cap)">
      <use href="#cap" fill="{{capFill}}"/>
      <g filter="url(#soft)" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <use href="#cap-outer" stroke="{{capDark}}" stroke-width="7"/>
        <use href="#cap-ridge" stroke="{{metal1}}" stroke-width="13"/>
        <use href="#cap-ridge" stroke="{{metal2}}" stroke-width="7"/>
        <use href="#cap-ridge" stroke="{{metal3}}" stroke-width="2.5"/>
        <use href="#cap-inner" stroke="#1a1a1a" stroke-width="1.6"/>
      </g>
      <use href="#cap" fill="url(#g-cap-v)"/>
      <ellipse cx="26.4" cy="51.5" rx="2.6" ry="4.4" fill="url(#g-spec)"/>
    </g>
  </g>
  <use href="#capL" transform="translate(220 0) scale(-1 1)"/>
  <path id="base-front" d="M14.5 90.5 L205.5 90.5 L205.5 92 Q205.5 96 201.5 96 L18.5 96 Q14.5 96 14.5 92 Z" fill="url(#g-base-front)"/>
  <path d="M14.5 90.5 L205.5 90.5 L205.5 92 Q205.5 96 201.5 96 L18.5 96 Q14.5 96 14.5 92 Z" fill="url(#g-base-ends)"/>
</svg>
`;

const SPRITE_W = 440;
const SPRITE_H = 200;
const sprites = new Map(); // key -> canvas, or 'loading'
const listeners = new Set(); // called when a sprite finishes loading (the highway redraws)
export const onNoteSpriteReady = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const parse = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mix = (a, b, t) => {
  const A = parse(a);
  const B = parse(b);
  return `#${A.map((c, i) => Math.round(c + (B[i] - c) * t).toString(16).padStart(2, '0')).join('')}`;
};

const EXTRA = {
  plain: '',
  white: '<g clip-path="url(#clip-body)"><rect x="24" y="14" width="34" height="78" fill="#fff" opacity="0.96"/><rect x="162" y="14" width="34" height="78" fill="#fff" opacity="0.96"/></g>',
  dark: '<g clip-path="url(#clip-body)"><rect x="56" y="14" width="108" height="78" fill="#1b1c1f"/><rect x="56" y="14" width="108" height="30" fill="#fff" opacity="0.07"/></g>',
};

export function noteSpriteSvg(variant, color, sp) {
  const body = sp ? mix(color, '#ffffff', 0.72) : color;
  const stops = sp
    ? [mix(body, '#000000', 0.2), mix(body, '#000000', 0.08), mix(body, '#ffffff', 0.25), body, mix(body, '#000000', 0.08), mix(body, '#000000', 0.22)]
    : [mix(color, '#000000', 0.38), mix(color, '#000000', 0.18), mix(color, '#ffffff', 0.25), color, mix(color, '#000000', 0.16), mix(color, '#000000', 0.4)];
  const metal = sp ? ['#a07800', '#e6c040', '#fff4b0', '#3a2c00', '#2a1e00'] : ['#7a7a7a', '#bdbdbd', '#f4f4f4', '#2a2a2a', '#0e0e0e'];
  let out = SVG;
  stops.forEach((c, i) => { out = out.replace(`{{c${i}}}`, c); });
  ['metal1', 'metal2', 'metal3', 'capFill', 'capDark'].forEach((k, i) => { out = out.replace(`{{${k}}}`, metal[i]); });
  return out.replace('{{extra}}', EXTRA[variant]);
}

export const noteVariant = (n) => (n.tap || n.ghost ? 'dark' : n.hopo || n.accent ? 'white' : 'plain');

function getSprite(n, color) {
  const key = `${noteVariant(n)}|${color}|${n.sp ? 1 : 0}`;
  const hit = sprites.get(key);
  if (hit && hit !== 'loading') return hit;
  if (!hit && typeof Image !== 'undefined' && typeof document !== 'undefined') {
    sprites.set(key, 'loading');
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = SPRITE_W;
      c.height = SPRITE_H;
      c.getContext('2d').drawImage(img, 0, 0, SPRITE_W, SPRITE_H);
      sprites.set(key, c);
      for (const fn of listeners) fn();
    };
    img.onerror = () => sprites.set(key, 'failed');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(noteSpriteSvg(noteVariant(n), color, !!n.sp))}`;
  }
  return null;
}

// Draws the note at (cx, cy) (the middle of its face), `hw` the half width of the note's old outline; `white` (0..1) lightens it (held / leaving notes).
// Returns false while the sprite is not ready (the caller draws the canvas version).
export function drawNoteSprite(g, n, color, cx, cy, hw, white = 0) {
  const sprite = getSprite(n, color);
  if (!sprite) return false;
  const W = hw * 2 * (220 / 198); // the visible width of the design is 198 of the 220 units
  const s = W / 220;
  const x = cx - 110 * s;
  const y = cy - 52.5 * s; // the face's middle is at 52.5 of 100
  g.drawImage(sprite, x, y, W, 100 * s);
  if (white > 0.02) {
    const alpha = g.globalAlpha;
    const filter = g.filter;
    g.globalAlpha = alpha * Math.min(1, white);
    g.filter = 'brightness(3) saturate(0.25)';
    g.drawImage(sprite, x, y, W, 100 * s);
    g.filter = filter;
    g.globalAlpha = alpha;
  }
  return true;
}
