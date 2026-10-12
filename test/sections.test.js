import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSectionName, sectionIndexAt } from '../src/chart.js';

test('section names are read from [section ...] and prc events like YARG', () => {
  assert.equal(parseSectionName('[section Verse 1A]'), 'Verse 1A');
  assert.equal(parseSectionName('section Chorus 1'), 'Chorus 1');
  assert.equal(parseSectionName('section_Gtr Solo A'), 'Gtr Solo A');
  assert.equal(parseSectionName('[prc_a]'), 'a');
});

test('texts that are not sections are ignored', () => {
  assert.equal(parseSectionName('[mellow]'), null);
  assert.equal(parseSectionName('[idle_realtime]'), null);
  assert.equal(parseSectionName('[section]'), null);
  assert.equal(parseSectionName('lighting (verse)'), null);
});

test('the playing section is the last one started; before the first, it is the first', () => {
  const sections = [{ time: 5 }, { time: 10 }, { time: 20 }];
  assert.equal(sectionIndexAt(sections, 0), 0);
  assert.equal(sectionIndexAt(sections, 5), 0);
  assert.equal(sectionIndexAt(sections, 9.99), 0);
  assert.equal(sectionIndexAt(sections, 10), 1);
  assert.equal(sectionIndexAt(sections, 25), 2);
});

test('no sections gives -1', () => {
  assert.equal(sectionIndexAt([], 3), -1);
});

test('prettySectionName turns Rock Band keys into readable names and leaves hand-typed ones alone', async () => {
  const { prettySectionName: pretty } = await import('../src/chart.js');
  const cases = {
    chorus_1: 'Chorus 1', verse_6: 'Verse 6', gtr_solo_a: 'Guitar Solo A', main_riff: 'Main Riff', big_rock_ending: 'Big Rock Ending',
    _endofsong: 'End of Song', practice_outro: 'Outro', prechorus: 'Pre-Chorus', postchorus_2: 'Post-Chorus 2', verse_1a: 'Verse 1A',
    bre: 'Big Rock Ending', 'verse 1': 'Verse 1', 'pre-chorus': 'Pre-Chorus', keys_solo_a: 'Keys Solo A',
    'Verse 1': 'Verse 1', 'Guitar Solo': 'Guitar Solo', 'Breakdown 1,2,3': 'Breakdown 1,2,3', 'Yoooo!': 'Yoooo!',
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(pretty(raw), expected, raw);
});

test('chart sections carry the readable name and the raw one', async () => {
  const { buildChart, INSTRUMENTS, DIFFICULTIES } = await import('../src/chart.js');
  const { parseMidi } = await import('../src/midi.js');
  const { buildMidi, tempo120, trackName, text, on, off } = await import('./smf.js');
  const midi = parseMidi(buildMidi(480, [
    [tempo120(), { dt: 0, bytes: trackName('PART GUITAR') }, on(0, 96), off(240, 96)],
    [{ dt: 0, bytes: trackName('EVENTS') }, { dt: 0, bytes: text('[section verse_2]') }, { dt: 480, bytes: text('[section Chorus 1]') }],
  ]));
  const chart = buildChart(midi, INSTRUMENTS.find((i) => i.id === 'guitar'), DIFFICULTIES[3]);
  assert.deepEqual(chart.sections.map((s) => [s.name, s.raw]), [['Verse 2', 'verse_2'], ['Chorus 1', 'Chorus 1']]);
});
