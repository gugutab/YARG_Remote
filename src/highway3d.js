// 3D view of the note highway: a perspective projection drawn on the same 2D canvas (no WebGL, no libraries),
// so it stays light enough for phones. Only the lane instruments (guitar, bass, keys, drums) have a highway;
// vocals keep the flat view. Like the 2D view, drawing is a pure function of the playback time.
import {
  GUITAR_LANE_COLORS, KICK_COLOR, OPEN_COLOR, KICK_BAR_HALF_H, DOUBLE_KICK_GAP, TAP_COLOR, ACCENT_OUTLINE_WIDTH,
  ACCENT_OUTLINE_DARKEN, GHOST_ALPHA, ROLL_COLORS, FADE_SEC, firstVisibleIndex, tintWhite, darken, withAlpha,
} from './gfx.js';

const DEPTH_SEC = 3.2; // seconds between the hit line and the far edge at neck speed 1 (the flat view shows 2.5)
const FAR_SCALE = 0.3; // size of things at the far edge relative to the hit line
const FAR_TOP = 0.05; // far edge position, as a fraction of the canvas height
const HIT_Y3 = 0.84; // hit line position, as a fraction of the canvas height
const HEAD_R = 0.36; // note head radius, in lane widths
const HEAD_TILT = 0.55; // vertical squash of the heads (they lie on the road)
const FADE_IN = 0.14; // fraction of the depth over which notes fade in at the far edge
const HIT_FLASH_SEC = 0.14;

