// Multitrack player. Every stem is decoded, aligned to the chart clock, and handed to one AudioWorklet that mixes
// them into a single stream and time-stretches it once (pitch preserved). A single read position means the stems
// cannot drift apart, and the worklet reports that position back, so `currentTime()` (the chart clock) follows what
// is actually heard. If AudioWorklet is unavailable, LegacyPlayer (one ScriptProcessor per stem) takes over.
//
// Timeline: `currentTime()` is the chart clock. The audio file position for chart time t is t + delay
// (YARG: SongRunner.AudioTime = AudioPlaybackTime + SongOffset, with SongOffset = -delay).
// load() shifts each stem by the delay once, so chart time 0 is sample 0 of the aligned stem.
import { PitchShifter } from '../vendor/soundtouch.js';

const SHIFTER_BUFFER = 2048; // legacy path: samples per ScriptProcessor block (bigger = fewer dropouts)

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


// Old engine, kept as a fallback: one PitchShifter (ScriptProcessorNode) per stem.
class LegacyPlayer {
  constructor(ctx, master) {
    this.ctx = ctx;
    this.master = master;
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

// New engine: one AudioWorklet mixes and stretches all the stems (see player-worklet.js).
class WorkletPlayer {
  constructor(ctx, master) {
    this.ctx = ctx;
    this.master = master;
    this.node = null;
    this.ready = null; // promise of the worklet module
    this.ids = []; // stem ids, in the order the worklet knows them
    this.volumes = new Map();
    this.duration = 0;
    this.rate = 1;
    this.playing = false;
    this.offset = 0; // chart position (s) when paused
    this.report = { frame: 0, time: 0 }; // last position reported by the worklet
    this.stems = new Map(); // id -> true (the app only checks that stems exist)
  }

  async setup() {
    if (this.node) return;
    if (!this.ctx.audioWorklet) throw Object.assign(new Error('AudioWorklet unavailable'), { workletUnavailable: true });
    try {
      this.ready ||= this.ctx.audioWorklet.addModule(new URL('./player-worklet.js', import.meta.url));
      await this.ready;
      this.node = new AudioWorkletNode(this.ctx, 'yarg-mix', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    } catch (err) {
      throw Object.assign(err, { workletUnavailable: true });
    }
    this.node.connect(this.master);
    this.node.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'pos') this.report = { frame: m.frame, time: m.time };
      if (m.type === 'pos' && m.ended) this.finished = true;
    };
  }

  // stems: [{ id, label, getFile }]; delay in seconds (see songDelaySeconds)
  async load(stems, { delay = 0, onProgress = () => {} } = {}) {
    await this.setup();
    this.stop();
    const generation = (this.generation = (this.generation || 0) + 1);
    const aligned = [];
    const ids = [];
    let done = 0;
    for (const s of stems) {
      const file = await s.getFile();
      const data = await file.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(data);
      if (generation !== this.generation) return false; // a newer load() took over
      const channels = [];
      for (let ch = 0; ch < Math.min(2, decoded.numberOfChannels); ch++) {
        channels.push(alignChannel(decoded.getChannelData(ch), decoded.sampleRate, delay));
      }
      aligned.push(channels);
      ids.push(s.id);
      onProgress(++done / stems.length);
    }
    if (generation !== this.generation) return false;
    this.ids = ids;
    this.stems = new Map(ids.map((id) => [id, true]));
    this.volumes = new Map(ids.map((id) => [id, 1]));
    this.duration = aligned.reduce((m, ch) => Math.max(m, ch[0].length / this.ctx.sampleRate), 0);
    this.offset = 0;
    this.finished = false;
    // the arrays are moved, not copied: the worklet owns the audio from here on
    const transfer = aligned.flatMap((ch) => ch.map((a) => a.buffer));
    this.node.port.postMessage({ type: 'load', stems: aligned, rate: this.rate }, transfer);
    this.postGains();
    return true;
  }

  postGains() {
    this.node?.port.postMessage({ type: 'gains', gains: this.ids.map((id) => this.volumes.get(id) ?? 1) });
  }

  setVolume(id, value) {
    if (!this.volumes.has(id)) return;
    this.volumes.set(id, value);
    this.postGains();
  }

  // How long the sound takes to reach the speakers; the chart clock is shifted back by it to match what is heard.
  get outputLatency() {
    const l = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return Math.min(l, 0.3);
  }

  currentTime() {
    if (!this.playing) return this.offset;
    const r = this.report;
    const heardFor = Math.max(0, this.ctx.currentTime - this.outputLatency - r.time); // audio time since the report was made
    return Math.min(this.duration, Math.max(0, r.frame / this.ctx.sampleRate + heardFor * this.rate));
  }

  setRate(rate) {
    if (this.playing) {
      // re-anchor so the new speed applies from now on
      this.offset = this.currentTime();
      this.report = { frame: this.offset * this.ctx.sampleRate, time: this.ctx.currentTime - this.outputLatency };
    }
    this.rate = rate;
    this.node?.port.postMessage({ type: 'rate', rate });
  }

  async play() {
    if (this.playing || !this.ids.length) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.offset >= this.duration) this.offset = 0;
    this.startAt(this.offset);
  }

  startAt(seconds) {
    const frame = Math.round(seconds * this.ctx.sampleRate);
    this.finished = false;
    this.report = { frame, time: this.ctx.currentTime }; // until the worklet reports for real
    this.node.port.postMessage({ type: 'seek', frame });
    this.node.port.postMessage({ type: 'play' });
    this.offset = seconds;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime();
    this.node.port.postMessage({ type: 'pause' });
    this.playing = false;
  }

  seek(seconds) {
    const t = Math.max(0, Math.min(this.duration, seconds));
    if (this.playing) this.startAt(t);
    else {
      this.offset = t;
      this.node?.port.postMessage({ type: 'seek', frame: Math.round(t * this.ctx.sampleRate) });
    }
  }

  stop() {
    this.node?.port.postMessage({ type: 'pause' });
    this.playing = false;
    this.offset = 0;
  }
}

// What the app uses: the worklet engine, or the legacy one when AudioWorklet cannot be set up.
export class MultiTrackPlayer {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.impl = new WorkletPlayer(this.ctx, this.master);
    this.speed = 1;
    this.engine = 'worklet';
  }

  async load(stems, opts) {
    try {
      const ok = await this.impl.load(stems, opts);
      this.impl.setRate(this.speed);
      return ok;
    } catch (err) {
      if (!err.workletUnavailable) throw err;
      console.warn('AudioWorklet unavailable, using the legacy player:', err);
      this.impl = new LegacyPlayer(this.ctx, this.master);
      this.engine = 'legacy';
      const ok = await this.impl.load(stems, opts);
      this.impl.setRate(this.speed);
      return ok;
    }
  }

  get duration() { return this.impl.duration; }
  get playing() { return this.impl.playing; }
  get stems() { return this.impl.stems; }
  get rate() { return this.speed; }
  setMaster(value) { this.master.gain.value = value; }
  setVolume(id, value) { this.impl.setVolume(id, value); }
  setRate(rate) { this.speed = rate; this.impl.setRate(rate); }
  currentTime() { return this.impl.currentTime(); }
  play() { return this.impl.play(); }
  pause() { this.impl.pause(); }
  seek(seconds) { this.impl.seek(seconds); }
  stop() { this.impl.stop(); }
}
