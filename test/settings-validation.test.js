// Validation of the settings that come from outside (localStorage JSON, imported files).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../src/settings.js';
import { SECTIONS, buildDefaults, buildValidator } from '../src/settings-schema.js';
import { THEME_KEYS, presetById } from '../src/themes.js';
import { ACTIONS } from '../src/shortcuts.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const KEY = 'yargremote.settings';
const validate = buildValidator(SECTIONS);
const defaults = buildDefaults();
const load = (obj) => {
  const storage = memory();
  storage.setItem(KEY, JSON.stringify(obj));
  return createSettings({ defaults, validate, storage });
};
const item = (id) => SECTIONS.flatMap((s) => s.items).find((i) => i.id === id);

test('validator: toggle accepts booleans only', () => {
  assert.deepEqual(validate('ui.animations', false), { ok: true, value: false });
  for (const bad of [0, 1, 'true', null, undefined, {}, []]) assert.equal(validate('ui.animations', bad).ok, false, String(bad));
});

test('validator: range needs a finite number, clamps and snaps to the step', () => {
  assert.equal(validate('ui.radius', 7).value, 7);
  assert.equal(validate('ui.radius', 99).value, 20);
  assert.equal(validate('ui.radius', -5).value, 0);
  assert.equal(validate('ui.radius', 7.4).value, 7);
  assert.equal(validate('library.cardScale', 102).value, 100, 'step 5 from 70');
  assert.equal(validate('library.cardScale', 103).value, 105);
  assert.equal(validate('highway.neck', 1.234).value, 1.2, 'no float noise');
  assert.equal(validate('highway.neck', 99).value, 3);
  for (const bad of [NaN, Infinity, -Infinity, '5', null, true, [], {}]) assert.equal(validate('ui.radius', bad).ok, false, String(bad));
});

test('validator: choice only accepts one of the options (numbers stay numbers)', () => {
  assert.equal(validate('ui.font', 'serif').ok, true);
  assert.equal(validate('ui.font', 'comic').ok, false);
  assert.equal(validate('library.columns', 3).ok, true);
  assert.equal(validate('library.columns', 'auto').ok, true);
  assert.equal(validate('library.columns', '3').ok, false);
  assert.equal(validate('library.columns', 9).ok, false);
  assert.equal(validate('ui.font', { toString: () => 'serif' }).ok, false);
  assert.equal(validate('highway.visualizer', 'none').ok, true);
});

test('validator: multi is an array of allowed values, without duplicates', () => {
  assert.deepEqual(validate('details.chips', ['pack', 'year', 'pack', 'evil', 5]), { ok: true, value: ['pack', 'year'] });
  assert.deepEqual(validate('details.chips', []), { ok: true, value: [] });
  assert.equal(validate('details.chips', 'pack').ok, false);
  assert.equal(validate('details.chips', { 0: 'pack' }).ok, false);
});

test('validator: details.sections keeps at least one section (an empty list falls back to the default)', () => {
  assert.deepEqual(validate('details.sections', ['volume']), { ok: true, value: ['volume'] });
  assert.equal(validate('details.sections', []).ok, false);
  assert.equal(validate('details.sections', ['bogus']).ok, false, 'nothing valid left');
  assert.deepEqual(load({ 'details.sections': [] }).get('details.sections'), defaults['details.sections']);
});

test('validator: colour fields need #rrggbb (and are normalised to lower case)', () => {
  assert.deepEqual(validate('highway.stageColor', '#AABBCC'), { ok: true, value: '#aabbcc' });
  for (const bad of ['red', '#abc', '#12345g', 'url(javascript:alert(1))', 'expression(1)', '#aabbcc;x', 12, null]) assert.equal(validate('highway.stageColor', bad).ok, false, String(bad));
});

test('validator: unknown ids and custom items without a rule are refused, and it never throws', () => {
  assert.equal(validate('nope', 1).ok, false);
  assert.equal(validate('__proto__', {}).ok, false);
  assert.equal(validate('constructor', 1).ok, false);
  assert.equal(validate(undefined, 1).ok, false);
  assert.equal(buildValidator([{ items: [{ id: 'x', type: 'choice' }] }])('x', 1).ok, false, 'a malformed schema item is a refusal, not a throw');
  assert.equal(buildValidator([{ items: [{ id: 'y', type: 'text' }] }])('y', 'ok').ok, true);
  assert.equal(buildValidator([{ items: [{ id: 'y', type: 'text' }] }])('y', 'x'.repeat(500)).ok, false);
});

