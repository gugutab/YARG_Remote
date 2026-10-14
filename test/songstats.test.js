import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { buildChart, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { chartFacts, factRows, noteName } from '../src/songstats.js';
import { buildMidi, tempo120, trackName } from './smf.js';

const EXPERT = DIFFICULTIES[3];

function trackMidi(name, notes) {
  const ons = [];
  for (const n of notes) {
    ons.push({ tick: n.tick, order: 1, bytes: [0x90, n.pitch, n.vel ?? 100] });
    ons.push({ tick: n.tick + n.len, order: 0, bytes: [0x80, n.pitch, 0] });
  }
  ons.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const events = [tempo120(), { dt: 0, bytes: trackName(name) }];
  let last = 0;
  for (const e of ons) {
    events.push({ dt: e.tick - last, bytes: e.bytes });
    last = e.tick;
  }
  return parseMidi(buildMidi(480, [events]));
}

test('noteName: MIDI numbers to names (60 is C4)', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(36), 'C2');
  assert.equal(noteName(61), 'C#4');
});

test('fret chart: notes are note events, chords and singles are moments', () => {
  const chart = {
    mode: 'lanes',
    notes: [
      { time: 1, lane: 0, length: 0 }, { time: 1, lane: 1, length: 0 }, { time: 1, lane: 2, length: 0 }, // a chord
      { time: 2, lane: 0, length: 0.5, hopo: true }, { time: 3, lane: 3, length: 0, tap: true }, { time: 4, lane: 0, length: 0, open: true },
    ],
    starPower: [{ start: 1, end: 2 }], solos: [{ start: 3, end: 4 }, { start: 8, end: 9 }],
  };
  const f = chartFacts(chart);
  assert.equal(f.kind, 'frets');
  assert.equal(f.notes, 6);
  assert.equal(f.hits, 4);
  assert.equal(f.chords, 1);
  assert.equal(f.singles, 3);
  assert.deepEqual([f.sustains, f.hopos, f.taps, f.opens, f.starPower, f.solos], [1, 1, 1, 1, 1, 2]);
  const rows = Object.fromEntries(factRows(f).map((r) => [r.label, r.value]));
  assert.equal(rows.Notes, '6');
  assert.equal(rows.Chords, '1');
  assert.equal(rows['Open notes'], '1');
  assert.equal(rows.Accents, undefined); // zero optional facts are left out
});

test('facts are memoized per chart object', () => {
  const chart = { mode: 'lanes', notes: [{ time: 0, lane: 0, length: 0 }] };
  assert.equal(chartFacts(chart), chartFacts(chart));
  assert.equal(chartFacts(null), null);
  assert.deepEqual(factRows(null), []);
});

test('drum chart: kicks, double kicks, cymbals, pads, accents', () => {
  const chart = {
    mode: 'lanes', drumKind: 'pro',
    notes: [
      { time: 0, lane: -1, length: 0, doubleKick: false }, { time: 1, lane: -1, length: 0, doubleKick: true },
      { time: 1, lane: 1, cymbal: true, length: 0 }, { time: 2, lane: 0, cymbal: false, length: 0, accent: true }, { time: 3, lane: 2, cymbal: false, length: 0, ghost: true },
    ],
    rolls: [{ type: 'kick', start: 0, end: 1 }],
    fills: [{ start: 5, end: 6, kind: 'fill' }, { start: 8, end: 9, kind: 'bre' }],
  };
  const f = chartFacts(chart);
  assert.equal(f.kind, 'drums');
  assert.deepEqual([f.notes, f.kicks, f.doubleKicks, f.cymbals, f.pads, f.accents, f.ghosts, f.rolls, f.fills], [5, 2, 1, 1, 2, 1, 1, 1, 1]);
  assert.equal(f.hits, undefined);
});

test('vocal chart: syllables, phrases, talkies, harmony parts and pitch range', () => {
  const chart = {
    mode: 'vocals',
    notes: [{ time: 0, pitch: 60 }, { time: 1, pitch: 72 }, { time: 2, pitch: 66, talkie: true }],
    harmonies: [{ part: 2, notes: [{ time: 0, pitch: 55 }, { time: 1, pitch: 50, talkie: true }] }],
    lyrics: [{ text: 'a' }, { text: 'b' }, { text: 'c' }], phrases: [{ from: 0, to: 2 }, { from: 2, to: 3 }],
    percussion: [{ time: 5 }],
  };
  const f = chartFacts(chart);
  assert.equal(f.kind, 'vocals');
  assert.deepEqual([f.syllables, f.phrases, f.talkies, f.percussion, f.harmonyParts], [3, 2, 2, 1, 2]);
  assert.equal(f.lowest, 55);
  assert.equal(f.highest, 72);
  assert.equal(f.range, 17);
  assert.equal(f.rangeText, 'G3 to C5');
  assert.match(factRows(f).find((r) => r.label === 'Pitch range').value, /17 semitones/);
});

test('vocal chart with only talkies has no pitch range', () => {
  const f = chartFacts({ mode: 'vocals', notes: [{ time: 0, pitch: 60, talkie: true }], lyrics: [], phrases: [] });
  assert.equal(f.rangeText, undefined);
  assert.equal(factRows(f).some((r) => r.label === 'Pitch range'), false);
});

test('built charts: a real buildChart output gives the same counts', () => {
  const guitar = INSTRUMENTS.find((i) => i.id === 'guitar');
  const midi = trackMidi('PART GUITAR', [
    { tick: 0, pitch: 96, len: 120 }, { tick: 0, pitch: 97, len: 120 }, // a chord
    { tick: 480, pitch: 96, len: 480 }, // a sustain
    { tick: 0, pitch: 116, len: 960 }, // star power
  ]);
  const f = chartFacts(buildChart(midi, guitar, EXPERT));
  assert.equal(f.notes, 3);
  assert.equal(f.chords, 1);
  assert.equal(f.singles, 1);
  assert.equal(f.sustains, 1);
  assert.equal(f.starPower, 1);

  const drums = INSTRUMENTS.find((i) => i.id === 'drums');
  const dm = trackMidi('PART DRUMS', [{ tick: 0, pitch: 96, len: 60 }, { tick: 0, pitch: 95, len: 60 }, { tick: 480, pitch: 97, len: 60 }]);
  const d = chartFacts(buildChart(dm, { ...drums, drumMode: 'four' }, EXPERT));
  assert.equal(d.kind, 'drums');
  assert.equal(d.kicks, 1);
  assert.equal(d.pads, 1);
});
