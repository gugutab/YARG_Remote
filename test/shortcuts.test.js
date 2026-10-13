import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, comboOf, effectiveBindings, actionFor, assign, tidy, formatCombo } from '../src/shortcuts.js';

test('every default key and action id is unique', () => {
  const keys = ACTIONS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(ACTIONS.map((a) => a.id)).size, ACTIONS.length);
});

test('comboOf follows the physical key and Shift, and ignores modifiers, Escape and Tab', () => {
  assert.equal(comboOf({ code: 'KeyG', shiftKey: false }), 'KeyG');
  assert.equal(comboOf({ code: 'KeyG', shiftKey: true }), 'Shift+KeyG');
  assert.equal(comboOf({ code: 'ShiftLeft', shiftKey: true }), null);
  assert.equal(comboOf({ code: 'Escape' }), null);
  assert.equal(comboOf({ code: 'Tab' }), null);
});

test('bracket keys: the plain pair moves windows, Shift moves sections', () => {
  assert.equal(actionFor({}, 'BracketRight'), 'focusNext');
  assert.equal(actionFor({}, 'Shift+BracketRight'), 'nextSection');
  assert.equal(actionFor({}, 'Shift+KeyG'), 'visualizerPrev');
  assert.equal(actionFor({}, 'KeyZ'), null);
});

test('overrides replace defaults; an empty text unbinds', () => {
  const b = { loop: 'KeyJ', perf: '' };
  assert.equal(actionFor(b, 'KeyJ'), 'loop');
  assert.equal(actionFor(b, 'KeyR'), null);
  assert.equal(effectiveBindings(b).perf, '');
  assert.equal(actionFor(b, ''), null);
});

test('assigning a key in use swaps the two actions', () => {
  const { bindings, swapped } = assign({}, 'loop', 'KeyL'); // KeyL is the library's
  assert.equal(swapped, 'library');
  assert.equal(effectiveBindings(bindings).loop, 'KeyL');
  assert.equal(effectiveBindings(bindings).library, 'KeyR');
});

test('assigning a free key stores only that override; going back to the default drops it', () => {
  const a = assign({}, 'loop', 'KeyJ');
  assert.deepEqual(a.bindings, { loop: 'KeyJ' });
  assert.equal(a.swapped, null);
  assert.deepEqual(assign(a.bindings, 'loop', 'KeyR').bindings, {});
  assert.deepEqual(tidy({ loop: 'KeyR', nope: 'KeyZ' }), {});
});

test('formatCombo', () => {
  assert.equal(formatCombo('Shift+KeyG'), 'Shift + G');
  assert.equal(formatCombo('BracketLeft'), '[');
  assert.equal(formatCombo('ArrowLeft'), '←');
  assert.equal(formatCombo(''), 'Not set');
});
