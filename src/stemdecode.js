// Decodes every stem, skipping the ones that fail, so one bad file (crowd, preview, an unsupported codec, an empty file)
// does not make the whole song unplayable.
//   stems: [{ id, label, ... }]; decode(stem) -> Promise of whatever the caller wants to keep;
//   onProgress(fraction) reaches 1 even when some stems fail; shouldStop() true abandons the work (returns null).
// Returns { ok: [{ stem, value }], failed: [{ id, label, error }] }. If nothing decoded, throws the first error.
const DECODE_PARALLEL = 6; // every stem of a normal song at once (the decoder itself runs off the main thread)
export async function decodeAll(stems, decode, onProgress = () => {}, shouldStop = () => false) {
  const ok = [];
  const failed = [];
  let done = 0;
  // A few stems decode at once (the load was one by one: the slowest part of starting a song); results keep the stems' order.
  const results = new Array(stems.length);
  // Start with the stems that matter (the crowd is long and the least needed): the queue is taken in this order, results keep the stems' order.
  const order = stems.map((_, i) => i).sort((x, y) => (stems[x].id === 'crowd') - (stems[y].id === 'crowd') || x - y);
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < stems.length) {
      const i = order[next++];
      const stem = stems[i];
      try {
        const value = await decode(stem);
        if (shouldStop()) { stopped = true; return; }
        results[i] = { stem, value };
      } catch (error) {
        if (shouldStop()) { stopped = true; return; }
        console.warn(`Could not decode stem "${stem.id}":`, error);
        results[i] = { failed: { id: stem.id, label: stem.label, error } };
      }
      onProgress(++done / stems.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DECODE_PARALLEL, stems.length) }, worker));
  if (stopped) return null;
  for (const r of results) { if (r.failed) failed.push(r.failed); else ok.push(r); }
  if (!ok.length && failed.length) {
    const first = failed[0].error;
    throw Object.assign(new Error(first?.message || String(first)), { failedStems: failed });
  }
  return { ok, failed };
}

// Decoding memory. A decoded stem is float32 at the context's rate (a 6 min stereo stem is ~130 MB), and with every stem decoding at once a long song
// peaked well over a gigabyte. Each decode first takes its estimated size from a shared budget and gives it back when done: short songs still decode
// all at once, long ones a few at a time. One decode always runs, however big.
export const DECODE_BUDGET_BYTES = 640 * 1024 * 1024;
// The decoded size of an audio file, roughly: a WAV (RIFF) is 16-bit PCM, about 2x as float32; compressed audio (Ogg Vorbis/Opus, MP3) about 24x.
export function estimateDecodedBytes(data) {
  const b = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  const wav = b.length === 4 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  return data.byteLength * (wav ? 2 : 24);
}
// A byte budget shared by async jobs: acquire(n) resolves once `n` more fits (or nothing else holds any), in the order asked; release(n) gives it back.
export function createBudget(limit) {
  let used = 0;
  const waiting = [];
  const pump = () => {
    while (waiting.length && (used === 0 || used + waiting[0].n <= limit)) {
      const w = waiting.shift();
      used += w.n;
      w.resolve();
    }
  };
  return {
    acquire(n) { return new Promise((resolve) => { waiting.push({ n, resolve }); pump(); }); },
    release(n) { used -= n; pump(); },
    get used() { return used; },
  };
}
// Runs `job` holding `bytes` of the budget.
export async function withBudget(budget, bytes, job) {
  await budget.acquire(bytes);
  try { return await job(); } finally { budget.release(bytes); }
}
