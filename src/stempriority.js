// Which stems the Listen card decodes first. The sound can start once the first group is ready; the rest is added while it plays.
//   first: the backing track ("song", anything that is not an instrument) and the stems whose instrument plays notes near the start position
//   (5 s before to 30 s after); rest: the other instruments. The crowd is never loaded (dropStems removes it).
// Pure (no DOM), tested without a browser.

export const LEAD_SEC = 5;
export const LOOKAHEAD_SEC = 30;

const TRACKS = {
  guitar: ['PART GUITAR'],
  bass: ['PART BASS'],
  rhythm: ['PART RHYTHM'],
  keys: ['PART KEYS'],
  drums: ['PART DRUMS', 'PART DRUM'],
  vocals: ['PART VOCALS', 'PART HARM1', 'PART HARM2', 'PART HARM3', 'HARM1', 'HARM2', 'HARM3'],
};
// Notes that are playable notes (not markers or animation): the five-lane / drum range, and the vocal range.
const NOTE_RANGE = { vocals: [36, 84] };
const DEFAULT_RANGE = [60, 100];

// 'drums_1' -> 'drums'; 'Guitar' -> 'guitar'
export const stemKind = (label) => String(label ?? '').toLowerCase().replace(/_\d+$/, '');

// The stems to load: the crowd is dropped (unless it is all there is).
export function dropStems(stems) {
  const kept = stems.filter((s) => stemKind(s.label) !== 'crowd');
  return kept.length ? kept : stems;
}

// Is a note of this instrument played in [from, to] (seconds)?
export function playsBetween(midi, kind, from, to) {
  const names = TRACKS[kind];
  if (!names || !midi?.tracks) return false;
  const [lo, hi] = NOTE_RANGE[kind] || DEFAULT_RANGE;
  for (const track of midi.tracks) {
    if (!names.includes(String(track.name).toUpperCase())) continue;
    for (const n of track.notes) {
      if (n.pitch < lo || n.pitch > hi) continue;
      const t = midi.toSeconds(n.tick);
      if (t > to) break; // (notes are sorted by tick)
      if (midi.toSeconds(n.endTick) >= from) return true;
    }
  }
  return false;
}

// -> { first: [ids], rest: [ids] }; `first` is empty when everything would be first (no point in splitting).
export function stemPriority(stems, midi, at = 0) {
  const from = at - LEAD_SEC;
  const to = at + LOOKAHEAD_SEC;
  const first = [];
  const rest = [];
  for (const s of stems) {
    const kind = stemKind(s.label);
    if (!TRACKS[kind] || playsBetween(midi, kind, from, to)) first.push(s.id);
    else rest.push(s.id);
  }
  if (!rest.length || !first.length) return { first: [], rest: [] };
  return { first, rest };
}
