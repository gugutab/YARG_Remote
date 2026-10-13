// Optional server: serves the app, a song index (/api/library) and the song files (/songs/<path>) from a folder,
// so the browser needs no folder permission (works in Firefox and from other devices on the LAN).
//   node server.mjs [songsDir]      env: SONGS_DIR, PORT (default 8080), HOST (default 127.0.0.1, this machine only),
//                                        CACHE_DIR (library index cache; default <app>/.cache)
// HOST=0.0.0.0 (or a LAN address) is an explicit opt-in to serve other devices; then any Host header is accepted.
// While bound to loopback, requests whose Host header is not an IP literal, localhost or this machine's name are
// refused (DNS-rebinding guard).
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseSongIni } from './src/ini.js';
import { parseMidi } from './src/midi.js';
import { parseChart } from './src/chartfile.js';
import { instrumentOptions } from './src/chart.js';
import { parseSng, readSngBytes, findSngFile, isSngName } from './src/sng.js';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_FILES = new Set(['index.html', 'styles.css']);
const APP_DIRS = ['src', 'vendor'];
// Inside APP_DIRS only what the page loads (scripts, styles, markup, images); never README/licence text or dotfiles.
const APP_EXTS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff2']);
// /songs serves song packs only: no extension that a browser would run (html, js, css, svg...) is ever sent from the app origin.
const SONG_EXTS = new Set([
  '.ogg', '.opus', '.mp3', '.wav', '.flac', '.m4a', // audio
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', // images
  '.mid', '.chart', '.ini', '.sng', '.txt', '.json', // charts and metadata
]);
// Bump when the index gets new fields: older cache files are then rebuilt.
const INDEX_VERSION = 4; // 4: .sng songs
const SONG_MARKERS = ['song.ini', 'notes.mid', 'notes.chart'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mid': 'audio/midi',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.chart': 'text/plain; charset=utf-8', '.ini': 'text/plain; charset=utf-8',
};

// A source for sng.js over a file on disk (reads only the requested ranges).
async function withSngSource(file, fn) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const source = {
      size,
      read: async (start, end) => {
        const buf = Buffer.alloc(Math.max(0, end - start));
        const { bytesRead } = await fh.read(buf, 0, buf.length, start);
        return buf.subarray(0, bytesRead);
      },
    };
    return await fn(source);
  } finally {
    await fh.close();
  }
}

// The instruments a notes.mid (or notes.chart) really has (tracks with notes), like the picker of the app: guitar, bass, rhythm, keys, drums,
// vocals (harmony counts as vocals). song.ini often has no difficulty levels, or -1 for everything, while the chart is fine.
export function partsOf(midiBytes, isChart = false) {
  try {
    const bases = instrumentOptions(isChart ? parseChart(midiBytes) : parseMidi(midiBytes)).map((o) => (o.base === 'harmony' ? 'vocals' : o.base));
    return [...new Set(bases)];
  } catch {
    return [];
  }
}

// A .sng container is one song: metadata replaces song.ini, inner files are served at /songs/<rel>/<inner name>.
async function scanSng(file, rel) {
  return withSngSource(file, async (source) => {
    const sng = await parseSng(source);
    const ini = sng.metadata;
    const byName = new Map(sng.files.map((f) => [f.name.toLowerCase(), f]));
    const chartName = byName.has('notes.mid') ? 'notes.mid' : byName.has('notes.chart') ? 'notes.chart' : null;
    let parts = [];
    if (chartName) {
      try {
        parts = partsOf(await readSngBytes(source, sng, byName.get(chartName)), chartName === 'notes.chart');
      } catch { /* unreadable chart: no parts */ }
    }
    return {
      id: rel, folder: rel,
      title: String(ini.name || path.basename(rel, path.extname(rel))), artist: String(ini.artist || ''), album: String(ini.album || ''),
      ini, parts, files: sng.files.map((f) => ({ name: f.name, path: `${rel}/${f.name}` })),
    };
  });
}

