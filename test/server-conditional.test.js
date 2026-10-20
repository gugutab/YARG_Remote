// Conditional requests (ETag / Last-Modified / 304), byte ranges, client aborts and CACHE_DIR of server.mjs.
// A real `node server.mjs` is spawned on a free port over temp SONGS_DIR / CACHE_DIR folders; the abort tests run in-process
// so they can watch the read stream.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createServer, parseRange, isNotModified, validatorsOf, pickEncoding, encodedTag } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

function raw(port, target, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method, headers, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const BYTES = Buffer.from('0123456789abcdefghij'); // 20 bytes

function makeSongs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-cond-songs-'));
  const song = path.join(dir, 'Pack', 'Band - Song');
  fs.mkdirSync(song, { recursive: true });
  fs.writeFileSync(path.join(song, 'song.ini'), '[song]\nname = Cond\n');
  fs.writeFileSync(path.join(song, 'song.ogg'), BYTES);
  fs.writeFileSync(path.join(song, 'empty.txt'), '');
  return dir;
}
const OGG = '/songs/Pack/Band%20-%20Song/song.ogg';

async function withSpawned(fn) {
  const songsDir = makeSongs();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-cond-cache-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SONGS_DIR: songsDir, CACHE_DIR: cacheDir, PORT: String(port), HOST: '127.0.0.1' },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  try {
    const deadline = Date.now() + 10000;
    while (!log.includes('YARG Remote at')) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`server did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 25));
    }
    await fn(port, { songsDir, cacheDir, log: () => log });
  } finally {
    child.kill();
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 2000); });
    fs.rmSync(songsDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}

test('validators: weak ETag from size+mtime, Last-Modified, If-None-Match / If-Modified-Since rules', () => {
  const v = validatorsOf({ size: 20, mtimeMs: Date.UTC(2024, 0, 2, 3, 4, 5, 678) });
  assert.match(v.etag, /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
  assert.equal(v.lastModified, 'Tue, 02 Jan 2024 03:04:05 GMT');
  assert.notEqual(validatorsOf({ size: 21, mtimeMs: 1000 }).etag, validatorsOf({ size: 20, mtimeMs: 1000 }).etag);
  assert.notEqual(validatorsOf({ size: 20, mtimeMs: 1001 }).etag, validatorsOf({ size: 20, mtimeMs: 1000 }).etag);
  assert.ok(isNotModified({ 'if-none-match': v.etag }, v));
  assert.ok(isNotModified({ 'if-none-match': v.etag.slice(2) }, v), 'strong form of the same tag matches weakly');
  assert.ok(isNotModified({ 'if-none-match': '"x", ' + v.etag }, v), 'list');
  assert.ok(isNotModified({ 'if-none-match': '*' }, v));
  assert.ok(!isNotModified({ 'if-none-match': 'W/"nope"' }, v));
  assert.ok(isNotModified({ 'if-modified-since': v.lastModified }, v));
  assert.ok(isNotModified({ 'if-modified-since': 'Wed, 03 Jan 2024 00:00:00 GMT' }, v));
  assert.ok(!isNotModified({ 'if-modified-since': 'Mon, 01 Jan 2024 00:00:00 GMT' }, v));
  assert.ok(!isNotModified({ 'if-modified-since': 'garbage' }, v));
  assert.ok(!isNotModified({}, v));
  assert.ok(!isNotModified({ 'if-none-match': 'W/"nope"', 'if-modified-since': v.lastModified }, v), 'If-None-Match wins over If-Modified-Since');
});

test('parseRange: single ranges, suffix, open end, unsatisfiable, ignored forms, If-Range', () => {
  assert.deepEqual(parseRange('bytes=0-3', 20), { start: 0, end: 3 });
  assert.deepEqual(parseRange('bytes=5-', 20), { start: 5, end: 19 });
  assert.deepEqual(parseRange('bytes=-5', 20), { start: 15, end: 19 });
  assert.deepEqual(parseRange('bytes=-500', 20), { start: 0, end: 19 }, 'suffix longer than the file');
  assert.deepEqual(parseRange('bytes=10-999', 20), { start: 10, end: 19 }, 'end is clamped');
  assert.equal(parseRange('bytes=20-', 20), 'unsatisfiable');
  assert.equal(parseRange('bytes=9-3', 20), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 20), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-0', 0), 'unsatisfiable', 'nothing to range over in an empty file');
  for (const h of [undefined, '', 'bytes=', 'bytes=-', 'bytes=0-1,5-6', 'items=0-1', 'bytes=a-b', 'bytes=0-1 ']) assert.equal(parseRange(h, 20), null, String(h));
  const lm = 'Tue, 02 Jan 2024 03:04:05 GMT';
  assert.deepEqual(parseRange('bytes=0-3', 20, { ifRange: lm, lastModified: lm }), { start: 0, end: 3 });
  assert.equal(parseRange('bytes=0-3', 20, { ifRange: 'Mon, 01 Jan 2024 00:00:00 GMT', lastModified: lm }), null);
  assert.equal(parseRange('bytes=0-3', 20, { ifRange: 'W/"abc"', lastModified: lm }), null);
});

test('conditional requests: ETag and Last-Modified, 304 on /songs and on app files', async () => {
  await withSpawned(async (port) => {
    for (const target of [OGG, '/styles.css', '/src/app.js']) {
      const first = await raw(port, target);
      assert.equal(first.status, 200, target);
      assert.match(first.headers.etag, /^W\//, target);
      assert.ok(first.headers['last-modified'], target);
      assert.equal(first.headers['cache-control'], 'no-cache');
      const again = await raw(port, target, { 'If-None-Match': first.headers.etag });
      assert.equal(again.status, 304, target);
      assert.equal(again.body.length, 0);
      assert.equal(again.headers.etag, first.headers.etag);
      assert.equal(again.headers['x-content-type-options'], 'nosniff');
      assert.equal((await raw(port, target, { 'If-Modified-Since': first.headers['last-modified'] })).status, 304, target);
      assert.equal((await raw(port, target, { 'If-None-Match': 'W/"other"' })).status, 200, target);
      assert.equal((await raw(port, target, { 'If-None-Match': first.headers.etag }, 'HEAD')).status, 304, target);
    }
    const songs = await raw(port, OGG, { 'If-None-Match': '*' });
    assert.equal(songs.status, 304);
    assert.equal(songs.headers['content-security-policy'], 'sandbox', 'the sandbox CSP stays on 304s of /songs');
  });
});

test('conditional requests: a changed file gets a new validator and the old one no longer matches', async () => {
  await withSpawned(async (port, { songsDir }) => {
    const file = path.join(songsDir, 'Pack', 'Band - Song', 'song.ogg');
    const first = await raw(port, OGG);
    fs.writeFileSync(file, Buffer.concat([BYTES, Buffer.from('more')]));
    const second = await raw(port, OGG, { 'If-None-Match': first.headers.etag });
    assert.equal(second.status, 200);
    assert.equal(second.body.length, 24);
    assert.notEqual(second.headers.etag, first.headers.etag);
    const old = new Date(Date.now() - 86400000).toUTCString();
    assert.equal((await raw(port, OGG, { 'If-Modified-Since': old })).status, 200);
  });
});

test('ranges: 206 with Content-Range, 416, ignored forms get the whole file, If-Range', async () => {
  await withSpawned(async (port) => {
    const full = await raw(port, OGG);
    assert.equal(full.headers['accept-ranges'], 'bytes');
    const r = await raw(port, OGG, { Range: 'bytes=2-5' });
    assert.equal(r.status, 206);
    assert.equal(r.body.toString(), '2345');
    assert.equal(r.headers['content-range'], 'bytes 2-5/20');
    assert.equal(r.headers['content-length'], '4');
    assert.equal((await raw(port, OGG, { Range: 'bytes=15-' })).body.toString(), 'fghij');
    assert.equal((await raw(port, OGG, { Range: 'bytes=-3' })).body.toString(), 'hij');
    assert.equal((await raw(port, OGG, { Range: 'bytes=0-0' })).body.toString(), '0');
    const bad = await raw(port, OGG, { Range: 'bytes=20-' });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers['content-range'], 'bytes */20');
    assert.equal((await raw(port, OGG, { Range: 'bytes=-0' })).status, 416);
    for (const h of ['bytes=0-1,4-5', 'bytes=zz', 'lines=0-1']) {
      const ignored = await raw(port, OGG, { Range: h });
      assert.equal(ignored.status, 200, h);
      assert.equal(ignored.body.length, 20, h);
    }
    const head = await raw(port, OGG, { Range: 'bytes=2-5' }, 'HEAD');
    assert.equal(head.status, 206);
    assert.equal(head.body.length, 0);
    // If-Range: a matching date keeps the range, a stale date or an entity tag (ours are weak) gives the whole file
    assert.equal((await raw(port, OGG, { Range: 'bytes=2-5', 'If-Range': full.headers['last-modified'] })).status, 206);
    assert.equal((await raw(port, OGG, { Range: 'bytes=2-5', 'If-Range': 'Mon, 01 Jan 2001 00:00:00 GMT' })).status, 200);
    assert.equal((await raw(port, OGG, { Range: 'bytes=2-5', 'If-Range': full.headers.etag })).status, 200);
    // the validators win over the range: a current copy is a 304 even with a Range header
    assert.equal((await raw(port, OGG, { Range: 'bytes=2-5', 'If-None-Match': full.headers.etag })).status, 304);
  });
});

test('an empty file is a plain 200 with no body, and any range on it is a 416', async () => {
  await withSpawned(async (port, { log }) => {
    const target = '/songs/Pack/Band%20-%20Song/empty.txt';
    const r = await raw(port, target);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-length'], '0');
    assert.equal((await raw(port, target, { Range: 'bytes=0-' })).status, 416);
    assert.equal((await raw(port, OGG)).status, 200, 'the server is still alive');
    assert.ok(!/error/i.test(log()), log());
  });
});

test('CACHE_DIR: the library index goes there and not under the app root', async () => {
  await withSpawned(async (port, { cacheDir }) => {
    const lib = await raw(port, '/api/library');
    assert.equal(lib.status, 200);
    const cached = JSON.parse(fs.readFileSync(path.join(cacheDir, 'library.json'), 'utf8'));
    assert.equal(cached.songs.length, 1);
    assert.deepEqual(fs.readdirSync(cacheDir), ['library.json'], 'no temp file left behind');
  });
});

// ---- aborts and stream errors (in-process, so the read stream can be observed) ----

async function withInProcess(fn) {
  const songsDir = makeSongs();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-cond-cache-'));
  const big = path.join(songsDir, 'Pack', 'Band - Song', 'big.wav');
  fs.writeFileSync(big, Buffer.alloc(16 * 1024 * 1024, 7));
  const server = createServer({ songsDir, cacheDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const orig = fs.createReadStream;
  try {
    await fn(server.address().port, (impl) => { fs.createReadStream = impl; });
  } finally {
    fs.createReadStream = orig;
    server.close();
    server.closeAllConnections?.();
    fs.rmSync(songsDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}
const BIG = '/songs/Pack/Band%20-%20Song/big.wav';

test('a client that aborts mid-download destroys the read stream (no leaked descriptor)', async () => {
  await withInProcess(async (port, patch) => {
    const streams = [];
    const real = fs.createReadStream;
    patch((...args) => { const s = real(...args); streams.push(s); return s; });
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: BIG }, (res) => {
          res.once('data', () => { req.destroy(); resolve(); }); // got the first bytes, then walk away
          res.on('error', () => {});
        });
        req.on('error', () => {});
        setTimeout(() => reject(new Error('no data')), 5000);
      });
    }
    assert.equal(streams.length, 5);
    await Promise.all(streams.map((s) => (s.closed ? null : new Promise((r, rej) => { s.once('close', r); setTimeout(() => rej(new Error('read stream still open after the client left')), 5000); }))));
    assert.ok(streams.every((s) => s.destroyed));
    assert.equal((await raw(port, OGG)).status, 200, 'server still serves');
  });
});

test('a read error after the headers ends the response without crashing the server', async () => {
  await withInProcess(async (port, patch) => {
    const real = fs.createReadStream;
    patch((file, opts) => {
      if (!String(file).endsWith('big.wav')) return real(file, opts);
      const rs = real(file, opts);
      // behaves like a disk that fails after the first chunk: it opens normally, then errors
      const bad = new Readable({ read() { this.push(Buffer.alloc(1024)); setImmediate(() => this.destroy(new Error('disk gone'))); } });
      rs.destroy();
      queueMicrotask(() => bad.emit('open'));
      return bad;
    });
    const outcome = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: BIG, timeout: 5000 }, (res) => {
        res.on('error', () => resolve('aborted'));
        res.on('aborted', () => resolve('aborted'));
        res.on('end', () => resolve('ended'));
        res.resume();
      });
      req.on('error', () => resolve('reset'));
    });
    assert.ok(['aborted', 'reset', 'ended'].includes(outcome), outcome);
    assert.equal((await raw(port, OGG)).status, 200, 'server still serves');
  });
});

test('a file that vanishes between stat and open is a 404, not a crash', async () => {
  await withInProcess(async (port, patch) => {
    const real = fs.createReadStream;
    patch((file, opts) => real(path.join(path.dirname(String(file)), 'gone.bin'), opts));
    const r = await raw(port, BIG);
    assert.equal(r.status, 404);
    assert.equal((await raw(port, '/api/library')).status, 200);
  });
});

test('pickEncoding: brotli first, then gzip; q=0 refuses; * accepts', () => {
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0'), null);
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding(undefined), null);
  assert.equal(pickEncoding('*'), 'br');
  assert.equal(pickEncoding('*;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('BR'), 'br');
  assert.equal(encodedTag('W/"a-b"', 'br'), 'W/"a-b-br"');
  assert.equal(encodedTag('W/"a-b"', null), 'W/"a-b"');
});

test('compression: /api/library and app files in br/gzip with Vary and their own ETag; ranges and /songs stay identity', async () => {
  await withSpawned(async (port) => {
    const smallLib = await raw(port, '/api/library', { 'Accept-Encoding': 'br' }); // (one song: under the 1 KB floor, sent as is)
    assert.equal(smallLib.status, 200);
    assert.equal(smallLib.headers['content-encoding'], undefined);
    assert.equal(smallLib.headers.vary, 'Accept-Encoding');
    for (const target of ['/src/app.js', '/styles.css', '/']) {
      const plain = await raw(port, target);
      for (const [enc, unzip] of [['br', zlib.brotliDecompressSync], ['gzip', zlib.gunzipSync]]) {
        const r = await raw(port, target, { 'Accept-Encoding': enc === 'br' ? 'gzip, deflate, br' : 'gzip' });
        assert.equal(r.status, 200, `${target} ${enc}`);
        assert.equal(r.headers['content-encoding'], enc, `${target} ${enc}`);
        assert.equal(r.headers.vary, 'Accept-Encoding');
        assert.equal(Number(r.headers['content-length']), r.body.length);
        assert.ok(unzip(r.body).equals(plain.body), `${target} ${enc} decodes to the identity body`);
        assert.ok(r.headers.etag.endsWith(`-${enc}"`), r.headers.etag);
        const again = await raw(port, target, { 'Accept-Encoding': enc, 'If-None-Match': r.headers.etag });
        assert.equal(again.status, 304, `${target} ${enc} 304`);
        assert.equal(again.headers.vary, 'Accept-Encoding');
        const head = await raw(port, target, { 'Accept-Encoding': enc }, 'HEAD');
        assert.equal(head.status, 200);
        assert.equal(head.body.length, 0);
        assert.equal(head.headers['content-length'], r.headers['content-length']);
      }
    }
    const ranged = await raw(port, '/src/app.js', { 'Accept-Encoding': 'br', Range: 'bytes=0-9' });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers['content-encoding'], undefined);
    assert.equal(ranged.body.length, 10);
    const song = await raw(port, OGG, { 'Accept-Encoding': 'br, gzip' });
    assert.equal(song.status, 200);
    assert.equal(song.headers['content-encoding'], undefined);
    assert.ok(song.body.equals(BYTES));
  });
});

