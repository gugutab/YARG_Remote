// Vocal charts: notes (pitched, talkie, pitch slides), lyrics paired with their notes, display phrases,
// harmony lyric merging and range shifts. Follows YARG.Core Chart/Loaders/MoonSong/MoonSongLoader.Vocals.cs
// (LoadVocalsPart, GetVocalsPhrases, FixLyricLengths, MergePhrases, GetRangeShifts), LyricSymbols.cs and
// MoonscraperChartParser/IO/Midi MidIOHelper.cs + MidReader.ProcessLists.cs (BuildVocalsNoteProcessDict).

import { splitStaticPhrases } from './lyricphrases.js';

const VOCAL_RANGE = [36, 84]; // MidIOHelper VOCALS_RANGE_START/END
const RANGE_SHIFT_NOTE = 0;
const LYRIC_SHIFT_NOTE = 1;
const STARPOWER_NOTE = 116; // MidIOHelper STARPOWER_NOTE: on a vocal track too
const PHRASE_NOTES = [105, 106]; // LYRICS_PHRASE_1/2: both are a scoring phrase and a static lyric phrase
const PERCUSSION_NOTE = 96;
const DUMMY_RANGE = { time: 0, length: 0, min: 48, max: 72 }; // GetRangeShifts: `new(48, 72, 0, 0, 0, 0)`

// Symbols that only mark timing or scoring are not shown (LyricSymbols.VOCALS_STRIP_SYMBOLS, including quotation marks);
// '=' is a hyphen, '§' joins two lexical syllables ('‿') and '_' is a space (VOCALS_SYMBOL_REPLACEMENTS).
export function displayLyric(text) {
  return text
    .replace(/<\/?[a-zA-Z][^>]*>/g, '') // rich text tags
    .replace(/[+#^*%/$"]/g, '')
    .replace(/=/g, '-')
    .replace(/§/g, '‿')
    .replace(/_/g, ' ')
    .trim();
}

// LyricSymbols.GetLyricFlags: '$' at the start hides the lyric in harmonies; the symbols at the end set the other flags.
export function lyricFlags(text) {
  const f = { join: false, hyphen: false, nonPitched: false, slide: false, hidden: text[0] === '$', rangeShift: false, staticShift: false };
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '-') f.join = true;
    else if (c === '=') f.hyphen = true;
    else if (c === '+') f.slide = true;
    else if (c === '#' || c === '^' || c === '*') f.nonPitched = true;
    else if (c === '%') f.rangeShift = true;
    else if (c === '/') f.staticShift = true;
    else if (c === '$') f.hidden = true;
    else break;
  }
  return f;
}

const NO_FLAGS = lyricFlags('');

// Lyrics are meta type 5 events when present (most charts). Some charts put them in text events
// instead, where bracketed texts are sections or states, not lyrics.
export const lyricEventsOf = (t) => (t.lyrics.length > 0 ? t.lyrics : t.texts.filter((x) => !x.text.startsWith('[')));

// MoonSongLoader.ProcessLyric. Returns null for an empty event, else { flags, lyric } (lyric is null when only symbols remain).
function parseLyric(raw, lyrics, tick, toSec) {
  let t = raw.replace(/^\s+/, '');
  if (!t) return null;
  // DeferredLyricJoinWorkaround: "+-" / "-+" puts the hyphen of a pitch bend on the previous lyric.
  const last = lyrics[lyrics.length - 1];
  if (last && !last.join && (t === '+-' || t === '-+')) {
    last.join = true;
    last.text += '-';
    t = '+';
  }
  const flags = lyricFlags(t);
  const text = displayLyric(t);
  if (!text) return { flags, lyric: null };
  const time = toSec(tick);
  return { flags, lyric: { tick, tickEnd: tick, time, end: time, text, join: flags.join || flags.hyphen, hidden: flags.hidden, staticShift: flags.staticShift } };
}

const phraseRanges = (vTrack) => vTrack.notes
  .filter((n) => PHRASE_NOTES.includes(n.pitch))
  .map((n) => ({ tick: n.tick, end: n.endTick }))
  .sort((a, b) => a.tick - b.tick);

