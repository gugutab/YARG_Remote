import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../src/settings.js';
import { PRESETS, presetById, resolveTheme, deriveTheme, isHex, mix, luminance, contrast, readableOn, hexToHue, THEME_KEYS } from '../src/themes.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m };
};

test('settings: defaults, set, reset, only changes are stored', () => {
  const storage = memory();
  const s = createSettings({ defaults: { a: 1, b: 'x', c: { k: [1, 2] } }, storage });
  const seen = [];
  s.subscribe((id, v) => seen.push([id, v]));
  assert.equal(s.get('a'), 1);
  s.set('a', 5);
  assert.equal(s.get('a'), 5);
  assert.equal(s.isDefault('a'), false);
  assert.deepEqual(JSON.parse(storage.getItem('yargremote.settings')), { a: 5 });
  s.set('a', 1); // back to the default: not stored any more
  assert.equal(storage.getItem('yargremote.settings'), null);
  s.set('c', { k: [1, 3] });
  const got = s.get('c');
  got.k.push(9); // a copy: the stored value is not touched
  assert.deepEqual(s.get('c'), { k: [1, 3] });
  s.reset('c');
  assert.deepEqual(s.get('c'), { k: [1, 2] });
  assert.deepEqual(seen.map((e) => e[0]), ['a', 'a', 'c', 'c']);
  s.set('b', 'y');
  s.resetAll();
  assert.equal(s.get('b'), 'x');
});

test('settings: loads what was saved, ignores garbage', () => {
  const storage = memory();
  storage.setItem('yargremote.settings', JSON.stringify({ a: 7 }));
  assert.equal(createSettings({ defaults: { a: 1 }, storage }).get('a'), 7);
  storage.setItem('yargremote.settings', '[1,2');
  assert.equal(createSettings({ defaults: { a: 1 }, storage }).get('a'), 1);
  storage.setItem('yargremote.settings', '[1]');
  assert.equal(createSettings({ defaults: { a: 1 }, storage }).get('a'), 1);
  assert.equal(createSettings({ defaults: { a: 1 }, storage: null }).get('a'), 1); // no storage at all
});

test('settings: export / import keeps known settings only', () => {
  const s = createSettings({ defaults: { a: 1, b: 2 }, storage: memory() });
  s.set('a', 3);
  const text = s.exportJson();
  const t = createSettings({ defaults: { a: 1, b: 2 }, storage: memory() });
  assert.equal(t.importJson(text), 1);
  assert.equal(t.get('a'), 3);
  const withUnknown = JSON.stringify({ app: 'yarg-remote', version: 1, settings: { a: 9, zzz: 1 } });
  assert.equal(t.importJson(withUnknown), 1);
  assert.equal(t.get('a'), 9);
  assert.throws(() => t.importJson('nope'), /valid JSON/);
  assert.throws(() => t.importJson('{"x":1}'), /not a YARG Remote/);
});

test('themes: every preset has every colour, valid hex, and readable text', () => {
  assert.ok(PRESETS.length >= 8);
  for (const p of PRESETS) {
    for (const k of THEME_KEYS) assert.ok(isHex(p.vars[k]), `${p.id}.${k}`);
    assert.ok(contrast(p.vars.text, p.vars.panel) >= 7, `${p.id}: text on panel`);
    assert.ok(contrast(p.vars.muted, p.vars.bg) >= 3.5, `${p.id}: muted on bg`);
    assert.equal(p.scheme === 'light', luminance(p.vars.bg) > 0.4, `${p.id}: scheme matches the background`);
  }
});

test('themes: resolve with overrides, auto and saved themes', () => {
  assert.equal(resolveTheme({ preset: 'nord' }).vars.accent, '#88c0d0');
  assert.equal(resolveTheme({ preset: 'nord', overrides: { accent: '#ff0000', bad: '#123' } }).vars.accent, '#ff0000');
  assert.equal(resolveTheme({ preset: 'nord', overrides: { accent: 'red' } }).vars.accent, '#88c0d0'); // not a hex: ignored
  assert.equal(resolveTheme({ preset: 'auto' }, true).id, 'dark');
  assert.equal(resolveTheme({ preset: 'auto' }, false).id, 'light');
  assert.equal(resolveTheme({ preset: 'nope' }).id, 'dark');
  const saved = [{ id: 'mine', name: 'Mine', scheme: 'light', vars: { ...presetById('light').vars, accent: '#00aa00' } }];
  const t = resolveTheme({ preset: 'saved:mine', saved });
  assert.equal(t.vars.accent, '#00aa00');
  assert.equal(t.scheme, 'light');
  assert.equal(resolveTheme({ preset: 'saved:gone', saved }).id, 'dark'); // a deleted saved theme falls back
});

test('themes: a theme derived from one accent colour is complete and readable', () => {
  for (const scheme of ['dark', 'light']) {
    for (const accent of ['#e5392b', '#3fbf6f', '#2f80ed', '#ffd400', '#bd93f9']) {
      const t = deriveTheme(accent, scheme);
      for (const k of THEME_KEYS) assert.ok(isHex(t[k]), `${scheme} ${accent} ${k}`);
      assert.equal(t.accent, accent);
      assert.ok(contrast(t.text, t.panel) >= 7, `${scheme} ${accent}: text on panel`);
    }
  }
  assert.ok(Math.abs(hexToHue('#ff0000')) < 1);
  assert.ok(Math.abs(hexToHue('#00ff00') - 120) < 1);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(readableOn('#ffd400'), '#101418');
  assert.equal(readableOn('#2f80ed'), '#ffffff');
});
