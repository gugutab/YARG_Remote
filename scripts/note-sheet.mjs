// A contact sheet of every kind of note the app draws, with its variations, rendered by the app itself (WebGL, in a real browser), as one PNG.
//   node scripts/note-sheet.mjs [--out _shots/note-sheet.png] [--styles rect,round] [--notes3d yarg|own|off] [--scale 2] [--cols 3]
//        [--only guitar,drums-five,drums-pro] [--rows "HOPO,Tap,Open"] [--executable <path to chrome>] [--playwright <dir of playwright-core>] [--keep] [--port 8199]
// It writes two small synthetic songs to a temporary folder (a guitar and a 5-lane drum chart; a Pro drum chart), serves them with the app's own server.mjs, opens each instrument in
// each note style (--rows keeps only the rows whose label contains one of the words, to show just the notes a change touches), pauses on one row of notes at a time (a row = one kind of note across the lanes) and takes a picture of the board. The pictures are put in a labelled grid.
// Nothing of a real song is used. playwright-core is not a dependency of this repo: it is looked for in --playwright, $PLAYWRIGHT_CORE and the usual places on this machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const out = path.resolve(args.out || path.join(ROOT, '_shots', 'note-sheet.png'));
const styles = String(args.styles || 'rect,round').split(',').filter(Boolean);
const notes3d = args.notes3d || 'yarg';
const scale = Number(args.scale || 2);
const cols = Number(args.cols || 3);
const only = args.only ? String(args.only).split(',') : null;
const rowWords = args.rows ? String(args.rows).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean) : null;
const port = Number(args.port || 8199);

const { buildMidi, tempo120, trackName, event } = await import(pathToFileURL(path.join(ROOT, 'test', 'smf.js')).href);

// ---- the charts ---------------------------------------------------------------------------------------------------------------------------------------------------
const RES = 480, SEC = 960, ROW = 5 * SEC, STEP = 288; // (120 bpm: 960 ticks a second; a row every 5 s; the notes of a row 0.3 s apart)
const START = 3 * SEC;
const sysexOpen = (difficulty, value) => [0xf0, 8, 0x50, 0x53, 0x00, 0x00, difficulty, 0x01, value, 0xf7];
// notes: { tick, pitch, len, vel }, raw: { tick, bytes }
function track(name, notes, raw = []) {
  const evs = [];
  for (const n of notes) { evs.push({ tick: n.tick, order: 1, bytes: [0x90, n.pitch, n.vel ?? 100] }); evs.push({ tick: n.tick + (n.len ?? 60), order: 0, bytes: [0x80, n.pitch, 0] }); }
  for (const r of raw) evs.push({ tick: r.tick, order: 2, bytes: r.bytes });
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const events = [tempo120(), { dt: 0, bytes: trackName(name) }];
  let last = 0;
  for (const e of evs) { events.push(event(e.tick - last, e.bytes)); last = e.tick; }
  return events;
}
// A row is built from its start tick; it returns notes + raw events. `pitches` are MIDI pitches, all at the start unless `chord: false` (then STEP ticks apart).
function rowOf(start, pitches, { chord = true, len = 60, vel, window = [], open = false } = {}) { // (a chord by default: every lane of the row at the same moment, so the whole row is in view)
  const notes = pitches.map((pitch, i) => ({ tick: start + (chord ? 0 : i * STEP), pitch, len, vel }));
  const span = chord ? len : (pitches.length - 1) * STEP + len;
  const raw = [];
  const marks = [];
  for (const w of window) marks.push({ tick: start - 20, pitch: w, len: span + 40 });
  if (open) { raw.push({ tick: start - 10, bytes: sysexOpen(0x03, 1) }, { tick: start + span + 10, bytes: sysexOpen(0x03, 0) }); }
  return { notes: [...notes, ...marks], raw };
}

