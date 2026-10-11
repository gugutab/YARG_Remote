// Tiny .sng writer for tests and throwaway tools (format: see src/sng.js).
export function writeSng({ metadata = {}, files = {}, xorMask = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff), version = 1 }) {
  const enc = new TextEncoder();
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
  const cat = (parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const pairs = Object.entries(metadata).flatMap(([k, v]) => {
    const kb = enc.encode(k);
    const vb = enc.encode(String(v));
    return [u32(kb.length), kb, u32(vb.length), vb];
  });
  const metaBody = cat([u64(Object.keys(metadata).length), ...pairs]);
  const meta = cat([u64(metaBody.length), metaBody]);
  const names = Object.keys(files);
  const indexSize = 8 + names.reduce((n, k) => n + 1 + enc.encode(k).length + 16, 0); // count + entries
  let off = 6 + 4 + 16 + meta.length + 8 + indexSize + 8; // header, metadata, index (length + body), data length
  const entries = [];
  const blobs = [];
  for (const name of names) {
    const data = Uint8Array.from(files[name]);
    const nb = enc.encode(name);
    entries.push(Uint8Array.of(nb.length), nb, u64(data.length), u64(off));
    off += data.length;
    blobs.push(data.map((b, j) => b ^ xorMask[(j & 0xff) % 16] ^ (j & 0xff)));
  }
  const idxBody = cat([u64(names.length), ...entries]);
  const dataBody = cat(blobs);
  return cat([enc.encode('SNGPKG'), u32(version), xorMask, meta, u64(idxBody.length), idxBody, u64(dataBody.length), dataBody]);
}
