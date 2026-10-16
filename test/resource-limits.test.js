// Resource-exhaustion limits on hostile input: the beat grid, .chart files, .sng headers, the server's scan and cache,
// the library scan and the route hash. Synthetic inputs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseMidi, MAX_TICK, MIN_DIVISION } from '../src/midi.js';
import { parseChart, MAX_CHART_BYTES } from '../src/chartfile.js';
import { buildChart, generateBeats, MAX_BEATS, INSTRUMENTS, DIFFICULTIES } from '../src/chart.js';
import { parseSng, bufferSource } from '../src/sng.js';
import { createServer, scanLibrary, validIndex } from '../server.mjs';
import { writeSng } from './sng-writer.js';
import { buildMidi, tempo120, trackName, on, off } from './smf.js';

const GUITAR = INSTRUMENTS.find((i) => i.id === 'guitar');
const EXPERT = DIFFICULTIES[3];

function guitarMidi(division, tick) {
  return parseMidi(buildMidi(division, [[tempo120(), { dt: 0, bytes: trackName('PART GUITAR') }, on(tick, 96), off(10, 96)]]));
}

// --- 1. beat grid -----------------------------------------------------------------------------------------------

test('a note at a huge tick in a tiny-division file cannot generate billions of beats', () => {
  const started = Date.now();
  const midi = guitarMidi(MIN_DIVISION, 2e8); // one 4-byte delta: ~8M beats without the cap
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.ok(chart.beats.length <= MAX_BEATS, `${chart.beats.length} beats`);
  assert.ok(chart.beats.length > 0);
  assert.ok(Date.now() - started < 3000, 'finished quickly');
});

test('generateBeats stops at MAX_BEATS across time signature changes', () => {
  const midi = { division: MIN_DIVISION, tracks: [{ notes: [{ endTick: 2 ** 31 }], texts: [] }], timeSignatures: [{ tick: 0, num: 4, den: 4 }, { tick: 1e9, num: 3, den: 8 }] };
  assert.equal(generateBeats(midi, (t) => t / 100).length, MAX_BEATS);
});

test('a real-sized song keeps its whole beat grid', () => {
  const midi = guitarMidi(480, 480 * 4 * 100); // 100 bars at 480
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.equal(chart.beats.length, 401); // a line per beat through the last note (+1 tick): bars 0..100
  assert.equal(chart.beats.filter((b) => b.measure).length, 101);
});

test('a division below the minimum is rejected, the minimum and common ones are accepted', () => {
  for (const d of [1, 2, 23]) assert.throws(() => guitarMidi(d, 0), /Invalid MIDI.*division/);
  for (const d of [MIN_DIVISION, 96, 192, 480, 960, 1920]) assert.doesNotThrow(() => guitarMidi(d, 0));
});

test('an event past MAX_TICK is rejected (sum of legal deltas)', () => {
  const events = [tempo120()];
  for (let i = 0; i < 12; i++) events.push(on(2e8, 60), off(0, 60)); // 12 * 2e8 = 2.4e9 > 2^31
  assert.ok(12 * 2e8 > MAX_TICK);
  assert.throws(() => parseMidi(buildMidi(480, [events])), /Invalid MIDI.*tick/);
});

// --- 2. .chart --------------------------------------------------------------------------------------------------

const chartText = ({ resolution = 192, sync = '  0 = TS 4\n  0 = B 120000', guitar = '  0 = N 0 0' } = {}) =>
  `[Song]\n{\n  Resolution = ${resolution}\n}\n[SyncTrack]\n{\n${sync}\n}\n[ExpertSingle]\n{\n${guitar}\n}\n`;

test('.chart: a resolution below the minimum or above 65535 is an error; 0 falls back to the default', () => {
  assert.throws(() => parseChart(chartText({ resolution: 1 })), /Resolution 1 is outside/);
  assert.throws(() => parseChart(chartText({ resolution: 70000 })), /Resolution/);
  assert.equal(parseChart(chartText({ resolution: 0 })).division, 192);
  assert.equal(parseChart(chartText({ resolution: 960 })).division, 960);
});

test('.chart: a tick of 9999999999 is ignored, the rest of the song still loads', () => {
  const midi = parseChart(chartText({ guitar: '  0 = N 0 0\n  9999999999 = N 1 0\n  192 = N 2 0' }));
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.equal(chart.notes.length, 2);
  assert.ok(Number.isFinite(chart.duration));
  assert.ok(chart.beats.length < 100);
});