// Pitched notes plus percussion hits (which take part in the lyric pairing like any note).
const wrapNotes = (vTrack) => vTrack.notes
  .filter((n) => (n.pitch >= VOCAL_RANGE[0] && n.pitch <= VOCAL_RANGE[1]) || n.pitch === PERCUSSION_NOTE)
  .map((n) => ({ tick: n.tick, endTick: n.endTick, pitch: n.pitch, perc: n.pitch === PERCUSSION_NOTE, slide: false, talkie: false, children: [] }));

const totalEndTick = (note) => (note.children.length ? note.children[note.children.length - 1].endTick : note.endTick);

// GetVocalsPhrases: walk the phrases and their notes, give every note the lyric events up to its tick (the last one's
// symbols decide whether it is a pitch slide or a talkie) and collect the lyrics of each phrase.
// A '+' note continues the previous note (child note). Notes outside any phrase are kept, with their flags.
function walkPart(notes, events, phrases, toSec) {
  let ni = 0;
  let ei = 0;
  let carried = null;
  let prevParent = null;
  let lastAny = null;
  const out = [];
  const take = (note, lyrics) => {
    let flags = NO_FLAGS;
    while (ei < events.length && events[ei].tick <= note.tick) {
      const ev = events[ei++];
      const r = parseLyric(ev.text, lyrics, ev.tick, toSec);
      if (!r) continue;
      flags = r.flags;
      if (r.lyric) lyrics.push(r.lyric);
    }
    note.talkie = flags.nonPitched || note.perc;
    return flags;
  };
  const attach = (parent, note) => {
    note.slide = true;
    parent.children.push(note);
  };
  const orphan = (note) => {
    const flags = take(note, []);
    if (flags.slide && lastAny) attach(lastAny, note);
    else lastAny = note;
  };

  for (const ph of phrases) {
    if (carried && carried.tick + (totalEndTick(carried) - carried.tick) < ph.tick) carried = null;
    const lyrics = [];
    const pnotes = [];
    let prev = null;
    while (ni < notes.length) {
      const n = notes[ni];
      if (n.tick >= ph.end) break;
      ni++;
      if (n.tick < ph.tick) { orphan(n); continue; }
      const flags = take(n, lyrics);
      if (flags.slide) {
        if (prev) { attach(prev, n); continue; }
        if (carried) { attach(carried, n); continue; }
        if (out.length === 0) continue; // a slide with nothing to continue: charting error
        if (prevParent) { attach(prevParent, n); carried ??= prevParent; continue; }
      }
      if (n.endTick > ph.end) carried = n;
      pnotes.push(n);
      prev = n;
      lastAny = n;
      if (!n.perc) prevParent = n;
    }
    if (pnotes.length < 1 && !carried) continue; // e.g. a HARM1 phrase that only HARM2/3 sing in
    out.push({ tick: ph.tick, tickEnd: ph.end, time: toSec(ph.tick), timeEnd: toSec(ph.end), notes: pnotes, lyrics });
  }
  while (ni < notes.length) orphan(notes[ni++]);
  // Done at the end because of carried notes (children added after their phrase was built).
  return out.map((p) => fixLyricLengths(p, toSec));
}

// FixLyricLengths (static lyric phrases): every note takes the nearest lyric not taken yet and gives it its
// length (children included); lyrics no note claims are removed.
function fixLyricLengths(phrase, toSec) {
  const L = phrase.lyrics;
  const matched = new Array(L.length).fill(false);
  for (const note of phrase.notes) {
    let dist = Infinity;
    let best = -1;
    for (let j = 0; j < L.length; j++) {
      if (matched[j]) continue;
      const d = Math.abs(note.tick - L[j].tick);
      if (d < dist) { dist = d; best = j; } else break;
    }
    if (best < 0) continue;
    matched[best] = true;
    const endTick = totalEndTick(note);
    L[best].end = L[best].time + (toSec(endTick) - toSec(note.tick));
    L[best].tickEnd = L[best].tick + (endTick - note.tick);
  }
  return { ...phrase, lyrics: L.filter((_, i) => matched[i]) };
}

