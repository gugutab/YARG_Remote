import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSongs, serializeSongs, restoreSongs, resolveFile, mapLimit } from '../src/library.js';

// Minimal stand-in for a FileSystemDirectoryHandle tree: tree = { name: { 'file.txt': 'text' } | subtree }.
function fakeDir(tree) {
  return {
    async getDirectoryHandle(name) {
      const child = tree[name];
      if (!child || typeof child === 'string') throw new Error(`no folder ${name}`);
      return fakeDir(child);
    },
    async getFileHandle(name) {
      const child = tree[name];
      if (typeof child !== 'string') throw new Error(`no file ${name}`);
      return { getFile: async () => ({ name, text: async () => child, arrayBuffer: async () => new TextEncoder().encode(child).buffer }) };
    },
  };
}

const TREE = {
  Songs: {
    'Band - Song': { 'song.ini': '[song]\nname = Song\nartist = Band\n', 'notes.mid': 'MThd' },
  },
};

test('a saved index has no file handles and restores to readable files', async () => {
  const root = fakeDir(TREE.Songs); // the picked folder is "Songs", so paths start below it
  const entries = [
    { path: 'Songs/Band - Song/song.ini', getFile: () => resolveFile(root, 'Songs/Band - Song/song.ini') },
    { path: 'Songs/Band - Song/notes.mid', getFile: () => resolveFile(root, 'Songs/Band - Song/notes.mid') },
  ];
  const songs = await scanSongs(entries);
  assert.equal(songs.length, 1);

  const index = JSON.parse(JSON.stringify(serializeSongs(songs)));
  assert.equal(index[0].title, 'Song');
  assert.equal(index[0].artist, 'Band');

  const restored = restoreSongs(index, root);
  assert.equal(restored[0].title, 'Song');
  const ini = await restored[0].files.get('song.ini').getFile();
  assert.equal(await ini.text(), '[song]\nname = Song\nartist = Band\n');
  assert.ok(restored[0].files.has('notes.mid'));
});

test('resolveFile drops the picked folder name and follows the path under it', async () => {
  const root = fakeDir(TREE.Songs); // the picked folder is "Songs", so paths start below it
  const file = await resolveFile(root, 'Songs/Band - Song/notes.mid');
  assert.equal(await file.text(), 'MThd');
  await assert.rejects(resolveFile(root, 'Songs/Missing/notes.mid'));
});

// ---- bounded concurrency of the scan ----

// A directory handle whose files take a moment to open, counting how many opens overlap.
function slowTree(songs) {
  const stats = { inFlight: 0, peak: 0, opened: 0 };
  const file = (name, text) => ({
    kind: 'file', name,
    async getFile() {
      stats.inFlight++; stats.opened++;
      stats.peak = Math.max(stats.peak, stats.inFlight);
      await new Promise((r) => setTimeout(r, 2));
      stats.inFlight--;
      return { name, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
    },
  });
  const dir = (name, entries) => ({ kind: 'directory', name, async* values() { yield* entries; } });
  const packs = Array.from({ length: songs }, (_, i) => dir(`Song ${i}`, [file('song.ini', `[song]\nname = Title ${String(i).padStart(3, '0')}\n`), file('notes.mid', 'MThd')]));
  return { root: dir('Songs', packs), stats };
}

test('mapLimit keeps at most `limit` calls in flight, keeps the order and stops on the first error', async () => {
  const { mapLimit } = await import('../src/library.js');
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit(Array.from({ length: 40 }, (_, i) => i), 5, async (n) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, (n * 7) % 5));
    inFlight--;
    return n * 2;
  });
  assert.equal(peak, 5);
  assert.deepEqual(out, Array.from({ length: 40 }, (_, i) => i * 2));
  assert.deepEqual(await mapLimit([], 8, async () => 1), []);
  assert.deepEqual(await mapLimit([1, 2], 99, async (n) => n), [1, 2], 'limit above the item count');
  assert.deepEqual(await mapLimit([1, 2, 3], 0, async (n) => n), [1, 2, 3], 'a nonsense limit still runs (one at a time)');
  let started = 0;
  await assert.rejects(mapLimit(Array.from({ length: 50 }, (_, i) => i), 4, async (n) => {
    started++;
    await new Promise((r) => setTimeout(r, 1));
    if (n === 3) throw new Error('bad file');
    return n;
  }), /bad file/);
  assert.ok(started < 50, `stopped launching work after the failure (${started} started)`);
});

test('scanning a big library never has more than the concurrency limit of files open at once', async () => {
  const { walkHandle, SCAN_CONCURRENCY } = await import('../src/library.js');
  const { root, stats } = slowTree(200);
  const songs = await scanSongs(walkHandle(root, root.name));
  assert.equal(songs.length, 200);
  assert.equal(stats.opened, 200, 'one song.ini read per song, nothing else');
  assert.ok(stats.peak > 1 && stats.peak <= SCAN_CONCURRENCY, `peak ${stats.peak}`);
  assert.deepEqual(songs.map((s) => s.title), songs.map((s) => s.title).slice().sort(), 'sorted by title');
  assert.equal(songs[0].title, 'Title 000');
  assert.equal(songs[199].folder, 'Songs/Song 199');
  const { root: r2, stats: s2 } = slowTree(30);
  await scanSongs(walkHandle(r2, r2.name), { concurrency: 2 });
  assert.equal(s2.peak, 2);
});

test('a song.ini that cannot be read keeps the song listed (folder name) and the other songs load', async () => {
  const entries = [
    { path: 'S/a/song.ini', getFile: async () => { throw new Error('denied'); } },
    { path: 'S/b/song.ini', getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode('[song]\nname = B\n').buffer }) },
    { path: 'S/c/notes.mid', getFile: async () => { throw new Error('never read during the scan'); } },
  ];
  const songs = await scanSongs(entries);
  assert.deepEqual(songs.map((s) => s.title), ['a', 'B', 'c']);
  assert.deepEqual(songs[0].ini, {});
});

test('mapLimit still rejects on the first failing item', async () => {
  await assert.rejects(mapLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('boom'); return n; }), /boom/);
});
