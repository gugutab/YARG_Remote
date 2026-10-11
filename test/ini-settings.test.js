import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { parseSongIni, decodeIniBytes, iniBool } from '../src/ini.js';
import { buildChart, chartSettings, drumKind, findTrack, instrumentOptions, availableDifficulties, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { extraRows } from '../src/songinfo.js';
import { buildMidi, tempo120, trackName, text } from './smf.js';

const GUITAR = INSTRUMENTS.find((i) => i.id === 'guitar');
const DRUMS = INSTRUMENTS.find((i) => i.id === 'drums');
const EXPERT = DIFFICULTIES[3];
const enc = (s) => new TextEncoder().encode(s);

// Track from absolute ticks at resolution 480 (notes = [{ tick, pitch, len }]); extra tracks are event lists.
function midiOf(name, notes, ...extraTracks) {
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
  return parseMidi(buildMidi(480, [events, ...extraTracks]));
}

// EVENTS track from [{ tick, text }].
function eventsTrack(list) {
  const events = [{ dt: 0, bytes: trackName('EVENTS') }];
  let last = 0;
  for (const e of list) {
    events.push({ dt: e.tick - last, bytes: text(e.text) });
    last = e.tick;
  }
  return events;
}

// --- song.ini decoding ---

test('song.ini: a UTF-8 BOM is dropped', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('[song]\nname = Café\n')]);
  assert.equal(parseSongIni(bytes).name, 'Café');
  assert.equal(parseSongIni('﻿[song]\nname = X\n').name, 'X'); // also when the text was decoded elsewhere
});

test('song.ini: UTF-16 with a BOM (both byte orders) is decoded', () => {
  const body = '[song]\nname = Ünï\n';
  const le = [0xff, 0xfe];
  const be = [0xfe, 0xff];
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    le.push(c & 255, c >> 8);
    be.push(c >> 8, c & 255);
  }
  assert.equal(parseSongIni(new Uint8Array(le)).name, 'Ünï');
  assert.equal(parseSongIni(new Uint8Array(be)).name, 'Ünï');
});

test('song.ini: invalid UTF-8 falls back to Latin-1 line by line', () => {
  const bytes = new Uint8Array([...enc('[song]\nartist = Caf'), 0xe9, ...enc('\nname = Ünï\n')]); // a lone 0xe9 is not UTF-8
  const ini = parseSongIni(bytes);
  assert.equal(ini.artist, 'Café');
  assert.equal(ini.name, 'Ünï'); // a valid UTF-8 line next to it stays UTF-8
  assert.equal(decodeIniBytes(enc('plain')), 'plain');
});

test('iniBool reads 1 and true like YARG, anything else is false, a missing key is undefined', () => {
  assert.equal(iniBool(1), true);
  assert.equal(iniBool('True'), true);
  assert.equal(iniBool('false'), false);
  assert.equal(iniBool(0), false);
  assert.equal(iniBool(undefined), undefined);
});

// --- HOPO threshold ---

test('chartSettings: HOPO threshold follows hopo_frequency, eighthnote_hopo, hopofreq, then resolution / 3', () => {
  assert.equal(chartSettings({}, 480).hopoThreshold, 160);
  assert.equal(chartSettings({ hopo_frequency: 100 }, 480).hopoThreshold, 100);
  assert.equal(chartSettings({ hopo_frequency: 0, eighthnote_hopo: 1 }, 480).hopoThreshold, 240); // <= 0 falls through
  assert.equal(chartSettings({ eighthnote_hopo: 'True' }, 480).hopoThreshold, 240);
  assert.equal(chartSettings({ eighthnote_hopo: 0 }, 480).hopoThreshold, 160);
  assert.equal(chartSettings({ hopofreq: 1 }, 480).hopoThreshold, 120); // 4 * 480 / 16
  assert.equal(chartSettings({ hopofreq: 5 }, 480).hopoThreshold, 480);
  assert.equal(chartSettings({ hopofreq: 9 }, 480).hopoThreshold, 160); // unknown value: YARG throws, we use the default
  assert.equal(chartSettings({ hopo_frequency: 50, eighthnote_hopo: 1, hopofreq: 1 }, 480).hopoThreshold, 50);
});

