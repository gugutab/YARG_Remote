import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutOffsets, visibleRange, itemAt, ROW_H, HEAD_H } from '../src/virtuallist.js';
import { LruUrls, createThumbs } from '../src/thumbs.js';
import { groupLabel, buildItems, sortSongs } from '../src/songlist.js';

const songs = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `T${i}`, artist: 'A', album: 'B', ini: {} }));

test('layout offsets add up heads and rows', () => {
  const items = [{ type: 'head' }, { type: 'song' }, { type: 'song' }, { type: 'head' }, { type: 'song' }];
  const o = layoutOffsets(items);
  assert.deepEqual([...o], [0, HEAD_H, HEAD_H + ROW_H, HEAD_H + 2 * ROW_H, 2 * HEAD_H + 2 * ROW_H, 2 * HEAD_H + 3 * ROW_H]);
});

test('visibleRange returns only the items near the viewport', () => {
  const items = Array.from({ length: 1000 }, () => ({ type: 'song' }));
  const o = layoutOffsets(items);
  assert.deepEqual(visibleRange(o, 0, 560, 0), [0, 10]);
  const [a, b] = visibleRange(o, 56 * 500, 560, 112);
  assert.equal(a, 498);
  assert.equal(b, 512);
  assert.deepEqual(visibleRange(layoutOffsets([]), 0, 500), [0, 0]);
  const [x, y] = visibleRange(o, 56 * 1000, 560); // scrolled past the end
  assert.ok(x <= 1000 && y === 1000);
});

test('itemAt finds the item under a scroll position', () => {
  const o = layoutOffsets([{ type: 'head' }, { type: 'song' }, { type: 'song' }]);
  assert.equal(itemAt(o, 0), 0);
  assert.equal(itemAt(o, HEAD_H), 1);
  assert.equal(itemAt(o, HEAD_H + ROW_H + 1), 2);
});

test('LRU evicts the oldest entry and revokes its URL', () => {
  const revoked = [];
  const lru = new LruUrls(2, (u) => revoked.push(u));
  lru.set('a', 'ua');
  lru.set('b', 'ub');
  lru.get('a'); // a is now the newest
  lru.set('c', 'uc');
  assert.deepEqual(revoked, ['ub']);
  assert.equal(lru.get('b'), undefined);
  assert.equal(lru.size, 2);
});

test('thumbs: caches, dedupes, skips unwanted jobs and remembers songs without a cover', async () => {
  let renders = 0;
  const saved = new Map();
  const t = createThumbs({
    render: async (s) => { renders++; return s.id === 's2' ? null : { id: s.id }; },
    save: async (id, b) => saved.set(id, b),
    makeUrl: (b) => `blob:${b.id}`, revoke: () => {}, concurrency: 1,
  });
  const [s0, s1, s2] = songs(3);
  const [u1, u2] = await Promise.all([t.get(s0), t.get(s0)]);
  assert.equal(u1, 'blob:s0');
  assert.equal(u2, 'blob:s0');
  assert.equal(renders, 1);
  assert.equal(t.peek(s0), 'blob:s0');
  assert.equal(await t.get(s1, () => false), null); // scrolled away: not rendered
  assert.equal(renders, 1);
  assert.equal(await t.get(s2), null);
  assert.equal(saved.get('s2'), 'none');
  await t.get(s2);
  assert.equal(renders, 2); // the missing cover is not retried
});

test('thumbs: a persisted thumbnail is used without rendering', async () => {
  let renders = 0;
  const t = createThumbs({ render: async () => { renders++; return {}; }, load: async () => ({ id: 'saved' }), makeUrl: (b) => `blob:${b.id}`, revoke: () => {} });
  assert.equal(await t.get(songs(1)[0]), 'blob:saved');
  assert.equal(renders, 0);
});

