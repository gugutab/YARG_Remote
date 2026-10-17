// Metronome: short synthesized clicks on the song's beat grid (YARG: MetronomeVolume / MetronomeSound).
// The clicks are scheduled on the Web Audio clock a little ahead of time, so they stay on the beat at any playback speed,
// and they are rebuilt after a seek, a pause, a speed change or a loop. No audio files: every sound is an oscillator with a
// gain envelope. The pure helpers (beat window, click parameters, time mapping) are tested in Node; the class needs a context.

export const SOUNDS = ['click', 'woodblock', 'beep'];
export const LOOKAHEAD = 0.15; // seconds of audio time scheduled ahead
export const TICK_MS = 25; // how often the scheduler runs

// Index of the first beat with time >= t (beats are sorted by time).
export function firstBeatAtOrAfter(beats, t) {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The beats to click in [from, to) of song position (chart time + `delay`): [{ index, pos, accent }], never before `startIndex`.
// `accent` = first beat of a measure.
export function beatsInWindow(beats, delay, from, to, startIndex = 0) {
  const out = [];
  let i = Math.max(startIndex, firstBeatAtOrAfter(beats, from - delay));
  for (; i < beats.length; i++) {
    const pos = beats[i].time + delay;
    if (pos >= to) break;
    out.push({ index: i, pos, accent: !!beats[i].measure });
  }
  return out;
}

// Audio-context time at which song position `pos` is heard. `clock` = { pos, at, rate }: the position heard at audio time `at`.
export function ctxTimeFor(pos, clock) {
  return clock.at + (pos - clock.pos) / clock.rate;
}

// Oscillator parts of one click: [{ type, freq, gain }], the total length and the peak level.
export function clickParams(sound, accent) {
  const a = accent ? 1 : 0;
  switch (sound) {
    case 'woodblock':
      return { dur: 0.07, peak: accent ? 1 : 0.8, parts: [{ type: 'sine', freq: a ? 1000 : 800, gain: 1 }, { type: 'sine', freq: a ? 1580 : 1260, gain: 0.6 }] };
    case 'beep':
      return { dur: 0.07, peak: accent ? 0.45 : 0.32, parts: [{ type: 'square', freq: a ? 1320 : 880, gain: 1 }] };
    default: // click
      return { dur: 0.04, peak: accent ? 1 : 0.8, parts: [{ type: 'triangle', freq: a ? 1800 : 1200, gain: 1 }] };
  }
}

// 0-100 % -> output gain (a little curve, so the low half is usable).
export function levelGain(percent) {
  const v = Math.min(100, Math.max(0, Number(percent) || 0)) / 100;
  return v * v;
}

export class Metronome {
  // clock(): { playing, pos, at, rate } or null (see MultiTrackPlayer.metronomeClock); beats(): [{ time, measure }] ; delay(): chart delay in s
  constructor({ ctx, destination, clock, beats, delay = () => 0 }) {
    this.ctx = ctx;
    this.clock = clock;
    this.beats = beats;
    this.delay = delay;
    this.out = ctx.createGain();
    this.out.connect(destination);
    this.enabled = false;
    this.sound = 'click';
    this.timer = null;
    this.live = []; // scheduled clicks: { osc: [], at }
    this.reset();
    this.setVolume(50);
  }

  setVolume(percent) { this.out.gain.value = levelGain(percent); }
  setSound(sound) { this.sound = SOUNDS.includes(sound) ? sound : 'click'; }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (!this.enabled) { clearInterval(this.timer); this.timer = null; this.reset(); }
  }

  // Forget what was scheduled (a seek, a speed change, a new song): the next tick rebuilds it from the clock.
  reset() {
    const now = this.ctx.currentTime;
    for (const c of this.live) {
      if (c.at > now) for (const o of c.osc) { try { o.stop(); o.disconnect(); } catch { /* already ended */ } }
    }
    this.live = [];
    this.last = null;
    this.nextIndex = 0;
  }

  tick() {
    const c = this.enabled ? this.clock() : null;
    const beats = this.beats();
    if (!c || !c.playing || !beats?.length) { if (this.last || this.live.length) this.reset(); return; }
    const delay = this.delay();
    const prev = this.last;
    if (prev) {
      const expected = prev.pos + (c.at - prev.at) * c.rate;
      if (Math.abs(c.pos - expected) > 0.1 || c.rate !== prev.rate || delay !== prev.delay || beats !== prev.beats) this.reset();
    }
    this.last = { pos: c.pos, at: c.at, rate: c.rate, delay, beats };
    const now = this.ctx.currentTime;
    const from = c.pos + (now - c.at) * c.rate; // the song position being rendered now
    const to = from + LOOKAHEAD * c.rate;
    for (const b of beatsInWindow(beats, delay, from - 0.005 * c.rate, to, this.nextIndex)) {
      this.nextIndex = b.index + 1;
      this.click(Math.max(now, ctxTimeFor(b.pos, c)), b.accent);
    }
    this.live = this.live.filter((l) => l.at + 0.2 > now);
  }

  click(at, accent) {
    const p = clickParams(this.sound, accent);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(p.peak, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, at + p.dur);
    env.connect(this.out);
    const osc = [];
    for (const part of p.parts) {
      const o = this.ctx.createOscillator();
      o.type = part.type;
      o.frequency.value = part.freq;
      let node = o;
      if (part.gain !== 1) { node = this.ctx.createGain(); node.gain.value = part.gain; o.connect(node); }
      node.connect(env);
      o.start(at);
      o.stop(at + p.dur + 0.01);
      osc.push(o);
    }
    this.live.push({ osc, at });
  }
}
