import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSng, bufferSource, blobSource, readSngBytes, findSngFile } from '../src/sng.js';
import { scanSongs, serializeSongs, restoreSongs, audioStemsOf, findCover } from '../src/library.js';
import { createServer, scanLibrary } from '../server.mjs';
import { writeSng } from './sng-writer.js';
import { buildMidi, tempo120, trackName, event, on, off } from './smf.js';

const big = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7 + 3) & 0xff); // longer than the 256 byte mask
const sample = () => writeSng({
  metadata: { name: 'Sng Song', artist: 'The Band', year: '1999', delay: '-120' },
  files: { 'notes.mid': [1, 2, 3], 'Song.ogg': big, 'album.png': [9, 8, 7, 6] },
});

test('parses header, metadata (like parseSongIni) and index', async () => {
  const sng = await parseSng(bufferSource(sample()));
  assert.equal(sng.version, 1);
  assert.deepEqual(sng.metadata, { name: 'Sng Song', artist: 'The Band', year: 1999, delay: -120 });
  assert.deepEqual(sng.files.map((f) => [f.name, f.size]), [['notes.mid', 3], ['Song.ogg', 1000], ['album.png', 4]]);
});

test('reads masked files back, whole and by range, from a buffer and a Blob', async () => {
  const bytes = sample();
  for (const source of [bufferSource(bytes), blobSource(new Blob([bytes]))]) {
    const sng = await parseSng(source);
    assert.deepEqual([...await readSngBytes(source, sng, findSngFile(sng, 'SONG.OGG'))], [...big]);
    assert.deepEqual([...await readSngBytes(source, sng, findSngFile(sng, 'song.ogg'), 250, 270)], [...big.subarray(250, 270)]);
    assert.deepEqual([...await readSngBytes(source, sng, findSngFile(sng, 'notes.mid'))], [1, 2, 3]);
  }
});

test('the stored data really is masked', () => {
  const bytes = sample();
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(!Buffer.from(bytes).includes(Buffer.from(big.subarray(0, 32))));
  assert.ok(text.startsWith('SNGPKG'));
});

test('rejects a file that is not an sng, or is cut short', async () => {
  await assert.rejects(parseSng(bufferSource(new TextEncoder().encode('NOTSNG-and-more-bytes-here-to-fill-the-header'))));
  await assert.rejects(parseSng(bufferSource(sample().subarray(0, 40))));
});

const entry = (p, bytes) => ({ path: p, getFile: async () => new File([bytes], p.split('/').pop()) });

test('scanSongs turns a .sng into one song whose files are read lazily', async () => {
  const songs = await scanSongs([entry('Pack/Band - Sng.sng', sample()), entry('Pack/other/readme.txt', 'x')]);
  assert.equal(songs.length, 1);
  const s = songs[0];
  assert.equal(s.id, 'Pack/Band - Sng.sng');
  assert.equal(s.title, 'Sng Song');
  assert.equal(s.artist, 'The Band');
  assert.equal(s.ini.year, 1999);
  assert.deepEqual([...s.files.keys()].sort(), ['album.png', 'notes.mid', 'song.ogg']);
  assert.equal(findCover(s).name, 'album.png');
  assert.equal(audioStemsOf(s)[0].id, 'Song.ogg');
  const f = await s.files.get('song.ogg').getFile();
  assert.deepEqual([...new Uint8Array(await f.arrayBuffer())], [...big]);
  const index = JSON.parse(JSON.stringify(serializeSongs(songs)));
  assert.equal(index.find((i) => i.id === s.id).files[0].sng, 'Pack/Band - Sng.sng');
});

test('restoreSongs resolves sng inner files through the .sng file', async () => {
  const songs = await scanSongs([entry('Root/a.sng', sample())]);
  const index = serializeSongs(songs);
  const root = { getFileHandle: async (n) => ({ getFile: async () => new File([sample()], n) }) };
  const restored = restoreSongs(index, root);
  const f = await restored[0].files.get('notes.mid').getFile();
  assert.deepEqual([...new Uint8Array(await f.arrayBuffer())], [1, 2, 3]);
});

test('server indexes .sng songs (with parts) and serves inner files with ranges', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-sng-'));
  try {
    fs.mkdirSync(path.join(dir, 'Pack'));
    const mid = buildMidi(480, [[event(0, trackName('T')), tempo120()], [event(0, trackName('PART GUITAR')), on(0, 96), off(100, 96)]]);
    fs.writeFileSync(path.join(dir, 'Pack', 'x.sng'), writeSng({ metadata: { name: 'Served' }, files: { 'notes.mid': mid, 'song.ogg': big } }));
    fs.writeFileSync(path.join(dir, 'Pack', 'broken.sng'), 'garbage');
    const songs = await scanLibrary(dir);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].id, 'Pack/x.sng');
    assert.equal(songs[0].title, 'Served');
    assert.deepEqual(songs[0].parts, ['guitar']);
    const server = createServer({ songsDir: dir });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const res = await fetch(`${base}/songs/Pack/x.sng/song.ogg`);
      assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...big]);
      const part = await fetch(`${base}/songs/Pack/x.sng/Song.ogg`, { headers: { Range: 'bytes=250-269' } });
      assert.equal(part.status, 206);
      assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...big.subarray(250, 270)]);
      assert.equal((await fetch(`${base}/songs/Pack/x.sng/nope.png`)).status, 404);
      assert.equal((await fetch(`${base}/songs/..%2F..%2Fx.sng/a`)).status, 403);
    } finally {
      server.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
