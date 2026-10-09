// Keeps the picked songs folder (a FileSystemDirectoryHandle, which IndexedDB can store) and the scanned
// song index between visits. Every call fails soft: if storage is unavailable the app just works without it.
const DB_NAME = 'yarg-remote';
const STORE = 'library';
const THUMBS = 'thumbs'; // small album thumbnails (a Blob, or 'none' when the song has no cover) by song id
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      for (const name of [STORE, THUMBS]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, action) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

export async function saveLibrary(record) {
  try {
    await run('readwrite', (store) => store.put(record, KEY));
    return true;
  } catch (_) {
    return false;
  }
}

export async function loadLibrary() {
  try {
    return (await run('readonly', (store) => store.get(KEY))) || null;
  } catch (_) {
    return null;
  }
}

export async function clearLibrary() {
  try {
    await run('readwrite', (store) => store.delete(KEY));
  } catch (_) { /* nothing stored */ }
}

// Thumbnails: many small reads and writes, so the connection stays open (unlike the library calls above).
let thumbDb = null;
function thumbConn() {
  thumbDb ??= open().catch((e) => { thumbDb = null; throw e; });
  return thumbDb;
}
function thumbRun(mode, action) {
  return thumbConn().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBS, mode);
    const req = action(tx.objectStore(THUMBS));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export async function loadThumb(id) {
  try {
    return await thumbRun('readonly', (s) => s.get(id));
  } catch (_) {
    return undefined;
  }
}

export async function saveThumb(id, blob) {
  try {
    await thumbRun('readwrite', (s) => s.put(blob, id));
  } catch (_) { /* thumbnails just get rebuilt next time */ }
}
