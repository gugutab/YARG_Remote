// Descriptive data for the song info screen: metadata from song.ini and statistics from the built chart.
// Pure functions, no DOM.
import { plainText, packOf, iniBool } from './ini.js';

// song.ini difficulty keys (value 0..6 = difficulty level, -1 = no part). Labels for the UI.
export const DIFF_LABELS = [
  ['diff_guitar', 'Guitar'], ['diff_bass', 'Bass'], ['diff_rhythm', 'Rhythm'], ['diff_guitar_coop', 'Guitar coop'],
  ['diff_keys', 'Keys'], ['diff_drums', 'Drums'], ['diff_drums_real', 'Drums Pro'],
  ['diff_vocals', 'Vocals'], ['diff_vocals_harm', 'Harmonies'],
  ['diff_guitar_real', 'Guitar Pro'], ['diff_bass_real', 'Bass Pro'], ['diff_keys_real', 'Keys Pro'],
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

// Header chips, in display order: Pack, Album, Track, Length, Charter first, then the rest.
// [ini key, label, icon id]; the track number is shown once, as "Track" (album track, else playlist track).
const META_ORDER = ['pack', 'album', 'track', 'length', 'charter', 'artist', 'genre', 'year', 'frets', 'playlist', 'sub_playlist', 'delay'];

// [{ label, value, icon }] for the header chips; empty values are left out.
export function metaRows(song) {
  const ini = song.ini || {};
  const text = (v) => {
    const t = plainText(v);
    return t && t !== '-1' ? t : '';
  };
  const delay = Number(ini.delay);
  const items = {
    pack: ['Pack', packOf(song), 'package'],
    album: ['Album', text(song.album), 'disc'],
    track: ['Track', text(ini.album_track) || text(ini.playlist_track), 'hash'],
    length: ['Length', formatDuration(ini.song_length), 'clock'],
    charter: ['Charter', text(ini.charter), 'pen'],
    artist: ['Artist', text(song.artist), 'user'],
    genre: ['Genre', text(ini.genre), 'tag'],
    year: ['Year', text(ini.year), 'calendar'],
    frets: ['Frets', text(ini.frets), 'pen'],
    playlist: ['Playlist', text(ini.playlist), 'list'],
    sub_playlist: ['Subplaylist', text(ini.sub_playlist), 'list'],
    delay: ['Audio delay', Number.isFinite(delay) && delay !== 0 ? `${delay} ms` : '', 'clock'],
  };
  return META_ORDER.map((k) => ({ key: k, label: items[k][0], value: items[k][1], icon: items[k][2] })).filter((r) => r.value);
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

// The song.ini keys YARG reads (YARG.Core IO/Ini/SongIniHandler.cs) that the extra list shows with a readable
// label, in display order: [key, label, kind]. Kinds: 'time' = milliseconds, 'bool' = Yes/No. Keys not listed here are
// still shown (raw name, alphabetical) after these.
const EXTRA_KEYS = [
  // release and tags
  ['sub_genre', 'Subgenre'], ['tags', 'Tags'], ['date_released', 'Released'], ['version', 'Chart version'],
  ['rating', 'Rating'], ['count', 'Song count'], ['covered_by', 'Covered by'], ['location', 'Location'],
  ['lyrics', 'Has lyrics', 'bool'], ['modchart', 'Modchart', 'bool'], ['tutorial', 'Tutorial', 'bool'], ['clean_vocals', 'Clean vocals', 'bool'],
  // charters (the plain `charter` is a header chip)
  ['charter_audio', 'Charter: audio'], ['charter_guitar', 'Charter: guitar'], ['charter_guitar_6f', 'Charter: guitar (6 fret)'],
  ['charter_bass', 'Charter: bass'], ['charter_bass_6f', 'Charter: bass (6 fret)'], ['charter_rhythm', 'Charter: rhythm'],
  ['charter_rhythm_6f', 'Charter: rhythm (6 fret)'], ['charter_keys', 'Charter: keys'], ['charter_drums', 'Charter: drums'],
  ['charter_elite_drums', 'Charter: elite drums'], ['charter_vocals', 'Charter: vocals'], ['charter_venue', 'Charter: venue'],
  ['charter_pro_guitar', 'Charter: pro guitar'], ['charter_pro_bass', 'Charter: pro bass'], ['charter_pro_keys', 'Charter: pro keys'],
  ['charter_lower_diff', 'Charter: lower difficulties'],
  // credits
  ['credit_written_by', 'Credit: written by'], ['credit_composed_by', 'Credit: composed by'], ['credit_arranged_by', 'Credit: arranged by'],
  ['credit_performed_by', 'Credit: performed by'], ['credit_produced_by', 'Credit: produced by'], ['credit_engineered_by', 'Credit: engineered by'],
  ['credit_mixed_by', 'Credit: mixed by'], ['credit_mastered_by', 'Credit: mastered by'], ['credit_published_by', 'Credit: published by'],
  ['credit_courtesy_of', 'Credit: courtesy of'], ['credit_album_art_designed_by', 'Credit: album art'], ['credit_background', 'Credit: background'],
  ['credit_license', 'Credit: license'], ['credit_other', 'Credit: other'],
  // vocals
  ['vocal_gender', 'Vocal gender'], ['vocal_character_hint', 'Vocal character'], ['vocal_scroll_speed', 'Vocal scroll speed'],
  // media and timing
  ['cover', 'Cover image'], ['background', 'Background'], ['video', 'Video'], ['video_start_time', 'Video start', 'time'],
  ['video_end_time', 'Video end', 'time'], ['video_loop', 'Video loops', 'bool'], ['preview_end_time', 'Preview end', 'time'],
  ['venue_hint', 'Venue hint'], ['tuning_offset_cents', 'Tuning offset (cents)'],
  // chart reading rules (applied by the chart builder)
  ['hopo_frequency', 'HOPO frequency (ticks)'], ['hopofreq', 'HOPO frequency (legacy)'], ['eighthnote_hopo', 'Eighth-note HOPO', 'bool'],
  ['sustain_cutoff_threshold', 'Sustain cutoff (ticks)'], ['five_lane_drums', 'Five-lane drums', 'bool'], ['pro_drums', 'Pro drums', 'bool'],
  ['multiplier_note', 'Star power note'], ['star_power_note', 'Star power note'], ['end_events', 'End events', 'bool'],
  // links
  ['link_youtube', 'Link: YouTube'], ['link_spotify', 'Link: Spotify'], ['link_bandcamp', 'Link: Bandcamp'], ['link_bluesky', 'Link: Bluesky'],
  ['link_facebook', 'Link: Facebook'], ['link_instagram', 'Link: Instagram'], ['link_twitter', 'Link: Twitter'], ['link_other', 'Link: other'],
  // gameplay setup
  ['guitar_type', 'Guitar type'], ['bass_type', 'Bass type'], ['keys_type', 'Keys type'], ['kit_type', 'Drum kit type'], ['dance_type', 'Dance type'],
  ['real_guitar_tuning', 'Pro guitar tuning'], ['real_bass_tuning', 'Pro bass tuning'],
];
const EXTRA_INDEX = new Map(EXTRA_KEYS.map((k, i) => [k[0], i]));

// "1:23" / "1:23.5" for a time in milliseconds; '' when it is not a number.
function formatMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '';
  const total = Math.abs(n) / 1000;
  const m = Math.floor(total / 60);
  const sec = total - m * 60;
  const whole = Number.isInteger(sec) ? String(sec).padStart(2, '0') : sec.toFixed(1).padStart(4, '0');
  return `${n < 0 ? '-' : ''}${m}:${whole}`;
}

// Every other song.ini property as label/value rows: the keys YARG knows come first with readable labels (see
// EXTRA_KEYS), then the rest by raw name.
export function extraRows(song) {
  return Object.entries(song.ini || {})
    .filter(([key]) => !SHOWN_KEYS.has(key))
    .map(([key, raw]) => {
      const known = EXTRA_KEYS[EXTRA_INDEX.get(key)];
      let value = plainText(raw);
      if (known?.[2] === 'time') value = formatMs(raw) || value;
      else if (known?.[2] === 'bool') value = iniBool(raw) ? 'Yes' : 'No';
      return { label: known ? known[1] : key, value, order: known ? EXTRA_INDEX.get(key) : Infinity };
    })
    .filter((r) => r.value !== '')
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'en'))
    .map(({ label, value }) => ({ label, value }));
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
  const rows = [{ label: 'Notes', value: String(chart.notes.length) }];
  if (chart.mode === 'vocals') {
    rows.push({ label: 'Lyrics', value: String(chart.lyrics?.length ?? 0) });
    if (chart.harmonies?.length) rows.push({ label: 'Harmonies', value: String(chart.harmonies.length) });
    if (chart.percussion?.length) rows.push({ label: 'Percussion', value: String(chart.percussion.length) });
  } else {
    const sustains = chart.notes.filter((n) => n.length > 0).length;
    if (sustains) rows.push({ label: 'Sustains', value: String(sustains) });
    if (chart.rolls?.length) rows.push({ label: 'Rolls', value: String(chart.rolls.length) });
  }
  rows.push({ label: 'Solos', value: String(chart.solos?.length ?? 0) });
  rows.push({ label: 'Star power', value: String(chart.starPower?.length ?? 0) });
  rows.push({ label: 'Sections', value: String(chart.sections?.length ?? 0) });
  return rows;
}

