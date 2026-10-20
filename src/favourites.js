// Favourite songs: a bounded set of song ids (song.id, the song's folder path), kept in localStorage. Pure set operations and a
// validating (de)serialiser; the storage is injected, every call fails soft. An id of a song that is no longer in the library
// simply matches nothing (it is kept, so the star comes back if the song returns).

export const FAVOURITES_KEY = 'yargremote.favourites';
export const MAX_FAVOURITES = 5000;
export const MAX_ID_LENGTH = 1024;

const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH;

// Any value -> a clean Set: strings only, no duplicates, at most `max` (the first ones win, i.e. the oldest stars).
export function cleanFavourites(value, max = MAX_FAVOURITES) {
  const out = new Set();
  if (!Array.isArray(value)) return out;
  for (const id of value) {
    if (out.size >= max) break;
    if (validId(id)) out.add(id);
  }
  return out;
}

// Stored text -> Set (corrupt or missing data = empty set).
export function parseFavourites(raw, max = MAX_FAVOURITES) {
  if (typeof raw !== 'string' || !raw) return new Set();
  try {
    return cleanFavourites(JSON.parse(raw), max);
  } catch {
    return new Set();
  }
}

export const serializeFavourites = (set) => JSON.stringify([...set]);

// A new set with `id` added or removed. Adding to a full set drops the oldest star first.
export function toggleFavourite(set, id, on = !set.has(id), max = MAX_FAVOURITES) {
  const next = new Set(set);
  if (!validId(id)) return next;
  if (!on) { next.delete(id); return next; }
  if (next.has(id)) return next;
  while (next.size >= max) next.delete(next.values().next().value);
  next.add(id);
  return next;
}

// Only the songs that are favourites (the "Starred" filter).
export const onlyFavourites = (songs, set) => songs.filter((s) => set.has(s.id));

// Import (from a backup file): the incoming ids are added to the current set (nothing is removed).
// Returns { set, added, skipped }; skipped counts entries that are not valid ids or did not fit under the cap.
export function mergeFavourites(set, value, max = MAX_FAVOURITES) {
  if (!Array.isArray(value)) throw new Error('The favourites in this file are not a list.');
  const next = new Set(set);
  let added = 0;
  let skipped = 0;
  for (const id of value) {
    if (!validId(id)) { skipped++; continue; }
    if (next.has(id)) continue;
    if (next.size >= max) { skipped++; continue; }
    next.add(id);
    added++;
  }
  return { set: next, added, skipped };
}

export function loadFavourites(storage) {
  try { return parseFavourites(storage?.getItem(FAVOURITES_KEY)); } catch { return new Set(); }
}

export function saveFavourites(storage, set) {
  try {
    if (set.size) storage?.setItem(FAVOURITES_KEY, serializeFavourites(set));
    else storage?.removeItem(FAVOURITES_KEY);
    return true;
  } catch {
    return false; // storage full or blocked: the stars last for this visit
  }
}
