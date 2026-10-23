import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { buildChart, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { buildKaraokeLines } from '../src/karaoke.js';
import { buildMidi, tempo120, trackName, text, event, meta } from './smf.js';

const VOCALS = INSTRUMENTS.find((i) => i.id === 'vocals');
const HARMONY = INSTRUMENTS.find((i) => i.id === 'harmony');
const EXPERT = DIFFICULTIES[3];
const SEC = 960; // ticks per second at 120 bpm, resolution 480

// A track from absolute-tick items: n(tick, end, pitch), lyric(tick, text), txt(tick, text).
const n = (tick, end, pitch) => [{ tick, order: 1, bytes: [0x90, pitch, 100] }, { tick: end, order: 0, bytes: [0x80, pitch, 0] }];
const lyric = (tick, s) => [{ tick, order: 2, bytes: meta(0x05, [...s].map((c) => c.charCodeAt(0))) }];
const txt = (tick, s) => [{ tick, order: 2, bytes: text(s) }];
function track(name, ...items) {
  let last = 0;
  const events = items.flat(Infinity).sort((a, b) => a.tick - b.tick || a.order - b.order).map((e) => {
    const ev = event(e.tick - last, e.bytes);
    last = e.tick;
    return ev;
  });
  return [tempo120(), { dt: 0, bytes: trackName(name) }, ...events];
}
const chartOf = (instrument, ...tracks) => buildChart(parseMidi(buildMidi(480, tracks)), instrument, EXPERT);

// One phrase (105) of syllables, each with its note: [seconds, length seconds, text, pitch]
const sung = (syls) => syls.flatMap(([s, len, word, pitch = 60]) => [lyric(s * SEC, word), n(s * SEC, (s + len) * SEC, pitch)]);

test('lyrics take the length of their note; lyrics without a note are dropped (FixLyricLengths)', () => {
  const c = chartOf(VOCALS, track('PART VOCALS', n(0, 5 * SEC, 105), sung([[0, 0.5, 'Hel-'], [1, 1.5, 'lo']]), lyric(3 * SEC, 'stray')));
  assert.deepEqual(c.lyrics.map((l) => [l.text, l.time, l.end]), [['Hel-', 0, 0.5], ['lo', 1, 2.5]]);
  assert.equal(c.phrases.length, 1);
});

test('a phrase splits at a gap of 0.4 s but not after a syllable joined to the next', () => {
  const c = chartOf(VOCALS, track('PART VOCALS', n(0, 10 * SEC, 105),
    sung([[0, 0.5, 'a'], [0.7, 0.2, 'b'], [2, 0.5, 'Hel-'], [3, 0.5, 'lo'], [4, 0.2, 'c']])));
  // gap a-b is 0.2 s (kept); b-Hel is 1.1 s (split); Hel- lo has a 1.5 s gap but is joined (kept); lo-c 0.5 s (split)
  assert.deepEqual(c.phrases.map((p) => c.lyrics.slice(p.from, p.to).map((l) => l.text)), [['a', 'b'], ['Hel-', 'lo'], ['c']]);
});

test('a phrase over 50 characters splits at a word boundary', () => {
  const words = Array.from({ length: 10 }, (_, i) => [i * 0.3, 0.25, 'abcdefgh']); // 80 characters, no gaps of 0.4 s
  const c = chartOf(VOCALS, track('PART VOCALS', n(0, 10 * SEC, 105), sung(words)));
  assert.equal(c.phrases.length, 3); // ceil(80 / 37.5) = 3 chunks
  assert.deepEqual(c.phrases.map((p) => p.to - p.from), [4, 4, 2]);
});

test('lyric shift notes (note 1) split a phrase; without them the "/" symbol does', () => {
  const syls = [[0, 0.3, 'one'], [0.4, 0.3, 'two'], [0.8, 0.3, 'three']];
  const shifted = chartOf(VOCALS, track('PART VOCALS', n(0, 3 * SEC, 105), n(0.7 * SEC, 0.75 * SEC, 1), sung(syls)));
  assert.deepEqual(shifted.phrases.map((p) => p.to - p.from), [2, 1]);
  const slash = chartOf(VOCALS, track('PART VOCALS', n(0, 3 * SEC, 105), sung([[0, 0.3, 'one'], [0.4, 0.3, 'two/'], [0.8, 0.3, 'three']])));
  assert.deepEqual(slash.phrases.map((p) => p.to - p.from), [2, 1]);
  assert.equal(slash.lyrics[1].text, 'two');
});

test('"+" continues the previous note and is not a syllable; "#" makes a talkie', () => {
  const c = chartOf(VOCALS, track('PART VOCALS', n(0, 5 * SEC, 105),
    lyric(0, 'la'), n(0, SEC / 2, 60), lyric(SEC / 2, '+'), n(SEC / 2, SEC, 64), lyric(SEC, 'hey#'), n(SEC, 1.5 * SEC, 70)));
  assert.deepEqual(c.lyrics.map((l) => [l.text, l.end]), [['la', 1], ['hey', 1.5]]); // la lasts through its slide
  assert.deepEqual(c.notes.map((x) => [x.pitch, x.slide, x.talkie]), [[60, false, false], [64, true, false], [70, false, true]]);
});

test('range shifts: note 0, [range_shift] text and the % lyric; none is a single range', () => {
  const body = [n(0, 10 * SEC, 105), n(0, SEC, 60), n(2 * SEC, 3 * SEC, 70), n(6 * SEC, 7 * SEC, 50), n(8 * SEC, 9 * SEC, 80)];
  const c = chartOf(VOCALS, track('PART VOCALS', body, n(1.5 * SEC, 2 * SEC, 0), txt(5 * SEC, '[range_shift 0.5]'), lyric(7.5 * SEC, '%')));
  assert.deepEqual(c.rangeShifts.map((r) => [r.time, r.length, r.min, r.max]), [[0, 0, 60, 60], [1.5, 0.5, 70, 70], [5, 0.5, 50, 50], [7.5, 0, 80, 80]]);
  const plain = chartOf(VOCALS, track('PART VOCALS', n(0, 10 * SEC, 105), n(0, SEC, 60), n(2 * SEC, 3 * SEC, 70)));
  assert.deepEqual(plain.rangeShifts.map((r) => [r.min, r.max]), [[60, 70]]);
});

test('harmony: lyrics of HARM2 and HARM3 are merged when HARM1 has none; "$" hides a lyric', () => {
  const phrase = n(0, 5 * SEC, 105);
  const c = chartOf(HARMONY,
    track('HARM1', phrase, n(0, SEC / 2, 60), n(SEC, 1.5 * SEC, 62)),
    track('HARM2', phrase, lyric(0, 'Oh'), n(0, SEC / 2, 64), lyric(SEC, 'yeah'), n(SEC, 1.5 * SEC, 65)),
    track('HARM3', lyric(0, 'oh'), n(0, SEC / 2, 67), lyric(SEC, '$ha'), n(SEC, 1.5 * SEC, 68)));
  assert.deepEqual(c.lyrics.map((l) => l.text), ['oh', 'yeah']); // same word merged (lower case wins); hidden one dropped
  assert.deepEqual(c.harmonies.map((h) => h.part), [2, 3]);
});

test('harmony: different words at the same time are both shown', () => {
  const phrase = n(0, 5 * SEC, 105);
  const c = chartOf(HARMONY,
    track('HARM1', phrase, lyric(0, 'Love'), n(0, SEC / 2, 60)),
    track('HARM2', phrase, lyric(0, 'ooh'), n(0, SEC / 2, 64)));
  assert.deepEqual(c.lyrics.map((l) => l.text), ['Love', 'ooh']);
});

test('without phrases the lyrics are kept as written and the karaoke lines come from time gaps', () => {
  const c = chartOf(VOCALS, track('PART VOCALS', lyric(0, 'a'), n(0, SEC / 2, 60), lyric(SEC, 'b'), n(SEC, 1.5 * SEC, 62), lyric(5 * SEC, 'c'), n(5 * SEC, 6 * SEC, 62)));
  assert.deepEqual(c.phrases, []);
  assert.deepEqual(c.lyrics.map((l) => l.text), ['a', 'b', 'c']);
  assert.deepEqual(buildKaraokeLines(c.lyrics, c.phrases).map((l) => l.syl.map((s) => s.text)), [['a', 'b'], ['c']]);
});

test('karaoke lines follow the chart phrases and use the paired note ends', () => {
  const c = chartOf(VOCALS, track('PART VOCALS', n(0, 5 * SEC, 105), sung([[0, 0.5, 'Hel-'], [0.6, 0.2, 'lo'], [1, 0.5, 'you']])));
  const lines = buildKaraokeLines(c.lyrics, c.phrases);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].syl.map((s) => [s.text, s.join, s.end]), [['Hel', true, 0.5], ['lo', false, 0.8], ['you', false, 1.5]]);
});