test('groupLabel follows the sort key', () => {
  const mk = (o) => ({ title: 'x', artist: 'x', album: 'x', ini: {}, ...o });
  assert.equal(groupLabel(mk({ title: 'Émile' }), 'title'), 'E');
  assert.equal(groupLabel(mk({ title: '(Don\'t Fear) The Reaper' }), 'title'), 'D');
  assert.equal(groupLabel(mk({ title: '99 Luftballons' }), 'title'), '#');
  assert.equal(groupLabel(mk({ artist: 'ZZ Top' }), 'artist'), 'ZZ Top');
  assert.equal(groupLabel(mk({ artist: '' }), 'artist'), 'Unknown artist');
  assert.equal(groupLabel(mk({ album: 'Abbey Road' }), 'album'), 'Abbey Road');
  assert.equal(groupLabel(mk({ album: '' }), 'album'), 'Unknown album');
  assert.equal(groupLabel(mk({ ini: { year: '1972' } }), 'year'), '1970s');
  assert.equal(groupLabel(mk({}), 'year'), 'Unknown year');
  assert.equal(groupLabel(mk({ ini: { song_length: 250000 } }), 'length'), '4–5 min');
  assert.equal(groupLabel(mk({ ini: { song_length: 600000 } }), 'length'), '7+ min');
  assert.equal(groupLabel(mk({}), 'length'), 'Unknown length');
});

test('buildItems inserts a head before each run, also when reversed', () => {
  const mk = (title) => ({ title, artist: 'a', album: 'b', ini: {} });
  const sorted = sortSongs([mk('Beta'), mk('alpha'), mk('Apple')], 'title');
  assert.deepEqual(buildItems(sorted, 'title').map((i) => (i.type === 'head' ? i.label : i.song.title)), ['A', 'alpha', 'Apple', 'B', 'Beta']);
  const desc = sortSongs([mk('Beta'), mk('alpha'), mk('Apple')], 'title', true);
  assert.deepEqual(buildItems(desc, 'title').filter((i) => i.type === 'head').map((i) => i.label), ['B', 'A']);
});

test('artist and album sorts get one header per name (case and accents ignored)', () => {
  const mk = (title, artist, album) => ({ title, artist, album, ini: {} });
  const sorted = sortSongs([mk('b', 'Émile', 'X'), mk('a', 'emile', 'X'), mk('c', 'Zed', 'Y')], 'artist');
  assert.deepEqual(buildItems(sorted, 'artist').filter((i) => i.type === 'head').map((i) => i.label), ['emile', 'Zed']);
  assert.deepEqual(buildItems(sortSongs(sorted, 'album'), 'album').filter((i) => i.type === 'head').map((i) => i.label), ['X', 'Y']);
});

test('rail geometry: scroll offset and pointer position are inverses', async () => {
  const { railPos, railScroll } = await import('../src/virtuallist.js');
  const H = 400;
  const th = 40;
  assert.equal(railPos(0, 1000, H, th), 20);
  assert.equal(railPos(1000, 1000, H, th), 380);
  for (const off of [0, 250, 777, 1000]) assert.ok(Math.abs(railScroll(railPos(off, 1000, H, th), 1000, H, th) - off) < 1e-9);
  assert.equal(railScroll(-50, 1000, H, th), 0); // dragging past the ends clamps
  assert.equal(railScroll(900, 1000, H, th), 1000);
  assert.equal(railPos(10, 0, H, th), 20); // nothing to scroll
});

test('anchorLabel gives short rail labels', async () => {
  const { anchorLabel } = await import('../src/songlist.js');
  assert.equal(anchorLabel('AC/DC', 'artist'), 'A');
  assert.equal(anchorLabel('(Pronounced', 'album'), 'P');
  assert.equal(anchorLabel('99 Red', 'title'), '#');
  assert.equal(anchorLabel('1970s', 'year'), '70s');
  assert.equal(anchorLabel('Unknown year', 'year'), '?');
  assert.equal(anchorLabel('3–4 min', 'length'), '3–4');
  assert.equal(anchorLabel('< 3 min', 'length'), '<3');
  assert.equal(anchorLabel('7+ min', 'length'), '7+');
});
