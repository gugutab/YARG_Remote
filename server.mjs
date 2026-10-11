// Optional server: serves the app, a song index (/api/library) and the song files (/songs/<path>) from a folder,
// so the browser needs no folder permission (works in Firefox and from other devices on the LAN).
//   node server.mjs [songsDir]      env: SONGS_DIR, PORT (default 8080), HOST (default 0.0.0.0)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSongIni } from './src/ini.js';
import { parseMidi } from './src/midi.js';
import { parseChart } from './src/chartfile.js';
import { instrumentOptions } from './src/chart.js';
import { parseSng, readSngBytes, findSngFile, isSngName } from './src/sng.js';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_FILES = new Set(['index.html', 'styles.css']);
const APP_DIRS = ['src', 'vendor'];
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

// Resolves a URL path under `base`, refusing anything that escapes it.
export function safeJoin(base, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = path.resolve(base, `.${path.sep}${decoded}`);
  const rel = path.relative(base, full);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : full;
}

function sendFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const headers = {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0;
    let end = stat.size - 1;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), end);
      } else {
        start = Math.max(0, stat.size - Number(range[2]));
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
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
  let innerName;
  try {
    innerName = decodeURIComponent(segs.slice(at + 1).join('/'));
  } catch {
    return res.writeHead(400).end(), true;
  }
  try {
    await withSngSource(sngFile, async (source) => {
      const sng = await parseSng(source);
      const inner = findSngFile(sng, innerName);
      if (!inner) return res.writeHead(404).end('Not found');
      const size = inner.size;
      const headers = { 'Content-Type': TYPES[path.extname(innerName).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
      let start = 0;
      let end = size - 1;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      let partial = false;
      if (range && (range[1] || range[2])) {
        if (range[1]) {
          start = Number(range[1]);
          if (range[2]) end = Math.min(Number(range[2]), end);
        } else {
          start = Math.max(0, size - Number(range[2]));
        }
        if (start > end || start >= size) return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
        partial = true;
      }
      if (partial) res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      else res.writeHead(200, { ...headers, 'Content-Length': size });
      if (req.method === 'HEAD') return res.end();
      const CHUNK = 1 << 20;
      for (let pos = start; pos <= end && !res.destroyed; pos += CHUNK) {
        const bytes = await readSngBytes(source, sng, inner, pos, Math.min(pos + CHUNK, end + 1));
        if (!res.write(bytes)) await new Promise((r) => res.once('drain', r));
      }
      res.end();
    });
  } catch (err) {
    if (res.headersSent) res.destroy();
    else res.writeHead(err.code === 'ENOENT' ? 404 : 500).end('Not found');
  }
  return true;
}

export function createServer({ songsDir, appRoot = APP_ROOT }) {
  const cacheFile = path.join(appRoot, '.cache', 'library.json');
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
    scanning ||= scanLibrary(songsDir).finally(() => { scanning = null; });
    library = await scanning;
    try {
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.promises.writeFile(cacheFile, JSON.stringify({ version: INDEX_VERSION, songsDir, songs: library }));
    } catch { /* cache is optional */ }
    return library;
  }

  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname;
    try {
      if (pathname === '/api/library') {
        const songs = await getLibrary(url.searchParams.has('refresh'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ rootName: path.basename(songsDir), songs }));
      } else if (pathname.startsWith('/songs/')) {
        if (await sendSngInner(req, res, songsDir, pathname.slice('/songs/'.length))) return;
        const file = safeJoin(songsDir, pathname.slice('/songs/'.length));
        file ? sendFile(req, res, file) : res.writeHead(403).end('Forbidden');
      } else {
        const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
        const top = rel.split('/')[0];
        if (!APP_FILES.has(rel) && !APP_DIRS.includes(top)) {
          res.writeHead(404).end('Not found');
          return;
        }
        const file = safeJoin(appRoot, rel);
        file ? sendFile(req, res, file) : res.writeHead(403).end('Forbidden');
      }
    } catch (err) {
      res.writeHead(500).end(String(err.message));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const songsDir = path.resolve(process.argv[2] || process.env.SONGS_DIR || 'A:\\music\\Songs');
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '0.0.0.0';
  if (!fs.existsSync(songsDir)) {
    console.error(`Songs folder not found: ${songsDir}\nUsage: node server.mjs <folder> (or SONGS_DIR).`);
    process.exit(1);
  }
  createServer({ songsDir }).listen(port, host, () => {
    console.log(`YARG Remote at http://localhost:${port} (network: port ${port}) — songs: ${songsDir}`);
  });
}