test('star power lyrics: a scoring phrase that starts inside a note 116 phrase flags its lyrics (YARG draws them yellow), and the karaoke lines keep it', () => {
  const chart = chartOf(VOCALS, track('PART VOCALS',
    n(0, 2 * SEC, 105), sung([[0, 0.5, 'Hel-'], [0.5, 0.5, 'lo']]),
    n(4 * SEC, 6 * SEC, 105), n(3.5 * SEC, 6.5 * SEC, 116), sung([[4, 0.5, 'Star'], [5, 0.5, 'power']]),
    n(8 * SEC, 10 * SEC, 105), sung([[8, 0.5, 'Plain'], [9, 0.5, 'again']])));
  assert.deepEqual(chart.lyrics.filter((l) => l.sp).map((l) => l.text), ['Star', 'power']);
  assert.equal(chart.lyrics.filter((l) => !l.sp).length, 4);
  const lines = buildKaraokeLines(chart.lyrics, chart.phrases);
  assert.deepEqual(lines.flatMap((l) => l.syl).filter((s) => s.sp).map((s) => s.text), ['Star', 'power']);
});

test('star power lyrics: no 116 phrase, no flag', () => {
  const chart = chartOf(VOCALS, track('PART VOCALS', n(0, 2 * SEC, 105), sung([[0, 0.5, 'Just'], [1, 0.5, 'words']])));
  assert.ok(chart.lyrics.every((l) => !l.sp));
});

