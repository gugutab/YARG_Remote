// Builds a playable chart (notes on a timeline in seconds) for one instrument + difficulty
// from a parsed MIDI. Note numbers follow the Rock Band / YARG convention:
//   Easy 60-64, Medium 72-76, Hard 84-88, Expert 96-100 (offset 0..4 = lane 0..4)
//   103 = solo, 116 = star power, 12/13 = measure/beat lines in the BEAT track.
// Reference: YARG.Core MidIOHelper.cs and MidiInstrumentPreparser.cs.

export const INSTRUMENTS = [
  { id: 'guitar', label: 'Guitarra', tracks: ['PART GUITAR'], mode: 'lanes' },
  { id: 'bass', label: 'Baixo', tracks: ['PART BASS'], mode: 'lanes' },
  { id: 'rhythm', label: 'Rhythm', tracks: ['PART RHYTHM'], mode: 'lanes' },
  { id: 'keys', label: 'Teclado', tracks: ['PART KEYS'], mode: 'lanes' },
  { id: 'drums', label: 'Bateria', tracks: ['PART DRUMS', 'PART DRUM'], mode: 'drums' },
  { id: 'vocals', label: 'Vocal', tracks: ['PART VOCALS'], mode: 'vocals' },
  // Harmonies are their own part in YARG (HARM1 is the lead; HARM2/HARM3 sit behind it). Vocals have no difficulty.
  { id: 'harmony', label: 'Harmonia', tracks: ['HARM1', 'PART HARM1'], mode: 'vocals', harmony: true },
];

export const DIFFICULTIES = [
  { id: 'easy', label: 'Fácil', base: 60 },
  { id: 'medium', label: 'Médio', base: 72 },
  { id: 'hard', label: 'Difícil', base: 84 },
  { id: 'expert', label: 'Especialista', base: 96 },
];

const LANES = 5;
const SOLO_NOTE = 103;
// Drums (YARG.Core MidiDrumsPreparser.cs / MidIOHelper.cs PAD_TO_CYMBAL_LOOKUP):
//   offset 0..4 = kick, red, yellow, blue, green (4-lane) or orange (5-lane)
//   offset 5 = green in 5-lane; its presence (pitch 101) means 5-lane drums
//   pitches 110/111/112 are tom markers for yellow/blue/orange-or-green (offsets 2/3/4), pro and 5-lane;
//   those pads are cymbals unless a marker covers them
const FIVE_LANE_GREEN_NOTE = 101;
const CYMBAL_FLAG_FOR_OFFSET = { 2: 110, 3: 111, 4: 112 };
const DRUM_CYMBAL_FLAGS = [110, 111, 112];
const DRUM_LANE_COLORS_4 = ['#e5392b', '#f5c518', '#2f80ed', '#3fbf3f']; // red, yellow, blue, green
const DRUM_LANE_COLORS_5 = ['#e5392b', '#f5c518', '#2f80ed', '#f2861e', '#3fbf3f']; // + orange
const GUITAR_LANE_COLORS = ['#79d304', '#ff1d23', '#ffe900', '#00bfff', '#ff8400']; // YARG.Core ColorProfile.Defaults.cs
const STAR_POWER_NOTE = 116;
const MEASURE_NOTE = 12;
const BEAT_NOTE = 13;
const TAP_NOTE = 104;
const VELOCITY_ACCENT = 127; // drum pads: accent (bigger) and ghost (dim), as YARG.Core MidIOHelper.cs
const VELOCITY_GHOST = 1;
const VOCAL_RANGE = [36, 84];
const PERCUSSION_NOTE = 96;
const NONPLAYED_PERCUSSION_NOTE = 97;
const PHRASE_OPEN = 0x01; // PhaseShift SysEx phrase codes (YARG.Core PhaseShiftSysEx.cs)

