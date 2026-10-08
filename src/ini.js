// Parser for song.ini ([song] section), the metadata file used by CH/YARG song folders.
// Numeric values become numbers; everything else stays a string.
export function parseSongIni(text) {
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
