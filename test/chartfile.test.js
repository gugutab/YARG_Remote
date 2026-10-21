import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../src/chartfile.js';
import { buildChart, instrumentOptions, availableDifficulties, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';

const ins = (id) => INSTRUMENTS.find((i) => i.id === id);
const EXPERT = DIFFICULTIES[3];

// Builds a .chart text. `extra` holds whole sections.
function chartText({ resolution = 192, sync = '  0 = TS 4\n  0 = B 120000', events = '', extra = '' } = {}) {
  return `[Song]\n{\n  Name = "Test"\n  Resolution = ${resolution}\n  Offset = 0\n}\n[SyncTrack]\n{\n${sync}\n}\n[Events]\n{\n${events}\n}\n${extra}`;
}
const section = (name, lines) => `[${name}]\n{\n${lines.join('\n')}\n}\n`;

test('sync track: tempo changes and time signatures become seconds', () => {
  const midi = parseChart(chartText({ sync: '  0 = TS 4\n  0 = B 120000\n  384 = B 60000\n  768 = TS 3 3' }));
  assert.equal(midi.division, 192);
  assert.equal(midi.toSeconds(384), 1); // 2 beats at 120 bpm
  assert.equal(midi.toSeconds(576), 2); // 1 more beat at 60 bpm
  assert.deepEqual(midi.timeSignatures, [{ tick: 0, num: 4, den: 4 }, { tick: 768, num: 3, den: 8 }]);
});

test('resolution defaults to 192 and the file may use CRLF, a BOM and UTF-16', () => {
  const text = '﻿' + chartText().replace('  Resolution = 192\n', '').replace(/\n/g, '\r\n');
  assert.equal(parseChart(text).division, 192);
  const bytes = new TextEncoder().encode(chartText({ resolution: 480 }));
  assert.equal(parseChart(bytes).division, 480);
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...chartText({ resolution: 96 })].flatMap((c) => [c.charCodeAt(0), 0])]);
  assert.equal(parseChart(utf16).division, 96);
});

test('five fret: lanes, sustain, star power, solo, instrument and difficulties', () => {
  const midi = parseChart(chartText({
    extra: section('ExpertSingle', ['  0 = N 0 0', '  192 = N 1 96', '  384 = N 4 192', '  0 = S 2 400', '  0 = E solo', '  400 = E soloend'])
      + section('EasySingle', ['  0 = N 2 0']),
  }));
  const opts = instrumentOptions(midi);
  assert.deepEqual(opts.map((o) => o.id), ['guitar']);
  assert.deepEqual(availableDifficulties(midi, ins('guitar')).map((d) => d.id), ['easy', 'expert']);
  const chart = buildChart(midi, ins('guitar'), EXPERT);
  assert.deepEqual(chart.notes.map((n) => n.lane), [0, 1, 4]);
  assert.equal(chart.notes[1].time, 0.5);
  assert.equal(chart.notes[1].length, 0.25); // .chart has no sustain cutoff by default
  assert.equal(chart.notes[0].length, 0);
  assert.equal(chart.starPower.length, 1);
  assert.equal(chart.solos.length, 1);
  assert.equal(chart.solos[0].end, midi.toSeconds(400));
});

test('hopo: natural at 65 ticks (192), forced flips it, tap and open flags', () => {
  const midi = parseChart(chartText({
    extra: section('ExpertSingle', [
      '  0 = N 0 0',
      '  65 = N 1 0', // natural HOPO (65 ticks after a different fret)
      '  200 = N 2 0', // far: strum
      '  265 = N 3 0', '  265 = N 5 0', // natural HOPO, forced -> strum
      '  500 = N 0 0', '  500 = N 5 0', // strum, forced -> HOPO
      '  700 = N 1 0', '  700 = N 6 0', // tap
      '  900 = N 7 0', // open
      '  965 = N 2 0', // after the open: natural HOPO
    ]),
  }));
  const notes = buildChart(midi, ins('guitar'), EXPERT).notes;
  const at = (ticks) => notes.find((n) => Math.abs(n.time - midi.toSeconds(ticks)) < 1e-9);
  assert.equal(at(0).hopo, false); // nothing before it
  assert.equal(at(65).hopo, true);
  assert.equal(at(200).hopo, false);
  assert.equal(at(265).hopo, false);
  assert.equal(at(500).hopo, true);
  assert.equal(at(700).tap, true);
  assert.equal(at(700).hopo, false);
  assert.equal(at(900).open, true);
  assert.equal(at(900).tap, false);
  assert.equal(at(965).hopo, true);
  assert.equal(notes.filter((n) => n.open).length, 1);
});

