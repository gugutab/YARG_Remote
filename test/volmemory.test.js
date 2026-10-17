import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVolumes, serializeVolumes, remember, recall } from '../src/volmemory.js';

test('remember stores a level and the default level removes it', () => {
  const mem = parseVolumes(null);
  remember(mem, 'stems', 'Guitar', 0.6);
  remember(mem, 'groups', 'drums', 1.2);
  assert.equal(recall(mem, 'stems', 'guitar'), 0.6);
  assert.equal(recall(mem, 'groups', 'DRUMS'), 1.2);
  assert.equal(recall(mem, 'stems', 'bass'), 1);
  remember(mem, 'stems', 'guitar', 1);
  assert.equal(recall(mem, 'stems', 'guitar'), 1);
  assert.deepEqual(mem.stems, {});
});

test('levels are clamped to the slider range', () => {
  const mem = parseVolumes(null);
  remember(mem, 'stems', 'song', 9);
  remember(mem, 'stems', 'vocals', -3);
  assert.equal(recall(mem, 'stems', 'song'), 1.5);
  assert.equal(recall(mem, 'stems', 'vocals'), 0);
});

test('serialize and parse round-trip; malformed input is dropped', () => {
  const mem = parseVolumes(null);
  remember(mem, 'stems', 'drums_1', 0.8);
  assert.deepEqual(parseVolumes(serializeVolumes(mem)), mem);
  assert.deepEqual(parseVolumes('nope'), { stems: {}, groups: {} });
  assert.deepEqual(parseVolumes('{"stems":{"<b>":0.5,"ok":0.5,"bad":"x","one":1},"groups":null}'), { stems: { ok: 0.5 }, groups: {} });
});
