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
//   pitches 110/111/112 are cymbal flags for yellow/blue/orange-or-green (offsets 2/3/4), pro and 5-lane
const FIVE_LANE_GREEN_NOTE = 101;
const CYMBAL_FLAG_FOR_OFFSET = { 2: 110, 3: 111, 4: 112 };
const DRUM_CYMBAL_FLAGS = [110, 111, 112];
const DRUM_LANE_COLORS_4 = ['#b07cff', '#e5392b', '#f5c518', '#2f80ed', '#3fbf3f'];
const DRUM_LANE_COLORS_5 = ['#b07cff', '#e5392b', '#f5c518', '#2f80ed', '#f2861e', '#3fbf3f'];
const GUITAR_LANE_COLORS = ['#3fbf3f', '#e5392b', '#f5c518', '#2f80ed', '#f2861e'];
const STAR_POWER_NOTE = 116;
const MEASURE_NOTE = 12;
const BEAT_NOTE = 13;
const VOCAL_RANGE = [36, 84];
const MIN_SUSTAIN_SEC = 0.12; // shorter notes are taps, not sustains

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
  const timed = (n) => {
    const time = toSec(n.tick);
    const end = toSec(n.endTick);
    return { time, end, length: end - time >= MIN_SUSTAIN_SEC ? end - time : 0 };
  };

  if (instrument.mode === 'vocals') {
    const notes = track.notes
      .filter((n) => inRange(n.pitch, VOCAL_RANGE))
      .map((n) => ({ ...timed(n), pitch: n.pitch }));
    const lyrics = track.texts
      .filter((t) => !t.text.startsWith('['))
      .map((t) => ({ time: toSec(t.tick), text: t.text }));
    return { mode: 'vocals', notes, lyrics, ...commonParts(midi, track, toSec) };
  }

  if (instrument.mode === 'drums') {
    return buildDrumChart(midi, track, instrument.drumMode ?? drumKind(track), difficulty, timed, toSec);
  }

  const notes = [];
  for (const n of track.notes) {
    const lane = n.pitch - difficulty.base;
    if (lane < 0 || lane >= LANES) continue;
    notes.push({ ...timed(n), lane, cymbal: false });
  }
  return { mode: 'lanes', lanes: LANES, laneColors: GUITAR_LANE_COLORS, notes, ...commonParts(midi, track, toSec) };
}

function buildDrumChart(midi, track, kind, difficulty, timed, toSec) {
  const lanes = kind === 'five' ? 6 : LANES;
  const laneColors = kind === 'five' ? DRUM_LANE_COLORS_5 : DRUM_LANE_COLORS_4;
  // Cymbal flags apply to Pro and 5-lane modes; 4-lane mode plays the same notes with no cymbals.
  const cymbalSpans = kind === 'four' ? null : cymbalFlagSpans(track);

  const notes = [];
  for (const n of track.notes) {
    const offset = n.pitch - difficulty.base;
    if (offset < 0 || offset >= lanes) continue;
    const cymbal = cymbalSpans !== null && isCymbal(cymbalSpans, offset, n.tick);
    notes.push({ ...timed(n), lane: offset, cymbal });
  }
  return { mode: 'lanes', lanes, laneColors, drumKind: kind, kickLane: 0, notes, ...commonParts(midi, track, toSec) };
}

// Tick ranges during which each cymbal flag (110/111/112) is on.
function cymbalFlagSpans(track) {
  const spans = new Map(DRUM_CYMBAL_FLAGS.map((p) => [p, []]));
  for (const n of track.notes) {
    if (spans.has(n.pitch)) spans.get(n.pitch).push({ start: n.tick, end: n.endTick });
  }
  return spans;
}

function isCymbal(spans, offset, tick) {
  const flag = CYMBAL_FLAG_FOR_OFFSET[offset];
  if (flag === undefined) return false;
  return (spans.get(flag) || []).some((s) => tick >= s.start && tick <= s.end);
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
      .filter((t) => t.text.startsWith('[section '))
      .map((t) => ({ time: toSec(t.tick), name: t.text.slice(9, -1) }))
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

function spansOf(notes, toSec) {
  return notes.map((n) => ({ start: toSec(n.tick), end: toSec(n.endTick) }));
}

function inRange(pitch, [lo, hi]) {
  return pitch >= lo && pitch <= hi;
}