// [start, end) tick windows for one phrase code, per difficulty index 0..3.
// SysEx layout: "PS\0", type, difficulty (0..3, 0xFF = all), code, value (1 start, 0 end), F7.
export function phraseWindows(track, code) {
  const windows = [[], [], [], []];
  const starts = [undefined, undefined, undefined, undefined];
  const events = track.sysex
    .filter((e) => e.data[0] === 0x50 && e.data[1] === 0x53 && e.data[2] === 0 && e.data[5] === code)
    .sort((a, b) => a.tick - b.tick);
  for (const e of events) {
    const diffs = e.data[4] === 0xff ? [0, 1, 2, 3] : [e.data[4]];
    for (const d of diffs) {
      if (e.data[6] === 1) {
        starts[d] = e.tick;
      } else if (starts[d] !== undefined) {
        windows[d].push([starts[d], e.tick]);
        starts[d] = undefined;
      }
    }
  }
  return windows;
}

// Harmony vocal tracks: HARM1..HARM3 or PART HARM1..HARM3.
function harmonyTracks(midi) {
  return midi.tracks
    .map((t) => ({ track: t, match: /^(?:PART )?HARM([1-3])$/i.exec(t.name) }))
    .filter((h) => h.match)
    .map((h) => ({ part: Number(h.match[1]), track: h.track }));
}
// YARG.Core MidReader.cs: notes shorter than resolution / 3 ticks have no sustain (SustainCutoffThreshold).

export function findTrack(midi, instrument) {
  return midi.tracks.find((t) => instrument.tracks.includes(t.name.toUpperCase())) || null;
}

// The drum modes a track can be played in. A chart with cymbal flags can be played as Pro or
// as 4-lane (flags ignored, every yellow/blue/green is a tom), the same choice YARG offers.
export function drumModes(track) {
  switch (drumKind(track)) {
    case 'five': return [{ mode: 'five', label: 'Bateria (5-lanes)' }];
    case 'pro': return [{ mode: 'pro', label: 'Bateria (Pro)' }, { mode: 'four', label: 'Bateria (4-lanes)' }];
    default: return [{ mode: 'four', label: 'Bateria (4-lanes)' }];
  }
}

// Playable instrument options for a song, in INSTRUMENTS order. Drums expand into one option per mode.
export function instrumentOptions(midi) {
  const options = [];
  for (const ins of INSTRUMENTS) {
    const track = findTrack(midi, ins);
    if (!track || !availableDifficulties(midi, ins).length) continue;
    if (ins.mode !== 'drums') {
      options.push({ ...ins, base: ins.id });
      continue;
    }
    for (const m of drumModes(track)) {
      options.push({ ...ins, id: `drums-${m.mode}`, label: m.label, base: 'drums', drumMode: m.mode });
    }
  }
  return options;
}

// Difficulties that actually have notes for this instrument.
export function availableDifficulties(midi, instrument) {
  const track = findTrack(midi, instrument);
  if (!track) return [];
  if (instrument.mode === 'vocals') {
    return track.notes.some((n) => inRange(n.pitch, VOCAL_RANGE)) ? [DIFFICULTIES[3]] : [];
  }
  const span = drumSpan(track, instrument);
  return DIFFICULTIES.filter((d) =>
    track.notes.some((n) => n.pitch >= d.base && n.pitch < d.base + span));
}

// Number of pitch offsets a difficulty uses: 5 for guitar, 6 for 5-lane drums (offset 5 = green).
function drumSpan(track, instrument) {
  if (instrument.mode !== 'drums') return LANES;
  return drumKind(track) === 'five' ? 6 : LANES;
}

// Same rule as YARG.Core: 101 => five lane; any 110-112 pro flag => pro; otherwise four lane.
export function drumKind(track) {
  if (track.notes.some((n) => n.pitch === FIVE_LANE_GREEN_NOTE)) return 'five';
  if (track.notes.some((n) => DRUM_CYMBAL_FLAGS.includes(n.pitch))) return 'pro';
  return 'four';
}

