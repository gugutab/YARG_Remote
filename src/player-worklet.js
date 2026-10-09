// AudioWorklet that plays all stems as one mixed, time-stretched stream (see mixstretch.js).
// It runs on the audio thread, so a busy page can no longer make a stem lose blocks and drift: every stem is
// read from a single position, and that position is reported back so the chart clock follows what is heard.
import { MixStretcher } from './mixstretch.js';

const REPORT_EVERY = 4; // render quanta (128 frames) between position reports, about 12 ms

class MixProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new MixStretcher(sampleRate);
    this.playing = false;
    this.quanta = 0;
    this.wasEnded = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'load') {
        this.playing = false;
        this.core.setStems(m.stems);
        this.core.setRate(m.rate ?? 1);
      } else if (m.type === 'gains') this.core.setGains(m.gains);
      else if (m.type === 'rate') this.core.setRate(m.rate);
      else if (m.type === 'seek') { this.core.seek(m.frame); this.wasEnded = false; }
      else if (m.type === 'play') this.playing = true;
      else if (m.type === 'pause') this.playing = false;
    };
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
    const frame = this.core.render(left, right, n);
    const ended = this.core.ended;
    if (++this.quanta >= REPORT_EVERY || (ended && !this.wasEnded)) {
      this.quanta = 0;
      // `frame` is the audible position at the end of this block, which plays at currentTime + n / sampleRate
      this.port.postMessage({ type: 'pos', frame, time: currentTime + n / sampleRate, ended });
    }
    if (ended) {
      this.wasEnded = true;
      this.playing = false;
    }
    return true;
  }
}

registerProcessor('yarg-mix', MixProcessor);
