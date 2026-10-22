#!/usr/bin/env node
// Converts a simple SVG into code for the canvas 2D context, the way the notes are drawn in this app (no build, no libraries).
//
//   node scripts/svg-to-canvas.mjs <file.svg> [--name cymbal] [--out file.js] [--points] [--steps N]
//
// Default output: a module with `export function drawCymbal(g, x, y, width)`, which draws the SVG centred on (x, y) with the given width (the height follows the
// viewBox). Paths become `new Path2D('...')` with the SVG's own path text (curves and arcs included), ellipses, circles, rects and polygons become the matching
// canvas calls, gradients become createLinearGradient / createRadialGradient with their stops (the SVG's default relative units are converted to absolute ones
// with the shape's bounding box), and fill, stroke, widths, opacities and transforms are applied.
//
// --points: instead emits the shapes as flattened polygons (flat [x, y, x, y, ...] arrays in design units around the viewBox's centre, curves sampled in --steps
// segments, 8 by default), the format of `sampleDesign` in src/gfx.js, for the shapes that need a per-point effect (the perspective taper of the 3D notes) that a
// fixed Path2D cannot give.
//
// Supported: path (M L H V C S Q T A Z, absolute and relative), ellipse, circle, rect (with rx), polygon, polyline, line, g, defs, linearGradient, radialGradient
// (stops, href, userSpaceOnUse / objectBoundingBox), presentation attributes and style="", opacity, fill-opacity, stroke-opacity, fill-rule, transform.
// Not supported (reported as a warning on stderr and skipped): filter, mask, clipPath, text, image, use, pattern, gradientTransform.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- XML (just enough for SVG) ---------------------------------------------------------------------------------------------------------------------------------