test('harmony karaoke: each voice has its own sheet words, the lead\'s words where it sings along, and voice 3 gets one when it has notes', () => {
  const phrase = n(0, 8 * SEC, 105);
  const c = chartOf(HARMONY,
    track('HARM1', phrase, lyric(0, 'Hold'), n(0, SEC / 2, 60), lyric(SEC, 'on'), n(SEC, 1.5 * SEC, 62), lyric(2 * SEC, 'tight'), n(2 * SEC, 2.5 * SEC, 64)),
    track('HARM2', phrase, lyric(SEC, 'ooh'), n(0, SEC / 2, 64), n(SEC, 1.5 * SEC, 65)), // sings along on "Hold" (no word of its own), has its own word on 2nd note
    track('HARM3', phrase, n(2 * SEC, 2.5 * SEC, 67))); // sings along on "tight" only
  const v = c.voiceLyrics;
  assert.deepEqual(v[1].map((l) => l.text), ['Hold', 'on', 'tight']);
  assert.deepEqual(v[2].map((l) => l.text), ['Hold', 'ooh'], 'voice 2: the leads word where it sings along without words, its own word where it has one; nothing where it is silent');
  assert.deepEqual(v[3].map((l) => l.text), ['tight'], 'voice 3 sings along only on the last word');
  assert.ok(v[2][0].shared && !v[2][1].shared);
  const solo = chartOf(VOCALS, track('PART VOCALS', n(0, 2 * SEC, 105), lyric(0, 'a'), n(0, SEC / 2, 60)));
  assert.equal(solo.voiceLyrics ?? null, null, 'a solo chart has no per-voice words');
});
