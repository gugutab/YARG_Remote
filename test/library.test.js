import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSongs, serializeSongs, restoreSongs, resolveFile } from '../src/library.js';

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
      return { getFile: async () => ({ name, text: async () => child }) };
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
