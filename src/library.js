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
    byDir.get(dir).set(name.toLowerCase(), { name, getFile: entry.getFile });
  }

  const songs = [];
  for (const [dir, files] of byDir) {
    if (!SONG_MARKERS.some((m) => files.has(m))) continue;
    const folderName = dir.split('/').pop() || dir;
    const ini = files.has('song.ini') ? parseSongIni(await readText(files.get('song.ini'))) : {};
    songs.push({
      id: dir,
      folder: dir,
      title: ini.name || folderName,
      artist: ini.artist || '',
      album: ini.album || '',
      ini,
      files,
    });
  }
  songs.sort((a, b) => a.title.localeCompare(b.title, 'pt', { sensitivity: 'base' }));
  return songs;
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