test('validator: theme.preset is auto, a preset id or saved:<safe id>', () => {
  for (const ok of ['auto', 'dark', 'nord', 'saved:my-theme-k3j2', 'saved:abc123']) assert.equal(validate('theme.preset', ok).ok, true, ok);
  for (const bad of ['', 'nope', 'saved:', 'saved:a b', 'saved:<script>', 'saved:' + 'a'.repeat(100), 5, null, {}]) assert.equal(validate('theme.preset', bad).ok, false, String(bad));
});

test('validator: theme.overrides keeps only known keys with hex colours', () => {
  const r = validate('theme.overrides', { accent: '#FF0000', bg: 'red', bogus: '#000000', text: 'url(x)', __proto__x: 1 });
  assert.deepEqual(r, { ok: true, value: { accent: '#ff0000' } });
  assert.deepEqual(validate('theme.overrides', {}), { ok: true, value: {} });
  for (const bad of [[], 'x', null, 5]) assert.equal(validate('theme.overrides', bad).ok, false);
  const polluted = validate('theme.overrides', JSON.parse('{"__proto__":{"accent":"#000000"},"accent":"#111111"}'));
  assert.deepEqual(polluted.value, { accent: '#111111' });
  assert.equal({}.accent, undefined, 'Object.prototype untouched');
});

