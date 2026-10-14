import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend, WEIGHTS } from '../src/recommend.js';

const mk = (id, artist, ini = {}, extra = {}) => ({ id, title: id, artist, album: '', ini, parts: ['guitar', 'bass', 'drums'], ...extra });
const cur = mk('Pack A/cur', 'Queen', { genre: 'Rock', year: 1978, charter: 'Bob', song_length: 240000 }, { album: 'Jazz' });

test('excludes the current song and songs without the active instrument', () => {
  const songs = [cur, mk('Pack A/noguitar', 'Queen', {}, { parts: ['drums'] }), mk('Pack A/ok', 'Queen')];
  const out = recommend(cur, songs, { instruments: ['guitar'] });
  assert.deepEqual(out.map((r) => r.song.id), ['Pack A/ok']);
});

test('same artist beats same genre, which beats same year only', () => {
  const songs = [
    mk('Pack B/year', 'X', { year: 1978 }),
    mk('Pack B/genre', 'Y', { genre: 'Rock' }),
    mk('Pack B/artist', 'Queen (WaveGroup)', {}),
  ];
  const out = recommend(cur, songs, { instruments: ['guitar'] });
  assert.deepEqual(out.map((r) => r.song.id), ['Pack B/artist', 'Pack B/genre', 'Pack B/year']);
  assert.equal(out[0].reason, 'Same artist');
  assert.equal(out[1].reason, 'Same genre');
  assert.equal(out[2].reason, '1978');
});

test('album, pack, charter and length add up', () => {
  const near = mk('Pack A/near', 'Z', { charter: 'bob', song_length: 240000 }, { album: 'Jazz' });
  const far = mk('Pack C/far', 'Z', { song_length: 600000 });
  const [a, b] = recommend(cur, [far, near], { instruments: ['guitar'] });
  assert.equal(a.song.id, 'Pack A/near');
  assert.equal(a.reason, 'Same album · Same pack');
  // album 3 + pack 1 + charter 1 + instrument 1 + length 1 (+ the small tie-break)
  assert.ok(a.score >= 7 && a.score <= 7 + WEIGHTS.shuffle);
  assert.ok(b.score < 2 + WEIGHTS.shuffle); // instrument only
});

test('the year bonus shrinks with the gap and stops after 5 years', () => {
  const at = (y) => recommend(cur, [mk('Pack C/s', 'Z', { year: y })], { instruments: ['guitar'] })[0].score;
  const base = at(1990);
  assert.ok(at(1978) - base > at(1983) - base);
  assert.ok(at(1983) > base);
  assert.equal(at(1984), base); // 6 years apart: no bonus (the tie-break is the same for the same song)
  assert.ok(Math.abs(at(1983) - base - (WEIGHTS.year * 1) / 6) < 1e-9); // 5 years: 1.5 x 1/6
});

test('each enabled instrument the candidate has adds a point', () => {
  const both = mk('Pack C/both', 'Z');
  const one = mk('Pack C/one', 'Z', {}, { parts: ['guitar'] });
  const out = recommend(cur, [one, both], { instruments: ['guitar', 'bass'] });
  assert.equal(out[0].song.id, 'Pack C/both');
});

test('stable: the same inputs give the same order, shuffled songs differ per current song', () => {
  const songs = Array.from({ length: 20 }, (_, i) => mk(`Pack Z/s${i}`, `Artist ${i}`));
  const a = recommend(cur, songs, { count: 8, instruments: ['guitar'] }).map((r) => r.song.id);
  const b = recommend(cur, [...songs].reverse(), { count: 8, instruments: ['guitar'] }).map((r) => r.song.id);
  assert.deepEqual(a, b);
  assert.equal(a.length, 8);
  const other = recommend(mk('Pack Z/other', 'Q'), songs, { count: 8, instruments: ['guitar'] }).map((r) => r.song.id);
  assert.notDeepEqual(a, other);
});

test('empty and degenerate input', () => {
  assert.deepEqual(recommend(null, []), []);
  assert.deepEqual(recommend(cur, [cur]), []);
  const out = recommend(mk('a', ''), [mk('b', ''), mk('c', '')], { instruments: [] });
  assert.equal(out.length, 2);
  assert.equal(out[0].reason, 'You might like it');
});

test('the same title and artist is shown once and never as the current song', () => {
  const mk = (id, title, artist) => ({ id, title, artist, album: '', ini: {}, parts: { guitar: 3 } });
  const cur = mk('a', 'Smoke on the Water', 'Deep Purple');
  const list = recommend(cur, [mk('b', 'Smoke On The Water', 'Deep Purple'), mk('c', 'Child in Time', 'Deep Purple'), mk('d', 'Child in Time', 'Deep Purple')], { count: 5, instruments: ['guitar'] });
  assert.deepEqual(list.map((x) => x.song.title), ['Child in Time']);
});
