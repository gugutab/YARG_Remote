import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, scanLibrary, safeJoin } from '../server.mjs';

function makeLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-songs-'));
  fs.mkdirSync(path.join(dir, 'Pack', 'Band - Song'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Pack', 'Band - Song', 'song.ini'), '[song]\nname = Nice Song\nartist = Band\ngenre = Rock\n');
  fs.writeFileSync(path.join(dir, 'Pack', 'Band - Song', 'notes.mid'), 'MThd');
  fs.writeFileSync(path.join(dir, 'Pack', 'Band - Song', 'song.ogg'), '0123456789');
  fs.mkdirSync(path.join(dir, 'Empty'));
  return dir;
}

async function withServer(fn) {
  const songsDir = makeLibrary();
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-app-'));
  fs.writeFileSync(path.join(appRoot, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(appRoot, 'secret.txt'), 'no');
  const server = createServer({ songsDir, appRoot });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, songsDir);
  } finally {
    server.close();
    fs.rmSync(songsDir, { recursive: true, force: true });
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
}

test('scanLibrary finds song folders and reads song.ini', async () => {
  const dir = makeLibrary();
  const songs = await scanLibrary(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(songs.length, 1);
  assert.equal(songs[0].title, 'Nice Song');
  assert.equal(songs[0].id, 'Pack/Band - Song');
  assert.deepEqual(songs[0].files.map((f) => f.path).sort(),
    ['Pack/Band - Song/notes.mid', 'Pack/Band - Song/song.ini', 'Pack/Band - Song/song.ogg']);
});

test('safeJoin rejects paths that leave the base', () => {
  const base = path.resolve('/tmp/base');
  assert.equal(safeJoin(base, '../etc/passwd'), null);
  assert.equal(safeJoin(base, '%2e%2e%2fetc'), null);
  assert.ok(safeJoin(base, 'a/b.ogg').startsWith(base));
});

test('serves the index, files with ranges, and only whitelisted app files', async () => {
  await withServer(async (base) => {
    const lib = await (await fetch(`${base}/api/library`)).json();
    assert.equal(lib.songs[0].artist, 'Band');
    const file = `${base}/songs/Pack/Band%20-%20Song/song.ogg`;
    assert.equal(await (await fetch(file)).text(), '0123456789');
    const part = await fetch(file, { headers: { Range: 'bytes=2-4' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), '234');
    assert.equal((await fetch(`${base}/songs/%2e%2e/x`)).status >= 400, true);
    assert.equal((await fetch(`${base}/secret.txt`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 200);
  });
});

test('numeric song.ini names stay strings', async () => {
  const dir = makeLibrary();
  fs.writeFileSync(path.join(dir, 'Pack', 'Band - Song', 'song.ini'), '[song]\nname = 1999\nartist = 311\n');
  const [song] = await scanLibrary(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(song.title, '1999');
  assert.equal(song.artist, '311');
});