test('validator: theme.saved is a capped list of complete, valid themes', () => {
  const vars = presetById('nord').vars;
  const good = { id: 'mine-1', name: 'Mine', scheme: 'light', vars };
  const r = validate('theme.saved', [
    good,
    { ...good }, // duplicate id
    { ...good, id: 'bad id!' },
    { ...good, id: 'noname', name: '   ' },
    { ...good, id: 'badvars', vars: { ...vars, accent: 'red' } },
    { ...good, id: 'missingvar', vars: { bg: vars.bg } },
    { ...good, id: 'scheme', scheme: 'neon', name: 'x'.repeat(100) },
    'string', null, 5, [],
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.map((t) => t.id), ['mine-1', 'scheme']);
  assert.equal(r.value[1].scheme, 'dark');
  assert.equal(r.value[1].name.length, 40);
  assert.deepEqual(Object.keys(r.value[0].vars), THEME_KEYS);
  const many = Array.from({ length: 80 }, (_, i) => ({ ...good, id: `t${i}` }));
  assert.equal(validate('theme.saved', many).value.length, 50);
  assert.equal(validate('theme.saved', {}).ok, false);
  assert.equal(validate('theme.saved', 'x').ok, false);
});

test('validator: shortcuts.bindings keeps known action ids with plain key strings', () => {
  const r = validate('shortcuts.bindings', { playPause: 'KeyP', loop: '', back5: 'Shift+ArrowLeft', nope: 'KeyZ', fullscreen: 5, view3d: '<img onerror=1>', settings: 'x'.repeat(80) });
  assert.deepEqual(r, { ok: true, value: { playPause: 'KeyP', loop: '', back5: 'Shift+ArrowLeft' } });
  assert.ok(ACTIONS.some((a) => a.id === 'playPause'));
  for (const bad of [[], 'x', null, 7]) assert.equal(validate('shortcuts.bindings', bad).ok, false);
});

test('stored settings: invalid values fall back to the default, valid ones load, nothing throws', () => {
  const s = load({
    'ui.radius': 500, // clamped
    'ui.animations': 'yes', // wrong type -> default
    'ui.font': 'serif',
    'highway.neck': 'fast',
    'highway.stageColor': 'javascript:alert(1)',
    'theme.preset': 'nord',
    'theme.overrides': { accent: '#123456', evil: 'x' },
    'theme.saved': 'not a list',
    'shortcuts.bindings': { playPause: 'KeyP', nope: 'x' },
    'details.chips': ['pack', 'zzz'],
    'not.a.setting': 1,
  });
  assert.equal(s.get('ui.radius'), 20);
  assert.equal(s.get('ui.animations'), true);
  assert.equal(s.get('ui.font'), 'serif');
  assert.equal(s.get('highway.neck'), defaults['highway.neck']);
  assert.equal(s.get('highway.stageColor'), defaults['highway.stageColor']);
  assert.equal(s.get('theme.preset'), 'nord');
  assert.deepEqual(s.get('theme.overrides'), { accent: '#123456' });
  assert.deepEqual(s.get('theme.saved'), []);
  assert.deepEqual(s.get('shortcuts.bindings'), { playPause: 'KeyP' });
  assert.deepEqual(s.get('details.chips'), ['pack']);
  assert.equal(s.isDefault('ui.animations'), true);
  assert.equal(s.get('not.a.setting'), undefined);
  assert.deepEqual(Object.keys(s.changed()).sort(), ['details.chips', 'shortcuts.bindings', 'theme.overrides', 'theme.preset', 'ui.font', 'ui.radius'].sort());
});

test('stored settings: __proto__ / constructor keys in the JSON do not reach the store', () => {
  const storage = memory();
  storage.setItem(KEY, '{"__proto__":{"polluted":1},"constructor":{"x":1},"ui.radius":3}');
  const s = createSettings({ defaults, validate, storage });
  assert.equal(s.get('ui.radius'), 3);
  assert.equal(s.changed().polluted, undefined);
  assert.equal(Object.getPrototypeOf(s.changed()), Object.prototype);
  assert.equal({}.polluted, undefined);
  const plain = createSettings({ defaults: { a: 1 }, storage: (() => { const m = memory(); m.setItem(KEY, '{"__proto__":{"a":2},"a":5}'); return m; })() }); // no validator
  assert.equal(plain.get('a'), 5);
});

test('stored settings: a throwing validator and garbage JSON both fall back to the defaults', () => {
  const storage = memory();
  storage.setItem(KEY, JSON.stringify({ a: 1 }));
  const s = createSettings({ defaults: { a: 0 }, validate: () => { throw new Error('boom'); }, storage });
  assert.equal(s.get('a'), 0);
  storage.setItem(KEY, '{{{');
  assert.equal(createSettings({ defaults, validate, storage }).get('ui.radius'), 10);
});

test('importJson: valid entries are taken, invalid ones skipped and counted', () => {
  const s = createSettings({ defaults, validate, storage: memory() });
  const text = '{"app":"yarg-remote","version":1,"settings":{"ui.radius":12,"ui.font":"mono","ui.animations":"no","highway.neck":"2","unknown":1,"__proto__":{"x":1},"theme.overrides":{"accent":"#abcdef"},"theme.saved":7}}';
  assert.deepEqual(s.importJson(text), { imported: 3, skipped: 5 });
  assert.equal(s.get('ui.radius'), 12);
  assert.equal(s.get('ui.font'), 'mono');
  assert.equal(s.get('ui.animations'), true);
  assert.deepEqual(s.get('theme.overrides'), { accent: '#abcdef' });
  assert.equal({}.x, undefined);
  assert.deepEqual(s.importJson(JSON.stringify({ app: 'yarg-remote', settings: { 'ui.radius': 999 } })), { imported: 1, skipped: 0 });
  assert.equal(s.get('ui.radius'), 20, 'clamped on import');
  assert.throws(() => s.importJson(JSON.stringify({ app: 'yarg-remote', settings: [1, 2] })), /not a YARG Remote/);
  assert.throws(() => s.importJson(JSON.stringify({ app: 'other', settings: {} })), /not a YARG Remote/);
});

test('an export of valid settings round-trips through the validator unchanged', () => {
  const a = createSettings({ defaults, validate, storage: memory() });
  a.set('ui.radius', 14);
  a.set('details.chips', ['bpm', 'year']);
  a.set('theme.preset', 'saved:x1');
  a.set('theme.overrides', { accent: '#112233' });
  a.set('theme.saved', [{ id: 'x1', name: 'X', scheme: 'dark', vars: presetById('dark').vars }]);
  a.set('shortcuts.bindings', { playPause: 'KeyP' });
  a.set('highway.stageColor', '#101010');
  a.set('library.columns', 2);
  const b = createSettings({ defaults, validate, storage: memory() });
  const res = b.importJson(a.exportJson());
  assert.deepEqual(res, { imported: Object.keys(a.changed()).length, skipped: 0 });
  assert.deepEqual(b.changed(), a.changed());
});

test('every default in the schema passes its own validator', () => {
  for (const [id, value] of Object.entries(defaults)) {
    const r = validate(id, value);
    assert.equal(r.ok, true, id);
    assert.deepEqual(r.value, value, id);
  }
  for (const it of SECTIONS.flatMap((s) => s.items).filter((i) => i.type === 'range')) {
    assert.equal(validate(it.id, it.min).value, it.min, it.id);
    assert.equal(validate(it.id, it.max).ok, true, it.id);
  }
  assert.ok(item('ui.radius'));
});
