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

// false only when song.ini lists the instrument and every listed value is negative; unknown = kept.
export function hasInstrument(song, instrument) {
  const values = (DIFF_KEYS[instrument] || []).map((k) => song.ini?.[k]).filter((v) => typeof v === 'number');
  return values.length === 0 || values.some((v) => v >= 0);
}

export function filterSongs(songs, { query = '', instrument = '', genre = '' } = {}) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  return songs.filter((s) => {
    if (instrument && !hasInstrument(s, instrument)) return false;
    if (genre && s.ini?.genre !== genre) return false;
    if (!terms.length) return true;
    const hay = norm(`${s.title} ${s.artist} ${s.album}`);
    return terms.every((t) => hay.includes(t));
  });
}

const textKey = (field) => (s) => norm(s[field]);
const KEYS = {
  title: textKey('title'),
  artist: (s) => `${norm(s.artist)}\u0000${norm(s.title)}`,
  album: (s) => `${norm(s.album)}\u0000${norm(s.title)}`,
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
  return [...set].sort((a, b) => a.localeCompare(b, 'pt', { sensitivity: 'base' }));
}
