// Builds a playable chart (notes on a timeline in seconds) for one instrument + difficulty
// from a parsed MIDI. Note numbers follow the Rock Band / YARG convention:
//   Easy 60-64, Medium 72-76, Hard 84-88, Expert 96-100 (offset 0..4 = lane 0..4)
//   103 = solo, 116 = star power, 12/13 = measure/beat lines in the BEAT track.
// Reference: YARG.Core MidIOHelper.cs and MidiInstrumentPreparser.cs.
// Several rules can be changed by song.ini keys (see chartSettings); every builder takes the parsed ini as an optional
// last argument and behaves as before when a key is absent.
import { iniBool } from './ini.js';
import { buildVocals, displayLyric } from './vocals.js';

export const INSTRUMENTS = [
  { id: 'guitar', label: 'Guitar', tracks: ['PART GUITAR'], mode: 'lanes' },
  { id: 'bass', label: 'Bass', tracks: ['PART BASS'], mode: 'lanes' },
  { id: 'rhythm', label: 'Rhythm', tracks: ['PART RHYTHM'], mode: 'lanes' },
  { id: 'keys', label: 'Keys', tracks: ['PART KEYS'], mode: 'lanes' },
  { id: 'drums', label: 'Drums', tracks: ['PART DRUMS', 'PART DRUM'], mode: 'drums' },
  { id: 'vocals', label: 'Vocals', tracks: ['PART VOCALS'], mode: 'vocals' },
  // Harmonies are their own part in YARG (HARM1 is the lead; HARM2/HARM3 sit behind it). Vocals have no difficulty.
  { id: 'harmony', label: 'Harmony', tracks: ['HARM1', 'PART HARM1'], mode: 'vocals', harmony: true },
];

