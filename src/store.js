// Keeps the picked songs folder (a FileSystemDirectoryHandle, which IndexedDB can store) and the scanned
// song index between visits. Every call fails soft: if storage is unavailable the app just works without it.
const DB_NAME = 'yarg-remote';
const STORE = 'library';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
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
