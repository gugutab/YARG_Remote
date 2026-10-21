import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { buildChart, markFillNotes, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { buildMidi, tempo120, trackName } from './smf.js';

const DRUMS = INSTRUMENTS.find((i) => i.id === 'drums');
const EXPERT = DIFFICULTIES[3];

// notes = [{ tick, pitch, len }]; `events` = optional text events for an EVENTS track.
function drumsMidi(notes, events = null) {
  const ons = [];
  for (const n of notes) {
    ons.push({ tick: n.tick, order: 1, bytes: [0x90, n.pitch, 100] });
    ons.push({ tick: n.tick + n.len, order: 0, bytes: [0x80, n.pitch, 0] });
  }
  ons.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const drum = [tempo120(), { dt: 0, bytes: trackName('PART DRUMS') }];
  let last = 0;
  for (const e of ons) { drum.push({ dt: e.tick - last, bytes: e.bytes }); last = e.tick; }
  const tracks = [drum];
  if (events) tracks.push(events);
  return parseMidi(buildMidi(480, tracks));
}

// Expert 4-lane: kick 96, red 97, yellow 98. Fill 120 spans ticks 960..1920 (480 ticks = 0.5 s at 120 bpm, so 1 s to 2 s).
const BASE = [
  { tick: 0, pitch: 96, len: 60 },
  { tick: 480, pitch: 97, len: 60 },     // before the fill
  { tick: 960, pitch: 97, len: 60 },     // inside
  { tick: 1440, pitch: 98, len: 60 },    // inside
  { tick: 1920, pitch: 96, len: 60 },    // the chord the fill leads into: kick + yellow + red
  { tick: 1920, pitch: 98, len: 60 },
  { tick: 1920, pitch: 97, len: 60 },
  { tick: 2400, pitch: 97, len: 60 },    // after
  { tick: 960, pitch: 120, len: 960 },
];

test('fill: notes inside are flagged, the activation is the rightmost pad of the chord after the phrase (YARG RightmostNote)', () => {
  const chart = buildChart(drumsMidi(BASE), DRUMS, EXPERT);
  assert.equal(chart.fills.length, 1);
  assert.equal(chart.fills[0].kind, 'fill');
  const rows = chart.notes.map((n) => [Math.round(n.time * 2) / 2, n.lane, n.fill, n.activation]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(rows, [
    [0, -1, false, false],
    [0.5, 0, false, false],
    [1, 0, true, false],
    [1.5, 1, true, false],
    [2, -1, false, false],
    [2, 0, false, false],
    [2, 1, false, true],
    [2.5, 0, false, false],
  ]);
});

test('fill: with no note after the phrase the last note of the chart is the activation', () => {
  const chart = buildChart(drumsMidi(BASE.filter((n) => n.tick < 1800 || n.pitch === 120)), DRUMS, EXPERT);
  const act = chart.notes.filter((n) => n.activation);
  assert.equal(act.length, 1);
  assert.equal(act[0], chart.notes[chart.notes.length - 1]);
});

test('fill: a lone kick on the activation tick is the activation', () => {
  const chart = buildChart(drumsMidi(BASE.filter((n) => n.tick !== 1920 || n.pitch === 96)), DRUMS, EXPERT);
  const act = chart.notes.filter((n) => n.activation);
  assert.deepEqual(act.map((n) => n.lane), [-1]);
});

test('fill: each fill gets its own activation note', () => {
  const notes = BASE.concat([
    { tick: 2880, pitch: 98, len: 60 }, { tick: 3360, pitch: 97, len: 60 }, { tick: 3840, pitch: 96, len: 60 },
    { tick: 2880, pitch: 121, len: 960 },
  ]);
  const chart = buildChart(drumsMidi(notes), DRUMS, EXPERT);
  assert.equal(chart.fills.length, 2);
  assert.equal(chart.notes.filter((n) => n.activation).length, 2);
  assert.equal(chart.notes.filter((n) => n.fill).length, 4);
});

test('no fills, no marks; a BRE (fill inside a coda) marks nothing', () => {
  const plain = buildChart(drumsMidi(BASE.filter((n) => n.pitch !== 120)), DRUMS, EXPERT);
  assert.ok(plain.notes.every((n) => !n.fill && !n.activation));
  const events = [{ dt: 0, bytes: trackName('EVENTS') }, { dt: 0, bytes: [0xff, 0x01, 6, ...Buffer.from('[coda]')] }];
  const bre = buildChart(drumsMidi(BASE, events), DRUMS, EXPERT);
  assert.equal(bre.fills[0].kind, 'bre');
  assert.ok(bre.notes.every((n) => !n.fill && !n.activation));
});

test('markFillNotes is repeatable on a built chart', () => {
  const chart = buildChart(drumsMidi(BASE), DRUMS, EXPERT);
  markFillNotes(chart);
  assert.equal(chart.notes.filter((n) => n.activation).length, 1);
});

test('fill: only the last fill before an activation chord is shown (fillBands), the stats keep every phrase', () => {
  const notes = [
    { tick: 0, pitch: 96, len: 60 },
    { tick: 480, pitch: 97, len: 60 },
    { tick: 960, pitch: 97, len: 60 },
    { tick: 1920, pitch: 98, len: 60 },
    { tick: 500, pitch: 120, len: 100 }, // an earlier fill (ends at 600)
    { tick: 660, pitch: 120, len: 120 }, // the later one (ends at 780): both lead into the note at 960
  ];
  const chart = buildChart(drumsMidi(notes), DRUMS, EXPERT);
  const fills = chart.fills.filter((f) => f.kind === 'fill');
  assert.equal(fills.length, 2);
  assert.equal(chart.fillBands.length, 1);
  assert.equal(chart.fillBands[0], fills[1]);
  assert.equal(fills[0].unpaired, true);
  assert.equal(fills[1].unpaired, false);
  assert.ok(chart.fillBands[0].bandEnd >= chart.fillBands[0].end);
});
