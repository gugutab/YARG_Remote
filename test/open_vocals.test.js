import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { buildChart, displayLyric, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { buildMidi, tempo120, trackName, text, event, meta } from './smf.js';

const GUITAR = INSTRUMENTS.find((i) => i.id === 'guitar');
const VOCALS = INSTRUMENTS.find((i) => i.id === 'vocals');
const EXPERT = DIFFICULTIES[3];

// PhaseShift SysEx "PS\0", type 0, difficulty, code, value, F7. Code 1 is open, value 1 starts it.
const sysexOpen = (dt, difficulty, value) => event(dt, [0xf0, 8, 0x50, 0x53, 0x00, 0x00, difficulty, 0x01, value, 0xf7]);

test('open notes: notes inside an open SysEx window (Expert) are open; notes outside are not', () => {
  // open window [0, 480); green notes at tick 0 (inside) and 960 (outside); resolution 480
  const midi = parseMidi(buildMidi(480, [[
    tempo120(),
    { dt: 0, bytes: trackName('PART GUITAR') },
    sysexOpen(0, 0x03, 0x01),           // start at tick 0
    { dt: 0, bytes: [0x90, 96, 100] },  // green on at 0
    { dt: 240, bytes: [0x80, 96, 0] },  // off at 240
    sysexOpen(240, 0x03, 0x00),         // end at tick 480
    { dt: 480, bytes: [0x90, 96, 100] }, // green on at 960
    { dt: 240, bytes: [0x80, 96, 0] },
  ]]));
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.deepEqual(chart.notes.map((n) => n.open), [true, false]);
});

test('open windows for Easy do not apply to Expert (difficulty byte is respected)', () => {
  const midi = parseMidi(buildMidi(480, [[
    tempo120(),
    { dt: 0, bytes: trackName('PART GUITAR') },
    sysexOpen(0, 0x00, 0x01),           // Easy only
    { dt: 0, bytes: [0x90, 96, 100] },
    { dt: 240, bytes: [0x80, 96, 0] },
    sysexOpen(240, 0x00, 0x00),
  ]]));
  assert.equal(buildChart(midi, GUITAR, EXPERT).notes[0].open, false);
});

test('vocals: lyrics stored as lyric events (type 5) are read, and bracketed text events are not lyrics', () => {
  const lyric = (s) => event(0, meta(0x05, [...s].map((c) => c.charCodeAt(0))));
  const midi = parseMidi(buildMidi(480, [[
    tempo120(), { dt: 0, bytes: trackName('PART VOCALS') },
    event(0, text('[idle]')),
    lyric('No-'), { dt: 480, bytes: [0x90, 60, 100] }, { dt: 480, bytes: [0x80, 60, 0] },
    lyric('bod-'), { dt: 0, bytes: [0x90, 62, 100] }, { dt: 480, bytes: [0x80, 62, 0] },
  ]]));
  const chart = buildChart(midi, VOCALS, EXPERT);
  assert.deepEqual(chart.lyrics.map((l) => l.text), ['No-', 'bod-']);
  assert.deepEqual(chart.lyrics.map((l) => l.time), [0, 1]); // tick 960 at 120 bpm = 1 s
});

test('vocals: harmonies, percussion and lyrics are read from their tracks', () => {
  const midi = parseMidi(buildMidi(480, [
    [tempo120(), { dt: 0, bytes: trackName('PART VOCALS') }, event(0, text('Hel-')), { dt: 0, bytes: [0x90, 60, 100] },
      { dt: 480, bytes: [0x80, 60, 0] }, { dt: 0, bytes: [0x90, 96, 100] }, { dt: 480, bytes: [0x80, 96, 0] },
      { dt: 0, bytes: [0x90, 97, 100] }, { dt: 480, bytes: [0x80, 97, 0] }],
    [{ dt: 0, bytes: trackName('HARM1') }, { dt: 0, bytes: [0x90, 64, 100] }, { dt: 480, bytes: [0x80, 64, 0] }],
  ]));
  const chart = buildChart(midi, VOCALS, EXPERT);
  assert.deepEqual(chart.notes.map((n) => n.pitch), [60]);
  assert.deepEqual(chart.harmonies.map((h) => [h.part, h.notes.map((n) => n.pitch)]), [[1, [64]]]);
  assert.deepEqual(chart.percussion.map((p) => p.played), [true, false]);
  assert.deepEqual(chart.lyrics.map((l) => l.text), ['Hel-']);
});

test('lyric symbols: timing and scoring markers are not shown; = is a hyphen; § joins syllables', () => {
  assert.equal(displayLyric("it's#"), "it's");
  assert.equal(displayLyric('+'), '');
  assert.equal(displayLyric('bod-'), 'bod-');
  assert.equal(displayLyric('go=ing'), 'go-ing');
  assert.equal(displayLyric('a§b'), 'a‿b');
  assert.equal(displayLyric('ca^t*'), 'cat');
});
