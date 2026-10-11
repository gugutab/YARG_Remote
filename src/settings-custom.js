// Purpose-built controls of the settings page: the theme studio and the data/backup tools.
import { PRESETS, THEME_KEYS, THEME_LABELS, resolveTheme, deriveTheme, contrast, isHex } from './themes.js';

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

export function renderDataTools(host, { settings, extra = [], notify = () => {} }) {
  const status = el('p', { class: 'ts-hint', 'aria-live': 'polite' });
  const say = (m) => { status.textContent = m; notify(m); };
  const buttons = [
    el('button', { type: 'button', class: 'chip-btn', text: 'Export settings', onclick: () => { download('yarg-remote-settings.json', settings.exportJson()); say('Settings exported.'); } }),
    el('button', { type: 'button', class: 'chip-btn', text: 'Import settings…', onclick: async () => {
      const text = await pickFile('.json,application/json');
      if (text == null) return;
      try { say(`Imported ${settings.importJson(text)} settings.`); } catch (e) { say(e.message); }
    } }),
    el('button', { type: 'button', class: 'chip-btn danger', text: 'Reset all settings', onclick: () => {
      if (window.confirm('Reset every setting to its default?')) { settings.resetAll(); say('All settings are back to their defaults.'); }
    } }),
    ...extra.map((x) => el('button', { type: 'button', class: 'chip-btn', text: x.label, title: x.help, onclick: async () => say(await x.run()) })),
  ];
  host.append(el('div', { class: 'ts-actions' }, buttons), status);
  return () => {};
}