export function renderLanes3D(hw, t, w, h) {
  const g = hw.g;
  const chart = hw.chart;
  const lanes = chart.lanes;
  const portrait = h > w;
  const roadW = portrait ? w * 0.94 : Math.min(w * 0.62, h * 1.05); // road width at the hit line
  const laneW = roadW / lanes;
  const cx = w / 2;
  const hitY = h * HIT_Y3;
  const windowSec = DEPTH_SEC / hw.neck; // neck speed shortens or stretches the visible time
  const k = 1 / FAR_SCALE - 1;
  const scaleAt = (d) => 1 / (1 + k * d); // perspective scale at depth d (0 = hit line, 1 = far edge)
  const vy = (h * FAR_TOP - FAR_SCALE * hitY) / (1 - FAR_SCALE); // vanishing point, above the canvas
  const yAt = (d) => vy + (hitY - vy) * scaleAt(d);
  const xAt = (lx, d) => cx + lx * laneW * scaleAt(d); // lx = lane units from the road's centre
  const depth = (time) => Math.min(1, Math.max(0, (time - t) / windowSec));
  const half = lanes / 2;
  const unit = laneW / 90; // the flat view is tuned for 90 px lanes; keep thicknesses in proportion

  const quad = (d0, d1, lx0, lx1) => {
    g.beginPath();
    g.moveTo(xAt(lx0, d0), yAt(d0));
    g.lineTo(xAt(lx1, d0), yAt(d0));
    g.lineTo(xAt(lx1, d1), yAt(d1));
    g.lineTo(xAt(lx0, d1), yAt(d1));
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
  quad(0, 1, -half, half);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.045)';
  for (let i = 0; i < lanes; i += 2) {
    quad(0, 1, i - half, i + 1 - half);
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
    g.moveTo(xAt(i - half, 0), yAt(0));
    g.lineTo(xAt(i - half, 1), yAt(1));
  }
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.beginPath();
  for (const side of [-half, half]) {
    g.moveTo(xAt(side, 0), yAt(0));
    g.lineTo(xAt(side, 1), yAt(1));
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
  for (const n of visible) {
    const past = t - n.time;
    if (past >= 0 && past < HIT_FLASH_SEC && n.lane >= 0) flash[n.lane] = Math.max(flash[n.lane], 1 - past / HIT_FLASH_SEC);
  }
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.fillRect(xAt(-half, 0) - 6, hitY - 1.5, roadW + 12, 3);
  const padRx = laneW * HEAD_R;
  for (let i = 0; i < lanes; i++) {
    const x = cx + (i + 0.5 - half) * laneW;
    g.beginPath();
    g.ellipse(x, hitY, padRx * 1.05, padRx * 1.05 * HEAD_TILT, 0, 0, Math.PI * 2);
    g.fillStyle = withAlpha(colors[i], 0.14 + 0.5 * flash[i]);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = withAlpha(colors[i], 0.55 + 0.45 * flash[i]);
    g.stroke();
  }

  // pedal and open bars sit behind the heads; far ones first
  for (let i = visible.length - 1; i >= 0; i--) {
    const n = visible[i];
    if (n.lane >= 0 && !n.open) continue;
    const past = t - n.time;
    if (past > FADE_SEC) continue;
    const kx = Math.max(0, past) / FADE_SEC;
    const d = depth(n.time);
    const p = scaleAt(d);
    const hh = KICK_BAR_HALF_H * unit * (1 + 0.4 * kx) * p;
    g.globalAlpha = (1 - kx) * Math.min(1, (1 - d) / FADE_IN);
    g.fillStyle = tintWhite(n.open ? OPEN_COLOR : KICK_COLOR, kx);
    const gap = DOUBLE_KICK_GAP * unit * p;
    for (const dy of n.doubleKick ? [0, -(2 * hh + gap)] : [0]) {
      g.fillRect(xAt(-half, d), yAt(d) + dy - hh, roadW * p, hh * 2);
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
    } else {
      g.fillStyle = withAlpha(colors[n.lane], 0.6);
      const mid = n.lane + 0.5 - half;
      quad(dBot, dTop, mid - HEAD_R * 0.38, mid + HEAD_R * 0.38);
    }
    g.fill();
  }

  // heads, far to near so closer ones cover farther ones
  for (let i = visible.length - 1; i >= 0; i--) {
    const n = visible[i];
    if (n.lane < 0 || n.open) continue;
    const past = t - n.time;
    if (past > FADE_SEC) continue;
    const kx = Math.max(0, past) / FADE_SEC;
    const d = depth(n.time);
    const p = scaleAt(d);
    const x = xAt(n.lane + 0.5 - half, d);
    const y = yAt(d);
    const rx = laneW * HEAD_R * p * (1 + 0.4 * kx);
    const ry = rx * HEAD_TILT;
    const body = tintWhite(n.tap ? TAP_COLOR : colors[n.lane], kx);
    g.globalAlpha = (1 - kx) * (n.ghost ? GHOST_ALPHA : 1) * Math.min(1, (1 - d) / FADE_IN);
    // thickness: a darker disc underneath, then the top face
    const th = rx * 0.28;
    g.beginPath();
    g.ellipse(x, y + th, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = darken(n.tap ? TAP_COLOR : colors[n.lane], 0.55);
    g.fill();
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = body;
    g.fill();
    g.lineWidth = n.accent ? ACCENT_OUTLINE_WIDTH * p : Math.max(1, 1.5 * p);
    g.strokeStyle = n.accent ? darken(colors[n.lane], ACCENT_OUTLINE_DARKEN) : 'rgba(0,0,0,0.5)';
    g.stroke();
    if (n.hopo) {
      g.beginPath();
      g.ellipse(x, y, rx * 0.35, ry * 0.35, 0, 0, Math.PI * 2);
      g.fillStyle = `rgba(255,255,255,${0.9 * (1 - kx)})`;
      g.fill();
    }
    if (n.cymbal) { // cymbal = ring with a white outline over a dark centre; tom = solid pad
      g.beginPath();
      g.ellipse(x, y, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
      g.fillStyle = '#0d1117';
      g.fill();
      g.lineWidth = Math.max(1.5, 3 * p);
      g.strokeStyle = '#ffffff';
      g.stroke();
    }
  }
  g.globalAlpha = 1;

  // far edge fades into the background
  const grad = g.createLinearGradient(0, 0, 0, h * 0.3);
  grad.addColorStop(0, 'rgba(13,17,23,1)');
  grad.addColorStop(1, 'rgba(13,17,23,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h * 0.3);
}
