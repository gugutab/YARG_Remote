// Keeps the picked songs folder (a FileSystemDirectoryHandle, which IndexedDB can store) and the scanned
// song index between visits. Every call fails soft: if storage is unavailable the app just works without it.
const DB_NAME = 'yarg-remote';
const STORE = 'library';
const THUMBS = 'thumbs'; // small album thumbnails (a Blob, or 'none' when the song has no cover) by song id
const KEY = 'current';

// Timeouts (ms) so a stalled or blocked IndexedDB never hangs the app: on expiry the call fails soft.
const timing = { open: 4000, tx: 8000 };
// Test hook: override the timeouts. Not used by the app.
export function configureStore(opts = {}) {
  if (opts.open != null) timing.open = opts.open;
  if (opts.tx != null) timing.tx = opts.tx;
  thumbDb = null;
}

// Opens the database. Rejects on error, on a missing indexedDB, or after timing.open (e.g. blocked by another tab
// holding an old version). A connection that arrives after the timeout is closed right away.
// The connection closes itself on versionchange so another tab can upgrade; callers then reopen lazily.
function open(onLost) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    const fail = (e) => { if (done) return; done = true; clearTimeout(timer); reject(e); };
    try {
      const req = indexedDB.open(DB_NAME, 2);
      timer = setTimeout(() => fail(new Error('indexedDB open timed out')), timing.open);
      req.onupgradeneeded = () => {
        for (const name of [STORE, THUMBS]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      };
      req.onblocked = () => { /* waits for the other tab to close; the timeout bounds it */ };
      req.onsuccess = () => {
        const db = req.result;
        if (done) { try { db.close(); } catch { /* already closed */ } return; }
        done = true;
        clearTimeout(timer);
        const lose = () => { try { db.close(); } catch { /* already closed */ } onLost?.(db); };
        db.onversionchange = lose;
        db.onclose = () => onLost?.(db);
        resolve(db);
      };
      req.onerror = () => fail(req.error || new Error('indexedDB open failed'));
    } catch (e) {
      fail(e);
    }
  });
}

// Runs one transaction on db. Settles exactly once: on complete, error, abort, a throw inside action, or timeout.
// closeAfter closes the connection on every path; onFail runs when the transaction did not complete.
function transact(db, storeName, mode, action, closeAfter, onFail) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    let tx = null;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (closeAfter) { try { db.close(); } catch { /* already closed */ } }
      if (err !== null) { onFail?.(); reject(err); } else resolve(value);
    };
    try {
      tx = db.transaction(storeName, mode);
      timer = setTimeout(() => {
        try { tx.abort(); } catch { /* already finished */ }
        finish(new Error('indexedDB transaction timed out'));
      }, timing.tx);
      const req = action(tx.objectStore(storeName));
      tx.oncomplete = () => finish(null, req ? req.result : undefined);
      tx.onerror = () => finish(tx.error || new Error('indexedDB transaction failed'));
      tx.onabort = () => finish(tx.error || new Error('indexedDB transaction aborted'));
    } catch (e) {
      try { tx?.abort(); } catch { /* not active */ }
      finish(e);
    }
  });
}

function run(mode, action) {
  return open().then((db) => transact(db, STORE, mode, action, true));
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
// The cached connection is dropped when it closes, changes version, or a transaction on it fails, so the next
// call reopens it.
let thumbDb = null;
function thumbConn() {
  if (!thumbDb) {
    const p = open((db) => { if (thumbDb === p) thumbDb = null; }).catch((e) => { if (thumbDb === p) thumbDb = null; throw e; });
    thumbDb = p;
  }
  return thumbDb;
}
function thumbRun(mode, action) {
  const conn = thumbConn();
  return conn.then((db) => transact(db, THUMBS, mode, action, false, () => {
    // A transaction that failed or hung may mean a dead connection: drop it and let the next call reopen.
    if (thumbDb === conn) thumbDb = null;
    try { db.close(); } catch { /* already closed */ }
  }));
}

export async function loadThumb(id) {
  try {
    return await thumbRun('readonly', (s) => s.get(id));
  } catch (_) {
    return undefined;
  }
}

export async function clearThumbs() {
  try {
    await thumbRun('readwrite', (s) => s.clear());
  } catch { /* nothing stored */ }
}

export async function saveThumb(id, blob) {
  try {
    await thumbRun('readwrite', (s) => s.put(blob, id));
  } catch (_) { /* thumbnails just get rebuilt next time */ }
}
