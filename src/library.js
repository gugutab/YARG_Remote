// Finds song folders inside a user-picked directory.
// Works with the File System Access API (Chromium) and with <input webkitdirectory> (fallback).
// A song folder is any directory containing song.ini, notes.mid or notes.chart; a .sng file is a song by itself (see sng.js).
import { parseSongIni } from './ini.js';
import { parseSng, blobSource, readSngBytes, findSngFile, isSngName } from './sng.js';

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

// Files read at once while scanning (getFile + parse). A library of ~750 songs would otherwise queue hundreds of handle
// lookups at the same time; a few in flight keep the disk busy without exhausting the browser's file handles.
export const SCAN_CONCURRENCY = 8;

// Like items.map(fn) but with at most `limit` calls in flight; results keep the input order. The first rejection stops
// new work from starting and is the one that propagates (as with Promise.all).
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  const n = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

// Groups flat entries into songs. `entries` may be an async iterable or an array.
export async function scanSongs(entries, { concurrency = SCAN_CONCURRENCY } = {}) {
  const byDir = new Map();
  const sngEntries = [];
  for await (const entry of entries) {
    const slash = entry.path.lastIndexOf('/');
    const dir = slash < 0 ? '' : entry.path.slice(0, slash);
    const name = entry.path.slice(slash + 1);
    if (isSngName(name)) sngEntries.push(entry);
    if (!byDir.has(dir)) byDir.set(dir, new Map());
    byDir.get(dir).set(name.toLowerCase(), { name, path: entry.path, getFile: entry.getFile });
  }

  const folders = [...byDir].filter(([, files]) => SONG_MARKERS.some((m) => files.has(m)));
  const folderSongs = await mapLimit(folders, concurrency, async ([dir, files]) => {
    const folderName = dir.split('/').pop() || dir;
    let ini = {};
    if (files.has('song.ini')) {
      try {
        ini = parseSongIni(new Uint8Array(await readBytes(files.get('song.ini'))));
      } catch { /* unreadable song.ini (locked, vanished, permission): the song stays listed, titled by its folder, like server.mjs */ }
    }
    return {
      id: dir,
      folder: dir,
      title: String(ini.name || folderName), // song.ini values like "1999" are parsed as numbers
      artist: String(ini.artist || ''),
      album: String(ini.album || ''),
      ini,
      files,
    };
  });
  const sngSongs = await mapLimit(sngEntries, concurrency, sngSong);
  const songs = [...folderSongs, ...sngSongs.filter(Boolean)];
  songs.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
  return songs;
}

const SNG_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4' };

// One inner file of a .sng as a File, read (and unmasked) only now. `sngBlob` is the .sng itself.
export async function readSngInner(sngBlob, name) {
  const source = blobSource(sngBlob);
  const sng = await parseSng(source);
  const inner = findSngFile(sng, name);
  if (!inner) throw new Error(`${name}: not in the .sng`);
  const bytes = await readSngBytes(source, sng, inner);
  return new File([bytes], inner.name, { type: SNG_TYPES[inner.name.split('.').pop().toLowerCase()] || '' });
}

// A .sng becomes one song: metadata replaces song.ini and the inner files are listed as if they sat in a folder named
// after the .sng, so `path` is "<pack>/<song>.sng/<inner name>" (the same URL scheme server.mjs serves). Unreadable
// .sng files are skipped.
async function sngSong(entry) {
  try {
    const sng = await parseSng(blobSource(await entry.getFile()));
    const files = new Map();
    for (const f of sng.files) {
      files.set(f.name.toLowerCase(), {
        name: f.name, path: `${entry.path}/${f.name}`, sng: entry.path,
        getFile: async () => readSngInner(await entry.getFile(), f.name),
      });
    }
    const ini = sng.metadata;
    return {
      id: entry.path, folder: entry.path,
      title: String(ini.name || entry.path.split('/').pop().replace(/\.sng$/i, '')), artist: String(ini.artist || ''), album: String(ini.album || ''),
      ini, files,
    };
  } catch {
    return null;
  }
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
    files: [...s.files.values()].map((f) => (f.sng ? { name: f.name, path: f.path, sng: f.sng } : { name: f.name, path: f.path })),
  }));
}

// Rebuilds songs from serializeSongs output. Files are looked up again under `root`, the picked folder.
export function restoreSongs(index, root) {
  return index.map((s) => ({
    ...s,
    files: new Map(s.files.map((f) => [
      f.name.toLowerCase(),
      { name: f.name, path: f.path, ...(f.sng ? { sng: f.sng } : {}), getFile: f.sng ? async () => readSngInner(await resolveFile(root, f.sng), f.name) : () => resolveFile(root, f.path) },
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