export function buildChart(midi, instrument, difficulty) {
  const track = findTrack(midi, instrument);
  if (!track) return null;
  const toSec = midi.toSeconds;
  const sustainCutoff = Math.floor(midi.division / 3);
  const timed = (n) => {
    const time = toSec(n.tick);
    const end = toSec(n.endTick);
    const long = n.endTick - n.tick >= sustainCutoff;
    return { time, end, length: long ? end - time : 0 };
  };

  if (instrument.mode === 'vocals') {
    const vocalNotes = (vocalTrack) => vocalTrack.notes
      .filter((n) => inRange(n.pitch, VOCAL_RANGE))
      .map((n) => ({ ...timed(n), pitch: n.pitch }));
    // Solo vocals use PART VOCALS alone; the harmony part leads with HARM1 and adds HARM2/HARM3 behind it.
    const notes = vocalNotes(track);
    const soloTrack = midi.tracks.find((t) => t.name.toUpperCase() === 'PART VOCALS');
    // Percussion (YARG.Core VocalsTrack): 96 is played, 97 is not played.
    const percussionTrack = track.notes.some((n) => n.pitch === PERCUSSION_NOTE || n.pitch === NONPLAYED_PERCUSSION_NOTE) || !soloTrack ? track : soloTrack;
    const percussion = percussionTrack.notes
      .filter((n) => n.pitch === PERCUSSION_NOTE || n.pitch === NONPLAYED_PERCUSSION_NOTE)
      .map((n) => ({ time: toSec(n.tick), played: n.pitch === PERCUSSION_NOTE }));
    // Lyrics are meta type 5 events when present (most charts). Some charts put them in text events
    // instead, where bracketed texts are sections or states, not lyrics.
    const lyricSource = (t) => (t.lyrics.length > 0 ? t.lyrics : t.texts.filter((x) => !x.text.startsWith('[')));
    let lyricEvents = lyricSource(track);
    if (lyricEvents.length === 0 && soloTrack && soloTrack !== track) lyricEvents = lyricSource(soloTrack); // harmony charts keep lyrics on PART VOCALS
    // Symbols that only mark timing or scoring are not shown (YARG.Core LyricSymbols.cs). Events left
    // empty by that (a lone '+', say) are dropped.
    const lyrics = lyricEvents
      .map((t) => ({ time: toSec(t.tick), text: displayLyric(t.text) }))
      .filter((l) => l.text !== '');
    // Harmony parts HARM1..HARM3 (or PART HARM1..3), drawn beside the lead.
    const harmonies = instrument.harmony
      ? harmonyTracks(midi).filter((h) => h.part > 1).map((h) => ({ part: h.part, notes: vocalNotes(h.track) }))
      : [];
    return { mode: 'vocals', notes, harmonies, percussion, lyrics, ...commonParts(midi, track, toSec) };
  }

  if (instrument.mode === 'drums') {
    return buildDrumChart(midi, track, instrument.drumMode ?? drumKind(track), difficulty, timed, toSec);
  }

  // Tap: note 104 marks a window [start, end) in which every note of the guitar is a tap (MidReader.cs).
  const tapWindows = windowsOf(track.notes.filter((n) => n.pitch === TAP_NOTE));
  // Forced HOPO (offset +5) and forced strum (offset +6) windows for this difficulty.
  const hopoWindows = windowsOf(track.notes.filter((n) => n.pitch === difficulty.base + 5));
  const strumWindows = windowsOf(track.notes.filter((n) => n.pitch === difficulty.base + 6));
  const fretNotes = track.notes.filter((n) => n.pitch - difficulty.base >= 0 && n.pitch - difficulty.base < LANES);
  const natural = naturalHopo(fretNotes, midi.division);
  // Open notes: SysEx phrase 1 marks a window in which the notes are open (YARG.Core
  // ProcessSysExEventPairAsOpenNoteModifier). Open notes are drawn as a bar across the lanes.
  const openWindowsHere = phraseWindows(track, PHRASE_OPEN)[DIFFICULTIES.indexOf(difficulty)];
  const notes = [];
  for (const n of track.notes) {
    const lane = n.pitch - difficulty.base;
    if (lane < 0 || lane >= LANES) continue;
    const open = inWindows(openWindowsHere, n.tick);
    const tap = inWindows(tapWindows, n.tick);
    // A forced strum wins over a forced HOPO; without either, the note is a HOPO only if it is natural.
    const hopo = !tap && (inWindows(strumWindows, n.tick) ? false
      : inWindows(hopoWindows, n.tick) ? true : natural.get(n));
    notes.push({ ...timed(n), lane, cymbal: false, tap, hopo: Boolean(hopo), open });
  }
  return { mode: 'lanes', lanes: LANES, laneColors: GUITAR_LANE_COLORS, notes, ...commonParts(midi, track, toSec) };
}

