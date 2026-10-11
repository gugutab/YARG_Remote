import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi.js';
import { buildChart, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { buildMidi, tempo120, trackName, text, meta } from './smf.js';

const GUITAR = INSTRUMENTS.find((i) => i.id === 'guitar');
const DRUMS = { ...INSTRUMENTS.find((i) => i.id === 'drums'), drumMode: 'four' };
const EXPERT = DIFFICULTIES[3];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

// A track from absolute-tick items: { tick, pitch, len } notes, { tick, text } texts, { tick, bytes } raw events.
function track(name, items, withTempo = true) {
  const evs = [];
  for (const it of items) {
    if (it.pitch !== undefined) {
      evs.push({ tick: it.tick, order: 1, bytes: [0x90, it.pitch, 100] });
      evs.push({ tick: it.tick + it.len, order: 0, bytes: [0x80, it.pitch, 0] });
    } else if (it.text !== undefined) evs.push({ tick: it.tick, order: 1, bytes: text(it.text) });
    else evs.push({ tick: it.tick, order: 1, bytes: it.bytes });
  }
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out = withTempo ? [tempo120()] : [];
  out.push({ dt: 0, bytes: trackName(name) });
  let last = 0;
  for (const e of evs) { out.push({ dt: e.tick - last, bytes: e.bytes }); last = e.tick; }
  return out;
}
const timeSig = (tick, num, denPow) => ({ tick, bytes: meta(0x58, [num, denPow, 24, 8]) });
const build = (tracks) => parseMidi(buildMidi(480, tracks));

test('enhanced opens: note 95 becomes an open note only after the text event', () => {
  const midi = build([track('PART GUITAR', [
    { tick: 0, pitch: 95, len: 100 }, // before the text: ignored
    { tick: 240, text: '[ENHANCED_OPENS]' },
    { tick: 480, pitch: 95, len: 100 },
    { tick: 960, pitch: 96, len: 100 },
  ])]);
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.equal(chart.notes.length, 2);
  assert.deepEqual([chart.notes[0].lane, chart.notes[0].open], [0, true]);
  assert.deepEqual([chart.notes[1].lane, chart.notes[1].open], [0, false]);
});

test('enhanced opens: bare text works and each difficulty uses its own note', () => {
  const midi = build([track('PART GUITAR', [
    { tick: 0, text: 'ENHANCED_OPENS' },
    { tick: 0, pitch: 59, len: 100 }, { tick: 480, pitch: 71, len: 100 }, { tick: 960, pitch: 83, len: 100 },
  ])]);
  DIFFICULTIES.slice(0, 3).forEach((d, i) => {
    const chart = buildChart(midi, GUITAR, d);
    assert.equal(chart.notes.length, 1, d.id);
    assert.equal(chart.notes[0].open, true);
    near(chart.notes[0].time, i * 0.5);
  });
});

test('without the text, note 95 is not a note', () => {
  const midi = build([track('PART GUITAR', [{ tick: 0, pitch: 95, len: 100 }, { tick: 480, pitch: 96, len: 100 }])]);
  assert.equal(buildChart(midi, GUITAR, EXPERT).notes.length, 1);
});

test('drum fills: 120-124 merge into one fill span', () => {
  const midi = build([track('PART DRUMS', [
    { tick: 0, pitch: 97, len: 10 },
    ...[120, 121, 122, 123, 124].map((pitch) => ({ tick: 960, pitch, len: 480 })),
  ])]);
  const { fills } = buildChart(midi, DRUMS, EXPERT);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].kind, 'fill');
  near(fills[0].start, 1);
  near(fills[0].end, 1.5);
});

test('drum fills inside a coda become BRE', () => {
  const midi = build([
    track('PART DRUMS', [
      { tick: 0, pitch: 97, len: 10 },
      { tick: 480, pitch: 120, len: 240 },
      { tick: 4800, pitch: 120, len: 480 },
    ]),
    track('EVENTS', [{ tick: 4000, text: '[coda]' }], false),
  ]);
  const { fills } = buildChart(midi, DRUMS, EXPERT);
  assert.deepEqual(fills.map((f) => f.kind), ['fill', 'bre']);
});

test('guitar BRE: note 120 counts only inside a coda', () => {
  const items = [{ tick: 0, pitch: 96, len: 10 }, { tick: 480, pitch: 120, len: 480 }, { tick: 4800, pitch: 120, len: 480 }];
  const without = build([track('PART GUITAR', items)]);
  assert.deepEqual(buildChart(without, GUITAR, EXPERT).fills, []);
  const withCoda = build([track('PART GUITAR', items), track('EVENTS', [{ tick: 4000, text: '[coda]' }], false)]);
  const { fills } = buildChart(withCoda, GUITAR, EXPERT);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].kind, 'bre');
  near(fills[0].start, 5);
});

test('time signature meta events are parsed', () => {
  const midi = build([track('PART GUITAR', [timeSig(0, 6, 3), timeSig(1920, 3, 2)])]);
  assert.deepEqual(midi.timeSignatures, [{ tick: 0, num: 6, den: 8 }, { tick: 1920, num: 3, den: 4 }]);
});

test('no BEAT track: 4/4 grid by default', () => {
  const midi = build([track('PART GUITAR', [{ tick: 0, pitch: 96, len: 10 }, { tick: 3840, pitch: 96, len: 10 }])]);
  const { beats } = buildChart(midi, GUITAR, EXPERT);
  assert.equal(beats.length, 9); // a line every 0.5 s from tick 0 through the last note at tick 3840
  assert.deepEqual(beats.filter((b) => b.measure).map((b) => b.time), [0, 2, 4]);
  near(beats[1].time, 0.5);
});

test('no BEAT track: 3/4 then 6/8', () => {
  const midi = build([track('PART GUITAR', [
    timeSig(0, 3, 2), timeSig(1440, 6, 3),
    { tick: 0, pitch: 96, len: 10 }, { tick: 2880, pitch: 96, len: 10 },
  ])]);
  const { beats } = buildChart(midi, GUITAR, EXPERT);
  // 3/4: quarter lines (0.5 s) at ticks 0, 480, 960 (measure at 0). 6/8: eighth lines (0.25 s) from tick 1440.
  assert.deepEqual(beats.slice(0, 3).map((b) => [b.time, b.measure]), [[0, true], [0.5, false], [1, false]]);
  const six = beats.filter((b) => b.time >= 1.5);
  near(six[0].time, 1.5);
  assert.equal(six[0].measure, true);
  near(six[1].time, 1.75);
  assert.deepEqual(six.slice(0, 7).map((b) => b.measure), [true, false, false, false, false, false, true]);
  near(six[6].time, 3);
});

test('a BEAT track still wins over the generated grid', () => {
  const midi = build([
    track('PART GUITAR', [{ tick: 0, pitch: 96, len: 10 }, { tick: 1920, pitch: 96, len: 10 }]),
    track('BEAT', [{ tick: 0, pitch: 12, len: 10 }, { tick: 960, pitch: 13, len: 10 }], false),
  ]);
  const { beats } = buildChart(midi, GUITAR, EXPERT);
  assert.deepEqual(beats.map((b) => [b.time, b.measure]), [[0, true], [1, false]]);
});
