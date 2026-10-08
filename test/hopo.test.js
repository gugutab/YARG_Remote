import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { buildChart, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { buildMidi, tempo120, trackName } from './smf.js';

const GUITAR = INSTRUMENTS.find((i) => i.id === 'guitar');
const DRUMS = INSTRUMENTS.find((i) => i.id === 'drums');
const EXPERT = DIFFICULTIES[3];

// Track from absolute ticks at resolution 480: notes = [{ tick, pitch, len }].
function trackMidi(name, notes) {
  const ons = [];
  for (const n of notes) {
    ons.push({ tick: n.tick, order: 1, bytes: [0x90, n.pitch, 100] });
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

// Threshold at resolution 480 is 480 / 3 + 1 = 161 ticks.
test('natural HOPO: a single note close to a note on another fret; not after a long gap, not in chords', () => {
  const midi = trackMidi('PART GUITAR', [
    { tick: 0, pitch: 96, len: 60 },     // green, first note => strum
    { tick: 120, pitch: 97, len: 60 },   // red 120 ticks later => HOPO
    { tick: 480, pitch: 98, len: 60 },   // yellow after a 360 tick gap => strum
    { tick: 600, pitch: 99, len: 60 },   // chord (blue + orange) => strum
    { tick: 600, pitch: 100, len: 60 },
  ]);
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.deepEqual(chart.notes.map((n) => n.hopo), [false, true, false, false, false]);
});

test('forced strum (offset +6) turns a natural HOPO back into a strum', () => {
  const midi = trackMidi('PART GUITAR', [
    { tick: 0, pitch: 96, len: 60 },
    { tick: 120, pitch: 97, len: 60 },   // natural HOPO...
    { tick: 100, pitch: 102, len: 60 },  // ...forced strum window [100, 160) covers it
  ]);
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.equal(chart.notes[1].hopo, false);
});

test('forced HOPO (offset +5) makes a note a HOPO even after a long gap', () => {
  const midi = trackMidi('PART GUITAR', [
    { tick: 0, pitch: 96, len: 60 },
    { tick: 480, pitch: 98, len: 60 },   // 480 tick gap: strum unless forced
    { tick: 400, pitch: 101, len: 200 }, // forced HOPO window [400, 600) covers it
  ]);
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.equal(chart.notes[1].hopo, true);
});

test('drum rolls: 126 is a tremolo lane and 127 a trill lane, as time spans', () => {
  const midi = trackMidi('PART DRUMS', [
    { tick: 0, pitch: 96, len: 120 },
    { tick: 0, pitch: 126, len: 480 },   // tremolo over [0, 0.5) s at 120 bpm
    { tick: 960, pitch: 127, len: 480 }, // trill over [1, 1.5) s
  ]);
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.deepEqual(chart.rolls.map((r) => [r.type, r.start, r.end]), [
    ['tremolo', 0, 0.5],
    ['trill', 1, 1.5],
  ]);
});
