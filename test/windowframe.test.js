import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentMaxFor, roomFor, clampWidth, centeredLeft, dragWidth, CONTENT_MAX, WIN_MARGIN, WIN_BORDER } from '../src/windowframe.js';

test('contentMaxFor stays between 1400 and 4K', () => {
  assert.equal(contentMaxFor(900), CONTENT_MAX);
  assert.equal(contentMaxFor(2000), 2000);
  assert.equal(contentMaxFor(9000), 3840);
});

test('roomFor: the content area between its margins, minus the border', () => {
  assert.equal(roomFor(1500, 1400), 1400 - WIN_BORDER); // 50 px of air each side
  assert.equal(roomFor(1000, 1400), 1000 - 2 * WIN_MARGIN - WIN_BORDER); // narrower than the content area: only the margins
  assert.equal(roomFor(3000, 3000), 3000 - 2 * WIN_MARGIN - WIN_BORDER);
  assert.equal(roomFor(10, 1400), 0);
});

test('clampWidth: no preference = the whole room; else between the minimum and the room', () => {
  assert.equal(clampWidth(null, 560, 1398), 1398);
  assert.equal(clampWidth(0, 560, 1398), 560);
  assert.equal(clampWidth(900, 560, 1398), 900);
  assert.equal(clampWidth(300, 560, 1398), 560);
  assert.equal(clampWidth(2000, 560, 1398), 1398);
  assert.equal(clampWidth(900, 560, 500), 500); // the room wins over the minimum
});

test('centeredLeft centres and keeps the margin', () => {
  assert.equal(centeredLeft(1500, 1000), 250);
  assert.equal(centeredLeft(800, 790), WIN_MARGIN);
});

test('dragWidth moves both edges: 2*dx, clamped', () => {
  assert.equal(dragWidth(1000, 100, 1, 560, 1398), 1200); // right edge out
  assert.equal(dragWidth(1000, -100, 1, 560, 1398), 800); // right edge in
  assert.equal(dragWidth(1000, 100, -1, 560, 1398), 800); // left edge dragged right = narrower
  assert.equal(dragWidth(1000, -100, -1, 560, 1398), 1200);
  assert.equal(dragWidth(1000, 500, 1, 560, 1398), 1398);
  assert.equal(dragWidth(1000, -500, 1, 560, 1398), 560);
});
