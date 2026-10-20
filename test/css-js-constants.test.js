// Cheap guards for numbers that live twice (CSS and app.js) and for settings ids named in app.js: they read the source text,
// so a change on one side without the other fails here instead of showing up as a layout glitch or a dead setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDefaults } from '../src/settings-schema.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('styles.css');
const app = read('src/app.js');
// app.js and the UI modules split out of it (src/*.js): where the prefs.get ids are read
const appSources = () => fs.readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => read(`src/${f}`)).join('\n');
const claudeMd = read('CLAUDE.md');
const frame = read('src/windowframe.js');
const constant = (name) => {
  const m = new RegExp(`^(?:export )?const ${name} = (\\d+)`, 'm').exec(`${app}\n${frame}`);
  assert.ok(m, `${name} not found in src/app.js or src/windowframe.js`);
  return Number(m[1]);
};

test('WIN_MARGIN is --lib-gap', () => {
  const m = /--lib-gap:\s*(\d+)px/.exec(css);
  assert.ok(m, '--lib-gap not found in styles.css');
  assert.equal(Number(m[1]), constant('WIN_MARGIN'));
});

test('CONTENT_MAX is the default --content-max', () => {
  const m = /^:root\s*\{[^}]*?--content-max:\s*(\d+)px/m.exec(css);
  assert.ok(m, ':root --content-max not found in styles.css');
  assert.equal(Number(m[1]), constant('CONTENT_MAX'));
});

test('INFO_MIN_W is the details pane default width in CSS (.info: var(--info-w, Npx))', () => {
  const m = /\.info\s*\{[^}]*width:\s*var\(--info-w,\s*(\d+)px\)/.exec(css);
  assert.ok(m, '.info width fallback not found in styles.css');
  assert.equal(Number(m[1]), constant('INFO_MIN_W'));
});

test('every --lib-w in CSS is between MIN_LIB_W and LIST_GROW_MAX', () => {
  const widths = [...css.matchAll(/--lib-w:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(widths.length > 0);
  for (const w of widths) {
    assert.ok(w >= constant('MIN_LIB_W'), `--lib-w ${w}px is below MIN_LIB_W`);
    assert.ok(w <= constant('LIST_GROW_MAX'), `--lib-w ${w}px is above LIST_GROW_MAX`);
  }
});

test('CLAUDE.md quotes the current LIST_GROW_MAX', () => {
  assert.ok(claudeMd.includes(`\`LIST_GROW_MAX\` (${constant('LIST_GROW_MAX')} px`), 'update the LIST_GROW_MAX value in CLAUDE.md');
});

test('every key of EFFECTS is a settings id', () => {
  const defaults = buildDefaults();
  const start = app.indexOf('const EFFECTS = {');
  const block = app.slice(start, app.indexOf('\n};', start));
  const keys = [...block.matchAll(/(?:^|[\s,{])'([a-z]+\.[\w.]+)'\s*:/gm)].map((m) => m[1]);
  assert.ok(keys.length > 20, 'EFFECTS keys not parsed');
  for (const k of keys) assert.ok(Object.hasOwn(defaults, k), `EFFECTS['${k}'] has no setting in settings-schema.js`);
  assert.ok(Object.keys(defaults).some((k) => k.startsWith('cards.')), 'the cards.* settings that EFFECTS builds are gone');
});

test('every prefs.get / motionPref id read by app.js (and the modules split out of it) exists in the schema', () => {
  const defaults = buildDefaults();
  const ids = [...appSources().matchAll(/(?:prefs\.get|motionPref)\('([\w.]+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 30, 'prefs.get ids not parsed');
  for (const id of new Set(ids)) assert.ok(Object.hasOwn(defaults, id), `app.js reads '${id}' but settings-schema.js has no such setting`);
});
