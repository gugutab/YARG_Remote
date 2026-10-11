import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, formatRoute } from '../src/route.js';

test('routes round-trip, including ids with slashes, spaces and accents', () => {
  const id = 'Rock Band 2 DLC/Foo Fighters - All My Life';
  assert.deepEqual(parseRoute(formatRoute({ view: 'song', id })), { view: 'song', id });
  assert.deepEqual(parseRoute(formatRoute({ view: 'play', id })), { view: 'play', id });
  const odd = 'CDLC/Motörhead (Live)/100% – ñ';
  assert.deepEqual(parseRoute(formatRoute({ view: 'play', id: odd })), { view: 'play', id: odd });
});

test('route format and parsing', () => {
  assert.equal(formatRoute({ view: 'library' }), '#/');
  assert.equal(formatRoute({ view: 'song' }), '#/'); // a song screen without an id is the library
  assert.equal(formatRoute({ view: 'play', id: 'a/b' }), '#/song/a%2Fb/play');
  assert.deepEqual(parseRoute(''), { view: 'library' });
  assert.deepEqual(parseRoute('#/'), { view: 'library' });
  assert.deepEqual(parseRoute('#/nonsense'), { view: 'library' });
  assert.deepEqual(parseRoute('#/song/%E0%A4%A'), { view: 'library' }); // a broken escape does not throw
  assert.deepEqual(parseRoute('#/song/x/'), { view: 'song', id: 'x' });
});
