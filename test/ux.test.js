import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeFade } from '../src/settings-ui.js';
import { PRESETS, accentTrack, readableOn, contrast, mix } from '../src/themes.js';

test('edgeFade: no fade when the strip fits', () => {
  assert.deepEqual(edgeFade(0, 390, 390), { start: false, end: false });
  assert.deepEqual(edgeFade(0, 390, 390.6), { start: false, end: false }); // fractional slack
});

test('edgeFade: fades the end at the start, both in the middle, the start at the end', () => {
  assert.deepEqual(edgeFade(0, 390, 900), { start: false, end: true });
  assert.deepEqual(edgeFade(200, 390, 900), { start: true, end: true });
  assert.deepEqual(edgeFade(510, 390, 900), { start: true, end: false });
});

// The start screen's Play button while it loads: --accent-text on the fill (--si-fill = the accent 88 % with black) and on the unfilled track.
test('accentTrack: the loading label passes WCAG AA on both parts of the Play button in every preset', () => {
  for (const p of PRESETS) {
    const a = p.vars.accent;
    const text = readableOn(a);
    const fill = mix(a, '#000000', 0.12);
    assert.ok(contrast(text, accentTrack(a)) >= 4.5, `${p.id}: track`);
    assert.ok(contrast(text, fill) >= 3, `${p.id}: fill (19 px bold = large text)`);
  }
});
