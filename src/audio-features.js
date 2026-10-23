// What the visualizers hear: the music's spectrum reduced to a few numbers per frame. The player taps its mix before the master volume (an AnalyserNode: so the level does not
// depend on how loud the user plays it), the page hands the analyser's bytes to update() every frame and the visualizers read `driver.state.audio`:
//   on       the sound is playing (false while paused: every number is then 0)
//   level    the overall loudness, 0..1
//   bass / mid / treble   the loudness of the bands 20-160 Hz, 160-2000 Hz, 2000-12000 Hz, 0..1
//   (level, bass, mid and treble are relative to the last few seconds of the same song: a steady passage sits about 0.5 whatever the mix (a bass-heavy song would otherwise sit at 1
//   all the time) and a louder moment goes towards 1, a quieter one towards 0)
//   kick     a pulse (0..1) at every sudden rise of the bass, decaying in about 0.25 s: the drum hits
//   flux     the same for the whole spectrum (any onset: a snare, a chord)
//   bands    BANDS values 0..1, log-spaced from 30 Hz to 14 kHz, smoothed (fast attack, slow decay): a spectrum to draw bars from
// Pure: the bytes come in, numbers go out (test/audio-features.test.js).

export const BANDS = 48;
const LO_HZ = 30;
const HI_HZ = 14000;

// The first FFT bin of each of the `bands` log-spaced bands (and the bin after the last), for an fft of `fftSize` at `sampleRate`.
export function bandEdges(sampleRate, fftSize, bands = BANDS) {
  const bins = fftSize / 2;
  const hz = (b) => LO_HZ * (HI_HZ / LO_HZ) ** (b / bands);
  const edges = [];
  let prev = -1;
  for (let b = 0; b <= bands; b++) {
    let bin = Math.round((hz(b) * fftSize) / sampleRate);
    bin = Math.min(bins, Math.max(bin, prev + 1)); // (every band has at least one bin, even the low ones where bins are wider than the band)
    edges.push(bin);
    prev = bin;
  }
  return edges;
}

const hzToBin = (hz, sampleRate, fftSize) => Math.round((hz * fftSize) / sampleRate);

export function createAudioFeatures({ bands = BANDS } = {}) {
  const f = { on: false, level: 0, bass: 0, mid: 0, treble: 0, kick: 0, flux: 0, bands: new Float32Array(bands) };
  const prev = new Float32Array(bands);
  let edges = null;
  let edgesKey = '';
  let bassAvg = 0;
  let fluxAvg = 0;
  let last = null;
  const avg = { level: 0, bass: 0, mid: 0, treble: 0 }; // the recent loudness of each (a slow average, about 4 s)
  let primed = false;

  // bytes: the analyser's getByteFrequencyData (0..255 over its min/max decibels), or null when nothing plays. now: seconds (any clock).
  f.update = (bytes, sampleRate, fftSize, now) => {
    const dt = last === null ? 1 / 60 : Math.min(0.25, Math.max(0, now - last));
    if (last !== null && dt < 1e-4) return f; // (a second call in the same frame: motion blur samples, the prototype)
    last = now;
    if (!bytes || !(sampleRate > 0)) { // silence: everything falls away
      f.on = false;
      const fall = Math.exp(-dt * 6);
      f.level *= fall; f.bass *= fall; f.mid *= fall; f.treble *= fall; f.kick *= fall; f.flux *= fall;
      for (let i = 0; i < bands; i++) f.bands[i] *= fall;
      return f;
    }
    const key = `${sampleRate}|${fftSize}`;
    if (key !== edgesKey) { edges = bandEdges(sampleRate, fftSize, bands); edgesKey = key; }
    f.on = true;
    const att = 1 - Math.exp(-dt * 40), dec = 1 - Math.exp(-dt * 7);
    let flux = 0, bassFlux = 0, sum = 0;
    for (let b = 0; b < bands; b++) {
      let s = 0;
      const lo = edges[b], hi = Math.max(edges[b + 1], lo + 1);
      for (let i = lo; i < hi; i++) s += bytes[i];
      const raw = (s / (hi - lo)) / 255;
      const v = raw * raw * (3 - 2 * raw) * 0.4 + raw * 0.6; // (a soft knee: quiet details lift a little, loud ones do not clip)
      const rise = v - prev[b];
      if (rise > 0) { flux += rise; if (b < 10) bassFlux += rise; }
      prev[b] = v;
      f.bands[b] += (v - f.bands[b]) * (v > f.bands[b] ? att : dec);
      sum += v;
    }
    const band = (lo, hi) => {
      const a = Math.max(1, hzToBin(lo, sampleRate, fftSize)), z = Math.max(a + 1, hzToBin(hi, sampleRate, fftSize));
      let s = 0;
      for (let i = a; i < z; i++) s += bytes[i];
      return Math.min(1, ((s / (z - a)) / 255) * 1.25);
    };
    const target = { bass: band(20, 160), mid: band(160, 2000), treble: band(2000, 12000) };
    target.level = Math.min(1, (sum / bands) * 1.6);
    const slow = 1 - Math.exp(-dt / 4);
    for (const k of ['level', 'bass', 'mid', 'treble']) {
      if (!primed) avg[k] = target[k];
      else avg[k] += (target[k] - avg[k]) * slow;
      const rel = Math.min(1, (0.5 * target[k]) / Math.max(avg[k], 0.12)); // (0.5 when it is as loud as lately)
      f[k] += (rel - f[k]) * (rel > f[k] ? att : dec);
    }
    primed = true;
    // onsets: the rise of the bass (or of everything) against its recent average
    bassAvg += (bassFlux - bassAvg) * (1 - Math.exp(-dt * 3));
    fluxAvg += (flux - fluxAvg) * (1 - Math.exp(-dt * 3));
    const kk = Math.max(0, bassFlux - bassAvg * 1.6 - 0.03) * 4, ff = Math.max(0, flux - fluxAvg * 1.6 - 0.05) * 1.6;
    f.kick = Math.max(f.kick * Math.exp(-dt * 9), Math.min(1, kk));
    f.flux = Math.max(f.flux * Math.exp(-dt * 9), Math.min(1, ff));
    return f;
  };
  f.reset = () => { last = null; primed = false; avg.level = avg.bass = avg.mid = avg.treble = 0; f.on = false; f.level = f.bass = f.mid = f.treble = f.kick = f.flux = 0; f.bands.fill(0); prev.fill(0); bassAvg = fluxAvg = 0; };
  return f;
}