export function parseXml(text) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tagRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/)?([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/)?>/g;
  let m;
  while ((m = tagRe.exec(text))) {
    if (!m[2]) continue; // comment, declaration, doctype, cdata
    if (m[1]) { // closing tag
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
    let a;
    while ((a = attrRe.exec(m[3]))) attrs[a[1]] = a[2] ?? a[3] ?? '';
    const node = { tag: m[2].replace(/^svg:/, ''), attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

// ---- numbers ---------------------------------------------------------------------------------------------------------------------------------------------------

const num = (v, fallback = 0) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const frac = (v, fallback) => { // "50%" -> 0.5, "0.5" -> 0.5
  if (v === undefined || v === '') return fallback;
  const s = String(v).trim();
  return s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
};
const r = (n) => String(Math.round(n * 1e4) / 1e4); // short numbers in the output

// ---- path data -------------------------------------------------------------------------------------------------------------------------------------------------

const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// Parses path data into absolute segments: { c: 'M' | 'L' | 'C' | 'Q' | 'A' | 'Z', v: [...] } (H and V become L, S becomes C, T becomes Q; arcs stay as they are).
export function parsePathData(d) {
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  let i = 0;
  let cmd = '';
  let x = 0, y = 0, sx = 0, sy = 0; // current point and the start of the subpath
  let lc = null; // the last control point (for S and T)
  let last = '';
  const read = (n) => { const v = tokens.slice(i, i + n).map(Number); i += n; return v; };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw new Error('path data does not start with a command');
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    if (up === 'Z') { out.push({ c: 'Z', v: [] }); x = sx; y = sy; lc = null; last = 'Z'; continue; }
    const a = read(ARGS[up]);
    if (a.length < ARGS[up] || a.some((v) => Number.isNaN(v))) throw new Error(`bad arguments for ${cmd}`);
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (up === 'M') {
      x = a[0] + ox; y = a[1] + oy; sx = x; sy = y;
      out.push({ c: 'M', v: [x, y] });
      cmd = rel ? 'l' : 'L'; // extra pairs after a moveto are linetos
      lc = null; last = 'M';
    } else if (up === 'L') {
      x = a[0] + ox; y = a[1] + oy; out.push({ c: 'L', v: [x, y] }); lc = null; last = 'L';
    } else if (up === 'H') {
      x = a[0] + ox; out.push({ c: 'L', v: [x, y] }); lc = null; last = 'L';
    } else if (up === 'V') {
      y = a[0] + oy; out.push({ c: 'L', v: [x, y] }); lc = null; last = 'L';
    } else if (up === 'C') {
      const v = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
      out.push({ c: 'C', v }); lc = [v[2], v[3]]; x = v[4]; y = v[5]; last = 'C';
    } else if (up === 'S') {
      const c1 = last === 'C' && lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
      const v = [c1[0], c1[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
      out.push({ c: 'C', v }); lc = [v[2], v[3]]; x = v[4]; y = v[5]; last = 'C';
    } else if (up === 'Q') {
      const v = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
      out.push({ c: 'Q', v }); lc = [v[0], v[1]]; x = v[2]; y = v[3]; last = 'Q';
    } else if (up === 'T') {
      const c1 = last === 'Q' && lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
      const v = [c1[0], c1[1], a[0] + ox, a[1] + oy];
      out.push({ c: 'Q', v }); lc = [v[0], v[1]]; x = v[2]; y = v[3]; last = 'Q';
    } else if (up === 'A') {
      out.push({ c: 'A', v: [a[0], a[1], a[2], a[3], a[4], a[5] + ox, a[6] + oy], from: [x, y] });
      x = a[5] + ox; y = a[6] + oy; lc = null; last = 'A';
    }
  }
  return out;
}

// The center parametrization of an SVG arc (the SVG spec's implementation notes, F.6.5): { cx, cy, rx, ry, phi, t1, dt }, or null for a degenerate arc (a line).
function arcCenter(x1, y1, [rx, ry, rot, large, sweep, x2, y2]) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return null;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rot * Math.PI) / 180;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; } // (radii too small: scaled up until the arc fits)
  const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, t1, dt };
}

// Flattens path data into subpaths of points: [{ pts: [x, y, x, y, ...], closed }]. `steps` is the number of segments per curve.
export function flattenPath(d, steps = 8) {
  const segs = parsePathData(d);
  const subs = [];
  let cur = null;
  let x = 0, y = 0;
  for (const s of segs) {
    if (s.c === 'M') { cur = { pts: [s.v[0], s.v[1]], closed: false }; subs.push(cur); x = s.v[0]; y = s.v[1]; continue; }
    if (!cur) continue;
    if (s.c === 'Z') { cur.closed = true; x = cur.pts[0]; y = cur.pts[1]; cur = { pts: [x, y], closed: false }; subs.push(cur); continue; }
    if (s.c === 'L') { cur.pts.push(s.v[0], s.v[1]); x = s.v[0]; y = s.v[1]; continue; }
    if (s.c === 'C') {
      const [x1, y1, x2, y2, x3, y3] = s.v;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, m = 1 - t;
        cur.pts.push(m * m * m * x + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3, m * m * m * y + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3);
      }
      x = x3; y = y3; continue;
    }
    if (s.c === 'Q') {
      const [x1, y1, x2, y2] = s.v;
      for (let i = 1; i <= steps; i++) { const t = i / steps, m = 1 - t; cur.pts.push(m * m * x + 2 * m * t * x1 + t * t * x2, m * m * y + 2 * m * t * y1 + t * t * y2); }
      x = x2; y = y2; continue;
    }
    if (s.c === 'A') {
      const arc = arcCenter(s.from[0], s.from[1], s.v);
      const [, , , , , x2, y2] = s.v;
      if (!arc) { cur.pts.push(x2, y2); } else {
        const n = Math.max(2, Math.ceil((Math.abs(arc.dt) / (Math.PI / 2)) * steps));
        for (let i = 1; i <= n; i++) {
          const t = arc.t1 + (arc.dt * i) / n;
          const ex = arc.rx * Math.cos(t), ey = arc.ry * Math.sin(t);
          cur.pts.push(Math.cos(arc.phi) * ex - Math.sin(arc.phi) * ey + arc.cx, Math.sin(arc.phi) * ex + Math.cos(arc.phi) * ey + arc.cy);
        }
      }
      x = x2; y = y2;
    }
  }
  return subs.filter((sp) => sp.pts.length >= 4);
}

