// ---------- Deep links: the URL hash names the open song ----------
// The hash is only replaced (no history entries): a reload or a shared link opens the same song, and the two panels
// stay in place. #/song/<id> opens the details, #/song/<id>/play the chart. The route format itself is src/route.js.
// Moved out of app.js as is: what it needs from app.js comes in through `initDeepLinks(ctx)` (getters for its state, its functions),
// so this module never imports app.js. app.js registers the hashchange listener itself (listener order).
import { parseRoute, formatRoute } from './route.js';
import { plainText } from './ini.js';

let ctx = null;
// ctx: { els, store, current(), songs(), infoOpen(), instrumentGroups(), diffFor(ins), fillDifficultyOptions(), updateChart(), selectSong(song),
// markStageLive(), setInfoOpen(open, opts), setPendingOpen(withAudio, instruments) }
export function initDeepLinks(context) {
  ctx = context;
}

// The instruments on screen for the link: the active one first, then the pinned ones, each with its difficulty.
export function instrumentsOnScreen() {
  const current = ctx.current();
  if (!current?.options?.length) return [];
  const out = [];
  for (const g of ctx.instrumentGroups()) {
    if (!(g.active && !current.hiddenActive) && !g.pinned) continue;
    const d = g.active ? ctx.els.difficulty.value : ctx.diffFor(g.chosen).chosen?.id;
    out.push({ id: g.chosen.id, diff: d || undefined, active: g.active });
  }
  out.sort((x, y) => Number(!!y.active) - Number(!!x.active)); // the active one leads
  return out.map(({ id, diff }) => ({ id, diff }));
}
// Puts the instruments of a link on screen: the first is the active one, the others are pinned. Unknown ones are ignored.
export function applyInstruments(list) {
  const current = ctx.current();
  const { els } = ctx;
  // (a link names ids; the pick of another song may only share the kind of instrument: drums in another mode, vocals for harmony)
  const seen = new Set();
  const known = (list || []).map((x) => {
    const o = current.options.find((c) => c.id === x.id) ?? (x.base ? current.options.find((c) => c.base === x.base) ?? (x.base === 'harmony' ? current.options.find((c) => c.mode === 'vocals') : null) : null);
    return o && !seen.has(o.id) && seen.add(o.id) ? { ...x, id: o.id } : null;
  }).filter(Boolean);
  if (!known.length) return false;
  const [first, ...rest] = known;
  els.instrument.value = first.id;
  ctx.fillDifficultyOptions();
  if (first.diff && [...els.difficulty.options].some((o) => o.value === first.diff)) els.difficulty.value = first.diff;
  current.pins.clear();
  current.hiddenActive = false;
  const groups = ctx.instrumentGroups();
  for (const x of rest) {
    const g = groups.find((gr) => gr.options.some((o) => o.id === x.id));
    if (!g || g.active) continue;
    current.modeChoice[g.key] = x.id;
    if (x.diff) current.diffChoice[x.id] = x.diff;
    current.pins.add(g.key);
  }
  return true;
}
export function syncUrl() {
  const current = ctx.current();
  if (!current) return;
  ctx.store.set('lastSong', current.song.id); // for "Reopen the last song"
  const hash = formatRoute({ view: ctx.infoOpen() ? 'song' : 'play', id: current.song.id, instruments: instrumentsOnScreen() });
  if (location.hash !== hash) history.replaceState(null, '', hash);
  document.title = `${plainText(current.song.title)} - ${plainText(current.song.artist)} · YARG Remote`;
}
export function openFromHash() {
  const route = parseRoute(location.hash);
  if (route.view === 'library') return;
  const current = ctx.current();
  if (current?.song.id === route.id) { // the same song: a link with other instruments rearranges the screen
    if (route.instruments && applyInstruments(route.instruments)) ctx.updateChart();
    return;
  }
  const song = ctx.songs().find((s) => s.id === route.id);
  if (!song) return;
  ctx.setPendingOpen(route.view === 'play', route.instruments || null); // (loadAudioWithSong, pendingInstruments)
  ctx.selectSong(song);
  if (route.view === 'play') { ctx.markStageLive(); ctx.setInfoOpen(false, { grow: false, release: false }); } // (the stage stays held until the audio of the link has loaded) // a /play link is the player: the bar shows, the library keeps its width
}
