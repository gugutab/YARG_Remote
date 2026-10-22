// Frame-time benchmark of the stage in a real browser (Firefox by default, Chromium to compare), through Playwright.
//   node scripts/bench-browser.mjs [--browser firefox|chromium] [--view 3d|2d] [--seconds 6] [--runs 3]
//        [--song "Folder/Artist - Title"] [--instrument drums-five:expert] [--at 70] [--throttle 4] [--settings '{"perf.fpsCap":"60"}']
//        [--url http://localhost:8091/] [--headless] [--executable <path to firefox.exe>] [--playwright <dir of playwright-core>] [--snippet]
// It opens the app in a fresh context (muted, onboarding off), starts the song at --at seconds, wraps requestAnimationFrame to time the
// app's callback, and prints per run: average fps, 1% low fps, frames over 20 ms, the callback's mean / p95 ms and stage draws per second and how far the song advanced (about --seconds when it is really playing).
// --snippet prints a console snippet that measures the same thing in YOUR OWN browser (paste it in the devtools console while a song plays).
// playwright-core is not a dependency of this repo: it is looked for in --playwright, $PLAYWRIGHT_CORE, or the usual places on this machine.
// Playwright's Firefox is a build with patches; --executable can point at the installed Firefox, but only the Playwright one is driven reliably.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));

const SNIPPET = `(async () => { // paste in the devtools console while a song is playing
  const secs = 6, d = [], cb = []; let last = performance.now(); const t0 = last;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (f) => raf.call(window, (ts) => { const a = performance.now(); f(ts); cb.push(performance.now() - a); });
  await new Promise((res) => { const tick = (n) => { d.push(n - last); last = n; (n - t0 < secs * 1000) ? raf.call(window, tick) : res(); }; raf.call(window, tick); });
  window.requestAnimationFrame = raf;
  const s = [...d].sort((x, y) => x - y), c = [...cb].sort((x, y) => x - y), avg = (v) => v.reduce((x, y) => x + y, 0) / v.length;
  const low = s.slice(Math.floor(s.length * 0.99));
  console.table({ fps: +(1000 / avg(d)).toFixed(1), fps1pctLow: +(1000 / avg(low)).toFixed(1), over20ms: d.filter((x) => x > 20).length, cbMeanMs: +avg(cb).toFixed(2), cbP95Ms: +c[Math.floor(c.length * 0.95)].toFixed(2), draws: window.__yargDraws });
})();`;
if (args.snippet) { console.log(SNIPPET); process.exit(0); }

const candidates = [args.playwright, process.env.PLAYWRIGHT_CORE,
  'C:/Users/GuguTab/Documents/Work/L1 - Sistema/node_modules/playwright-core', 'C:/Users/GuguTab/Documents/Work/L1/node_modules/playwright-core',
  path.join(process.cwd(), 'node_modules/playwright-core')].filter(Boolean);
let pw = null;
for (const c of candidates) { try { pw = (await import(pathToFileURL(path.join(c, 'index.js')).href)).default; break; } catch { /* next */ } }
if (!pw) { console.error('playwright-core not found: pass --playwright <dir> or set PLAYWRIGHT_CORE'); process.exit(2); }

const kind = args.browser || 'firefox';
const seconds = Number(args.seconds || 6), runs = Number(args.runs || 3), at = Number(args.at ?? 70), throttle = Number(args.throttle || 1);
const view = args.view || '3d';
const base = (args.url || 'http://localhost:8091/').replace(/\/?$/, '/');
const song = args.song || 'Guitar Hero 5 DLC/Lynyrd Skynyrd - Free Bird';
const instrument = args.instrument || 'drums-five:expert';
const url = `${base}#/song/${encodeURIComponent(song)}/play?i=${instrument}&t=${at}`;
const settings = { 'playback.linkAutoplay': false, 'playback.songInfoOverlay': false, 'highway.view': view, ...(args.settings ? JSON.parse(args.settings) : {}) };