test('hopo threshold scales with the resolution (res * 65 / 192, like .chart in YARG)', () => {
  const lines = (gap) => ['  0 = N 0 0', `  ${gap} = N 1 0`];
  const hopoAt = (gap) => buildChart(parseChart(chartText({ resolution: 480, extra: section('ExpertSingle', lines(gap)) })), ins('guitar'), EXPERT).notes[1].hopo;
  assert.equal(hopoAt(162), true); // 480 * 65 / 192 = 162.5 -> 162
  assert.equal(hopoAt(163), false);
});

test('drums: 4 lanes without cymbal flags, kick, double kick, accent and ghost', () => {
  const midi = parseChart(chartText({
    extra: section('ExpertDrums', ['  0 = N 0 0', '  0 = N 32 0', '  0 = N 1 0', '  0 = N 34 0', '  192 = N 2 0', '  192 = N 41 0', '  384 = N 3 0', '  384 = N 40 0', '  96 = N 1 0', '  0 = S 64 192', '  0 = S 65 100']),
  }));
  const opts = instrumentOptions(midi);
  assert.deepEqual(opts.map((o) => o.id), ['drums-four']);
  const chart = buildChart(midi, opts[0], EXPERT);
  assert.equal(chart.lanes, 4);
  const kick = chart.notes.find((n) => n.lane === -1);
  assert.equal(kick.doubleKick, true);
  assert.equal(chart.notes.find((n) => n.lane === 0).accent, true); // red + N 34
  assert.equal(chart.notes.find((n) => n.lane === 1).ghost, true); // yellow + N 41
  assert.equal(chart.notes.find((n) => n.lane === 2).ghost, false); // blue + N 40: N 40 is the red ghost, so no effect
  assert.equal(chart.fills.length, 1);
  assert.equal(chart.rolls[0].type, 'tremolo');
});

test('drums: ghost flags (N 39 + pad) and accent over ghost', () => {
  const midi = parseChart(chartText({ extra: section('ExpertDrums', ['  0 = N 1 0', '  0 = N 40 0', '  192 = N 2 0', '  192 = N 42 0', '  384 = N 3 0', '  384 = N 37 0', '  384 = N 36 0']) }));
  const notes = buildChart(midi, instrumentOptions(midi)[0], EXPERT).notes;
  assert.deepEqual(notes.map((n) => n.ghost), [true, false, false]); // 42 is the blue ghost, on a yellow pad: no effect
  const both = parseChart(chartText({ extra: section('ExpertDrums', ['  0 = N 3 0', '  0 = N 36 0', '  0 = N 42 0']) }));
  const n = buildChart(both, instrumentOptions(both)[0], EXPERT).notes[0];
  assert.equal(n.accent, true); // N 36 = accent + 3 (blue); the accent blocks the ghost
  assert.equal(n.ghost, false);
});

test('drums: cymbal flags make a Pro chart; unflagged pads are toms; markers do not cancel across difficulties', () => {
  const midi = parseChart(chartText({
    extra: section('ExpertDrums', ['  0 = N 2 0', '  0 = N 66 0', '  192 = N 2 0', '  384 = N 3 0', '  384 = N 67 0', '  576 = N 4 0'])
      + section('HardDrums', ['  192 = N 2 0']),
  }));
  const opts = instrumentOptions(midi);
  assert.deepEqual(opts.map((o) => o.id), ['drums-four', 'drums-pro', 'drums-extended']);
  const pro = opts.find((o) => o.id === 'drums-pro');
  const notes = buildChart(midi, pro, EXPERT).notes;
  assert.deepEqual(notes.map((n) => n.cymbal), [true, false, true, false]);
  const four = buildChart(midi, opts[0], EXPERT).notes;
  assert.ok(four.every((n) => !n.cymbal));
  assert.equal(buildChart(midi, pro, DIFFICULTIES[2]).notes[0].cymbal, false);
});

test('drums: green pad (N 5) means 5 lanes', () => {
  const midi = parseChart(chartText({ extra: section('HardDrums', ['  0 = N 4 0', '  192 = N 5 0']) }));
  const opts = instrumentOptions(midi);
  assert.deepEqual(opts.map((o) => o.id), ['drums-five']);
  const chart = buildChart(midi, opts[0], DIFFICULTIES[2]);
  assert.equal(chart.lanes, 5);
  assert.deepEqual(chart.notes.map((n) => n.lane), [3, 4]);
});

test('events: sections, end marker, lyrics and phrases', () => {
  const midi = parseChart(chartText({
    events: ['  0 = E "section Intro"', '  0 = E "music_start"', '  192 = E "phrase_start"', '  192 = E "lyric Hel-"', '  288 = E "lyric lo"',
      '  480 = E "phrase_end"', '  768 = E "section Verse"', '  960 = E "end"'].join('\n'),
    extra: section('ExpertSingle', ['  0 = N 0 0']),
  }));
  const guitar = buildChart(midi, ins('guitar'), EXPERT);
  assert.deepEqual(guitar.sections.map((s) => [s.name, s.time]), [['Intro', 0], ['Verse', 2]]);
  assert.equal(guitar.duration, midi.toSeconds(960));
  assert.ok(instrumentOptions(midi).some((o) => o.id === 'vocals'));
  const vocals = buildChart(midi, ins('vocals'), EXPERT);
  assert.equal(vocals.mode, 'vocals');
  assert.deepEqual(vocals.lyrics.map((l) => l.text), ['Hel-', 'lo']);
});

