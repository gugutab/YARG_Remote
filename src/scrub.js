// "Tape scrub" for a seek while the song plays: instead of cutting to the new place, the audio rushes through the skipped
// stretch as short overlapping grains (Hann windows) whose source position follows the same ease-out curve as the
// fretboards' seek animation, and then plays on normally from the target. Pure helpers, shared by the worklet and the tests.

export const GRAIN = 2048; // frames per grain (~46 ms at 44.1 kHz)
export const HOP = GRAIN / 2; // a new grain every half grain: two overlap at any time

export const easeOutCubic = (p) => 1 - (1 - Math.min(1, Math.max(0, p))) ** 3;

// The source frame at which grain `k` starts: it follows the eased path from `from` to `to` over `dur` output frames.
export function grainStart(from, to, dur, k) {
  return from + (to - from) * easeOutCubic((k * HOP) / Math.max(1, dur));
}

// Hann window over one grain, x = frame inside the grain (0..GRAIN).
export function hann(x) {
  const s = Math.sin((Math.PI * x) / GRAIN);
  return s * s;
}

// The two grains that overlap output frame `e` are numbered pass 0 (the newest, k = floor(e / HOP)) and pass 1 (the one before).
// Scalar forms, so the audio thread allocates nothing per frame: the source position of the sample in that grain, or NaN when the
// grain does not exist (before the first one, or already over); and its Hann weight.
export function grainSrcAt(from, to, dur, e, pass) {
  const k = Math.floor(e / HOP) - pass;
  if (k < 0) return NaN;
  const x = e - k * HOP;
  if (x >= GRAIN) return NaN;
  return grainStart(from, to, dur, k) + x;
}

export function grainWeightAt(e, pass) {
  return hann(e - (Math.floor(e / HOP) - pass) * HOP);
}

// One scrubbed sample's source index and weight for the output frame `e` (counted from the start of the scrub), for each of the
// (up to two) grains that overlap it: [{ src, w }]. Grains are numbered from 0 and the first one starts at e = 0.
// (Allocates: for tests and tools. The worklet uses grainSrcAt / grainWeightAt.)
export function grainsAt(from, to, dur, e) {
  const out = [];
  for (let pass = 0; pass < 2; pass++) {
    const src = grainSrcAt(from, to, dur, e, pass);
    if (src === src) out.push({ src, w: grainWeightAt(e, pass) });
  }
  return out;
}
