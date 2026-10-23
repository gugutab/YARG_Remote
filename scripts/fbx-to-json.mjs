// Converts the meshes of a binary FBX file (7.x) to JSON triangles: { name, positions, normals, uvs, materials, triangles }.
//   node scripts/fbx-to-json.mjs <file.fbx> [more.fbx ...] > meshes.json        (one object per file, keyed by the file's base name)
// Only what a note model needs is read: the Geometry nodes (Vertices, PolygonVertexIndex, the normal / UV / material layers) and the Model's name and local transform.
// Polygons are triangulated as fans. Normals and UVs are expanded to one entry per polygon corner (ByPolygonVertex), so the output arrays are all per corner:
//   positions [x,y,z ...] / normals / uvs: one entry per triangle corner, in triangle order (3 corners per triangle);  materials: one slot index per triangle.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function readFbx(buf) {
  if (buf.toString('latin1', 0, 18) !== 'Kaydara FBX Binary') throw new Error('not a binary FBX file');
  const version = buf.readUInt32LE(23);
  const wide = version >= 7500; // the offsets are 64 bit from 7.5
  let pos = 27;
  const readU = () => { if (wide) { const v = Number(buf.readBigUInt64LE(pos)); pos += 8; return v; } const v = buf.readUInt32LE(pos); pos += 4; return v; };
  function readProp() {
    const t = String.fromCharCode(buf[pos++]);
    switch (t) {
      case 'Y': { const v = buf.readInt16LE(pos); pos += 2; return v; }
      case 'C': return buf[pos++] !== 0;
      case 'I': { const v = buf.readInt32LE(pos); pos += 4; return v; }
      case 'F': { const v = buf.readFloatLE(pos); pos += 4; return v; }
      case 'D': { const v = buf.readDoubleLE(pos); pos += 8; return v; }
      case 'L': { const v = Number(buf.readBigInt64LE(pos)); pos += 8; return v; }
      case 'S': { const n = buf.readUInt32LE(pos); pos += 4; const v = buf.toString('utf8', pos, pos + n); pos += n; return v; }
      case 'R': { const n = buf.readUInt32LE(pos); pos += 4; const v = buf.subarray(pos, pos + n); pos += n; return v; }
      case 'f': case 'd': case 'l': case 'i': case 'b': {
        const len = buf.readUInt32LE(pos), enc = buf.readUInt32LE(pos + 4), clen = buf.readUInt32LE(pos + 8);
        pos += 12;
        let data = buf.subarray(pos, pos + clen);
        pos += clen;
        if (enc === 1) data = zlib.inflateSync(data);
        const out = t === 'f' ? new Float32Array(len) : t === 'd' ? new Float64Array(len) : t === 'i' ? new Int32Array(len) : t === 'l' ? new Array(len) : new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          out[i] = t === 'f' ? data.readFloatLE(i * 4) : t === 'd' ? data.readDoubleLE(i * 8) : t === 'i' ? data.readInt32LE(i * 4) : t === 'l' ? Number(data.readBigInt64LE(i * 8)) : data[i];
        }
        return out;
      }
      default: throw new Error(`unknown property type ${t} at ${pos}`);
    }
  }
  function readNode() {
    const end = readU(), numProps = readU(), propsLen = readU(); // (propsLen is not needed: the properties are read one by one)
    void propsLen;
    const nameLen = buf[pos++];
    if (end === 0) return null;
    const name = buf.toString('latin1', pos, pos + nameLen);
    pos += nameLen;
    const props = [];
    for (let i = 0; i < numProps; i++) props.push(readProp());
    const children = [];
    while (pos < end) { const c = readNode(); if (c) children.push(c); }
    pos = end;
    return { name, props, children };
  }
  const roots = [];
  while (pos < buf.length - 32) { const n = readNode(); if (!n) break; roots.push(n); }
  return { version, roots };
}

