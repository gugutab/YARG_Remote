// Pure rules of the song start delay and the song info overlay (YARG: SONG_START_DELAY, SongInfoText, KeepSongInfoVisible).
import { plainText } from './ini.js';
import { metaRows } from './songinfo.js';

export const FRESH_START_SEC = 0.5; // playback counts as "from the very beginning" below this position
export const INFO_AFTER_START_MS = 3000; // the overlay stays this long after the song actually starts (with a start delay)
export const INFO_FIRST_PLAY_MS = 4000; // ...or this long after a first play without a delay
export const START_SCREEN_SEC = 3; // the first play of a song starts with the full pause screen (instrument cards included) for this long, then the song plays

// Is this Play a fresh start (no resume from a pause, no loop restart, not the Listen card's sound)?
export function isFreshStart({ position, resumed = false, loop = false, background = false, ended = false }) {
  return position < FRESH_START_SEC && !resumed && !loop && !background && !ended;
}

// The overlay's lines: { title, artist, details: [album, year, genre] } (empty values left out).
export function overlayLines(song) {
  const rows = Object.fromEntries(metaRows(song).map((r) => [r.key, r.value]));
  return {
    title: plainText(song.title) || 'Untitled',
    artist: plainText(song.artist),
    details: ['album', 'year', 'genre'].map((k) => rows[k]).filter(Boolean),
  };
}

// What to do at a Play: { delay: seconds to wait (0: none), show: overlay visible, hideMs: ms until it fades (null: stays) }.
export function startPlan({ fresh, delay, overlayOn, keep, firstOfSong }) {
  if (!fresh) return { delay: 0, show: false, hideMs: null };
  const wait = delay > 0 ? delay : 0;
  if (overlayOn && firstOfSong) { // the start screen: the pause screen with the selector, the song starts when its time is up (or at the Play button)
    return { delay: Math.max(wait, START_SCREEN_SEC), show: true, screen: true, hideMs: keep ? null : 0 };
  }
  const show = overlayOn && wait > 0;
  return { delay: wait, show, hideMs: keep ? null : wait > 0 ? INFO_AFTER_START_MS : INFO_FIRST_PLAY_MS };
}
