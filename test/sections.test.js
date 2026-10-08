import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSectionName, sectionIndexAt } from '../src/chart.js';

test('section names are read from [section ...] and prc events like YARG', () => {
  assert.equal(parseSectionName('[section Verse 1A]'), 'Verse 1A');
  assert.equal(parseSectionName('section Chorus 1'), 'Chorus 1');
  assert.equal(parseSectionName('section_Gtr Solo A'), 'Gtr Solo A');
  assert.equal(parseSectionName('[prc_a]'), 'a');
});

test('texts that are not sections are ignored', () => {
  assert.equal(parseSectionName('[mellow]'), null);
  assert.equal(parseSectionName('[idle_realtime]'), null);
  assert.equal(parseSectionName('[section]'), null);
  assert.equal(parseSectionName('lighting (verse)'), null);
});

test('the playing section is the last one started; before the first, it is the first', () => {
  const sections = [{ time: 5 }, { time: 10 }, { time: 20 }];
  assert.equal(sectionIndexAt(sections, 0), 0);
  assert.equal(sectionIndexAt(sections, 5), 0);
  assert.equal(sectionIndexAt(sections, 9.99), 0);
  assert.equal(sectionIndexAt(sections, 10), 1);
  assert.equal(sectionIndexAt(sections, 25), 2);
});

test('no sections gives -1', () => {
  assert.equal(sectionIndexAt([], 3), -1);
});