// Which icon and corner badge represent a stem in the mixer (stem file names vary: drums_1, guitar, song, ...).
export function stemKind(label) {
  const n = String(label).toLowerCase();
  if (/drum|kick|snare|cymbal|\btom|percus/.test(n)) return 'drum';
  if (/vocal|vox|harm|sing/.test(n)) return 'mic';
  if (/key|piano|organ|synth/.test(n)) return 'keys';
  if (/bass/.test(n)) return 'bass';
  if (/rhythm/.test(n)) return 'rhythm';
  if (/guitar|lead/.test(n)) return 'guitar';
  if (/crowd|audience/.test(n)) return 'users';
  return 'music';
}

// In Rock Band / Clone Hero audio the bass is often stored as `rhythm.ogg`. When the song has no rhythm part but has a bass part (and no
// `bass` stem of its own), that stem is the bass: it gets the Bass label (and so the bass icon and name) in the mixer.
// stems: [{ id, label, ... }]; hasPart(instrument) -> boolean. Returns new stem objects (the ids stay, they are file names).
export function relabelStems(stems, hasPart) {
  const labels = new Set(stems.map((s) => String(s.label).toLowerCase()));
  if (!labels.has('rhythm') || labels.has('bass') || hasPart('rhythm') || !hasPart('bass')) return stems;
  return stems.map((s) => (String(s.label).toLowerCase() === 'rhythm' ? { ...s, label: 'bass' } : s));
}

