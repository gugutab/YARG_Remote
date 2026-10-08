// Multitrack player: every stem is decoded into an AudioBuffer, aligned to the chart clock, and played
// through a SoundTouch pitch shifter (time-stretch, so speed changes do not change pitch) into its own GainNode.
// All stems share one AudioContext clock, so they stay in sync.
//
// Timeline: `currentTime()` is the chart clock. The audio file position for chart time t is t + delay
// (YARG: SongRunner.AudioTime = AudioPlaybackTime + SongOffset, with SongOffset = -delay).
// load() shifts each stem by the delay once, so chart time 0 is sample 0 of the aligned buffer.
import { PitchShifter } from '../vendor/soundtouch.js';

const SHIFTER_BUFFER = 1024; // samples per processing block; smaller = less latency

// Number of samples in a stem aligned to the chart clock. Negative delay adds silence in front.
export function alignedLength(srcLength, sampleRate, delay) {
  const pad = Math.max(0, Math.round(-delay * sampleRate));
  const skip = Math.max(0, Math.round(delay * sampleRate));
  return Math.max(1, srcLength + pad - skip);
}

// One channel of a stem, shifted so that output[i] is the file sample at chart time i / sampleRate.
export function alignChannel(src, sampleRate, delay) {
  const length = alignedLength(src.length, sampleRate, delay);
  const pad = Math.max(0, Math.round(-delay * sampleRate));
  const skip = Math.max(0, Math.round(delay * sampleRate));
  const out = new Float32Array(length);
  const count = Math.max(0, Math.min(src.length - skip, length - pad));
  out.set(src.subarray(skip, skip + count), pad);
  return out;
}

export class MultiTrackPlayer {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.stems = new Map(); // id -> { label, buffer, gain, volume }
    this.loadGeneration = 0; // bumped by every load(), so a superseded load can bail out
    this.shifters = []; // PitchShifter nodes of the current playback
    this.duration = 0;
    this.rate = 1; // playback speed; chart time advances rate× faster than real time
    this.playing = false;
    this.offset = 0; // chart position (s) when paused / at last start
    this.startedAt = 0; // ctx.currentTime when the current position was set
  }

  // stems: [{ id, label, getFile }]; delay in seconds (see songDelaySeconds)
  async load(stems, { delay = 0, onProgress = () => {} } = {}) {
    this.stop();
    const generation = ++this.loadGeneration;
    const loaded = new Map();
    let done = 0;
    for (const s of stems) {
      const file = await s.getFile();
      const data = await file.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(data);
      if (generation !== this.loadGeneration) return false; // a newer load() took over
      const buffer = this.alignBuffer(decoded, delay);
      const gain = this.ctx.createGain();
      gain.connect(this.master);
      loaded.set(s.id, { label: s.label, buffer, gain, volume: 1 });
      onProgress(++done / stems.length);
    }
    this.stems = loaded;
    this.duration = Math.max(0, ...[...loaded.values()].map((s) => s.buffer.duration));
    this.offset = 0;
    return true;
  }

  alignBuffer(decoded, delay) {
    const sr = decoded.sampleRate;
    const out = this.ctx.createBuffer(decoded.numberOfChannels, alignedLength(decoded.length, sr, delay), sr);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      out.copyToChannel(alignChannel(decoded.getChannelData(ch), sr, delay), ch);
    }
    return out;
  }

  setVolume(id, value) {
    const stem = this.stems.get(id);
    if (!stem) return;
    stem.volume = value;
    stem.gain.gain.value = value;
  }

  currentTime() {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.offset + (this.ctx.currentTime - this.startedAt) * this.rate);
  }

  // Speed change: re-anchor the clock at the current position and retime the shifters.
  // Pitch is unchanged because the shifters stretch time instead of resampling.
  setRate(rate) {
    if (this.playing) {
      this.offset = this.currentTime();
      this.startedAt = this.ctx.currentTime;
    }
    this.rate = rate;
    for (const sh of this.shifters) sh.tempo = rate;
  }

  async play() {
    if (this.playing || !this.stems.size) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.offset >= this.duration) this.offset = 0;
    this.startSources(this.offset);
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime();
    this.stopSources();
  }

  seek(seconds) {
    const t = Math.max(0, Math.min(this.duration, seconds));
    if (this.playing) {
      this.stopSources();
      this.offset = t;
      this.startSources(t);
    } else {
      this.offset = t;
    }
  }

  stop() {
    this.stopSources();
    this.offset = 0;
  }

  startSources(at) {
    for (const stem of this.stems.values()) {
      if (at >= stem.buffer.duration) continue;
      const sh = new PitchShifter(this.ctx, stem.buffer, SHIFTER_BUFFER);
      sh.tempo = this.rate;
      sh.percentagePlayed = at / stem.buffer.duration; // setter takes a fraction (0..1)
      sh.connect(stem.gain);
      this.shifters.push(sh);
    }
    this.offset = at;
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
  }

  stopSources() {
    for (const sh of this.shifters) sh.disconnect();
    this.shifters = [];
    this.playing = false;
  }
}
