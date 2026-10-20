import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_KEY, MIN_PLAY_MS, parseHistory, serializeHistory, recordPlay, pruneHistory, sortKey, sortByHistory, formatAgo, playedLine,
  createPlayTracker, loadHistory, saveHistory,
} from '../src/history.js';

const T0 = Date.UTC(2026, 9, 20, 12);
const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('parse: corrupt or wrongly shaped data gives an empty map', () => {
  for (const raw of [null, '', '{', '[]', '[1,2]', 'null', '7', '"x"']) assert.equal(parseHistory(raw).size, 0, String(raw));
});

test('parse: bad entries are dropped one by one', () => {
  const map = parseHistory(JSON.stringify({
    good: { last: T0, plays: 3 },
    noPlays: { last: T0, plays: 0 },
    negative: { last: -5, plays: 2 },
    text: { last: 'yesterday', plays: 1 },
    nul: null,
    arr: [T0, 1],
    frac: { last: T0, plays: 2.9 },
    [('x'.repeat(2000))]: { last: T0, plays: 1 },
  }));
  assert.deepEqual([...map.keys()], ['good', 'frac']);
  assert.equal(map.get('frac').plays, 2);
});

test('parse prunes to the cap, dropping the oldest', () => {
  const data = { a: { last: 1000, plays: 1 }, b: { last: 3000, plays: 1 }, c: { last: 2000, plays: 1 } };
  assert.deepEqual([...parseHistory(JSON.stringify(data), 2).keys()].sort(), ['b', 'c']);
});

test('recordPlay counts plays, updates the time, does not change its input', () => {
  const a = new Map();
  const b = recordPlay(a, 'song', T0);
  const c = recordPlay(b, 'song', T0 + HOUR);
  assert.equal(a.size, 0);
  assert.deepEqual(b.get('song'), { last: T0, plays: 1 });
  assert.deepEqual(c.get('song'), { last: T0 + HOUR, plays: 2 });
});

test('recordPlay ignores bad ids and times', () => {
  const m = new Map();
  for (const [id, now] of [['', T0], [null, T0], [5, T0], ['x'.repeat(2000), T0], ['a', NaN], ['a', -1], ['a', 0]]) assert.equal(recordPlay(m, id, now), m);
});

test('recordPlay with the clock going backwards still counts, and the play survives pruning', () => {
  let m = new Map([['old', { last: T0, plays: 1 }], ['older', { last: T0 - DAY, plays: 4 }]]);
  m = recordPlay(m, 'new', T0 - 10 * DAY, 2); // the clock jumped back: this play looks the oldest
  assert.ok(m.has('new'));
  assert.equal(m.size, 2);
  assert.ok(m.has('old'));
  const again = recordPlay(new Map([['s', { last: T0, plays: 2 }]]), 's', T0 - HOUR);
  assert.deepEqual(again.get('s'), { last: T0 - HOUR, plays: 3 });
  assert.equal(formatAgo(T0, T0 - HOUR), 'just now'); // a time in the future reads "just now"
});

test('recordPlay keeps the history bounded', () => {
  let m = new Map();
  for (let i = 0; i < 30; i++) m = recordPlay(m, `s${i}`, T0 + i * MIN, 10);
  assert.equal(m.size, 10);
  assert.ok(m.has('s29') && m.has('s20') && !m.has('s19'));
});

test('pruneHistory leaves a small map alone', () => {
  const m = new Map([['a', { last: 1, plays: 1 }]]);
  assert.equal(pruneHistory(m, 5), m);
});

test('serialize / parse round trip', () => {
  const m = recordPlay(recordPlay(new Map(), 'A/b', T0), 'C', T0 + 1);
  assert.deepEqual(parseHistory(serializeHistory(m)), m);
});

test('sortKey: last time, play count, null for unknown ids', () => {
  const m = new Map([['a', { last: T0, plays: 7 }]]);
  assert.equal(sortKey(m, 'a'), T0);
  assert.equal(sortKey(m, 'a', 'plays'), 7);
  assert.equal(sortKey(m, 'missing'), null);
});