test('.chart: a 400-digit tick (Infinity) and a tick just past MAX_TICK are ignored', () => {
  const midi = parseChart(chartText({ guitar: `  0 = N 0 0\n  ${'9'.repeat(400)} = N 1 0\n  ${MAX_TICK + 1} = N 2 0\n  ${MAX_TICK} = N 3 0` }));
  const ticks = midi.tracks.find((t) => t.name === 'PART GUITAR').notes.map((n) => n.tick);
  assert.deepEqual(ticks, [0, MAX_TICK]);
});

test('.chart: a note at MAX_TICK with the minimum resolution cannot hang the beat grid', () => {
  const started = Date.now();
  const chart = buildChart(parseChart(chartText({ resolution: MIN_DIVISION, guitar: `  ${MAX_TICK} = N 0 0` })), GUITAR, EXPERT);
  assert.ok(chart.beats.length <= MAX_BEATS);
  assert.ok(Number.isFinite(chart.duration));
  assert.ok(Date.now() - started < 3000);
});

test('.chart: Infinity, 1e308 and NaN lengths become finite', () => {
  const midi = parseChart(chartText({ guitar: '  0 = N 0 Infinity\n  192 = N 1 1e308\n  384 = N 2 nope\n  576 = N 3 -5' }));
  const notes = midi.tracks.find((t) => t.name === 'PART GUITAR').notes;
  assert.equal(notes.length, 4);
  for (const n of notes) assert.ok(Number.isFinite(n.endTick) && n.endTick >= n.tick && n.endTick <= 2 * MAX_TICK, `endTick ${n.endTick}`);
  assert.equal(notes[2].endTick, notes[2].tick);
  assert.equal(notes[3].endTick, notes[3].tick);
  const chart = buildChart(midi, GUITAR, EXPERT);
  assert.ok(Number.isFinite(chart.duration));
  assert.ok(chart.notes.every((n) => Number.isFinite(n.time) && Number.isFinite(n.end)));
});

test('.chart: malformed tempos and time signatures are ignored, good ones kept', () => {
  const sync = ['  0 = TS 4', '  0 = B 120000', '  192 = B 0', '  192 = B Infinity', '  192 = B 1e300', '  192 = B x', '  192 = B -5',
    '  192 = TS 1e9', '  192 = TS 2.5', '  192 = TS 3 99', '  384 = B 60000'].join('\n');
  const midi = parseChart(chartText({ sync }));
  assert.deepEqual(midi.tempos.map((t) => t.usPerQuarter), [500000, 1000000]);
  assert.deepEqual(midi.timeSignatures.map((s) => s.num), [4]);
  assert.ok(Number.isFinite(midi.toSeconds(1e6)));
});

test('.chart: byte size and line count are capped', () => {
  const text = chartText();
  assert.throws(() => parseChart(new TextEncoder().encode(text), { maxBytes: 10 }), /too large/);
  assert.throws(() => parseChart(text, { maxBytes: 10 }), /too large/);
  assert.throws(() => parseChart(text, { maxEvents: 3 }), /too many lines/);
  assert.doesNotThrow(() => parseChart(text, { maxEvents: 100 }));
  assert.equal(MAX_CHART_BYTES, 64 * 1024 * 1024);
});

// --- 3. .sng ----------------------------------------------------------------------------------------------------

const sampleSng = () => writeSng({ metadata: { name: 'S' }, files: { 'notes.mid': [1, 2, 3], 'song.ogg': [4, 5, 6, 7] } });
const patch64 = (bytes, at, value) => { const b = Uint8Array.from(bytes); new DataView(b.buffer).setBigUint64(at, BigInt(value), true); return b; };
const metaEnd = (bytes) => 26 + 8 + Number(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(26, true));

test('.sng: sample parses', async () => {
  const sng = await parseSng(bufferSource(sampleSng()));
  assert.equal(sng.files.length, 2);
});

test('.sng: metadata and index sections over the cap are refused before reading them', async () => {
  const bytes = sampleSng();
  await assert.rejects(parseSng(bufferSource(patch64(bytes, 26, 9 * 1024 * 1024))), /bad section size|truncated/);
  await assert.rejects(parseSng(bufferSource(patch64(bytes, 26, 2 ** 40))), /bad section size/);
  await assert.rejects(parseSng(bufferSource(patch64(bytes, metaEnd(bytes), 2 ** 40))), /bad section size/);
  await assert.rejects(parseSng(bufferSource(patch64(bytes, 26, 0xffffffffffffffffn))), /bad section size/); // negative as i64
});

