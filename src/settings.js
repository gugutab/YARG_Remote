// The app's settings: one JSON object in localStorage, with defaults, change notification, reset, export and import.
// Pure logic (the storage is injected), so it is tested without a browser. The list of settings itself (labels, controls,
// defaults) is in settings-schema.js; the page that edits them is settings-ui.js.

const KEY = 'yargremote.settings';

const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createSettings({ defaults = {}, storage = null, key = KEY } = {}) {
  let values = {}; // only what differs from the defaults
  const listeners = new Set();

  try {
    const raw = storage?.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) values = parsed;
    }
  } catch { /* unreadable storage: start from the defaults */ }

  const save = () => {
    try {
      if (Object.keys(values).length) storage?.setItem(key, JSON.stringify(values));
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
    // JSON text of the changed settings, and the reverse (only keys of known settings are taken).
    exportJson() { return JSON.stringify({ app: 'yarg-remote', version: 1, settings: values }, null, 2); },
    importJson(text) {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('This is not valid JSON.');
      }
      const incoming = data?.settings && typeof data.settings === 'object' ? data.settings : null;
      if (!incoming || data.app !== 'yarg-remote') throw new Error('This file is not a YARG Remote settings export.');
      let n = 0;
      for (const [id, value] of Object.entries(incoming)) {
        if (!(id in defaults)) continue; // a setting this version does not know
        api.set(id, value);
        n++;
      }
      return n;
    },
  };
  return api;
}