const GUITAR = [96, 97, 98, 99, 100];
const guitarRows = [
  ['Note', GUITAR, {}],
  ['HOPO', GUITAR, { window: [101] }],
  ['Tap', GUITAR, { window: [104] }],
  ['Star power', GUITAR, { window: [116] }],
  ['Star power HOPO', GUITAR, { window: [116, 101] }],
  ['Star power tap', GUITAR, { window: [116, 104] }],
  ['Sustain', GUITAR, { len: 720 }],
  ['Star power sustain', GUITAR, { len: 720, window: [116] }],
  ['Open note', [96], { open: true }],
  ['Open sustain', [96], { open: true, len: 900 }],
  ['Star power open', [96], { open: true, window: [116] }],
];
// 5-lane drums: 96 kick, 97 red, 98 yellow, 99 blue, 100 orange, 101 green (its presence makes the chart 5-lane)
const PADS5 = [97, 98, 99, 100, 101];
const drums5Rows = [
  ['Pads', PADS5, {}],
  ['Accent', PADS5, { vel: 127 }],
  ['Ghost', PADS5, { vel: 1 }],
  ['Star power pads', PADS5, { window: [116] }],
  ['Kick', [96], {}],
  ['Double kick', [96, 95], { chord: false }],
  ['Kick + pads', [96, 97, 98, 99, 100, 101], {}],
  ['Star power kick', [96], { window: [116] }],
];
// Pro drums: 97 red, 98 yellow, 99 blue, 100 green (cymbals by default for yellow, blue, green); 110 / 111 / 112 make the yellow / blue / green a tom
const PADS4 = [97, 98, 99, 100];
const TOMS = [110, 111, 112];
const proRows = [
  ['Pads (cymbals)', PADS4, {}],
  ['Toms', PADS4, { window: TOMS }],
  ['Accent cymbals', PADS4, { vel: 127 }],
  ['Accent toms', PADS4, { vel: 127, window: TOMS }],
  ['Ghost cymbals', PADS4, { vel: 1 }],
  ['Ghost toms', PADS4, { vel: 1, window: TOMS }],
  ['Star power cymbals', PADS4, { window: [116] }],
  ['Star power toms', PADS4, { window: [116, ...TOMS] }],
  ['Kick', [96], {}],
  ['Double kick', [96, 95], { chord: false }],
  ['Kick + pads', [96, 97, 98, 99, 100], { window: TOMS }],
];

function buildRows(rows) {
  const notes = [], raw = [], meta = [];
  rows.forEach(([label, pitches, opts], i) => {
    const start = START + i * ROW;
    const r = rowOf(start, pitches, opts);
    notes.push(...r.notes); raw.push(...r.raw);
    meta.push({ label, time: start / SEC });
  });
  return { notes, raw, meta, seconds: (START + rows.length * ROW) / SEC + 4 };
}

const songs = [
  { dir: 'Note Sheet/Guitar and 5-lane drums', title: 'Guitar and 5-lane drums', parts: [
    { instrument: 'guitar:expert', label: 'Guitar', track: 'PART GUITAR', rows: guitarRows },
    { instrument: 'drums-five:expert', label: 'Drums (5 lanes)', track: 'PART DRUMS', rows: drums5Rows },
  ] },
  { dir: 'Note Sheet/Pro drums', title: 'Pro drums', parts: [
    { instrument: 'drums-pro:expert', label: 'Drums (Pro)', track: 'PART DRUMS', rows: proRows },
  ] },
];

function writeSong(root, song) {
  const dir = path.join(root, song.dir);
  fs.mkdirSync(dir, { recursive: true });
  const tracks = [];
  let seconds = 0;
  for (const part of song.parts) {
    const built = buildRows(part.rows);
    part.meta = built.meta;
    seconds = Math.max(seconds, built.seconds);
    const notes = [...built.notes];
    if (part.track === 'PART DRUMS' && part.instrument.startsWith('drums-five')) notes.push({ tick: 10, pitch: 101, len: 20 }); // (the 5-lane marker, before everything: a green pad hit at the start)
    tracks.push(track(part.track, notes, built.raw));
  }
  fs.writeFileSync(path.join(dir, 'notes.mid'), buildMidi(RES, tracks));
  fs.writeFileSync(path.join(dir, 'song.ini'), ['[song]', `name = ${song.title}`, 'artist = Note Sheet', ''].join('\n'));
  const sr = 8000, n = sr * Math.ceil(seconds), wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(path.join(dir, 'song.wav'), wav);
}

// ---- the browser --------------------------------------------------------------------------------------------------------------------------------------------------
const candidates = [args.playwright, process.env.PLAYWRIGHT_CORE,
  'C:/Users/GuguTab/Documents/Work/L1 - Sistema/node_modules/playwright-core', 'C:/Users/GuguTab/Documents/Work/L1/node_modules/playwright-core',
  path.join(process.cwd(), 'node_modules/playwright-core')].filter(Boolean);