// Walks songsDir; a song is any folder holding song.ini, notes.mid or notes.chart (same rule as src/library.js).
// Output matches serializeSongs(): { id, folder, title, artist, album, ini, parts, files: [{ name, path }] }.
export async function scanLibrary(songsDir) {
  const songs = [];
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const lower = new Map(files.map((n) => [n.toLowerCase(), n]));
    if (SONG_MARKERS.some((m) => lower.has(m))) {
      let ini = {};
      if (lower.has('song.ini')) {
        try {
          ini = parseSongIni(await fs.promises.readFile(path.join(dir, lower.get('song.ini'))));
        } catch { /* unreadable ini: keep the folder name */ }
      }
      const folderName = rel.split('/').pop() || path.basename(dir);
      let parts = [];
      const chartFile = lower.has('notes.mid') ? 'notes.mid' : lower.has('notes.chart') ? 'notes.chart' : null; // .mid wins, as in the app
      if (chartFile) {
        try {
          parts = partsOf(await fs.promises.readFile(path.join(dir, lower.get(chartFile))), chartFile === 'notes.chart');
        } catch { /* unreadable chart: no parts */ }
      }
      songs.push({
        id: rel, folder: rel,
        title: String(ini.name || folderName), artist: String(ini.artist || ''), album: String(ini.album || ''),
        ini, parts, files: files.map((name) => ({ name, path: rel ? `${rel}/${name}` : name })),
      });
    }
    for (const name of files) {
      if (!isSngName(name)) continue;
      const song = await scanSng(path.join(dir, name), rel ? `${rel}/${name}` : name).catch(() => null); // unreadable .sng: skipped
      if (song) songs.push(song);
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
    }
  }
  await walk(songsDir, '');
  songs.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
  return songs;
}

// Decodes a URL path once. null for malformed escapes, NUL/control characters, backslashes (a separator on Windows, so
// `..%5c` must not pass) and, on Windows, `:` (drive letters, alternate data streams).
export function decodeUrlPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  if (process.platform === 'win32' && decoded.includes(':')) return null;
  return decoded;
}

const escapes = (rel) => rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

// Resolves a URL path under `base`, refusing anything that escapes it.
export function safeJoin(base, urlPath) {
  const decoded = decodeUrlPath(urlPath);
  if (decoded === null) return null;
  const full = path.resolve(base, `.${path.sep}${decoded}`);
  return escapes(path.relative(base, full)) ? null : full;
}

// A file of the app: index.html/styles.css at the root, or a script/style/image under src/ or vendor/. The URL is decoded
// first, resolved, and only then compared with the allowlist, so `/src/..%2fserver.mjs` lands on server.mjs and is refused.
// Dotfiles and dot-directories (.git, .cache, .claude) are never served.
export function resolveAppFile(appRoot, urlPath) {
  const full = safeJoin(appRoot, urlPath);
  if (!full) return null;
  const segs = path.relative(appRoot, full).split(path.sep);
  if (segs.some((s) => s === '' || s.startsWith('.'))) return null;
  if (segs.length === 1) return APP_FILES.has(segs[0]) ? full : null;
  return APP_DIRS.includes(segs[0]) && APP_EXTS.has(path.extname(full).toLowerCase()) ? full : null;
}

export const isSongFile = (name) => SONG_EXTS.has(path.extname(name).toLowerCase());

// 'ok' when the real path (symlinks and junctions resolved) of `file` is still inside `base`.
async function realCheck(base, file) {
  try {
    const [rb, rf] = await Promise.all([fs.promises.realpath(base), fs.promises.realpath(file)]);
    return escapes(path.relative(rb, rf)) ? 'outside' : 'ok';
  } catch {
    return 'missing';
  }
}

// Host header guard for a loopback bind: only an IP literal, localhost or this machine's name pass.
export function isLoopbackBind(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || /^127\./.test(h) || h === '::ffff:127.0.0.1';
}

export function hostHeaderAllowed(header) {
  const m = /^(\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::\d{1,5})?$/i.exec(String(header || ''));
  if (!m) return false;
  const name = m[1].toLowerCase();
  if (name.startsWith('[')) return net.isIPv6(name.slice(1, -1));
  return net.isIPv4(name) || name === 'localhost' || name.endsWith('.localhost') || name === os.hostname().toLowerCase();
}

// Weak validators from size + mtime (a file rewritten with the same size inside one millisecond is not a real case here).
// `extra` is mixed into the ETag (the inner size of a .sng member, whose container stat is shared by all members).
export function validatorsOf(stat, extra = '') {
  const mtime = Math.trunc(stat.mtimeMs);
  return {
    etag: `W/"${stat.size.toString(16)}-${mtime.toString(16)}${extra ? `-${extra}` : ''}"`,
    lastModified: new Date(mtime).toUTCString(),
    mtimeSec: Math.floor(mtime / 1000),
  };
}

const opaqueTag = (t) => t.trim().replace(/^W\//, '');

// True when the request's validators say the client's copy is current (answer 304). If-None-Match wins over
// If-Modified-Since (RFC 9110 13.1.3); `*` matches any existing file; tags compare weakly.
export function isNotModified(headers, v) {
  const inm = headers['if-none-match'];
  if (inm !== undefined) {
    return String(inm).split(',').some((t) => t.trim() === '*' || opaqueTag(t) === opaqueTag(v.etag));
  }
  const ims = Date.parse(headers['if-modified-since']);
  return Number.isFinite(ims) && v.mtimeSec * 1000 <= ims;
}

// One byte range of a `size`-byte body. { start, end } (inclusive) for a satisfiable single range, null for no range
// (absent header, several ranges, other units or garbage: ignored, the full body is sent) and 'unsatisfiable' (answer 416).
// `ifRange` (If-Range header) must equal Last-Modified exactly, otherwise the range is ignored; an entity tag never
// matches because ours are weak.
export function parseRange(header, size, { ifRange, lastModified } = {}) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || !(m[1] || m[2])) return null;
  if (ifRange !== undefined && String(ifRange).trim() !== lastModified) return null;
  let start = 0;
  let end = size - 1;
  if (m[1]) {
    start = Number(m[1]);
    if (m[2]) end = Math.min(Number(m[2]), end);
  } else {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
  }
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

