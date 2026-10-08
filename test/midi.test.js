import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { parseSongIni } from '../src/ini.js';
import { buildChart, availableDifficulties, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';

// --- tiny SMF writer used only by tests ---------------------------------------------
function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
function trackChunk(events) {
  // events: [{ dt, bytes }]
  const body = [];
  for (const e of events) body.push(...vlq(e.dt), ...e.bytes);
  body.push(0, 0xff, 0x2f, 0);
  return [...strBytes('MTrk'), ...u32(body.length), ...body];
}
const strBytes = (s) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const meta = (type, data) => [0xff, type, data.length, ...data];
function buildMidi(division, tracks) {
  const header = [...strBytes('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(division)];
  return new Uint8Array([...header, ...tracks.flat()]);
}
const on = (dt, pitch) => ({ dt, bytes: [0x90, pitch, 100] });
const off = (dt, pitch) => ({ dt, bytes: [0x80, pitch, 0] });

test('parses names, tempo and note pairs with durations', () => {
  const tempo = { dt: 0, bytes: meta(0x51, [0x07, 0xa1, 0x20]) }; // 500000 us = 120 bpm
  const midi = parseMidi(buildMidi(480, [
    trackChunk([tempo, { dt: 0, bytes: meta(0x03, strBytes('notes')) }]),
    trackChunk([
      { dt: 0, bytes: meta(0x03, strBytes('PART GUITAR')) },
      on(0, 96), off(480, 96),          // expert green, 1 beat (0.5s)
      on(0, 98), off(0, 98),            // expert yellow, tap
      on(0, 103), off(960, 103),        // solo marker spanning 2 beats
    ]),
  ]));
  assert.equal(midi.division, 480);
  assert.equal(midi.tracks[1].name, 'PART GUITAR');
  const notes = midi.tracks[1].notes;
  assert.equal(notes.length, 3);
  assert.equal(midi.toSeconds(notes[0].endTick) - midi.toSeconds(notes[0].tick), 0.5);
});

test('tick to seconds follows tempo changes', () => {
  // 120 bpm for one bar (4 beats = 1920 ticks), then 60 bpm
  const midi = parseMidi(buildMidi(480, [
    trackChunk([
      { dt: 0, bytes: meta(0x51, [0x07, 0xa1, 0x20]) },
      { dt: 1920, bytes: meta(0x51, [0x0f, 0x42, 0x40]) },
    ]),
  ]));
  assert.equal(midi.toSeconds(1920), 2);
  assert.equal(midi.toSeconds(2400), 3); // 480 ticks at 1 s/beat
});

test('running status and note-on with velocity 0 act as note-off', () => {
  const data = [
    0, 0x90, 60, 90,        // note on (status byte)
    10, 62, 90,             // running status note on
    10, 60, 0,              // note off via velocity 0
    10, 62, 0,
    0, 0xff, 0x2f, 0,
  ];
  const trk = [...strBytes('MTrk'), ...u32(data.length), ...data];
  const midi = parseMidi(buildMidi(480, [trk]));
  const [a, b] = midi.tracks[0].notes;
  assert.equal(a.endTick, 20);
  assert.equal(b.endTick, 30);
});

test('builds expert guitar lanes, sustains and solo spans', () => {
  const midi = parseMidi(buildMidi(480, [
    trackChunk([{ dt: 0, bytes: meta(0x51, [0x07, 0xa1, 0x20]) }]),
    trackChunk([
      { dt: 0, bytes: meta(0x03, strBytes('PART GUITAR')) },
      on(0, 96), off(480, 96),   // green sustain 0.5s
      on(0, 100), off(480, 100), // orange
      on(0, 60), off(480, 60),   // easy green (not in expert chart)
      on(0, 103), off(960, 103),
    ]),
  ]));
  const guitar = INSTRUMENTS.find((i) => i.id === 'guitar');
  assert.deepEqual(availableDifficulties(midi, guitar).map((d) => d.id), ['easy', 'expert']);
  const chart = buildChart(midi, guitar, DIFFICULTIES[3]);
  assert.deepEqual(chart.notes.map((n) => n.lane), [0, 4]);
  assert.equal(chart.notes[0].length, 0.5);
  assert.equal(chart.solos.length, 1);
  assert.equal(chart.solos[0].end - chart.solos[0].start, 1);
});

test('song.ini parsing keeps numbers numeric and ignores other sections', () => {
  const ini = parseSongIni('[other]\nname = no\n[song]\nname = Toys in the Attic\nartist = Aerosmith\nsong_length = 191726\ndiff_guitar = 5\n');
  assert.equal(ini.name, 'Toys in the Attic');
  assert.equal(ini.artist, 'Aerosmith');
  assert.equal(ini.song_length, 191726);
  assert.equal(ini.diff_guitar, 5);
});
