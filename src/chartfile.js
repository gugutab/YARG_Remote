// Clone Hero / Moonscraper notes.chart reader. It returns the same structure as parseMidi (midi.js), translating the
// .chart events into the MIDI conventions buildChart already understands, so the rest of the app is unchanged.
// Reference: YARG.Core MoonscraperChartParser/IO/Chart (ChartReader.cs, ChartReader.ProcessLists.cs, ChartIOHelper.cs)
// and Chart/Loaders/MoonSong (MoonSongLoader.Lyrics.cs for the lyrics).
//
// Translation, per instrument (the four difficulties are merged into one track, like a MIDI part):
//   [ExpertSingle]/DoubleBass/DoubleRhythm/Keyboard/Drums -> PART GUITAR / BASS / RHYTHM / KEYS / DRUMS,
//   note N 0..4 -> pitch base + lane (base 60/72/84/96); N 7 (open) -> pitch base - 1 plus an [ENHANCED_OPENS] text,
//   which buildChart already reads as "the note below green is open"; S 2 -> 116 (star power); E solo / soloend -> 103.
//   Per-difficulty flags that .mid expresses as global windows travel on the note itself: tap (N 6) and forced (N 5).
//   Drums: N 0 kick, 1-5 pads, 32 double kick (base - 1), 34-38 accent / 40-44 ghost (velocity 127 / 1), 66-68 cymbal flags,
//   S 64 fill (120), S 65 tremolo (126), S 66 trill (127), S 67 kick lane (125).
//   [Events]: sections and global events -> EVENTS track texts; "lyric ..." / phrase_start / phrase_end -> PART VOCALS.
// Not read: GHL tracks (GHLGuitar/GHLBass/GHLRhythm/GHLCoop), DoubleGuitar (co-op), versus phrases (S 0/1), [Song] Offset
// (YARG.Core ChartReader ignores it too; the audio offset comes from song.ini), and anchors (A) in [SyncTrack].
import { createTickToSeconds, MAX_MIDI_BYTES, MAX_MIDI_EVENTS, MAX_TICK, MIN_DIVISION } from './midi.js';

// The file is hostile input, like a MIDI: same size and event-count caps as parseMidi, ticks and lengths clamped to
// MAX_TICK, malformed lines ignored (YARG logs and skips them too) so one bad line does not lose the rest of the song.
export const MAX_CHART_BYTES = MAX_MIDI_BYTES;
export const MAX_CHART_EVENTS = MAX_MIDI_EVENTS;
const MAX_RESOLUTION = 0xffff; // what a MIDI header can hold; real charts use 192, 480, 960
const MAX_TIME_SIGNATURE_NUMERATOR = 255;
const MIN_MILLIBEATS = 1; // 0.001 bpm: below it 6e10 / milli leaves the finite range for no real song
const MAX_MILLIBEATS = 1e9; // 1,000,000 bpm

const DEFAULT_RESOLUTION = 192; // ChartReader.DEFAULT_RESOLUTION
const DIFFICULTY_BASE = { Easy: 60, Medium: 72, Hard: 84, Expert: 96 }; // ChartIOHelper.TrackNameToTrackDifficultyLookup
const DIFFICULTY_INDEX = { Easy: 0, Medium: 1, Hard: 2, Expert: 3 }; // index into DIFFICULTIES (chart.js)
// ChartIOHelper.InstrumentStrToEnumLookup, limited to what the app plays.
const INSTRUMENT_TRACKS = {
  Single: { name: 'PART GUITAR', kind: 'fret' },
  DoubleBass: { name: 'PART BASS', kind: 'fret' },
  DoubleRhythm: { name: 'PART RHYTHM', kind: 'fret' },
  Keyboard: { name: 'PART KEYS', kind: 'fret' },
  Drums: { name: 'PART DRUMS', kind: 'drums' },
};
const SOLO_NOTE = 103;
const STAR_POWER_NOTE = 116;
const TOM_MARKERS = { 2: 110, 3: 111, 4: 112 }; // pad offset -> MIDI tom marker (MidIOHelper PAD_TO_CYMBAL_LOOKUP)
const DRUM_PHRASES = { 64: 120, 65: 126, 66: 127, 67: 125 }; // ChartIOHelper PHRASE_*: fill, tremolo, trill, kick lane
const VELOCITY_NORMAL = 100;
const VELOCITY_ACCENT = 127; // MidIOHelper.VELOCITY_ACCENT / GHOST, what buildChart reads
const VELOCITY_GHOST = 1;
const VOCAL_NOTE = 60; // lyrics have no pitch in a .chart: they become non-pitched (talkie) notes of this pitch
const PHRASE_NOTE = 105; // LYRICS_PHRASE_1
const MAX_LYRIC_TICKS_FACTOR = 1; // a lyric note lasts until the next lyric, at most one beat