test('hopo_frequency / eighthnote_hopo change which notes are natural HOPOs', () => {
  const midi = midiOf('PART GUITAR', [
    { tick: 0, pitch: 96, len: 60 },
    { tick: 200, pitch: 97, len: 60 }, // 200 ticks after the first
  ]);
  const hopos = (ini) => buildChart(midi, GUITAR, EXPERT, ini).notes.map((n) => n.hopo);
  assert.deepEqual(hopos({}), [false, false]); // default limit is 161 ticks
  assert.deepEqual(hopos({ eighthnote_hopo: 1 }), [false, true]); // 240 + 1
  assert.deepEqual(hopos({ hopo_frequency: 199 }), [false, true]); // 199 + 1 = 200
  assert.deepEqual(hopos({ hopo_frequency: 100 }), [false, false]);
});

// --- sustain cutoff ---

test('sustain_cutoff_threshold sets the shortest note that keeps a sustain', () => {
  const midi = midiOf('PART GUITAR', [
    { tick: 0, pitch: 96, len: 100 }, // below the default cutoff of 160
    { tick: 960, pitch: 97, len: 200 },
  ]);
  const sustains = (ini) => buildChart(midi, GUITAR, EXPERT, ini).notes.map((n) => n.length > 0);
  assert.deepEqual(sustains({}), [false, true]);
  assert.deepEqual(sustains({ sustain_cutoff_threshold: 100 }), [true, true]);
  assert.deepEqual(sustains({ sustain_cutoff_threshold: 201 }), [false, false]);
  assert.deepEqual(sustains({ sustain_cutoff_threshold: 0 }), [true, true]); // 0 becomes 1 tick, like MidReader
});

// --- drums ---

test('five_lane_drums forces or forbids the 5-lane mode', () => {
  const plain = midiOf('PART DRUMS', [{ tick: 0, pitch: 97, len: 30 }, { tick: 480, pitch: 100, len: 30 }]);
  const track = findTrack(plain, DRUMS);
  assert.equal(drumKind(track), 'four');
  assert.equal(drumKind(track, { five_lane_drums: 1 }), 'five');
  assert.equal(buildChart(plain, DRUMS, EXPERT, { five_lane_drums: 'True' }).lanes, 5);
  assert.deepEqual(instrumentOptions(plain, { five_lane_drums: 1 }).map((o) => o.drumMode), ['five']);

  const green = midiOf('PART DRUMS', [{ tick: 0, pitch: 97, len: 30 }, { tick: 480, pitch: 101, len: 30 }]);
  const greenTrack = findTrack(green, DRUMS);
  assert.equal(drumKind(greenTrack), 'five');
  assert.equal(drumKind(greenTrack, { five_lane_drums: 0 }), 'four'); // note 101 is ignored
  const chart = buildChart(green, DRUMS, EXPERT, { five_lane_drums: 0 });
  assert.equal(chart.lanes, 4);
  assert.equal(chart.notes.length, 1);
  assert.ok(availableDifficulties(green, DRUMS, { five_lane_drums: 0 }).length > 0);
});

test('pro_drums = false keeps Pro while 110-112 markers exist (the YARG preparser makes it Pro anyway)', () => {
  const midi = midiOf('PART DRUMS', [{ tick: 0, pitch: 97, len: 30 }, { tick: 480, pitch: 98, len: 30 }, { tick: 480, pitch: 110, len: 30 }]);
  assert.equal(drumKind(findTrack(midi, DRUMS), { pro_drums: 0 }), 'pro');
});

// --- star power note ---

