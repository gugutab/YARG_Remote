// .sng song containers (SngFileFormat by mdsitton; YARG.Core IO/SngHandler/SngFile.cs, SngMask.cs, SngFileStream.cs).
// Layout (little endian): "SNGPKG", u32 version, 16 byte xorMask, metadata section, file index section, file data.
//   metadata: i64 length (counts the 8 byte pair count that follows), u64 pairCount, pairs of (i32 len + UTF-8 key,
//             i32 len + UTF-8 value) -> the song.ini [song] keys (SngFile.LoadMetadata);
//   index:    i64 length (counts the 8 byte file count), u64 fileCount, entries of (u8 nameLen, name, i64 size,
//             i64 absolute offset) (SngFile.LoadListings; YARG lower-cases the names, we keep them and match case-insensitively);
//   data:     the files, each masked on its own: byte j ^= mask[j % 256], mask[i] = xorMask[i % 16] ^ i
//             (SngMask.LoadMask, SngFileStream.DecryptVectorized).
// Not supported: YARG's own encrypted wrapper (YARGSongFileStream), which is not part of the public format.
// Pure module: works on any "source" ({ size, read(start, end) -> Promise<Uint8Array> }), so a Blob/File is only sliced
// for the part asked for (blobSource), and Node can use a file handle or a buffer (bufferSource, fileSource in server.mjs).

const MAGIC = 'SNGPKG';
// The metadata and index sections are read whole into memory, and the browser scans several .sng at once (library.js),
// so they are small: real ones are a few KB (a few hundred bytes of tags; ~20 entries of ~30 bytes). Only the file DATA
// is big, and that is never read here: it is read by range, bounded by the real size of the file (see parseSng).
const MAX_SECTION = 8 * 1024 * 1024;
const MIN_METADATA_PAIR = 8; // two i32 lengths
const MIN_INDEX_ENTRY = 17; // u8 name length + i64 size + i64 offset

export function blobSource(blob) {
  return { size: blob.size, read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()) };
}

export function bufferSource(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { size: u8.length, read: async (start, end) => u8.subarray(start, Math.min(end, u8.length)) };
}

const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

async function readExact(source, start, length) {
  if (length < 0 || start + length > source.size) throw new Error('SNG: truncated file');
  const b = await source.read(start, start + length);
  if (b.length < length) throw new Error('SNG: truncated file');
  return b;
}

// A section is i64 length + body; checked against the cap and the real file size before anything is allocated.
// `minEntry` is the smallest an entry can be, which bounds the declared count by what the body can really hold.
async function readSection(source, pos, minEntry) {
  const len = Number(view(await readExact(source, pos, 8)).getBigInt64(0, true));
  if (!(len >= 8 && len <= MAX_SECTION)) throw new Error('SNG: bad section size');
  if (pos + 8 + len > source.size) throw new Error('SNG: truncated file');
  const body = await readExact(source, pos + 8, len);
  const count = Number(view(body).getBigUint64(0, true));
  if (!(count >= 0 && count <= (len - 8) / minEntry)) throw new Error('SNG: bad entry count');
  return { count, bytes: body.subarray(8), end: pos + 8 + len };
}

// song.ini values like "1999" become numbers, like parseSongIni.
const iniValue = (v) => (/^-?\d+$/.test(v) ? Number(v) : v);

// Reads the header, the metadata and the file index. Returns { version, mask, metadata, files: [{ name, size, offset }] }.
// `metadata` has the same shape as parseSongIni's output (lower-case keys, numeric values as numbers).
export async function parseSng(source) {
  const head = await readExact(source, 0, 6 + 4 + 16);
  if (new TextDecoder().decode(head.subarray(0, 6)) !== MAGIC) throw new Error('SNG: not a .sng file');
  const version = view(head).getUint32(6, true);
  const mask = new Uint8Array(256);
  for (let i = 0; i < 256; i++) mask[i] = head[10 + (i % 16)] ^ (i & 0xff);

  const text = new TextDecoder('utf-8');
  const meta = await readSection(source, 26, MIN_METADATA_PAIR);
  const metadata = {};
  let p = 0;
  const mv = view(meta.bytes);
  const str = () => {
    if (p + 4 > meta.bytes.length) throw new Error('SNG: truncated metadata');
    const n = mv.getInt32(p, true);
    p += 4;
    if (n < 0 || p + n > meta.bytes.length) throw new Error('SNG: truncated metadata');
    const s = text.decode(meta.bytes.subarray(p, p + n));
    p += n;
    return s;
  };
  for (let i = 0; i < meta.count; i++) {
    const key = str().trim().toLowerCase();
    metadata[key] = iniValue(str().trim());
  }

  const idx = await readSection(source, meta.end, MIN_INDEX_ENTRY);
  const files = [];
  const iv = view(idx.bytes);
  p = 0;
  for (let i = 0; i < idx.count; i++) {
    if (p >= idx.bytes.length) throw new Error('SNG: truncated file index');
    const n = idx.bytes[p++];
    if (p + n + 16 > idx.bytes.length) throw new Error('SNG: truncated file index');
    const name = text.decode(idx.bytes.subarray(p, p + n));
    p += n;
    const size = Number(iv.getBigInt64(p, true));
    const offset = Number(iv.getBigInt64(p + 8, true));
    p += 16;
    // The inner file must lie inside the container: a lying index would otherwise ask for reads (and buffers) of any size.
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(offset) || size < 0 || offset < 0 || offset + size > source.size) {
      throw new Error('SNG: file entry outside the file');
    }
    files.push({ name, size, offset });
  }
  return { version, mask, metadata, files };
}

// XORs bytes that start at byte `from` of a file with the SNG mask, in place. Returns the same array.
export function unmask(bytes, mask, from = 0) {
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask[(from + i) & 0xff];
  return bytes;
}

// Reads bytes [start, end) of one inner file, unmasked. Only that range is read from the source.
export async function readSngBytes(source, sng, entry, start = 0, end = entry.size) {
  start = Math.max(0, start);
  end = Math.min(entry.size, end);
  if (end <= start) return new Uint8Array(0);
  const raw = await readExact(source, entry.offset + start, end - start);
  return unmask(new Uint8Array(raw), sng.mask, start); // copy: the source may hand out a view of its own buffer
}

// The inner file called `name` (case-insensitive), or undefined.
export function findSngFile(sng, name) {
  const lower = name.toLowerCase();
  return sng.files.find((f) => f.name.toLowerCase() === lower);
}

export const isSngName = (name) => /\.sng$/i.test(name);
