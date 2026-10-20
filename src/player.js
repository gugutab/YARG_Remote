// Multitrack player. Every stem is decoded, aligned to the chart clock, and handed to one AudioWorklet that mixes
// them into a single stream and time-stretches it once (pitch preserved). A single read position means the stems
// cannot drift apart, and the worklet reports that position back, so `currentTime()` (the chart clock) follows what
// is actually heard. If AudioWorklet is unavailable, LegacyPlayer (one ScriptProcessor per stem) takes over.
//
// Timeline: `currentTime()` is the chart clock. The audio file position for chart time t is t + delay
// (YARG: SongRunner.AudioTime = AudioPlaybackTime + SongOffset, with SongOffset = -delay).
// load() shifts each stem by the delay once, so chart time 0 is sample 0 of the aligned stem.
import { PitchShifter } from '../vendor/soundtouch.js';
import { positionAt, jumpHistory, trimHistory, suspendDue, settlesWithin, SUSPEND_AFTER_MS, RESUME_TIMEOUT_MS } from './clock.js';
import { decodeAll, createBudget, withBudget, estimateDecodedBytes, DECODE_BUDGET_BYTES } from './stemdecode.js';

export const WORKLET_START_MS = 6000; // how long the audio worklet may take to start before the legacy engine is used
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

// alignChannel without the copy when there is nothing to shift (the delay rounds to 0 samples, the usual case): the decoded array itself (it owns its
// whole buffer, so it can be transferred to the worklet). Halves the peak memory of a decode.
export function alignOrKeep(src, sampleRate, delay) {
  const shift = Math.round(Math.abs(delay) * sampleRate);
  if (!shift && src.length > 0 && src.byteOffset === 0 && src.byteLength === src.buffer.byteLength) return src;
  return alignChannel(src, sampleRate, delay);
}

