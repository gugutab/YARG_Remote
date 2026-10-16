// Decodes every stem, skipping the ones that fail, so one bad file (crowd, preview, an unsupported codec, an empty file)
// does not make the whole song unplayable.
//   stems: [{ id, label, ... }]; decode(stem) -> Promise of whatever the caller wants to keep;
//   onProgress(fraction) reaches 1 even when some stems fail; shouldStop() true abandons the work (returns null).
// Returns { ok: [{ stem, value }], failed: [{ id, label, error }] }. If nothing decoded, throws the first error.
const DECODE_PARALLEL = 3;
export async function decodeAll(stems, decode, onProgress = () => {}, shouldStop = () => false) {
  const ok = [];
  const failed = [];
  let done = 0;
  // A few stems decode at once (the load was one by one: the slowest part of starting a song); results keep the stems' order.
  const results = new Array(stems.length);
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < stems.length) {
      const i = next++;
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
