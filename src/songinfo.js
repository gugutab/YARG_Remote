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

const SHOWN_KEYS = new Set([
  'name', 'artist', 'album', 'genre', 'year', 'charter', 'frets', 'playlist', 'sub_playlist', 'playlist_track',
  'album_track', 'song_length', 'loading_phrase', 'delay', 'delay_seconds', 'preview_start_time',
  ...DIFF_LABELS.map(([k]) => k),
]);

// Header chips, in display order: Álbum, Faixa, Duração, Charter first, then the rest.
// [ini key, label, icon id]; the track number is shown once, as "Faixa" (album track, else playlist track).
const META_ORDER = ['album', 'track', 'length', 'charter', 'artist', 'genre', 'year', 'frets', 'playlist', 'sub_playlist', 'delay'];

// [{ label, value, icon }] for the header chips; empty values are left out.
export function metaRows(song) {
  const ini = song.ini || {};
  const text = (v) => {
    const t = plainText(v);
    return t && t !== '-1' ? t : '';
  };
  const delay = Number(ini.delay);
  const items = {
    album: ['Álbum', text(song.album), 'disc'],
    track: ['Faixa', text(ini.album_track) || text(ini.playlist_track), 'hash'],
    length: ['Duração', formatDuration(ini.song_length), 'clock'],
    charter: ['Charter', text(ini.charter), 'pen'],
    artist: ['Artista', text(song.artist), 'user'],
    genre: ['Gênero', text(ini.genre), 'tag'],
    year: ['Ano', text(ini.year), 'calendar'],
    frets: ['Frets', text(ini.frets), 'pen'],
    playlist: ['Playlist', text(ini.playlist), 'list'],
    sub_playlist: ['Subplaylist', text(ini.sub_playlist), 'list'],
    delay: ['Delay do áudio', Number.isFinite(delay) && delay !== 0 ? `${delay} ms` : '', 'clock'],
  };
  return META_ORDER.map((k) => ({ label: items[k][0], value: items[k][1], icon: items[k][2] })).filter((r) => r.value);
}

// song.ini difficulty level (0..6) for a playable instrument option, or null when the ini has none.
const LEVEL_KEYS = {
  guitar: ['diff_guitar'], bass: ['diff_bass'], rhythm: ['diff_rhythm'], keys: ['diff_keys'],
  drums: ['diff_drums', 'diff_drums_real'], vocals: ['diff_vocals'], harmony: ['diff_vocals_harm'],
};
export function instrumentLevel(song, option) {
  const keys = LEVEL_KEYS[option.base] || [];
  const ini = song.ini || {};
  const values = keys.map((k) => ini[k]).filter((v) => typeof v === 'number' && v >= 0);
  return values.length ? Math.min(6, Math.max(...values)) : null;
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

// "121–191" / "120" for the tempo map, or '' without tempo events.
export function bpmLabel(tempos) {
  const range = bpmRange(tempos);
  if (!range) return '';
  const [lo, hi] = range.map((b) => Math.round(b));
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

// Per-chart counts shown in each instrument card: [{ label, value }].
export function chartStats(chart) {
  if (!chart) return [];
  const rows = [{ label: 'Notas', value: String(chart.notes.length) }];
  if (chart.mode === 'vocals') {
    rows.push({ label: 'Letra', value: String(chart.lyrics?.length ?? 0) });
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

// The instrument a stem belongs to: drums_1, drums_2, drums_kick ... are all "drums"; guitar_2 is "guitar".
export function stemGroup(label) {
  const n = String(label).toLowerCase().trim();
  if (stemKind(n) === 'drum') return 'drums';
  const base = n.replace(/[\s_\-]*\d+$/, '').replace(/[\s_\-]+$/, '');
  return base || n;
}

export function stemGroupLabel(key) {
  const names = { drums: 'Bateria', vocals: 'Vocal', guitar: 'Guitarra', bass: 'Baixo', rhythm: 'Rhythm', keys: 'Teclado', song: 'Música', crowd: 'Plateia', backing: 'Backing' };
  return names[key] ?? key;
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
