// Splitting vocal phrases into display lines, as YARG's static lyrics do.
// Reference: YARG.Core Chart/Loaders/MoonSong/MoonSongLoader.Vocals.cs (SplitStaticLyricPhrases, TrySplitByStaticShift,
// SplitPhraseByTime, SplitPhraseByCharacterCount, CreateSubPhraseByIndex/ByTick) and Utility/StaticLyricConstants.cs.
//
// A phrase is { time, timeEnd, tick, tickEnd, lyrics }; a lyric is { time, end, tick, tickEnd, text, join, ... }
// (`join` = the syllable is joined or hyphenated with the next one; `end` = time + the length of its note).
// Pure functions, shared by chart.js (real phrases) and karaoke.js (fallback for charts without phrases).

export const SMALL_GAP_SEC = 0.4; // StaticLyricConstants.SMALL_GAP_THRESHOLD: a gap this long between syllables splits a phrase
export const MAX_LINE_CHARS = 50; // SplitPhraseByCharacterCount maxCharCap

const sub = (phrase, from, count, time, tick, timeEnd, tickEnd) => ({
  time, tick, timeEnd, tickEnd, lyrics: phrase.lyrics.slice(from, from + count),
});

// SplitPhraseByTime: split where the next syllable starts >= 0.4 s after the previous one ends,
// never after a syllable joined to the next one.
function splitByTime(phrase) {
  const L = phrase.lyrics;
  if (L.length === 0) return [phrase];
  const out = [];
  let startTime = phrase.time;
  let startTick = phrase.tick;
  let startIdx = 0;
  let prev = L[0];
  for (let i = 1; i < L.length; i++) {
    const l = L[i];
    if (l.time >= prev.end + SMALL_GAP_SEC && !prev.join) {
      out.push(sub(phrase, startIdx, i - startIdx, startTime, startTick, prev.end, prev.tickEnd));
      startTime = l.time;
      startTick = l.tick;
      startIdx = i;
    }
    prev = l;
  }
  if (startIdx === 0) return [phrase];
  out.push(sub(phrase, startIdx, L.length - startIdx, startTime, startTick, L[L.length - 1].end, L[L.length - 1].tickEnd));
  return out;
}

// SplitPhraseByCharacterCount: over 50 characters, cut into ceil(chars / 37.5) chunks and split at the first
// word boundary (a syllable that is not joined to the next) once a chunk reaches the target size.
function splitByCharCount(phrase, maxChars = MAX_LINE_CHARS) {
  const L = phrase.lyrics;
  if (L.length === 0) return [phrase];
  const total = L.reduce((n, l) => n + (l.text?.length ?? 0), 0);
  if (total <= maxChars) return [phrase];
  const chunks = Math.ceil(total / (maxChars * 0.75));
  const target = Math.ceil(total / chunks);
  const out = [];
  let chunkLen = 0;
  let startTime = phrase.time;
  let startTick = phrase.tick;
  let startIdx = 0;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    chunkLen += l.text?.length ?? 0;
    if (i !== L.length - 1 && !l.join && chunkLen >= target) {
      out.push(sub(phrase, startIdx, i + 1 - startIdx, startTime, startTick, l.end, l.tickEnd));
      startTime = l.end;
      startTick = l.tickEnd;
      startIdx = i + 1;
      chunkLen = 0;
    }
  }
  out.push(sub(phrase, startIdx, L.length - startIdx, startTime, startTick, phrase.timeEnd, phrase.tickEnd));
  return out;
}

// Time then character-count splitting of one phrase.
export function splitPhrase(phrase) {
  return splitByTime(phrase).flatMap((p) => splitByCharCount(p));
}

// TrySplitByStaticShift: cut a phrase at every shift tick that falls inside it. `shifts` is sorted;
// `cursor.i` keeps its place across phrases. Returns null when the phrase is not cut.
function splitByShifts(phrase, shifts, cursor, toSec) {
  if (shifts.length === 0 || cursor.i >= shifts.length) return null;
  while (shifts[cursor.i] < phrase.tick) {
    cursor.i++;
    if (cursor.i >= shifts.length) return null;
  }
  if (shifts[cursor.i] >= phrase.tickEnd) return null;
  const out = [];
  const part = (startTime, startTick, endTime, endTick) => ({
    time: startTime,
    tick: startTick,
    timeEnd: endTime,
    tickEnd: endTick,
    lyrics: phrase.lyrics.filter((l) => l.tick >= startTick && l.tick < endTick),
  });
  let lastTick = phrase.tick;
  let lastTime = phrase.time;
  while (cursor.i < shifts.length && shifts[cursor.i] < phrase.tickEnd) {
    const shift = shifts[cursor.i];
    out.push(part(lastTime, lastTick, toSec(shift), shift));
    lastTick = shift;
    lastTime = toSec(shift);
    cursor.i++;
  }
  out.push(part(lastTime, lastTick, phrase.timeEnd, phrase.tickEnd));
  return out;
}

// SplitStaticLyricPhrases. `shifts` are the lyric-shift ticks (note 1 on the vocal track); when there are none,
// the ends of the syllables marked with '/' are used instead. Phrases left without lyrics are dropped.
export function splitStaticPhrases(phrases, shifts, toSec) {
  let points = [...shifts];
  if (points.length === 0) {
    for (const p of phrases) for (const l of p.lyrics) if (l.staticShift) points.push(l.tickEnd);
  }
  points = points.sort((a, b) => a - b);
  const cursor = { i: 0 };
  const out = [];
  for (const phrase of phrases) {
    const cut = splitByShifts(phrase, points, cursor, toSec) ?? [phrase];
    for (const piece of cut) out.push(...splitPhrase(piece));
  }
  return out.filter((p) => p.lyrics.length > 0);
}
