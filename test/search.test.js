import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSongs, rankByRelevance, relevanceScore, highlightRanges } from '../src/songlist.js';

const song = (title, artist, album = '', extra = {}) => ({ title, artist, album, ini: { name: title, artist, album, ...extra }, files: new Map() });
const songs = [
  song('Back in Black', 'AC/DC', 'Back in Black'),
  song('Highway to Hell', 'AC/DC', 'Highway to Hell'),
  song('Queen of the Stone Age', 'Someone', 'Odds'),
  song('Bohemian Rhapsody', 'Queen', 'A Night at the Opera'),
  song('Under Pressure', 'Queen & David Bowie', 'Hot Space'),
  song('Björk Song', 'Björk', ''),
  song("Don't Stop Believin'", 'Journey', 'Escape'),
];
const titles = (list) => list.map((s) => s.title);

test('punctuation does not matter: "ac dc", "acdc" and "AC/DC" find AC/DC', () => {
  for (const q of ['ac dc', 'acdc', 'AC/DC', 'ac-dc']) assert.deepEqual(titles(filterSongs(songs, { query: q })), ['Back in Black', 'Highway to Hell'], q);
});

test('accents and apostrophes: "bjork", "dont stop"', () => {
  assert.deepEqual(titles(filterSongs(songs, { query: 'bjork' })), ['Björk Song']);
  assert.deepEqual(titles(filterSongs(songs, { query: "don't stop" })), ["Don't Stop Believin'"]);
  assert.deepEqual(titles(filterSongs(songs, { query: 'dont stop' })), ["Don't Stop Believin'"]);
});

test('every word must match, in any order (as before)', () => {
  assert.deepEqual(titles(filterSongs(songs, { query: 'hell highway' })), ['Highway to Hell']);
  assert.deepEqual(filterSongs(songs, { query: 'queen zzz' }), []);
});

test('relevance: a title that starts with the word beats an artist match, then the album', () => {
  assert.deepEqual(titles(rankByRelevance(filterSongs(songs, { query: 'queen' }), 'queen')),
    ['Queen of the Stone Age', 'Bohemian Rhapsody', 'Under Pressure']); // title start, artist is Queen, artist starts with "Queen &"
});

test('relevance: an exact title wins; equal scores keep their order', () => {
  const r = rankByRelevance(songs, 'back in black');
  assert.equal(r[0].title, 'Back in Black');
  const same = rankByRelevance([songs[0], songs[1]], 'ac');
  assert.deepEqual(titles(same), ['Back in Black', 'Highway to Hell']);
});

test('relevance: field-only queries are not reordered', () => {
  assert.equal(rankByRelevance(songs, 'artist:queen'), songs);
  assert.equal(relevanceScore(songs[0], []), 0);
});

test('highlightRanges marks the matches ignoring accents, case and punctuation', () => {
  assert.deepEqual(highlightRanges('Back in Black', ['black']), [[8, 13]]);
  assert.deepEqual(highlightRanges('AC/DC', ['acdc']), [[0, 5]]);
  assert.deepEqual(highlightRanges('Björk', ['bjork']), [[0, 5]]);
  assert.deepEqual(highlightRanges('Queen of Queens', ['queen']), [[0, 5], [9, 14]]);
  assert.deepEqual(highlightRanges('abc', ['b', 'bc']), [[1, 3]]); // overlapping ranges merge
  assert.deepEqual(highlightRanges('abc', ['zzz', '']), []);
});

test('rankWithinGroups keeps the header runs and ranks inside each', async () => {
  const { rankWithinGroups } = await import('../src/songlist.js');
  const mk = (title, artist) => ({ id: title, title, artist, album: '', ini: {} });
  const sorted = [mk('Big rock', 'Q'), mk('Rock big', 'Q'), mk('Zed rock', 'R')];
  assert.deepEqual(rankWithinGroups(sorted, 'rock', 'artist').map((s) => s.title), ['Rock big', 'Big rock', 'Zed rock']);
});
