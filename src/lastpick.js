// The instruments and difficulties used last: remembered between songs (and visits) and offered again on the next song.
//   items: [{ id, diff, base }] what was on screen, the active instrument first (applyInstruments matches by id, else by kind)
//   diffs: { base: difficultyId } the last difficulty of every kind of instrument that was used (kept for the ones not on screen now)
//   off: [groupKey] the instruments the user switched off (everything else is on by default)
// Pure (no DOM, no storage): app.js reads and writes the string; tested without a browser.

const KINDS = /^[a-z0-9_-]{1,32}$/i;

// The next memory from what is on screen (`screen`: [{ optionId, diffId, base, active }], as built by updateChart) and the previous memory.
export function rememberPick(prev, screen, off = []) {
  const items = [...(screen || [])]
    .filter((it) => it?.optionId)
    .sort((a, b) => Number(!!b.active) - Number(!!a.active))
    .map((it) => ({ id: String(it.optionId), diff: it.diffId ? String(it.diffId) : '', base: it.base ? String(it.base) : '' }));
  const diffs = { ...(prev?.diffs || {}) };
  for (const it of items) if (it.base && it.diff) diffs[it.base] = it.diff;
  return { items, diffs, off: [...new Set((off || []).map(String))].filter((k) => KINDS.test(k)) };
}

export const serializePick = (pick) => JSON.stringify({ items: pick.items, diffs: pick.diffs, off: pick.off || [] });

// Reads a stored memory; anything malformed is dropped (never throws).
export function parsePick(text) {
  const empty = { items: [], diffs: {}, off: [] };
  let raw;
  try { raw = JSON.parse(text); } catch { return empty; }
  if (!raw || typeof raw !== 'object') return empty;
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .filter((it) => it && typeof it.id === 'string' && KINDS.test(it.id))
    .slice(0, 12)
    .map((it) => ({ id: it.id, diff: typeof it.diff === 'string' && KINDS.test(it.diff) ? it.diff : '', base: typeof it.base === 'string' && KINDS.test(it.base) ? it.base : '' }));
  const diffs = {};
  if (raw.diffs && typeof raw.diffs === 'object') {
    for (const [k, v] of Object.entries(raw.diffs)) if (KINDS.test(k) && typeof v === 'string' && KINDS.test(v)) diffs[k] = v;
  }
  const off = (Array.isArray(raw.off) ? raw.off : []).filter((k) => typeof k === 'string' && KINDS.test(k)).slice(0, 24);
  return { items, diffs, off };
}