// True when the two channels hold the same samples (a stereo file with a mono signal): such a stem keeps one channel, which the mixer plays on
// both sides (mixstretch.js `right: ch[1] || ch[0]`), so the output is bit-identical with half the memory.
export function sameChannels(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const decodeBudget = createBudget(DECODE_BUDGET_BYTES); // (shared by every load: see stemdecode.js)


// Suspends the AudioContext after the player has been paused for SUSPEND_AFTER_MS (it releases the device and stops the worklet
// from rendering silence), and brings it back for play(). The chart clock does not depend on the context while paused (it is the
// stored offset), and every start re-anchors on `ctx.currentTime` after the resume, so nothing drifts.
export class AudioIdle {
  constructor(ctx, afterMs = SUSPEND_AFTER_MS) {
    this.ctx = ctx;
    this.afterMs = afterMs;
    this.timer = null;
    this.pausedSince = null;
    this.pending = null; // a suspend() in flight
  }

  arm() { // the player just paused (or has nothing loaded)
    this.cancel();
    if (typeof this.ctx.suspend !== 'function') return;
    this.pausedSince = performance.now();
    this.timer = setTimeout(() => this.fire(), this.afterMs);
    this.timer.unref?.();
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pausedSince = null;
  }

  fire() {
    const since = this.pausedSince;
    this.timer = null;
    if (this.ctx.state === 'running' && suspendDue(false, since, performance.now(), this.afterMs)) {
      this.pending = Promise.resolve(this.ctx.suspend()).catch(() => {}).then(() => { this.pending = null; });
    }
  }

  // The context is running (resumed if it was suspended)? false when the browser would not resume it within the timeout (no user gesture).
  async ensureRunning() {
    this.cancel();
    if (this.pending) await this.pending; // (a suspend in flight must finish first, or it would stop the audio just started)
    if (this.ctx.state !== 'suspended') return true;
    return settlesWithin(this.ctx.resume(), RESUME_TIMEOUT_MS);
  }
}

// Old engine, kept as a fallback: one PitchShifter (ScriptProcessorNode) per stem.
export class LegacyPlayer {
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
    this.idle = new AudioIdle(ctx);
  }

  // stems: [{ id, label, getFile }]; delay in seconds (see songDelaySeconds)
  async load(stems, { delay = 0, onProgress = () => {} } = {}) {
    this.stop();
    this.unload();
    const generation = ++this.loadGeneration;
    const result = await decodeAll(stems, async (s) => {
      const file = await s.getFile();
      const data = await file.arrayBuffer();
      return withBudget(decodeBudget, estimateDecodedBytes(data), async () => this.alignBuffer(await this.ctx.decodeAudioData(data), delay));
    }, onProgress, () => generation !== this.loadGeneration); // (a newer load() took over: stop)
    if (!result) return false;
    this.failedStems = result.failed;
    const loaded = new Map();
    for (const { stem: s, value: buffer } of result.ok) {
      const gain = this.ctx.createGain();
      gain.connect(this.master);
      loaded.set(s.id, { label: s.label, buffer, gain, volume: 1 });
    }
    this.stems = loaded;
    this.duration = Math.max(0, ...[...loaded.values()].map((s) => s.buffer.duration));
    this.offset = 0;
    return true;
  }

  alignBuffer(decoded, delay) {
    const sr = decoded.sampleRate;
    if (!Math.round(Math.abs(delay) * sr)) return decoded; // (nothing to shift: no copy)
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

  // For the metronome: the song position heard at audio time `at` (see metronome.js).
  metronomeClock() {
    return { playing: this.playing, pos: this.currentTime(), at: this.ctx.currentTime, rate: this.rate };
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
    if (!(await this.idle.ensureRunning()) || this.playing) return; // (not resumed in time: stay paused rather than start much later)
    if (this.offset >= this.duration - 0.05) this.offset = 0; // at (or within 50 ms of) the end: start over
    this.startSources(this.offset);
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime();
    this.stopSources();
    this.idle.arm();
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
    this.idle.arm();
  }

  unload() { // frees the decoded buffers (and drops a load still decoding: it must not install its stems afterwards)
    this.loadGeneration++;
    this.stems = new Map();
    this.duration = 0;
    this.offset = 0;
    if (!this.playing) this.idle.arm();
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
    this.setupDone = null; // promise of the worklet module and node
    this.ids = []; // stem ids, in the order the worklet knows them
    this.volumes = new Map();
    this.duration = 0;
    this.rate = 1;
    this.playing = false;
    this.offset = 0; // chart position (s) when paused
    this.history = []; // recent { time, pos } reports from the worklet (audio time and source seconds)
    this.epoch = 0; // bumped on load/seek: reports from before are ignored
    this.scrub = null; // { to, end }: a seek that is rushing through the skipped stretch; `end` is the audio time it ends at
    this.stems = new Map(); // id -> true (the app only checks that stems exist)
    this.idle = new AudioIdle(ctx);
  }

  // Loads the worklet module and creates its node once, even if load() is called again meanwhile.
  setup() {
    this.setupDone ||= (async () => {
      if (!this.ctx.audioWorklet) throw Object.assign(new Error('AudioWorklet unavailable'), { workletUnavailable: true });
      try {
        // Chrome can leave addModule pending forever (the audio worklet thread never starts): that looked like a load screen stuck at 2%
        // with nothing in the console. After WORKLET_START_MS the worklet engine is given up and the legacy player takes over.
        let timer;
        const giveUp = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`The audio worklet did not start in ${WORKLET_START_MS / 1000} s`)), WORKLET_START_MS); });
        try {
          await Promise.race([this.ctx.audioWorklet.addModule(new URL('./player-worklet.js', import.meta.url)), giveUp]);
        } finally {
          clearTimeout(timer);
        }
        this.node = new AudioWorkletNode(this.ctx, 'yarg-mix', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      } catch (err) {
        throw Object.assign(err, { workletUnavailable: true });
      }
      this.node.connect(this.master);
      this.node.port.onmessage = (e) => {
        const m = e.data;
        if (m.type !== 'pos' || m.epoch !== this.epoch) return;
        this.history.push({ time: m.time, pos: m.frame / this.ctx.sampleRate });
        trimHistory(this.history);
      };
    })();
    return this.setupDone;
  }

  // stems: [{ id, label, getFile }]; delay in seconds (see songDelaySeconds)
  // `first`: ids of the stems to decode first; the sound is ready when they are, and the others are added while it plays (`onLate` is called then).
  async load(stems, { delay = 0, onProgress = () => {}, first = [] } = {}) {
    const generation = (this.generation = (this.generation || 0) + 1); // (taken before any await: an unload() while the setup runs also supersedes this load)
    await this.setup();
    if (generation !== this.generation) return false;
    this.stop();
    this.unload(); // the previous song's audio goes before the new one is decoded: the peak is one song, not two
    this.generation = generation; // (unload() bumps it; this load is the current one)
    this.wanted = new Map();
    const decodeOne = async (s) => {
      const file = await s.getFile();
      const data = await file.arrayBuffer();
      return withBudget(decodeBudget, estimateDecodedBytes(data), async () => {
        const decoded = await this.ctx.decodeAudioData(data);
        if (!decoded.numberOfChannels) throw new Error('No audio channels');
        const left = decoded.getChannelData(0);
        const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
        const channels = [alignOrKeep(left, decoded.sampleRate, delay)];
        if (right && !sameChannels(left, right)) channels.push(alignOrKeep(right, decoded.sampleRate, delay)); // (a mono signal in stereo keeps one channel)
        return channels;
      });
    };
    const head = first.length ? stems.filter((s) => first.includes(s.id)) : stems;
    const tail = head.length && head.length < stems.length ? stems.filter((s) => !head.includes(s)) : [];
    const result = await decodeAll(tail.length ? head : stems, decodeOne, onProgress, () => generation !== this.generation); // (a newer load() took over: stop)
    if (!result || generation !== this.generation) return false;
    this.failedStems = result.failed;
    // only the stems that decoded reach the worklet, in this order
    const aligned = result.ok.map((o) => o.value);
    const ids = result.ok.map((o) => o.stem.id);
    this.ids = ids;
    this.stems = new Map(ids.map((id) => [id, true]));
    this.volumes = new Map(ids.map((id) => [id, 1]));
    this.duration = aligned.reduce((m, ch) => Math.max(m, ch[0].length / this.ctx.sampleRate), 0);
    this.offset = 0;
    // the arrays are moved, not copied: the worklet owns the audio from here on
    const transfer = aligned.flatMap((ch) => ch.map((a) => a.buffer));
    this.epoch++;
    this.history = [];
    this.node.port.postMessage({ type: 'load', stems: aligned, rate: this.rate, epoch: this.epoch }, transfer);
    this.postGains();
    if (tail.length) this.loadLate(tail, decodeOne, generation);
    return true;
  }

  // The stems that were not needed to start: decoded now and added to the running mix (a failed one is reported like a failed stem).
  async loadLate(tail, decodeOne, generation) {
    let result = null;
    try {
      result = await decodeAll(tail, decodeOne, () => {}, () => generation !== this.generation);
    } catch (err) {
      if (generation !== this.generation) return;
      this.failedStems = [...this.failedStems, ...(err.failedStems || [])];
      this.onLate?.();
      return;
    }
    if (!result || generation !== this.generation) return;
    this.failedStems = [...this.failedStems, ...result.failed];
    if (result.ok.length) {
      const aligned = result.ok.map((o) => o.value);
      for (const o of result.ok) {
        this.ids.push(o.stem.id);
        this.stems.set(o.stem.id, true);
        this.volumes.set(o.stem.id, this.wanted.get(o.stem.id) ?? 1);
      }
      this.duration = Math.max(this.duration, ...aligned.map((ch) => ch[0].length / this.ctx.sampleRate));
      this.node.port.postMessage({ type: 'add', stems: aligned }, aligned.flatMap((ch) => ch.map((a) => a.buffer)));
      this.postGains();
    }
    this.onLate?.();
  }

  postGains() {
    this.node?.port.postMessage({ type: 'gains', gains: this.ids.map((id) => this.volumes.get(id) ?? 1) });
  }

  setVolume(id, value) {
    (this.wanted ||= new Map()).set(id, value); // (a stem that is still decoding gets it when it joins)
    if (!this.volumes.has(id)) return;
    this.volumes.set(id, value);
    this.postGains();
  }

  // How long the sound takes to reach the speakers; the chart clock is shifted back by it to match what is heard.
  get outputLatency() {
    const l = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return Math.min(l, 0.3);
  }

  // The chart clock: the source position being heard right now. That is the position at audio time
  // `ctx.currentTime - outputLatency`, read from the worklet's recent reports (see clock.js).
  currentTime() {
    if (!this.playing) { this.smooth = null; return this.offset; }
    const raw = this.rawTime();
    if (this.scrub) { this.smooth = null; return raw; } // (during a scrub the clock is already the target)
    // The audio clock only moves in steps (the worklet reports every ~12 ms, ctx.currentTime moves in audio blocks), which made the
    // notes advance unevenly even at a high frame rate. So the time runs on the real clock between frames and is pulled gently
    // towards the audio position (time constant 0.15 s); a bigger gap (a seek, a speed change) snaps.
    const now = this.frameNow ?? performance.now(); // the animation frame's own timestamp when the page gives it: it is steadier than a clock read in the callback
    const sm = this.smooth;
    if (!sm || Math.abs(raw - sm.t) > 0.1 || now < sm.at) { this.smooth = { t: raw, at: now }; return raw; }
    const dt = (now - sm.at) / 1000;
    let t = sm.t + dt * this.rate;
    t += (raw - t) * (1 - Math.exp(-dt / 0.15));
    this.smooth = { t, at: now };
    return Math.min(this.duration, Math.max(0, t));
  }

  rawTime() {
    const heardAt = this.ctx.currentTime - this.outputLatency;
    if (this.scrub) { // the chart goes to the target at once (its own animation travels there); the sound catches up when the scrub ends
      if (heardAt < this.scrub.end) return this.scrub.to;
      this.scrub = null;
    }
    return Math.min(this.duration, Math.max(0, positionAt(this.history, heardAt, this.rate)));
  }

  // For the metronome: the song position heard at audio time `at` (the sound reaches the speakers outputLatency after it is rendered,
  // so the position being heard now is the one at ctx.currentTime - outputLatency). Not while a seek is rushing (the sound is skipping).
  metronomeClock() {
    if (!this.playing) return { playing: false };
    const pos = this.rawTime();
    if (this.scrub) return { playing: false };
    return { playing: true, pos, at: this.ctx.currentTime - this.outputLatency, rate: this.rate };
  }

  setRate(rate) {
    this.rate = rate; // the history already holds exact positions from before the change
    this.node?.port.postMessage({ type: 'rate', rate });
  }

  async play() {
    if (this.playing || !this.ids.length) return;
    if (!(await this.idle.ensureRunning()) || this.playing) return; // (not resumed in time: stay paused rather than start much later)
    if (this.offset >= this.duration - 0.05) this.offset = 0; // at (or within 50 ms of) the end: start over
    this.startAt(this.offset);
  }

  // heard: keep the clock on the old audio until the new start is heard (jumpHistory); else the clock jumps at once.
  startAt(seconds, heard = false) {
    const frame = Math.round(seconds * this.ctx.sampleRate);
    this.epoch++;
    if (!heard) this.smooth = null; // (heard: the smoothing snaps by itself when the jump is reached)
    const keep = heard && this.playing;
    this.pendingJump = keep ? { at: this.ctx.currentTime, pos: seconds } : null;
    this.history = keep ? jumpHistory(this.history, this.ctx.currentTime, this.rate, seconds)
      : [{ time: this.ctx.currentTime, pos: seconds }]; // until the worklet reports for real
    this.node.port.postMessage({ type: 'seek', frame, epoch: this.epoch });
    this.node.port.postMessage({ type: 'play' });
    this.offset = seconds;
    this.playing = true;
  }

  // A heard seek whose new start is not heard yet (the chart clock still runs on the old audio).
  get jumpPending() {
    const j = this.pendingJump;
    return !!(j && this.playing && this.ctx.currentTime - this.outputLatency < j.at);
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.jumpPending ? this.pendingJump.pos : this.currentTime(); // (paused before a loop wrap is heard: resume from the new start)
    this.pendingJump = null;
    this.scrub = null;
    this.node.port.postMessage({ type: 'pause' });
    this.playing = false;
    this.idle.arm();
  }

  // A seek while playing that takes `ms`: the audio rushes through the skipped stretch (see scrub.js), then plays on from the target.
  scrubTo(seconds, ms) {
    const to = Math.max(0, Math.min(this.duration, seconds));
    if (!this.playing || !(ms > 0)) { this.seek(to); return; }
    const from = this.currentTime();
    const dur = Math.round((ms / 1000) * this.ctx.sampleRate);
    this.epoch++;
    this.smooth = null;
    this.scrub = { to, end: this.ctx.currentTime + ms / 1000 };
    this.pendingJump = null;
    this.history = [{ time: this.scrub.end, pos: to }]; // until the worklet reports for real after the scrub
    this.offset = to;
    this.node.port.postMessage({ type: 'scrub', from: Math.round(from * this.ctx.sampleRate), to: Math.round(to * this.ctx.sampleRate), dur, epoch: this.epoch });
  }

  // { heard: true }: the chart clock keeps following the audio already on its way to the speakers and jumps when the new
  // start is heard (the loop wrap); otherwise it jumps at once.
  seek(seconds, { heard = false } = {}) {
    const t = Math.max(0, Math.min(this.duration, seconds));
    const wasScrub = this.scrub;
    this.scrub = null;
    if (this.playing) this.startAt(t, heard && !wasScrub);
    else {
      this.offset = t;
      this.pendingJump = null;
      this.epoch++;
      this.history = [];
      this.node?.port.postMessage({ type: 'seek', frame: Math.round(t * this.ctx.sampleRate), epoch: this.epoch });
    }
  }

  stop() {
    this.node?.port.postMessage({ type: 'pause' });
    this.playing = false;
    this.offset = 0;
    this.idle.arm();
  }

  // Frees the decoded audio (the worklet holds all the stems as Float32 arrays: tens of MB per song).
  unload() {
    this.generation = (this.generation || 0) + 1; // a load still decoding is superseded
    this.node?.port.postMessage({ type: 'unload' });
    this.stems = new Map();
    this.ids = [];
    this.volumes = new Map();
    this.duration = 0;
    this.offset = 0; // no audio, no position: the next song starts at 0
    this.epoch++;
    this.history = [];
    if (!this.playing) this.idle.arm();
  }
}

