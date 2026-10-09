// Optional server: serves the app, a song index (/api/library) and the song files (/songs/<path>) from a folder,
// so the browser needs no folder permission (works in Firefox and from other devices on the LAN).
//   node server.mjs [songsDir]      env: SONGS_DIR, PORT (default 8080), HOST (default 0.0.0.0)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSongIni } from './src/ini.js';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_FILES = new Set(['index.html', 'styles.css']);
const APP_DIRS = ['src', 'vendor'];
const SONG_MARKERS = ['song.ini', 'notes.mid', 'notes.chart'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mid': 'audio/midi',
};

// Walks songsDir; a song is any folder holding song.ini, notes.mid or notes.chart (same rule as src/library.js).
// Output matches serializeSongs(): { id, folder, title, artist, album, ini, files: [{ name, path }] }.
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
          ini = parseSongIni(await fs.promises.readFile(path.join(dir, lower.get('song.ini')), 'utf8'));
        } catch { /* unreadable ini: keep the folder name */ }
      }
      const folderName = rel.split('/').pop() || path.basename(dir);
      songs.push({
        id: rel, folder: rel,
        title: String(ini.name || folderName), artist: String(ini.artist || ''), album: String(ini.album || ''),
        ini, files: files.map((name) => ({ name, path: rel ? `${rel}/${name}` : name })),
      });
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

export function createServer({ songsDir, appRoot = APP_ROOT }) {
  const cacheFile = path.join(appRoot, '.cache', 'library.json');
  let library = null; // song index in memory
  let scanning = null;

  async function getLibrary(refresh) {
    if (!refresh && library) return library;
    if (!refresh) {
      try {
        const cached = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
        if (cached.songsDir === songsDir) return (library = cached.songs);
      } catch { /* no cache yet */ }
    }
    scanning ||= scanLibrary(songsDir).finally(() => { scanning = null; });
    library = await scanning;
    try {
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.promises.writeFile(cacheFile, JSON.stringify({ songsDir, songs: library }));
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
