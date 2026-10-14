import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbGeometry, scrollTopFor } from '../src/scrollthumb.js';

test('no thumb when everything fits', () => {
  assert.equal(thumbGeometry({ clientHeight: 500, scrollHeight: 500, scrollTop: 0 }).visible, false);
  assert.equal(thumbGeometry({ clientHeight: 500, scrollHeight: 400, scrollTop: 0 }).visible, false);
});

test('thumb size follows the visible fraction, with a minimum', () => {
  assert.equal(thumbGeometry({ clientHeight: 400, scrollHeight: 800, scrollTop: 0 }).size, 200);
  assert.equal(thumbGeometry({ clientHeight: 400, scrollHeight: 100000, scrollTop: 0 }).size, 32);
});

test('thumb offset runs from the top to the bottom of the track', () => {
  const top = thumbGeometry({ clientHeight: 400, scrollHeight: 800, scrollTop: 0 });
  const end = thumbGeometry({ clientHeight: 400, scrollHeight: 800, scrollTop: 400 });
  assert.equal(top.offset, 0);
  assert.equal(end.offset, 400 - end.size);
});

test('scrollTopFor is the inverse of the thumb position', () => {
  const geo = (scrollTop) => thumbGeometry({ clientHeight: 400, scrollHeight: 1200, scrollTop });
  for (const st of [0, 100, 400, 800]) {
    const g = geo(st);
    assert.ok(Math.abs(scrollTopFor({ clientHeight: 400, scrollHeight: 1200, size: g.size, thumbTop: g.offset }) - st) < 1e-6);
  }
  assert.equal(scrollTopFor({ clientHeight: 400, scrollHeight: 1200, size: 100, thumbTop: -50 }), 0);
  assert.equal(scrollTopFor({ clientHeight: 400, scrollHeight: 1200, size: 100, thumbTop: 9999 }), 800);
});