const child = (node, name) => node.children.find((c) => c.name === name);
const children = (node, name) => node.children.filter((c) => c.name === name);

// The triangles of one Geometry node.
export function geometryToTriangles(geo) {
  const verts = child(geo, 'Vertices').props[0];
  const poly = child(geo, 'PolygonVertexIndex').props[0];
  const normalLayer = child(geo, 'LayerElementNormal');
  const uvLayer = child(geo, 'LayerElementUV');
  const matLayer = child(geo, 'LayerElementMaterial');
  const normals = normalLayer && child(normalLayer, 'Normals').props[0];
  const normalIdx = normalLayer && child(normalLayer, 'NormalsIndex')?.props[0];
  const uvs = uvLayer && child(uvLayer, 'UV').props[0];
  const uvIdx = uvLayer && child(uvLayer, 'UVIndex')?.props[0];
  const mats = matLayer && child(matLayer, 'Materials')?.props[0];
  const matMap = matLayer && child(matLayer, 'MappingInformationType')?.props[0];
  const out = { positions: [], normals: [], uvs: [], materials: [] };
  let corner = 0, polyIndex = 0, start = 0;
  const cornerData = (c, vi) => ({
    p: [verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]],
    n: normals ? (() => { const i = normalIdx ? normalIdx[c] : c; return [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]; })() : [0, 1, 0],
    t: uvs ? (() => { const i = uvIdx ? uvIdx[c] : c; return [uvs[i * 2], uvs[i * 2 + 1]]; })() : [0, 0],
  });
  for (let i = 0; i < poly.length; i++) {
    if (poly[i] >= 0) continue;
    const idx = Array.from(poly.slice(start, i + 1)).map((v, k, a) => (k === a.length - 1 ? ~v : v));
    const cs = idx.map((vi, k) => cornerData(start + k, vi));
    const slot = mats ? (matMap === 'AllSame' ? mats[0] : mats[polyIndex]) : 0;
    for (let k = 1; k + 1 < cs.length; k++) {
      for (const c of [cs[0], cs[k], cs[k + 1]]) { out.positions.push(...c.p); out.normals.push(...c.n); out.uvs.push(...c.t); }
      out.materials.push(slot);
    }
    start = i + 1;
    polyIndex++;
    corner++;
  }
  void corner;
  return out;
}

// Every Geometry of the file with the name of its Model and the model's local transform (Lcl Translation / Rotation / Scaling) and its material names.
export function fbxMeshes(buf) {
  const { roots } = readFbx(buf);
  const objects = roots.find((n) => n.name === 'Objects');
  const connections = roots.find((n) => n.name === 'Connections');
  const byId = new Map();
  for (const o of objects.children) byId.set(o.props[0], o);
  const links = children(connections, 'C').map((c) => ({ kind: c.props[0], child: c.props[1], parent: c.props[2] }));
  const out = [];
  for (const geo of children(objects, 'Geometry')) {
    const link = links.find((l) => l.child === geo.props[0]);
    const model = link && byId.get(link.parent);
    const mats = model ? links.filter((l) => l.parent === model.props[0] && byId.get(l.child)?.name === 'Material').map((l) => byId.get(l.child).props[1].split('\0')[0]) : [];
    const tr = {};
    const p70 = model && child(model, 'Properties70');
    if (p70) for (const p of p70.children) if (['Lcl Translation', 'Lcl Rotation', 'Lcl Scaling'].includes(p.props[0])) tr[p.props[0]] = [p.props[4], p.props[5], p.props[6]];
    out.push({ name: model ? model.props[1].split('\0')[0] : geo.props[1], materialNames: mats, transform: tr, ...geometryToTriangles(geo) });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node scripts/fbx-to-json.mjs <file.fbx> ...'); process.exit(2); }
  const result = {};
  for (const f of files) result[path.basename(f, '.fbx')] = fbxMeshes(fs.readFileSync(f));
  process.stdout.write(JSON.stringify(result));
}