// Accepts the file bytes (BOM-aware like File.ReadAllText: UTF-8, UTF-16) or an already decoded string.
// options.maxBytes / options.maxEvents exist for tests; the defaults are the caps above.
export function parseChart(input, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_CHART_BYTES;
  if (typeof input === 'string') return parseChartText(input, options);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > maxBytes) throw new Error(`Invalid .chart: file too large (${bytes.length} bytes)`);
  return parseChartText(decode(bytes), options);
}

function decode(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes);
}

// [Name] { lines } blocks. A section ends at a line holding only "}" (GetNextSection: braces inside text events are fine).
function readSections(text, maxEvents) {
  const sections = [];
  let budget = maxEvents;
  let current = null;
  let pendingName = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (current === null) {
      const m = /^\[(.+)\]$/.exec(line);
      if (m) pendingName = m[1];
      else if (line === '{' && pendingName !== null) {
        current = { name: pendingName, lines: [] };
        sections.push(current);
        pendingName = null;
      }
    } else if (line === '}') {
      current = null;
    } else if (line) {
      if (--budget < 0) throw new Error('Invalid .chart: too many lines');
      current.lines.push(line);
    }
  }
  return sections;
}

// "tick = TYPE rest" -> { tick, type, args: [words], rest } ; null when malformed (YARG logs and skips the line).
function parseLine(line) {
  const eq = line.indexOf('=');
  if (eq < 0) return null;
  const tickText = line.slice(0, eq).trim();
  if (!/^\d+$/.test(tickText)) return null;
  const tick = Number(tickText);
  if (tick > MAX_TICK) return null; // also catches Infinity from an absurdly long digit string
  const rest = line.slice(eq + 1).trim();
  const space = rest.search(/\s/);
  const type = space < 0 ? rest : rest.slice(0, space);
  const body = space < 0 ? '' : rest.slice(space).trim();
  if (!type) return null;
  return { tick, type, body, args: body ? body.split(/\s+/) : [] };
}

const sortedEvents = (lines) => lines.map(parseLine).filter(Boolean)
  .map((e, i) => ({ ...e, order: i }))
  .sort((a, b) => a.tick - b.tick || a.order - b.order); // ChartReader.LoadChart sorts by tick, then file order

// A note / phrase length from the file: finite, 0..MAX_TICK (Infinity, NaN and negative become 0 or the cap).
function clampLength(arg) {
  const n = Number(arg);
  if (Number.isNaN(n)) return 0;
  return Math.min(MAX_TICK, Math.max(0, n));
}

// TextEvents.NormalizeTextEvent: an event's text between '[' and ']' if present; here also the surrounding quotes go.
function eventText(body) {
  let t = body.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return t.trim();
}

function parseSong(lines) {
  let resolution = DEFAULT_RESOLUTION;
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() === 'Resolution') {
      const value = Number(line.slice(eq + 1).trim().replace(/"/g, ''));
      if (Number.isFinite(value) && value > 0) {
        resolution = Math.floor(value);
        // 0 or negative: YARG falls back to the default. Anything else outside the sane range is not a song we can place.
        if (resolution < MIN_DIVISION || resolution > MAX_RESOLUTION) throw new Error(`Invalid .chart: Resolution ${resolution} is outside ${MIN_DIVISION}-${MAX_RESOLUTION}`);
      }
      break; // SubmitDataSong stops at the first Resolution
    }
  }
  return resolution;
}

function parseSync(lines) {
  const tempos = [];
  const timeSignatures = [];
  for (const e of sortedEvents(lines)) {
    if (e.type === 'B') { // millibeats per minute (SubmitDataSync: tempo / 1000 bpm)
      const milli = Number(e.args[0]);
      if (milli >= MIN_MILLIBEATS && milli <= MAX_MILLIBEATS) tempos.push({ tick: e.tick, usPerQuarter: 6e10 / milli }); // NaN fails both
    } else if (e.type === 'TS') { // numerator, then the denominator as a power of two (default 2 = quarter)
      const num = Number(e.args[0]);
      const exp = e.args[1] === undefined ? 2 : Number(e.args[1]);
      if (Number.isInteger(num) && num > 0 && num <= MAX_TIME_SIGNATURE_NUMERATOR && Number.isInteger(exp) && exp >= 0 && exp < 16) timeSignatures.push({ tick: e.tick, num, den: 2 ** exp });
    } // A (anchor): ignored, as YARG does
  }
  return { tempos, timeSignatures };
}

