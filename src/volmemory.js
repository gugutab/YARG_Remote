// The last volume of every track (and of every instrument group of tracks), remembered between songs and visits.
//   stems: { 'guitar': 0.8, 'drums_1': 1.2 }  groups: { 'drums': 0.7 }; a track at the default (100 %) has no entry.
// Pure (no DOM, no storage): app.js reads and writes the string; tested without a browser.

const MAX = 1.5; // the mixer's slider range
const KEY = /^[a-z0-9 _.-]{1,40}$/i;

const clamp = (v) => Math.min(MAX, Math.max(0, v));

export function parseVolumes(text) {
  const out = { stems: {}, groups: {} };
  let raw;
  try { raw = JSON.parse(text); } catch { return out; }
  if (!raw || typeof raw !== 'object') return out;
  for (const kind of ['stems', 'groups']) {
    const src = raw[kind];
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      if (KEY.test(k) && typeof v === 'number' && Number.isFinite(v) && Math.abs(v - 1) > 1e-6) out[kind][k.toLowerCase()] = +clamp(v).toFixed(3);
    }
  }
  return out;
}

export const serializeVolumes = (mem) => JSON.stringify({ stems: mem.stems, groups: mem.groups });

// Records `value` for a track ('stems') or a group ('groups'); the default level removes the entry.
export function remember(mem, kind, key, value) {
  const k = String(key).toLowerCase();
  if (!KEY.test(k)) return mem;
  const v = clamp(Number(value));
  if (!Number.isFinite(v) || Math.abs(v - 1) < 1e-6) delete mem[kind][k];
  else mem[kind][k] = +v.toFixed(3);
  return mem;
}

export const recall = (mem, kind, key) => mem[kind][String(key).toLowerCase()] ?? 1;