// ---- shapes ----------------------------------------------------------------------------------------------------------------------------------------------------

const unsupported = new Set(['filter', 'mask', 'clipPath', 'text', 'image', 'use', 'pattern', 'foreignObject', 'style', 'symbol', 'marker']);

// The presentation attributes of a node, with the ones of its ancestors where they inherit, and the style="" declarations over the attributes.
const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit'];
function styleOf(node, parent) {
  const own = { ...node.attrs };
  if (own.style) {
    for (const decl of own.style.split(';')) {
      const k = decl.indexOf(':');
      if (k > 0) own[decl.slice(0, k).trim()] = decl.slice(k + 1).trim();
    }
  }
  const st = {};
  for (const k of INHERITED) st[k] = own[k] ?? parent?.[k];
  st.opacity = num(own.opacity, 1) * (parent?.opacity ?? 1); // (opacity multiplies down the tree, as a simplification of group compositing)
  return st;
}

// The shapes of the SVG in document order: { kind, attrs, style, transform, subs } with `subs` the flattened points (for bounding boxes and for --points).
export function collectShapes(root, steps = 8) {
  const shapes = [];
  const warnings = new Set();
  const gradients = {};
  const walk = (node, parentStyle, parentTransform) => {
    for (const ch of node.children) {
      if (unsupported.has(ch.tag)) { warnings.add(`<${ch.tag}> is not supported and was skipped`); continue; }
      if (ch.tag === 'linearGradient' || ch.tag === 'radialGradient') { gradients[ch.attrs.id] = ch; continue; }
      const style = styleOf(ch, parentStyle);
      const transform = [parentTransform, ch.attrs.transform].filter(Boolean).join(' ');
      if (ch.tag === 'g' || ch.tag === 'svg' || ch.tag === 'defs') { walk(ch, style, transform); continue; }
      const a = ch.attrs;
      let subs = null;
      let kind = ch.tag;
      if (ch.tag === 'path') subs = flattenPath(a.d || '', steps);
      else if (ch.tag === 'ellipse' || ch.tag === 'circle') {
        const rx = ch.tag === 'circle' ? num(a.r) : num(a.rx), ry = ch.tag === 'circle' ? num(a.r) : num(a.ry);
        const cx = num(a.cx), cy = num(a.cy);
        const pts = [];
        for (let i = 0; i < 32; i++) pts.push(cx + rx * Math.cos((i / 32) * Math.PI * 2), cy + ry * Math.sin((i / 32) * Math.PI * 2));
        subs = [{ pts, closed: true }];
      } else if (ch.tag === 'rect') {
        const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
        subs = [{ pts: [x, y, x + w, y, x + w, y + h, x, y + h], closed: true }];
      } else if (ch.tag === 'polygon' || ch.tag === 'polyline') {
        const pts = (a.points || '').trim().split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
        subs = [{ pts, closed: ch.tag === 'polygon' }];
      } else if (ch.tag === 'line') {
        subs = [{ pts: [num(a.x1), num(a.y1), num(a.x2), num(a.y2)], closed: false }];
      } else { warnings.add(`<${ch.tag}> is not supported and was skipped`); continue; }
      shapes.push({ kind, attrs: a, style, transform, subs });
    }
  };
  walk(root, undefined, '');
  return { shapes, gradients, warnings };
}

