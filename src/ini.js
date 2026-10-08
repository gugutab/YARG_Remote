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