// Columns are the pads only: 4 (red, yellow, blue, green) or 5 (5-lane adds orange before green).
// The kick is not a column; it is a bar across all columns, so its lane is -1.
// [start, end) tick windows of marker notes (note-on to note-off), as YARG applies them.
function windowsOf(markers) {
  return markers.map((n) => [n.tick, n.endTick]);
}

function inWindows(windows, tick) {
  return windows.some(([start, end]) => tick >= start && tick < end);
}

// Natural HOPO per note, as YARG.Core MoonNote.IsNaturalHopo: not a chord, has a previous note
// (a different fret, or any chord before it), and comes within resolution / 3 + 1 ticks of it.
// fretNotes must be sorted by tick.
export function naturalHopo(fretNotes, division) {
  const threshold = Math.floor(division / 3) + 1;
  const groups = [];
  for (const n of fretNotes) {
    const last = groups[groups.length - 1];
    if (last && last.tick === n.tick) last.notes.push(n);
    else groups.push({ tick: n.tick, notes: [n] });
  }
  const result = new Map();
  groups.forEach((group, i) => {
    const prev = groups[i - 1];
    for (const n of group.notes) {
      const isChord = group.notes.length > 1;
      const natural = !isChord && prev !== undefined
        && (prev.notes.length > 1 || prev.notes[0].pitch !== n.pitch)
        && n.tick - prev.tick <= threshold;
      result.set(n, natural);
    }
  });
  return result;
}

// Drum rolls (MidIOHelper.cs): 125 kick roll, 126 tremolo lane, 127 trill lane, as tick-to-second spans.
const ROLL_TYPES = { 125: 'kick', 126: 'tremolo', 127: 'trill' };
function rollSpans(track, toSec) {
  return track.notes
    .filter((n) => n.pitch in ROLL_TYPES)
    .map((n) => ({ start: toSec(n.tick), end: toSec(n.endTick), type: ROLL_TYPES[n.pitch] }));
}

function buildDrumChart(midi, track, kind, difficulty, timed, toSec) {
  const lanes = kind === 'five' ? 5 : 4;
  const laneColors = kind === 'five' ? DRUM_LANE_COLORS_5 : DRUM_LANE_COLORS_4;
  // Cymbal flags apply to Pro and 5-lane modes; 4-lane mode plays the same notes with no cymbals.
  const cymbalSpans = kind === 'four' ? null : cymbalFlagSpans(track);

  // The kick is the difficulty's base note; the note one below (95 in Expert) is a kick too, with the
  // double kick flag (YARG.Core MidReader.ProcessLists.cs: key - 1 gets InstrumentPlus). Kicks share a tick.
  const kicks = new Map();
  const pads = [];
  for (const n of track.notes) {
    const offset = n.pitch - difficulty.base; // 0 kick, 1 red, 2 yellow, 3 blue, 4 orange/green, 5 green
    if (offset === 0 || offset === -1) {
      const double = offset === -1;
      const prev = kicks.get(n.tick);
      kicks.set(n.tick, {
        ...timed(n), length: 0, lane: -1, cymbal: false, accent: false, ghost: false,
        doubleKick: double || (prev ? prev.doubleKick : false),
      });
      continue;
    }
    if (offset < 0 || offset > lanes) continue;
    const cymbal = cymbalSpans !== null && isCymbal(cymbalSpans, offset, n.tick);
    // Velocity marks dynamics on pads, not the kick (YARG.Core MidReader.ProcessLists.cs, VELOCITY_*).
    pads.push({
      ...timed(n), length: 0, lane: offset - 1, cymbal,
      accent: n.velocity === VELOCITY_ACCENT, ghost: n.velocity === VELOCITY_GHOST, doubleKick: false,
    });
  }
  const notes = [...kicks.values(), ...pads].sort((a, b) => a.time - b.time);
  return { mode: 'lanes', lanes, laneColors, drumKind: kind, notes, rolls: rollSpans(track, toSec), ...commonParts(midi, track, toSec) };
}