test('multiplier_note / star_power_note: only 103 is honoured, and then it stops being a solo', () => {
  const midi = midiOf('PART GUITAR', [
    { tick: 0, pitch: 96, len: 60 },
    { tick: 0, pitch: 103, len: 480 },
    { tick: 960, pitch: 116, len: 480 },
  ]);
  const normal = buildChart(midi, GUITAR, EXPERT);
  assert.equal(normal.solos.length, 1);
  assert.equal(normal.starPower.length, 1);
  assert.equal(normal.starPower[0].start, 1);
  for (const key of ['multiplier_note', 'star_power_note']) {
    const legacy = buildChart(midi, GUITAR, EXPERT, { [key]: 103 });
    assert.equal(legacy.solos.length, 0);
    assert.equal(legacy.starPower.length, 1);
    assert.equal(legacy.starPower[0].start, 0);
  }
  const other = buildChart(midi, GUITAR, EXPERT, { multiplier_note: 110 }); // anything but 103 means 116
  assert.equal(other.solos.length, 1);
  assert.equal(other.starPower[0].start, 1);
});

// --- [music_start] / [music_end] / [end] ---

test('chart.musicStart / musicEnd / duration come from the EVENTS markers', () => {
  const midi = midiOf('PART GUITAR', [{ tick: 0, pitch: 96, len: 60 }], eventsTrack([
    { tick: 0, text: '[section Intro]' },
    { tick: 960, text: '[music_start]' },
    { tick: 9600, text: '[music_end]' },
    { tick: 11520, text: '[end]' },
  ]));
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.equal(chart.musicStart, 1);
  assert.equal(chart.musicEnd, 10);
  assert.equal(chart.duration, 12); // [end] wins over the last note
  assert.equal(buildChart(midi, GUITAR, EXPERT, { end_events: 0 }).duration, 0.0625); // end_events = 0 ignores [end]
});

test('without markers: no musicStart / musicEnd and the duration is the last note', () => {
  const midi = midiOf('PART GUITAR', [{ tick: 0, pitch: 96, len: 480 }], eventsTrack([{ tick: 0, text: '[section Intro]' }]));
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.equal(chart.musicStart, null);
  assert.equal(chart.musicEnd, null);
  assert.equal(chart.duration, 0.5);
});

test('music_start without music_end gives null for both; markers can be written without brackets', () => {
  const only = midiOf('PART GUITAR', [{ tick: 0, pitch: 96, len: 60 }], eventsTrack([{ tick: 480, text: '[music_start]' }]));
  const a = buildChart(only, GUITAR, EXPERT);
  assert.equal(a.musicStart, null);
  assert.equal(a.musicEnd, null);
  const bare = midiOf('PART GUITAR', [{ tick: 0, pitch: 96, len: 60 }], eventsTrack([{ tick: 480, text: 'music_start' }, { tick: 960, text: 'music_end' }]));
  const b = buildChart(bare, GUITAR, EXPERT);
  assert.equal(b.musicStart, 0.5);
  assert.equal(b.musicEnd, 1);
});

test('music_start must be among the first 20 events', () => {
  const filler = Array.from({ length: 25 }, (_, i) => ({ tick: i * 10, text: `[x${i}]` }));
  const late = midiOf('PART GUITAR', [{ tick: 0, pitch: 96, len: 60 }], eventsTrack([...filler, { tick: 400, text: '[music_start]' }, { tick: 500, text: '[music_end]' }]));
  assert.equal(buildChart(late, GUITAR, EXPERT).musicStart, null);
});

// --- extra song.ini rows ---

test('extraRows labels the YARG keys, formats times and booleans, and keeps unknown keys last', () => {
  const rows = extraRows({ ini: { sub_genre: 'Hard Rock', video_start_time: 1500, preview_end_time: 90000, video_loop: 'True', credit_mixed_by: 'Someone', zzz_custom: 'x', charter_drums: 'Dru', tags: 'a, b' } });
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [
    ['Subgenre', 'Hard Rock'], ['Tags', 'a, b'], ['Charter: drums', 'Dru'], ['Credit: mixed by', 'Someone'],
    ['Video start', '0:01.5'], ['Video loops', 'Yes'], ['Preview end', '1:30'], ['zzz_custom', 'x'],
  ]);
});
