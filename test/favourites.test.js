import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAVOURITES_KEY, MAX_ID_LENGTH, cleanFavourites, parseFavourites, serializeFavourites, toggleFavourite, onlyFavourites,
  mergeFavourites, loadFavourites, saveFavourites,
} from '../src/favourites.js';

const memory = (init = {}) => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
};

test('parse: corrupt, wrong shape or missing storage gives an empty set', () => {
  for (const raw of [null, undefined, '', '{', 'null', '42', '"a"', '{"a":1}', '[[1]', 'true']) assert.equal(parseFavourites(raw).size, 0, String(raw));
});

test('parse: keeps strings only, drops duplicates, empty and over-long ids', () => {
  const long = 'x'.repeat(MAX_ID_LENGTH + 1);
  const set = parseFavourites(JSON.stringify(['a/b', 'a/b', '', 3, null, { id: 'c' }, long, 'c']));
  assert.deepEqual([...set], ['a/b', 'c']);
});

test('parse: caps the set (first entries win)', () => {
  const set = parseFavourites(JSON.stringify(['a', 'b', 'c', 'd']), 2);
  assert.deepEqual([...set], ['a', 'b']);
});

test('serialize / parse round trip', () => {
  const set = new Set(['Songs/One', 'Songs/Two (Live)', 'ünïcode/ß']);
  assert.deepEqual(parseFavourites(serializeFavourites(set)), set);
});

test('toggle adds and removes without changing the input', () => {
  const a = new Set(['x']);
  const b = toggleFavourite(a, 'y');
  assert.deepEqual([...a], ['x']);
  assert.deepEqual([...b], ['x', 'y']);
  assert.deepEqual([...toggleFavourite(b, 'x')], ['y']);
  assert.deepEqual([...toggleFavourite(b, 'y', true)], ['x', 'y']); // explicit on: no duplicate
  assert.deepEqual([...toggleFavourite(b, 'z', false)], ['x', 'y']); // removing an unknown id is harmless
  assert.deepEqual([...toggleFavourite(b, 5)], ['x', 'y']); // not an id
});

test('toggle on a full set drops the oldest star', () => {
  const set = toggleFavourite(new Set(['a', 'b']), 'c', true, 2);
  assert.deepEqual([...set], ['b', 'c']);
});

test('onlyFavourites keeps the starred songs; ids of songs no longer in the library match nothing', () => {
  const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(onlyFavourites(songs, new Set(['c', 'gone', 'a'])).map((s) => s.id), ['a', 'c']);
  assert.deepEqual(onlyFavourites(songs, new Set()), []);
});

test('merge (import) adds new valid ids, counts the skipped ones, never removes', () => {
  const { set, added, skipped } = mergeFavourites(new Set(['a']), ['a', 'b', 'b', 7, '', 'c']);
  assert.deepEqual([...set], ['a', 'b', 'c']);
  assert.equal(added, 2);
  assert.equal(skipped, 2);
  assert.throws(() => mergeFavourites(new Set(), { a: 1 }), /not a list/);
});

test('merge respects the cap', () => {
  const r = mergeFavourites(new Set(['a']), ['b', 'c', 'd'], 2);
  assert.deepEqual([...r.set], ['a', 'b']);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 2);
});

test('cleanFavourites refuses non-arrays', () => {
  assert.equal(cleanFavourites('abc').size, 0);
  assert.equal(cleanFavourites({ length: 2, 0: 'a', 1: 'b' }).size, 0);
});

test('load / save through a storage; empty set removes the key; failures are soft', () => {
  const s = memory();
  assert.equal(saveFavourites(s, new Set(['a', 'b'])), true);
  assert.equal(s.data[FAVOURITES_KEY], '["a","b"]');
  assert.deepEqual([...loadFavourites(s)], ['a', 'b']);
  saveFavourites(s, new Set());
  assert.equal(FAVOURITES_KEY in s.data, false);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('x'); } };
  assert.equal(loadFavourites(broken).size, 0);
  assert.equal(saveFavourites(broken, new Set(['a'])), false);
  assert.equal(loadFavourites(memory({ [FAVOURITES_KEY]: 'not json' })).size, 0);
  assert.equal(loadFavourites(null).size, 0);
});

test('star button state: aria-pressed and the label follow the favourite', async () => {
  const { syncStarButton, FAV_LABELS } = await import('../src/virtuallist.js');
  const attrs = {};
  const btn = { setAttribute: (k, v) => { attrs[k] = v; }, title: '' };
  syncStarButton(btn, true);
  assert.deepEqual(attrs, { 'aria-pressed': 'true', 'aria-label': 'Remove from favourites' });
  assert.equal(btn.title, FAV_LABELS.on);
  syncStarButton(btn, false);
  assert.deepEqual(attrs, { 'aria-pressed': 'false', 'aria-label': 'Favourite' });
});