// Answers 304 or 416 itself (and returns null); otherwise returns { head: [status, headers], start, end } for a 206 or 200.
function answer(req, res, type, size, v) {
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ETag: v.etag, 'Last-Modified': v.lastModified };
  if (isNotModified(req.headers, v)) {
    res.writeHead(304, { 'Cache-Control': base['Cache-Control'], ETag: v.etag, 'Last-Modified': v.lastModified }).end();
    return null;
  }
  const range = parseRange(req.headers.range, size, { ifRange: req.headers['if-range'], lastModified: v.lastModified });
  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return null;
  }
  if (range) return { head: [206, { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 }], ...range };
  return { head: [200, { ...base, 'Content-Length': size }], start: 0, end: size - 1 };
}

function sendFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    try {
      if (err || !stat.isFile()) {
        if (!res.headersSent) res.writeHead(404).end('Not found');
        return;
      }
      const a = answer(req, res, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', stat.size, validatorsOf(stat));
      if (!a) return;
      if (req.method === 'HEAD' || stat.size === 0) { // an empty file has no byte to read (createReadStream rejects end < start)
        res.writeHead(...a.head).end();
        return;
      }
      const rs = fs.createReadStream(file, { start: a.start, end: a.end });
      res.once('close', () => rs.destroy()); // client gone: release the descriptor
      rs.once('error', (e) => { // open failed (file vanished, no permission): still a clean HTTP answer
        if (!res.headersSent) res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'Not found' : 'Internal server error');
      });
      rs.once('open', () => {
        res.writeHead(...a.head);
        // pipeline destroys both ends when either fails or closes early, so no descriptor outlives the request and a read
        // error after the headers just cuts the connection; the callback is empty because the error is already handled.
        pipeline(rs, res, () => {});
      });
    } catch (e) {
      console.error(`[server] ${req.method} ${String(req.url).slice(0, 200)}:`, e);
      if (res.headersSent) res.destroy();
      else res.writeHead(500).end('Internal server error');
    }
  });
}

// /songs/<...>/<name>.sng/<inner file>: the inner file, unmasked, with byte ranges like sendFile. Returns false when
// the path has no .sng folder segment (then it is a plain file).
async function sendSngInner(req, res, songsDir, urlPath) {
  const segs = urlPath.split('/');
  const at = segs.findIndex((s) => { try { return isSngName(decodeURIComponent(s)); } catch { return false; } });
  if (at < 0 || at === segs.length - 1) return false;
  const sngFile = safeJoin(songsDir, segs.slice(0, at + 1).join('/'));
  if (!sngFile) return res.writeHead(403).end('Forbidden'), true;
  const innerName = decodeUrlPath(segs.slice(at + 1).join('/'));
  if (innerName === null) return res.writeHead(400).end(), true;
  if (!isSongFile(innerName)) return res.writeHead(403).end('Forbidden'), true;
  const real = await realCheck(songsDir, sngFile);
  if (real !== 'ok') return res.writeHead(real === 'missing' ? 404 : 403).end(real === 'missing' ? 'Not found' : 'Forbidden'), true;
  try {
    const stat = await fs.promises.stat(sngFile);
    await withSngSource(sngFile, async (source) => {
      const sng = await parseSng(source);
      const inner = findSngFile(sng, innerName);
      if (!inner) return res.writeHead(404).end('Not found');
      const a = answer(req, res, TYPES[path.extname(innerName).toLowerCase()] || 'application/octet-stream', inner.size, validatorsOf(stat, inner.size.toString(16)));
      if (!a) return;
      if (req.method === 'HEAD' || inner.size === 0) return res.writeHead(...a.head).end();
      res.writeHead(...a.head);
      const CHUNK = 1 << 20;
      for (let pos = a.start; pos <= a.end && !res.destroyed; pos += CHUNK) {
        const bytes = await readSngBytes(source, sng, inner, pos, Math.min(pos + CHUNK, a.end + 1));
        if (res.destroyed) break;
        if (!res.write(bytes)) {
          await new Promise((r) => { // a client that leaves while we wait for 'drain' would hang this (and the open file) forever
            const done = () => { res.off('drain', done); res.off('close', done); r(); };
            res.once('drain', done);
            res.once('close', done);
          });
        }
      }
      if (!res.destroyed) res.end();
    });
  } catch (err) {
    if (res.headersSent) res.destroy();
    else res.writeHead(err.code === 'ENOENT' ? 404 : 500).end('Not found');
  }
  return true;
}

