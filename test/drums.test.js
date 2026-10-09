import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { buildChart, availableDifficulties, drumKind, instrumentOptions, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { buildMidi, tempo120, trackName } from './smf.js';

const DRUMS = INSTRUMENTS.find((i) => i.id === 'drums');
const EXPERT = DIFFICULTIES[3];

// Builds a drum track from absolute ticks: notes = [{ tick, pitch, len }].
function drumsMidi(notes) {
  const ons = [];
  for (const n of notes) {
    ons.push({ tick: n.tick, order: 1, bytes: [0x90, n.pitch, 100] });
    ons.push({ tick: n.tick + n.len, order: 0, bytes: [0x80, n.pitch, 0] });
  }
  ons.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const events = [tempo120(), { dt: 0, bytes: trackName('PART DRUMS') }];
  let last = 0;
  for (const e of ons) {
    events.push({ dt: e.tick - last, bytes: e.bytes });
    last = e.tick;
  }
  return parseMidi(buildMidi(480, [events]));
}

test('4-lane drums: 4 columns (red..green); the kick is a bar, lane -1; no cymbals', () => {
  const midi = drumsMidi([96, 97, 98, 99, 100].map((pitch, i) => ({ tick: i * 480, pitch, len: 240 })));
  assert.equal(drumKind(midi.tracks[0]), 'four');
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.equal(chart.lanes, 4);
  assert.equal(chart.laneColors.length, 4);
  assert.deepEqual(chart.notes.map((n) => n.lane), [-1, 0, 1, 2, 3]);
  assert.ok(chart.notes.every((n) => n.cymbal === false));
});

test('5-lane drums: 100 is orange (column 4), 101 is green (column 5)', () => {
  const midi = drumsMidi([
    { tick: 0, pitch: 96, len: 240 },
    { tick: 480, pitch: 100, len: 240 },
    { tick: 960, pitch: 101, len: 240 },
  ]);
  assert.equal(drumKind(midi.tracks[0]), 'five');
  assert.ok(availableDifficulties(midi, DRUMS).includes(EXPERT));
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.equal(chart.lanes, 5);
  assert.equal(chart.laneColors.length, 5);
  assert.deepEqual(chart.notes.map((n) => n.lane), [-1, 3, 4]);
});

test('pro drums: yellow and green are cymbals by default; a tom marker turns them into toms', () => {
  const midi = drumsMidi([
    { tick: 0, pitch: 98, len: 120 },    // yellow, no marker at this tick => cymbal
    { tick: 480, pitch: 98, len: 120 },  // yellow, marker 110 covers it => tom
    { tick: 720, pitch: 100, len: 120 }, // green, no marker => cymbal
    { tick: 400, pitch: 110, len: 200 }, // marker 110 on from 400 to 600
  ]);
  assert.equal(drumKind(midi.tracks[0]), 'pro');
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.equal(chart.lanes, 4);
  assert.deepEqual(chart.notes.map((n) => [n.lane, n.cymbal]), [[1, true], [1, false], [3, true]]);
});

test('5-lane: yellow, orange cymbal by default, toms under a marker; green is never a cymbal', () => {
  const midi = drumsMidi([
    { tick: 0, pitch: 98, len: 120 },    // yellow, marker 110 covers it => tom
    { tick: 480, pitch: 100, len: 120 }, // orange, marker 112 covers it => tom
    { tick: 960, pitch: 100, len: 120 }, // orange, no marker => cymbal
    { tick: 960, pitch: 101, len: 120 }, // green is not a cymbal in 5-lane
    { tick: 0, pitch: 110, len: 480 },
    { tick: 480, pitch: 112, len: 240 },
  ]);
  assert.equal(drumKind(midi.tracks[0]), 'five');
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.equal(chart.lanes, 5);
  assert.deepEqual(chart.notes.map((n) => [n.lane, n.cymbal]), [[1, false], [3, false], [3, true], [4, false]]);
});

test('a pro chart offers Pro, extended Pro and 4-lane drum options; 4-lane mode draws no cymbals', () => {
  const midi = drumsMidi([
    { tick: 0, pitch: 98, len: 120 },
    { tick: 0, pitch: 110, len: 480 },
  ]);
  const labels = instrumentOptions(midi).map((o) => [o.id, o.label]);
  assert.deepEqual(labels, [['drums-pro', 'Bateria (Pro)'], ['drums-extended', 'Bateria (Pro estendida)'], ['drums-four', 'Bateria (4-lanes)']]);

  // the yellow note sits under the marker 110 (tom), so Pro shows a tom here
  const pro = buildChart(midi, instrumentOptions(midi)[0], EXPERT);
  assert.deepEqual(pro.notes.map((n) => n.cymbal), [false]);
  const four = buildChart(midi, instrumentOptions(midi)[2], EXPERT);
  assert.equal(four.lanes, 4);
  assert.deepEqual(four.notes.map((n) => [n.lane, n.cymbal]), [[1, false]]);
});

test('a 4-lane chart offers one drum option and a 5-lane chart offers 5-lanes', () => {
  const four = drumsMidi([{ tick: 0, pitch: 96, len: 120 }]);
  assert.deepEqual(instrumentOptions(four).map((o) => o.label), ['Bateria (4-lanes)']);
  const five = drumsMidi([{ tick: 0, pitch: 101, len: 120 }]);
  assert.deepEqual(instrumentOptions(five).map((o) => o.label), ['Bateria (5-lanes)']);
});

test('tom markers toggle like YARG: under one marker is a tom, under two overlapping markers is a cymbal again', () => {
  const midi = drumsMidi([
    { tick: 100, pitch: 98, len: 60 },  // inside one window => tom
    { tick: 400, pitch: 98, len: 60 },  // inside two overlapping windows => toggled back to cymbal
    { tick: 0, pitch: 110, len: 600 },  // window [0, 600)
    { tick: 300, pitch: 110, len: 600 }, // window [300, 900)
  ]);
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.deepEqual(chart.notes.map((n) => [n.lane, n.cymbal]), [[1, false], [1, true]]);
});

test('extended pro drums: toms and cymbals each get their own lane (7 lanes), the kick stays a bar', async () => {
  const { EXTENDED_DRUM_LANES, drumModes } = await import('../src/chart.js');
  const midi = drumsMidi([
    { tick: 0, pitch: 96, len: 120 },    // kick
    { tick: 480, pitch: 97, len: 120 },  // red
    { tick: 960, pitch: 98, len: 120 },  // yellow, no marker => cymbal (hi-hat)
    { tick: 1440, pitch: 98, len: 120 }, // yellow with the marker => tom
    { tick: 1400, pitch: 110, len: 200 }, // yellow tom marker over tick 1440
    { tick: 2400, pitch: 99, len: 120 }, // blue, no marker => cymbal
    { tick: 2880, pitch: 100, len: 120 }, // green, no marker => cymbal
  ]);
  assert.ok(drumModes(midi.tracks[0]).some((m) => m.mode === 'extended'));
  const ext = { ...DRUMS, drumMode: 'extended' };
  const chart = buildChart(midi, ext, EXPERT);
  assert.equal(chart.lanes, 7);
  assert.equal(chart.laneColors.length, 7);
  assert.deepEqual(chart.laneKinds, EXTENDED_DRUM_LANES.map((l) => (l.cymbal ? 'cymbal' : 'tom')));
  const laneOf = (tick) => chart.notes.find((n) => Math.abs(n.time - tick / 960) < 1e-6).lane;
  const lane = (pad, cymbal) => EXTENDED_DRUM_LANES.findIndex((l) => l.pad === pad && l.cymbal === cymbal);
  assert.equal(laneOf(0), -1);
  assert.equal(laneOf(480), lane(1, false));
  assert.equal(laneOf(960), lane(2, true));
  assert.equal(laneOf(1440), lane(2, false));
  assert.equal(laneOf(2400), lane(3, true));
  assert.equal(laneOf(2880), lane(4, true));
  // every note of the extended chart sits in a distinct lane per (pad, cymbal) pair and agrees with its flag
  assert.ok(chart.notes.filter((n) => n.lane >= 0).every((n) => chart.laneKinds[n.lane] === (n.cymbal ? 'cymbal' : 'tom')));
  // the plain 4-lane and Pro charts are unchanged
  assert.equal(buildChart(midi, { ...DRUMS, drumMode: 'pro' }, EXPERT).lanes, 4);
});
