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