const bboxOf = (subs) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of subs) for (let i = 0; i < s.pts.length; i += 2) { x0 = Math.min(x0, s.pts[i]); x1 = Math.max(x1, s.pts[i]); y0 = Math.min(y0, s.pts[i + 1]); y1 = Math.max(y1, s.pts[i + 1]); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// ---- code generation -------------------------------------------------------------------------------------------------------------------------------------------

function stopsOf(grad, gradients, seen = new Set()) {
  const own = grad.children.filter((c) => c.tag === 'stop');
  if (own.length) {
    return own.map((s) => {
      const st = { ...s.attrs };
      if (st.style) for (const decl of st.style.split(';')) { const k = decl.indexOf(':'); if (k > 0) st[decl.slice(0, k).trim()] = decl.slice(k + 1).trim(); }
      const op = st['stop-opacity'] !== undefined ? parseFloat(st['stop-opacity']) : 1;
      return [Math.min(1, Math.max(0, frac(st.offset, 0))), withOpacity(st['stop-color'] ?? '#000', op)];
    });
  }
  const href = (grad.attrs.href || grad.attrs['xlink:href'] || '').replace('#', '');
  if (href && gradients[href] && !seen.has(href)) return stopsOf(gradients[href], gradients, new Set([...seen, href]));
  return [];
}
// A colour with an opacity folded in: '#rrggbb' or 'rgb(...)' become an rgba() string; anything else (names, hsl) is kept and the opacity is dropped with a note.
function withOpacity(color, op) {
  if (op >= 1) return color;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${r(op)})`;
  }
  return color;
}
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// A gradient for `shape` as lines of code; the variable is called `name`.
function gradientCode(id, gradients, bbox, name, warnings) {
  const grad = gradients[id];
  if (!grad) { warnings.add(`gradient #${id} not found`); return null; }
  if (grad.attrs.gradientTransform) warnings.add(`gradientTransform on #${id} is not supported and was ignored`);
  const stops = stopsOf(grad, gradients);
  const attr = (k) => grad.attrs[k] ?? (gradients[(grad.attrs.href || grad.attrs['xlink:href'] || '').replace('#', '')]?.attrs[k]);
  const user = attr('gradientUnits') === 'userSpaceOnUse';
  const X = (v, d) => (user ? num(v, d) : bbox.x + frac(v, d) * bbox.w);
  const Y = (v, d) => (user ? num(v, d) : bbox.y + frac(v, d) * bbox.h);
  const S = (v, d) => (user ? num(v, d) : frac(v, d) * Math.max(bbox.w, bbox.h));
  const lines = [];
  if (grad.tag === 'linearGradient') {
    lines.push(`const ${name} = g.createLinearGradient(${r(X(attr('x1'), 0))}, ${r(Y(attr('y1'), 0))}, ${r(X(attr('x2'), 1))}, ${r(Y(attr('y2'), 0))});`);
  } else {
    const cx = X(attr('cx'), 0.5), cy = Y(attr('cy'), 0.5), rad = S(attr('r'), 0.5);
    const fx = attr('fx') === undefined ? cx : X(attr('fx'), 0.5), fy = attr('fy') === undefined ? cy : Y(attr('fy'), 0.5);
    lines.push(`const ${name} = g.createRadialGradient(${r(fx)}, ${r(fy)}, 0, ${r(cx)}, ${r(cy)}, ${r(rad)});`);
  }
  for (const [o, c] of stops) lines.push(`${name}.addColorStop(${r(o)}, ${q(c)});`);
  return lines;
}

// A transform attribute as g.transform(...) calls.
function transformCode(tr) {
  const out = [];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(tr))) {
    const a = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === 'matrix') out.push(`g.transform(${a.map(r).join(', ')});`);
    else if (m[1] === 'translate') out.push(`g.translate(${r(a[0])}, ${r(a[1] ?? 0)});`);
    else if (m[1] === 'scale') out.push(`g.scale(${r(a[0])}, ${r(a[1] ?? a[0])});`);
    else if (m[1] === 'rotate') {
      const rad = ((a[0] || 0) * Math.PI) / 180;
      if (a.length >= 3) out.push(`g.translate(${r(a[1])}, ${r(a[2])});`, `g.rotate(${r(rad)});`, `g.translate(${r(-a[1])}, ${r(-a[2])});`);
      else out.push(`g.rotate(${r(rad)});`);
    } else if (m[1] === 'skewX') out.push(`g.transform(1, 0, ${r(Math.tan((a[0] * Math.PI) / 180))}, 1, 0, 0);`);
    else out.push(`g.transform(1, ${r(Math.tan((a[0] * Math.PI) / 180))}, 0, 1, 0, 0);`);
  }
  return out;
}