// `host` is the address the server will be bound to: a loopback bind turns the Host header guard on.
// `scan` can be replaced in tests.
export function createServer({ songsDir, appRoot = APP_ROOT, host = '127.0.0.1', scan = scanLibrary, cacheDir = path.join(appRoot, '.cache') }) {
  const guardHost = isLoopbackBind(host);
  const cacheFile = path.join(cacheDir, 'library.json');
  let library = null; // song index in memory
  let scanning = null;

  async function getLibrary(refresh) {
    if (!refresh && library) return library;
    if (!refresh) {
      try {
        const cached = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
        if (cached.songsDir === songsDir && cached.version === INDEX_VERSION) return (library = cached.songs);
      } catch { /* no cache yet */ }
    }
    scanning ||= scan(songsDir).finally(() => { scanning = null; });
    library = await scanning;
    try {
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.${process.pid}.tmp`; // write + rename: a reader never sees half a file
      await fs.promises.writeFile(tmp, JSON.stringify({ version: INDEX_VERSION, songsDir, songs: library }));
      await fs.promises.rename(tmp, cacheFile);
    } catch { /* cache is optional */ }
    return library;
  }

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (guardHost && !hostHeaderAllowed(req.headers.host)) {
        res.writeHead(403).end('Forbidden host');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      // Split the request target by hand: `new URL('//host/x', base)` would treat `//host` as an authority.
      const target = req.url || '';
      if (!target.startsWith('/')) {
        res.writeHead(400).end('Bad request');
        return;
      }
      const cut = target.search(/[?#]/);
      const pathname = cut < 0 ? target : target.slice(0, cut);
      const query = new URLSearchParams(cut < 0 || target[cut] === '#' ? '' : target.slice(cut + 1).split('#')[0]);
      if (decodeUrlPath(pathname) === null) {
        res.writeHead(400).end('Bad request');
        return;
      }
      if (pathname === '/api/library') {
        const songs = await getLibrary(query.has('refresh'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ rootName: path.basename(songsDir), songs }));
      } else if (pathname.startsWith('/songs/')) {
        res.setHeader('Content-Security-Policy', 'sandbox');
        const rel = pathname.slice('/songs/'.length);
        if (await sendSngInner(req, res, songsDir, rel)) return;
        const file = safeJoin(songsDir, rel);
        if (!file || !isSongFile(file)) {
          res.writeHead(403).end('Forbidden');
          return;
        }
        const real = await realCheck(songsDir, file);
        if (real === 'ok') sendFile(req, res, file);
        else res.writeHead(real === 'missing' ? 404 : 403).end(real === 'missing' ? 'Not found' : 'Forbidden');
      } else {
        const file = resolveAppFile(appRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
        const real = file ? await realCheck(appRoot, file) : 'missing';
        if (real === 'ok') sendFile(req, res, file);
        else res.writeHead(real === 'outside' ? 403 : 404).end(real === 'outside' ? 'Forbidden' : 'Not found');
      }
    } catch (err) {
      console.error(`[server] ${req.method} ${String(req.url).slice(0, 200)}:`, err);
      if (res.headersSent) res.destroy();
      else res.writeHead(500).end('Internal server error');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // One bad request must not take the process down: log and keep serving.
  process.on('unhandledRejection', (err) => console.error('[server] unhandled rejection:', err));
  process.on('uncaughtException', (err) => console.error('[server] uncaught exception:', err));
  const songsDir = path.resolve(process.argv[2] || process.env.SONGS_DIR || 'A:\\music\\Songs');
  const port = process.env.PORT ? Number(process.env.PORT) : 8080;
  const host = process.env.HOST || '127.0.0.1';
  if (!fs.existsSync(songsDir)) {
    console.error(`Songs folder not found: ${songsDir}\nUsage: node server.mjs <folder> (or SONGS_DIR).`);
    process.exit(1);
  }
  const cacheDir = process.env.CACHE_DIR ? path.resolve(process.env.CACHE_DIR) : undefined;
  const server = createServer({ songsDir, host, cacheDir });
  server.listen(port, host, () => {
    const addr = server.address();
    const shown = addr.family === 'IPv6' ? `[${addr.address}]` : addr.address;
    console.log(`YARG Remote at http://${shown}:${addr.port} - songs: ${songsDir}`);
    if (!isLoopbackBind(host)) console.log(`Bound to ${host}: other devices on the network can read the app and the songs folder.`);
  });
}
