// "Play next": a short list of songs from the library that are close to the one that just ended. Pure; the songs are the library
// index objects ({ id, title, artist, album, ini, parts }).
//
// Score of a candidate (the current song and songs without the active instrument are excluded):
//   +5 same artist, +3 same album, +2 same genre, up to +1.5 for a year within 5 (1.5 x (6 - gap) / 6), +1 same pack,
//   +1 same charter, +1 per enabled instrument the candidate has a part for, up to +1 for a similar length (1 at the same length,
//   0 from 2 minutes apart), and a stable tie-break of up to +0.4 from a hash of both song ids (no flicker between calls).
import { plainText, packOf } from './ini.js';
import { groupKey, hasInstrument } from './songlist.js';

export const WEIGHTS = { artist: 5, album: 3, genre: 2, year: 1.5, pack: 1, charter: 1, instrument: 1, length: 1, shuffle: 0.4 };
export const YEAR_WINDOW = 5; // years
export const LENGTH_WINDOW_MS = 120000;

const norm = (s) => plainText(s).toLowerCase();
const yearOf = (song) => parseInt(song.ini?.year, 10) || 0;
const lengthOf = (song) => Number(song.ini?.song_length) || 0;

// FNV-1a 32 bit -> [0, 1)
function unitHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 4294967296;
}

// -> [{ song, score, reason }] best first, at most `count`. `instruments` are the parts on screen ('guitar', 'bass', 'rhythm',
// 'keys', 'drums', 'vocals'); the first is the active one, which a candidate must have.
export function recommend(current, songs, { count = 20, instruments = [] } = {}) {
  if (!current) return [];
  const active = instruments[0];
  const artist = groupKey(current.artist, 'artist');
  const album = groupKey(current.album, 'album');
  const genre = norm(current.ini?.genre);
  const charter = norm(current.ini?.charter);
  const pack = packOf(current);
  const year = yearOf(current);
  const length = lengthOf(current);
  const out = [];
  for (const song of songs) {
    if (song.id === current.id) continue;
    if (active && !hasInstrument(song, active)) continue;
    let score = 0;
    const reasons = [];
    if (artist && groupKey(song.artist, 'artist') === artist) { score += WEIGHTS.artist; reasons.push('Same artist'); }
    if (album && groupKey(song.album, 'album') === album) { score += WEIGHTS.album; reasons.push('Same album'); }
    const g = norm(song.ini?.genre);
    if (genre && g === genre) { score += WEIGHTS.genre; reasons.push('Same genre'); }
    const y = yearOf(song);
    if (year && y && Math.abs(y - year) <= YEAR_WINDOW) {
      score += WEIGHTS.year * (YEAR_WINDOW + 1 - Math.abs(y - year)) / (YEAR_WINDOW + 1);
      reasons.push(String(y));
    }
    if (pack && packOf(song) === pack) { score += WEIGHTS.pack; reasons.push('Same pack'); }
    if (charter && norm(song.ini?.charter) === charter) { score += WEIGHTS.charter; reasons.push('Same charter'); }
    for (const inst of instruments) if (hasInstrument(song, inst)) score += WEIGHTS.instrument;
    const l = lengthOf(song);
    if (length && l) {
      const close = Math.max(0, 1 - Math.abs(l - length) / LENGTH_WINDOW_MS);
      score += WEIGHTS.length * close;
      if (close > 0.75) reasons.push('Similar length');
    }
    score += WEIGHTS.shuffle * unitHash(`${current.id}|${song.id}`);
    // "Same genre · 1978": the strongest reasons first (artist, album, genre), the year after; at most two
    out.push({ song, score, reason: reasons.slice(0, 2).join(' · ') || 'You might like it' });
  }
  out.sort((a, b) => b.score - a.score || (a.song.id < b.song.id ? -1 : 1));
  // the same song can sit in the library more than once (packs, re-releases): show each title + artist once, never the current one
  const twin = (s) => `${norm(s.title)}|${groupKey(s.artist, 'artist')}`;
  const seen = new Set([twin(current)]);
  const unique = [];
  for (const item of out) {
    const key = twin(item.song);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= count) break;
  }
  return unique;
}
