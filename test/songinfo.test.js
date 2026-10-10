import test from 'node:test';
import assert from 'node:assert/strict';
import { metaRows, difficultyLevels, extraRows, bpmRange, bpmLabel, chartStats, formatDuration, instrumentLevel } from '../src/songinfo.js';
import { plainText } from '../src/ini.js';

const song = {
  artist: 'Deep Purple', album: 'Machine Head',
  ini: { genre: 'Hard Rock', year: 1972, charter: 'Harm<color=#0072bc>o</color>nix', song_length: 361000,
    diff_guitar: 4, diff_bass: -1, diff_drums: 0, loading_phrase: 'x', pro_drums: 'True', hopo_frequency: 170, delay: 0 },
};

test('plainText strips rich text tags', () => {
  assert.equal(plainText('Harm<color=#0072bc>o</color>nix'), 'Harmonix');
  assert.equal(plainText(1999), '1999');
});

test('metaRows lists known fields, cleans tags and formats the length', () => {
  const rows = Object.fromEntries(metaRows(song).map((r) => [r.label, r.value]));
  assert.equal(rows['Album'], 'Machine Head');
  assert.equal(rows['Charter'], 'Harmonix');
  assert.equal(rows['Year'], '1972');
  assert.equal(rows['Length'], '6:01');
  assert.equal(rows['Audio delay'], undefined);
  assert.equal(formatDuration(0), '');
});

test('difficultyLevels keeps parts with level >= 0; extraRows keeps the rest', () => {
  assert.deepEqual(difficultyLevels(song), [{ label: 'Guitar', level: 4 }, { label: 'Drums', level: 0 }]);
  assert.deepEqual(extraRows(song).map((r) => r.label), ['hopo_frequency', 'pro_drums']);
});

test('bpm label, chart counts and per-instrument level', () => {
  assert.deepEqual(bpmRange([{ usPerQuarter: 500000 }, { usPerQuarter: 250000 }]), [120, 240]);
  assert.equal(bpmRange([]), null);
  assert.equal(bpmLabel([{ usPerQuarter: 500000 }]), '120');
  assert.equal(bpmLabel([{ usPerQuarter: 500000 }, { usPerQuarter: 250000 }]), '120–240');
  const chart = { mode: 'lanes', notes: [{ length: 0 }, { length: 1 }], solos: [1], starPower: [], sections: [1, 2] };
  const stats = Object.fromEntries(chartStats(chart).map((r) => [r.label, r.value]));
  assert.deepEqual([stats.Notes, stats.Sustains, stats.Solos, stats.Sections], ['2', '1', '1', '2']);
  assert.equal(instrumentLevel(song, { base: 'guitar' }), 4);
  assert.equal(instrumentLevel(song, { base: 'bass' }), null);
  assert.equal(instrumentLevel(song, { base: 'drums' }), 0);
  assert.equal(metaRows(song).some((r) => r.label === 'Preview at'), false);
  assert.equal(metaRows(song).find((r) => r.label === 'Year').icon, 'calendar');
});

import { stemKind, stemBadge, stemGroup, stemGroupLabel } from '../src/songinfo.js';
test('stem icons and badges', () => {
  assert.deepEqual(['drums_2', 'guitar', 'bass', 'rhythm', 'vocals', 'keys', 'crowd', 'song', 'backing'].map(stemKind),
    ['drum', 'guitar', 'bass', 'rhythm', 'mic', 'keys', 'users', 'music', 'music']);
  assert.deepEqual(['drums_2', 'bass', 'rhythm', 'guitar'].map(stemBadge), ['2', '', '', '']);
});

test('header chips start with Album, Track, Length, Charter and show the track once', () => {
  const s = { artist: 'A', album: 'Alb', ini: { genre: 'G', year: 2000, charter: 'C', song_length: 61000, album_track: 3, playlist_track: 9 } };
  assert.deepEqual(metaRows(s).map((r) => r.label), ['Album', 'Track', 'Length', 'Charter', 'Artist', 'Genre', 'Year']);
  assert.equal(metaRows(s)[1].value, '3');
  assert.equal(metaRows({ ini: { playlist_track: 9 } })[0].value, '9');
});

test('stems of one instrument share a group', () => {
  assert.deepEqual(['drums_1', 'drums_2', 'drums_kick', 'drums', 'guitar', 'guitar_2', 'rhythm', 'vocals_1', 'song', 'Crowd'].map(stemGroup),
    ['drums', 'drums', 'drums', 'drums', 'guitar', 'guitar', 'rhythm', 'vocals', 'song', 'crowd']);
  assert.equal(stemGroupLabel('drums'), 'Drums');
  assert.equal(stemGroupLabel('weird'), 'weird');
});
