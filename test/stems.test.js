import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioStemsOf, chooseStemVariants } from '../src/library.js';
import { previewWindow } from '../src/preview.js';

const song = (...names) => ({ files: new Map(names.map((n) => [n, { name: n, getFile: async () => ({}) }])) });
const ids = (s, o) => audioStemsOf(s, o).map((x) => x.id);

test('only YARG stem names play; preview and unknown files are left out', () => {
  assert.deepEqual(ids(song('song.ogg', 'guitar.ogg', 'drums_1.ogg', 'preview.ogg', 'extra.ogg', 'notes.mid')), ['drums_1.ogg', 'guitar.ogg', 'song.ogg']);
});

test('a folder with no recognised stem still plays everything but the preview', () => {
  assert.deepEqual(ids(song('audio.ogg', 'track2.mp3', 'preview.mp3')), ['audio.ogg', 'track2.mp3']);
});

test('the same stem in several formats counts once, in YARG format order', () => {
  assert.deepEqual(ids(song('song.mp3', 'song.ogg', 'song.wav')), ['song.ogg']);
});

test('clean and explicit versions are never mixed; explicit is the default', () => {
  const s = song('song.ogg', 'song_clean.ogg', 'vocals_clean.ogg', 'vocals_explicit.ogg', 'guitar.ogg');
  assert.deepEqual(ids(s), ['guitar.ogg', 'song.ogg', 'vocals_explicit.ogg']);
  assert.deepEqual(ids(s, { censor: true }), ['guitar.ogg', 'song_clean.ogg', 'vocals_clean.ogg']);
});

test('a variant that exists alone is used whatever the setting; labels are the canonical stem name', () => {
  const a = audioStemsOf(song('vocals_1_clean.ogg'), { censor: false });
  assert.deepEqual(a.map((x) => [x.id, x.label]), [['vocals_1_clean.ogg', 'vocals_1']]);
  assert.equal(chooseStemVariants([{ name: 'crowd_explicit.ogg' }], { censor: true }).length, 1);
});

test('previewWindow reads ms or seconds keys and defaults the end to 30 s', () => {
  assert.deepEqual(previewWindow({ preview_start_time: 20000, preview_end_time: 50000 }), { start: 20, end: 50 });
  assert.deepEqual(previewWindow({ preview_start_time: 10000 }), { start: 10, end: 40 });
  assert.deepEqual(previewWindow({ preview_start_time: 10000, preview_end_time: 5000 }), { start: 10, end: 40 });
  assert.deepEqual(previewWindow({ preview_start_seconds: 12.5 }), { start: 12.5, end: 42.5 });
  assert.equal(previewWindow({ preview_start_time: 0 }), null);
  assert.equal(previewWindow({ preview_start_time: -1 }), null);
  assert.equal(previewWindow({}), null);
});