// One instrument track from all its difficulty sections: [{ difficulty, base, lines }].
function buildInstrument(def, sections) {
  const track = { name: def.name, notes: [], texts: [], lyrics: [], sysex: [], tempos: [], timeSignatures: [] };
  const seen = new Set();
  // Phrases (star power, solo, fills, rolls) and tom markers live inside a difficulty section, so YARG keeps them per
  // difficulty (ChartReader.ReadNotes fills one MoonChart each). A .mid shares them, so they carry `difficulty` and
  // buildChart (chart.js) only reads the ones of the difficulty it is building.
  const addPhrase = (pitch, tick, length, difficulty) => {
    const key = `${difficulty}:${pitch}:${tick}:${length}`;
    if (seen.has(key)) return;
    seen.add(key);
    track.notes.push({ tick, endTick: tick + length, pitch, velocity: VELOCITY_NORMAL, channel: 0, difficulty });
  };
  const drums = def.kind === 'drums';
  const hasCymbalFlags = drums && sections.some((s) => s.events.some((e) => e.type === 'N' && Number(e.args[0]) >= 66 && Number(e.args[0]) <= 68));
  let usesOpen = false;

  for (const { difficulty, base, events } of sections) {
    const diff = DIFFICULTY_INDEX[difficulty];
    // Flags are chord flags / pad toggles applied once all notes are in (ProcessNoteOnEventAsChordFlagPostDelay).
    const notes = [];
    const forcedTicks = new Set();
    const tapTicks = new Set();
    const flagOf = { cymbal: new Set(), accent: new Set(), ghost: new Set() }; // "pad:tick"
    const solos = [];
    for (const e of events) {
      if (e.type === 'N') {
        const type = Number(e.args[0]);
        const length = clampLength(e.args[1]);
        if (!Number.isInteger(type)) continue;
        if (!drums) {
          if (type >= 0 && type <= 4) notes.push({ tick: e.tick, length, pitch: base + type });
          else if (type === 7) { notes.push({ tick: e.tick, length, pitch: base - 1 }); usesOpen = true; }
          else if (type === 5) forcedTicks.add(e.tick);
          else if (type === 6) tapTicks.add(e.tick);
        } else if (type >= 0 && type <= 5) {
          notes.push({ tick: e.tick, length: 0, pitch: base + type, pad: type });
          if (type === 5) track.fiveLane = true;
        } else if (type === 32) { // NOTE_OFFSET_INSTRUMENT_PLUS: double kick
          notes.push({ tick: e.tick, length: 0, pitch: base - 1, pad: 0 });
        } else if (type >= 66 && type <= 68) flagOf.cymbal.add(`${type - 64}:${e.tick}`); // NOTE_OFFSET_PRO_DRUMS + pad
        else if (type >= 34 && type <= 38) flagOf.accent.add(`${type - 33}:${e.tick}`); // NOTE_OFFSET_DRUMS_ACCENT + pad
        else if (type >= 40 && type <= 44) flagOf.ghost.add(`${type - 39}:${e.tick}`); // NOTE_OFFSET_DRUMS_GHOST + pad
      } else if (e.type === 'S') {
        const type = Number(e.args[0]);
        const length = clampLength(e.args[1]);
        if (type === 2) addPhrase(STAR_POWER_NOTE, e.tick, length, diff);
        else if (drums && DRUM_PHRASES[type] !== undefined) addPhrase(DRUM_PHRASES[type], e.tick, length, diff);
      } else if (e.type === 'E') { // ConvertSoloEvents: solo ... soloend pairs (a stack)
        const text = eventText(e.body);
        if (text === 'solo') solos.push(e.tick);
        else if (text === 'soloend' && solos.length) {
          const start = solos.pop();
          addPhrase(SOLO_NOTE, start, e.tick - start, diff);
        }
      }
    }
    for (const n of notes) {
      const note = { tick: n.tick, endTick: n.tick + n.length, pitch: n.pitch, velocity: VELOCITY_NORMAL, channel: 0 };
      if (drums) {
        // NoteFlagPriority: an accent blocks a ghost on the same pad.
        if (n.pad >= 1 && flagOf.accent.has(`${n.pad}:${n.tick}`)) note.velocity = VELOCITY_ACCENT;
        else if (n.pad >= 1 && flagOf.ghost.has(`${n.pad}:${n.tick}`)) note.velocity = VELOCITY_GHOST;
        // .chart pads are toms unless flagged; the .mid convention is the opposite (cymbal unless a tom marker covers
        // the note), so a tom marker is written for every unflagged yellow/blue/orange-green pad. Only when the chart
        // has cymbal flags at all: otherwise it is plain 4-lane (DisambiguateDrumsType). Markers are tagged with their
        // difficulty and written once per tick, since two covering markers would cancel out (XOR).
        if (hasCymbalFlags && TOM_MARKERS[n.pad] !== undefined && !flagOf.cymbal.has(`${n.pad}:${n.tick}`)) {
          addPhrase(TOM_MARKERS[n.pad], n.tick, 1, diff);
        }
      } else {
        // Tap beats forced (NoteFlagPriority: Forced is blocked by Tap). Both flag every note of the chord.
        if (tapTicks.has(n.tick)) note.tap = true;
        else if (forcedTicks.has(n.tick)) note.forced = true;
      }
      track.notes.push(note);
    }
  }
  if (usesOpen) track.texts.push({ tick: 0, text: '[ENHANCED_OPENS]' }); // makes buildChart read base - 1 as open
  track.notes.sort((a, b) => a.tick - b.tick);
  return track;
}

