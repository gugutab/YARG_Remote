// Hostile / malformed MIDI input and text decoding. The hostile cases run parseMidi in a worker with a 2 s limit, so a
// regression (an endless parse loop) fails the test instead of hanging the suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { parseMidi } from '../src/midi.js';
import { phraseWindows, buildChart, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { buildMidi, on, off, event, trackName, vlq } from './smf.js';

const MIDI_URL = new URL('../src/midi.js', import.meta.url).href;
const WORKER_CODE = `
const { workerData, parentPort } = require('node:worker_threads');
import(workerData.url).then((m) => {
  try {
    const midi = m.parseMidi(workerData.bytes);
    parentPort.postMessage({ ok: true, tracks: midi.tracks.length });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String(e && e.message) });
  }
});`;

function parseGuarded(bytes, ms = 2000) {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_CODE, { eval: true, workerData: { url: MIDI_URL, bytes } });
    const timer = setTimeout(() => { worker.terminate(); resolve({ timeout: true }); }, ms);
    worker.once('message', (m) => { clearTimeout(timer); worker.terminate(); resolve(m); });
    worker.once('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e.message) }); });
  });
}

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
// A one-track file whose track body is exactly `body` (no end-of-track added).
function rawFile(body, { division = 480, declaredLen = body.length, tracks = 1 } = {}) {
  return new Uint8Array([...ascii('MThd'), ...be32(6), 0, 1, 0, tracks, (division >> 8) & 255, division & 255,
    ...ascii('MTrk'), ...be32(declaredLen), ...body]);
}
async function assertInvalid(bytes, label) {
  const r = await parseGuarded(bytes);
  assert.ok(!r.timeout, `${label}: parse did not finish in 2 s`);
  assert.equal(r.ok, false, `${label}: expected an error`);
  assert.match(r.error, /Invalid MIDI|Not a valid MIDI/, label);
}

test('a 5-byte VLQ meta length (ff ff ff ff 78) is rejected instead of looping', async () => {
  await assertInvalid(rawFile([0, 0xff, 0x01, 0xff, 0xff, 0xff, 0xff, 0x78, 0x41, 0x42]), 'meta length');
});

test('a 5-byte VLQ delta time is rejected', async () => {
  await assertInvalid(rawFile([0xff, 0xff, 0xff, 0xff, 0x7f, 0x90, 60, 100]), 'delta');
});

test('a sysex with a hostile length is rejected', async () => {
  await assertInvalid(rawFile([0, 0xf0, 0xff, 0xff, 0xff, 0xff, 0x78, 1, 2]), 'sysex length');
});

test('meta and sysex lengths past the end of the track are rejected', async () => {
  await assertInvalid(rawFile([0, 0xff, 0x01, 0x10, 0x41]), 'meta past end');
  await assertInvalid(rawFile([0, 0xf0, 0x10, 0x41]), 'sysex past end');
});

test('truncated events and tracks are rejected, not returned as a silent partial chart', async () => {
  await assertInvalid(rawFile([0, 0x90, 60]), 'note-on without velocity');
  await assertInvalid(rawFile([0, 0xc0]), 'program change without data');
  await assertInvalid(rawFile([0x81]), 'VLQ cut off');
  await assertInvalid(rawFile([0, 0xff]), 'meta without type');
  await assertInvalid(rawFile([0, 0x90, 60, 100], { declaredLen: 400 }), 'track longer than the file');
});

test('system bytes 0xf1-0xfe are not parsed as channel events', async () => {
  for (const status of [0xf1, 0xf2, 0xf3, 0xf6, 0xf8, 0xfe]) {
    await assertInvalid(rawFile([0, status, 60, 100]), `status ${status.toString(16)}`);
  }
});

test('running status before any status byte is rejected', async () => {
  await assertInvalid(rawFile([0, 60, 100]), 'no status');
});

test('division 0 throws instead of producing Infinity/NaN times', async () => {
  await assertInvalid(rawFile([0, 0xff, 0x2f, 0], { division: 0 }), 'division 0');
  assert.throws(() => parseMidi(rawFile([0, 0xff, 0x2f, 0], { division: 0 })), /Invalid MIDI/);
});

test('a header that is truncated or lies about its length is rejected', async () => {
  await assertInvalid(new Uint8Array([...ascii('MThd'), ...be32(6), 0, 1]), 'short header');
  await assertInvalid(new Uint8Array([...ascii('MThd'), ...be32(0x7fffffff), 0, 1, 0, 1, 1, 0xe0]), 'header length');
});

test('files over the size cap and event counts over the cap are rejected', () => {
  assert.throws(() => parseMidi(rawFile([0, 0xff, 0x2f, 0]), { maxBytes: 10 }), /Invalid MIDI/);
  const notes = [];
  for (let i = 0; i < 20; i++) notes.push(0, 0x90, 60, 100);
  assert.throws(() => parseMidi(rawFile(notes), { maxEvents: 10 }), /Invalid MIDI/);
  assert.doesNotThrow(() => parseMidi(rawFile(notes), { maxEvents: 100 }));
});