export const DIFFICULTIES = [
  { id: 'easy', label: 'Easy', short: 'E', base: 60 },
  { id: 'medium', label: 'Medium', short: 'M', base: 72 },
  { id: 'hard', label: 'Hard', short: 'H', base: 84 },
  { id: 'expert', label: 'Expert', short: 'X', base: 96 },
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
const DRUM_LANE_COLORS_4 = ['#ff1d23', '#ffe900', '#00bfff', '#79d304']; // red, yellow, blue, green (YARG.Core ColorProfile.Defaults.cs)
const DRUM_LANE_COLORS_5 = ['#ff1d23', '#ffe900', '#00bfff', '#ff8400', '#79d304']; // + orange
// Extended Pro drums: every pad has its own lane, cymbals and toms no longer share one. Left to right.
// YARG builds this per player: "Split" turns each combined pad (yellow, blue, green) into a drum item and a cymbal
// item, inserted next to each other (Assets/Script/Menu/HighwayConfiguration, DrumsHighwaySpecs.cs); which side the
// cymbal goes on was not confirmed, so the cymbal follows its tom here. Colours: YARG.Core ColorProfile.Defaults.cs.
// `pad` is the pad's offset in Pro drums (1 red, 2 yellow, 3 blue, 4 green).
export const EXTENDED_DRUM_LANES = [
  { pad: 1, cymbal: false, color: '#ff1d23' }, // red (snare)
  { pad: 2, cymbal: false, color: '#ffe900' }, // yellow tom
  { pad: 2, cymbal: true, color: '#ffd010' }, // yellow cymbal (hi-hat)
  { pad: 3, cymbal: false, color: '#00bfff' }, // blue tom
  { pad: 3, cymbal: true, color: '#2090ff' }, // blue cymbal (ride)
  { pad: 4, cymbal: false, color: '#79d304' }, // green tom
  { pad: 4, cymbal: true, color: '#a0d010' }, // green cymbal (crash)
];
const GUITAR_LANE_COLORS = ['#79d304', '#ff1d23', '#ffe900', '#00bfff', '#ff8400']; // YARG.Core ColorProfile.Defaults.cs
const STAR_POWER_NOTE = 116;
const MEASURE_NOTE = 12;
const BEAT_NOTE = 13;
const TAP_NOTE = 104;
// Fills (YARG.Core MidIOHelper.cs): drums use 120-124 as activation phrases (DRUM_FILL_NOTE_0..4); guitar-like parts use
// 120 as a Big Rock Ending (BIG_ROCK_ENDING_NOTE_1), which only counts inside a coda.
const FILL_NOTES = [120, 121, 122, 123, 124];
const BRE_NOTE = 120;
const ENHANCED_OPENS_TEXT = 'ENHANCED_OPENS'; // MidIOHelper.ENHANCED_OPENS_TEXT
const VELOCITY_ACCENT = 127; // drum pads: accent (bigger) and ghost (dim), as YARG.Core MidIOHelper.cs
const VELOCITY_GHOST = 1;
const VOCAL_RANGE = [36, 84];
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
// Chart-building settings from the song.ini keys YARG reads when it scans a .mid song
// (YARG.Core Song/Entries/Ini/SongEntry.IniBase.cs, ScanChart; MidReader.cs applies them). `division` is the MIDI resolution.
//   hopoThreshold  max ticks between two notes for a natural HOPO, before the +1 of leniency MidReader adds:
//                  hopo_frequency (> 0), else eighthnote_hopo (res/2 when true, res/3 when false), else hopofreq
//                  (0..5 -> 4 * res / [24, 16, 12, 8, 6, 4]), else res / 3.
//   sustainCutoff  notes shorter than this many ticks have no sustain: sustain_cutoff_threshold (0 becomes 1,
//                  MidReader), else res / 3.
//   fiveLaneDrums  five_lane_drums: true forces 5-lane drums, false forbids them, undefined = guess from the notes.
//   starPowerNote  multiplier_note / star_power_note: only 103 is honoured (the legacy note, which then also stops
//                  being a solo); anything else is 116.
//   endEvents      end_events (Clone Hero: false ignores the [end] event). YARG.Core declares the key but never reads it.
const HOPOFREQ_DENOMINATORS = [24, 16, 12, 8, 6, 4];
// `format` is 'chart' for notes.chart songs (src/chartfile.js), which differ from .mid in three ways (YARG.Core
// SongEntry.IniBase.cs ScanChart + ParseSettings.Default_Chart): the HOPO threshold gets resolution / 192 extra ticks
// (65 at 192) instead of the +1 MidReader adds, a missing sustain_cutoff_threshold means no cutoff at all (0), and star
// power is always the phrase S 2 (no legacy note 103).
export function chartSettings(ini = {}, division = 480, format = 'mid') {
  const num = (v) => (v === undefined || v === '' ? NaN : Number(v));
  let hopoThreshold;
  const freq = num(ini.hopo_frequency);
  const eighth = iniBool(ini.eighthnote_hopo);
  const hopofreq = num(ini.hopofreq);
  if (Number.isFinite(freq) && freq > 0) hopoThreshold = Math.floor(freq);
  else if (eighth !== undefined) hopoThreshold = Math.floor(division / (eighth ? 2 : 3));
  else if (Number.isInteger(hopofreq) && hopofreq >= 0 && hopofreq < HOPOFREQ_DENOMINATORS.length) hopoThreshold = Math.floor(4 * division / HOPOFREQ_DENOMINATORS[hopofreq]);
  else hopoThreshold = Math.floor(division / 3);

  const isChart = format === 'chart';
  // naturalHopo adds 1 to the threshold (the .mid leniency), so a .chart takes it off again.
  if (isChart) hopoThreshold += Math.floor(division / 192) - 1;

  const cutoff = num(ini.sustain_cutoff_threshold);
  const sustainCutoff = Number.isFinite(cutoff) && cutoff >= 0
    ? (isChart ? Math.floor(cutoff) : Math.max(1, Math.floor(cutoff)))
    : (isChart ? 0 : Math.floor(division / 3));

  const note = isChart ? NaN : num(ini.multiplier_note ?? ini.star_power_note);
  return {
    hopoThreshold,
    sustainCutoff,
    fiveLaneDrums: iniBool(ini.five_lane_drums),
    starPowerNote: note === SOLO_NOTE ? SOLO_NOTE : STAR_POWER_NOTE,
    endEvents: iniBool(ini.end_events) !== false,
  };
}

export function findTrack(midi, instrument) {
  return midi.tracks.find((t) => instrument.tracks.includes(t.name.toUpperCase())) || null;
}

// The drum modes a track can be played in. A chart with cymbal flags can be played as Pro or
// as 4-lane (flags ignored, every yellow/blue/green is a tom), the same choice YARG offers.
export function drumModes(track, ini = {}) {
  const four = { mode: 'four', label: 'Drums (4 lanes)', short: '4 lanes' };
  switch (drumKind(track, ini)) {
    case 'five': return [{ mode: 'five', label: 'Drums (5 lanes)', short: '5 lanes' }];
    case 'pro': return [
      four,
      { mode: 'pro', label: 'Drums (Pro)', short: 'Pro' },
      { mode: 'extended', label: `Drums (Pro ${EXTENDED_DRUM_LANES.length} lanes)`, short: `Pro ${EXTENDED_DRUM_LANES.length} lanes` },
    ];
    default: return [four];
  }
}

// Playable instrument options for a song, in INSTRUMENTS order. Drums expand into one option per mode.
export function instrumentOptions(midi, ini = {}) {
  const options = [];
  for (const ins of INSTRUMENTS) {
    const track = findTrack(midi, ins);
    if (!track || !availableDifficulties(midi, ins, ini).length) continue;
    if (ins.mode !== 'drums') {
      options.push({ ...ins, base: ins.id });
      continue;
    }
    for (const m of drumModes(track, ini)) {
      options.push({ ...ins, id: `drums-${m.mode}`, label: m.label, modeLabel: m.short, base: 'drums', drumMode: m.mode });
    }
  }
  return options;
}

// Difficulties that actually have notes for this instrument.
export function availableDifficulties(midi, instrument, ini = {}) {
  const track = findTrack(midi, instrument);
  if (!track) return [];
  if (instrument.mode === 'vocals') {
    return track.notes.some((n) => inRange(n.pitch, VOCAL_RANGE)) ? [DIFFICULTIES[3]] : [];
  }
  const span = drumSpan(track, instrument, ini);
  return DIFFICULTIES.filter((d) =>
    track.notes.some((n) => n.pitch >= d.base && n.pitch < d.base + span));
}

// Number of pitch offsets a difficulty uses: 5 for guitar, 6 for 5-lane drums (offset 5 = green).
function drumSpan(track, instrument, ini) {
  if (instrument.mode !== 'drums') return LANES;
  return drumKind(track, ini) === 'five' ? 6 : LANES;
}

// Same rule as YARG.Core: 101 => five lane; any 110-112 pro flag => pro; otherwise four lane.
// song.ini five_lane_drums overrides the guess (SongEntry.IniBase.cs ScanChart + Midi_Drums_Preparser): true forces
// 5 lanes, false ignores note 101. pro_drums needs no handling: a .mid without it is Pro, and the preparser marks
// the part Pro whenever 110-112 exist, even with pro_drums = false, so the cymbal flags alone decide Pro here.
export function drumKind(track, ini = {}) {
  const five = iniBool(ini.five_lane_drums);
  if (five === true) return 'five';
  if (five === undefined && (track.fiveLane || track.notes.some((n) => n.pitch === FIVE_LANE_GREEN_NOTE))) return 'five'; // track.fiveLane: notes.chart with a green (N 5) pad
  if (track.notes.some((n) => DRUM_CYMBAL_FLAGS.includes(n.pitch))) return 'pro';
  return 'four';
}

export function buildChart(midi, instrument, difficulty, ini = {}) {
  const track = findTrack(midi, instrument);
  if (!track) return null;
  const toSec = midi.toSeconds;
  const settings = chartSettings(ini, midi.division, midi.source);
  const sustainCutoff = settings.sustainCutoff; // YARG.Core MidReader.cs: shorter notes have no sustain (SustainCutoffThreshold)
  const timed = (n) => {
    const time = toSec(n.tick);
    const end = toSec(n.endTick);
    const long = n.endTick - n.tick >= sustainCutoff;
    return { time, end, length: long ? end - time : 0 };
  };

  if (instrument.mode === 'vocals') {
    const harmonyParts = instrument.harmony ? harmonyTracks(midi) : [];
    const vocals = buildVocals({ midi, track, harmonyParts, toSec, timed });
    return { mode: 'vocals', ...vocals, ...commonParts(midi, track, toSec, settings, 'vocals') };
  }

  if (instrument.mode === 'drums') {
    return buildDrumChart(midi, track, instrument.drumMode ?? drumKind(track, ini), difficulty, timed, toSec, settings);
  }

  // Tap: note 104 marks a window [start, end) in which every note of the guitar is a tap (MidReader.cs).
  const tapWindows = windowsOf(track.notes.filter((n) => n.pitch === TAP_NOTE));
  // Forced HOPO (offset +5) and forced strum (offset +6) windows for this difficulty.
  const hopoWindows = windowsOf(track.notes.filter((n) => n.pitch === difficulty.base + 5));
  const strumWindows = windowsOf(track.notes.filter((n) => n.pitch === difficulty.base + 6));
  // Enhanced opens: from the [ENHANCED_OPENS] text on, the note one below the difficulty's green (59/71/83/95) is an
  // open note (YARG.Core MidReader.ProcessLists.cs SwitchToGuitarEnhancedOpensProcessMap + BuildGuitarNoteProcessDict:
  // FretToMidiKey[Open] = -1). It is drawn in lane 0 with the open flag, like SysEx opens.
  const enhancedFrom = enhancedOpensTick(track);
  const isEnhancedOpen = (n) => n.pitch === difficulty.base - 1 && n.tick >= enhancedFrom;
  const fretNotes = track.notes.filter((n) => isEnhancedOpen(n) || (n.pitch - difficulty.base >= 0 && n.pitch - difficulty.base < LANES));
  const natural = naturalHopo(fretNotes, midi.division, settings.hopoThreshold);
  // Open notes: SysEx phrase 1 marks a window in which the notes are open (YARG.Core
  // ProcessSysExEventPairAsOpenNoteModifier). Open notes are drawn as a bar across the lanes.
  const openWindowsHere = phraseWindows(track, PHRASE_OPEN)[DIFFICULTIES.indexOf(difficulty)];
  const notes = [];
  for (const n of track.notes) {
    const enhancedOpen = isEnhancedOpen(n);
    const lane = enhancedOpen ? 0 : n.pitch - difficulty.base;
    if (lane < 0 || lane >= LANES) continue;
    const open = enhancedOpen || inWindows(openWindowsHere, n.tick);
    // notes.chart notes carry their own flags (src/chartfile.js): tap (N 6) and forced (N 5), which flips the natural HOPO
    // (MoonNote.IsHopo: IsNaturalHopo != forced). Both are per difficulty, unlike the .mid windows.
    const tap = Boolean(n.tap) || inWindows(tapWindows, n.tick);
    // A forced strum wins over a forced HOPO; without either, the note is a HOPO only if it is natural.
    const hopo = !tap && (inWindows(strumWindows, n.tick) ? false
      : inWindows(hopoWindows, n.tick) ? true : natural.get(n) !== Boolean(n.forced));
    notes.push({ ...timed(n), lane, cymbal: false, tap, hopo: Boolean(hopo), open });
  }
  return { mode: 'lanes', lanes: LANES, laneColors: GUITAR_LANE_COLORS, notes, ...commonParts(midi, track, toSec, settings) };
}

// Tick of the first [ENHANCED_OPENS] / ENHANCED_OPENS text event in the track, or Infinity. YARG switches its process
// map when the event is reached, so only later notes are affected.
function enhancedOpensTick(track) {
  const e = track.texts.find((t) => normalizeEventText(t.text) === ENHANCED_OPENS_TEXT);
  return e ? e.tick : Infinity;
}

const extendedLane = (pad, cymbal) => EXTENDED_DRUM_LANES.findIndex((l) => l.pad === pad && l.cymbal === cymbal);

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
// (a different fret, or any chord before it), and comes within hopoThreshold + 1 ticks of it (MidReader.cs adds 1 for
// leniency). hopoThreshold defaults to resolution / 3; song.ini can change it (chartSettings). fretNotes must be sorted by tick.
export function naturalHopo(fretNotes, division, hopoThreshold = Math.floor(division / 3)) {
  const threshold = hopoThreshold + 1;
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

function buildDrumChart(midi, track, kind, difficulty, timed, toSec, settings) {
  const extended = kind === 'extended';
  const lanes = extended ? EXTENDED_DRUM_LANES.length : kind === 'five' ? 5 : 4;
  const laneColors = extended ? EXTENDED_DRUM_LANES.map((l) => l.color) : kind === 'five' ? DRUM_LANE_COLORS_5 : DRUM_LANE_COLORS_4;
  const padCount = extended ? 4 : lanes; // pads in the MIDI (offsets 1..padCount)
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
    if (offset < 0 || offset > padCount) continue;
    const cymbal = cymbalSpans !== null && isCymbal(cymbalSpans, offset, n.tick);
    // Velocity marks dynamics on pads, not the kick (YARG.Core MidReader.ProcessLists.cs, VELOCITY_*).
    pads.push({
      ...timed(n), length: 0, lane: extended ? extendedLane(offset, cymbal) : offset - 1, cymbal,
      accent: n.velocity === VELOCITY_ACCENT, ghost: n.velocity === VELOCITY_GHOST, doubleKick: false,
    });
  }
  const notes = [...kicks.values(), ...pads].sort((a, b) => a.time - b.time);
  return { mode: 'lanes', lanes, laneColors, laneKinds: extended ? EXTENDED_DRUM_LANES.map((l) => (l.cymbal ? 'cymbal' : 'tom')) : null, drumKind: kind, notes, rolls: rollSpans(track, toSec), ...commonParts(midi, track, toSec, settings, 'drums') };
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

export { displayLyric }; // lyric text as shown (vocals.js)

function commonParts(midi, track, toSec, settings = chartSettings({}, midi.division, midi.source), mode = 'guitar') {
  const spans = (pitch) => spansOf(track.notes.filter((n) => n.pitch === pitch), toSec);
  const beatTrack = midi.tracks.find((t) => t.name.toUpperCase() === 'BEAT');
  let beats = beatTrack
    ? beatTrack.notes
      .filter((n) => n.pitch === MEASURE_NOTE || n.pitch === BEAT_NOTE)
      .map((n) => ({ time: toSec(n.tick), measure: n.pitch === MEASURE_NOTE }))
    : [];
  // No BEAT track notes: build the grid from the tempo map and time signatures, as YARG does (SyncTrack.FinishLoading).
  if (beats.length === 0) beats = generateBeats(midi, toSec);
  const eventsTrack = midi.tracks.find((t) => t.name.toUpperCase() === 'EVENTS');
  const sections = eventsTrack
    ? eventsTrack.texts
      .map((t) => { const name = parseSectionName(t.text); return { time: toSec(t.tick), name: name === null ? null : displaySectionName(name) }; })
      .filter((s) => s.name !== null)
      .sort((a, b) => a.time - b.time)
    : [];
  if (sections.length === 0) sections.push(...autoSections(midi, toSec));
  // With the legacy star power note (103) YARG drops solos: the note cannot be both (MidReader.ProcessLists.cs, GetPhraseProcessDict).
  const legacyStarPower = settings.starPowerNote === SOLO_NOTE;
  const events = eventsTrack ? eventsTrack.texts.filter((t) => parseSectionName(t.text) === null) : []; // sections are not "global events" in YARG
  const { musicStart, musicEnd, end } = globalMarkers(events, toSec);
  const lastNote = Math.max(0, ...track.notes.map((n) => toSec(n.endTick)));
  return {
    solos: legacyStarPower ? [] : spans(SOLO_NOTE),
    starPower: spans(settings.starPowerNote),
    fills: mode === 'vocals' ? [] : fillSpans(track, eventsTrack, mode, toSec),
    beats,
    sections,
    // [music_start] / [music_end] in seconds, or null (see globalMarkers). Data only, nothing is drawn from them.
    musicStart,
    musicEnd,
    // The [end] event closes the chart when present (and end_events does not turn it off); else the last note's end.
    duration: end !== null && settings.endEvents ? end : lastNote,
  };
}

// Coda ranges in ticks from the EVENTS texts, as YARG.Core MidReader.GetCodaRanges: [midcoda] ... [midcoda_end] pairs
// and a final [coda] that runs to the end; unbalanced markers drop the ranges. `end` is Infinity while open.
export function codaRanges(eventsTrack) {
  const ranges = [];
  let midcodas = 0;
  for (const ev of eventsTrack ? eventsTrack.texts : []) {
    const text = normalizeEventText(ev.text);
    if (text === 'midcoda') {
      if (ranges.length > 0 && ranges[ranges.length - 1].end === Infinity) return [];
      midcodas++;
      ranges.push({ start: ev.tick, end: Infinity });
    } else if (text === 'midcoda_end') {
      if (midcodas !== ranges.length) return [];
      ranges[ranges.length - 1].end = ev.tick;
    } else if (text === 'coda') {
      if (ranges.length > 0 && ranges[ranges.length - 1].end === Infinity) ranges.length = 0;
      ranges.push({ start: ev.tick, end: Infinity });
      break; // YARG accepts no more codas after this one
    }
  }
  return ranges;
}

// Fill / Big Rock Ending spans in seconds: [{ start, end, kind: 'fill' | 'bre' }].
//   Drums: notes 120-124 are activation phrases (kind 'fill'). When the song has a coda, the ones that start inside a
//   coda become 'bre' (MidReader.ProcessLists.cs ReplaceDrumFillDuringCoda; YARG skips this when the chart already has
//   a BRE phrase, which cannot happen here because drums read 120 as a fill only).
//   Guitar, bass, rhythm, keys: note 120 is a BRE, kept only when it lies entirely inside a coda
//   (MoonSongLoader.Guitar.cs ValidateGuitarPhrase). Overlapping notes (120-124 are normally charted together) merge.
export function fillSpans(track, eventsTrack, mode, toSec) {
  const coda = codaRanges(eventsTrack);
  const phrases = [];
  if (mode === 'drums') {
    for (const n of track.notes) {
      if (!FILL_NOTES.includes(n.pitch)) continue;
      const bre = coda.some((r) => n.tick >= r.start && n.tick <= r.end);
      phrases.push({ start: n.tick, end: n.endTick, kind: bre ? 'bre' : 'fill' });
    }
  } else {
    for (const n of track.notes) {
      if (n.pitch === BRE_NOTE && coda.some((r) => n.tick >= r.start && n.endTick <= r.end)) {
        phrases.push({ start: n.tick, end: n.endTick, kind: 'bre' });
      }
    }
  }
  const merged = [];
  for (const p of phrases.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && last.kind === p.kind && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else merged.push({ ...p });
  }
  return merged.map((p) => ({ start: toSec(p.start), end: toSec(p.end), kind: p.kind }));
}

// Beat and measure lines from the tempo map and time signatures, as YARG.Core SyncTrack.GenerateBeatlines (default
// delegates): a line every `resolution * 4 / denominator` ticks, restarting at each time signature change; the first of
// every `numerator` lines is a measure line (with x/1 only the very first). The grid runs to the last note or text event
// of the file. Without a time signature the file is 4/4.
export function generateBeats(midi, toSec) {
  let lastTick = 0;
  for (const t of midi.tracks) {
    for (const n of t.notes) lastTick = Math.max(lastTick, n.endTick);
    for (const e of t.texts) lastTick = Math.max(lastTick, e.tick);
  }
  const sigs = [];
  for (const s of midi.timeSignatures || []) {
    if (sigs.length && sigs[sigs.length - 1].tick === s.tick) sigs[sigs.length - 1] = s; // a later event at the same tick wins
    else sigs.push(s);
  }
  if (sigs.length === 0 || sigs[0].tick > 0) sigs.unshift({ tick: 0, num: 4, den: 4 });
  const beats = [];
  sigs.forEach((sig, i) => {
    const end = i + 1 < sigs.length ? sigs[i + 1].tick - 1 : lastTick + 1;
    const step = Math.floor((midi.division * 4) / sig.den);
    if (step < 1) return;
    for (let tick = sig.tick, count = 0; tick <= end; tick += step, count++) {
      beats.push({ time: toSec(tick), measure: sig.num === 1 ? count === 0 : count % sig.num === 0 });
    }
  });
  return beats;
}

// Event text as YARG normalises it (TextEvents.NormalizeTextEvent): the part between the first '[' and ']' if there
// is one, else the whole text, trimmed.
export function normalizeEventText(raw) {
  const open = raw.indexOf('[');
  const close = raw.indexOf(']');
  return (open >= 0 && close >= 0 && open <= close ? raw.slice(open + 1, close) : raw).trim();
}

// The markers YARG looks for in the global (EVENTS) events, in seconds (SongChart.cs):
//   GetMusicEvents: "music_start" within the first 20 events and "music_end" within the last 20; if either is missing
//     both are null (a charting error). GetEndEvent: "end" within the last 10 events.
// `events` are { tick, text } in file order. Texts are matched exactly as TextEvents.MUSIC_START / MUSIC_END / END_MARKER.
function globalMarkers(events, toSec) {
  const norm = events.map((e) => ({ tick: e.tick, text: normalizeEventText(e.text) }));
  const secOf = (e) => (e ? toSec(e.tick) : null);
  const start = norm.slice(0, 20).find((e) => e.text === 'music_start');
  const musicEnd = start ? norm.slice(-20).reverse().find((e) => e.text === 'music_end') : undefined;
  const end = norm.slice(-10).reverse().find((e) => e.text === 'end');
  return { musicStart: musicEnd ? secOf(start) : null, musicEnd: secOf(musicEnd), end: secOf(end) };
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

// The name as YARG reads it (parseSectionName), made a little easier to read: underscores become spaces and every word starts
// with a capital (chorus_1 -> Chorus 1, gtr_solo_a -> Gtr Solo A). Nothing else is changed: no abbreviations are expanded.
export function displaySectionName(name) {
  return name.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().replace(/(^|\s)([a-z])/g, (m, space, ch) => space + ch.toUpperCase());
}

// A song with no sections gets ten automatic ones, "0% - 10%" ... "90% - 100%" of the song, so the section chip, the list and the
// jumps still work (YARG.Core Chart/SongChart.AutoGeneration.cs PostProcessSections). The song's last tick is the last note or
// lyric of any instrument (SongChart.GetLastTick); the EVENTS, BEAT, VENUE and animation tracks are not counted.
export function autoSections(midi, toSec) {
  let lastTick = 0;
  for (const track of midi.tracks) {
    const name = String(track.name || '').toUpperCase();
    if (name === 'EVENTS' || name === 'BEAT' || name === 'VENUE' || name.endsWith(' ANIM')) continue;
    for (const n of track.notes || []) lastTick = Math.max(lastTick, n.endTick ?? n.tick);
    for (const l of track.lyrics || []) lastTick = Math.max(lastTick, l.tick);
  }
  if (lastTick <= 0) return [];
  const out = [];
  let startTick = 0;
  for (let i = 0; i < 10; i++) {
    out.push({ time: toSec(startTick), name: `${i * 10}% - ${i + 1}0%` }); // (the name is `{i * 10}% - {i + 1}0%` in YARG)
    startTick = Math.floor(lastTick * ((i + 1) / 10));
  }
  return out;
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