test('events: phrase_start without phrase_end closes the open phrase (TextEvents.ConvertToPhrases)', () => {
  // Many charts only write phrase_start; the old reader kept only start..end pairs and lost every other lyric.
  const midi = parseChart(chartText({
    events: ['  0 = E "lyric gone"', '  192 = E "phrase_start"', '  192 = E "lyric one"', '  384 = E "phrase_start"',
      '  480 = E "lyric two"', '  768 = E "phrase_start"', '  768 = E "phrase_end"', '  864 = E "lyric three"',
      '  1152 = E "phrase_start"', '  1248 = E "lyric four"'].join('\n'),
    extra: section('ExpertSingle', ['  0 = N 0 0']),
  }));
  const phrases = midi.tracks.find((t) => t.name === 'PART VOCALS').notes.filter((n) => n.pitch === 105);
  assert.deepEqual(phrases.map((p) => [p.tick, p.endTick]), [[192, 384], [384, 768], [768, 1152], [1152, 1249]]);
  const vocals = buildChart(midi, ins('vocals'), EXPERT);
  assert.deepEqual(vocals.lyrics.map((l) => l.text), ['one', 'two', 'three', 'four']); // 'gone' is outside every phrase
});

test('GHL, co-op and unknown sections are skipped; a missing [Song] is an error', () => {
  const midi = parseChart(chartText({ extra: section('ExpertGHLGuitar', ['  0 = N 0 0']) + section('ExpertDoubleGuitar', ['  0 = N 0 0']) }));
  assert.deepEqual(instrumentOptions(midi), []);
  assert.throws(() => parseChart('[SyncTrack]\n{\n}\n'), /\[Song\]/);
});

test('per difficulty: star power, solo and forced/tap/open flags stay in their own difficulty', () => {
  const midi = parseChart(chartText({
    extra: section('ExpertSingle', ['  0 = N 0 0', '  65 = N 1 0', '  65 = N 5 0', '  400 = N 2 0', '  400 = N 6 0', '  800 = N 7 0', '  0 = S 2 100', '  0 = E solo', '  100 = E soloend'])
      + section('HardSingle', ['  0 = N 0 0', '  65 = N 1 0', '  400 = N 2 0', '  800 = N 0 0', '  300 = S 2 50', '  300 = E solo', '  350 = E soloend']),
  }));
  const expert = buildChart(midi, ins('guitar'), EXPERT);
  const hard = buildChart(midi, ins('guitar'), DIFFICULTIES[2]);
  assert.deepEqual(expert.starPower.map((s) => s.start), [0]);
  assert.deepEqual(hard.starPower.map((s) => s.start), [midi.toSeconds(300)]);
  assert.deepEqual(expert.solos.map((s) => s.end), [midi.toSeconds(100)]);
  assert.deepEqual(hard.solos.map((s) => s.end), [midi.toSeconds(350)]);
  assert.equal(expert.notes[1].hopo, false); // natural, forced to strum
  assert.equal(hard.notes[1].hopo, true); // same notes without the force
  assert.equal(expert.notes[2].tap, true);
  assert.equal(hard.notes[2].tap, false);
  assert.equal(expert.notes[3].open, true);
  assert.equal(hard.notes[3].open, false);
});

test('per difficulty: drum fills, rolls and cymbal flags do not leak', () => {
  const midi = parseChart(chartText({
    extra: section('ExpertDrums', ['  0 = N 2 0', '  0 = N 66 0', '  48 = N 2 0', '  0 = S 65 96', '  500 = S 64 100'])
      + section('HardDrums', ['  0 = N 2 0', '  192 = N 1 0', '  224 = N 2 0', '  256 = N 1 0', '  192 = S 66 96']),
  }));
  const pro = instrumentOptions(midi).find((o) => o.id === 'drums-pro');
  const expert = buildChart(midi, pro, EXPERT);
  const hard = buildChart(midi, pro, DIFFICULTIES[2]);
  assert.deepEqual(expert.rolls.map((r) => r.type), ['tremolo']);
  assert.deepEqual(hard.rolls.map((r) => r.type), ['trill']);
  assert.equal(expert.fills.length, 1);
  assert.equal(hard.fills.length, 0);
  // The same tick: Expert flags the yellow as a cymbal, Hard leaves it a tom, and neither marker affects the other.
  assert.equal(expert.notes[0].cymbal, true);
  assert.equal(hard.notes[0].cymbal, false);
});
