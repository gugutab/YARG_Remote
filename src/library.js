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
    const ini = files.has('song.ini') ? parseSongIni(new Uint8Array(await readBytes(files.get('song.ini')))) : {};
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
  songs.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
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
        url: remoteFileUrl(f.path), // images can be shown straight from the server
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

// The cover image of a song folder: album.* first, then other common names, then any image that is not a
// background or an alternate cover.
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
export function findCover(song) {
  const base = (f) => f.name.replace(/\.[^.]+$/, '').toLowerCase();
  const images = [...song.files.values()].filter((f) => IMAGE_EXT.includes(f.name.split('.').pop().toLowerCase()));
  for (const want of ['album', 'cover', 'folder', 'front', 'art']) {
    const hit = images.find((f) => base(f) === want);
    if (hit) return hit;
  }
  return images.find((f) => !/^(background|bg|album_alt|banner|highway)/.test(base(f))) || null;
}

// Stem names YARG loads from a song folder (IniAudio.SupportedStems in SongEntry.IniBase.cs and the name table in
// AudioHelpers.cs, which also knows the _clean / _explicit variants). YARG loads ONLY these names; any other audio file
// in the folder is ignored (the stem lookup falls back to SongStem.Song only for unknown names it is asked about, it
// never scans the folder). We do the same, except that a folder with no recognised stem at all still plays (see below).
const STEM_NAMES = new Set(['song', 'guitar', 'bass', 'rhythm', 'keys', 'vocals', 'vocals_1', 'vocals_2', 'drums', 'drums_1', 'drums_2', 'drums_3', 'drums_4', 'crowd']);
const VARIANT = /_(clean|explicit)$/;
// YARG tries formats in this order for one stem name (IniAudio.SupportedFormats); ours follow, then the extras we also decode.
const EXT_ORDER = ['opus', 'ogg', 'mp3', 'wav', 'aiff', 'flac', 'm4a'];
// preview.* and preview_clean.* are the separate preview stem (PREVIEW_FILES), never part of the mix.
const isPreviewName = (n) => /^preview(_clean)?$/.test(n);

const extOf = (name) => name.split('.').pop().toLowerCase();
const baseName = (name) => name.replace(/\.[^.]+$/, '').toLowerCase();

// Picks one version of each stem. `entries` need a `name`; "vocals", "vocals_clean" and "vocals_explicit" are versions
// of the same stem and only one may play (the mix would double it). Explicit wins by default (the uncensored original);
// pass { censor: true } for clean first. A version that does not exist is skipped (plain "song" alone is always used).
// The same name in several formats (song.ogg + song.mp3) also counts once, in YARG's format order.
export function chooseStemVariants(entries, { censor = false } = {}) {
  const rank = censor ? { clean: 0, '': 1, explicit: 2 } : { explicit: 0, '': 1, clean: 2 };
  const best = new Map(); // stem base name -> { entry, rank, ext }
  for (const entry of entries) {
    const name = baseName(entry.name);
    const variant = VARIANT.exec(name)?.[1] ?? '';
    const base = name.replace(VARIANT, '');
    const r = rank[variant];
    const e = EXT_ORDER.indexOf(extOf(entry.name));
    const cur = best.get(base);
    if (!cur || r < cur.rank || (r === cur.rank && e < cur.ext)) best.set(base, { entry, rank: r, ext: e, base });
  }
  return [...best.values()];
}

// The audio files of a song as mixer stems: { id: file name, label: canonical stem name, getFile }.
// Only YARG's stem names are used. If the folder has none of them (odd packs: "audio.ogg", "track1.mp3"), every audio
// file except the preview plays, so the song is still audible. `options.censor` prefers the _clean versions.
export function audioStemsOf(song, options = {}) {
  const audio = [...song.files.values()].filter((f) => AUDIO_EXT.includes(extOf(f.name)) && !isPreviewName(baseName(f.name)));
  const known = audio.filter((f) => STEM_NAMES.has(baseName(f.name).replace(VARIANT, '')));
  return chooseStemVariants(known.length ? known : audio, options)
    .map(({ entry, base }) => ({ id: entry.name, label: base, getFile: entry.getFile }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function readText(entry) {
  const file = await entry.getFile();
  return file.text();
}

export async function readBytes(entry) {
  const file = await entry.getFile();
  return file.arrayBuffer();
}
