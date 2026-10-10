// 3D view of the note highway: a perspective projection drawn on the same 2D canvas (no WebGL, no libraries),
// so it stays light enough for phones. Only the lane instruments (guitar, bass, keys, drums) have a highway;
// vocals keep the flat view. Like the 2D view, drawing is a pure function of the playback time.
import {
  GUITAR_LANE_COLORS, KICK_COLOR, OPEN_COLOR, TAP_COLOR, ACCENT_OUTLINE_WIDTH,
  ACCENT_OUTLINE_DARKEN, GHOST_ALPHA, exitTime, heldAmount, fillHalo, haloProfile, tailShimmer, HIT_FLASH_SEC, BAR_FLASH_SEC, PAD_FILL_ALPHA, PAD_RING_ALPHA, noteShape, heldPulse, ROLL_COLORS, FADE_SEC, firstVisibleIndex, tintWhite, darken, withAlpha, noteScale, noteColor,
} from './gfx.js';

const DEPTH_SEC = 3.2; // seconds between the hit line and the far edge at neck speed 1 (the flat view shows 2.5)
const FAR_SCALE = 0.3; // size of things at the far edge relative to the hit line
const FAR_TOP = 0.05; // far edge position, as a fraction of the canvas height
const HEAD_R = 0.36; // note head radius, in lane widths
const HEAD_TILT = 0.55; // vertical squash of the heads (they lie on the road)
const FADE_IN = 0.14; // fraction of the depth over which notes fade in at the far edge
const TAIL_TAPER_POWER = 3; // like the heads' TAPER_GAIN: about 3x the natural perspective change
const TAIL_MIN_WIDTH = 0.3; // a tail never gets thinner than this fraction of its base width
const ROAD_NEAR = -0.14; // the road starts below the canvas (past the pads), so it can fade out at the bottom
const ROAD_END = 1.8; // the road runs well past the last visible note, so it has no visible far edge: the fade hides the rest
const BAR_DEPTH = 0.0087; // one third of the earlier 0.026 // pedal/open bar thickness along the road, in depth units (it lies flat on the fretboard)
const GLOW_DEPTH = 0.009; // half-height of the hit glow (it was 0.026 and looked too tall)
const easeOut = (x) => 1 - (1 - x) ** 3;

