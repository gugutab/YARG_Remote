// Integrity of the settings schema itself: ids, dependencies (`when`), options, ranges, labels, and that every setting is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SECTIONS, buildDefaults, RENAMES, SETTINGS_VERSION, itemById } from '../src/settings-schema.js';

const src = new URL('../src/', import.meta.url);
const items = SECTIONS.flatMap((s) => s.items.map((it) => ({ ...it, section: s.id })));
const plain = items.filter((it) => it.type !== 'custom');
const defaults = buildDefaults();
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('schema: sections have an id, a title and an icon that exists in index.html; ids are unique', () => {
  const sectionIds = SECTIONS.map((s) => s.id);
  assert.equal(new Set(sectionIds).size, sectionIds.length, 'duplicate section id');
  for (const s of SECTIONS) {
    assert.ok(typeof s.title === 'string' && s.title.trim(), `${s.id}: title`);
    assert.ok(html.includes(`<symbol id="i-${s.icon}"`), `${s.id}: icon i-${s.icon} is not a symbol of index.html`);
  }
  const itemIds = items.map((it) => it.id); // (a custom item's own id may be the one setting it edits, like shortcuts.bindings)
  assert.equal(new Set(itemIds).size, itemIds.length, 'duplicate item id');
  const settingIds = items.flatMap((it) => (it.type === 'custom' ? it.ids : [it.id]));
  const seen = new Set();
  for (const id of settingIds) {
    assert.ok(!seen.has(id), `duplicate setting id ${id}`);
    seen.add(id);
  }
  assert.deepEqual([...seen].sort(), Object.keys(defaults).sort(), 'every setting has a default');
});

test('schema: label is a non-empty string; group, help and keywords are non-empty strings when present', () => {
  for (const it of items) {
    assert.ok(typeof it.label === 'string' && it.label.trim(), `${it.id}: label`);
    for (const k of ['group', 'help', 'keywords']) if (k in it) assert.ok(typeof it[k] === 'string' && it[k].trim(), `${it.id}: ${k}`);
  }
});

test('schema: the items of one group sit together in their section', () => {
  for (const s of SECTIONS) {
    const order = s.items.map((it) => it.group).filter(Boolean);
    const done = new Set();
    order.forEach((g, i) => {
      if (i > 0 && order[i - 1] !== g) assert.ok(!done.has(g), `${s.id}: group "${g}" is split`);
      done.add(g);
    });
  }
});

test('schema: every `when` reads existing ids only, and returns a boolean for the defaults', () => {
  for (const it of items.filter((x) => x.when)) {
    const read = [];
    const get = (id) => {
      read.push(id);
      return defaults[id];
    };
    const r = it.when(get);
    assert.ok(read.length > 0, `${it.id}: when() reads nothing`);
    for (const id of read) assert.ok(Object.hasOwn(defaults, id), `${it.id}: when() reads unknown id ${id}`);
    assert.equal(typeof r, 'boolean', `${it.id}: when() returns ${typeof r}`);
    for (const id of read) {
      const parent = items.findIndex((x) => x.id === id);
      assert.ok(parent < items.findIndex((x) => x.id === it.id), `${it.id} is listed before ${id}, which it depends on`);
    }
  }
});

test('schema: choice and multi options are unique and the default is one of them', () => {
  for (const it of plain.filter((x) => x.type === 'choice' || x.type === 'multi')) {
    const values = it.options.map((o) => o.value);
    assert.equal(new Set(values).size, values.length, `${it.id}: duplicate option`);
    for (const o of it.options) assert.ok(typeof o.label === 'string' && o.label.trim(), `${it.id}: option label`);
    if (it.type === 'choice') assert.ok(values.includes(it.default), `${it.id}: default ${it.default} is not an option`);
    else {
      assert.ok(Array.isArray(it.default) && it.default.every((v) => values.includes(v)), `${it.id}: default`);
      assert.ok(it.default.length >= (it.minItems ?? 0), `${it.id}: default below minItems`);
    }
  }
});

test('schema: ranges have min <= default <= max, the default on a step, and a valid step', () => {
  for (const it of plain.filter((x) => x.type === 'range')) {
    assert.ok(it.min <= it.default && it.default <= it.max, `${it.id}: ${it.min} <= ${it.default} <= ${it.max}`);
    if (Array.isArray(it.values)) { assert.ok(it.values.includes(it.default), `${it.id}: default ${it.default} is one of the allowed values`); continue; } // (a list of allowed values instead of a step)
    assert.ok(it.step > 0, `${it.id}: step`);
    const n = (it.default - it.min) / it.step;
    assert.ok(Math.abs(n - Math.round(n)) < 1e-9, `${it.id}: default ${it.default} is not on a step of ${it.step} from ${it.min}`);
  }
});

test('schema: toggles default to a boolean, colours to #rrggbb', () => {
  for (const it of plain.filter((x) => x.type === 'toggle')) assert.equal(typeof it.default, 'boolean', it.id);
  for (const it of plain.filter((x) => x.type === 'color')) assert.match(it.default, /^#[0-9a-f]{6}$/, it.id);
});

// Ids that the sources build with a template string instead of spelling them out.
const TEMPLATED = [
  /^cards\./, // app.js builds the cards.* EFFECTS keys and reads them as `cards.${mode}.${field}`
];

test('schema: every setting is read somewhere in src/ outside the schema', () => {
  const files = readdirSync(src).filter((f) => f.endsWith('.js') && f !== 'settings-schema.js');
  const text = files.map((f) => readFileSync(new URL(f, src), 'utf8')).join('\n');
  for (const it of plain) {
    if (TEMPLATED.some((re) => re.test(it.id))) continue;
    assert.ok(text.includes(`'${it.id}'`), `${it.id} is never read in src/ (wire it or remove it, with a RENAMES entry if it moved)`);
  }
  assert.ok(plain.some((it) => /^cards\./.test(it.id)), 'the cards.* allow-list has nothing to cover any more');
});

test('schema: every key of the EFFECTS table in app.js is a setting id', () => {
  const app = readFileSync(new URL('app.js', src), 'utf8');
  const start = app.indexOf('const EFFECTS = {');
  const block = app.slice(start, app.indexOf('\n};', start));
  const keys = [...block.matchAll(/(?:^|[\s,{])'([a-z]+\.[\w.]+)'\s*:/gm)].map((m) => m[1]);
  assert.ok(keys.length > 20, 'EFFECTS keys not parsed');
  for (const k of keys) assert.ok(Object.hasOwn(defaults, k), `EFFECTS['${k}'] has no setting`);
});

test('schema: RENAMES point from ids that are gone to ids that exist; the version is a positive integer', () => {
  for (const [from, r] of Object.entries(RENAMES)) {
    assert.ok(!Object.hasOwn(defaults, from), `${from} is renamed but still in the schema`);
    const to = typeof r === 'string' ? r : r.id;
    assert.ok(Object.hasOwn(defaults, to), `${from} -> ${to}: no such setting`);
  }
  assert.ok(Number.isInteger(SETTINGS_VERSION) && SETTINGS_VERSION >= 1);
  assert.equal(itemById('highway.neck').default, defaults['highway.neck']);
  assert.equal(itemById('nope'), undefined);
});
