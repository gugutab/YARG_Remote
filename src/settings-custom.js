// Purpose-built controls of the settings page: the theme studio, the note colours, the per-instrument starting views, the shortcuts and the
// data/backup tools.
import { ACTIONS, SHORTCUT_GROUPS, comboOf, effectiveBindings, assign, formatCombo } from './shortcuts.js';
import { PRESETS, THEME_KEYS, THEME_LABELS, resolveTheme, deriveTheme, contrast, isHex } from './themes.js';
import { resolvePalette, cleanLaneColors, DEFAULT_LANE_COLORS } from './palette.js';
import { PER_INSTRUMENT_BASES, NECK_MIN, NECK_MAX, instrumentDefaults } from './perinstrument.js';

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
};

function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept });
    input.addEventListener('change', async () => resolve(input.files[0] ? await input.files[0].text() : null));
    input.click();
  });
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';

// A little preview of a theme: page, panel, text lines and the accent.
function swatch(vars) {
  return el('span', { class: 'ts-swatch', style: `background:${vars.bg};border-color:${vars.line}` },
    el('i', { class: 'ts-panel', style: `background:${vars.panel};border-color:${vars.line}` },
      el('b', { style: `background:${vars.text}` }), el('b', { style: `background:${vars.muted}` }), el('u', { style: `background:${vars.accent}` })));
}

