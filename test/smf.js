// Test-only Standard MIDI File writer, so tests can build charts without shipping real songs.
const strBytes = (s) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];

export function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

export const meta = (type, data) => [0xff, type, data.length, ...data];
export const text = (s) => meta(0x01, strBytes(s));
export const trackName = (s) => meta(0x03, strBytes(s));
export const tempo120 = (dt = 0) => ({ dt, bytes: meta(0x51, [0x07, 0xa1, 0x20]) });
export const on = (dt, pitch) => ({ dt, bytes: [0x90, pitch, 100] });
export const off = (dt, pitch) => ({ dt, bytes: [0x80, pitch, 0] });
export const event = (dt, bytes) => ({ dt, bytes });

function trackChunk(events) {
  const body = [];
  for (const e of events) body.push(...vlq(e.dt), ...e.bytes);
  body.push(0, 0xff, 0x2f, 0);
  return [...strBytes('MTrk'), ...u32(body.length), ...body];
}

// tracks: arrays of events built with the helpers above
export function buildMidi(division, tracks) {
  const header = [...strBytes('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(division)];
  return new Uint8Array([...header, ...tracks.flatMap(trackChunk)]);
}
