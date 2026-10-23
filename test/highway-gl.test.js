import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glUnsupported } from '../src/highway-gl.js';
import { lookahead3D } from '../src/highway3d.js';

// The settings the board can draw: the 3D view with rectangular notes, the burst animation and the flow tails (the defaults).
const hw = (over = {}) => ({ view: '3d', noteStyle: 'rect', hitAnimation: 'burst', tailStyle: 'flow', loopEnd: null, replayWindow: null, ...over });

test('glUnsupported: the default look is drawn by the board', () => {
  assert.equal(glUnsupported(hw(), { mode: 'lanes' }), null);
});

test('glUnsupported: every setting the board does not draw sends the pane to the 2D code', () => {
  assert.equal(glUnsupported(hw(), { mode: 'vocals' }), 'mode');
  assert.equal(glUnsupported(hw({ view: '2d' }), { mode: 'lanes' }), 'view');
  assert.equal(glUnsupported(hw({ noteStyle: 'circle' }), { mode: 'lanes' }), 'noteStyle');
  assert.equal(glUnsupported(hw({ hitAnimation: 'classic' }), { mode: 'lanes' }), 'hitAnimation');
  assert.equal(glUnsupported(hw({ tailStyle: 'classic' }), { mode: 'lanes' }), 'tailStyle');
  assert.equal(glUnsupported(hw({ loopEnd: 30 }), { mode: 'lanes' }), 'loop'); // (the loop and replay dimming is drawn per note by the 2D code)
  assert.equal(glUnsupported(hw({ replayWindow: { from: 1, to: 2 } }), { mode: 'lanes' }), null); // (the replayed stretch is left out of the chart instead, Highway.viewChart)
});

test('lookahead3D: neck speed shortens the window and a taller pane shows more of it', () => {
  assert.ok(lookahead3D(2, 700) < lookahead3D(1, 700));
  assert.ok(lookahead3D(1, 1400) > lookahead3D(1, 700));
});
