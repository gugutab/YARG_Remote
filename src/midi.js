// Minimal Standard MIDI File (SMF) parser.
// Produces per-track note pairs (with duration), text/lyric events and the tempo map,
// which is all the chart builder needs. Reference: YARG.Core/IO/Midi + MoonscraperChartParser.

const DEFAULT_US_PER_QUARTER = 500000;

export function parseMidi(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readStr(bytes, 0, 4) !== 'MThd') throw new Error('Arquivo não é um MIDI válido (MThd ausente)');

  const headerLen = view.getUint32(4);
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new Error('Divisão SMPTE não suportada');

  const tracks = [];
  let pos = 8 + headerLen;
  for (let i = 0; i < trackCount && pos + 8 <= bytes.length; i++) {
    const id = readStr(bytes, pos, 4);
    const len = view.getUint32(pos + 4);
    const end = Math.min(pos + 8 + len, bytes.length);
    if (id === 'MTrk') tracks.push(parseTrack(bytes, pos + 8, end));
    pos += 8 + len;
  }

  const tempos = collectTempos(tracks);
  return { format, division, tracks, tempos, toSeconds: createTickToSeconds(tempos, division) };
}

function parseTrack(bytes, start, end) {
  const track = { name: '', notes: [], texts: [], lyrics: [], sysex: [] };
  const tempos = [];
  const open = new Map(); // channel/pitch -> note-ons waiting for their note-off
  let pos = start;
  let tick = 0;
  let status = 0;

  while (pos < end) {
    const [delta, afterDelta] = readVlq(bytes, pos);
    pos = afterDelta;
    tick += delta;
    const byte = bytes[pos];

    if (byte === 0xff) { // meta event
      const type = bytes[pos + 1];
      const [len, dataPos] = readVlq(bytes, pos + 2);
      const data = bytes.subarray(dataPos, dataPos + len);
      pos = dataPos + len;
      if (type === 0x03 && !track.name) track.name = readText(data);
      else if (type === 0x01) track.texts.push({ tick, text: readText(data) });
      else if (type === 0x05) track.lyrics.push({ tick, text: readText(data) }); // lyric events, used by vocal tracks
      else if (type === 0x51 && len === 3) tempos.push({ tick, usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
      else if (type === 0x2f) break;
      continue;
    }

    if (byte === 0xf0 || byte === 0xf7) { // sysex: kept for PhaseShift phrases (open, tap), see chart.js
      const [len, dataPos] = readVlq(bytes, pos + 1);
      track.sysex.push({ tick, data: bytes.subarray(dataPos, dataPos + len) });
      pos = dataPos + len;
      continue;
    }

    if (byte & 0x80) { status = byte; pos++; } // otherwise: running status
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    const hasTwoData = kind !== 0xc0 && kind !== 0xd0;
    const pitch = bytes[pos];
    const velocity = hasTwoData ? bytes[pos + 1] : 0;
    pos += hasTwoData ? 2 : 1;

    const key = channel * 128 + pitch;
    if (kind === 0x90 && velocity > 0) {
      const note = { tick, endTick: tick, pitch, velocity, channel };
      track.notes.push(note);
      if (!open.has(key)) open.set(key, []);
      open.get(key).push(note);
    } else if (kind === 0x80 || kind === 0x90) { // note-off (or note-on with velocity 0)
      const waiting = open.get(key);
      if (waiting && waiting.length) waiting.shift().endTick = tick;
    }
  }

  track.notes.sort((a, b) => a.tick - b.tick);
  track.tempos = tempos;
  return track;
}

function collectTempos(tracks) {
  const all = tracks.flatMap((t) => t.tempos || []).sort((a, b) => a.tick - b.tick);
  return all.length ? all : [{ tick: 0, usPerQuarter: DEFAULT_US_PER_QUARTER }];
}

// Returns a function tick -> seconds, integrating the tempo changes.
export function createTickToSeconds(tempos, division) {
  const entries = [{ tick: 0, us: DEFAULT_US_PER_QUARTER, sec: 0 }];
  for (const t of tempos) {
    const last = entries[entries.length - 1];
    if (t.tick === last.tick) { last.us = t.usPerQuarter; continue; }
    const sec = last.sec + ((t.tick - last.tick) * last.us) / 1e6 / division;
    entries.push({ tick: t.tick, us: t.usPerQuarter, sec });
  }
  return (tick) => {
    let lo = 0;
    let hi = entries.length - 1;
    while (lo < hi) { // last entry with entry.tick <= tick
      const mid = (lo + hi + 1) >> 1;
      if (entries[mid].tick <= tick) lo = mid; else hi = mid - 1;
    }
    const e = entries[lo];
    return e.sec + ((tick - e.tick) * e.us) / 1e6 / division;
  };
}

function readVlq(bytes, pos) {
  let value = 0;
  for (;;) {
    const b = bytes[pos++];
    value = (value << 7) | (b & 0x7f);
    if (!(b & 0x80)) return [value, pos];
  }
}

function readStr(bytes, pos, len) {
  return String.fromCharCode(...bytes.subarray(pos, pos + len));
}

function readText(data) {
  return String.fromCharCode(...data);
}