function viewBoxOf(svgNode) {
  const vb = (svgNode.attrs.viewBox || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite)) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  return { x: 0, y: 0, w: num(svgNode.attrs.width, 100), h: num(svgNode.attrs.height, 100) };
}
const camel = (s) => s.replace(/(^|[-_ .])(\w)/g, (_, __, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');

// The converter: SVG text -> { code, warnings }.
export function convertSvg(svgText, { name = 'shape', points = false, steps = 8, source = 'input.svg' } = {}) {
  const doc = parseXml(svgText);
  const svg = doc.children.find((c) => c.tag === 'svg');
  if (!svg) throw new Error('no <svg> element found');
  const vb = viewBoxOf(svg);
  const { shapes, gradients, warnings } = collectShapes(svg, steps);
  const cxv = vb.x + vb.w / 2, cyv = vb.y + vb.h / 2;
  const fn = `draw${camel(name)}`;
  const head = `// Generated by scripts/svg-to-canvas.mjs from ${source} (viewBox ${r(vb.x)} ${r(vb.y)} ${r(vb.w)} ${r(vb.h)}).`;
  const L = [head];

  if (points) {
    L.push(`// Flattened shapes in design units around the viewBox's centre: points are [x, y, x, y, ...], \`fill\` and \`stroke\` are as in the SVG (url(#...) for a gradient).`);
    L.push(`export const ${camel(name).replace(/^./, (c) => c.toLowerCase())}Shapes = [`);
    for (const sh of shapes) {
      for (const sp of sh.subs) {
        const pts = sp.pts.map((v, i) => r(v - (i % 2 ? cyv : cxv)));
        L.push(`  { fill: ${q(sh.style.fill ?? '#000')}, stroke: ${q(sh.style.stroke ?? 'none')}, closed: ${sp.closed}, points: [${pts.join(', ')}] },`);
      }
    }
    L.push('];');
    return { code: L.join('\n') + '\n', warnings: [...warnings] };
  }

  L.push(`export const ${fn}Box = { w: ${r(vb.w)}, h: ${r(vb.h)} };`);
  L.push(`// Draws the shape centred on (x, y), \`width\` wide (the height follows the viewBox). It saves and restores the context's state.`);
  L.push(`export function ${fn}(g, x, y, width) {`);
  L.push(`  const k = width / ${r(vb.w)};`);
  L.push(`  g.save();`);
  L.push(`  g.translate(x - ${r(cxv)} * k, y - ${r(cyv)} * k);`);
  L.push(`  g.scale(k, k);`);
  let gi = 0;
  for (const sh of shapes) {
    const st = sh.style;
    const body = [];
    const fillRaw = st.fill === undefined ? '#000000' : st.fill; // (the SVG default is black)
    const strokeRaw = st.stroke ?? 'none';
    const bbox = bboxOf(sh.subs);
    // the shape's path
    let pathLine; // how to fill and stroke it: a path expression
    if (sh.kind === 'path') pathLine = `new Path2D(${q(sh.attrs.d || '')})`;
    else if (sh.kind === 'ellipse' || sh.kind === 'circle') {
      const rx = sh.kind === 'circle' ? num(sh.attrs.r) : num(sh.attrs.rx), ry = sh.kind === 'circle' ? num(sh.attrs.r) : num(sh.attrs.ry);
      body.push(`const p = new Path2D();`, `p.ellipse(${r(num(sh.attrs.cx))}, ${r(num(sh.attrs.cy))}, ${r(rx)}, ${r(ry)}, 0, 0, Math.PI * 2);`);
      pathLine = 'p';
    } else if (sh.kind === 'rect') {
      const rx = num(sh.attrs.rx, num(sh.attrs.ry, 0)), ry = num(sh.attrs.ry, rx);
      body.push(`const p = new Path2D();`);
      body.push(rx || ry ? `p.roundRect(${r(num(sh.attrs.x))}, ${r(num(sh.attrs.y))}, ${r(num(sh.attrs.width))}, ${r(num(sh.attrs.height))}, ${rx === ry ? r(rx) : `[{ x: ${r(rx)}, y: ${r(ry)} }]`});` : `p.rect(${r(num(sh.attrs.x))}, ${r(num(sh.attrs.y))}, ${r(num(sh.attrs.width))}, ${r(num(sh.attrs.height))});`);
      pathLine = 'p';
    } else { // polygon, polyline, line: the points
      const pts = sh.subs[0].pts;
      body.push(`const p = new Path2D();`, `p.moveTo(${r(pts[0])}, ${r(pts[1])});`);
      for (let i = 2; i < pts.length; i += 2) body.push(`p.lineTo(${r(pts[i])}, ${r(pts[i + 1])});`);
      if (sh.kind === 'polygon') body.push(`p.closePath();`);
      pathLine = 'p';
    }
    if (pathLine !== 'p') body.push(`const p = ${pathLine};`);
    const paint = (raw, opacity, prop) => {
      if (raw === 'none' || raw === 'transparent') return null;
      const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)$/.exec(raw);
      if (url) {
        const nm = `gr${gi++}`;
        const lines = gradientCode(url[1], gradients, bbox, nm, warnings);
        if (!lines) return null;
        body.push(...lines);
        return `${prop} = ${nm};`;
      }
      return `${prop} = ${q(withOpacity(raw, opacity))};`;
    };
    const fillLine = paint(fillRaw, 1, 'g.fillStyle');
    const strokeLine = paint(strokeRaw, 1, 'g.strokeStyle');
    const alpha = st.opacity;
    const fo = st['fill-opacity'] !== undefined ? parseFloat(st['fill-opacity']) : 1;
    const so = st['stroke-opacity'] !== undefined ? parseFloat(st['stroke-opacity']) : 1;
    if (fillLine) {
      body.push(fillLine);
      body.push(`g.globalAlpha = ${r(alpha * fo)};`);
      body.push(st['fill-rule'] === 'evenodd' ? `g.fill(p, 'evenodd');` : `g.fill(p);`);
    }
    if (strokeLine) {
      body.push(strokeLine, `g.lineWidth = ${r(num(st['stroke-width'], 1))};`);
      if (st['stroke-linecap']) body.push(`g.lineCap = ${q(st['stroke-linecap'])};`);
      if (st['stroke-linejoin']) body.push(`g.lineJoin = ${q(st['stroke-linejoin'])};`);
      body.push(`g.globalAlpha = ${r(alpha * so)};`, `g.stroke(p);`);
    }
    const tr = sh.transform ? transformCode(sh.transform) : [];
    L.push(`  { // ${sh.kind}${sh.attrs.id ? ' #' + sh.attrs.id : ''}`);
    if (tr.length) L.push(`    g.save();`, ...tr.map((t) => `    ${t}`));
    L.push(...body.map((b) => `    ${b}`));
    if (tr.length) L.push(`    g.restore();`);
    L.push(`  }`);
  }
  L.push(`  g.restore();`);
  L.push(`}`);
  return { code: L.join('\n') + '\n', warnings: [...warnings] };
}

// ---- command line ----------------------------------------------------------------------------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const file = args.find((a, i) => !a.startsWith('--') && !['--name', '--out', '--steps'].includes(args[i - 1]));
  if (!file) {
    console.error('usage: node scripts/svg-to-canvas.mjs <file.svg> [--name cymbal] [--out file.js] [--points] [--steps N]');
    process.exit(1);
  }
  const { code, warnings } = convertSvg(readFileSync(file, 'utf8'), {
    name: val('--name') ?? basename(file).replace(/\.svg$/i, ''),
    points: args.includes('--points'),
    steps: Number(val('--steps') ?? 8),
    source: basename(file),
  });
  for (const w of warnings) console.error(`warning: ${w}`);
  const out = val('--out');
  if (out) writeFileSync(out, code); else process.stdout.write(code);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv);
