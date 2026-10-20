// Per-instrument starting options (src/perinstrument.js), how Highway.paneOpt layers them, and the effective reduced-motion dimming.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrumentDefaults, cleanPerInstrument } from '../src/perinstrument.js';
import { buildValidator, buildDefaults, itemById, setMotionProbe } from '../src/settings-schema.js';
import { Highway } from '../src/highway.js';

const store = (value) => ({ get: (id) => (id === 'highway.perInstrument' ? value : undefined) });

test('instrumentDefaults: only what the user set, for known instruments; old settings (no key) give nothing', () => {
  const s = store({ guitar: { view: '2d', noteStyle: 'round' }, drums: { view: '3d', noteStyle: 'rect', neck: 2 } });
  assert.deepEqual(instrumentDefaults(s, 'guitar'), { view: '2d', noteStyle: 'round' });
  assert.deepEqual(instrumentDefaults(s, 'drums'), { view: '3d', noteStyle: 'rect', neck: 2 });
  assert.deepEqual(instrumentDefaults(s, 'bass'), {});
  assert.deepEqual(instrumentDefaults(s, 'nope'), {});
  assert.deepEqual(instrumentDefaults(store(undefined), 'guitar'), {});
  assert.deepEqual(instrumentDefaults({ guitar: { neck: 1.5 } }, 'guitar'), { neck: 1.5 }, 'the plain value works too');
  assert.equal(buildDefaults()['highway.perInstrument'] && Object.keys(buildDefaults()['highway.perInstrument']).length, 0);
});

test('cleanPerInstrument: strict shape, bad fields and instruments dropped', () => {
  assert.equal(cleanPerInstrument(null).ok, false);
  assert.equal(cleanPerInstrument([]).ok, false);
  assert.equal(cleanPerInstrument('guitar').ok, false);
  assert.deepEqual(cleanPerInstrument({
    guitar: { view: '2d', noteStyle: 'square', neck: 9, extra: 1 },
    bass: { neck: 1.26 },
    banjo: { view: '3d' },
    keys: 'x',
    vocals: {},
  }).value, { guitar: { view: '2d' }, bass: { neck: 1.3 } });
  assert.deepEqual(cleanPerInstrument(JSON.parse('{"__proto__":{"view":"3d"},"drums":{"view":"2d"}}')).value, { drums: { view: '2d' } }, 'a __proto__ key from a file is just dropped');
  const v = buildValidator();
  assert.deepEqual(v('highway.perInstrument', { drums: { view: '3d', neck: 0.5 } }), { ok: true, value: { drums: { view: '3d', neck: 0.5 } } });
  assert.equal(v('highway.perInstrument', 5).ok, false);
});

test('Highway.paneOpt: window override > instrument default > global; the reset returns to the instrument default', () => {
  const h = Object.create(Highway.prototype); // (no canvas needed for the option logic)
  Object.assign(h, { paneOpts: {}, instrumentOpts: {}, view: '3d', noteStyle: 'rect', neck: 1.2, invalidate() {} });
  assert.equal(h.paneOpt('guitar', 'view'), '3d', 'no per-instrument setting: as before');
  h.perInstrument = { guitar: { view: '2d', noteStyle: 'round' }, drums: { neck: 2 } };
  assert.equal(h.paneOpt('guitar', 'view'), '2d');
  assert.equal(h.paneOpt('guitar', 'noteStyle'), 'round');
  assert.equal(h.paneOpt('guitar', 'neck'), 1.2);
  assert.equal(h.paneOpt('drums', 'neck'), 2);
  assert.equal(h.paneOpt('drums', 'view'), '3d');
  assert.equal(h.paneOpt('drums', 'delay'), 0);
  h.setPaneOpt('guitar', 'view', '3d');
  assert.equal(h.paneOpt('guitar', 'view'), '3d', 'the chart menu wins during the session');
  h.clearPaneOpt('guitar', 'view');
  assert.equal(h.paneOpt('guitar', 'view'), '2d', 'its reset goes back to the instrument default');
  assert.equal(h.paneDefault('drums', 'neck'), 2);
  h.perInstrument = {};
  assert.equal(h.paneOpt('guitar', 'view'), '3d');
});

test('reduce motion: the motion rows are dimmed by the effective state (Auto follows the system)', () => {
  const rows = ['ui.animations', 'highway.seekAnimation', 'highway.motionBlur'].map((id) => itemById(id));
  const getFor = (mode) => (id) => (id === 'ui.reduceMotion' ? mode : buildDefaults()[id]);
  try {
    setMotionProbe(() => false);
    for (const it of rows) {
      assert.equal(it.when(getFor('auto')), true, it.id);
      assert.equal(it.when(getFor('on')), false, it.id);
    }
    setMotionProbe(() => true);
    for (const it of rows) {
      assert.equal(it.when(getFor('auto')), false, `${it.id}: auto with the system preference`);
      assert.equal(it.when(getFor('off')), true, `${it.id}: off lets the switch decide`);
    }
  } finally {
    setMotionProbe(() => false);
  }
});

test('leftHanded is kept only as a boolean, per instrument', () => {
  const r = cleanPerInstrument({ guitar: { leftHanded: true }, drums: { leftHanded: 'yes' }, bass: { leftHanded: false, view: '2d' } });
  assert.deepEqual(r.value, { guitar: { leftHanded: true }, bass: { leftHanded: false, view: '2d' } });
  assert.equal(instrumentDefaults(r.value, 'guitar').leftHanded, true);
});
