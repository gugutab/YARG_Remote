// Finds song folders inside a user-picked directory.
// Works with the File System Access API (Chromium) and with <input webkitdirectory> (fallback).
// A song folder is any directory containing song.ini, notes.mid or notes.chart.
import { parseSongIni } from './ini.js';

export const AUDIO_EXT = ['ogg', 'mp3', 'opus', 'wav', 'flac', 'm4a'];
const SONG_MARKERS = ['song.ini', 'notes.mid', 'notes.chart'];

// Walks a FileSystemDirectoryHandle recursively.
export async function* walkHandle(dirHandle, prefix = '') {
  for await (const entry of dirHandle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      yield* walkHandle(entry, path);
    } else {
      yield { path, getFile: () => entry.getFile() };
    }
  }
}

export function entriesFromFileList(fileList) {
  return Array.from(fileList, (file) => ({
    path: file.webkitRelativePath || file.name,
    getFile: async () => file,
  }));
}

// Groups flat entries into songs. `entries` may be an async iterable or an array.
export async function scanSongs(entries) {
  const byDir = new Map();
  for await (const entry of entries) {
    const slash = entry.path.lastIndexOf('/');
    const dir = slash < 0 ? '' : entry.path.slice(0, slash);
    const name = entry.path.slice(slash + 1);
    if (!byDir.has(dir)) byDir.set(dir, new Map());
    byDir.get(dir).set(name.toLowerCase(), { name, path: entry.path, getFile: entry.getFile });
  }

  const songs = [];
  for (const [dir, files] of byDir) {
    if (!SONG_MARKERS.some((m) => files.has(m))) continue;
    const folderName = dir.split('/').pop() || dir;
    const ini = files.has('song.ini') ? parseSongIni(await readText(files.get('song.ini'))) : {};
    songs.push({
      id: dir,
      folder: dir,
      title: String(ini.name || folderName), // song.ini values like "1999" are parsed as numbers
      artist: String(ini.artist || ''),
      album: String(ini.album || ''),
      ini,
      files,
    });
  }
  songs.sort((a, b) => a.title.localeCompare(b.title, 'pt', { sensitivity: 'base' }));
  return songs;
}

// The scanned library as plain data (no file handles), so it can be stored and shown again without a rescan.
export function serializeSongs(songs) {
  return songs.map((s) => ({
    id: s.id,
    folder: s.folder,
    title: s.title,
    artist: s.artist,
    album: s.album,
    ini: s.ini,
    files: [...s.files.values()].map((f) => ({ name: f.name, path: f.path })),
  }));
}

// Rebuilds songs from serializeSongs output. Files are looked up again under `root`, the picked folder.
export function restoreSongs(index, root) {
  return index.map((s) => ({
    ...s,
    files: new Map(s.files.map((f) => [
      f.name.toLowerCase(),
      { name: f.name, path: f.path, getFile: () => resolveFile(root, f.path) },
    ])),
  }));
}

// Songs served by server.mjs: the index comes from /api/library and files are fetched from /songs/<path>.
export function remoteFileUrl(path) {
  return `/songs/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function restoreRemoteSongs(index) {
  return index.map((s) => ({
    ...s,
    files: new Map(s.files.map((f) => [
      f.name.toLowerCase(),
      {
        name: f.name,
        path: f.path,
        getFile: async () => {
          const res = await fetch(remoteFileUrl(f.path));
          if (!res.ok) throw new Error(`${f.name}: HTTP ${res.status}`);
          return res.blob(); // Blob has arrayBuffer() and text(), like File
        },
      },
    ])),
  }));
}

// Walks `path` (as walkHandle builds it: the picked folder's name first) down from `root`.
export async function resolveFile(root, path) {
  const parts = path.split('/').slice(1);
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  const handle = await dir.getFileHandle(parts[parts.length - 1]);
  return handle.getFile();
}

export function audioStemsOf(song) {
  return [...song.files.values()]
    .filter((f) => AUDIO_EXT.includes(f.name.split('.').pop().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ id: f.name, label: f.name.replace(/\.[^.]+$/, ''), getFile: f.getFile }));
}

export async function readText(entry) {
  const file = await entry.getFile();
  return file.text();
}

export async function readBytes(entry) {
  const file = await entry.getFile();
  return file.arrayBuffer();
}