// What the app uses: the worklet engine, or the legacy one when AudioWorklet cannot be set up.
export class MultiTrackPlayer {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.impl = new WorkletPlayer(this.ctx, this.master);
    this.impl.onLate = () => this.onLate?.(); // late stems joined (or failed): the app refreshes its stem states
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

  set frameNow(ms) { this.impl.frameNow = ms; }
  get duration() { return this.impl.duration; }
  get playing() { return this.impl.playing; }
  get stems() { return this.impl.stems; }
  get failedStems() { return this.impl.failedStems || []; } // [{ id, label, error }] of the last load()
  get rate() { return this.speed; }
  get outputLatency() { return this.impl.outputLatency || 0; } // seconds until the sound is heard (worklet engine)
  get jumpPending() { return !!this.impl.jumpPending; } // a seek(t, { heard: true }) not heard yet
  setMaster(value) { this.master.gain.value = value; }
  setVolume(id, value) { this.impl.setVolume(id, value); }
  setRate(rate) { this.speed = rate; this.impl.setRate(rate); }
  currentTime() { return this.impl.currentTime(); }
  metronomeClock() { return this.impl.metronomeClock(); }
  play() { return this.impl.play(); }
  pause() { this.impl.pause(); }
  seek(seconds, opts) { this.onSeek?.(); this.impl.seek(seconds, opts); } // onSeek: set by the app (any seek leaves the "ended" state)
  scrubTo(seconds, ms) { this.onSeek?.(); if (this.impl.scrubTo) this.impl.scrubTo(seconds, ms); else this.impl.seek(seconds); } // (the legacy engine just cuts)
  stop() { this.impl.stop(); }
  unload() { this.impl.unload(); } // frees the decoded audio (a song change, before its audio loads)
}
