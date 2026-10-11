import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKaraokeLines, karaokeAt, syllableProgress } from '../src/karaoke.js';

const L = (time, text) => ({ time, text });

test('syllables join into words and a pause starts a new line', () => {
  const lines = buildKaraokeLines([L(1, 'Hel-'), L(1.4, 'lo'), L(1.8, 'world'), L(6, 'Next'), L(6.5, 'line')]);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].syl.map((s) => [s.text, s.join]), [['Hel', true], ['lo', false], ['world', false]]);
  assert.equal(lines[1].start, 6);
});

test('a long line breaks at a word boundary, never inside a word', () => {
  const words = Array.from({ length: 20 }, (_, i) => L(i * 0.4, i % 3 === 0 ? 'syl-' : 'word'));
  const lines = buildKaraokeLines(words);
  assert.ok(lines.length > 1);
  for (const l of lines.slice(0, -1)) assert.equal(l.syl[l.syl.length - 1].join, false);
});

test('empty and symbol-only lyrics are skipped', () => {
  assert.deepEqual(buildKaraokeLines([L(1, ''), L(2, '-')]), []);
});

test('karaokeAt: the line being sung and the next one', () => {
  const lines = buildKaraokeLines([L(1, 'a'), L(1.5, 'b'), L(6, 'c'), L(6.5, 'd')]);
  assert.equal(karaokeAt(lines, 1.2).current, lines[0]);
  assert.equal(karaokeAt(lines, 1.2).next, lines[1]);
  assert.equal(karaokeAt(lines, 6.2).current, lines[1]);
  assert.equal(karaokeAt(lines, 6.2).next, null);
});

test('karaokeAt: during a long rest only a near upcoming line shows', () => {
  const lines = buildKaraokeLines([L(1, 'a'), L(1.5, 'b'), L(30, 'c')]);
  assert.equal(karaokeAt(lines, 10).current, null);
  assert.equal(karaokeAt(lines, 10).next, null); // 20 s away
  assert.equal(karaokeAt(lines, 27).next, lines[1]); // 3 s away
  assert.equal(karaokeAt(lines, 0).current, null);
});

test('syllableProgress fills each syllable between its start and end', () => {
  const [line] = buildKaraokeLines([L(1, 'a'), L(2, 'b')]);
  assert.deepEqual(syllableProgress(line, 0.5), [0, 0]);
  assert.deepEqual(syllableProgress(line, 1.5), [0.5, 0]);
  assert.deepEqual(syllableProgress(line, 3), [1, 1]);
});
