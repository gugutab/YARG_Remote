// Descriptive data for the song info screen: metadata from song.ini and statistics from the built chart.
// Pure functions, no DOM.
import { plainText } from './ini.js';

// song.ini difficulty keys (value 0..6 = difficulty level, -1 = no part). Labels in Portuguese for the UI.
export const DIFF_LABELS = [
  ['diff_guitar', 'Guitarra'], ['diff_bass', 'Baixo'], ['diff_rhythm', 'Rhythm'], ['diff_guitar_coop', 'Guitarra coop'],
  ['diff_keys', 'Teclado'], ['diff_drums', 'Bateria'], ['diff_drums_real', 'Bateria Pro'],
  ['diff_vocals', 'Vocal'], ['diff_vocals_harm', 'Harmonias'],
  ['diff_guitar_real', 'Guitarra Pro'], ['diff_bass_real', 'Baixo Pro'], ['diff_keys_real', 'Teclado Pro'],
];

export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const s = Math.round(n / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const META_FIELDS = [
  ['album', 'Álbum'], ['artist', 'Artista'], ['genre', 'Gênero'], ['year', 'Ano'],
  ['charter', 'Charter'], ['frets', 'Frets'], ['playlist', 'Playlist'], ['sub_playlist', 'Subplaylist'],
  ['playlist_track', 'Faixa'], ['album_track', 'Faixa do álbum'],
];
const SHOWN_KEYS = new Set([
  'name', 'artist', 'album', 'genre', 'year', 'charter', 'frets', 'playlist', 'sub_playlist', 'playlist_track',
  'album_track', 'song_length', 'loading_phrase', 'delay', 'delay_seconds', 'preview_start_time',
  ...DIFF_LABELS.map(([k]) => k),
]);

// [{ label, value }] for the main metadata block; empty values are left out.
export function metaRows(song) {
  const ini = song.ini || {};
  const rows = [];
  for (const [key, label] of META_FIELDS) {
    const value = plainText(key === 'artist' || key === 'album' ? song[key] : ini[key]);
    if (value && value !== '-1') rows.push({ label, value });
  }
  const length = formatDuration(ini.song_length);
  if (length) rows.push({ label: 'Duração', value: length });
  const delay = Number(ini.delay);
  if (Number.isFinite(delay) && delay !== 0) rows.push({ label: 'Delay do áudio', value: `${delay} ms` });
  const preview = formatDuration(ini.preview_start_time);
  if (preview) rows.push({ label: 'Prévia em', value: preview });
  return rows;
}

// Instruments with a difficulty level in song.ini: [{ label, level }] (level 0..6).
export function difficultyLevels(song) {
  const ini = song.ini || {};
  return DIFF_LABELS
    .filter(([key]) => typeof ini[key] === 'number' && ini[key] >= 0)
    .map(([key, label]) => ({ label, level: Math.min(6, ini[key]) }));
}

// Every other song.ini property, as raw key/value rows.
export function extraRows(song) {
  return Object.entries(song.ini || {})
    .filter(([key]) => !SHOWN_KEYS.has(key))
    .map(([key, value]) => ({ label: key, value: plainText(value) }))
    .filter((r) => r.value !== '')
    .sort((a, b) => a.label.localeCompare(b.label));
}

// [min, max] BPM of the tempo map, or null without tempo events.
export function bpmRange(tempos) {
  const bpms = (tempos || []).filter((t) => t.usPerQuarter > 0).map((t) => 60e6 / t.usPerQuarter);
  return bpms.length ? [Math.min(...bpms), Math.max(...bpms)] : null;
}

// Statistics of the selected chart: [{ label, value }].
export function chartStats(chart, midi) {
  if (!chart) return [];
  const rows = [];
  const bpm = bpmRange(midi?.tempos);
  if (bpm) {
    const [lo, hi] = bpm.map((b) => Math.round(b));
    rows.push({ label: 'BPM', value: lo === hi ? String(lo) : `${lo}–${hi}` });
  }
  rows.push({ label: 'Notas', value: String(chart.notes.length) });
  if (chart.mode === 'vocals') {
    rows.push({ label: 'Linhas de letra', value: String(chart.lyrics?.length ?? 0) });
    if (chart.harmonies?.length) rows.push({ label: 'Harmonias', value: String(chart.harmonies.length) });
    if (chart.percussion?.length) rows.push({ label: 'Percussão', value: String(chart.percussion.length) });
  } else {
    const sustains = chart.notes.filter((n) => n.length > 0).length;
    if (sustains) rows.push({ label: 'Sustains', value: String(sustains) });
    if (chart.rolls?.length) rows.push({ label: 'Rolls', value: String(chart.rolls.length) });
  }
  rows.push({ label: 'Solos', value: String(chart.solos?.length ?? 0) });
  rows.push({ label: 'Star power', value: String(chart.starPower?.length ?? 0) });
  rows.push({ label: 'Seções', value: String(chart.sections?.length ?? 0) });
  return rows;
}

// Which icon and corner badge represent a stem in the mixer (stem file names vary: drums_1, guitar, song, ...).
export function stemKind(label) {
  const n = String(label).toLowerCase();
  if (/drum|kick|snare|cymbal|\btom|percus/.test(n)) return 'drum';
  if (/vocal|vox|harm|sing/.test(n)) return 'mic';
  if (/key|piano|organ|synth/.test(n)) return 'keys';
  if (/guitar|bass|rhythm|lead/.test(n)) return 'guitar';
  if (/crowd|audience/.test(n)) return 'users';
  return 'music';
}

// Short text that tells apart stems sharing an icon: the trailing number (drums_2 -> "2"), B for bass, R for rhythm.
export function stemBadge(label) {
  const n = String(label).toLowerCase();
  const digits = /(\d+)$/.exec(n);
  if (digits) return digits[1];
  if (/bass/.test(n)) return 'B';
  if (/rhythm/.test(n)) return 'R';
  return '';
}
