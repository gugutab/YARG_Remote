import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeFade } from '../src/settings-ui.js';
import { paneDotIndex, focusShowing, PANE_DOT_GAP } from '../src/highway.js';
import { packShort, PACK_CODE_BELOW } from '../src/virtuallist.js';
import { packCode } from '../src/songlist.js';
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

// Pane dots: 3 dots on a 390 x 600 canvas sit at x = 171, 195, 219 and y = 572, each with a 24 px hit square (y 560-584).
test('paneDotIndex: 24 px hit areas around each dot', () => {
  assert.equal(PANE_DOT_GAP, 24);
  assert.equal(paneDotIndex(3, 390, 600, 195, 572), 1);
  assert.equal(paneDotIndex(3, 390, 600, 160, 562), 0); // 11 px left, 10 px up of the first dot
  assert.equal(paneDotIndex(3, 390, 600, 230, 583), 2);
  assert.equal(paneDotIndex(3, 390, 600, 195, 559), -1); // above the band
  assert.equal(paneDotIndex(3, 390, 600, 195, 590), -1); // in the seek bar's reach
  assert.equal(paneDotIndex(3, 390, 600, 140, 572), -1); // left of the first
  assert.equal(paneDotIndex(1, 390, 600, 195, 572), -1); // one fretboard: no dots
});

test('focusShowing: the least move that brings a fretboard into view', () => {
  assert.equal(focusShowing(2, 0, 1, 3), 2);
  assert.equal(focusShowing(0, 2, 1, 3), 0);
  assert.equal(focusShowing(1, 0, 2, 3), 0); // already in view
  assert.equal(focusShowing(2, 0, 2, 3), 1);
  assert.equal(focusShowing(0, 1, 2, 3), 0);
});

test('packShort: a narrow card always shows the code; a wide one the name when it fits beside the title', () => {
  assert.equal(PACK_CODE_BELOW, 300);
  assert.equal(packShort(228, 40, 4, 60), true); // phone: short title, the name would fit, still the code
  assert.equal(packShort(332, 120, 4, 100), false); // wide: fits
  assert.equal(packShort(332, 250, 4, 100), true); // wide: long title
});

test('packCode: a one-word name of up to 4 characters is kept', () => {
  assert.equal(packCode('CDLC'), 'CDLC');
  assert.equal(packCode('Rock Band 3 DLC'), 'RB3+');
});
