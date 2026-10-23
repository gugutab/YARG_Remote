// Packs note meshes (binary FBX, see fbx-to-json.mjs) into one small JSON file for the WebGL board (src/highway-gl.js, setMeshes):
//   node scripts/pack-note-meshes.mjs <dir with the .fbx files> <out.json>
// Each mesh becomes { pos, nrm, uv, role, tex, size }: per triangle corner, positions / normals in the mesh's own space (x across, y depth, z up), uv with the v axis
// flipped for a top-left image origin, `role` the material of the corner (0 metal, 1 lane colour, 2 white, 3 dark: by the material's name), `size` the half extents of
// the mesh, `tex` the texture it samples (by the model's kind). Numbers are rounded to 3 decimals.
import fs from 'node:fs';
import path from 'node:path';
import { fbxMeshes } from './fbx-to-json.mjs';

const KINDS = { n: 'NormalNote', h: 'HOPONote', t: 'TapNote', a: 'AccentNote', g: 'GhostNote', c: 'CymbalNote', ca: 'CymbalAccentNote', cg: 'CymbalGhostNote' };
const roleOf = (name) => (/color/i.test(name) ? 1 : /hopo/i.test(name) ? 2 : /tap/i.test(name) ? 3 : 0);
const [dir, outFile] = process.argv.slice(2);
if (!dir || !outFile) { console.error('usage: node scripts/pack-note-meshes.mjs <dir with .fbx> <out.json>'); process.exit(2); }
const r3 = (v) => Math.round(v * 1000) / 1000;
const out = {};
for (const [kind, file] of Object.entries(KINDS)) {
  const [m] = fbxMeshes(fs.readFileSync(path.join(dir, `${file}.fbx`)));
  const roles = m.materials.flatMap((slot) => { const r = roleOf(m.materialNames[slot] ?? ''); return [r, r, r]; });
  const half = [0, 0, 0];
  for (let i = 0; i < m.positions.length; i += 3) for (let a = 0; a < 3; a++) half[a] = Math.max(half[a], Math.abs(m.positions[i + a]));
  out[kind] = { pos: m.positions.map(r3), nrm: m.normals.map(r3), uv: m.uvs.map((v, i) => r3(i % 2 ? 1 - v : v)), role: roles, tex: kind[0] === 'c' ? 'CymbalNote' : 'NormalNote', size: half.map(r3) };
}
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`${outFile}: ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB, ${Object.keys(out).length} meshes`);
