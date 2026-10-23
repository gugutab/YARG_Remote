import test from 'node:test';
import assert from 'node:assert/strict';
import { usesVizGl, createVizGl, PORTS } from '../src/visualizers-gl.js';

test('usesVizGl: only the ported and the WebGL-only visualizers, and never with the canvas renderer', () => {
  for (const id of ['rings', 'aurora', 'warp', 'lava', 'kaleido', 'smoke', 'galaxy']) {
    assert.equal(usesVizGl('auto', id), true, `${id} auto`);
    assert.equal(usesVizGl('webgl', id), true, `${id} webgl`);
    assert.equal(usesVizGl('canvas', id), false, `${id} canvas`);
  }
  for (const id of ['none', 'cover', 'synthwave', 'equalizer', 'embers', 'radial', 'spotlights', 'tunnel', 'toString', undefined]) assert.equal(usesVizGl('webgl', id), false, String(id));
  assert.deepEqual(Object.keys(PORTS).sort(), ['aurora', 'galaxy', 'kaleido', 'lava', 'rings', 'smoke', 'warp']);
});

test('createVizGl: without WebGL 2 it never wants the visualizer (the 2D path stays)', () => {
  const canvas = { getContext: () => null, addEventListener() {} };
  const layer = createVizGl({ canvas, driver: { id: 'rings' } });
  assert.equal(layer.wants('webgl'), false);
  assert.equal(layer.wants('auto'), false);
  assert.equal(layer.draw(100, 100, 0, '0, 0, 0'), false);
});

test('createVizGl: a lost context hands the background back to the 2D code for good', () => {
  const listeners = {};
  const gl = {};
  const canvas = { getContext: () => gl, addEventListener: (n, f) => { listeners[n] = f; } };
  const layer = createVizGl({ canvas, driver: { id: 'aurora' } });
  assert.equal(layer.wants('auto'), true);
  assert.equal(layer.wants('canvas'), false);
  listeners.webglcontextlost({ preventDefault() {} });
  assert.equal(layer.wants('auto'), false);
});