export function renderLanes3D(hw, t, w, h) {
  const g = hw.g;
  const chart = hw.chart;
  const lanes = chart.lanes;
  const portrait = h > w;
  const roadW = portrait ? w * 0.94 : Math.min(w * 0.62, h * 1.05); // road width at the hit line
  const laneW = roadW / lanes;
  const padRy = laneW * HEAD_R * 1.05 * HEAD_TILT; // vertical radius of the hit pads
  const hitY = h - (padRy + 26); // hit line (the pads): the 26 px below them hold the bottom fade
  const cx = w / 2;
  const windowSec = DEPTH_SEC / hw.neck; // neck speed shortens or stretches the visible time
  const k = 1 / FAR_SCALE - 1;
  const scaleAt = (d) => 1 / (1 + k * d); // perspective scale at depth d (0 = hit line, 1 = far edge)
  const vy = (h * FAR_TOP - FAR_SCALE * hitY) / (1 - FAR_SCALE); // vanishing point, above the canvas
  const yAt = (d) => vy + (hitY - vy) * scaleAt(d);
  const xAt = (lx, d) => cx + lx * laneW * scaleAt(d); // lx = lane units from the road's centre
  const depth = (time) => Math.min(1, Math.max(0, (time - t) / windowSec));
  const half = lanes / 2;

  const quad = (d0, d1, lx0, lx1) => {
    g.beginPath();
    g.moveTo(xAt(lx0, d0), yAt(d0));
    g.lineTo(xAt(lx1, d0), yAt(d0));
    g.lineTo(xAt(lx1, d1), yAt(d1));
    g.lineTo(xAt(lx0, d1), yAt(d1));
    g.closePath();
  };
  // A tail strip with the same extra perspective taper the note heads get (see noteShape): relative to the strip's base
  // (dRef, where the head is), its width shrinks with (scale / baseScale) ^ TAIL_TAPER_POWER, never below TAIL_MIN_WIDTH.
  const tailFactor = (d, dRef) => TAIL_MIN_WIDTH + (1 - TAIL_MIN_WIDTH) * (scaleAt(d) / scaleAt(dRef)) ** TAIL_TAPER_POWER;
  const taperedStrip = (d0, d1, mid, wl, dRef) => {
    const N = 20;
    const right = [];
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const d = d0 + ((d1 - d0) * i) / N;
      const hw = wl * tailFactor(d, dRef);
      if (i === 0) g.moveTo(xAt(mid - hw, d), yAt(d));
      else g.lineTo(xAt(mid - hw, d), yAt(d));
      right.push([xAt(mid + hw, d), yAt(d)]);
    }
    for (let i = N; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath();
  };
  const span = (spans, color) => {
    g.fillStyle = color;
    for (const s of spans || []) {
      if (s.end < t || s.start > t + windowSec) continue;
      quad(depth(s.start), depth(s.end), -half, half);
      g.fill();
    }
  };

  // road
  g.fillStyle = 'rgba(255,255,255,0.045)';
  quad(ROAD_NEAR, ROAD_END, -half, half);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.045)';
  for (let i = 0; i < lanes; i += 2) {
    quad(ROAD_NEAR, ROAD_END, i - half, i + 1 - half);
    g.fill();
  }
  span(chart.starPower, 'rgba(60,160,255,0.16)');
  span(chart.solos, 'rgba(255,190,60,0.13)');
  for (const [type, color] of Object.entries(ROLL_COLORS)) span((chart.rolls || []).filter((r) => r.type === type), color);

  // lane dividers and rails
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.beginPath();
  for (let i = 1; i < lanes; i++) {
    g.moveTo(xAt(i - half, ROAD_NEAR), yAt(ROAD_NEAR));
    g.lineTo(xAt(i - half, ROAD_END), yAt(ROAD_END));
  }
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.beginPath();
  for (const side of [-half, half]) {
    g.moveTo(xAt(side, ROAD_NEAR), yAt(ROAD_NEAR));
    g.lineTo(xAt(side, ROAD_END), yAt(ROAD_END));
  }
  g.stroke();

  // beat and measure lines
  for (const b of chart.beats) {
    if (b.time < t || b.time > t + windowSec) continue;
    const d = depth(b.time);
    const p = scaleAt(d);
    g.fillStyle = b.measure ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.14)';
    g.fillRect(xAt(-half, d), yAt(d) - (b.measure ? 1.5 : 0.5) * p, roadW * p, (b.measure ? 3 : 1) * p);
  }

  // notes that can still be seen
  const from = firstVisibleIndex(chart.notes, t, hw.maxLength);
  const visible = [];
  for (let i = from; i < chart.notes.length && chart.notes[i].time <= t + windowSec; i++) visible.push(chart.notes[i]);
  const colors = chart.laneColors || GUITAR_LANE_COLORS;

  // hit zone: a bar across the road and one pad per lane, lit while a note is being hit
  const flash = new Array(lanes).fill(0);
  let barFlash = 0; // a pedal or open hit lights the whole zone
  for (const n of visible) {
    const past = t - n.time;
    if (past < 0) continue;
    if (n.lane >= 0 && !n.open) flash[n.lane] = Math.max(flash[n.lane], heldAmount(n, t) * (0.75 + 0.15 * Math.sin(t * 22)));
    if (n.lane >= 0 && !n.open) {
      if (past < HIT_FLASH_SEC) flash[n.lane] = Math.max(flash[n.lane], 1 - past / HIT_FLASH_SEC);
    } else if (past < BAR_FLASH_SEC && 1 - past / BAR_FLASH_SEC > barFlash) {
      barFlash = 1 - past / BAR_FLASH_SEC;
    }
  }
  // (there is no hit line: the pads mark the spot; a pedal hit lights every pad)
  const padRx = laneW * HEAD_R;
  for (let i = 0; i < lanes; i++) {
    const x = cx + (i + 0.5 - half) * laneW;
    g.beginPath();
    noteShape(g, x, hitY, padRx * 1.05, padRx * 1.05 * HEAD_TILT, chart.laneKinds?.[i] === 'cymbal' ? 'tri' : hw.noteStyle, hitY - vy);
    g.fillStyle = withAlpha(colors[i], Math.min(0.9, PAD_FILL_ALPHA + 0.5 * flash[i] + 0.35 * barFlash));
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = withAlpha(colors[i], Math.min(1, PAD_RING_ALPHA + (1 - PAD_RING_ALPHA) * Math.max(flash[i], barFlash)));
    g.stroke();
  }

  // Pedal and open bars lie flat on the road (a quad with real depth, not a screen-space strip) and sit behind
  // the heads; far ones first. Hit animation (FADE_SEC): white flash, a glow that spreads over the road and the
  // rails, and a bar that thins out as it fades.
  for (let i = visible.length - 1; i >= 0; i--) {
    const n = visible[i];
    if (n.lane >= 0 && !n.open) continue;
    const past = t - exitTime(n);
    if (past > FADE_SEC) continue;
    const kx = Math.max(0, past) / FADE_SEC;
    const e = easeOut(kx);
    const d = depth(n.time);
    const base = n.open ? OPEN_COLOR : KICK_COLOR;
    const far = Math.min(1, (1 - d) / FADE_IN);
    const alpha = far * (1 - e * e); // stays solid for a moment, then drops
    const thick = BAR_DEPTH * (1 - 0.55 * e); // the bar thins as it is "consumed"
    const white = past > 0 ? 0.85 * (1 - Math.min(1, kx * 3)) : 0; // quick white flash at the moment of the hit, not before
    const bars = n.doubleKick ? [0, BAR_DEPTH * 1.3] : [0];
    if (kx > 0) { // glow: a wider, taller, translucent copy that spreads past the rails
      g.globalAlpha = 0.55 * (1 - kx) * (1 - kx) * far;
      g.globalCompositeOperation = 'lighter'; // additive, so the glow lights the road instead of greying it
      g.fillStyle = base;
      quad(d - GLOW_DEPTH * (0.6 + 1.6 * e), d + GLOW_DEPTH * (0.6 + 1.6 * e), -half - 0.12 * e, half + 0.12 * e);
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    for (const off of bars) {
      const d0 = d + off - thick / 2;
      const d1 = d + off + thick / 2;
      g.globalAlpha = alpha;
      g.fillStyle = tintWhite(base, white);
      quad(d0, d1, -half, half);
      g.fill();
      // lit far edge and darker near edge give the bar some body
      g.lineWidth = Math.max(1, 2 * scaleAt(d1));
      g.strokeStyle = tintWhite(base, 0.65);
      g.beginPath();
      g.moveTo(xAt(-half, d1), yAt(d1));
      g.lineTo(xAt(half, d1), yAt(d1));
      g.stroke();
      g.strokeStyle = darken(base, 0.6);
      g.beginPath();
      g.moveTo(xAt(-half, d0), yAt(d0));
      g.lineTo(xAt(half, d0), yAt(d0));
      g.stroke();
    }
  }
  g.globalAlpha = 1;

  // sustains
  for (const n of visible) {
    if (!n.length || n.lane < 0) continue;
    const dTop = depth(n.time + n.length);
    const dBot = depth(Math.max(n.time, t));
    if (dTop <= dBot) continue;
    if (n.open) {
      g.fillStyle = withAlpha(OPEN_COLOR, 0.3);
      quad(dBot, dTop, -half, half);
      g.fill();
    } else {
      // held (active): the whole tail is lighter, more opaque and slowly brightens and dims (no extra shapes)
      const amt = heldAmount(n, t); // fades in after the hit
      g.fillStyle = withAlpha(noteColor(n, colors), 0.6 + 0.25 * amt);
      const mid = n.lane + 0.5 - half;
      const hr = HEAD_R * noteScale(n); // HOPO notes are smaller
      taperedStrip(dBot, dTop, mid, hr * 0.38, dBot);
      g.fill();
      if (amt > 0) {
        g.fillStyle = `rgba(255,255,255,${amt * (0.3 + 0.12 * tailShimmer(t))})`;
        taperedStrip(dBot, dTop, mid, hr * 0.38, dBot);
        g.fill();
        // soft halo around the tail while it is played: many wider and wider faint strips, added together, each with a
        // rounded end (a half ellipse beyond the tail's end, only when the end is on screen)
        g.globalCompositeOperation = 'lighter';
        const haloColor = noteColor(n, colors);
        const endVisible = n.time + n.length <= t + windowSec;
        const pEnd = scaleAt(dTop);
        const xEnd = xAt(mid, dTop);
        const yEnd = yAt(dTop);
        for (let i = 1; i <= 12; i++) {
          // each strip adds what the smooth falloff loses between its inner and outer edge, so the sum follows it
          g.fillStyle = withAlpha(haloColor, 0.12 * amt * (haloProfile((i - 1) / 12) - haloProfile(i / 12)));
          const wl = hr * (0.38 + 0.08 * i); // half width in lane units
          taperedStrip(dBot, dTop, mid, wl, dBot);
          g.fill();
          if (endVisible) {
            const rxi = laneW * wl * pEnd * tailFactor(dTop, dBot); // the rounded end follows the tapered width
            g.save();
            g.beginPath();
            g.rect(0, 0, w, yEnd); // only the part beyond the end
            g.clip();
            g.beginPath();
            g.ellipse(xEnd, yEnd, rxi, rxi * HEAD_TILT, 0, 0, Math.PI * 2);
            g.fill();
            g.restore();
          }
        }
        g.globalCompositeOperation = 'source-over';
      }
    }
  }

  // heads, far to near so closer ones cover farther ones
  for (let i = visible.length - 1; i >= 0; i--) {
    const n = visible[i];
    if (n.lane < 0 || n.open) continue;
    const past = t - exitTime(n); // long notes: the exit starts when the tail ends
    if (past > FADE_SEC) continue;
    const kx = Math.max(0, past) / FADE_SEC;
    const d = depth(n.time);
    const p = scaleAt(d);
    const x = xAt(n.lane + 0.5 - half, d);
    const y = yAt(d);
    const amt = heldAmount(n, t);
    const rx = laneW * HEAD_R * noteScale(n) * p * (1 + 0.4 * kx) * (1 + (heldPulse(t) - 1) * amt);
    const ry = rx * HEAD_TILT;
    if (amt > 0) { // a soft halo while the note is held
      g.globalCompositeOperation = 'lighter';
      g.save();
      g.translate(x, y);
      g.scale(1, HEAD_TILT); // the halo lies on the road: a circle squashed like the head
      fillHalo(g, noteColor(n, colors), rx * 0.7, rx * 1.7, 0.45 * amt); // radial fade-out
      g.restore();
      g.globalCompositeOperation = 'source-over';
    }
    const body = tintWhite(n.sp ? noteColor(n, colors) : n.tap ? TAP_COLOR : colors[n.lane], Math.min(1, kx + amt * (0.32 + 0.12 * tailShimmer(t)))); // an active long note's head is lighter, like its tail
    g.globalAlpha = (1 - kx) * (n.ghost ? GHOST_ALPHA : 1) * Math.min(1, (1 - d) / FADE_IN);
    // thickness: a darker disc underneath, then the top face. A soft shadow cast on the road goes under both; all of it
    // moves, grows and fades with the note (same position, size and alpha), also through the exit animation.
    const th = Math.max(0.5, rx * 0.36 - 4 * p); // 4 px less than before (at the nearest row; it shrinks with the perspective)
    const headStyle = n.cymbal ? 'tri' : hw.noteStyle; // cymbals: rounded triangle (and no ring)
    g.save();
    g.translate(x, y + th * 1.7);
    g.scale(1, HEAD_TILT * 0.95);
    fillHalo(g, '#000000', rx * 0.5, rx * 1.55, 0.5);
    g.restore();
    g.beginPath();
    noteShape(g, x, y + th, rx, ry, headStyle, y + th - vy);
    g.fillStyle = darken(n.sp ? noteColor(n, colors) : n.tap ? TAP_COLOR : colors[n.lane], 0.45);
    g.fill();
    g.beginPath();
    noteShape(g, x, y, rx, ry, headStyle, y - vy);
    g.fillStyle = body;
    g.fill();
    g.lineWidth = n.accent ? ACCENT_OUTLINE_WIDTH * p : Math.max(1, (n.sp ? 3 : 1.5) * p);
    g.strokeStyle = n.accent ? darken(colors[n.lane], ACCENT_OUTLINE_DARKEN) : n.sp ? colors[n.lane] : 'rgba(0,0,0,0.5)';
    g.stroke();
    if (n.hopo) {
      g.beginPath();
      noteShape(g, x, y, rx * 0.35, ry * 0.35, hw.noteStyle, y - vy);
      g.fillStyle = `rgba(255,255,255,${0.9 * (1 - kx)})`;
      g.fill();
    }
  }
  g.globalAlpha = 1;

  // a very short fade at the bottom: the board dissolves right below the pads
  const padBottom = hitY + padRy;
  if (h - padBottom > 2) {
    const bf = g.createLinearGradient(0, padBottom, 0, h);
    for (const [at, a] of [[0, 0], [0.3, 0.2], [0.6, 0.6], [0.85, 0.92], [1, 1]]) bf.addColorStop(at, `rgba(13,17,23,${a})`);
    g.fillStyle = bf;
    g.fillRect(0, padBottom, w, h - padBottom);
  }

  // far edge fades into the background
  // (an eased fade, so the board dissolves instead of ending in a visible edge)
  const fadeH = h * 0.42;
  const grad = g.createLinearGradient(0, 0, 0, fadeH);
  for (const [at, a] of [[0, 1], [0.2, 0.95], [0.4, 0.78], [0.6, 0.48], [0.8, 0.18], [0.92, 0.05], [1, 0]]) grad.addColorStop(at, `rgba(13,17,23,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, fadeH);
}
