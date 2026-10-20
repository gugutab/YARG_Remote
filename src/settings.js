// The app's settings: one JSON object in localStorage, with defaults, change notification, reset, export and import.
// Pure logic (the storage is injected), so it is tested without a browser. The list of settings itself (labels, controls,
// defaults) is in settings-schema.js; the page that edits them is settings-ui.js.

const KEY = 'yargremote.settings';
const VERSION_KEY = '$version'; // stored next to the values (an id never starts with '$'); older builds ignore it as an unknown id


const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Applies renamed ids ({ oldId: 'newId' } or { oldId: { id, value } }, see RENAMES in settings-schema.js) to a plain object of
// outside values. A value already given under the new id wins over the old one. Returns a new object; never throws.
export function migrate(values, renames = {}) {
  const out = Object.create(null); // (a '__proto__' key stays a plain entry, refused later as an unknown id)
  for (const [id, value] of Object.entries(values)) if (!Object.hasOwn(renames, id)) out[id] = value;
  for (const [id, value] of Object.entries(values)) {
    if (!Object.hasOwn(renames, id)) continue;
    const r = renames[id];
    const to = typeof r === 'string' ? r : r?.id;
    if (typeof to !== 'string' || Object.hasOwn(out, to)) continue;
    try {
      out[to] = typeof r?.value === 'function' ? r.value(value) : value;
    } catch { /* a transform that fails drops the value */ }
  }
  return out;
}

// `validate(id, value) -> { ok, value }` (optional, see buildValidator in settings-schema.js) checks what comes from outside:
// the stored JSON and imported files. A stored value that fails falls back to the default, silently; an imported one is
// skipped and counted. Without it values are trusted (the unit tests of the plain store). Only ids that have a default
// are ever read, so `__proto__` and friends in a hand-edited file cannot reach the store. `renames` (RENAMES of the schema) are
// applied to stored and imported values first; `version` is written with the stored values and in exports.
export function createSettings({ defaults = {}, storage = null, key = KEY, validate = null, renames = {}, version = 1 } = {}) {
  let values = {}; // only what differs from the defaults
  const listeners = new Set();

  // { ok, value } for an outside value; never throws.
  const accept = (id, value) => {
    if (!Object.hasOwn(defaults, id)) return { ok: false };
    if (!validate) return { ok: true, value };
    try {
      const r = validate(id, value);
      return r && r.ok ? { ok: true, value: r.value } : { ok: false };
    } catch {
      return { ok: false };
    }
  };

  try {
    const raw = storage?.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [id, value] of Object.entries(migrate(parsed, renames))) {
          const r = accept(id, value);
          if (r.ok && !same(r.value, defaults[id])) values[id] = clone(r.value);
        }
      }
    }
  } catch { /* unreadable storage: start from the defaults */ }

  const save = () => {
    try {
      if (Object.keys(values).length) storage?.setItem(key, JSON.stringify({ [VERSION_KEY]: version, ...values }));
      else storage?.removeItem(key);
    } catch { /* storage full or blocked: the settings just last for this visit */ }
  };
  const emit = (id, value) => { for (const fn of listeners) fn(id, value); };

  const api = {
    defaults,
    get(id) { return id in values ? clone(values[id]) : clone(defaults[id]); },
    isDefault(id) { return !(id in values); },
    set(id, value) {
      if (same(value, defaults[id])) delete values[id]; // a value equal to its default is not stored
      else values[id] = clone(value);
      save();
      emit(id, api.get(id));
    },
    reset(id) {
      if (!(id in values)) return;
      delete values[id];
      save();
      emit(id, api.get(id));
    },
    resetMany(ids) { for (const id of ids) api.reset(id); },
    resetAll() {
      const ids = Object.keys(values);
      values = {};
      save();
      for (const id of ids) emit(id, api.get(id));
    },
    // Every setting that differs from its default (what is saved and exported).
    changed() { return clone(values); },
    all() { return { ...clone(defaults), ...clone(values) }; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // JSON text of the changed settings, and the reverse: only known settings with a valid value are taken (renamed ids of an
    // older file are migrated first). Returns { imported, skipped }; skipped counts unknown ids and invalid values.
    exportJson() { return JSON.stringify({ app: 'yarg-remote', version, settings: values }, null, 2); },
    importJson(text) {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('This is not valid JSON.');
      }
      const incoming = data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : null;
      if (!incoming || data.app !== 'yarg-remote') throw new Error('This file is not a YARG Remote settings export.');
      let imported = 0;
      let skipped = 0;
      for (const [id, value] of Object.entries(migrate(incoming, renames))) {
        const r = accept(id, value); // also refuses a setting this version does not know
        if (!r.ok) { skipped++; continue; }
        api.set(id, r.value);
        imported++;
      }
      return { imported, skipped };
    },
  };
  return api;
}