// ---- harmony lyric merging (MergePhrases / MergePhrasePair) ----

const makeWord = (syl) => ({ syl, tick: syl[0].tick, tickEnd: syl[syl.length - 1].tickEnd, time: syl[0].time, end: syl[syl.length - 1].end, text: syl.map((s) => s.text).join('') });
function toWords(lyrics) {
  const words = [];
  let cur = [];
  for (const l of lyrics) {
    cur.push(l);
    if (!l.join) { words.push(makeWord(cur)); cur = []; }
  }
  if (cur.length) words.push(makeWord(cur));
  return words;
}
const alnum = (s) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

function mergePair(main, other, tolerance) {
  const clone = (l) => ({ ...l });
  const mw = toWords(main.lyrics.filter((l) => !l.hidden).map(clone));
  const ow = toWords(other.lyrics.filter((l) => !l.hidden).map(clone));
  if (mw.length === 0 && ow.length === 0) return main;
  if (mw.length === 0) return other;
  if (ow.length === 0) return main;
  const merged = [];
  let oi = 0;
  let lastMain = true;
  for (const w of mw) {
    while (oi < ow.length && ow[oi].tick < w.tick - tolerance) { // other words before this one
      lastMain = false;
      merged.push(...ow[oi++].syl);
    }
    if (oi < ow.length && Math.abs(ow[oi].tick - w.tick) <= tolerance) { // a simultaneous word
      const o = ow[oi++];
      if (alnum(o.text) === alnum(w.text)) {
        // same word: keep one, with the earliest start and latest end; a lower-case start wins
        let sel = w;
        lastMain = true;
        if (/^[a-zß-öø-ÿ]/.test(o.text)) { lastMain = false; sel = o; }
        const first = sel.syl[0];
        const lastSyl = sel.syl[sel.syl.length - 1];
        first.time = Math.min(o.time, w.time);
        first.tick = Math.min(o.tick, w.tick);
        lastSyl.end = Math.max(o.end, w.end);
        lastSyl.tickEnd = Math.max(o.tickEnd, w.tickEnd);
        merged.push(...sel.syl);
      } else if (lastMain) { // different words: the other one right after, in whichever order reads best
        merged.push(...w.syl, ...o.syl);
        lastMain = false;
      } else {
        merged.push(...o.syl, ...w.syl);
        lastMain = true;
      }
    } else {
      merged.push(...w.syl);
      lastMain = true;
    }
  }
  while (oi < ow.length) merged.push(...ow[oi++].syl);
  return { time: main.time, timeEnd: main.timeEnd, tick: main.tick, tickEnd: main.tickEnd, lyrics: merged };
}

// Phrases starting on the same tick are merged; the others are kept as they are. Both lists are sorted by tick.
function mergePhrases(mains, others, division) {
  const tolerance = Math.floor(division / 4) - 1; // a 16th note
  const out = [];
  let oi = 0;
  for (const m of mains) {
    while (oi < others.length && others[oi].tick < m.tick) out.push(others[oi++]);
    if (oi < others.length && others[oi].tick === m.tick) out.push(mergePair(m, others[oi++], tolerance));
    else out.push(m);
  }
  while (oi < others.length) out.push(others[oi++]);
  return out;
}

// ---- range shifts (GetRangeShifts) ----

// Shift points: note 0 phrases (length = its duration), "[range_shift]" / "[range_shift 0.5]" text events (length in
// seconds) and lyrics ending in '%'. Each range runs from one point to the next and covers the pitched notes in it.
function rangeShifts(track, events, notes, toSec) {
  const marks = [{ tick: 0, length: 0 }];
  for (const n of track.notes) if (n.pitch === RANGE_SHIFT_NOTE) marks.push({ tick: n.tick, length: toSec(n.endTick) - toSec(n.tick) });
  for (const t of track.texts) {
    const m = /^\[?\s*range_shift(?:\s+([^\]\s]+))?\s*\]?$/.exec(t.text.trim());
    if (m) marks.push({ tick: t.tick, length: Number.isFinite(parseFloat(m[1])) ? parseFloat(m[1]) : 0 });
  }
  for (const e of events) {
    const text = e.text.replace(/^\s+/, '');
    if (text && lyricFlags(text).rangeShift) marks.push({ tick: e.tick, length: 0 });
  }
  marks.sort((a, b) => a.tick - b.tick);
  const ranges = [];
  marks.forEach((m, i) => {
    const endTick = i + 1 < marks.length ? marks[i + 1].tick : Infinity;
    let min = Infinity;
    let max = -Infinity;
    for (const n of notes) {
      if (n.tick >= endTick || n.endTick < m.tick) continue;
      min = Math.min(min, n.pitch);
      max = Math.max(max, n.pitch);
    }
    if (min !== Infinity) ranges.push({ time: toSec(m.tick), length: m.length, min, max });
  });
  return ranges.length ? ranges : [DUMMY_RANGE];
}

