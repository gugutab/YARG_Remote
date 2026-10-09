import { plainText } from './ini.js';

// Search, filter and sort for the library list. Pure functions over the song objects from library.js.

// song.ini difficulty keys per instrument (value -1 = the song has no part for it).
const DIFF_KEYS = {
  guitar: ['diff_guitar', 'diff_guitar_real'],
  bass: ['diff_bass', 'diff_bass_real'],
  rhythm: ['diff_rhythm'],
  keys: ['diff_keys', 'diff_keys_real'],
  drums: ['diff_drums', 'diff_drums_real', 'diff_drums_real_ps'],
  vocals: ['diff_vocals', 'diff_vocals_harm'],
};

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// false only when the main key (first in DIFF_KEYS) says -1 and no other key says otherwise. Pro/real keys
// alone (often -1 in old charts that lack the main key) do not exclude a song; unknown = kept.
export function hasInstrument(song, instrument) {
  const keys = DIFF_KEYS[instrument] || [];
  const values = keys.map((k) => song.ini?.[k]).filter((v) => typeof v === 'number');
  if (values.some((v) => v >= 0)) return true;
  return typeof song.ini?.[keys[0]] !== 'number';
}

export function filterSongs(songs, { query = '', instrument = '', genre = '' } = {}) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  return songs.filter((s) => {
    if (instrument && !hasInstrument(s, instrument)) return false;
    if (genre && s.ini?.genre !== genre) return false;
    if (!terms.length) return true;
    const hay = norm(plainText(`${s.title} ${s.artist} ${s.album}`));
    return terms.every((t) => hay.includes(t));
  });
}

// Text keys skip leading punctuation, so "(Don't Fear) The Reaper" sorts under D, like its divider.
const sortText = (v) => norm(plainText(v)).replace(/^[^a-z0-9]+/, '');
// Names that are the same artist / album written differently share one group (and one list header):
// - always: case, accents, punctuation, spacing, "&" = "and", the word "the" ("(Pronounced 'Lĕh-'nérd 'Skin-'nérd)" =
//   "(Pronounced Leh-nerd Skin-nerd)", "Jackson 5" = "The Jackson 5");
// - artists: a trailing credit in parentheses ("Queen (WaveGroup)", "The Who (Steve Ouimette)") is dropped;
// - albums: a trailing edition tag ("Inside (Deluxe Edition)", "Ten (Reissue)", "Permanent Waves (40th Anniversary
//   Edition)") is dropped. Other parentheses stay, so "Weezer (Blue Album)" and "Weezer (Green Album)" differ.
// A tag only counts as trailing when text comes before it, so a name that starts with "(...)" is kept whole.
const EDITION_TAG = /deluxe|edition|reissue|remaster|expanded|anniversary|bonus|explicit/i;
const TRAILING_TAG = /^(.*?\S)\s*[(\[]([^()\[\]]*)[)\]]\s*$/;
export const groupKey = (name, kind = 'plain') => {
  let text = plainText(name);
  if (kind === 'artist' || kind === 'album') {
    for (;;) { // "Black Sabbath (Steve Ouimette)" -> "Black Sabbath"
      const m = text.match(TRAILING_TAG);
      if (!m || (kind === 'album' && !EDITION_TAG.test(m[2]))) break;
      text = m[1];
    }
  }
  const flat = norm(text).replace(/&/g, ' and ');
  const key = flat.replace(/\bthe\b/g, ' ').replace(/[^a-z0-9]+/g, '');
  return key || flat.replace(/[^a-z0-9]+/g, '') || flat.trim();
};
const textKey = (field) => (s) => sortText(s[field]);
const KEYS = {
  title: textKey('title'),
  artist: (s) => `${groupKey(s.artist, 'artist')}\u0000${norm(plainText(s.title))}`,
  album: (s) => `${groupKey(s.album, 'album')}\u0000${norm(plainText(s.title))}`,
  year: (s) => parseInt(s.ini?.year, 10) || 0,
  length: (s) => Number(s.ini?.song_length) || 0,
};

export function sortSongs(songs, by = 'title', desc = false) {
  const key = KEYS[by] || KEYS.title;
  const out = [...songs].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return desc ? out.reverse() : out;
}

export function genresOf(songs) {
  const set = new Set(songs.map((s) => s.ini?.genre).filter((g) => typeof g === 'string' && g));
  return [...set].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

// Divider label for a song under the current sort key (what the list headers show).
export function groupLabel(song, by = 'title') {
  if (by === 'year') {
    const y = parseInt(song.ini?.year, 10);
    return y > 0 ? `${Math.floor(y / 10) * 10}s` : 'Unknown year';
  }
  if (by === 'length') {
    const min = (Number(song.ini?.song_length) || 0) / 60000;
    if (min <= 0) return 'Unknown length';
    if (min < 3) return '< 3 min';
    if (min < 4) return '3–4 min';
    if (min < 5) return '4–5 min';
    if (min < 7) return '5–7 min';
    return '7+ min';
  }
  if (by === 'artist' || by === 'album') { // one header per artist / album
    const name = plainText(song[by]).trim();
    return name || `Unknown ${by}`;
  }
  const text = norm(plainText(song.title)).replace(/^[^a-z0-9]+/, '');
  return /^[a-z]/.test(text) ? text[0].toUpperCase() : '#';
}

// Songs (already sorted) with a { type: 'head', label } item before each run of the same group.
export function buildItems(sorted, by = 'title') {
  const kind = by === 'artist' || by === 'album' ? by : 'plain';
  // Each group is named by its most common spelling, preferring one without a trailing "(credit/edition)"; ties: first seen.
  const spellings = new Map(); // groupKey -> Map(label -> count)
  const labels = sorted.map((song) => groupLabel(song, by));
  for (const label of labels) {
    const key = groupKey(label, kind);
    const counts = spellings.get(key) ?? spellings.set(key, new Map()).get(key);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const tagged = (label) => TRAILING_TAG.test(label);
  const nameOf = (label) => [...spellings.get(groupKey(label, kind))].reduce((best, e) => {
    if (tagged(e[0]) !== tagged(best[0])) return tagged(e[0]) ? best : e;
    return e[1] > best[1] ? e : best;
  })[0];
  const items = [];
  let last = null;
  sorted.forEach((song, i) => {
    const key = groupKey(labels[i], kind);
    if (key !== last) { // equivalent names share a header
      items.push({ type: 'head', label: nameOf(labels[i]) });
      last = key;
    }
    items.push({ type: 'song', song });
  });
  return items;
}

// Short text for the scrollbar rail: the initial for text sorts, '70s' for decades, '3–4' for length buckets.
export function anchorLabel(label, by = 'title') {
  if (by === 'year') return /^\d{4}s$/.test(label) ? label.slice(2) : '?';
  if (by === 'length') return /^Unknown/.test(label) ? '?' : label.replace(/\s*min$/, '').replace(/\s+/g, '');
  const text = by === 'artist' || by === 'album' ? groupKey(label, by) : norm(plainText(label)).replace(/^[^a-z0-9]+/, ''); // same key as the sort
  return /^[a-z]/.test(text) ? text[0].toUpperCase() : '#';
}
