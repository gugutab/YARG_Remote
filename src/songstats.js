// Facts about one built chart for the end-of-song window. Pure; `chart` is what buildChart returns. One pass over the notes,
// memoized per chart object (a WeakMap), so asking again for the same chart is free.
//
// `notes` always means note events (the gems of the chart: a 3-fret chord is 3 notes), as `chart.notes.length`. Fret
// instruments also get `hits` (distinct moments with at least one note) split in `chords` and `singles`.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// MIDI note number -> "C4" (60 = C4).
export function noteName(pitch) {
  const p = Math.round(pitch);
  return `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
}

const cache = new WeakMap();

function lanesStats(chart) {
  const drums = chart.drumKind != null;
  const s = { kind: drums ? 'drums' : 'frets', notes: chart.notes.length };
  const times = new Map(); // time -> notes at that moment
  let sustains = 0, hopos = 0, taps = 0, opens = 0, kicks = 0, doubleKicks = 0, cymbals = 0, toms = 0, accents = 0, ghosts = 0;
  for (const n of chart.notes) {
    times.set(n.time, (times.get(n.time) || 0) + 1);
    if (n.length > 0) sustains++;
    if (n.hopo) hopos++;
    if (n.tap) taps++;
    if (n.open) opens++;
    if (n.accent) accents++;
    if (n.ghost) ghosts++;
    if (n.lane === -1) { kicks++; if (n.doubleKick) doubleKicks++; } else if (n.cymbal) cymbals++; else toms++;
  }
  if (drums) {
    Object.assign(s, { kicks, doubleKicks, cymbals, pads: toms, accents, ghosts, rolls: chart.rolls?.length ?? 0, fills: (chart.fills ?? []).filter((f) => f.kind !== 'bre').length });
  } else {
    let chords = 0;
    for (const count of times.values()) if (count > 1) chords++;
    Object.assign(s, { hits: times.size, chords, singles: times.size - chords, sustains, hopos, taps, opens });
  }
  s.starPower = chart.starPower?.length ?? 0;
  s.solos = chart.solos?.length ?? 0;
  return s;
}

function vocalStats(chart) {
  const pitched = [];
  const take = (notes) => { for (const n of notes) if (!n.talkie) pitched.push(n.pitch); };
  take(chart.notes);
  for (const h of chart.harmonies ?? []) take(h.notes);
  let talkies = chart.notes.filter((n) => n.talkie).length;
  for (const h of chart.harmonies ?? []) talkies += h.notes.filter((n) => n.talkie).length;
  const s = {
    kind: 'vocals',
    notes: chart.notes.length,
    syllables: chart.lyrics?.length ?? 0,
    phrases: chart.phrases?.length ?? 0,
    talkies,
    percussion: chart.percussion?.length ?? 0,
    harmonyParts: chart.harmonies?.length ? chart.harmonies.length + 1 : 0, // the lead plus the extra parts
    starPower: chart.starPower?.length ?? 0,
  };
  if (pitched.length) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pitched) { if (p < lo) lo = p; if (p > hi) hi = p; }
    Object.assign(s, { lowest: lo, highest: hi, range: hi - lo, rangeText: `${noteName(lo)} to ${noteName(hi)}` });
  }
  return s;
}

export function chartFacts(chart) {
  if (!chart) return null;
  let s = cache.get(chart);
  if (!s) {
    s = chart.mode === 'vocals' ? vocalStats(chart) : lanesStats(chart);
    cache.set(chart, s);
  }
  return s;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// -> [{ label, value }] rows to show on a card; zero-valued optional facts are left out.
export function factRows(facts, { base = '' } = {}) { // base: the instrument ('keys' has no HOPOs to show)
  if (!facts) return [];
  const rows = [];
  const add = (label, value, always = false) => { if (always || value) rows.push({ label, value: String(value) }); };
  add('Notes', facts.notes, true);
  switch (facts.kind) {
    case 'frets':
      add('Chords', facts.chords);
      add('Single notes', facts.singles);
      add('Sustains', facts.sustains);
      if (base !== 'keys') add('HOPOs', facts.hopos);
      add('Taps', facts.taps);
      add('Open notes', facts.opens);
      break;
    case 'drums':
      add('Kicks', facts.kicks);
      add('Double kicks', facts.doubleKicks);
      add('Cymbals', facts.cymbals);
      add('Toms and pads', facts.pads);
      add('Accents', facts.accents);
      add('Ghosts', facts.ghosts);
      add('Rolls', facts.rolls);
      add('Fills', facts.fills);
      break;
    case 'vocals':
      add('Syllables', facts.syllables);
      add('Phrases', facts.phrases);
      add('Talkies', facts.talkies);
      add('Percussion', facts.percussion);
      add('Harmony parts', facts.harmonyParts);
      if (facts.rangeText) add('Pitch range', `${facts.rangeText} (${plural(facts.range, 'semitone')})`, true);
      break;
    default:
  }
  add('Star power', facts.starPower);
  add('Solos', facts.solos);
  return rows;
}
