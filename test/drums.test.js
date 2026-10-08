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

test('4-lane drums: kick..green map to columns 0..4, no cymbals', () => {
  const midi = drumsMidi([96, 97, 98, 99, 100].map((pitch, i) => ({ tick: i * 480, pitch, len: 240 })));
  assert.equal(drumKind(midi.tracks[0]), 'four');
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.equal(chart.lanes, 5);
  assert.equal(chart.laneColors.length, 5);
  assert.deepEqual(chart.notes.map((n) => n.lane), [0, 1, 2, 3, 4]);
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
  assert.equal(chart.lanes, 6);
  assert.equal(chart.laneColors.length, 6);
  assert.deepEqual(chart.notes.map((n) => n.lane), [0, 4, 5]);
});

test('pro drums: a cymbal flag marks yellow only while the flag is on', () => {
  const midi = drumsMidi([
    { tick: 0, pitch: 98, len: 120 },    // yellow tom, no flag at this tick
    { tick: 480, pitch: 98, len: 120 },  // yellow cymbal: flag 110 covers it
    { tick: 720, pitch: 100, len: 120 }, // green tom: flag 112 is not on
    { tick: 400, pitch: 110, len: 200 }, // flag 110 on from 400 to 600
  ]);
  assert.equal(drumKind(midi.tracks[0]), 'pro');
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.equal(chart.lanes, 5);
  assert.deepEqual(chart.notes.map((n) => [n.lane, n.cymbal]), [[2, false], [2, true], [4, false]]);
});

test('5-lane cymbal flags: yellow (110) and orange (112) mark cymbals, green (101) never does', () => {
  const midi = drumsMidi([
    { tick: 0, pitch: 98, len: 120 },    // yellow, flag 110 on from 0 to 480 => cymbal
    { tick: 480, pitch: 100, len: 120 }, // orange, flag 112 on from 480 to 720 => cymbal
    { tick: 960, pitch: 100, len: 120 }, // orange, no flag at this tick => tom-style pad
    { tick: 960, pitch: 101, len: 120 }, // green is not a cymbal in 5-lane
    { tick: 0, pitch: 110, len: 480 },
    { tick: 480, pitch: 112, len: 240 },
  ]);
  assert.equal(drumKind(midi.tracks[0]), 'five');
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.equal(chart.lanes, 6);
  assert.deepEqual(chart.notes.map((n) => [n.lane, n.cymbal]), [[2, true], [4, true], [4, false], [5, false]]);
});

test('a pro chart offers Pro and 4-lane drum options; 4-lane mode draws no cymbals', () => {
  const midi = drumsMidi([
    { tick: 0, pitch: 98, len: 120 },
    { tick: 0, pitch: 110, len: 480 },
  ]);
  const labels = instrumentOptions(midi).map((o) => [o.id, o.label]);
  assert.deepEqual(labels, [['drums-pro', 'Bateria (Pro)'], ['drums-four', 'Bateria (4-lanes)']]);

  const pro = buildChart(midi, instrumentOptions(midi)[0], EXPERT);
  assert.deepEqual(pro.notes.map((n) => n.cymbal), [true]);
  const four = buildChart(midi, instrumentOptions(midi)[1], EXPERT);
  assert.equal(four.lanes, 5);
  assert.deepEqual(four.notes.map((n) => [n.lane, n.cymbal]), [[2, false]]);
});

test('a 4-lane chart offers one drum option and a 5-lane chart offers 5-lanes', () => {
  const four = drumsMidi([{ tick: 0, pitch: 96, len: 120 }]);
  assert.deepEqual(instrumentOptions(four).map((o) => o.label), ['Bateria (4-lanes)']);
  const five = drumsMidi([{ tick: 0, pitch: 101, len: 120 }]);
  assert.deepEqual(instrumentOptions(five).map((o) => o.label), ['Bateria (5-lanes)']);
});

test('cymbal flags toggle like YARG: a note inside two overlapping flag windows is not a cymbal', () => {
  const midi = drumsMidi([
    { tick: 100, pitch: 98, len: 60 },  // inside one window => cymbal
    { tick: 400, pitch: 98, len: 60 },  // inside two overlapping windows => toggled off
    { tick: 0, pitch: 110, len: 600 },  // window [0, 600)
    { tick: 300, pitch: 110, len: 600 }, // window [300, 900)
  ]);
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.deepEqual(chart.notes.map((n) => [n.lane, n.cymbal]), [[2, true], [2, false]]);
});
