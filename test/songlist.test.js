import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSongs, sortSongs, genresOf, hasInstrument } from '../src/songlist.js';

const mk = (title, artist, ini = {}, album = '') => ({ title, artist, album, ini });
const songs = [
  mk('Émile', 'Zed', { genre: 'Rock', year: 1999, song_length: 200000, diff_drums: -1, diff_guitar: 3 }),
  mk('Alpha', 'Beta', { genre: 'Metal', year: '2005', song_length: 100000 }, 'Gamma'),
  mk('Charlie', 'Alpha', { genre: 'Rock', year: 1980 }),
];

test('search ignores case and accents and matches every term', () => {
  assert.deepEqual(filterSongs(songs, { query: 'emile' }).map((s) => s.title), ['Émile']);
  assert.deepEqual(filterSongs(songs, { query: 'alpha gamma' }).map((s) => s.title), ['Alpha']);
});

test('instrument filter drops only songs whose ini says -1; unknown stays', () => {
  assert.equal(hasInstrument(songs[0], 'drums'), false);
  assert.equal(hasInstrument(songs[0], 'guitar'), true);
  assert.equal(hasInstrument(songs[1], 'drums'), true);
  assert.equal(filterSongs(songs, { instrument: 'drums' }).length, 2);
});

test('a pro-only -1 key does not exclude the song', () => {
  assert.equal(hasInstrument(mk('X', 'Y', { diff_guitar_real: -1 }), 'guitar'), true);
  assert.equal(hasInstrument(mk('X', 'Y', { diff_guitar: -1, diff_guitar_real: -1 }), 'guitar'), false);
});

test('genre filter and genre list', () => {
  assert.equal(filterSongs(songs, { genre: 'Rock' }).length, 2);
  assert.deepEqual(genresOf(songs), ['Metal', 'Rock']);
});

test('sorting by title, artist, year, length, and reversed', () => {
  assert.deepEqual(sortSongs(songs, 'title').map((s) => s.title), ['Alpha', 'Charlie', 'Émile']);
  assert.deepEqual(sortSongs(songs, 'artist').map((s) => s.artist), ['Alpha', 'Beta', 'Zed']);
  assert.deepEqual(sortSongs(songs, 'year').map((s) => s.title), ['Charlie', 'Émile', 'Alpha']);
  assert.deepEqual(sortSongs(songs, 'length', true).map((s) => s.title), ['Émile', 'Alpha', 'Charlie']);
});

test('query fields, instruments, levels and decades filter the list', async () => {
  const { parseQuery, songSummary, decadesOf } = await import('../src/songlist.js');
  const mk = (title, artist, ini = {}) => ({ title, artist, album: 'Alb', ini });
  const all = [
    mk('Highway Star', 'Deep Purple', { year: '1972', song_length: 366000, genre: 'Rock', diff_guitar: 5, diff_drums: 4, diff_vocals: -1, charter: 'Harmonix' }),
    mk('Bohemian', 'Queen', { year: '1975', song_length: 355000, genre: 'Rock', diff_guitar: 3, diff_vocals: 4 }),
    mk('Smells Like', 'Nirvana', { year: '1991', song_length: 301000, genre: 'Grunge', diff_guitar: 2, diff_drums: 2 }),
  ];
  const names = (f) => filterSongs(all, f).map((s) => s.title);
  assert.deepEqual(parseQuery('artist:"deep purple" year:1970-1979 foo').fields.map((f) => f.field), ['artist', 'year']);
  assert.deepEqual(parseQuery('artist:"deep purple" foo "bar baz"').terms, ['foo', 'bar baz']);
  assert.deepEqual(names({ query: 'artist:queen' }), ['Bohemian']);
  assert.deepEqual(names({ query: '-artist:queen year:1970s' }), ['Highway Star']);
  assert.deepEqual(names({ query: 'year:>=1990' }), ['Smells Like']);
  assert.deepEqual(names({ query: 'len:<6' }), ['Bohemian', 'Smells Like']);
  assert.deepEqual(names({ query: 'len:6' }), ['Highway Star']); // "6" = 6:00-6:59
  assert.deepEqual(names({ query: 'charter:harmonix' }), ['Highway Star']);
  assert.deepEqual(names({ query: 'no:vocals' }), ['Highway Star']);
  assert.deepEqual(names({ query: 'inst:drums' }), ['Highway Star', 'Bohemian', 'Smells Like']); // lenient: a song without a drums key is kept
  assert.deepEqual(names({ instruments: ['guitar', 'drums'], minLevel: 3 }), ['Highway Star']);
  assert.deepEqual(names({ minLevel: 5 }), ['Highway Star']);
  assert.deepEqual(names({ decade: 1990 }), ['Smells Like']);
  assert.deepEqual(names({ query: 'year:' }), ['Highway Star', 'Bohemian', 'Smells Like']); // an unfinished token filters nothing
  assert.deepEqual(decadesOf(all), [1990, 1970]);
  const sum = songSummary(all[0]);
  assert.equal(sum.length, '6:06');
  assert.equal(sum.year, 1972);
  assert.deepEqual(sum.instruments, [{ base: 'guitar', level: 5 }, { base: 'drums', level: 4 }]);
});
