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

test('section names are shown as written, minus the prefix (no prettifying, like YARG)', async () => {
  const { buildChart, INSTRUMENTS, DIFFICULTIES } = await import('../src/chart.js');
  const { parseMidi } = await import('../src/midi.js');
  const { buildMidi, tempo120, trackName, text, on, off } = await import('./smf.js');
  const midi = parseMidi(buildMidi(480, [
    [tempo120(), { dt: 0, bytes: trackName('PART GUITAR') }, on(0, 96), off(240, 96)],
    [{ dt: 0, bytes: trackName('EVENTS') }, { dt: 0, bytes: text('[section chorus_1]') }, { dt: 480, bytes: text('[prc_gtr_solo_a]') }],
  ]));
  const chart = buildChart(midi, INSTRUMENTS.find((i) => i.id === 'guitar'), DIFFICULTIES[3]);
  assert.deepEqual(chart.sections.map((s) => s.name), ['chorus_1', 'gtr_solo_a']);
});

test('a song with no sections gets ten automatic ones, 0% - 10% ... 90% - 100% (YARG PostProcessSections)', async () => {
  const { buildChart, INSTRUMENTS, DIFFICULTIES } = await import('../src/chart.js');
  const { parseMidi } = await import('../src/midi.js');
  const { buildMidi, tempo120, trackName, on, off } = await import('./smf.js');
  // one note at tick 0 and the last one ending at tick 4800 (5 s at 120 bpm, 480 ticks per beat)
  const midi = parseMidi(buildMidi(480, [[tempo120(), { dt: 0, bytes: trackName('PART GUITAR') }, on(0, 96), off(240, 96), on(4320, 97), off(240, 97)]]));
  const chart = buildChart(midi, INSTRUMENTS.find((i) => i.id === 'guitar'), DIFFICULTIES[3]);
  assert.equal(chart.sections.length, 10);
  assert.deepEqual(chart.sections.map((s) => s.name), ['0% - 10%', '10% - 20%', '20% - 30%', '30% - 40%', '40% - 50%', '50% - 60%', '60% - 70%', '70% - 80%', '80% - 90%', '90% - 100%']);
  assert.equal(chart.sections[0].time, 0);
  assert.ok(Math.abs(chart.sections[5].time - 2.5) < 1e-9, String(chart.sections[5].time)); // 50% of 5 s
});
