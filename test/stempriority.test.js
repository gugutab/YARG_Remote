import test from 'node:test';
import assert from 'node:assert/strict';
import { dropStems, stemPriority, stemKind } from '../src/stempriority.js';
import { MixStretcher } from '../src/mixstretch.js';

const midi = {
  toSeconds: (t) => t / 100, // 100 ticks per second
  tracks: [
    { name: 'PART GUITAR', notes: [{ tick: 1000, endTick: 1050, pitch: 96 }] }, // 10 s
    { name: 'PART BASS', notes: [{ tick: 9000, endTick: 9050, pitch: 60 }] }, // 90 s
    { name: 'PART DRUMS', notes: [{ tick: 0, endTick: 10, pitch: 30 }, { tick: 6000, endTick: 6010, pitch: 97 }] }, // an animation note, then 60 s
    { name: 'PART VOCALS', notes: [{ tick: 3000, endTick: 3100, pitch: 60 }] }, // 30 s
  ],
};
const stems = ['song', 'guitar', 'bass', 'drums_1', 'vocals', 'crowd'].map((l) => ({ id: `${l}.ogg`, label: l }));

test('stemKind strips the numbered variants', () => {
  assert.equal(stemKind('Drums_2'), 'drums');
  assert.equal(stemKind('song'), 'song');
});

test('dropStems removes the crowd, unless it is the only stem', () => {
  assert.deepEqual(dropStems(stems).map((s) => s.label), ['song', 'guitar', 'bass', 'drums_1', 'vocals']);
  const only = [{ id: 'crowd.ogg', label: 'crowd' }];
  assert.equal(dropStems(only).length, 1);
});

test('stemPriority: song and the instruments playing in [at-5, at+30] come first', () => {
  const { first, rest } = stemPriority(dropStems(stems), midi, 0);
  assert.deepEqual(first, ['song.ogg', 'guitar.ogg', 'vocals.ogg']); // guitar at 10 s, vocals at 30 s (the window end is inclusive)
  assert.deepEqual(rest, ['bass.ogg', 'drums_1.ogg']); // bass at 90 s; the drums' first playable note is at 60 s (the animation note does not count)
});

test('stemPriority: the window follows the start position', () => {
  const { first } = stemPriority(dropStems(stems), midi, 70);
  assert.ok(first.includes('bass.ogg') && !first.includes('drums_1.ogg') && !first.includes('guitar.ogg')); // 65..100 s: the bass (90 s); the drums stopped at 60 s
});

test('stemPriority: no split when everything would come first or last', () => {
  const some = stems.slice(0, 2);
  assert.deepEqual(stemPriority(some, midi, 0), { first: [], rest: [] });
});

test('MixStretcher.addStems joins a stem silently and keeps the existing gains', () => {
  const mix = new MixStretcher(8000);
  mix.setStems([[new Float32Array(100), new Float32Array(100)]]);
  mix.setGains([0.5]);
  mix.addStems([[new Float32Array(300)]]);
  assert.equal(mix.stems.length, 2);
  assert.equal(mix.length, 300);
  assert.deepEqual([...mix.target], [0.5, 1]);
  assert.deepEqual([...mix.current], [1, 0]); // the new stem fades in
});