test('a very long text event parses (no String.fromCharCode(...bigArray) stack overflow)', () => {
  const big = new Uint8Array(300000).fill(0x61);
  const head = [0, 0xff, 0x01, ...vlq(big.length)];
  const tail = [0, 0xff, 0x2f, 0];
  const body = new Uint8Array(head.length + big.length + tail.length);
  body.set(head);
  body.set(big, head.length);
  body.set(tail, head.length + big.length);
  const midi = parseMidi(rawFile(body));
  assert.equal(midi.tracks[0].texts[0].text.length, 300000);
});

test('well-formed files still parse (sanity)', () => {
  const bytes = buildMidi(480, [[{ dt: 0, bytes: trackName('PART GUITAR') }, on(0, 96), off(240, 96)]]);
  const midi = parseMidi(bytes);
  assert.equal(midi.tracks[0].notes.length, 1);
  assert.equal(midi.tracks[0].notes[0].endTick, 240);
});

test('text events decode UTF-8, fall back to Latin-1, and keep ASCII', () => {
  const lyric = (bytes) => ({ dt: 0, bytes: [0xff, 0x05, bytes.length, ...bytes] });
  const midi = parseMidi(buildMidi(480, [[
    { dt: 0, bytes: [0xff, 0x03, 4, 0x56, 0x6f, 0xc3, 0xa7] }, // track name "Voç" in UTF-8
    lyric([0x4f, 0x6c, 0xc3, 0xa1]), // "Olá" UTF-8
    lyric([0x4f, 0x6c, 0xe1]), // "Olá" Latin-1 (invalid as UTF-8)
    lyric(ascii('plain ASCII')),
    lyric([0xe2, 0x82, 0xac, 0x20, 0x4f, 0x6c, 0xe1]), // valid prefix, invalid tail: whole string falls back to Latin-1
  ]]));
  assert.equal(midi.tracks[0].name, 'Voç');
  const lyrics = midi.tracks[0].lyrics.map((l) => l.text);
  assert.equal(lyrics[0], 'Olá');
  assert.equal(lyrics[1], 'Olá');
  assert.equal(lyrics[2], 'plain ASCII');
  assert.equal(lyrics[3], 'â\u0082¬ Olá');
});

// ---- item 7: phraseWindows ----

const sysex = (tick, bytes) => ({ tick, data: new Uint8Array(bytes) });
const ps = (diff, code, value, type = 0) => [0x50, 0x53, 0x00, type, diff, code, value, 0xf7];

test('phraseWindows ignores PhaseShift SysEx with an invalid difficulty byte, short data or the wrong header', () => {
  const track = {
    sysex: [
      sysex(0, ps(4, 1, 1)), sysex(10, ps(4, 1, 0)), // difficulty 4: not 0-3, not 0xff
      sysex(0, ps(200, 1, 1)), sysex(10, ps(254, 1, 0)),
      sysex(0, [0x50, 0x53, 0x00, 0x00, 0x00, 0x01]), // too short: no value byte
      sysex(0, [0x50, 0x53]),
      sysex(0, ps(0, 1, 1, 1)), sysex(10, ps(0, 1, 0, 1)), // type 1
      sysex(0, [0x51, 0x53, 0x00, 0x00, 0x00, 0x01, 0x01, 0xf7]), // wrong header
      sysex(100, ps(1, 1, 1)), sysex(200, ps(1, 1, 0)), // valid: difficulty 1
      sysex(300, ps(0xff, 1, 1)), sysex(400, ps(0xff, 1, 0)), // valid: all difficulties
    ],
  };
  let windows;
  assert.doesNotThrow(() => { windows = phraseWindows(track, 1); });
  assert.deepEqual(windows, [[[300, 400]], [[100, 200], [300, 400]], [[300, 400]], [[300, 400]]]);
});

test('buildChart survives a bad PhaseShift difficulty byte in the track', () => {
  const sysexEvent = (dt, bytes) => event(dt, [0xf0, bytes.length, ...bytes]);
  const bytes = buildMidi(480, [[
    { dt: 0, bytes: trackName('PART GUITAR') },
    sysexEvent(0, ps(4, 1, 1)), sysexEvent(0, [0x50, 0x53, 0x00, 0x00, 0x00, 0x01]),
    on(0, 96), off(240, 96), sysexEvent(0, ps(4, 1, 0)),
  ]]);
  const midi = parseMidi(bytes);
  let chart;
  assert.doesNotThrow(() => { chart = buildChart(midi, INSTRUMENTS.find((i) => i.id === 'guitar'), DIFFICULTIES[3]); });
  assert.equal(chart.notes.length, 1);
});
