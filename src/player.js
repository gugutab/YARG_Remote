// Multitrack player: every stem is decoded into an AudioBuffer and played through its own GainNode,
// so all stems share one AudioContext clock (sample-accurate sync, per-track volume, seek, pause).
export class MultiTrackPlayer {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.stems = new Map(); // id -> { label, buffer, gain }
    this.sources = [];
    this.duration = 0;
    this.playing = false;
    this.offset = 0; // position (s) when paused / at last start
    this.startedAt = 0; // ctx.currentTime when the last play started
  }

  // stems: [{ id, label, getFile }]
  async load(stems, onProgress = () => {}) {
    this.stop();
    this.stems.clear();
    let done = 0;
    for (const s of stems) {
      const file = await s.getFile();
      const data = await file.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data);
      const gain = this.ctx.createGain();
      gain.connect(this.master);
      this.stems.set(s.id, { label: s.label, buffer, gain, volume: 1 });
      onProgress(++done / stems.length);
    }
    this.duration = Math.max(0, ...[...this.stems.values()].map((s) => s.buffer.duration));
    this.offset = 0;
  }

  setVolume(id, value) {
    const stem = this.stems.get(id);
    if (!stem) return;
    stem.volume = value;
    stem.gain.gain.value = value;
  }

  currentTime() {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.offset + (this.ctx.currentTime - this.startedAt));
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
    const when = this.ctx.currentTime + 0.05; // small lead so every source starts on the same tick
    for (const stem of this.stems.values()) {
      if (at >= stem.buffer.duration) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = stem.buffer;
      src.connect(stem.gain);
      src.start(when, at);
      this.sources.push(src);
    }
    this.offset = at;
    this.startedAt = when;
    this.playing = true;
  }

  stopSources() {
    for (const src of this.sources) {
      try { src.stop(); } catch (_) { /* already stopped */ }
      src.disconnect();
    }
    this.sources = [];
    this.playing = false;
  }
}
