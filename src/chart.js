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
  { id: 'drums', label: 'Bateria', tracks: ['PART DRUMS', 'PART DRUM'], mode: 'lanes' },
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
const STAR_POWER_NOTE = 116;
const MEASURE_NOTE = 12;
const BEAT_NOTE = 13;
const VOCAL_RANGE = [36, 84];
const MIN_SUSTAIN_SEC = 0.12; // shorter notes are taps, not sustains

export function findTrack(midi, instrument) {
  return midi.tracks.find((t) => instrument.tracks.includes(t.name.toUpperCase())) || null;
}

// Difficulties that actually have notes for this instrument.
export function availableDifficulties(midi, instrument) {
  const track = findTrack(midi, instrument);
  if (!track) return [];
  if (instrument.mode === 'vocals') {
    return track.notes.some((n) => inRange(n.pitch, VOCAL_RANGE)) ? [DIFFICULTIES[3]] : [];
  }
  return DIFFICULTIES.filter((d) =>
    track.notes.some((n) => n.pitch >= d.base && n.pitch < d.base + LANES));
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

  const notes = [];
  for (const n of track.notes) {
    const lane = n.pitch - difficulty.base;
    if (lane < 0 || lane >= LANES) continue;
    notes.push({ ...timed(n), lane });
  }
  return { mode: 'lanes', lanes: LANES, notes, ...commonParts(midi, track, toSec) };
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