test('.sng: a section that claims more than the file holds is truncated, not allocated', async () => {
  const bytes = sampleSng();
  await assert.rejects(parseSng(bufferSource(patch64(bytes, 26, 5 * 1024 * 1024))), /truncated/);
});

test('.sng: absurd entry counts are refused', async () => {
  const bytes = sampleSng();
  await assert.rejects(parseSng(bufferSource(patch64(bytes, 26 + 8, 2 ** 40))), /bad entry count/); // metadata pair count
  await assert.rejects(parseSng(bufferSource(patch64(bytes, metaEnd(bytes) + 8, 2 ** 40))), /bad entry count/); // file count
  await assert.rejects(parseSng(bufferSource(patch64(bytes, metaEnd(bytes) + 8, 3))), /truncated|bad entry count/); // one more than the index holds
});

test('.sng: file entries outside the container are refused', async () => {
  const bytes = sampleSng();
  const first = metaEnd(bytes) + 8 + 8 + 1 + 'notes.mid'.length; // size field of the first entry
  await assert.rejects(parseSng(bufferSource(patch64(bytes, first, bytes.length * 2))), /outside the file/); // size
  await assert.rejects(parseSng(bufferSource(patch64(bytes, first + 8, bytes.length))), /outside the file/); // offset
  await assert.rejects(parseSng(bufferSource(patch64(bytes, first, 0xffffffffffffffffn))), /outside the file/); // negative
});

test('.sng: a truncated container is rejected cleanly at every cut', async () => {
  const bytes = sampleSng();
  for (const cut of [10, 26, 30, metaEnd(bytes) - 1, metaEnd(bytes) + 4, bytes.length - 1]) {
    await assert.rejects(parseSng(bufferSource(bytes.subarray(0, cut))), /SNG/, `cut at ${cut}`);
  }
});

// --- 4. library scan ----------------------------------------------------------------------------------------------
// (the unreadable song.ini case is in library.test.js)

// --- 5. server --------------------------------------------------------------------------------------------------

function get(base, reqPath) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: reqPath, timeout: 3000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

async function withTemp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-limits-'));
  try {
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

test('server: files inside a directory named x.sng are served', async () => {
  await withTemp(async (root) => {
    const songsDir = path.join(root, 'songs');
    fs.mkdirSync(path.join(songsDir, 'Pack', 'x.sng'), { recursive: true });
    fs.writeFileSync(path.join(songsDir, 'Pack', 'x.sng', 'song.ogg'), '0123456789');
    fs.writeFileSync(path.join(songsDir, 'Pack', 'real.sng'), writeSng({ metadata: { name: 'Real' }, files: { 'song.ogg': [1, 2, 3] } }));
    const appRoot = path.join(root, 'app');
    fs.mkdirSync(appRoot);
    fs.writeFileSync(path.join(appRoot, 'index.html'), '<html></html>');
    const server = createServer({ songsDir, appRoot, cacheDir: path.join(root, 'cache') });
    const base = await listen(server);
    try {
      const dir = await get(base, '/songs/Pack/x.sng/song.ogg');
      assert.equal(dir.status, 200);
      assert.equal(dir.body, '0123456789');
      const inner = await get(base, '/songs/Pack/real.sng/song.ogg'); // a real .sng still serves its inner file
      assert.equal(inner.status, 200);
      assert.equal(inner.body.length, 3);
      assert.equal((await get(base, '/songs/Pack/missing.sng/song.ogg')).status, 404);
    } finally {
      server.close();
    }
  });
});

const goodSong = (id) => ({ id, folder: id, title: id, artist: '', album: '', ini: {}, parts: ['guitar'], files: [{ name: 'song.ogg', path: `${id}/song.ogg` }] });

test('server: validIndex accepts scanLibrary-shaped songs and refuses anything else', () => {
  assert.ok(validIndex([]));
  assert.ok(validIndex([goodSong('a')]));
  for (const bad of [undefined, null, {}, 'x', [null], [1], [{}], [{ ...goodSong('a'), files: 'no' }], [{ ...goodSong('a'), files: [{}] }],
    [{ ...goodSong('a'), id: 5 }], [{ ...goodSong('a'), ini: null }], [{ ...goodSong('a'), parts: [1] }], [{ ...goodSong('a'), title: undefined }]]) {
    assert.equal(validIndex(bad), false, JSON.stringify(bad));
  }
});

test('server: a cache with the wrong shape is rescanned; a good one is reused', async () => {
  await withTemp(async (root) => {
    const songsDir = path.join(root, 'songs');
    fs.mkdirSync(songsDir);
    const cacheDir = path.join(root, 'cache');
    let scans = 0;
    const scan = async () => { scans++; return [goodSong(`scan${scans}`)]; };
    const boot = async () => {
      const server = createServer({ songsDir, appRoot: root, cacheDir, scan });
      return { server, base: await listen(server) };
    };
    let { server, base } = await boot();
    assert.equal(JSON.parse((await get(base, '/api/library')).body).songs[0].id, 'scan1');
    server.close();
    ({ server, base } = await boot()); // fresh memory: reads the cache
    assert.equal(JSON.parse((await get(base, '/api/library')).body).songs[0].id, 'scan1');
    assert.equal(scans, 1, 'a valid cache is reused');
    server.close();
    const cacheFile = path.join(cacheDir, 'library.json');
    for (const bad of [{ not: 'an array' }, [null], [{ id: 'x' }], 'text']) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      cached.songs = bad;
      fs.writeFileSync(cacheFile, JSON.stringify(cached));
      const before = scans;
      ({ server, base } = await boot());
      const body = JSON.parse((await get(base, '/api/library')).body);
      server.close();
      assert.equal(scans, before + 1, `rescanned for ${JSON.stringify(bad)}`);
      assert.ok(Array.isArray(body.songs) && body.songs[0].id.startsWith('scan'));
    }
  });
});

