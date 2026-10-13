import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveLibrary, loadLibrary, clearLibrary, saveThumb, loadThumb, clearThumbs, configureStore } from '../src/store.js';

// Small fake indexedDB. behavior: 'ok' | 'hang' | 'blocked' | 'open-error'; txMode: 'ok' | 'hang' | 'error' | 'quota' | 'throw'.
function fakeIDB(cfg = {}) {
  const data = { library: new Map(), thumbs: new Map() };
  const state = { opens: 0, closes: 0, dbs: [], ...cfg };
  state.data = data;
  state.indexedDB = {
    open() {
      state.opens++;
      const req = {};
      setTimeout(() => {
        if (state.behavior === 'hang') return;
        if (state.behavior === 'blocked') { req.onblocked?.(); return; }
        if (state.behavior === 'open-error') { req.error = new Error('denied'); req.onerror?.(); return; }
        const db = {
          objectStoreNames: { contains: () => true },
          close() { state.closes++; },
          transaction(name) {
            if (state.txMode === 'throw') throw new Error('InvalidStateError');
            const tx = {
              abort() { tx.error = null; tx.onabort?.(); },
              objectStore() {
                const m = data[name];
                const mk = (fn) => (...a) => {
                  const r = {};
                  setTimeout(() => {
                    if (state.txMode === 'hang') return;
                    if (state.txMode === 'quota') { tx.error = Object.assign(new Error('full'), { name: 'QuotaExceededError' }); tx.onabort?.(); return; }
                    if (state.txMode === 'error') { tx.error = new Error('boom'); tx.onerror?.(); return; }
                    r.result = fn(...a);
                    tx.oncomplete?.();
                  }, 0);
                  return r;
                };
                return {
                  put: mk((v, k) => { m.set(k, v); return k; }),
                  get: mk((k) => m.get(k)),
                  delete: mk((k) => { m.delete(k); }),
                  clear: mk(() => { m.clear(); }),
                };
              },
            };
            return tx;
          },
        };
        state.dbs.push(db);
        req.result = db;
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  return state;
}

const saved = globalThis.indexedDB;
beforeEach(() => configureStore({ open: 40, tx: 40 }));
afterEach(() => { globalThis.indexedDB = saved; configureStore({ open: 4000, tx: 8000 }); });

test('works against a healthy store and closes the library connection', async () => {
  const f = fakeIDB({ behavior: 'ok', txMode: 'ok' });
  globalThis.indexedDB = f.indexedDB;
  assert.equal(await saveLibrary({ a: 1 }), true);
  assert.deepEqual(await loadLibrary(), { a: 1 });
  assert.equal(f.closes, f.opens);
});

test('an open that never fires times out and fails soft', async () => {
  globalThis.indexedDB = fakeIDB({ behavior: 'hang' }).indexedDB;
  assert.equal(await saveLibrary({}), false);
  assert.equal(await loadLibrary(), null);
  await clearLibrary();
  assert.equal(await loadThumb('x'), undefined);
  await saveThumb('x', 1);
  await clearThumbs();
});

test('a blocked open fails soft after the timeout', async () => {
  globalThis.indexedDB = fakeIDB({ behavior: 'blocked' }).indexedDB;
  assert.equal(await loadLibrary(), null);
});

test('an open error fails soft', async () => {
  globalThis.indexedDB = fakeIDB({ behavior: 'open-error' }).indexedDB;
  assert.equal(await saveLibrary({}), false);
});

test('a hung transaction times out, aborts and closes the connection', async () => {
  const f = fakeIDB({ behavior: 'ok', txMode: 'hang' });
  globalThis.indexedDB = f.indexedDB;
  assert.equal(await saveLibrary({}), false);
  assert.equal(f.closes, f.opens);
});

test('a request error fails soft and closes the connection', async () => {
  const f = fakeIDB({ behavior: 'ok', txMode: 'error' });
  globalThis.indexedDB = f.indexedDB;
  assert.equal(await loadLibrary(), null);
  assert.equal(f.closes, f.opens);
});

test('quota errors on writes return false / do not throw', async () => {
  const f = fakeIDB({ behavior: 'ok', txMode: 'quota' });
  globalThis.indexedDB = f.indexedDB;
  assert.equal(await saveLibrary({ big: true }), false);
  await saveThumb('x', 1);
});

test('an exception inside the transaction closes the connection', async () => {
  const f = fakeIDB({ behavior: 'ok', txMode: 'throw' });
  globalThis.indexedDB = f.indexedDB;
  assert.equal(await saveLibrary({}), false);
  assert.equal(f.closes, f.opens);
});

test('missing indexedDB fails soft everywhere', async () => {
  globalThis.indexedDB = undefined;
  assert.equal(await saveLibrary({}), false);
  assert.equal(await loadLibrary(), null);
  await clearLibrary();
  assert.equal(await loadThumb('x'), undefined);
  await saveThumb('x', 1);
  await clearThumbs();
});

test('the thumbs connection is reused, and reopened after versionchange', async () => {
  const f = fakeIDB({ behavior: 'ok', txMode: 'ok' });
  globalThis.indexedDB = f.indexedDB;
  await saveThumb('a', 'blob');
  assert.equal(await loadThumb('a'), 'blob');
  assert.equal(f.opens, 1);
  f.dbs[0].onversionchange(); // another tab wants to upgrade
  assert.equal(f.closes, 1);
  assert.equal(await loadThumb('a'), 'blob');
  assert.equal(f.opens, 2);
});

test('the thumbs connection recovers after a failed open', async () => {
  const f = fakeIDB({ behavior: 'hang' });
  globalThis.indexedDB = f.indexedDB;
  assert.equal(await loadThumb('a'), undefined);
  f.behavior = 'ok'; f.txMode = 'ok';
  await saveThumb('a', 'blob');
  assert.equal(await loadThumb('a'), 'blob');
});

test('the thumbs connection is dropped after a hung transaction', async () => {
  const f = fakeIDB({ behavior: 'ok', txMode: 'hang' });
  globalThis.indexedDB = f.indexedDB;
  assert.equal(await loadThumb('a'), undefined);
  f.txMode = 'ok';
  await saveThumb('a', 'blob');
  assert.equal(f.opens, 2);
  assert.equal(await loadThumb('a'), 'blob');
});