test('compression: a big /api/library is sent in br/gzip, built once, with a 304 on its tag', async () => {
  const songsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-lib-songs-'));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-lib-cache-'));
  const songs = Array.from({ length: 300 }, (_, i) => ({ id: `Pack/Song ${i}`, folder: `Pack/Song ${i}`, title: `Song ${i}`, artist: 'Band', album: 'Album', ini: { name: `Song ${i}` }, parts: ['guitar'], files: [{ name: 'song.ogg', path: `Pack/Song ${i}/song.ogg` }] }));
  const server = createServer({ songsDir, cacheDir, scan: async () => songs });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const plain = await raw(port, '/api/library');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.ok(plain.body.length > 20000);
    assert.equal(JSON.parse(plain.body).songs.length, 300);
    assert.equal((await raw(port, '/api/library', { 'If-None-Match': plain.headers.etag })).status, 304);
    for (const [enc, unzip] of [['br', zlib.brotliDecompressSync], ['gzip', zlib.gunzipSync]]) {
      const r = await raw(port, '/api/library', { 'Accept-Encoding': enc });
      assert.equal(r.headers['content-encoding'], enc);
      assert.equal(r.headers.vary, 'Accept-Encoding');
      assert.ok(r.body.length < plain.body.length / 4, `${enc}: ${r.body.length}`);
      assert.ok(unzip(r.body).equals(plain.body));
      assert.equal(r.headers.etag, encodedTag(plain.headers.etag, enc));
      assert.equal((await raw(port, '/api/library', { 'Accept-Encoding': enc, 'If-None-Match': r.headers.etag })).status, 304);
      assert.equal((await raw(port, '/api/library', { 'Accept-Encoding': enc, 'If-None-Match': plain.headers.etag })).status, 200, 'the identity tag is another representation');
    }
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(songsDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