// [Events]: sections and global texts for the EVENTS track, lyrics for PART VOCALS (TextEvents.ConvertToPhrases with the
// "lyric " prefix, phrase_start / phrase_end). A lyric becomes a talkie note up to the next lyric (at most a beat).
function buildEvents(lines, resolution) {
  const events = { name: 'EVENTS', notes: [], texts: [], lyrics: [], sysex: [], tempos: [], timeSignatures: [] };
  const lyrics = [];
  const phrases = [];
  let phraseStart = null;
  for (const e of sortedEvents(lines)) {
    if (e.type[0] !== 'E') continue;
    const text = eventText(e.body);
    if (text.startsWith('lyric ') || text === 'lyric') lyrics.push({ tick: e.tick, text: text.slice(6) });
    else if (text === 'phrase_start') phraseStart = e.tick;
    else if (text === 'phrase_end') {
      if (phraseStart !== null) phrases.push({ tick: phraseStart, endTick: e.tick });
      phraseStart = null;
    } else events.texts.push({ tick: e.tick, text });
  }
  let vocals = null;
  if (lyrics.length) {
    vocals = { name: 'PART VOCALS', notes: [], texts: [], lyrics: [], sysex: [], tempos: [], timeSignatures: [] };
    lyrics.forEach((l, i) => {
      const next = lyrics[i + 1] ? lyrics[i + 1].tick : Infinity;
      const phraseEnd = phrases.find((p) => l.tick >= p.tick && l.tick < p.endTick)?.endTick ?? Infinity;
      const end = Math.max(l.tick + 1, Math.min(next, phraseEnd, l.tick + resolution * MAX_LYRIC_TICKS_FACTOR));
      vocals.lyrics.push({ tick: l.tick, text: `${l.text}#` }); // '#': non-pitched, shown as a talkie
      vocals.notes.push({ tick: l.tick, endTick: end, pitch: VOCAL_NOTE, velocity: VELOCITY_NORMAL, channel: 0 });
    });
    for (const p of phrases) vocals.notes.push({ tick: p.tick, endTick: p.endTick, pitch: PHRASE_NOTE, velocity: VELOCITY_NORMAL, channel: 0 });
    vocals.notes.sort((a, b) => a.tick - b.tick);
  }
  return { events, vocals };
}

export function parseChartText(text, { maxBytes = MAX_CHART_BYTES, maxEvents = MAX_CHART_EVENTS } = {}) {
  if (text.length > maxBytes) throw new Error(`Invalid .chart: file too large (${text.length} characters)`);
  const sections = readSections(text, maxEvents);
  const song = sections.find((s) => s.name === 'Song');
  const sync = sections.find((s) => s.name === 'SyncTrack');
  if (!song) throw new Error('Required section [Song] is missing');
  if (!sync) throw new Error('Required section [SyncTrack] is missing');
  const resolution = parseSong(song.lines);
  const { tempos, timeSignatures } = parseSync(sync.lines);

  const byInstrument = new Map();
  let eventLines = [];
  for (const s of sections) {
    if (s.name === 'Events') { eventLines = eventLines.concat(s.lines); continue; }
    const m = /^(Easy|Medium|Hard|Expert)(.+)$/.exec(s.name);
    if (!m || !INSTRUMENT_TRACKS[m[2]]) continue; // GHL and co-op tracks are not played
    if (!byInstrument.has(m[2])) byInstrument.set(m[2], []);
    byInstrument.get(m[2]).push({ difficulty: m[1], base: DIFFICULTY_BASE[m[1]], events: sortedEvents(s.lines) });
  }

  const tracks = [];
  const { events, vocals } = buildEvents(eventLines, resolution);
  tracks.push(events);
  for (const [key, secs] of byInstrument) tracks.push(buildInstrument(INSTRUMENT_TRACKS[key], secs));
  if (vocals) tracks.push(vocals);

  const sortedTempos = tempos.length ? tempos : [{ tick: 0, usPerQuarter: 500000 }];
  return {
    format: 1, division: resolution, tracks, tempos: sortedTempos, timeSignatures,
    toSeconds: createTickToSeconds(sortedTempos, resolution),
    source: 'chart', // buildChart: .chart defaults for HOPO threshold, sustain cutoff and star power (chartSettings)
  };
}