// Tick ranges during which each cymbal flag (110/111/112) is on.
function cymbalFlagSpans(track) {
  const spans = new Map(DRUM_CYMBAL_FLAGS.map((p) => [p, []]));
  for (const n of track.notes) {
    if (spans.has(n.pitch)) spans.get(n.pitch).push({ start: n.tick, end: n.endTick });
  }
  return spans;
}

// In Pro drums yellow, blue and orange/green are cymbals by default (YARG.Core MidReader.ProcessLists.cs,
// DrumPadDefaultFlags). A 110/111/112 note is a tom marker: over its window [start, end) it toggles the
// cymbal flag with XOR (note.flags ^= flags). So a note is a cymbal unless an odd number of markers cover it.
function isCymbal(spans, offset, tick) {
  const flag = CYMBAL_FLAG_FOR_OFFSET[offset];
  if (flag === undefined) return false;
  const markers = (spans.get(flag) || []).filter((s) => tick >= s.start && tick < s.end).length;
  return markers % 2 === 0;
}

// Text shown for a lyric syllable: markers are removed, '=' is a hyphen and '§' joins two syllables.
const LYRIC_MARKERS = /[+#^*%/\$]/g;
export function displayLyric(text) {
  return text.replace(LYRIC_MARKERS, '').replace(/=/g, '-').replace(/§/g, '‿').trim();
}

function commonParts(midi, track, toSec) {
  const spans = (pitch) => spansOf(track.notes.filter((n) => n.pitch === pitch), toSec);
  const beatTrack = midi.tracks.find((t) => t.name.toUpperCase() === 'BEAT');
  const beats = beatTrack
    ? beatTrack.notes
      .filter((n) => n.pitch === MEASURE_NOTE || n.pitch === BEAT_NOTE)
      .map((n) => ({ time: toSec(n.tick), measure: n.pitch === MEASURE_NOTE }))
    : [];
  const eventsTrack = midi.tracks.find((t) => t.name.toUpperCase() === 'EVENTS');
  const sections = eventsTrack
    ? eventsTrack.texts
      .map((t) => ({ time: toSec(t.tick), name: parseSectionName(t.text) }))
      .filter((s) => s.name !== null)
      .sort((a, b) => a.time - b.time)
    : [];
  const duration = Math.max(0, ...track.notes.map((n) => toSec(n.endTick)));
  return {
    solos: spans(SOLO_NOTE),
    starPower: spans(STAR_POWER_NOTE),
    beats,
    sections,
    duration,
  };
}

// Section names come from text events in the EVENTS track, as YARG.Core reads them (TextEvents.cs):
// the text is optionally wrapped in [brackets], then a "section" or "prc" prefix, then the name with
// leading underscores and spaces removed. Anything else is not a section and returns null.
export function parseSectionName(raw) {
  let text = raw.trim();
  const open = text.indexOf('[');
  const close = text.indexOf(']');
  if (open >= 0 && close > open) text = text.slice(open + 1, close).trim();
  let rest;
  if (text.startsWith('section')) rest = text.slice('section'.length);
  else if (text.startsWith('prc')) rest = text.slice('prc'.length);
  else return null;
  const name = rest.replace(/^_+/, '').trim();
  return name || null;
}

// Index of the section playing at chart time t: the last section that has started, or the first one
// before any section starts (YARG's FindSectionAtTime does the same). -1 when there are no sections.
export function sectionIndexAt(sections, t) {
  if (sections.length === 0) return -1;
  let index = 0;
  for (let i = 0; i < sections.length && sections[i].time <= t; i++) index = i;
  return index;
}

function spansOf(notes, toSec) {
  return notes.map((n) => ({ start: toSec(n.tick), end: toSec(n.endTick) }));
}

function inRange(pitch, [lo, hi]) {
  return pitch >= lo && pitch <= hi;
}
