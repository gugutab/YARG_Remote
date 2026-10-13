// Smoke test of the dev server, no browser: starts `node server.mjs` on a free port over a temp songs folder with one tiny
// synthetic song, fetches the app, the modules index.html pulls in, the library index and the song files, tries a few path
// traversals, then stops the server. Exit code 0 = all good, 1 = something failed.
//   node scripts/smoke.mjs        (npm run smoke)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMidi, event, trackName, tempo120, on, off } from '../test/smf.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'library.json');
const failures = [];
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures.push(label);
};

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

// Raw request: fetch() would normalise `..` segments before sending, hiding the traversal attempts.
const request = (port, target, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: target, method, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(chunks) }));
  });
  req.setTimeout(10000, () => req.destroy(new Error(`timeout: ${target}`)));
  req.on('error', reject);
  req.end();
});
const get = (port, target, headers = {}) => request(port, target, { headers });

function silentWav(seconds = 1, rate = 8000) {
  const data = Buffer.alloc(seconds * rate * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Every module reachable from index.html through static imports.
function moduleGraph(indexHtml) {
  const seen = new Set();
  const queue = [...indexHtml.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const src = fs.readFileSync(path.join(ROOT, url), 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(url), m[1])));
    }
  }
  return [...seen];
}

const songsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-smoke-'));
const cacheBackup = fs.existsSync(CACHE) ? fs.readFileSync(CACHE) : null; // the server overwrites the index cache
let server;
try {
  const dir = path.join(songsDir, 'Smoke Test - Synthetic');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'notes.mid'), buildMidi(480, [
    [event(0, trackName('notes')), tempo120()],
    [event(0, trackName('PART GUITAR')), on(0, 96), off(240, 96), on(0, 97), off(240, 97)],
  ]));
  fs.writeFileSync(path.join(dir, 'song.ini'), '[song]\nname = Smoke Song\nartist = Smoke Artist\ndiff_guitar = 1\n');
  fs.writeFileSync(path.join(dir, 'song.wav'), silentWav());

  const port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SONGS_DIR: songsDir, PORT: String(port), HOST: '127.0.0.1' },
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => server.once('exit', () => resolve(false)));
  const started = await Promise.race([
    new Promise((resolve) => { const t = setInterval(() => { if (log.includes('YARG Remote at')) { clearInterval(t); resolve(true); } }, 50); }),
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
  ]);
  if (!started) throw new Error(`server did not start:\n${log}`);

  // App shell
  const root = await get(port, '/');
  check(root.status === 200 && root.type.startsWith('text/html'), 'GET /', `${root.status} ${root.type}`);
  const index = await get(port, '/index.html');
  check(index.status === 200 && index.type.startsWith('text/html'), 'GET /index.html', `${index.status} ${index.type}`);
  const css = await get(port, '/styles.css');
  check(css.status === 200 && css.type.startsWith('text/css'), 'GET /styles.css', `${css.status} ${css.type}`);

  // Every module the app loads
  const modules = moduleGraph(index.body.toString('utf8'));
  let bad = 0;
  for (const url of modules) {
    const r = await get(port, `/${url}`);
    if (r.status !== 200 || !r.type.startsWith('text/javascript')) { bad++; check(false, `GET /${url}`, `${r.status} ${r.type}`); }
  }
  check(bad === 0 && modules.length > 5, `${modules.length} modules reachable from index.html served as text/javascript`);
  const vendor = await get(port, '/vendor/soundtouch.js');
  check(vendor.status === 200 && vendor.type.startsWith('text/javascript'), 'GET /vendor/soundtouch.js', `${vendor.status} ${vendor.type}`);

  // Library index and song files
  const lib = await get(port, '/api/library');
  let json = null;
  try { json = JSON.parse(lib.body.toString('utf8')); } catch { /* reported below */ }
  const song = json?.songs?.find((s) => s.title === 'Smoke Song');
  check(lib.status === 200 && lib.type.startsWith('application/json') && !!song, 'GET /api/library lists the synthetic song', `${lib.status} ${lib.type}`);
  check(Array.isArray(song?.parts) && song.parts.includes('guitar'), 'library index has parts: guitar', JSON.stringify(song?.parts));
  const base = `/songs/${encodeURIComponent('Smoke Test - Synthetic')}`;
  const mid = await get(port, `${base}/notes.mid`);
  check(mid.status === 200 && mid.type === 'audio/midi' && mid.body.subarray(0, 4).toString() === 'MThd', 'GET /songs/.../notes.mid', `${mid.status} ${mid.type}`);
  const wav = await get(port, `${base}/song.wav`);
  check(wav.status === 200 && wav.type === 'audio/wav', 'GET /songs/.../song.wav', `${wav.status} ${wav.type}`);
  const part = await get(port, `${base}/song.wav`, { Range: 'bytes=0-43' });
  check(part.status === 206 && part.body.length === 44, 'Range request on song.wav', `${part.status}, ${part.body.length} bytes`);
  const ini = await get(port, `${base}/song.ini`);
  check(ini.status === 200 && ini.body.toString().includes('Smoke Song'), 'GET /songs/.../song.ini', `${ini.status}`);

  // Things that must be refused or missing
  for (const target of [
    '/songs/..%2fserver.mjs', '/songs/%2e%2e/server.mjs', '/songs/..%5cserver.mjs', '/songs/../../etc/passwd',
    '/src/..%2fserver.mjs', '/../server.mjs', '/%2e%2e/package.json', '/.git/config', '/server.mjs', '/package.json', '/songs/x/%00.mid',
  ]) {
    const r = await get(port, target);
    check(r.status >= 400 && r.status < 500, `refused: ${target}`, String(r.status));
  }
  const post = await request(port, '/', { method: 'POST' });
  check(post.status >= 400 && post.status < 500, 'refused: POST /', String(post.status));
  const hostile = await get(port, '/', { Host: 'evil.example.com' });
  check(hostile.status === 403, 'refused: foreign Host header on loopback', String(hostile.status));
} catch (err) {
  console.error(err);
  failures.push(String(err.message || err));
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 3000); });
  }
  try {
    if (cacheBackup) fs.writeFileSync(CACHE, cacheBackup);
    else fs.rmSync(CACHE, { force: true });
  } catch { /* best effort */ }
  fs.rmSync(songsDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nSmoke test FAILED (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nSmoke test passed.');
