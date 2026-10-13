// Decodes every stem, skipping the ones that fail, so one bad file (crowd, preview, an unsupported codec, an empty file)
// does not make the whole song unplayable.
//   stems: [{ id, label, ... }]; decode(stem) -> Promise of whatever the caller wants to keep;
//   onProgress(fraction) reaches 1 even when some stems fail; shouldStop() true abandons the work (returns null).
// Returns { ok: [{ stem, value }], failed: [{ id, label, error }] }. If nothing decoded, throws the first error.
export async function decodeAll(stems, decode, onProgress = () => {}, shouldStop = () => false) {
  const ok = [];
  const failed = [];
  let done = 0;
  for (const stem of stems) {
    try {
      const value = await decode(stem);
      if (shouldStop()) return null;
      ok.push({ stem, value });
    } catch (error) {
      if (shouldStop()) return null;
      console.warn(`Could not decode stem "${stem.id}":`, error);
      failed.push({ id: stem.id, label: stem.label, error });
    }
    onProgress(++done / stems.length);
  }
  if (!ok.length && failed.length) {
    const first = failed[0].error;
    throw Object.assign(new Error(first?.message || String(first)), { failedStems: failed });
  }
  return { ok, failed };
}
