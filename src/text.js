// Byte-to-text helpers shared by the MIDI parser and the song.ini reader.

const CHUNK = 8192; // String.fromCharCode(...bytes) overflows the stack on long inputs, so decode in slices

// Latin-1 (ISO-8859-1): every byte is the code point of the same value. Safe for any length.
export function latin1(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return out;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

// UTF-8 when the bytes are valid UTF-8, otherwise Latin-1: what YARG does with text it reads from charts and song.ini
// (YARG.Core YARGTextReader / MidReader). Pure ASCII takes the same path in both, so it is returned as is.
export function decodeUtf8OrLatin1(bytes) {
  let ascii = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x80) { ascii = false; break; }
  }
  if (ascii) return latin1(bytes);
  try {
    return utf8.decode(bytes); // drops a leading UTF-8 BOM
  } catch {
    return latin1(bytes);
  }
}
