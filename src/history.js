// Practice history: per song id, when its chart was last played and how many times (a play = at least MIN_PLAY_MS of chart
// playback in one go: one load of the song, or one run from a restart after its end). Kept in localStorage, bounded to
// MAX_HISTORY songs (the ones played longest ago go first). Pure functions; the storage is injected and every call fails soft.

export const HISTORY_KEY = 'yargremote.history';
export const MAX_HISTORY = 2000;
export const MIN_PLAY_MS = 10000;
const MAX_ID_LENGTH = 1024;
const MAX_PLAYS = 1e6;

// map: Map(id -> { last: ms timestamp, plays: count })

const cleanEntry = (e) => {
  if (!e || typeof e !== 'object') return null;
  const last = Number(e.last);
  const plays = Math.floor(Number(e.plays));
  if (!Number.isFinite(last) || last <= 0 || !Number.isFinite(plays) || plays < 1) return null;
  return { last, plays: Math.min(plays, MAX_PLAYS) };
};

// Keeps the `max` most recently played songs (and always `keep`, the one just recorded).
export function pruneHistory(map, max = MAX_HISTORY, keep = null) {
  if (map.size <= max) return map;
  const order = [...map].filter(([id]) => id !== keep).sort((a, b) => b[1].last - a[1].last);
  const out = new Map(order.slice(0, Math.max(0, keep !== null && map.has(keep) ? max - 1 : max)));
  if (keep !== null && map.has(keep)) out.set(keep, map.get(keep));
  return out;
}

// Stored text -> Map. Corrupt data = empty; bad entries are dropped one by one.
export function parseHistory(raw, max = MAX_HISTORY) {
  const map = new Map();
  if (typeof raw !== 'string' || !raw) return map;
  let data;
  try { data = JSON.parse(raw); } catch { return map; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return map;
  for (const [id, e] of Object.entries(data)) {
    if (!id || id.length > MAX_ID_LENGTH) continue;
    const entry = cleanEntry(e);
    if (entry) map.set(id, entry);
  }
  return pruneHistory(map, max);
}

export const serializeHistory = (map) => JSON.stringify(Object.fromEntries(map));

// A new map with one more play of `id` at `now`. A clock that went backwards still counts the play; `last` is the time of
// this play as the clock says it (formatAgo shows a future time as "just now").
export function recordPlay(map, id, now, max = MAX_HISTORY) {
  if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH || !Number.isFinite(now) || now <= 0) return map;
  const next = new Map(map);
  const prev = next.get(id);
  next.delete(id);
  next.set(id, { last: now, plays: Math.min(MAX_PLAYS, (prev?.plays || 0) + 1) });
  return pruneHistory(next, max, id);
}

// The sort value of a song: 'recent' = its last play time, 'plays' = its play count; null = never played.
export function sortKey(map, id, by = 'recent') {
  const e = map.get(id);
  if (!e) return null;
  return by === 'plays' ? e.plays : e.last;
}

export const HISTORY_SORTS = ['recent', 'plays'];

// Songs (already in title order) sorted by history: most recent / most played first (desc reverses that), songs never played
// always last, in the order they came. Ties keep the incoming order (for plays, the more recent play first).
export function sortByHistory(songs, map, by = 'recent', desc = false) {
  const played = [];
  const never = [];
  songs.forEach((song, i) => (map.has(song.id) ? played : never).push({ song, i }));
  const sign = desc ? -1 : 1;
  played.sort((a, b) => {
    const d = sortKey(map, b.song.id, by) - sortKey(map, a.song.id, by);
    if (d) return sign * d;
    if (by === 'plays') { const r = sortKey(map, b.song.id, 'recent') - sortKey(map, a.song.id, 'recent'); if (r) return sign * r; }
    return a.i - b.i;
  });
  return [...played, ...never].map((x) => x.song);
}

// "just now", "5 minutes ago", "yesterday", "3 days ago", "2 weeks ago", "4 months ago", "2 years ago". A time in the future
// (the clock went backwards) is "just now"; a bad value is ''.
export function formatAgo(ms, now) {
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return '';
  const s = (now - ms) / 1000;
  const n = (v, unit) => `${v} ${unit}${v === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return n(Math.floor(s / 60), 'minute');
  if (s < 86400) return n(Math.floor(s / 3600), 'hour');
  const days = Math.floor(s / 86400);
  if (days < 2) return 'yesterday';
  if (days < 7) return n(days, 'day');
  if (days < 30) return n(Math.floor(days / 7), 'week');
  if (days < 365) return n(Math.max(1, Math.floor(days / 30)), 'month');
  return n(Math.floor(days / 365), 'year');
}

// The details line: "Played 3 days ago · 12 plays", or '' for a song never played.
export function playedLine(map, id, now) {
  const e = map.get(id);
  if (!e) return '';
  return `Played ${formatAgo(e.last, now)} · ${e.plays} play${e.plays === 1 ? '' : 's'}`;
}

// Counts the playback time of the song on the stage. tick(id, playing, nowMs) once per frame; returns the id once, when that
// song has been playing for `min` ms in this session (later ticks of the same session return null). A change of song or reset()
// (the song ended) starts a new session. Gaps longer than `maxStep` (a hidden tab, a stalled frame) count as `maxStep`.
export function createPlayTracker({ min = MIN_PLAY_MS, maxStep = 1000 } = {}) {
  let id = null;
  let played = 0;
  let counted = false;
  let lastAt = null;
  return {
    tick(songId, playing, now) {
      if (songId !== id) { id = songId; played = 0; counted = false; lastAt = null; }
      if (!playing || !id || !Number.isFinite(now)) { lastAt = null; return null; }
      if (lastAt !== null) played += Math.min(maxStep, Math.max(0, now - lastAt)); // (a clock step backwards adds nothing)
      lastAt = now;
      if (!counted && played >= min) { counted = true; return id; }
      return null;
    },
    reset() { played = 0; counted = false; lastAt = null; },
    get playedMs() { return played; },
  };
}

export function loadHistory(storage) {
  try { return parseHistory(storage?.getItem(HISTORY_KEY)); } catch { return new Map(); }
}

export function saveHistory(storage, map) {
  try {
    if (map.size) storage?.setItem(HISTORY_KEY, serializeHistory(map));
    else storage?.removeItem(HISTORY_KEY);
    return true;
  } catch {
    return false;
  }
}