// The instrument a stem belongs to: drums_1, drums_2, drums_kick ... are all "drums"; guitar_2 is "guitar".
export function stemGroup(label) {
  const n = String(label).toLowerCase().trim();
  if (stemKind(n) === 'drum') return 'drums';
  const base = n.replace(/[\s_\-]*\d+$/, '').replace(/[\s_\-]+$/, '');
  return base || n;
}

export function stemGroupLabel(key) {
  const names = { drums: 'Drums', vocals: 'Vocals', guitar: 'Guitar', bass: 'Bass', rhythm: 'Rhythm', keys: 'Keys', song: 'Song', crowd: 'Crowd', backing: 'Backing' };
  return names[key] ?? key;
}

// Short text that tells apart stems sharing an icon: the trailing number (drums_2 -> "2"). Bass and rhythm have their own icons.
export function stemBadge(label) {
  const n = String(label).toLowerCase();
  const digits = /(\d+)$/.exec(n);
  if (digits) return digits[1];
  return '';
}

// The header chips a user can switch on and off: [{ value, label }] (the keys of metaRows, plus 'bpm' added by the app).
export const DETAIL_CHIPS = [
  { value: 'pack', label: 'Pack' }, { value: 'album', label: 'Album' }, { value: 'track', label: 'Track' }, { value: 'length', label: 'Length' },
  { value: 'charter', label: 'Charter' }, { value: 'genre', label: 'Genre' }, { value: 'year', label: 'Year' }, { value: 'bpm', label: 'BPM' },
  { value: 'frets', label: 'Frets' }, { value: 'playlist', label: 'Playlist' }, { value: 'sub_playlist', label: 'Subplaylist' }, { value: 'delay', label: 'Audio delay' },
];
