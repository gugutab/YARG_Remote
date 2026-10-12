// Special notes of a chart: the kinds of notes and phrases that stand out (open, tap, accent, double kick, star power, fills,
// pitch slides, percussion...), how many there are and where, so the page can list them and jump between them.
// Pure functions; the chart is what buildChart returns.

const CLUSTER_SEC = 1.0; // occurrences closer than this count as one place to jump to

export const SPECIAL_COLORS = {
  open: '#c800ff', tap: '#b25cff', accent: '#ffffff', ghost: '#9aa4af', doubleKick: '#f2861e',
  starPower: '#6cb6ff', solo: '#ffbe3c', fill: '#b25cff', bre: '#ff5050',
  kickRoll: '#f2861e', tremolo: '#3fbf3f', trill: '#f5c518',
  slide: '#5b8def', talkie: '#8aa4d6', percussion: '#e6edf3', rangeShift: '#7ee0c3',
};

// Collapses sorted times into the start of each cluster of occurrences.
export function cluster(times) {
  const out = [];
  let last = -Infinity;
  for (const t of times) {
    if (t - last > CLUSTER_SEC) out.push(t);
    last = t;
  }
  return out;
}

function entry(id, label, times, count = times.length) {
  const sorted = [...times].sort((a, b) => a - b);
  return count > 0 ? { id, label, color: SPECIAL_COLORS[id], count, times: cluster(sorted) } : null;
}

// -> [{ id, label, color, count, times }] for the kinds the chart has. `count` is notes, phrases or hits;
// `times` are the places to jump to (chart seconds, sorted).
export function specialNotes(chart) {
  if (!chart) return [];
  const out = [];
  if (chart.mode === 'vocals') {
    out.push(
      entry('slide', 'Pitch slides', chart.notes.filter((n) => n.slide).map((n) => n.time)),
      entry('talkie', 'Talkies', chart.notes.filter((n) => n.talkie).map((n) => n.time)),
      entry('percussion', 'Percussion', (chart.percussion || []).map((p) => p.time)),
      entry('rangeShift', 'Range shifts', (chart.rangeShifts || []).map((r) => r.time)),
    );
  } else {
    const flag = (key) => chart.notes.filter((n) => n[key]).map((n) => n.time);
    out.push(
      entry('open', 'Open notes', flag('open')),
      entry('tap', 'Tap notes', flag('tap')),
      entry('accent', 'Accents', flag('accent')),
      entry('ghost', 'Ghost notes', flag('ghost')),
      entry('doubleKick', 'Double kicks', flag('doubleKick')),
      entry('starPower', 'Star power', (chart.starPower || []).map((s) => s.start)),
      entry('solo', 'Solos', (chart.solos || []).map((s) => s.start)),
      entry('fill', 'Drum fills', (chart.fills || []).filter((f) => f.kind !== 'bre').map((f) => f.start)),
      entry('bre', 'Big rock ending', (chart.fills || []).filter((f) => f.kind === 'bre').map((f) => f.start)),
      entry('kickRoll', 'Kick rolls', (chart.rolls || []).filter((r) => r.type === 'kick').map((r) => r.start)),
      entry('tremolo', 'Tremolo lanes', (chart.rolls || []).filter((r) => r.type === 'tremolo').map((r) => r.start)),
      entry('trill', 'Trill lanes', (chart.rolls || []).filter((r) => r.type === 'trill').map((r) => r.start)),
    );
  }
  return out.filter(Boolean);
}

// The next (dir = 1) or previous (dir = -1) place to jump to from `t`, or null. "Previous" skips the one that
// just started, so pressing it twice in a row keeps going back.
export function neighbourTime(times, t, dir) {
  if (dir > 0) return times.find((x) => x > t + 0.25) ?? null;
  for (let i = times.length - 1; i >= 0; i--) if (times[i] < t - 0.5) return times[i];
  return null;
}