// ---- the vocal chart ----

// midi: parsed file; track: the lead track (PART VOCALS, or HARM1 for harmonies); harmonyParts: [{ part, track }] when
// building the harmony instrument; timed(note) -> { time, end, length }.
// Returns { notes, harmonies, percussion, lyrics, lyrics1, lyrics2, phrases, rangeShifts }: `lyrics` are the merged static lyrics (karaoke),
// `lyrics1` the lead voice's own words and `lyrics2` the other voices' own words (harmony charts; null / [] otherwise); `voiceLyrics` the words of each voice for the karaoke sheets
// ({ 1, 2, 3 }: its own words plus the lead's where it sings along; null for a solo chart).
//   notes/harmonies[].notes: { time, end, length, pitch, slide, talkie } (slide: continues the previous note; talkie: unpitched)
//   lyrics: { time, end, text, join, sp } with `end` from the paired note (`sp` true inside a star power phrase: drawn yellow); phrases: { start, end, from, to } (lyrics[from..to)),
//   the display lines of YARG's static lyrics; rangeShifts: { time, length, min, max }.
export function buildVocals({ midi, track, harmonyParts = [], toSec, timed }) {
  const harmony = harmonyParts.length > 0;
  const soloTrack = midi.tracks.find((t) => t.name.toUpperCase() === 'PART VOCALS');

  // Percussion (YARG.Core MidReader.ProcessLists): note 96 is a percussion hit; 97 is ignored.
  const percussionTrack = track.notes.some((n) => n.pitch === PERCUSSION_NOTE) || !soloTrack ? track : soloTrack;
  const percussion = percussionTrack.notes
    .filter((n) => n.pitch === PERCUSSION_NOTE) // 97 (not played) has no handler in YARG's MidReader: it is not a note
    .map((n) => ({ time: toSec(n.tick) }));

  // Harmony charts may keep their lyrics (and phrases) on PART VOCALS.
  let events = lyricEventsOf(track);
  let phrases1 = phraseRanges(track);
  if (events.length === 0 && soloTrack && soloTrack !== track) events = lyricEventsOf(soloTrack);
  if (phrases1.length === 0 && soloTrack && soloTrack !== track) phrases1 = phraseRanges(soloTrack);

  const notes1 = wrapNotes(track);
  const walked1 = walkPart(notes1, events, phrases1, toSec);
  const extra = harmonyParts.filter((h) => h.part > 1).sort((a, b) => a.part - b.part).map((h) => {
    const notes = wrapNotes(h.track);
    return { part: h.part, track: h.track, notes };
  });
  // HARM3 uses HARM2's static lyric phrases (MidReader.ProcessLists.cs, CopyDownPhrases).
  const harm2 = extra.find((e) => e.part === 2);
  const walkedExtra = extra.map((e) => {
    const ranges = phraseRanges(e.part === 3 && harm2 ? harm2.track : e.track);
    return { ...e, walked: walkPart(e.notes, lyricEventsOf(e.track), ranges, toSec) };
  });

  // Display phrases: the lead's static lyric phrases, merged with HARM2/HARM3's in harmony charts, then split into lines.
  let staticPhrases = walked1;
  if (harmony) {
    const w2 = walkedExtra.find((e) => e.part === 2)?.walked ?? [];
    const w3 = walkedExtra.find((e) => e.part === 3)?.walked ?? [];
    staticPhrases = mergePhrases(walked1, mergePhrases(w2, w3, midi.division), midi.division);
  }
  const shiftTicks = track.notes.filter((n) => n.pitch === LYRIC_SHIFT_NOTE).map((n) => n.tick);
  let display = splitStaticPhrases(staticPhrases, shiftTicks, toSec);
  if (harmony) display = display.map((p) => ({ ...p, lyrics: p.lyrics.filter((l) => !l.hidden) })).filter((p) => p.lyrics.length > 0);

  const lyrics = [];
  const phrases = [];
  for (const p of display) {
    const from = lyrics.length;
    for (const l of p.lyrics) lyrics.push({ time: l.time, end: l.end, text: l.text, join: l.join });
    phrases.push({ start: p.time, end: p.timeEnd, from, to: lyrics.length });
  }
  if (lyrics.length === 0) { // no phrases (or none that pair up): every lyric as written, without lengths
    const raw = [];
    for (const e of events) {
      const r = parseLyric(e.text, raw, e.tick, toSec);
      if (r?.lyric) raw.push(r.lyric);
    }
    for (const l of raw) lyrics.push({ time: l.time, end: l.end, text: l.text, join: l.join });
  }

  // The other voices' own words (HARM2/HARM3), for a second lyric line: the visible lyrics of those parts that the lead
  // does not sing at the same moment with the same text.
  const lyrics2 = [];
  let voiceLyrics = null; // { 1: the lead's words, 2: voice 2's, 3: voice 3's } (harmony charts)
  let lyrics1 = null; // the lead voice's own words (the merged `lyrics` hold every voice's, as YARG's static lyrics do)
  if (harmony) {
    const lead = walked1.flatMap((p) => p.lyrics);
    lyrics1 = lead.filter((l) => !l.hidden && l.text).map((l) => ({ time: l.time, end: l.end, text: l.text, join: l.join }));
    const sameAs = (list, l) => list.some((o) => o.text === l.text && Math.abs(o.time - l.time) < 0.2);
    for (const e of walkedExtra) {
      const seq = e.walked.flatMap((p) => p.lyrics.filter((l) => !l.hidden && l.text)); // this voice's words, in order
      const keep = seq.map((l) => !sameAs(lead, l) && !sameAs(lyrics2, l));
      seq.forEach((l, k) => {
        if (!keep[k]) return;
        // A syllable only joins the next one when that one is shown too and close by (words the lead also sings are dropped).
        const next = seq[k + 1];
        const joined = l.join && next && keep[k + 1] && next.time - (l.end > l.time ? l.end : l.time) < 0.8;
        lyrics2.push({ time: l.time, end: l.end, text: l.text, join: !!joined, part: e.part });
      });
    }
    lyrics2.sort((x, y) => x.time - y.time);
    // The words of every voice for the karaoke, one sheet each (VOCAL 1, 2 and 3): the voice's own words, and also the lead's words wherever the voice sings along with it (its notes
    // cover the word's start) and has no word of its own there: a voice that sings the same words as the lead shows them too.
    voiceLyrics = { 1: lyrics1 };
    for (const e of walkedExtra) {
      const own = e.walked.flatMap((p) => p.lyrics.filter((l) => !l.hidden && l.text)).map((l) => ({ time: l.time, end: l.end, text: l.text, join: l.join, part: e.part }));
      const spans = e.notes.filter((n) => !n.perc).map((n) => [toSec(n.tick), toSec(totalEndTick(n))]);
      const words = [...own];
      for (const l of lyrics1) {
        if (spans.some(([a, b]) => l.time >= a - 0.05 && l.time <= b) && !own.some((o) => Math.abs(o.time - l.time) < 0.2)) words.push({ time: l.time, end: l.end, text: l.text, join: l.join, part: e.part, shared: true });
      }
      words.sort((x, y) => x.time - y.time);
      voiceLyrics[e.part] = words.map((w, k) => { // (a syllable only joins the next one when that one is shown too, and close by)
        const next = words[k + 1];
        return { ...w, join: !!(w.join && next && next.time - (w.end > w.time ? w.end : w.time) < 0.8) };
      });
    }
  }

  // Star power lyrics (MoonSongLoader.Vocals.cs GetVocalsPhraseFlags): a scoring phrase (note 105/106) is a star power phrase when it starts inside a star power
  // phrase (note 116); a lyric is star power when it falls in one of those scoring phrases (VocalStaticLyricPhraseElement). YARG draws them yellow.
  const spTrack = track.notes.some((n) => n.pitch === STARPOWER_NOTE) || !soloTrack ? track : soloTrack;
  const spSpans = spTrack.notes.filter((n) => n.pitch === STARPOWER_NOTE).map((n) => ({ tick: n.tick, end: n.endTick }));
  const spRanges = phrases1
    .filter((p) => spSpans.some((s) => p.tick >= s.tick && p.tick < s.end))
    .map((p) => ({ start: toSec(p.tick), end: toSec(p.end) }));
  const markStarPower = (list) => {
    if (!list || spRanges.length === 0) return list;
    for (const l of list) if (spRanges.some((r) => l.time >= r.start - 1e-6 && l.time < r.end - 1e-6)) l.sp = true;
    return list;
  };
  markStarPower(lyrics); markStarPower(lyrics1); markStarPower(lyrics2);
  if (voiceLyrics) for (const p of [2, 3]) markStarPower(voiceLyrics[p]);
  // The second lyric line of the notes view: the words of voices 2 and 3 together, also the ones the lead sings at the same moment (YARG shows its lyric lanes at the same time, the
  // same word in both when voices sing it together); a word both voices sing is shown once.
  // Voice 3 words that differ from voice 2's at the same moment go to a third line (`lyricsLane3`) under it, so neither is pushed aside; where the words are the same, one line shows them.
  let lyricsLane2 = null;
  let lyricsLane3 = null;
  if (voiceLyrics) {
    const v2 = voiceLyrics[2] || [];
    const same = (a, b) => a.text === b.text && Math.abs(a.time - b.time) < 0.1;
    const clash = (l) => v2.some((o) => !same(o, l) && o.time < l.end + 0.05 && l.time < Math.max(o.end, o.time + 0.3)); // a different word of voice 2 sung over it
    const lane2 = [];
    const lane3 = [];
    const seen = new Map(); // text|time -> the entry; a word both voices sing is one entry flagged `both` (shown in white)
    for (const l of [...v2, ...(voiceLyrics[3] || [])].sort((x, y) => x.time - y.time || x.part - y.part)) {
      const k = `${l.text}|${Math.round(l.time * 10)}`;
      if (seen.has(k)) { seen.get(k).both = true; continue; }
      const entry = { ...l, vw: undefined };
      seen.set(k, entry);
      (l.part === 3 && clash(l) ? lane3 : lane2).push(entry);
    }
    lyricsLane2 = lane2.length ? lane2 : null;
    lyricsLane3 = lane3.length ? lane3 : null;
  }
  const inStarPower = (time) => spRanges.some((r) => time >= r.start - 1e-6 && time < r.end - 1e-6); // (the notes of those phrases: a gold outline in the views)

  const shape = (wrapped) => wrapped.filter((n) => !n.perc).map((n) => { const tm = timed(n); return { ...tm, pitch: n.pitch, slide: n.slide, talkie: n.talkie, sp: spRanges.length > 0 && inStarPower(tm.time) }; });
  const pitched = [notes1, ...walkedExtra.map((e) => e.notes)].flat().filter((n) => !n.perc && !n.talkie);
  const anyPhrases = walked1.length > 0 || walkedExtra.some((e) => e.walked.length > 0);
  return {
    notes: shape(notes1),
    harmonies: walkedExtra.map((e) => ({ part: e.part, notes: shape(e.notes) })),
    percussion,
    lyrics,
    lyrics1,
    lyrics2,
    voiceLyrics,
    lyricsLane2,
    lyricsLane3,
    phrases,
    rangeShifts: anyPhrases ? rangeShifts(track, events, pitched, toSec) : [DUMMY_RANGE],
  };
}
