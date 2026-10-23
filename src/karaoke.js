// Karaoke view: the lyrics of a vocal chart as lines of syllables, with the progress through the line at a time `t`.
// Pure functions (the canvas drawing lives in highway.js).

import { splitPhrase } from './lyricphrases.js';

const MAX_SYLLABLE_SEC = 1.2; // without a paired note, the fill of a syllable never takes longer than this

// lyrics: [{ time, text, end?, join? }] (text as chart.js displays it: a trailing "-" joins a syllable to the next).
// phrases: chart.phrases, [{ from, to }] index ranges into `lyrics`, YARG's static lyric lines (see vocals.js).
// Returns [{ start, end, syl: [{ time, end, text, join }] }]; `join` = no space before the next syllable.
// Without phrases the lines come from the lyrics alone, split like YARG does (gaps of 0.4 s or more, then 50 characters).
export function buildKaraokeLines(lyrics, phrases) {
  const usable = phrases?.length && phrases.every((p) => p.from >= 0 && p.to <= lyrics.length);
  const groups = usable
    ? phrases.map((p) => lyrics.slice(p.from, p.to))
    : splitPhrase(rawPhrase(lyrics)).map((p) => p.lyrics);
  const lines = [];
  for (const group of groups) {
    const syl = [];
    for (const l of group) {
      const join = l.join ?? /[-‿]$/.test(l.text);
      const text = join ? l.text.replace(/[-‿]$/, '') : l.text;
      if (text) syl.push({ time: l.time, end: l.end, text, join, sp: !!l.sp });
    }
    if (syl.length) lines.push({ start: syl[0].time, end: syl[syl.length - 1].end, syl });
  }
  return lines;
}

// A single phrase holding all the lyrics, with the syllable ends estimated from the next syllable.
function rawPhrase(lyrics) {
  const list = lyrics
    .filter((l) => l.text)
    .map((l, i, all) => {
      const next = all[i + 1]?.time ?? l.time + 0.5;
      const end = l.end > l.time ? l.end : Math.min(next, l.time + MAX_SYLLABLE_SEC);
      return { ...l, end, tick: l.time, tickEnd: end, join: l.join ?? /[-‿]$/.test(l.text) };
    });
  return { time: list[0]?.time ?? 0, timeEnd: list.at(-1)?.end ?? 0, tick: 0, tickEnd: 0, lyrics: list };
}

// Which lines to show at `t`: the one being sung (or just sung) and the one coming up.
// `current` is null during a long rest (the upcoming line shows alone, only when it is near).
export function karaokeAt(lines, t) {
  let idx = -1;
  for (let i = 0; i < lines.length && lines[i].start <= t + 0.25; i++) idx = i;
  const cur = idx >= 0 ? lines[idx] : null;
  const resting = cur && t > cur.end + 2.5;
  const nextIdx = idx + 1;
  const next = lines[nextIdx] ?? null;
  const upcomingNear = next && next.start - t < 5;
  return {
    current: cur && !resting ? cur : null,
    next: next && (cur && !resting ? true : upcomingNear) ? next : null,
  };
}

// 0..1 for every syllable of a line: how much of it has been sung at `t`.
export function syllableProgress(line, t) {
  return line.syl.map((s) => (t <= s.time ? 0 : t >= s.end ? 1 : (t - s.time) / (s.end - s.time)));
}
