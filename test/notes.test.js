import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { buildChart, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { buildMidi, tempo120, trackName } from './smf.js';

const GUITAR = INSTRUMENTS.find((i) => i.id === 'guitar');
const DRUMS = INSTRUMENTS.find((i) => i.id === 'drums');
const EXPERT = DIFFICULTIES[3];

// Track from absolute ticks: notes = [{ tick, pitch, len, vel }] (vel defaults to 100).
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

test('guitar: notes inside a tap window (104) are taps, notes outside are not', () => {
  const midi = trackMidi('PART GUITAR', [
    { tick: 0, pitch: 96, len: 120 },    // inside the tap window [0, 480)
    { tick: 480, pitch: 97, len: 120 },  // after it ends
    { tick: 0, pitch: 104, len: 480 },   // tap window
  ]);
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.deepEqual(chart.notes.map((n) => [n.lane, n.tap]), [[0, true], [1, false]]);
});

test('drums: accent (velocity 127) and ghost (velocity 1) on pads; not on the kick', () => {
  const midi = trackMidi('PART DRUMS', [
    { tick: 0, pitch: 96, len: 120, vel: 127 },   // kick never takes accent or ghost
    { tick: 480, pitch: 98, len: 120, vel: 127 }, // yellow accent
    { tick: 960, pitch: 99, len: 120, vel: 1 },   // blue ghost
    { tick: 1440, pitch: 97, len: 120, vel: 100 },
  ]);
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.deepEqual(chart.notes.map((n) => [n.lane, n.accent, n.ghost]), [
    [-1, false, false], // kick
    [1, true, false],   // yellow accent
    [2, false, true],   // blue ghost
    [0, false, false],  // red
  ]);
});

test('drums: a double kick is a kick with note 95 (one below Expert kick) at the same tick', () => {
  const midi = trackMidi('PART DRUMS', [
    { tick: 0, pitch: 96, len: 120 },
    { tick: 0, pitch: 95, len: 120 },
    { tick: 480, pitch: 96, len: 120 },
  ]);
  const chart = buildChart(midi, DRUMS, EXPERT);
  assert.deepEqual(chart.notes.map((n) => [n.lane, n.doubleKick]), [[-1, true], [-1, false]]);
});