test('sortByHistory: most recent / most played first, never played last (also reversed)', () => {
  const songs = ['n1', 'a', 'b', 'n2', 'c'].map((id) => ({ id }));
  const m = new Map([['a', { last: T0, plays: 5 }], ['b', { last: T0 + DAY, plays: 1 }], ['c', { last: T0 - DAY, plays: 5 }], ['gone', { last: T0 + 9 * DAY, plays: 99 }]]);
  const ids = (list) => list.map((s) => s.id);
  assert.deepEqual(ids(sortByHistory(songs, m, 'recent')), ['b', 'a', 'c', 'n1', 'n2']);
  assert.deepEqual(ids(sortByHistory(songs, m, 'recent', true)), ['c', 'a', 'b', 'n1', 'n2']);
  assert.deepEqual(ids(sortByHistory(songs, m, 'plays')), ['a', 'c', 'b', 'n1', 'n2']); // equal plays: the more recent first
  assert.deepEqual(ids(sortByHistory(songs, m, 'plays', true)), ['b', 'c', 'a', 'n1', 'n2']);
  assert.deepEqual(ids(sortByHistory(songs, new Map(), 'recent')), ids(songs));
});

test('formatAgo', () => {
  const cases = [
    [0, 'just now'], [59e3, 'just now'], [MIN, '1 minute ago'], [5 * MIN, '5 minutes ago'], [HOUR, '1 hour ago'], [23 * HOUR, '23 hours ago'],
    [DAY, 'yesterday'], [2 * DAY, '2 days ago'], [6 * DAY, '6 days ago'], [7 * DAY, '1 week ago'], [29 * DAY, '4 weeks ago'],
    [30 * DAY, '1 month ago'], [200 * DAY, '6 months ago'], [365 * DAY, '1 year ago'], [800 * DAY, '2 years ago'],
  ];
  for (const [ago, text] of cases) assert.equal(formatAgo(T0 - ago, T0), text, `${ago}`);
  assert.equal(formatAgo(NaN, T0), '');
  assert.equal(formatAgo(T0, undefined), '');
});

test('playedLine', () => {
  const m = new Map([['a', { last: T0 - 3 * DAY, plays: 12 }], ['b', { last: T0, plays: 1 }]]);
  assert.equal(playedLine(m, 'a', T0), 'Played 3 days ago · 12 plays');
  assert.equal(playedLine(m, 'b', T0), 'Played just now · 1 play');
  assert.equal(playedLine(m, 'never', T0), '');
});

test('play tracker: counts once after the minimum of playing time', () => {
  const tr = createPlayTracker();
  let hits = [];
  for (let t = 0; t <= 12000; t += 100) { const r = tr.tick('s', true, t); if (r) hits.push([r, t]); }
  assert.deepEqual(hits, [['s', MIN_PLAY_MS]]);
});

test('play tracker: paused time and long gaps do not count; a new song or reset starts over', () => {
  const tr = createPlayTracker({ min: 1000, maxStep: 200 });
  tr.tick('s', true, 0);
  tr.tick('s', true, 500);
  assert.equal(tr.playedMs, 200); // a gap of 500 ms counts as 200
  tr.tick('s', false, 600);
  tr.tick('s', true, 10000); // resumed: the paused time is not counted
  assert.equal(tr.playedMs, 200);
  for (let t = 10100; t <= 10700; t += 100) assert.equal(tr.tick('s', true, t), null);
  assert.equal(tr.tick('s', true, 10800), 's');
  assert.equal(tr.tick('s', true, 11000), null); // once per session
  tr.reset(); // the song ended: a restart is a new play
  let got = null;
  for (let t = 20000; t <= 21100 && !got; t += 100) got = tr.tick('s', true, t);
  assert.equal(got, 's');
  assert.equal(tr.tick('other', true, 30000), null); // a change of song starts from zero
  assert.equal(tr.playedMs, 0);
});

test('play tracker: a clock going backwards adds nothing, no song counts nothing', () => {
  const tr = createPlayTracker({ min: 1000 });
  tr.tick('s', true, 5000);
  tr.tick('s', true, 4000);
  assert.equal(tr.playedMs, 0);
  const none = createPlayTracker({ min: 0 });
  assert.equal(none.tick(null, true, 0), null);
  assert.equal(none.tick(undefined, true, 100), null);
});

test('load / save through a storage; failures are soft', () => {
  const data = {};
  const s = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
  const m = recordPlay(new Map(), 'a', T0);
  assert.equal(saveHistory(s, m), true);
  assert.deepEqual(loadHistory(s), m);
  saveHistory(s, new Map());
  assert.equal(HISTORY_KEY in data, false);
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('full'); }, removeItem() {} };
  assert.equal(loadHistory(broken).size, 0);
  assert.equal(saveHistory(broken, m), false);
});
