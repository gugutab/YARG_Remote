// Frame-time benchmark in the REAL installed Firefox (its own GPU settings), driven over WebDriver BiDi: no Playwright, no geckodriver.
//   node scripts/bench-firefox-bidi.mjs [--view 3d|2d] [--seconds 6] [--runs 2] [--song "Folder/Artist - Title"] [--instrument drums-five:expert]
//        [--at 70] [--variants '[{"name":"x","settings":{}}]'] [--callprof] [--settings '{"perf.fpsCap":"60"}'] [--url http://localhost:8091/] [--firefox "C:/Program Files/Mozilla Firefox/firefox.exe"] [--port 9223]
// It starts a separate Firefox with a throw-away profile (your open Firefox is not touched), opens the app with the same setup as
// scripts/bench-browser.mjs, clicks Play with a real pointer event, waits for the song to move and prints the same table.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const seconds = Number(args.seconds || 6), runs = Number(args.runs || 2), at = Number(args.at ?? 70), port = Number(args.port || 9223);
const base = (args.url || 'http://localhost:8091/').replace(/\/?$/, '/');
const song = args.song || 'Guitar Hero 5 DLC/Lynyrd Skynyrd - Free Bird';
const instrument = args.instrument || 'drums-five:expert';
const settings = { 'playback.linkAutoplay': false, 'playback.songInfoOverlay': false, 'highway.view': args.view || '3d', ...(args.settings ? JSON.parse(args.settings) : {}) };
const exe = args.firefox || 'C:/Program Files/Mozilla Firefox/firefox.exe';
const songUrl = `${base}#/song/${encodeURIComponent(song)}/play?i=${instrument}&t=${at}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-ff-'));
fs.writeFileSync(path.join(profile, 'user.js'), 'user_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("datareporting.policy.dataSubmissionEnabled", false);\nuser_pref("browser.aboutwelcome.enabled", false);\nuser_pref("browser.startup.homepage_override.mstone", "ignore");\nuser_pref("media.autoplay.default", 0);\n');
const ff = spawn(exe, ['-no-remote', '-profile', profile, '--remote-debugging-port', String(port), 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { ff.kill(); } catch { /* gone */ } setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1500); };
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws = null;
for (let i = 0; i < 60 && !ws; i++) {
  await sleep(500);
  try { ws = await new Promise((res, rej) => { const s = new WebSocket(`ws://127.0.0.1:${port}/session`); s.onopen = () => res(s); s.onerror = () => rej(new Error('no ws')); }); } catch { /* not up yet */ }
}
if (!ws) { console.error('could not reach Firefox on the BiDi port'); cleanup(); process.exit(2); }
let nextId = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.type === 'error' ? rej(new Error(`${m.error}: ${m.message}`)) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

await send('session.new', { capabilities: {} });
const tree = await send('browsingContext.getTree', {});
const context = tree.contexts[0].context;
const evalJs = async (expression) => {
  const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
  if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const goto = (url) => send('browsingContext.navigate', { context, url, wait: 'complete' });
const clickPlay = async () => { // a real pointer click on the Play button (a scripted click leaves the AudioContext suspended)
  const r = JSON.parse(await evalJs(`(() => { const b = document.getElementById('play').getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }); })()`));
  await send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: r.x, y: r.y }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
};
await send('browsingContext.setViewport', { context, viewport: { width: 1300, height: 760 } }).catch(() => {});

const MEASURE = `(async () => {
  const secs = ${seconds}, d = [], cb = []; const raf = window.requestAnimationFrame.bind(window); const orig = window.requestAnimationFrame;
  let last = performance.now(); const t0 = last; const draws0 = window.__yargDraws || 0, seek0 = Number(document.getElementById('seek')?.value);
  window.requestAnimationFrame = (f) => raf((ts) => { const a = performance.now(); f(ts); cb.push(performance.now() - a); });
  await new Promise((res) => { const tick = (n) => { d.push(n - last); last = n; (n - t0 < secs * 1000) ? raf(tick) : res(); }; raf(tick); });
  window.requestAnimationFrame = orig;
  const s = [...d].sort((x, y) => x - y), c = [...cb].sort((x, y) => x - y), avg = (v) => v.reduce((x, y) => x + y, 0) / (v.length || 1);
  const low = s.slice(Math.floor(s.length * 0.99));
  return JSON.stringify({ fps: +(1000 / avg(d)).toFixed(1), fps1pctLow: +(1000 / avg(low)).toFixed(1), over20ms: d.filter((x) => x > 20).length, cbMeanMs: +avg(cb).toFixed(2), cbP95Ms: +(c[Math.floor(c.length * 0.95)] || 0).toFixed(2), drawsPerSec: +(((window.__yargDraws || 0) - draws0) / secs).toFixed(0), songAdvancedS: +(Number(document.getElementById('seek')?.value) - seek0).toFixed(1) });
})()`;

