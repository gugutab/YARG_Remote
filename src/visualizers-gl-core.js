// The shared pieces of the WebGL visualizers (visualizers-gl-classic.js, visualizers-gl-stage.js): the full-screen quad and the fragment shader header (units: the stage's CSS px,
// y down; `u_sc` is the canvas pixels per unit), `program()` to compile and link, and small helpers.
export const TAU = Math.PI * 2;
export const fract = (v) => v - Math.floor(v);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const n255 = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];

export const HEAD = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_sc;
`;
// a full-screen quad in the visualizer's units (y down)
export const VS_FULL = `${HEAD}out vec2 v_p;
void main() { vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)); gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0); v_p = vec2(c.x, 1.0 - c.y) * u_res; }`;
export const FS_HEAD = `${HEAD}in vec2 v_p; out vec4 o;
const float TAU = 6.2831853;
float cov(float d, float hw) { float aa = 0.5 / u_sc; return 1.0 - smoothstep(hw - aa, hw + aa, d); }
void over(inout vec4 acc, vec3 c, float a) { acc.rgb = c * a + acc.rgb * (1.0 - a); acc.a = a + acc.a * (1.0 - a); }
`;

export function program(gl, name, vs, fs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(s)}`); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
  return { p, u, a: (n) => gl.getAttribLocation(p, n) };
}