test('server: every response refuses framing; /songs keeps its sandbox CSP', async () => {
  await withTemp(async (root) => {
    const songsDir = path.join(root, 'songs');
    fs.mkdirSync(songsDir);
    fs.writeFileSync(path.join(songsDir, 'a.ogg'), 'x');
    const appRoot = path.join(root, 'app');
    fs.mkdirSync(appRoot);
    fs.writeFileSync(path.join(appRoot, 'index.html'), '<html><script>1</script></html>');
    const server = createServer({ songsDir, appRoot, cacheDir: path.join(root, 'cache'), scan: async () => [] });
    const base = await listen(server);
    try {
      for (const p of ['/', '/api/library', '/nope', '/songs/a.ogg', '/songs/missing.ogg']) {
        const r = await get(base, p);
        assert.equal(r.headers['x-frame-options'], 'DENY', p);
        const csp = r.headers['content-security-policy'];
        assert.equal(csp, p.startsWith('/songs/') ? 'sandbox' : "frame-ancestors 'none'", p);
      }
      assert.ok(!/script-src|default-src/.test((await get(base, '/')).headers['content-security-policy']), 'the inline script keeps working');
    } finally {
      server.close();
    }
  });
});

test('server: scanLibrary skips a chart over the size cap without reading it', async () => {
  await withTemp(async (root) => {
    fs.mkdirSync(path.join(root, 'Big'));
    fs.writeFileSync(path.join(root, 'Big', 'song.ini'), '[song]\nname = Big\n');
    const fd = fs.openSync(path.join(root, 'Big', 'notes.chart'), 'w');
    fs.ftruncateSync(fd, MAX_CHART_BYTES + 1); // sparse: no real 64 MB written
    fs.closeSync(fd);
    const started = Date.now();
    const songs = await scanLibrary(root);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].title, 'Big');
    assert.deepEqual(songs[0].parts, []);
    assert.ok(Date.now() - started < 2000);
  });
});

// --- 6. route -----------------------------------------------------------------------------------------------------

test('route: only known difficulty ids survive parsing', async () => {
  const { parseRoute } = await import('../src/route.js');
  const r = parseRoute('#/song/x/play?i=guitar:expert,bass:hard,keys:<script>,drums:__proto__,vocals:EXPERT,rhythm:medium,x:easy');
  assert.deepEqual(r.instruments, [{ id: 'guitar', diff: 'expert' }, { id: 'bass', diff: 'hard' }, { id: 'keys' }, { id: 'drums' }, { id: 'vocals' }, { id: 'rhythm', diff: 'medium' }, { id: 'x', diff: 'easy' }]);
});
