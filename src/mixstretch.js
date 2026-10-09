// Mixes every stem into one stereo stream and time-stretches that stream once (SoundTouch, pitch preserved).
// Because all stems are summed before any processing, they cannot drift apart from each other: there is a
// single read position. This core is plain JS (no Web Audio objects), so it runs inside an AudioWorklet
// (see player-worklet.js) and can be tested in Node.
import { SoundTouch } from '../vendor/soundtouch.js';

const FEED = 512; // source frames mixed and handed to SoundTouch per step
const TAIL = FEED * 16; // silence fed after the end so SoundTouch can flush what it still holds

export class MixStretcher {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.stems = []; // { left, right } Float32Arrays, already aligned to the chart clock
    this.target = new Float32Array(0); // stem gains asked for
    this.current = new Float32Array(0); // stem gains reached so far (ramped per step to avoid clicks)
    this.length = 0; // frames of the longest stem
    this.pos = 0; // next source frame to be mixed
    this.rate = 1;
    this.st = new SoundTouch();
    this.st.tempo = 1;
    this.buf = new Float32Array(FEED * 2); // interleaved scratch
    this.oldOut = 0; // frames still in the output buffer that were made at oldRate (they drain first)
    this.oldRate = 1;
  }

  // channels: array of stems, each an array of 1 or 2 Float32Arrays
  setStems(channels) {
    this.stems = channels.map((ch) => ({ left: ch[0], right: ch[1] || ch[0] }));
    this.length = this.stems.reduce((m, s) => Math.max(m, s.left.length), 0);
    this.target = new Float32Array(this.stems.length).fill(1);
    this.current = Float32Array.from(this.target);
    this.seek(0);
  }

  setGains(gains) {
    for (let i = 0; i < this.target.length; i++) this.target[i] = gains[i] ?? 1;
  }

  setRate(rate) {
    rate = Math.min(4, Math.max(0.1, rate));
    if (rate === this.rate) return;
    const enteringBypass = rate === 1 && this.rate !== 1;
    if (enteringBypass) {
      // leave the stretcher: continue from where the listener is, dropping what it still buffered
      this.pos = Math.round(this.audiblePosition());
      this.st.clear();
      this.oldOut = 0;
    }
    if (!enteringBypass && this.rate !== 1) {
      // what is already stretched keeps mapping back at the speed it was produced with
      this.oldOut = this.st.outputBuffer.frameCount;
      this.oldRate = this.rate;
    }
    this.rate = rate;
    this.st.tempo = rate;
  }

  seek(frame) {
    this.pos = Math.max(0, Math.min(this.length, Math.round(frame)));
    this.st.clear();
    this.oldOut = 0;
  }

  // Source position (in frames) of the sample the listener hears next. In stretch mode the frames still held in
  // SoundTouch's buffers have been read but not played yet; the ones in the output buffer map back at `rate`.
  audiblePosition() {
    if (this.rate === 1) return this.pos;
    const st = this.st;
    const out = st.outputBuffer.frameCount;
    const old = Math.min(this.oldOut, out);
    const held = st.inputBuffer.frameCount + st._intermediateBuffer.frameCount + old * this.oldRate + (out - old) * this.rate;
    return Math.max(0, this.pos - held);
  }

  get ended() {
    return this.audiblePosition() >= this.length;
  }

  // Sums the stems for source frames [start, start + n) into this.buf (interleaved), ramping the gains.
  mixStep(start, n) {
    const buf = this.buf;
    buf.fill(0, 0, n * 2);
    for (let i = 0; i < this.stems.length; i++) {
      const g0 = this.current[i];
      const g1 = this.target[i];
      this.current[i] = g1;
      if (g0 === 0 && g1 === 0) continue;
      const { left, right } = this.stems[i];
      const end = Math.min(n, left.length - start);
      const step = (g1 - g0) / n;
      for (let j = 0; j < end; j++) {
        const g = g0 + step * j;
        buf[2 * j] += left[start + j] * g;
        buf[2 * j + 1] += right[start + j] * g;
      }
    }
  }

  // Fills outL/outR with n frames. Returns the audible source position (frames) after this block.
  render(outL, outR, n) {
    let written = 0;
    if (this.rate === 1) {
      while (written < n) {
        const m = Math.min(FEED, n - written);
        if (this.pos >= this.length) break;
        this.mixStep(this.pos, m);
        for (let j = 0; j < m; j++) {
          outL[written + j] = this.buf[2 * j];
          outR[written + j] = this.buf[2 * j + 1];
        }
        this.pos += m;
        written += m;
      }
    } else {
      const st = this.st;
      while (st.outputBuffer.frameCount < n && this.pos < this.length + TAIL) {
        this.mixStep(this.pos, FEED);
        st.inputBuffer.putSamples(this.buf, 0, FEED);
        st.process();
        this.pos += FEED;
      }
      const got = Math.min(n, st.outputBuffer.frameCount);
      const out = new Float32Array(got * 2);
      st.outputBuffer.receiveSamples(out, got);
      this.oldOut = Math.max(0, this.oldOut - got);
      for (let j = 0; j < got; j++) {
        outL[j] = out[2 * j];
        outR[j] = out[2 * j + 1];
      }
      written = got;
    }
    outL.fill(0, written, n);
    outR.fill(0, written, n);
    return this.audiblePosition();
  }
}
