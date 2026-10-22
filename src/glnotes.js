// EXPERIMENTAL (prototype, setting highway.webgl3d): the cached note-head pictures of the 3D view drawn by WebGL2 instead of one drawImage each.
// gfx.js sprite3D renders every head variant once into its Canvas 2D atlas pages (unchanged); with this on, it hands each placement here instead of
// calling drawImage. The atlas pages are mirrored into one TEXTURE_2D_ARRAY (a layer per page, re-uploaded when a page changed) and all the heads of a
// pane are drawn as instanced quads in ONE draw call, then the result is composited (drawImage of the GL canvas) into the pane's 2D layer right where
// the heads would have been drawn, so the layering with tails, hit line, burst and the edge fades stays exactly as before. Whatever the cache cannot
// hold (kick/open bars, held or fading notes, big heads when highway.fast3dNotes is off) never reaches here and is drawn directly.
export const INST_FLOATS = 10; // dest x, y, w, h (layer device px), source x, y, w, h (atlas px), page, alpha
export const PAGE_PX = 1024;

// Pure: writes one instance at index i of `buf` (a Float32Array of INST_FLOATS per instance).
export function packInstance(buf, i, dx, dy, dw, dh, sx, sy, sw, sh, page, alpha) {
  const o = i * INST_FLOATS;
  buf[o] = dx; buf[o + 1] = dy; buf[o + 2] = dw; buf[o + 3] = dh;
  buf[o + 4] = sx; buf[o + 5] = sy; buf[o + 6] = sw; buf[o + 7] = sh;
  buf[o + 8] = page; buf[o + 9] = alpha;
  return buf;
}

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aDst;
layout(location=2) in vec4 aSrc;
layout(location=3) in vec2 aPA;
uniform vec2 uRes;
out vec3 vUV;
out float vAlpha;
void main() {
  vec2 p = aDst.xy + aCorner * aDst.zw;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  vUV = vec3((aSrc.xy + aCorner * aSrc.zw) / ${PAGE_PX}.0, aPA.x);
  vAlpha = aPA.y;
}`;
const FS = `#version 300 es
precision mediump float;
uniform mediump sampler2DArray uTex;
in vec3 vUV;
in float vAlpha;
out vec4 o;
void main() { o = texture(uTex, vUV) * vAlpha; }`;

let enabled = false;
let st = null; // { gl, canvas, prog, vao, buf, tex, ver, cap, lost } once created
let failed = false;
let target = null; // { g, pagesOf } while a pane's heads are being collected
let count = 0;
let data = new Float32Array(INST_FLOATS * 512);
export const stats = { draws: 0, instances: 0, uploads: 0, glMs: 0 };

export function setWebgl3d(on) { enabled = !!on; }

function init(maxPages) {
  if (failed) return null;
  if (st) return st.lost ? null : st; // (a lost context: Canvas 2D from now on; a reload brings it back)
  try {
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('no webgl2');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const stride = INST_FLOATS * 4;
    for (const [loc, size, off] of [[1, 4, 0], [2, 4, 16], [3, 2, 32]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, PAGE_PX, PAGE_PX, maxPages);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // (premultiplied, like the 2D canvas)
    st = { gl, canvas, prog, vao, buf, tex, uRes: gl.getUniformLocation(prog, 'uRes'), ver: [], cap: 0, lost: false };
    canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); st.lost = true; });
    return st;
  } catch {
    failed = true;
    st = null;
    return null;
  }
}

// Start collecting the heads of the pane drawn on 2D context `g` (its layer). `pagesOf()` returns the atlas pages ({ canvas, ver }[]).
export function beginHeads(g, pagesOf, maxPages) {
  target = null;
  count = 0;
  if (!enabled || failed || !init(maxPages)) return;
  target = { g, pagesOf };
}

// Called by sprite3D instead of drawImage. True when taken.
export function pushHead(g, pageIndex, sx, sy, sw, sh, dx, dy, dw, dh, alpha) {
  if (!target || target.g !== g) return false;
  if ((count + 1) * INST_FLOATS > data.length) { const d = new Float32Array(data.length * 2); d.set(data); data = d; }
  packInstance(data, count++, dx, dy, dw, dh, sx, sy, sw, sh, pageIndex, alpha);
  return true;
}

// Draw what was collected and composite it into the layer (call before drawing anything else that must lie over the heads).
export function flushHeads() {
  if (!target || count === 0) return;
  const { g } = target;
  const s = st;
  if (!s || s.lost) { count = 0; return; }
  const t0 = performance.now();
  const { gl, canvas } = s;
  const W = g.canvas.width, H = g.canvas.height;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(s.uRes, W, H);
  const pages = target.pagesOf();
  for (let i = 0; i < pages.length; i++) {
    if (s.ver[i] === pages[i].ver) continue;
    s.ver[i] = pages[i].ver;
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, PAGE_PX, PAGE_PX, 1, gl.RGBA, gl.UNSIGNED_BYTE, pages[i].canvas);
    stats.uploads++;
  }
  const need = count * INST_FLOATS * 4;
  if (need > s.cap) { s.cap = Math.max(need, s.cap * 2); gl.bufferData(gl.ARRAY_BUFFER, s.cap, gl.DYNAMIC_DRAW); }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * INST_FLOATS);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  stats.draws++;
  stats.instances += count;
  const m = g.getTransform();
  const a = g.globalAlpha;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.drawImage(canvas, 0, 0);
  g.globalAlpha = a;
  g.setTransform(m);
  count = 0;
  stats.glMs += performance.now() - t0;
}

export function endHeads() {
  flushHeads();
  target = null;
}
