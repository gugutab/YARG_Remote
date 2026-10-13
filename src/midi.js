// Minimal Standard MIDI File (SMF) parser.
// Produces per-track note pairs (with duration), text/lyric events and the tempo map,
// which is all the chart builder needs. Reference: YARG.Core/IO/Midi + MoonscraperChartParser.
//
// The input is untrusted (song packs come from anywhere): every length is checked against the end of its track, a
// variable-length quantity is at most 4 bytes, the read position strictly advances with each event, and the file size
// and event count are capped. Anything malformed throws Error('Invalid MIDI: ...') instead of looping or returning a
// silently truncated chart.

import { latin1, decodeUtf8OrLatin1 } from './text.js';

const DEFAULT_US_PER_QUARTER = 500000;
export const MAX_MIDI_BYTES = 64 * 1024 * 1024;
export const MAX_MIDI_EVENTS = 8_000_000; // generous: the biggest real charts have well under a million

const invalid = (why) => new Error(`Invalid MIDI: ${why}`);

// options.maxBytes / options.maxEvents exist for tests; the defaults are the caps above.
export function parseMidi(input, { maxBytes = MAX_MIDI_BYTES, maxEvents = MAX_MIDI_EVENTS } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > maxBytes) throw invalid(`file too large (${bytes.length} bytes)`);
  if (bytes.length < 14 || latin1(bytes.subarray(0, 4)) !== 'MThd') throw new Error('Not a valid MIDI file (MThd missing)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const headerLen = view.getUint32(4);
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (headerLen < 6 || 8 + headerLen > bytes.length) throw invalid('bad header length');
  if (division & 0x8000) throw new Error('SMPTE division not supported');
  if (division === 0) throw invalid('division (ticks per quarter note) is 0');

  const tracks = [];
  const budget = { events: maxEvents };
  let pos = 8 + headerLen;
  for (let i = 0; i < trackCount && pos + 8 <= bytes.length; i++) {
    const id = latin1(bytes.subarray(pos, pos + 4));
    const len = view.getUint32(pos + 4);
    const end = pos + 8 + len;
    if (end > bytes.length) throw invalid(`track ${i} runs past the end of the file`);
    if (id === 'MTrk') tracks.push(parseTrack(bytes, pos + 8, end, budget));
    pos = end;
  }
  if (!tracks.length) throw invalid('no tracks');

  const tempos = collectTempos(tracks);
  const timeSignatures = tracks.flatMap((t) => t.timeSignatures || []).sort((a, b) => a.tick - b.tick);
  return { format, division, tracks, tempos, timeSignatures, toSeconds: createTickToSeconds(tempos, division) };
}

function parseTrack(bytes, start, end, budget) {
  const track = { name: '', notes: [], texts: [], lyrics: [], sysex: [] };
  const tempos = [];
  const timeSignatures = [];
  const open = new Map(); // channel/pitch -> note-ons waiting for their note-off
  let pos = start;
  let tick = 0;
  let status = 0;

  while (pos < end) {
    const eventStart = pos;
    if (--budget.events < 0) throw invalid('too many events');
    const [delta, afterDelta] = readVlq(bytes, pos, end);
    pos = afterDelta;
    tick += delta;
    if (pos >= end) throw invalid('event cut off after its delta time');
    const byte = bytes[pos];

    if (byte === 0xff) { // meta event
      if (pos + 2 > end) throw invalid('meta event cut off');
      const type = bytes[pos + 1];
      const [len, dataPos] = readVlq(bytes, pos + 2, end);
      if (len > end - dataPos) throw invalid('meta event runs past the end of its track');
      const data = bytes.subarray(dataPos, dataPos + len);
      pos = dataPos + len;
      if (type === 0x03 && !track.name) track.name = readText(data);
      else if (type === 0x01) track.texts.push({ tick, text: readText(data) });
      else if (type === 0x05) track.lyrics.push({ tick, text: readText(data) }); // lyric events, used by vocal tracks
      else if (type === 0x51 && len === 3) {
        const usPerQuarter = (data[0] << 16) | (data[1] << 8) | data[2];
        if (usPerQuarter > 0) tempos.push({ tick, usPerQuarter }); // a 0 tempo would put every later note at the same instant
      } else if (type === 0x58 && len >= 2 && data[0] > 0) timeSignatures.push({ tick, num: data[0], den: 2 ** data[1] }); // denominator is a power of two
      else if (type === 0x2f) break;
    } else if (byte === 0xf0 || byte === 0xf7) { // sysex: kept for PhaseShift phrases (open, tap), see chart.js
      const [len, dataPos] = readVlq(bytes, pos + 1, end);
      if (len > end - dataPos) throw invalid('sysex runs past the end of its track');
      track.sysex.push({ tick, data: bytes.subarray(dataPos, dataPos + len) });
      pos = dataPos + len;
    } else if (byte >= 0xf1) { // 0xf1-0xfe are system common/real-time messages, which an SMF cannot hold
      throw invalid(`unsupported status byte 0x${byte.toString(16)}`);
    } else {
      if (byte & 0x80) { status = byte; pos++; } // otherwise: running status
      else if (!status) throw invalid('data byte without a status byte (running status before any status)');
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const dataBytes = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      if (pos + dataBytes > end) throw invalid('channel event cut off');
      const pitch = bytes[pos];
      const velocity = dataBytes === 2 ? bytes[pos + 1] : 0;
      // A second data byte with the high bit set (seen in a real Rock Band note-off, velocity 0xff) is out of spec but harmless: accepted.
      pos += dataBytes;

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
    if (pos <= eventStart) throw invalid('parser did not advance'); // cannot happen; guards against an endless loop
  }

  track.notes.sort((a, b) => a.tick - b.tick);
  track.tempos = tempos;
  track.timeSignatures = timeSignatures;
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

// Variable-length quantity: 1 to 4 bytes (28 bits, so plain arithmetic cannot wrap), never past `end`.
function readVlq(bytes, pos, end) {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    if (pos >= end) throw invalid('variable-length quantity cut off');
    const b = bytes[pos++];
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) return [value, pos];
  }
  throw invalid('variable-length quantity longer than 4 bytes');
}

// Text meta events: UTF-8 when valid, else Latin-1 (what YARG does).
function readText(data) {
  return decodeUtf8OrLatin1(data);
}