console.log(`real Firefox ${settings['highway.view']}  ${instrument}  t=${at}s  ${seconds}s x ${runs}  settings ${JSON.stringify(settings)}`);
// --variants '[{"name":"economy","settings":{"perf.economy":true}}, ...]': each variant runs `runs` times on top of the base settings, one table row each.
// --callprof: wraps the 2D context's methods and prints the 12 most expensive ones (total ms per measured second, calls per second) for the last run.
const variants = args.variants ? JSON.parse(args.variants) : [{ name: 'base', settings: {} }];
const CALLPROF = `(() => { const P = CanvasRenderingContext2D.prototype; window.__cp = {}; for (const k of Object.getOwnPropertyNames(P)) { const d = Object.getOwnPropertyDescriptor(P, k); if (typeof d.value !== 'function') continue; const f = d.value; P[k] = function (...a) { const t = performance.now(); const r = f.apply(this, a); let key = k; if (k === 'drawImage' && a[0]) { const area = a.length >= 9 ? a[3] * a[4] : a.length >= 5 ? a[3] * a[4] : (a[0].width || 0) * (a[0].height || 0); key = 'drawImage ' + a[0].constructor.name + (area > 100000 ? ' LARGE copy (>100k px)' : area > 5000 ? ' medium copy' : ' small copy (sprite)'); } const e = window.__cp[key] || (window.__cp[key] = { n: 0, ms: 0 }); e.n++; e.ms += performance.now() - t; return r; }; } window.__cpOn = true; })()`;
const rows = [];
let profRows = null;
let tries = 0;
for (const v of variants) {
  const vs = { ...settings, ...v.settings };
  for (let r = 0; r < runs; r++) {
    try {
      await goto('about:blank'); await goto(base);
      await evalJs(`localStorage.setItem('yargremote.master','0.02'); localStorage.setItem('yargremote.onboarded','1'); localStorage.setItem('yargremote.settings', ${JSON.stringify(JSON.stringify(vs))}); 1`);
      await goto('about:blank'); await goto(songUrl);
      for (let i = 0; i < 80; i++) { await sleep(500); if (await evalJs(`Number(document.getElementById('seek')?.value) >= ${at - 0.5}`).catch(() => false)) break; }
      for (let i = 0; i < 60; i++) { if (await evalJs(`!document.getElementById('play').disabled && document.getElementById('loadScreen')?.hidden !== false`).catch(() => false)) break; await sleep(500); } // (wait for the audio to load)
      await sleep(5000);
      const from = Number(await evalJs(`document.getElementById('seek').value`));
      for (let attempt = 0; attempt < 3; attempt++) { // (a click only while the button reads Play: a second one would pause it)
        if (/^play/i.test(await evalJs(`document.getElementById('play').getAttribute('aria-label') || ''`))) await clickPlay();
        let moved = false;
        for (let i = 0; i < 30 && !moved; i++) { await sleep(500); moved = Number(await evalJs(`document.getElementById('seek').value`)) > from + 1; }
        if (moved) break;
      }
      if (args.callprof) await evalJs(CALLPROF + '; 1');
      const row = JSON.parse(await evalJs(MEASURE));
      if (row.songAdvancedS < seconds * 0.8 && tries++ < 3) { r--; continue; } // (the song was not playing: not a valid run, again)
      tries = 0;
      rows.push({ variant: v.name, ...row });
      if (args.callprof) {
        const cp = JSON.parse(await evalJs(`JSON.stringify(window.__cp)`));
        profRows = Object.entries(cp).map(([k, e]) => ({ call: k, callsPerSec: Math.round(e.n / seconds), msPerSec: +(e.ms / seconds).toFixed(1) })).sort((x, y) => y.msPerSec - x.msPerSec).slice(0, 12);
      }
    } catch (e) { rows.push({ variant: v.name, error: String(e).slice(0, 120) }); }
  }
}
console.table(rows);
if (profRows) { console.log('2D context calls (last run, per second of measuring; the timer itself adds a little):'); console.table(profRows); }
const info = await evalJs(`(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return navigator.userAgent + ' | GPU: ' + (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'); })()`).catch(() => '');
console.log(info);
cleanup();
process.exit(0);
