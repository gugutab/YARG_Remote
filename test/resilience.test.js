import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createErrorGate } from '../src/errorgate.js';
import { decodeAll } from '../src/stemdecode.js';

test('error gate: first report passes, repeats are held for the interval', () => {
  const gate = createErrorGate(5000);
  assert.equal(gate('a', 0), true);
  assert.equal(gate('a', 16), false);
  assert.equal(gate('a', 4999), false);
  assert.equal(gate('a', 5000), true);
  assert.equal(gate('a', 5016), false);
});

test('error gate: a different message passes at once', () => {
  const gate = createErrorGate(5000);
  assert.equal(gate('a', 0), true);
  assert.equal(gate('b', 1), true);
  assert.equal(gate('a', 2), true);
});

const stems = ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase() }));
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test('decodeAll: all ok', async () => {
  const seen = [];
  const r = await decodeAll(stems, async (s) => s.id + '!', (p) => seen.push(p));
  assert.deepEqual(r.ok.map((o) => o.value), ['a!', 'b!', 'c!']);
  assert.equal(r.failed.length, 0);
  assert.equal(seen.at(-1), 1);
});

test('decodeAll: one failure is skipped and progress still reaches 100%', async () => {
  const seen = [];
  const r = await quiet(() => decodeAll(stems, async (s) => { if (s.id === 'b') throw new Error('bad'); return s.id; }, (p) => seen.push(p)));
  assert.deepEqual(r.ok.map((o) => o.stem.id), ['a', 'c']);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].id, 'b');
  assert.equal(r.failed[0].label, 'B');
  assert.equal(r.failed[0].error.message, 'bad');
  assert.equal(seen.at(-1), 1);
});

test('decodeAll: all fail throws naming the first error', async () => {
  await quiet(() => assert.rejects(
    decodeAll(stems, async (s) => { throw new Error('boom ' + s.id); }),
    (e) => e.message === 'boom a' && e.failedStems.length === 3,
  ));
});

test('decodeAll: a superseded load returns null', async () => {
  let stop = false;
  const r = await decodeAll(stems, async (s) => { if (s.id === 'b') stop = true; return s.id; }, () => {}, () => stop);
  assert.equal(r, null);
});

test('error gate: two messages failing in turn are each limited', () => {
  const gate = createErrorGate(5000);
  let reported = 0;
  for (let frame = 0; frame < 600; frame++) {
    const now = frame * 16;
    if (gate(frame % 2 ? 'draw: a' : 'pane tags: b', now)) reported++;
  }
  assert.equal(reported, 4); // 9.6 s of frames: each message at the start and once more after 5 s (before: 600 reports)
});
