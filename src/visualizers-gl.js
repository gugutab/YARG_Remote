// The WebGL 2 background visualizers of the page. The ports: visualizers-gl-classic.js (Beat rings, Aurora, Warp: ports of the 2D ones) and visualizers-gl-stage.js (the rest);
// the shared pieces: visualizers-gl-core.js. createVizGl() wraps them for the page: a WebGL canvas that replaces the 2D background canvas while one of them is selected
// (Highway.setVizGl).
import { ringsPort, auroraPort, warpPort } from './visualizers-gl-classic.js';
import { STAGE_PORTS } from './visualizers-gl-stage.js';
import { STAGE2_PORTS } from './visualizers-gl-stage2.js';

export const PORTS = { rings: ringsPort, aurora: auroraPort, warp: warpPort, ...STAGE_PORTS, ...STAGE2_PORTS };

// ---- The page's background layer ------------------------------------------------------------------------------------------------------------------------------

// Is this visualizer drawn with WebGL? The ports are cheap on the GPU (and much dearer in 2D), so 'auto' picks them wherever WebGL 2 works, not only on big screens;
// 'canvas' keeps the 2D code, 'webgl' and 'auto' use the port. Every other visualizer stays 2D.
export const usesVizGl = (renderer, id) => renderer !== 'canvas' && Object.hasOwn(PORTS, id);

// createVizGl({ canvas, driver }) -> { canvas, wants(renderer), draw(w, h, t, bgRgb), clear() }
// `canvas` is the WebGL twin of #bgCanvas (same place, same size: Highway.drawBackground sizes it); `driver` is the visualizer driver (createDriver), which keeps the
// song data and the shared state. The context is made on the first use; if WebGL 2 is missing or the context is lost, wants() stays false and the 2D path takes over.
export function createVizGl({ canvas, driver }) {
  let gl = null;
  let dead = false;
  let ports = {};
  const layer = {
    canvas,
    get ok() { return !!gl && !dead; },
    wants(renderer) {
      if (dead || !usesVizGl(renderer, driver.id)) return false;
      if (!gl) {
        try {
          gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
        } catch { gl = null; }
        if (!gl) { dead = true; return false; }
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); dead = true; ports = {}; }, { once: true }); // (the 2D code takes over for good)
      }
      return true;
    },
    // Draws the selected visualizer at time t on the canvas, already sized by the caller: the canvas pixels per unit are canvas.width / w. False if nothing was drawn.
    draw(w, h, t, bgRgb) {
      if (!layer.ok) return false;
      try {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.enable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const sc = canvas.width / w;
        if (!driver.prepare(w, h, t, bgRgb, sc)) return true; // (no song yet: a blank canvas, as the 2D one)
        (ports[driver.id] ??= PORTS[driver.id](gl)).draw(driver.state, driver.data, w, h, sc);
        return true;
      } catch (err) {
        dead = true; // never take the whole chart down with a background
        console.error('WebGL visualizer failed:', err);
        return false;
      }
    },
    clear() {
      if (!layer.ok) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
  };
  return layer;
}