export function renderThemeStudio(host, { settings, prefersDark = () => true, notify = () => {} }) {
  const gallery = el('div', { class: 'ts-gallery', role: 'listbox', 'aria-label': 'Themes' });
  const editor = el('div', { class: 'ts-editor' });
  const hint = el('p', { class: 'ts-hint' });
  const colorInputs = {};

  const current = () => resolveTheme({ preset: settings.get('theme.preset'), overrides: settings.get('theme.overrides'), saved: settings.get('theme.saved') }, prefersDark());
  const choose = (preset) => { settings.set('theme.preset', preset); settings.set('theme.overrides', {}); };

  function card(id, name, vars, { removable = false } = {}) {
    const btn = el('button', { type: 'button', class: 'ts-card', role: 'option', 'data-id': id, onclick: () => choose(id), title: name }, swatch(vars), el('span', { text: name }));
    const wrap = el('div', { class: 'ts-card-wrap' }, btn);
    if (removable) {
      wrap.append(el('button', { type: 'button', class: 'ts-del', title: `Delete ${name}`, 'aria-label': `Delete the saved theme ${name}`, text: '×', onclick: (e) => {
        e.stopPropagation();
        const saved = settings.get('theme.saved').filter((t) => `saved:${t.id}` !== id);
        if (settings.get('theme.preset') === id) settings.set('theme.preset', 'dark');
        settings.set('theme.saved', saved);
      } }));
    }
    return wrap;
  }

  function buildGallery() {
    gallery.replaceChildren(
      card('auto', 'Auto (system)', resolveTheme({ preset: 'auto' }, prefersDark()).vars),
      ...PRESETS.map((p) => card(p.id, p.name, p.vars)),
      ...settings.get('theme.saved').map((t) => card(`saved:${t.id}`, t.name, t.vars, { removable: true })),
    );
  }

  // Colour editor
  for (const k of THEME_KEYS) {
    const picker = el('input', { type: 'color', 'aria-label': THEME_LABELS[k] });
    const hex = el('input', { type: 'text', class: 'sp-hex', maxlength: '7', spellcheck: 'false', 'aria-label': `${THEME_LABELS[k]} (hex)` });
    const setColor = (v) => settings.set('theme.overrides', { ...settings.get('theme.overrides'), [k]: v });
    picker.addEventListener('input', () => setColor(picker.value));
    hex.addEventListener('change', () => { if (isHex(hex.value.trim())) setColor(hex.value.trim().toLowerCase()); else hex.value = current().vars[k]; });
    colorInputs[k] = { picker, hex };
    editor.append(el('label', { class: 'ts-color' }, el('span', { text: THEME_LABELS[k] }), picker, hex));
  }
  const resetColors = el('button', { type: 'button', class: 'chip-btn', text: 'Reset my colour changes', onclick: () => settings.set('theme.overrides', {}) });

  // Generate from one colour
  const genColor = el('input', { type: 'color', value: '#e5392b', 'aria-label': 'Accent colour to build a theme from' });
  const genScheme = el('select', { 'aria-label': 'Dark or light' }, el('option', { value: 'dark', text: 'Dark' }), el('option', { value: 'light', text: 'Light' }));
  const genBtn = el('button', { type: 'button', class: 'chip-btn', text: 'Generate', onclick: () => {
    settings.set('theme.overrides', deriveTheme(genColor.value, genScheme.value));
  } });

  // Save / import / export
  const nameInput = el('input', { type: 'text', class: 'ts-name', placeholder: 'Name for this theme', maxlength: '40', 'aria-label': 'Theme name' });
  const saveBtn = el('button', { type: 'button', class: 'chip-btn', text: 'Save as new theme', onclick: () => {
    const name = nameInput.value.trim() || 'My theme';
    const t = current();
    const id = `${slug(name)}-${Date.now().toString(36)}`;
    settings.set('theme.saved', [...settings.get('theme.saved'), { id, name, scheme: t.scheme, vars: t.vars }]);
    choose(`saved:${id}`);
    nameInput.value = '';
  } });
  const exportBtn = el('button', { type: 'button', class: 'chip-btn', text: 'Export', onclick: () => {
    const t = current();
    download(`yarg-theme-${slug(t.name)}.json`, JSON.stringify({ app: 'yarg-remote', kind: 'theme', name: t.name, scheme: t.scheme, vars: t.vars }, null, 2));
  } });
  const importBtn = el('button', { type: 'button', class: 'chip-btn', text: 'Import…', onclick: async () => {
    const text = await pickFile('.json,application/json');
    if (text == null) return;
    try {
      const d = JSON.parse(text);
      if (d?.app !== 'yarg-remote' || d.kind !== 'theme' || !THEME_KEYS.every((k) => isHex(d.vars?.[k]))) throw new Error('not a theme file');
      const id = `${slug(d.name)}-${Date.now().toString(36)}`;
      settings.set('theme.saved', [...settings.get('theme.saved'), { id, name: String(d.name || 'Imported theme').slice(0, 40), scheme: d.scheme === 'light' ? 'light' : 'dark', vars: Object.fromEntries(THEME_KEYS.map((k) => [k, d.vars[k]])) }]);
      choose(`saved:${id}`);
    } catch {
      notify('That file is not a YARG Remote theme.');
    }
  } });

  host.append(
    gallery,
    el('h4', { class: 'ts-h', text: 'Colours' }),
    el('p', { class: 'ts-sub', text: 'Pick any colour; it is applied on top of the chosen theme.' }),
    editor, hint,
    el('div', { class: 'ts-actions' }, resetColors),
    el('h4', { class: 'ts-h', text: 'Build a theme from one colour' }),
    el('div', { class: 'ts-actions' }, genColor, genScheme, genBtn),
    el('h4', { class: 'ts-h', text: 'Your themes' }),
    el('div', { class: 'ts-actions' }, nameInput, saveBtn, exportBtn, importBtn),
  );

  return function refresh() {
    buildGallery();
    const preset = settings.get('theme.preset');
    for (const c of gallery.querySelectorAll('.ts-card')) c.setAttribute('aria-selected', String(c.dataset.id === preset));
    const t = current();
    for (const k of THEME_KEYS) {
      colorInputs[k].picker.value = t.vars[k];
      colorInputs[k].hex.value = t.vars[k];
    }
    resetColors.disabled = settings.isDefault('theme.overrides');
    const ratio = contrast(t.vars.text, t.vars.panel);
    hint.textContent = ratio < 4.5 ? `Low contrast between text and panels (${ratio.toFixed(1)}:1): the text may be hard to read.` : `Text contrast on panels: ${ratio.toFixed(1)}:1`;
    hint.classList.toggle('warn', ratio < 4.5);
  };
}

// `addons`: other local data carried in the same backup file under its own top-level key (older builds ignore unknown keys):
// [{ key, export() -> JSON value, import(value) -> message }]. `extra` buttons may ask `confirm` first.
export function renderDataTools(host, { settings, extra = [], addons = [], notify = () => {} }) {
  const status = el('p', { class: 'ts-hint', 'aria-live': 'polite' });
  const say = (m) => { status.textContent = m; notify(m); };
  const exportText = () => {
    if (!addons.length) return settings.exportJson();
    const data = JSON.parse(settings.exportJson());
    for (const a of addons) data[a.key] = a.export();
    return JSON.stringify(data, null, 2);
  };
  const buttons = [
    el('button', { type: 'button', class: 'chip-btn', text: 'Export settings', onclick: () => { download('yarg-remote-settings.json', exportText()); say('Settings exported.'); } }),
    el('button', { type: 'button', class: 'chip-btn', text: 'Import settings…', onclick: async () => {
      const text = await pickFile('.json,application/json');
      if (text == null) return;
      try {
        const { imported, skipped } = settings.importJson(text); // (throws on a file that is not a settings export)
        const data = JSON.parse(text);
        const more = [];
        for (const a of addons) {
          if (!Object.hasOwn(data, a.key)) continue;
          try { more.push(a.import(data[a.key])); } catch (e) { more.push(e.message); }
        }
        say([`Imported ${imported} settings${skipped ? ` (${skipped} skipped)` : ''}.`, ...more].join(' '));
      } catch (e) { say(e.message); }
    } }),
    el('button', { type: 'button', class: 'chip-btn danger', text: 'Reset all settings', onclick: () => {
      if (window.confirm('Reset every setting to its default?')) { settings.resetAll(); say('All settings are back to their defaults.'); }
    } }),
    ...extra.map((x) => el('button', { type: 'button', class: 'chip-btn', text: x.label, title: x.help, onclick: async () => { if (!x.confirm || window.confirm(x.confirm)) say(await x.run()); } })),
  ];
  host.append(el('div', { class: 'ts-actions' }, buttons), status);
  return () => {};
}

