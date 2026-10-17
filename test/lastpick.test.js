import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberPick, serializePick, parsePick } from '../src/lastpick.js';

const screen = [
  { optionId: 'drums-five', diffId: 'hard', base: 'drums', active: false },
  { optionId: 'guitar', diffId: 'expert', base: 'guitar', active: true },
];

test('rememberPick: the active instrument comes first and each kind keeps its difficulty', () => {
  const pick = rememberPick(null, screen);
  assert.deepEqual(pick.items.map((i) => i.id), ['guitar', 'drums-five']);
  assert.deepEqual(pick.diffs, { guitar: 'expert', drums: 'hard' });
});

test('rememberPick: difficulties of instruments no longer on screen are kept', () => {
  const prev = { items: [], diffs: { bass: 'medium', guitar: 'easy' } };
  const pick = rememberPick(prev, screen);
  assert.deepEqual(pick.diffs, { bass: 'medium', guitar: 'expert', drums: 'hard' });
});

test('serialize and parse round-trip; malformed input is dropped', () => {
  const pick = rememberPick(null, screen);
  assert.deepEqual(parsePick(serializePick(pick)), pick);
  assert.deepEqual(parsePick('not json'), { items: [], diffs: {}, off: [] });
  assert.deepEqual(parsePick('{"items":[{"id":"<script>"},{"id":"guitar","diff":"expert","base":"guitar"}],"diffs":{"x y":"hard","bass":"medium"}}'),
    { items: [{ id: 'guitar', diff: 'expert', base: 'guitar' }], diffs: { bass: 'medium' }, off: [] });
  assert.deepEqual(parsePick(null), { items: [], diffs: {}, off: [] });
});

test('rememberPick keeps what was switched off, and parsePick drops invalid keys', () => {
  const pick = rememberPick(null, screen, ['vocals', 'vocals', 'bass']);
  assert.deepEqual(pick.off, ['vocals', 'bass']);
  assert.deepEqual(parsePick(serializePick(pick)).off, ['vocals', 'bass']);
  assert.deepEqual(parsePick('{"off":["drums","<b>",5]}').off, ['drums']);
});