const launchOpts = { headless: !!args.headless };
if (args.executable) launchOpts.executablePath = args.executable;
const browser = await pw[kind].launch(launchOpts);
console.log(`${kind} ${browser.version()}  ${view}  ${instrument}  t=${at}s  ${seconds}s x ${runs}  cpu x${throttle}  settings ${JSON.stringify(settings)}`);

const measure = async (page) => page.evaluate(async (secs) => {
  const d = [], cb = []; const raf = window.requestAnimationFrame.bind(window); let last = performance.now(); const t0 = last;
  const orig = window.requestAnimationFrame;
  window.requestAnimationFrame = (f) => raf((ts) => { const a = performance.now(); f(ts); cb.push(performance.now() - a); });
  const draws0 = window.__yargDraws || 0, seek0 = Number(document.getElementById('seek')?.value);
  await new Promise((res) => { const tick = (n) => { d.push(n - last); last = n; (n - t0 < secs * 1000) ? raf(tick) : res(); }; raf(tick); });
  window.requestAnimationFrame = orig;
  const sorted = [...d].sort((x, y) => x - y), cs = [...cb].sort((x, y) => x - y), avg = (v) => v.reduce((x, y) => x + y, 0) / (v.length || 1);
  const low = sorted.slice(Math.floor(sorted.length * 0.99));
  return { fps: +(1000 / avg(d)).toFixed(1), fps1pctLow: +(1000 / avg(low)).toFixed(1), over20ms: d.filter((x) => x > 20).length, cbMeanMs: +avg(cb).toFixed(2), cbP95Ms: +(cs[Math.floor(cs.length * 0.95)] || 0).toFixed(2), drawsPerSec: +(((window.__yargDraws || 0) - draws0) / secs).toFixed(0), songAdvancedS: +(Number(document.getElementById('seek')?.value) - seek0).toFixed(1) };
}, seconds);

// --variants '[{"name":"aurora","settings":{"highway.visualizer":"aurora"}}, ...]': each variant runs `runs` times on top of the base settings (rows are named by variant);
// a run where the song did not really play is repeated (up to 3 times).
const variants = args.variants ? JSON.parse(args.variants) : [{ name: 'base', settings: {} }];
const rows = [];
let tries = 0;
for (const v of variants) {
  const vs = { ...settings, ...v.settings };
  for (let r = 0; r < runs; r++) {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 760 } });
    try {
      await ctx.addInitScript((s) => { try { localStorage.setItem('yargremote.master', '0.02'); localStorage.setItem('yargremote.onboarded', '1'); localStorage.setItem('yargremote.settings', JSON.stringify(s)); } catch { /* storage blocked */ } }, vs);
      const page = await ctx.newPage();
      await page.goto(url);
      await page.waitForFunction(() => document.getElementById('seek') && !document.getElementById('seek').disabled, null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(8000);
      if (throttle > 1 && kind === 'chromium') { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
      const from = Number(await page.evaluate(() => document.getElementById('seek').value));
      for (let attempt = 0; attempt < 3; attempt++) { // (a click only while the button reads Play: a second one would pause it)
        if (/^play/i.test(await page.evaluate(() => document.getElementById('play').getAttribute('aria-label') || ''))) await page.click('#play');
        const moved = await page.waitForFunction((f) => Number(document.getElementById('seek').value) > f + 1, from, { timeout: 15000 }).then(() => true, () => false);
        if (moved) break;
      }
      const row = await measure(page);
      if (row.songAdvancedS < seconds * 0.8 && tries++ < 3) { r--; continue; }
      tries = 0;
      rows.push({ variant: v.name, ...row });
    } catch (e) { rows.push({ variant: v.name, error: String(e).slice(0, 120) }); } finally { await ctx.close(); }
  }
}
console.table(rows);
await browser.close();
if (throttle > 1 && kind !== 'chromium') console.log('(CPU throttling is only applied in Chromium; in Firefox use the real machine or a slower profile.)');
