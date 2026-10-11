// Karaoke view: the lyrics of a vocal chart as lines of syllables, with the progress through the line at a time `t`.
// Pure functions (the canvas drawing lives in highway.js).

const LINE_GAP_SEC = 1.2; // a pause this long between two syllables starts a new line
const LINE_MAX_CHARS = 44; // and so does a word boundary past this many characters
const MAX_SYLLABLE_SEC = 1.2; // the fill of a syllable never takes longer than this, even before a long rest

// lyrics: [{ time, text }] sorted by time (text as chart.js displays it: "-" and "‿" join a syllable to the next).
// Returns [{ start, end, syl: [{ time, end, text, join }] }]; `join` = no space before the next syllable.
export function buildKaraokeLines(lyrics) {
  const lines = [];
  let line = null;
  let chars = 0;
  for (let i = 0; i < lyrics.length; i++) {
    const raw = lyrics[i].text;
    if (!raw) continue;
    const join = /[-‿]$/.test(raw);
    const text = raw.replace(/[-‿]$/, '');
    if (!text) continue;
    const time = lyrics[i].time;
    const nextTime = lyrics[i + 1]?.time ?? time + 0.5;
    const end = Math.min(nextTime, time + MAX_SYLLABLE_SEC);
    const prev = line?.syl[line.syl.length - 1];
    const gap = prev ? time - prev.end : 0;
    const breakHere = !line || gap >= LINE_GAP_SEC || (chars >= LINE_MAX_CHARS && !prev.join);
    if (breakHere) {
      line = { start: time, end, syl: [] };
      lines.push(line);
      chars = 0;
    }
    line.syl.push({ time, end, text, join });
    line.end = end;
    chars += text.length + (join ? 0 : 1);
  }
  return lines;
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
