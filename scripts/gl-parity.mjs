// Parity check of the WebGL fretboards (src/highway-gl.js) against the 2D canvas code: the same song, instruments and time drawn with ?renderer=canvas and ?renderer=webgl,
// the stage of each saved as a PNG and compared. Writes <out>/<scene>-canvas.png, -webgl.png and -side.png (canvas | webgl | difference x4) and prints the mean absolute
// difference per channel (0-255) and the share of pixels that differ by more than 40. It is a picture to LOOK at, not a pass / fail: the two will never be identical (the
// WebGL fade is computed per pixel, the 2D one with a gradient, the sprites are mip-mapped), so a regression shows as a jump in the numbers.
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
const PARANOID = 'Rock Band 1/Black Sabbath (WaveGroup) - Paranoid';
const HIGHWAY_STAR = 'Rock Band 1/Deep Purple - Highway Star';
const BRING_ME = 'Band Hero/Evanescence - Bring Me To Life'; // (open notes on the bass, taps on the guitar, accents on the 5-lane drums)
// song: the folder (default --song); t: seconds; i: instruments; set: settings ids -> values (localStorage) for this scene
const SCENES = [
  { name: 'three-panes', t: 62.1, i: THREE }, // held sustains on the guitar, a drum fill band, kick and cymbals
  { name: 'sustains', t: 86.5, i: 'guitar:expert,bass:expert' },
  { name: 'drums-kick', t: 40, i: 'drums-pro:expert,guitar:expert' },
  { name: 'intro', t: 12, i: THREE },
  { name: 'star-power', t: 14.4, i: THREE }, // star power bands and notes
  { name: 'solo', t: 92, i: 'guitar:expert,bass:expert' }, // the solo band
  { name: 'fill-lead', t: 19.2, i: 'drums-pro:expert,guitar:expert' }, // a drum fill band and its activation note approaching
  { name: 'fill-hit', t: 19.85, i: 'drums-pro:expert,guitar:expert' }, // ... the activation note just hit: the kit lit
  { name: 'bre-rolls', t: 352, song: HIGHWAY_STAR, i: 'guitar:expert,drums-pro:expert,bass:expert' }, // big rock ending and trill / tremolo rolls
  { name: 'accent-drums', t: 98.9, song: BRING_ME, i: 'drums-five:easy,guitar:easy' }, // accents on a 5-lane kit
  { name: 'open-bass', t: 61.4, song: BRING_ME, i: 'bass:medium,drums-five:easy' }, // open notes
  { name: 'tap-guitar', t: 4.9, song: BRING_ME, i: 'guitar:easy,bass:easy' }, // tap notes
  { name: 'left-handed', t: 62.1, i: THREE, set: { 'highway.leftHanded': true } },
  { name: 'curve-0', t: 62.1, i: THREE, set: { 'highway.curve': 0 } },
  { name: 'curve-100', t: 62.1, i: THREE, set: { 'highway.curve': 100 } },
  { name: 'no-hitline', t: 62.1, i: THREE, set: { 'highway.hitLine': false, 'highway.padLook': 150 } },
  { name: 'held-off', t: 62.1, i: THREE, set: { 'highway.heldPulse': false } }, // the held motion off: still waves, chevrons and glow
  { name: 'ext-drums-pads', t: 62.1, i: 'drums-extended:expert,guitar:expert', set: { 'highway.hitLine': false } }, // the 7-lane kit: triangle pads on the cymbal lanes
  ...(args.scenes ? JSON.parse(args.scenes) : []),
].filter((s) => !args.scene || String(args.scene).split(',').includes(s.name));

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
      if (scene.set) await page.addInitScript((vals) => { try { const k = 'yargremote.settings'; localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), ...vals })); } catch { /* ignore */ } }, scene.set);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${url}?renderer=${renderer}#/song/${encodeURIComponent(scene.song || song)}/play?i=${scene.i}&t=${scene.t}`);
      await page.waitForFunction(() => document.getElementById('stage') && !document.querySelector('.app.stage-loading'), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      // the start screen (the song details card) counts down to the autostart: once the song is loaded (the Play button says 'Play'), Space cancels the countdown and
      // pauses the song at the link's time; the card is then closed or fading, and hidden anyway so that a slow machine cannot leave it over one picture only
      await page.waitForFunction(() => document.getElementById('siPlayText')?.textContent === 'Play' && !document.getElementById('siPlay').classList.contains('loading'), null, { timeout: 60000 }).catch(() => {});
      await page.keyboard.press('Space');
      await page.waitForTimeout(1200);
      if (await page.evaluate(() => document.getElementById('play').getAttribute('aria-label') === 'Pause')) { await page.keyboard.press('Space'); await page.waitForTimeout(800); } // (paused, whatever the autostart did)
      await page.evaluate((t) => { const s = document.getElementById('seek'); s.value = t; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); }, scene.t); // (the exact time, the same in both)
      await page.waitForTimeout(3500); // (the seek animation)
      await page.addStyleTag({ content: '#songInfo, .song-info, #pauseDim, .pause-dim { display: none !important; }' });
      await page.waitForTimeout(1500);
      await page.waitForTimeout(800);
      if (args.debug) console.log(await page.evaluate(() => { let n = document.elementFromPoint(300, 250); const c = []; while (n && c.length < 5) { c.push(`${n.tagName}#${n.id}.${n.className}`); n = n.parentElement; } return `${document.querySelector('.app').className} | ${c.join(' < ')}`; }));
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
console.log(`mean of the scene means: ${(results.reduce((a, r) => a + r.meanAbsDiff, 0) / Math.max(1, results.length)).toFixed(2)}`);
console.log(`pictures in ${out}`);
