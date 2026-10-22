// Parity check of the WebGL fretboards (src/highway-gl.js) against the 2D canvas code: the same song, instruments and time drawn with ?renderer=canvas and ?renderer=webgl,
// the stage of each saved as a PNG and compared. Writes <out>/<scene>-canvas.png, -webgl.png and -side.png (canvas | webgl | difference x4) and prints the mean absolute
// difference per channel (0-255) and the share of pixels that differ by more than 40. It is a picture to LOOK at, not a pass / fail: the two will never be identical (the
// WebGL fade is computed per pixel, the 2D one with a gradient; the fill activation mark is not drawn by the board), so a regression shows as a jump in the numbers.
//   node scripts/gl-parity.mjs [--url http://127.0.0.1:8080/] [--out _parity] [--song "Folder/Artist - Title"] [--scene name] [--size 1500x860]
//        [--executable <chrome.exe>] [--playwright <dir of playwright-core>]
// The app must be running (npm start) over a songs folder that has the song. Scenes (see SCENES) are a time and a list of instruments; more can be passed as
// --scenes '[{"name":"x","t":10,"i":"guitar:expert,drums-pro:expert"}]'.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const url = (args.url || 'http://127.0.0.1:8080/').replace(/\/?$/, '/');
const song = args.song || 'Rock Band 1/Black Sabbath (WaveGroup) - Paranoid';
const [W, H] = String(args.size || '1500x860').split('x').map(Number);
const out = path.resolve(args.out || '_parity');
const THREE = 'guitar:expert,bass:expert,drums-pro:expert';
const SCENES = [
  { name: 'three-panes', t: 62.1, i: THREE }, // held sustains on the guitar, a drum fill band, kick and cymbals
  { name: 'sustains', t: 86.5, i: 'guitar:expert,bass:expert' },
  { name: 'drums-kick', t: 40, i: 'drums-pro:expert,guitar:expert' },
  { name: 'intro', t: 12, i: THREE },
  ...(args.scenes ? JSON.parse(args.scenes) : []),
].filter((s) => !args.scene || s.name === args.scene);

const candidates = [args.playwright, process.env.PLAYWRIGHT_CORE, 'C:/Users/GuguTab/Documents/Work/L1 - Sistema/node_modules/playwright-core', path.join(process.cwd(), 'node_modules/playwright-core')].filter(Boolean);
let pw = null;
for (const c of candidates) { try { pw = (await import(pathToFileURL(path.join(c, 'index.js')).href)).default; break; } catch { /* next */ } }
if (!pw) { console.error('playwright-core not found: pass --playwright <dir> or set PLAYWRIGHT_CORE'); process.exit(2); }
const executablePath = args.executable || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
fs.mkdirSync(out, { recursive: true });

const browser = await pw.chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
try {
  for (const scene of SCENES) {
    const shots = {};
    for (const renderer of ['canvas', 'webgl']) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${url}?renderer=${renderer}#/song/${encodeURIComponent(song)}/play?i=${scene.i}&t=${scene.t}`);
      await page.waitForFunction(() => document.getElementById('stage') && !document.querySelector('.app.stage-loading'), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(7000); // (the song paused at the link's time: the browser keeps the audio from starting without a gesture)
      await page.keyboard.press('Space'); await page.waitForTimeout(600); // (starts / pauses: the song details that cover the stage close; the audio is held back, so the time stays)
      shots[renderer] = await page.locator('#stage').screenshot();
      if (errors.length) console.warn(`${scene.name} ${renderer}: ${errors[0]}`);
      await ctx.close();
    }
    fs.writeFileSync(path.join(out, `${scene.name}-canvas.png`), shots.canvas);
    fs.writeFileSync(path.join(out, `${scene.name}-webgl.png`), shots.webgl);
    // the comparison runs in a page: decoding a PNG needs no dependency there
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const r = await page.evaluate(async ([a, b]) => {
      const load = (b64) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = `data:image/png;base64,${b64}`; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = ia.width, h = ia.height;
      const px = (im) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, w, h); };
      const da = px(ia), db = px(ib);
      const side = document.createElement('canvas'); side.width = w * 3; side.height = h;
      const sg = side.getContext('2d');
      sg.drawImage(ia, 0, 0); sg.drawImage(ib, w, 0);
      const diff = sg.createImageData(w, h);
      let sum = 0, over = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const d = (Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2])) / 3;
        sum += d;
        if (d > 40) over++;
        const v = Math.min(255, d * 4);
        diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = v; diff.data[i + 3] = 255;
      }
      sg.putImageData(diff, w * 2, 0);
      return { mean: sum / (w * h), over: over / (w * h), png: side.toDataURL('image/png').split(',')[1] };
    }, [shots.canvas.toString('base64'), shots.webgl.toString('base64')]);
    await ctx.close();
    fs.writeFileSync(path.join(out, `${scene.name}-side.png`), Buffer.from(r.png, 'base64'));
    results.push({ scene: scene.name, t: scene.t, meanAbsDiff: +r.mean.toFixed(2), pixelsOver40: `${(r.over * 100).toFixed(2)}%` });
  }
} finally { await browser.close(); }
console.table(results);
console.log(`pictures in ${out}`);