// The list of keyboard shortcuts: one row per action; click the key, press the new one (Esc cancels, Backspace clears it).
export function renderShortcuts(host, { settings, notify = () => {} }) {
  const status = el('p', { class: 'ts-hint', 'aria-live': 'polite' });
  const say = (m) => { status.textContent = m; notify(m); };
  const label = (id) => ACTIONS.find((a) => a.id === id)?.label ?? id;
  let capturing = null; // { stop }

  const stopCapture = () => { capturing?.stop(); capturing = null; };
  const startCapture = (id, btn) => {
    stopCapture();
    btn.textContent = 'Press a key…';
    btn.classList.add('capturing');
    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation(); // the page must not act on the key meanwhile
      if (e.code === 'Escape') { stopCapture(); render(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Backspace' || e.code === 'Delete') { stopCapture(); setKey(id, ''); return; }
      const combo = comboOf(e);
      if (!combo) return;
      stopCapture();
      setKey(id, combo);
    };
    const onOut = (e) => { if (e.target !== btn) { stopCapture(); render(); } };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onOut, true);
    capturing = { stop: () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onOut, true); } };
  };
  const setKey = (id, combo) => {
    const { bindings, swapped } = assign(settings.get('shortcuts.bindings') || {}, id, combo);
    settings.set('shortcuts.bindings', bindings);
    say(!combo ? `${label(id)}: no key.` : swapped ? `${formatCombo(combo)} was used by ${label(swapped)}: the two swapped keys.` : `${label(id)}: ${formatCombo(combo)}.`);
  };

  const list = el('div', { class: 'sc-list' });
  const render = () => {
    stopCapture();
    const overrides = settings.get('shortcuts.bindings') || {};
    const eff = effectiveBindings(overrides);
    list.replaceChildren();
    for (const group of SHORTCUT_GROUPS) {
      list.append(el('h4', { class: 'sc-group', text: group }));
      for (const a of ACTIONS.filter((x) => x.group === group)) {
        const btn = el('button', { type: 'button', class: `sc-key${eff[a.id] ? '' : ' unset'}`, text: formatCombo(eff[a.id]), title: 'Click, then press the new key (Backspace clears it, Esc cancels)', onclick: () => startCapture(a.id, btn) });
        const reset = el('button', { type: 'button', class: 'icon small-icon sc-reset', title: `Restore ${formatCombo(a.key)}`, 'aria-label': `Restore the default key of ${a.label}`, hidden: !(a.id in overrides), onclick: () => setKey(a.id, a.key), text: '↺' });
        list.append(el('div', { class: 'sc-row' }, el('span', { class: 'sc-label', text: a.label }), btn, reset));
      }
    }
  };
  render();
  host.append(list, el('div', { class: 'ts-actions' }, el('button', { type: 'button', class: 'chip-btn', text: 'Restore all default keys', onclick: () => { settings.reset('shortcuts.bindings'); say('Every shortcut is back to its default key.'); } })), status);
  return render; // called when the setting changes (also from imports and the reset buttons)
}

