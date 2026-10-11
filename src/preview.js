// Preview window of a song, from song.ini (YARG: SongMetadata.cs reads preview_start_time / preview_end_time in
// milliseconds, or preview_start_seconds / preview_end_seconds; PreviewContext.cs plays the window, with a 30 s
// default length when the end is missing or not after the start).
// Returns { start, end } in seconds of the audio FILE (not the chart clock), or null when the song defines no start
// after 0 (a start of 0 or less is the same as "none": the whole song is not a useful preview).
export const DEFAULT_PREVIEW_SECONDS = 30; // PreviewContext.DEFAULT_PREVIEW_DURATION

function seconds(ini, msKey, secKey) {
  const ms = Number(ini?.[msKey]);
  if (ini?.[msKey] !== undefined && Number.isFinite(ms)) return ms / 1000;
  const s = Number(ini?.[secKey]);
  if (ini?.[secKey] !== undefined && Number.isFinite(s)) return s;
  return null;
}

export function previewWindow(ini) {
  const start = seconds(ini, 'preview_start_time', 'preview_start_seconds');
  if (start == null || start <= 0) return null;
  let end = seconds(ini, 'preview_end_time', 'preview_end_seconds');
  if (end == null || end <= start) end = start + DEFAULT_PREVIEW_SECONDS;
  return { start, end };
}
