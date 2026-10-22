import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertSvg, flattenPath, parsePathData } from '../scripts/svg-to-canvas.mjs';

// A flat cymbal design (a base, a top and a gradient dome whose tip rises above the disc).
const CYMBAL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 148 80" width="296" height="160">
  <defs>
    <linearGradient id="azul" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2fb0f5"/>
      <stop offset="1" stop-color="#1a8fe0"/>
    </linearGradient>
  </defs>
  <!-- base -->
  <ellipse cx="74" cy="52" rx="66" ry="20" fill="#bdbdbd"/>
  <ellipse cx="74" cy="46" rx="63" ry="17" fill="#ededed"/>
  <path d="M22 46 C24 32 48 30 60 25 C67 22 71 18 74 15 C77 18 81 22 88 25 C100 30 124 32 126 46 A52 11 0 0 1 22 46 Z" fill="url(#azul)"/>
</svg>`;

// Runs the generated module's draw function against a context that records its calls.
function run(code, fnName, ...args) {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  class FakeGradient { constructor(kind, a) { this.kind = kind; this.a = a; this.stops = []; } addColorStop(o, c) { this.stops.push([o, c]); } }
  class FakePath2D {
    constructor(d) { this.d = d; this.ops = []; }
    ellipse(...a) { this.ops.push(['ellipse', ...a]); }
    rect(...a) { this.ops.push(['rect', ...a]); }
    roundRect(...a) { this.ops.push(['roundRect', ...a]); }
    moveTo(...a) { this.ops.push(['moveTo', ...a]); }
    lineTo(...a) { this.ops.push(['lineTo', ...a]); }
    closePath() { this.ops.push(['closePath']); }
  }
  const g = {
    save: rec('save'), restore: rec('restore'), translate: rec('translate'), scale: rec('scale'), rotate: rec('rotate'), transform: rec('transform'),
    createLinearGradient: (...a) => new FakeGradient('linear', a), createRadialGradient: (...a) => new FakeGradient('radial', a),
    fill: (p) => calls.push(['fill', p, g.fillStyle, g.globalAlpha]), stroke: (p) => calls.push(['stroke', p, g.strokeStyle, g.lineWidth]),
  };
  const body = code.replace(/export (const|function)/g, '$1');
  const fn = new Function('Path2D', `${body}; return ${fnName};`)(FakePath2D);
  fn(g, ...args);
  return calls;
}

test('svg-to-canvas: the cymbal SVG becomes canvas code with the path text, the ellipses and the gradient in absolute units', () => {
  const { code, warnings } = convertSvg(CYMBAL, { name: 'cymbal', source: 'cymbal.svg' });
  assert.deepEqual(warnings, []);
  assert.match(code, /export function drawCymbal\(g, x, y, width\)/);
  assert.match(code, /new Path2D\('M22 46 C24 32 48 30 60 25/); // the path text is kept (arcs included)
  const calls = run(code, 'drawCymbal', 100, 50, 148);
  // centred on (100, 50) at scale 1: the viewBox's centre (74, 40) goes to the origin
  assert.deepEqual(calls[1], ['translate', 26, 10]);
  assert.deepEqual(calls[2], ['scale', 1, 1]);
  const fills = calls.filter((c) => c[0] === 'fill');
  assert.equal(fills.length, 3);
  assert.deepEqual(fills[0][1].ops[0], ['ellipse', 74, 52, 66, 20, 0, 0, Math.PI * 2]);
  assert.equal(fills[0][2], '#bdbdbd');
  assert.equal(fills[1][2], '#ededed');
  const grad = fills[2][2]; // the dome's gradient: the SVG's 0..1 over the shape's bounding box (y 15 .. 57)
  assert.equal(grad.kind, 'linear');
  assert.ok(Math.abs(grad.a[1] - 15) < 0.5 && Math.abs(grad.a[3] - 57) < 0.5, `gradient y from ${grad.a[1]} to ${grad.a[3]}`);
  assert.deepEqual(grad.stops, [[0, '#2fb0f5'], [1, '#1a8fe0']]);
});

test('svg-to-canvas: width scales the drawing', () => {
  const { code } = convertSvg(CYMBAL, { name: 'cymbal' });
  const calls = run(code, 'drawCymbal', 0, 0, 296);
  assert.deepEqual(calls[2], ['scale', 2, 2]);
});

test('svg-to-canvas: path data, relative commands, shorthand curves and arcs', () => {
  const segs = parsePathData('m10 10 l5 0 h5 v5 c1 1 2 2 3 3 s1 1 2 2 q1 1 2 2 t1 1 z');
  assert.deepEqual(segs.map((s) => s.c), ['M', 'L', 'L', 'L', 'C', 'C', 'Q', 'Q', 'Z']);
  assert.deepEqual(segs[1].v, [15, 10]); // relative lineto
  assert.deepEqual(segs[3].v, [20, 15]); // vertical lineto
  assert.deepEqual(segs[4].v, [21, 16, 22, 17, 23, 18]); // relative cubic
  // the smooth cubic reflects the previous control point: (2*23-22, 2*18-17) = (24, 19)
  assert.deepEqual(segs[5].v.slice(0, 2), [24, 19]);
});

test('svg-to-canvas: an arc is flattened through its middle, on the side the sweep flag says', () => {
  // the dome's base: an arc from (126, 46) to (22, 46) with radii 52 x 11, sweep 1: through the bottom (74, 57)
  const [sub] = flattenPath('M126 46 A52 11 0 0 1 22 46', 8);
  const pts = sub.pts;
  assert.deepEqual(pts.slice(0, 2), [126, 46]);
  assert.ok(Math.abs(pts[pts.length - 2] - 22) < 1e-6 && Math.abs(pts[pts.length - 1] - 46) < 1e-6);
  let bottom = -Infinity;
  for (let i = 1; i < pts.length; i += 2) bottom = Math.max(bottom, pts[i]);
  assert.ok(Math.abs(bottom - 57) < 0.3, `lowest point ${bottom}`); // (the sweep flag 0 would go over the top, to 35)
  const [up] = flattenPath('M126 46 A52 11 0 0 0 22 46', 8);
  assert.ok(Math.min(...up.pts.filter((_, i) => i % 2)) < 36);
});

test('svg-to-canvas: --points emits flattened polygons around the viewBox centre', () => {
  const { code } = convertSvg(CYMBAL, { name: 'cymbal', points: true });
  assert.match(code, /export const cymbalShapes = \[/);
  const shapes = new Function(`${code.replace('export const', 'const')}; return cymbalShapes;`)();
  assert.equal(shapes.length, 3);
  assert.equal(shapes[2].fill, 'url(#azul)');
  const dome = shapes[2].points;
  // the dome's tip (74, 15) is (0, -25) from the centre (74, 40)
  let top = Infinity;
  for (let i = 1; i < dome.length; i += 2) top = Math.min(top, dome[i]);
  assert.equal(top, -25);
});

test('svg-to-canvas: groups pass their fill down, transforms become canvas calls, unsupported elements are reported', () => {
  const svg = `<svg viewBox="0 0 10 10"><g fill="red" opacity="0.5" transform="translate(2 3) scale(2)"><rect x="0" y="0" width="4" height="4" rx="1"/></g><filter id="f"/><circle cx="5" cy="5" r="2" fill="none" stroke="#fff" stroke-width="0.5"/></svg>`;
  const { code, warnings } = convertSvg(svg, { name: 'x' });
  assert.deepEqual(warnings, ['<filter> is not supported and was skipped']);
  const calls = run(code, 'drawX', 5, 5, 10);
  const fill = calls.find((c) => c[0] === 'fill');
  assert.equal(fill[2], 'red');
  assert.equal(fill[3], 0.5);
  assert.deepEqual(calls.filter((c) => c[0] === 'translate').map((c) => c.slice(1)), [[0, 0], [2, 3]]);
  assert.deepEqual(fill[1].ops[0], ['roundRect', 0, 0, 4, 4, 1]);
  const stroke = calls.find((c) => c[0] === 'stroke');
  assert.equal(stroke[2], '#fff');
  assert.equal(stroke[3], 0.5);
});

test('svg-to-canvas: a radial gradient and stop opacity', () => {
  const svg = `<svg viewBox="0 0 100 100"><defs><radialGradient id="r" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="100%" stop-color="#000"/></radialGradient></defs><circle cx="50" cy="50" r="40" fill="url(#r)"/></svg>`;
  const { code } = convertSvg(svg, { name: 'x' });
  const fill = run(code, 'drawX', 0, 0, 100).find((c) => c[0] === 'fill');
  const gr = fill[2];
  assert.equal(gr.kind, 'radial');
  assert.deepEqual(gr.a, [50, 50, 0, 50, 50, 40]); // r = 50 percent of the 80 x 80 box
  assert.deepEqual(gr.stops, [[0, 'rgba(255,255,255,0.5)'], [1, '#000']]);
});
