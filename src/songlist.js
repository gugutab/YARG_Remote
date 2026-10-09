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
const textKey = (field) => (s) => sortText(s[field]);
const KEYS = {
  title: textKey('title'),
  artist: (s) => `${norm(plainText(s.artist))}\u0000${norm(plainText(s.title))}`,
  album: (s) => `${norm(plainText(s.album))}\u0000${norm(plainText(s.title))}`,
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
  const items = [];
  let last = null;
  for (const song of sorted) {
    const label = groupLabel(song, by);
    if (norm(label) !== last) { // names that differ only by case or accents share a header
      items.push({ type: 'head', label });
      last = norm(label);
    }
    items.push({ type: 'song', song });
  }
  return items;
}

// Short text for the scrollbar rail: the initial for text sorts, '70s' for decades, '3–4' for length buckets.
export function anchorLabel(label, by = 'title') {
  if (by === 'year') return /^\d{4}s$/.test(label) ? label.slice(2) : '?';
  if (by === 'length') return /^Unknown/.test(label) ? '?' : label.replace(/\s*min$/, '').replace(/\s+/g, '');
  const text = norm(plainText(label)).replace(/^[^a-z0-9]+/, '');
  return /^[a-z]/.test(text) ? text[0].toUpperCase() : '#';
}