let pw = null;
for (const c of candidates) { try { pw = (await import(pathToFileURL(path.join(c, 'index.js')).href)).default; break; } catch { /* next */ } }
if (!pw) { console.error('playwright-core not found: pass --playwright <dir> or set PLAYWRIGHT_CORE'); process.exit(2); }
const chromePaths = [args.executable, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/opt/pw-browsers/chromium'].filter(Boolean);
const executablePath = chromePaths.find((p) => fs.existsSync(p));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'note-sheet-'));
for (const s of songs) writeSong(tmp, s);

const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, env: { ...process.env, PORT: String(port), SONGS_DIR: tmp, HOST: '127.0.0.1' }, stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* gone */ } if (!args.keep) fs.rmSync(tmp, { recursive: true, force: true }); };
process.on('exit', stop);
const up = async () => {
  for (let i = 0; i < 60; i++) {
    const ok = await new Promise((res) => { http.get({ host: '127.0.0.1', port, path: '/' }, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)); });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
if (!(await up())) { console.error('the app server did not start'); stop(); process.exit(1); }

const browser = await pw.chromium.launch({ headless: !!args.headless, ...(executablePath ? { executablePath } : {}), args: ['--window-position=0,0', '--autoplay-policy=no-user-gesture-required'] });
const tiles = []; // { title, group, buf }
try {
  for (const song of songs) {
    for (const part of song.parts) {
      if (only && !only.some((o) => part.instrument.startsWith(o))) continue;
      for (const style of styles) {
        const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: scale });
        await ctx.addInitScript((s) => { try { localStorage.setItem('yargremote.master', '0.02'); localStorage.setItem('yargremote.onboarded', '1'); localStorage.setItem('yargremote.settings', JSON.stringify(s)); } catch { /* none */ } },
          { 'playback.songInfoOverlay': false, 'highway.visualizer': 'none', 'highway.view': '3d', 'highway.noteStyle': style, 'highway.notes3d': notes3d, 'playback.linkAutoplay': false });
        const page = await ctx.newPage();
        const id = encodeURIComponent(`${song.dir}`);
        await page.goto(`http://127.0.0.1:${port}/#/song/${id}/play?i=${part.instrument}`);
        await page.waitForTimeout(notes3d === 'yarg' ? 9000 : 4000); // (the library scan, the song and the models)
        for (const row of part.meta) {
          if (rowWords && !rowWords.some((w) => row.label.toLowerCase().includes(w))) continue;
          const t = row.time - 0.27; // (the row is a little above the hit line, large and whole)
          await page.evaluate((v) => { const el = document.querySelector('#seek'); el.step = 'any'; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, t);
          await page.waitForTimeout(700);
          const buf = await page.screenshot({ clip: { x: 150, y: 340, width: 700, height: 300 } });
          tiles.push({ title: row.label, group: `${part.label} - ${style === 'round' ? 'circle notes' : 'rectangle notes'}`, buf });
        }
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}

// ---- the sheet ----------------------------------------------------------------------------------------------------------------------------------------------------
fs.mkdirSync(path.dirname(out), { recursive: true });
const groups = [...new Set(tiles.map((t) => t.group))];
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0e14;color:#e6e9ef;font:14px system-ui">
${groups.map((g) => `<h2 style="margin:18px 16px 8px;font-size:18px">${g}</h2><div style="display:grid;grid-template-columns:repeat(${cols},350px);gap:10px;padding:0 16px">${
  tiles.filter((t) => t.group === g).map((t) => `<figure style="margin:0;background:#11151d;border-radius:6px;overflow:hidden"><img style="display:block;width:350px;height:150px" src="data:image/png;base64,${t.buf.toString('base64')}"><figcaption style="padding:4px 8px">${t.title}</figcaption></figure>`).join('')}</div>`).join('')}
</body>`;
const b2 = await pw.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const p2 = await b2.newPage({ viewport: { width: 16 + cols * 360 + 16, height: 400 }, deviceScaleFactor: 1 });
await p2.setContent(html);
await p2.screenshot({ path: out, fullPage: true });
await b2.close();
console.log(`${tiles.length} pictures in ${out}`);
stop();
process.exit(0);
