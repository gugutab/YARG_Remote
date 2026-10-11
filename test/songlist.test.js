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

test('instruments come from the chart parts when the server index has them (song.ini may say -1 for everything)', async () => {
  const { songSummary, hasInstrument, filterSongs } = await import('../src/songlist.js');
  const gh = { title: 'All My Life', artist: 'Foo Fighters', album: 'x', parts: ['guitar', 'bass'], ini: { diff_guitar: -1, diff_bass: -1, diff_drums: -1, diff_vocals: -1 } };
  assert.deepEqual(songSummary(gh).instruments, [{ base: 'guitar', level: null }, { base: 'bass', level: null }]);
  assert.equal(hasInstrument(gh, 'guitar'), true);
  assert.equal(hasInstrument(gh, 'drums'), false);
  assert.deepEqual(filterSongs([gh], { instruments: ['drums'] }), []);
  // parts win over the ini; with a level the pips still come from the ini
  const rb = { title: 'x', artist: 'y', album: 'z', parts: ['guitar', 'drums'], ini: { diff_guitar: 3, diff_drums: 4, diff_vocals: 2 } };
  assert.deepEqual(songSummary(rb).instruments, [{ base: 'guitar', level: 3 }, { base: 'drums', level: 4 }]);
  // no parts (folder mode, unreadable chart): the ini decides, as before
  assert.deepEqual(songSummary({ title: 'a', artist: 'b', album: 'c', ini: { diff_bass: 2 } }).instruments, [{ base: 'bass', level: 2 }]);
});

test('the pack is the top-level folder: shown, searchable, filterable and sortable', async () => {
  const { packOf } = await import('../src/ini.js');
  const { packsOf, groupLabel, anchorLabel, buildItems } = await import('../src/songlist.js');
  const { metaRows } = await import('../src/songinfo.js');
  const mk = (id, title) => ({ id, title, artist: 'A', album: 'B', ini: {} });
  const songs = [mk('Rock Band 2 DLC/A - One', 'One'), mk('Guitar Hero III/B - Two', 'Two'), mk('CDLC/Band/Three', 'Three'), mk('Loose', 'Loose')];
  assert.equal(packOf(songs[0]), 'Rock Band 2 DLC');
  assert.equal(packOf(songs[2]), 'CDLC'); // deeper paths still use the first folder
  assert.equal(packOf(songs[3]), ''); // a song in the root has no pack
  assert.deepEqual(packsOf(songs), ['CDLC', 'Guitar Hero III', 'Rock Band 2 DLC']);
  assert.deepEqual(filterSongs(songs, { pack: 'Guitar Hero III' }).map((s) => s.title), ['Two']);
  assert.deepEqual(filterSongs(songs, { query: 'pack:"rock band"' }).map((s) => s.title), ['One']);
  assert.deepEqual(filterSongs(songs, { query: 'guitar hero' }).map((s) => s.title), ['Two']); // free text also matches the pack
  assert.deepEqual(sortSongs(songs, 'pack').map((s) => s.title), ['Three', 'Two', 'One', 'Loose']);
  assert.equal(groupLabel(songs[3], 'pack'), 'No pack');
  assert.equal(anchorLabel('Rock Band 2 DLC', 'pack'), 'RB2+');
  assert.deepEqual(buildItems(sortSongs(songs, 'pack'), 'pack').filter((i) => i.type === 'head').map((i) => i.label), ['CDLC', 'Guitar Hero III', 'Rock Band 2 DLC', 'No pack']);
  assert.equal(metaRows(songs[0])[0].label, 'Pack');
  assert.equal(metaRows(songs[0])[0].value, 'Rock Band 2 DLC');
});

test('genre, pack and decade filters take several values: any of them matches, filters combine with AND', () => {
  const mk = (id, genre, year) => ({ id, title: id, artist: 'a', album: 'b', ini: { genre, year } });
  const songs = [mk('Rock Band 1/a', 'Rock', 1975), mk('Rock Band 2/b', 'Metal', 1985), mk('Guitar Hero III/c', 'Rock', 1995), mk('Guitar Hero III/d', 'Pop', 2005)];
  const ids = (f) => filterSongs(songs, f).map((s) => s.id.split('/')[1]);
  assert.deepEqual(ids({ genre: ['Rock', 'Metal'] }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ pack: ['Rock Band 1', 'Rock Band 2'] }), ['a', 'b']);
  assert.deepEqual(ids({ decade: ['1970', '1990'] }), ['a', 'c']);
  assert.deepEqual(ids({ genre: ['Rock', 'Metal'], pack: ['Guitar Hero III'], decade: ['1990', '2000'] }), ['c']);
  assert.deepEqual(ids({ genre: 'Pop' }), ['d']); // a single value still works
  assert.deepEqual(ids({ genre: [] }), ['a', 'b', 'c', 'd']);
});

test('evenPerRow spreads items evenly over the rows that would be needed', async () => {
  const { evenPerRow } = await import('../src/songlist.js');
  assert.equal(evenPerRow(4, 3), 2); // 2 + 2, not 3 + 1
  assert.equal(evenPerRow(5, 3), 3); // 3 + 2
  assert.equal(evenPerRow(6, 3), 3);
  assert.equal(evenPerRow(7, 3), 3); // 3 + 3 + 1 stays: ceil(7/3) = 3 rows -> 3 per row... 
  assert.equal(evenPerRow(2, 5), 2);
  assert.equal(evenPerRow(0, 3), 1);
  assert.equal(evenPerRow(5, 1), 1);
  assert.equal(evenPerRow(8, 3), 3); // 3 rows of 3,3,2
  assert.equal(evenPerRow(10, 4), 4); // 3 rows: 4,4,2 -> the widest row is the cap
});
