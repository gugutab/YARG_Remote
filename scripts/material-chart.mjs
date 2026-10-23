// A chart of the material styles of the WebGL note models (src/highway-gl.js: METAL_STYLES, GLASS_STYLES): each style rendered by the prototype page on the same notes and cut into
// one cell (a guitar note on top, a cymbal and a tom below), the cells laid out in a labelled sheet.
//   node scripts/material-chart.mjs [--round 1|2] [--url http://127.0.0.1:8080/] [--out prototypes/materials-chart.png] [--song "Folder/Artist - Title"] [--glow 0.7]
//        [--executable <chrome.exe>] [--playwright <dir of playwright-core>]
// The app must be running (npm start) with the song in its library. Round 1 has four parts: every metal with the first glass, every glass with the first metal, and the two golds
// (satin, polished) with every glass. Round 2 (--round 2) is the next batch: the later metals and glasses, with the candy gel / satin stainless and the satin gold the choice fell on, and every
// style of a cymbal's coloured top. Cell labels are "M<metal index> G<glass index>: names", the numbers the prototype's ?metal= / ?glass= take.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const base = (args.url || 'http://127.0.0.1:8080/').replace(/\/?$/, '/');
const out = path.resolve(args.out || 'prototypes/materials-chart.png');
const song = args.song || 'Rock Band 1/Black Sabbath (WaveGroup) - Paranoid';
const glow = args.glow || '0.7';
const round = Number(args.round || 1);
const GUITAR = { x: 130, y: 465, width: 400, height: 100 }; // (CSS px of a 1500 x 860 window with a guitar and a drums pane at 62.2 s)
const DRUMS = { x: 900, y: 340, width: 480, height: 220 };

const candidates = [args.playwright, process.env.PLAYWRIGHT_CORE, 'C:/Users/GuguTab/Documents/Work/L1 - Sistema/node_modules/playwright-core', path.join(process.cwd(), 'node_modules/playwright-core')].filter(Boolean);
let pw = null;
for (const c of candidates) { try { pw = (await import(pathToFileURL(path.join(c, 'index.js')).href)).default; break; } catch { /* next */ } }
if (!pw) { console.error('playwright-core not found: pass --playwright <dir> or set PLAYWRIGHT_CORE'); process.exit(2); }
const executablePath = args.executable || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

const browser = await pw.chromium.launch({ executablePath, headless: false, args: ['--window-position=0,0'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 860 }, deviceScaleFactor: 2 })).newPage();
const mid = encodeURIComponent(`/songs/${song}/notes.mid`).replace(/%2F/g, '%2F');
await page.goto(`${base}prototypes/webgl-fretboard.html?midi=${mid}&parts=guitar,drums-pro&diff=3&at=62.2&paused=1&fx=solid&model=yarg&glow=${glow}`);
await page.waitForTimeout(4500);
const names = async (id) => page.$$eval(`#${id} option`, (os) => os.map((o) => o.textContent.replace(/^\d+: /, '')));
const metals = await names('metal'), glasses = await names('glass'), cymbals = await names('cymbal');
const cell = async (m, g, cy = 1) => {
  await page.evaluate(([mm, gg, cc]) => { document.getElementById('metal').value = String(mm); document.getElementById('glass').value = String(gg); document.getElementById('cymbal').value = String(cc); }, [m, g, cy]);
  await page.waitForTimeout(450);
  const shot = async (clip) => (await page.screenshot({ clip })).toString('base64');
  return { label: `M${m} G${g}${round === 2 && cy !== 1 ? ` C${cy}` : ''}`, text: `${metals[m]} + ${glasses[g]}${round === 2 && cy !== 1 ? ` + cymbal: ${cymbals[cy]}` : ''}`, guitar: await shot(GUITAR), drums: await shot(DRUMS) };
};
const sections = [];
const section = async (title, specs) => { const cells = []; for (const [m, g, cy] of specs) cells.push(await cell(m, g, cy)); sections.push({ title, cells }); };
if (round === 2) {
  const satin = 0, gold = metals.indexOf('Satin gold'), gel = glasses.indexOf('Candy gel');
  const later = (list, from) => list.map((_, i) => i).filter((i) => i >= from);
  const firstNewMetal = metals.indexOf('Titanium'), firstNewGlass = glasses.indexOf('Jelly');
  await section('New metals (glass: ' + glasses[gel] + ')', [[satin, gel], [gold, gel], ...later(metals, firstNewMetal).map((m) => [m, gel])]);
  await section('New glasses (metal: ' + metals[satin] + ')', [[satin, gel], ...later(glasses, firstNewGlass).map((g) => [satin, g])]);
  await section('New glasses (metal: ' + metals[gold] + ')', [[gold, gel], ...later(glasses, firstNewGlass).map((g) => [gold, g])]);
  await section('Cymbal tops (notes: ' + metals[satin] + ' + ' + glasses[gel] + ')', cymbals.map((_, cy) => [satin, gel, cy]));
} else {
  const satinGold = metals.indexOf('Satin gold'), polishedGold = metals.indexOf('Polished gold');
  await section('Metal styles (glass: ' + glasses[0] + ')', metals.slice(0, 10).map((_, m) => [m, 0]));
  await section('Glass styles (metal: ' + metals[0] + ')', glasses.slice(0, 6).map((_, g) => [0, g]));
  await section('Satin gold with every glass', glasses.slice(0, 6).map((_, g) => [satinGold, g]));
  await section('Polished gold with every glass', glasses.slice(0, 6).map((_, g) => [polishedGold, g]));
}
await page.close();

const html = `<!doctype html><meta charset="utf-8"><style>
body { margin: 0; background: #0b0e16; color: #dfe3ee; font: 14px system-ui, sans-serif; padding: 20px; width: 1000px; }
h2 { margin: 26px 0 10px; font-size: 18px; font-weight: 600; }
.grid { display: grid; grid-template-columns: 480px 480px; gap: 16px; }
.cell { background: #131722; border: 1px solid #232838; border-radius: 10px; padding: 8px; }
.cell img { display: block; width: 464px; margin-top: 4px; border-radius: 6px; }
.cell b { color: #fff; font-weight: 600; margin-right: 8px; }
</style><body><h1 style="margin:0 0 4px;font-size:22px">YARG note models: material styles (round ${round})</h1><div style="color:#8b909a">M = the metal, G = the glass: ?metal=&lt;M&gt;&amp;glass=&lt;G&gt; in webgl-fretboard.html</div>
${sections.map((s) => `<h2>${s.title}</h2><div class="grid">${s.cells.map((c) => `<div class="cell"><b>${c.label}</b>${c.text}<img src="data:image/png;base64,${c.guitar}"><img src="data:image/png;base64,${c.drums}"></div>`).join('')}</div>`).join('')}</body>`;
const sheet = await (await browser.newContext({ viewport: { width: 1040, height: 800 }, deviceScaleFactor: 1 })).newPage();
await sheet.setContent(html);
await sheet.waitForTimeout(800);
fs.mkdirSync(path.dirname(out), { recursive: true });
await sheet.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${sections.reduce((n, s) => n + s.cells.length, 0)} cells`);
