import test from 'node:test';
import assert from 'node:assert/strict';
import { usesVizGl, createVizGl, PORTS } from '../src/visualizers-gl.js';

test('usesVizGl: every visualizer but none is on WebGL, and never with the canvas renderer', () => {
  for (const id of ['rings', 'aurora', 'warp', 'lava', 'kaleido', 'smoke', 'galaxy', 'synthwave', 'equalizer', 'embers', 'radial', 'spotlights', 'tunnel', 'cover']) {
    assert.equal(usesVizGl('auto', id), true, `${id} auto`);
    assert.equal(usesVizGl('webgl', id), true, `${id} webgl`);
    assert.equal(usesVizGl('canvas', id), false, `${id} canvas`);
  }
  for (const id of ['none', 'toString', undefined]) assert.equal(usesVizGl('webgl', id), false, String(id));
  assert.deepEqual(Object.keys(PORTS).sort(), ['aurora', 'cover', 'embers', 'equalizer', 'galaxy', 'kaleido', 'lava', 'radial', 'rings', 'smoke', 'spotlights', 'synthwave', 'tunnel', 'warp']);
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
