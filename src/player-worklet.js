// AudioWorklet that plays all stems as one mixed, time-stretched stream (see mixstretch.js).
// It runs on the audio thread, so a busy page can no longer make a stem lose blocks and drift: every stem is
// read from a single position, and that position is reported back so the chart clock follows what is heard.
import { MixStretcher } from './mixstretch.js';
import { grainSrcAt, grainWeightAt } from './scrub.js';

const REPORT_EVERY = 4; // render quanta (128 frames) between position reports, about 12 ms

class MixProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new MixStretcher(sampleRate);
    this.playing = false;
    this.quanta = 0;
    this.wasEnded = false;
    this.scrub = null; // { from, to, dur, e }: a seek that rushes through the skipped stretch before playing on from `to`
    this.resumeFade = 0; // frames left of the fade-in after a scrub
    this.epoch = 0; // bumped by the main thread on load/seek; reports carry it so old ones can be ignored
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'load') {
        this.playing = false;
        this.epoch = m.epoch;
        this.core.setStems(m.stems);
        this.core.setRate(m.rate ?? 1);
      } else if (m.type === 'unload') { this.playing = false; this.core.setStems([]); // frees the audio
      } else if (m.type === 'gains') this.core.setGains(m.gains);
      else if (m.type === 'rate') this.core.setRate(m.rate);
      else if (m.type === 'seek') { this.finishScrub(false); this.core.seek(m.frame); this.epoch = m.epoch; this.wasEnded = false; }
      else if (m.type === 'scrub') {
        this.core.seek(m.to); // (the position the normal playback will resume from)
        this.scrub = { from: m.from, to: m.to, dur: Math.max(1, m.dur), e: 0 };
        this.epoch = m.epoch;
        this.wasEnded = false;
        this.playing = true;
      } else if (m.type === 'play') this.playing = true;
      else if (m.type === 'pause') { this.finishScrub(false); this.playing = false; }
    };
  }

  finishScrub(fade) {
    if (!this.scrub) return;
    this.core.seek(this.scrub.to);
    this.scrub = null;
    if (fade) this.resumeFade = 256;
  }

  // Mixes `m` frames of the scrub into left/right: overlapping grains read the stems at the swept position.
  renderScrub(left, right, m) {
    const s = this.scrub;
    const { stems, target } = this.core;
    const len = this.core.length;
    for (let i = 0; i < m; i++) {
      const e = s.e + i;
      let l = 0;
      let r = 0;
      for (let pass = 0; pass < 2; pass++) { // (the two overlapping grains; scalars only, nothing is allocated per frame)
        const gsrc = grainSrcAt(s.from, s.to, s.dur, e, pass);
        if (gsrc !== gsrc) continue; // NaN: no such grain
        const src = Math.floor(gsrc);
        if (src < 0 || src >= len) continue;
        let gl = 0;
        let gr = 0;
        for (let k = 0; k < stems.length; k++) {
          const gain = target[k];
          if (!gain || src >= stems[k].left.length) continue;
          gl += stems[k].left[src] * gain;
          gr += stems[k].right[src] * gain;
        }
        const w = grainWeightAt(e, pass);
        l += gl * w;
        r += gr * w;
      }
      const tail = Math.min(1, (s.dur - e) / 512); // the last few ms fade out, so the resumed playback does not click
      left[i] = l * tail;
      right[i] = r * tail;
    }
    s.e += m;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    if (!this.playing) {
      left.fill(0);
      if (out[1]) right.fill(0);
      return true;
    }
    const n = left.length;
    let done = 0; // frames of this block that came from a scrub
    if (this.scrub) {
      done = Math.min(n, this.scrub.dur - this.scrub.e);
      this.renderScrub(left, right, done);
      if (this.scrub.e >= this.scrub.dur) this.finishScrub(true);
      if (done === n) return true; // (no position reports while scrubbing: the main thread knows where it ends)
    }
    const frame = this.core.render(done ? left.subarray(done) : left, done ? right.subarray(done) : right, n - done);
    if (this.resumeFade > 0) {
      const f0 = this.resumeFade;
      const cnt = Math.min(n - done, f0);
      for (let i = 0; i < cnt; i++) { const g = 1 - (f0 - i) / 256; left[done + i] *= g; right[done + i] *= g; }
      this.resumeFade = f0 - cnt;
    }
    const ended = this.core.ended;
    if (++this.quanta >= REPORT_EVERY || (ended && !this.wasEnded)) {
      this.quanta = 0;
      // `frame` is the audible position at the end of this block, which plays at currentTime + n / sampleRate
      this.port.postMessage({ type: 'pos', frame, time: currentTime + n / sampleRate, ended, epoch: this.epoch });
    }
    if (ended) {
      this.wasEnded = true;
      this.playing = false;
    }
    return true;
  }
}

registerProcessor('yarg-mix', MixProcessor);