// The five custom lane colours (highway.laneColors): a picker and a hex box per lane, and a strip with the lanes as the chosen
// palette draws them (any preset, so the strip also previews the presets).
const LANE_NAMES = ['Green', 'Red', 'Yellow', 'Blue', 'Orange'];
export function renderLaneColors(host, { settings }) {
  const lanes = () => cleanLaneColors(settings.get('highway.laneColors')) ?? [...DEFAULT_LANE_COLORS];
  const strip = el('div', { class: 'lc-strip', 'aria-hidden': 'true' });
  const editor = el('div', { class: 'ts-editor lc-editor' });
  const inputs = LANE_NAMES.map((name, i) => {
    const picker = el('input', { type: 'color', 'aria-label': `${name} lane colour` });
    const hex = el('input', { type: 'text', class: 'sp-hex', maxlength: '7', spellcheck: 'false', 'aria-label': `${name} lane colour (hex)` });
    const setColor = (v) => { const next = lanes(); next[i] = v; settings.set('highway.laneColors', next); };
    picker.addEventListener('input', () => setColor(picker.value));
    hex.addEventListener('change', () => { if (isHex(hex.value.trim())) setColor(hex.value.trim().toLowerCase()); else hex.value = lanes()[i]; });
    editor.append(el('label', { class: 'ts-color' }, el('span', { text: `${name} lane` }), picker, hex));
    return { picker, hex };
  });
  host.append(strip, editor);
  return function refresh() {
    const own = lanes();
    own.forEach((c, i) => { inputs[i].picker.value = c; inputs[i].hex.value = c; });
    const p = resolvePalette(settings.get('highway.palette'), own);
    strip.replaceChildren(...p.lanes.map((c) => el('i', { style: `background:${c}` })), el('b', { style: `background:${p.kick}`, title: 'Kick' }), el('b', { style: `background:${p.open}`, title: 'Open' }));
  };
}

// The starting view of each instrument's window (highway.perInstrument): one row per instrument with the view, the note shape
// and the neck speed, each "Default" (the global setting) unless picked. Vocals only have a neck speed (their view is the vocal view).
const INSTRUMENT_NAMES = { guitar: 'Guitar', bass: 'Bass', rhythm: 'Rhythm', keys: 'Keys', drums: 'Drums', vocals: 'Vocals' };
export function renderPerInstrument(host, { settings }) {
  const all = () => settings.get('highway.perInstrument') || {};
  const update = (base, name, value) => {
    const entry = { ...instrumentDefaults(all(), base) };
    if (value === undefined) delete entry[name]; else entry[name] = value;
    const next = { ...all() };
    if (Object.keys(entry).length) next[base] = entry; else delete next[base];
    settings.set('highway.perInstrument', next);
  };
  const table = el('div', { class: 'pi-table', role: 'table', 'aria-label': 'Starting view of each instrument' },
    el('div', { class: 'pi-row pi-head', role: 'row' }, ...['Instrument', 'View', 'Note shape', 'Neck speed'].map((t) => el('span', { role: 'columnheader', text: t }))));
  const refreshers = [];
  for (const base of PER_INSTRUMENT_BASES) {
    const label = INSTRUMENT_NAMES[base];
    const select = (name, options) => {
      if (base === 'vocals') return el('span', { class: 'pi-na', role: 'cell', text: '-', title: 'Vocals use the vocal view' });
      const sel = el('select', { class: 'sp-select', 'aria-label': `${label} ${name === 'view' ? 'view' : 'note shape'}` },
        el('option', { value: '', text: 'Default' }), options.map(([v, t]) => el('option', { value: v, text: t })));
      sel.addEventListener('change', () => update(base, name, sel.value || undefined));
      refreshers.push(() => { sel.value = instrumentDefaults(all(), base)[name] ?? ''; });
      return el('span', { role: 'cell' }, sel);
    };
    const range = el('input', { type: 'range', min: NECK_MIN, max: NECK_MAX, step: 0.1, 'aria-label': `${label} neck speed` });
    const out = el('output', { class: 'sp-out' });
    const def = el('button', { type: 'button', class: 'chip-btn pi-def', text: 'Default', title: `${label}: use the global neck speed`, onclick: () => update(base, 'neck', undefined) });
    range.addEventListener('input', () => update(base, 'neck', Number(range.value)));
    refreshers.push(() => {
      const v = instrumentDefaults(all(), base).neck;
      const shown = v ?? settings.get('highway.neck'); // (unset: the global neck speed, dimmed)
      range.value = shown;
      out.textContent = `${shown.toFixed(1)}×`;
      range.classList.toggle('pi-unset', v === undefined);
      out.classList.toggle('pi-unset', v === undefined);
      def.disabled = v === undefined;
    });
    table.append(el('div', { class: 'pi-row', role: 'row' },
      el('b', { role: 'rowheader', text: label }),
      select('view', [['2d', '2D'], ['3d', '3D']]),
      select('noteStyle', [['round', 'Circles'], ['rect', 'Rectangles']]),
      el('span', { class: 'pi-neck', role: 'cell' }, range, out, def)));
  }
  host.append(table);
  return () => { for (const fn of refreshers) fn(); };
}
