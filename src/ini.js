import { latin1 } from './text.js';
// Decodes the bytes of a song.ini the way YARG reads text (YARGTextReader.cs, YARGIniReader.cs): a UTF-16 or UTF-32
// BOM selects that encoding; otherwise the text is UTF-8 (an optional BOM is skipped) and a line that is not valid
// UTF-8 is read as Latin-1 (ISO-8859-1), YARG's per-string fallback.
export function decodeIniBytes(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length >= 4 && ((b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0) || (b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff))) {
    const little = b[0] === 0xff;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let out = '';
    for (let i = 4; i + 4 <= b.length; i += 4) {
      const cp = view.getUint32(i, little);
      out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd';
    }
    return out;
  }
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) {
    return new TextDecoder(b[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(b.subarray(2));
  }
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  try {
    return utf8.decode(b); // the decoder drops a UTF-8 BOM
  } catch {
    const lines = [];
    let start = 0;
    for (let i = 0; i <= b.length; i++) {
      if (i < b.length && b[i] !== 0x0a) continue;
      const line = b.subarray(start, i);
      start = i + 1;
      try {
        lines.push(utf8.decode(line));
      } catch {
        lines.push(latin1(line));
      }
    }
    return lines.join('\n');
  }
}

// Parser for song.ini ([song] section), the metadata file used by CH/YARG song folders.
// Takes the decoded text or the raw bytes (see decodeIniBytes). Keys are lower-cased.
// Numeric values become numbers; everything else stays a string.
export function parseSongIni(input) {
  const text = typeof input === 'string' ? input.replace(/^\ufeff/, '') : decodeIniBytes(input);
  const out = {};
  let inSong = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      inSong = /^\[song\]$/i.test(line);
      continue;
    }
    if (!inSong) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    out[key] = /^-?\d+$/.test(value) ? Number(value) : value;
  }
  return out;
}

// Boolean song.ini value as YARG reads it (YARGTextReader.ExtractBoolean): true when the text starts with '1' or
// "true" in any case, false otherwise. undefined when the key is absent.
export function iniBool(value) {
  if (value === undefined || value === null) return undefined;
  const t = String(value).trim();
  return t.startsWith('1') || /^true/i.test(t);
}

// Audio delay in seconds, as YARG reads it (SongMetadata.cs): `delay` in ms wins when it is
// non-zero, otherwise `delay_seconds`. Positive = audio sits later in the file than the chart clock.
export function songDelaySeconds(ini) {
  const ms = Number(ini.delay);
  if (ini.delay !== undefined && ms !== 0 && Number.isFinite(ms)) return ms / 1000;
  const s = Number(ini.delay_seconds);
  return Number.isFinite(s) ? s : 0;
}

// song.ini text often carries Unity rich text such as <color=#0072bc>o</color>; show it as plain text.
export function plainText(value) {
  return String(value ?? '').replace(/<\/?[a-z][^>]*>/gi, '').trim();
}

// The pack a song belongs to ("Rock Band 2 DLC", "Guitar Hero III", ...): the top-level folder of its path in the library.
// song.ini only has a short code for it (`icon = rb2dlc`) that is missing in some songs; the folder name is complete.
export function packOf(song) {
  const parts = String(song?.id ?? song?.folder ?? '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}
