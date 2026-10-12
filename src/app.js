import { parseMidi } from './midi.js';
import { parseChart } from './chartfile.js';
import { DIFFICULTIES, EXTENDED_DRUM_LANES, instrumentOptions, availableDifficulties, buildChart, sectionIndexAt } from './chart.js';
import { MultiTrackPlayer } from './player.js';
import { Highway } from './highway.js';
import { PerfMeter } from './perf.js';
import { createPerfOverlay, PERF_MODES } from './perf-overlay.js';
import { specialNotes, neighbourTime } from './specials.js';
import { walkHandle, entriesFromFileList, scanSongs, audioStemsOf, findCover, readBytes, serializeSongs, restoreSongs, restoreRemoteSongs } from './library.js';
import { songDelaySeconds, plainText } from './ini.js';
import { previewWindow } from './preview.js';
import { metaRows, extraRows, chartStats, bpmLabel, bpmRange, instrumentLevel, stemKind, stemBadge, stemGroup, stemGroupLabel } from './songinfo.js';
import { parseRoute, formatRoute } from './route.js';
import { createSettings } from './settings.js';
import { SECTIONS, buildDefaults, FONT_OPTIONS } from './settings-schema.js';
import { resolveTheme, applyTheme } from './themes.js';
import { mountSettings } from './settings-ui.js';
import { renderThemeStudio, renderDataTools } from './settings-custom.js';
import { saveLibrary, loadLibrary, loadThumb, saveThumb, clearThumbs } from './store.js';
import { filterSongs, sortSongs, genresOf, decadesOf, packsOf, evenPerRow, songSummary, buildItems, anchorLabel } from './songlist.js';
import { createVirtualList, DEFAULT_CARDS } from './virtuallist.js';
import { createThumbs, renderCoverThumb } from './thumbs.js';
import { snapPoints, snapTime, clampLoop, currentSectionRange, sectionRange, loopForSection, shouldWrap, MIN_LOOP } from './looprange.js';
import { VISUALIZERS, createDriver as createVisualizerDriver } from './visualizers.js';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'app', 'library', 'closeLibrary', 'splitter', 'libTab', 'songTab', 'closeSong', 'closeSongInfo', 'npPlay', 'npPreview', 'npSeek', 'npTime', 'loadScreen', 'lsTitle', 'lsBar', 'lsText', 'lsCover', 'groupLabel', 'rail', 'scrim', 'pick', 'resume', 'rescan', 'folderInput', 'status',
  'search', 'sortBy', 'sortDir', 'filterBtn', 'filterBadge', 'filterPanel', 'instChips', 'levelSeg', 'filterGenre', 'filterDecade', 'filterPack', 'filterClear', 'activeFilters', 'viewSeg', 'count', 'songs', 'empty',
  'now', 'brand', 'cover', 'title', 'artist', 'chips', 'instrument', 'difficulty',
  'transport', 'play', 'back', 'forward', 'seekbox', 'seek', 'loopBtn', 'loopBand', 'loopStart', 'loopEnd', 'seekTip', 'timeNow', 'timeTotal',
  'tools', 'sectionSelect', 'mixerBtn', 'mixerPop', 'sectionBtn', 'sectionPop', 'sectionText', 'infoPop', 'infoPopCover', 'infoPopTitle', 'infoPopArtist', 'infoPopMeta', 'infoPopMore', 'mixer', 'settingsBtn', 'settingsPop',
  'fullscreen', 'barHide', 'barShow', 'specialCard', 'specialList', 'paneTags', 'paneMenu', 'paneMenuDyn', 'paneMenuActions', 'viewChoice', 'noteChoice', 'vocalChoice', 'infoBtn', 'info', 'infoCover', 'infoTitle', 'infoArtist', 'infoQuote', 'infoMeta', 'instrumentCards',
  'mixerInfo', 'infoExtra', 'infoProgress', 'infoBar', 'infoState', 'infoPlay',
  'stage', 'highway', 'loading', 'welcome', 'welcomeOpen',
].map((id) => [id, $(id)]));

for (const img of [els.cover, els.infoCover, els.infoPopCover]) img.addEventListener('error', () => { img.hidden = true; });
const player = new MultiTrackPlayer();
const highway = new Highway(els.highway);
const perf = new PerfMeter();
const perfOverlay = createPerfOverlay({
  stage: document.getElementById('stage'), meter: perf, onCycle: () => cyclePerfOverlay(),
  probes: () => {
    const c = els.highway, mem = performance.memory, ctx = player.ctx;
    const mb = (n) => Math.round(n / 1048576);
    const lat = ctx ? Math.round(((ctx.outputLatency || 0) || (ctx.baseLatency || 0)) * 1000) : null;
    return {
      canvas: `${c.width}x${c.height}`, dpr: window.devicePixelRatio, panes: highway.panes.length,
      heap: mem ? `${mb(mem.usedJSHeapSize)} / ${mb(mem.jsHeapSizeLimit)} MB` : null,
      latency: lat == null ? null : `${lat} ms`,
    };
  },
});
function cyclePerfOverlay() {
  prefs.set('perf.overlay', PERF_MODES[(PERF_MODES.indexOf(prefs.get('perf.overlay')) + 1) % PERF_MODES.length]);
}
let songs = [];
let current = null; // { song, midi, coverUrl, options }
let connectedRoot = null; // folder handle of the library on screen, when it came from the File System Access API
let savedRecord = null; // folder and index stored from the last visit
let chart = null; // chart for the selected instrument and difficulty
let seeking = false;
let loadToken = 0; // bumped on every song selection, so a slow load cannot overwrite a newer one
let sortDesc = false; // the "Reverse the order" setting
let ready = false; // audio decoded and a chart built: playback is allowed
let infoOpen = false;
let loadInfo = { state: 'idle', text: '', fraction: 0 };
const settings = { speed: 1, neck: 1.2, chartDelay: 0 };
let remote = false; // library comes from server.mjs (/api/library); no folder permission needed
let detached = false; // list restored from storage without file access (browsers without showDirectoryPicker)
let pendingSongId = null; // song clicked while detached; opened once the folder is picked again

// ---------- Settings and theme (applied first, so the first frame already has the right colours) ----------
const prefs = createSettings({ defaults: buildDefaults(), storage: (() => { try { return localStorage; } catch { return null; } })() });
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
let themeStage = '#0d1117';
// The stage colour: the theme's, or the one picked in the visualizer menu / settings.
function applyStage() {
  highway.setBackground(prefs.get('highway.stageColorOn') ? prefs.get('highway.stageColor') : themeStage);
}
function applyThemeSetting() {
  const theme = resolveTheme({ preset: prefs.get('theme.preset'), overrides: prefs.get('theme.overrides'), saved: prefs.get('theme.saved') }, darkQuery.matches);
  applyTheme(theme);
  themeStage = theme.vars.stage;
  applyStage();
  try { // read by the inline script in index.html before the first paint
    const css = {};
    for (const k of ['--bg', '--panel', '--panel-2', '--line', '--text', '--muted', '--accent', '--accent-text', '--stage', '--stage-rgb', 'color-scheme']) css[k] = document.documentElement.style.getPropertyValue(k);
    localStorage.setItem('yargremote.themeCache', JSON.stringify({ scheme: theme.scheme, css }));
  } catch { /* the cache is optional */ }
}
darkQuery.addEventListener('change', () => { if (prefs.get('theme.preset') === 'auto') applyThemeSetting(); });

const store = {
  get(key) { try { return localStorage.getItem(`yargremote.${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`yargremote.${key}`, value); } catch { /* storage unavailable */ } },
};

// ---------- Library panel ----------
// `persist` is false for the automatic closes on narrow screens, so they do not become the saved preference.
// Panels: the library (left) and the song (right) can each be closed and reopened. On a desktop screen one of them is
// always open: closing the last open one opens the other. On a phone the song is always there and the library is a drawer.
const narrow = () => window.matchMedia('(max-width: 700px)').matches;
const libraryOpen = () => !els.app.classList.contains('lib-closed');
const songPanelOpen = () => !els.app.classList.contains('song-closed');
function savePanelState() {
  if (narrow()) return;
  try { localStorage.setItem('yargremote.panelState', JSON.stringify({ library: libraryOpen(), song: songPanelOpen() })); } catch { /* optional */ }
}
function setSongPanelOpen(open, persist = true) {
  if (narrow()) return; // a phone shows one thing at a time
  if (!open && !libraryOpen()) setLibraryOpen(true); // never both closed
  if (!open) els.app.style.setProperty('--main-w', `${Math.round(document.querySelector('.main').getBoundingClientRect().width)}px`); // it slides out by its own width
  els.app.classList.toggle('song-closed', !open);
  syncPanelUi();
  if (persist) savePanelState();
}
function setLibraryOpen(open, persist = true) {
  if (!open && !narrow() && !songPanelOpen()) setSongPanelOpen(true); // never both closed
  els.app.classList.toggle('lib-closed', !open);
  syncPanelUi();
  if (persist) savePanelState();
}
// Edge tabs reopen a closed panel.
function syncPanelUi() {
  els.libTab.hidden = libraryOpen(); // like the top bar's show button: it is always there while the library is hidden (also on a phone, where the library is a drawer)
  els.songTab.hidden = narrow() || songPanelOpen(); // the song panel's is the same, mirrored
}
(() => { // the panels at startup: open, closed, or as they were last time (the "Panels" settings)
  if (narrow()) { setLibraryOpen(false, false); return; }
  let last = {};
  try { last = JSON.parse(localStorage.getItem('yargremote.panelState')) || {}; } catch { /* none */ }
  const want = (start, was) => (start === 'last' ? was !== false : start !== 'closed');
  let lib = want(prefs.get('panels.libraryStart'), last.library);
  const song = want(prefs.get('panels.songStart'), last.song);
  if (!lib && !song) lib = true; // never both closed
  els.app.classList.toggle('lib-closed', !lib);
  els.app.classList.toggle('song-closed', !song);
})();
// The drawer overlay on narrow screens starts closed; entering that layout closes it.
window.matchMedia('(max-width: 700px)').addEventListener('change', (e) => {
  if (e.matches) { els.app.classList.remove('song-closed'); setLibraryOpen(false, false); } // a phone: the song panel is the screen
  else { try { const last = JSON.parse(localStorage.getItem('yargremote.panelState')) || {}; els.app.classList.toggle('song-closed', last.song === false && last.library !== false); } catch { /* keep */ } }
  syncPanelUi();
});
els.closeLibrary.addEventListener('click', () => setLibraryOpen(false, false));
els.scrim.addEventListener('click', () => setLibraryOpen(false, false));
els.welcomeOpen.addEventListener('click', () => setLibraryOpen(true));
els.libTab.addEventListener('click', () => setLibraryOpen(true));

// ---------- Peeking: resting the pointer on a handle opens its menu for a while ----------
// Hovering the handle of a hidden menu (the library's tab, the song panel's tab, the top bar's tab) for a moment opens it
// temporarily: nothing is saved, and it closes again when the pointer has been out of it for a couple of seconds or has stopped
// moving for a few. It stays while something in it is being edited or a popover is open.
const PEEK = { hoverMs: 1000, outsideMs: 2000, idleMs: 3000 };
function setupPeek(handle, panel, { isOpen, open, close }) {
  let peeking = false;
  let hoverTimer = 0;
  let outsideTimer = 0;
  let idleTimer = 0;
  const busy = () => { // do not take the menu away from someone who is using it
    const el = document.activeElement;
    return !!document.querySelector('.popover:not([hidden])') || (panel.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
  };
  const end = () => {
    clearTimeout(outsideTimer);
    clearTimeout(idleTimer);
    if (!peeking) return;
    if (busy()) { arm(); return; } // try again later
    peeking = false;
    if (isOpen()) close();
  };
  const arm = () => { // the idle timer restarts with every move over the menu
    clearTimeout(idleTimer);
    idleTimer = setTimeout(end, PEEK.idleMs);
  };
  handle.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch' || narrow() || isOpen()) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (isOpen()) return;
      peeking = true;
      open();
      arm();
    }, PEEK.hoverMs);
  });
  handle.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
  handle.addEventListener('click', () => { clearTimeout(hoverTimer); peeking = false; }); // a click opens it for good
  panel.addEventListener('pointerenter', () => clearTimeout(outsideTimer));
  panel.addEventListener('pointermove', () => { if (peeking) arm(); });
  panel.addEventListener('pointerleave', () => {
    if (!peeking) return;
    clearTimeout(outsideTimer);
    outsideTimer = setTimeout(end, PEEK.outsideMs);
  });
  panel.addEventListener('pointerdown', () => { if (peeking) arm(); });
}
setupPeek(els.libTab, els.library, { isOpen: libraryOpen, open: () => setLibraryOpen(true, false), close: () => setLibraryOpen(false, false) });
setupPeek(els.songTab, document.querySelector('.main'), { isOpen: songPanelOpen, open: () => setSongPanelOpen(true, false), close: () => setSongPanelOpen(false, false) });
setupPeek(els.barShow, document.querySelector('.topbar'), { isOpen: () => !els.app.classList.contains('bar-hidden'), open: () => setBarHidden(false, false), close: () => setBarHidden(true, false) });
els.songTab.addEventListener('click', () => setSongPanelOpen(true));
els.closeSong.addEventListener('click', () => setSongPanelOpen(false));
els.closeSongInfo.addEventListener('click', () => setSongPanelOpen(false));
els.npPlay.addEventListener('click', async () => { // the Listen card: play here, without leaving the details
  previewStop = null;
  if (!player.playing && !(await ensureAudio())) return; // loads the audio the first time
  if (player.playing) player.pause(); else await player.play();
  syncPlayButton();
});
els.npSeek.addEventListener('input', () => { previewStop = null; player.seek(Number(els.npSeek.value)); });

// Preview button of the Listen card: plays the window song.ini defines (preview_start_time .. preview_end_time).
// The times are positions in the audio file; the chart clock is the file position minus the audio delay.
let previewStop = null; // chart-clock second where the preview ends, or null when none is running
els.npPreview.addEventListener('click', async () => {
  const win = current && previewWindow(current.song.ini);
  if (!win || !(await ensureAudio())) return;
  const delay = songDelaySeconds(current.song.ini);
  player.seek(Math.max(0, win.start - delay));
  previewStop = Math.min(win.end - delay, player.duration);
  if (!player.playing) await player.play();
  syncPlayButton();
});

// The divider between the two panels: drag to resize the library panel (remembered); double-click restores the default.
const MIN_LIB_W = 300;
const MIN_SONG_W = 420; // the song panel keeps at least this: one column of details at its minimum size
const maxLibWidth = () => Math.max(MIN_LIB_W, window.innerWidth - MIN_SONG_W);
function setLibWidth(px) {
  if (px == null) document.documentElement.style.removeProperty('--lib-w');
  else document.documentElement.style.setProperty('--lib-w', `${Math.round(px)}px`);
}
const savedLibW = Number(store.get('libWidth'));
if (savedLibW >= MIN_LIB_W && !narrow()) setLibWidth(Math.min(savedLibW, maxLibWidth()));
window.addEventListener('resize', () => { // a smaller window must not squeeze the song panel below its minimum
  const w = els.library.getBoundingClientRect().width;
  if (!narrow() && w > maxLibWidth()) setLibWidth(maxLibWidth());
});
els.splitter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  els.splitter.setPointerCapture(e.pointerId);
  els.splitter.classList.add('dragging');
  document.body.classList.add('resizing');
});
els.splitter.addEventListener('pointermove', (e) => {
  if (!els.splitter.classList.contains('dragging')) return;
  setLibWidth(Math.min(Math.max(e.clientX, MIN_LIB_W), maxLibWidth())); // as wide as it gets while the song panel keeps its minimum
});
const endDrag = () => {
  if (!els.splitter.classList.contains('dragging')) return;
  els.splitter.classList.remove('dragging');
  document.body.classList.remove('resizing');
  store.set('libWidth', String(Math.round(els.library.getBoundingClientRect().width)));
};
els.splitter.addEventListener('pointerup', endDrag);
els.splitter.addEventListener('pointercancel', endDrag);
els.splitter.addEventListener('dblclick', () => { setLibWidth(null); store.set('libWidth', ''); });

els.pick.addEventListener('click', pickFolder);
els.resume.addEventListener('click', reopenFolder);
els.rescan.addEventListener('click', rescanFolder);
els.folderInput.addEventListener('change', () => loadEntries(entriesFromFileList(els.folderInput.files)));
// Filters: instrument chips (all selected must be present), minimum level, genre, decade; the search box adds
// field syntax (artist:, year:, len:, inst:...). Everything here only changes what renderList() shows.
const filters = { instruments: new Set(), minLevel: 0 };
const selectSyncs = []; // refresh the custom dropdowns after the code changes a <select> (see customSelect)
const FILTER_ICONS = { guitar: 'guitar', bass: 'bass', rhythm: 'rhythm', keys: 'keys', drums: 'drum', vocals: 'mic' };
const INSTRUMENT_NAMES = { guitar: 'Guitar', bass: 'Bass', rhythm: 'Rhythm', keys: 'Keys', drums: 'Drums', vocals: 'Vocals' };
// Genre, pack and decade take several values at once: the hidden <select multiple> holds the selection.
const picked = (select) => [...select.selectedOptions].map((o) => o.value);
const clearPicked = (select) => { for (const o of select.options) o.selected = false; };
const filterCount = () => filters.instruments.size + (filters.minLevel ? 1 : 0) + picked(els.filterGenre).length + picked(els.filterDecade).length + picked(els.filterPack).length;
function syncFilterUi() {
  for (const b of els.instChips.querySelectorAll('[data-inst]')) b.setAttribute('aria-pressed', String(filters.instruments.has(b.dataset.inst)));
  for (const b of els.levelSeg.querySelectorAll('[data-level]')) b.setAttribute('aria-pressed', String(Number(b.dataset.level) === filters.minLevel));
  for (const sync of selectSyncs) sync();
  const n = filterCount();
  els.filterBadge.textContent = String(n);
  els.filterBadge.hidden = n === 0;
  els.filterClear.disabled = n === 0;
  const chips = [];
  const add = (text, remove, icon) => chips.push({ text, remove, icon });
  for (const i of filters.instruments) add(INSTRUMENT_NAMES[i], () => filters.instruments.delete(i), FILTER_ICONS[i]);
  if (filters.minLevel) add(`Level ${filters.minLevel}+`, () => { filters.minLevel = 0; }, 'sort');
  const addEach = (select, icon, textOf = (v) => v) => {
    for (const o of select.selectedOptions) add(textOf(o.value), () => { o.selected = false; }, icon); // one chip per selected value
  };
  addEach(els.filterPack, 'package');
  addEach(els.filterGenre, 'list');
  addEach(els.filterDecade, 'calendar', (v) => `${v}s`);
  els.activeFilters.hidden = chips.length === 0;
  els.activeFilters.replaceChildren(...chips.map(({ text, remove, icon }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip on';
    b.title = 'Remove filter';
    b.innerHTML = `<svg class="kind"><use href="#i-${icon}"/></svg><span></span><svg class="x"><use href="#i-x"/></svg>`;
    b.querySelector('span').textContent = text;
    b.addEventListener('click', () => { remove(); syncFilterUi(); renderList(); });
    return b;
  }));
}
els.search.addEventListener('input', renderList);
for (const el of [els.filterGenre, els.filterDecade, els.filterPack]) el.addEventListener('input', () => { syncFilterUi(); renderList(); });
els.instChips.addEventListener('click', (e) => {
  const b = e.target.closest('[data-inst]');
  if (!b) return;
  filters.instruments[filters.instruments.has(b.dataset.inst) ? 'delete' : 'add'](b.dataset.inst);
  syncFilterUi();
  renderList();
});
els.levelSeg.addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  filters.minLevel = Number(b.dataset.level);
  syncFilterUi();
  renderList();
});
els.filterClear.addEventListener('click', () => {
  filters.instruments.clear();
  filters.minLevel = 0;
  for (const s of [els.filterGenre, els.filterDecade, els.filterPack]) clearPicked(s);
  syncFilterUi();
  renderList();
});
els.filterBtn.addEventListener('click', () => {
  const open = els.filterPanel.hidden;
  els.filterPanel.hidden = !open;
  els.filterBtn.setAttribute('aria-expanded', String(open));
  els.filterBtn.classList.toggle('on', open);
});
syncFilterUi();
els.sortBy.value = prefs.get('library.sort');
sortDesc = prefs.get('library.sortDesc');
els.sortBy.addEventListener('change', () => { prefs.set('library.sort', els.sortBy.value); }); // the effect re-renders
els.sortDir.addEventListener('click', () => {
  sortDesc = !sortDesc;
  prefs.set('library.sortDesc', sortDesc);
  renderList();
});
startLibrary();

// Folder selection: File System Access API when available, <input webkitdirectory> otherwise.
async function pickFolder() {
  pendingSongId = null;
  if (!window.showDirectoryPicker) {
    els.folderInput.value = '';
    els.folderInput.click();
    return;
  }
  try {
    const dir = await window.showDirectoryPicker({ mode: 'read' });
    await scanFolder(dir);
  } catch (err) {
    if (err.name !== 'AbortError') setStatus(`Error opening folder: ${err.message}`);
  }
}

// Scans a picked folder and remembers it, with its song index, for the next visit.
async function scanFolder(dir) {
  setStatus('Scanning songs…');
  songs = await scanSongs(walkHandle(dir, dir.name));
  const saved = await saveLibrary({ root: dir, rootName: dir.name, index: serializeSongs(songs), savedAt: Date.now() });
  connectedRoot = dir;
  els.resume.hidden = true;
  setStatus(`"${dir.name}"${saved ? '' : ' (could not save the folder)'}`);
  afterLibraryLoaded();
}

// Reopens the remembered folder. Only the read permission is asked again, on this click.
async function reopenFolder() {
  if (!savedRecord) return;
  const { root, rootName, index } = savedRecord;
  try {
    const permission = await root.requestPermission({ mode: 'read' });
    if (permission !== 'granted') {
      setStatus('No permission to read the folder. Choose it again.');
      return;
    }
  } catch (err) {
    setStatus(`Could not reopen the folder: ${err.message}`);
    return;
  }
  songs = restoreSongs(index, root);
  connectedRoot = root;
  els.resume.hidden = true;
  setStatus(`"${rootName}" (saved list; use ⟳ if anything changed)`);
  afterLibraryLoaded();
}

// Prefers the server's library (server.mjs); falls back to the browser folder flow when there is none.
async function startLibrary() {
  if (await loadRemoteLibrary(false)) return;
  await offerSavedFolder();
}

async function loadRemoteLibrary(refresh) {
  try {
    const res = await fetch(`/api/library${refresh ? '?refresh' : ''}`, { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return false;
    const data = await res.json();
    songs = restoreRemoteSongs(data.songs);
    remote = true;
    detached = false;
    els.pick.hidden = true;
    els.resume.hidden = true;
    setStatus(''); // nothing to report: the library comes from the server
    afterLibraryLoaded();
    return true;
  } catch {
    return false; // static hosting: no API
  }
}

async function rescanFolder() {
  if (remote) {
    setStatus('Refreshing…');
    await loadRemoteLibrary(true);
    return;
  }
  if (!connectedRoot) return;
  try {
    const permission = await connectedRoot.requestPermission({ mode: 'read' });
    if (permission !== 'granted') {
      setStatus('No permission to read the folder. Choose it again.');
      return;
    }
    await scanFolder(connectedRoot);
  } catch (err) {
    setStatus(`Error refreshing: ${err.message}`);
  }
}

async function loadEntries(entries) {
  setStatus('Scanning songs…');
  songs = await scanSongs(entries);
  detached = false;
  // Without a folder handle only the song index can be remembered; files need the folder picked again.
  const rootName = entries[0]?.path.split('/')[0] || '';
  await saveLibrary({ root: null, rootName, index: serializeSongs(songs), savedAt: Date.now() });
  setStatus(`"${rootName}"`);
  afterLibraryLoaded();
  const pending = songs.find((s) => s.id === pendingSongId);
  pendingSongId = null;
  if (pending) selectSong(pending);
}

function afterLibraryLoaded() {
  els.rescan.hidden = !connectedRoot && !remote;
  const genres = genresOf(songs);
  els.filterGenre.replaceChildren(...genres.map((g) => new Option(g, g)));
  els.filterGenre.closest('label').hidden = genres.length === 0;
  els.filterDecade.replaceChildren(...decadesOf(songs).map((d) => new Option(`${d}s`, String(d))));
  els.filterDecade.closest('label').hidden = els.filterDecade.options.length < 1;
  els.filterPack.replaceChildren(...packsOf(songs).map((p) => new Option(p, p)));
  els.filterPack.closest('label').hidden = els.filterPack.options.length < 1;
  syncFilterUi();
  renderList();
  openFromHash(); // a #/song/... link opened at startup (does nothing once a song is open)
  if (!current && parseRoute(location.hash).view === 'library' && prefs.get('general.restoreLast')) { // "Reopen the last song"
    const last = songs.find((s) => s.id === store.get('lastSong'));
    if (last) selectSong(last);
  }
}

// On the first load, offer to reopen the folder from the last visit (no picker, one click).
async function offerSavedFolder() {
  savedRecord = await loadLibrary();
  if (!savedRecord) return;
  if (!savedRecord.root) {
    // No handle was stored: show the saved list now; the files are asked for when a song is opened.
    songs = savedRecord.index.map((s) => ({ ...s, files: new Map() }));
    detached = true;
    setStatus(`Saved list from "${savedRecord.rootName}". Choose the folder again to open a song.`);
    afterLibraryLoaded();
    return;
  }
  els.resume.querySelector('span').textContent = `Reopen "${savedRecord.rootName}" (${savedRecord.index.length})`;
  els.resume.hidden = false;
}

// The list is windowed (only the rows near the viewport are in the DOM) and shows album thumbnails.
// 128 px thumbnails serve every card size; the stored key carries the size so a future change rebuilds them.
const thumbs = createThumbs({ render: (song) => renderCoverThumb(song, findCover, 128), load: (id) => loadThumb(`${id}@128`), save: (id, blob) => saveThumb(`${id}@128`, blob) });
// Card style: compact (one line) / normal / large (big cover + instruments). Remembered between visits.
const CARD_MODES = ['compact', 'normal', 'large'];
const CARD_INSTRUMENTS = {
  guitar: { icon: 'guitar', label: 'Guitar' }, bass: { icon: 'bass', label: 'Bass' }, rhythm: { icon: 'rhythm', label: 'Rhythm' },
  keys: { icon: 'keys', label: 'Keys' }, drums: { icon: 'drum', label: 'Drums' }, vocals: { icon: 'mic', label: 'Vocals' },
};
const describeSong = (song) => {
  const d = songSummary(song);
  return { ...d, instruments: d.instruments.map((i) => ({ ...CARD_INSTRUMENTS[i.base], level: i.level })) };
};
// Legacy preferences (before the settings page) move into the settings once.
for (const [legacy, id] of [['cardMode', 'library.cardStyle'], ['sortBy', 'library.sort'], ['view', 'highway.view'], ['noteStyle', 'highway.noteStyle']]) {
  const old = store.get(legacy);
  if (old && prefs.isDefault(id)) prefs.set(id, old);
}
const savedMode = prefs.get('library.cardStyle');
const list = createVirtualList({
  mode: CARD_MODES.includes(savedMode) ? savedMode : 'normal', describe: describeSong,
  scroller: els.songs, label: els.groupLabel, rail: els.rail, thumbs, text: plainText, onSelect: (song) => selectSong(song),
  anchor: (label) => anchorLabel(label, els.sortBy.value),
});

function syncViewSeg() {
  for (const b of els.viewSeg.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === cardMode()));
}
const cardMode = () => (CARD_MODES.includes(prefs.get('library.cardStyle')) ? prefs.get('library.cardStyle') : 'normal');
els.viewSeg.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  prefs.set('library.cardStyle', b.dataset.mode); // the effect below applies it
  if (current) list.scrollToSong(current.song);
});
// A wide panel flows the cards into columns as soon as two fit (the minimum card width depends on the card style).
// (the columns come from the "Columns" setting: see applyColumns)
syncViewSeg();

function renderList({ keepScroll = false } = {}) {
  const shown = sortSongs(filterSongs(songs, {
    query: els.search.value, instruments: [...filters.instruments], minLevel: filters.minLevel, genre: picked(els.filterGenre), decade: picked(els.filterDecade), pack: picked(els.filterPack),
  }), els.sortBy.value, sortDesc);
  els.sortDir.classList.toggle('desc', sortDesc); // the arrow points up when descending
  els.sortDir.title = sortDesc ? 'Descending (click to reverse)' : 'Ascending (click to reverse)';
  list.setActive(current?.song ?? null);
  const heads = prefs.get('library.dividers');
  list.setItems(heads ? buildItems(shown, els.sortBy.value) : shown.map((song) => ({ type: 'song', song })), { keepScroll, evenGroups: heads && els.sortBy.value === 'pack' }); // pack sort: every pack gets a label on the rail
  els.count.textContent = songs.length ? `${shown.length} of ${songs.length} songs` : '';
  els.empty.hidden = songs.length > 0;
}

function setStatus(text) {
  els.status.textContent = text;
}

// ---------- Song and chart selection ----------
let pendingInstruments = null; // the instruments of a link, applied once the chart is read
let loadAudioWithSong = false; // a #/song/<id>/play link: the audio loads with the song, like a Play press would
async function selectSong(song) {
  const wantAudio = loadAudioWithSong;
  loadAudioWithSong = false;
  if (detached) {
    pendingSongId = song.id;
    setStatus('Choose the songs folder to open this song.');
    els.folderInput.value = '';
    els.folderInput.click();
    return;
  }
  const token = ++loadToken;
  player.pause();
  syncPlayButton();
  ready = false;
  setLoop(null); // a loop belongs to one song
  audioLoad = null;
  current = null;
  chart = null;
  highway.setCharts([]);
  renderList({ keepScroll: true });
  if (narrow()) setLibraryOpen(false, false);
  else if (!songPanelOpen() && prefs.get('panels.openSongOnSelect')) setSongPanelOpen(true); // picking a song shows it

  els.welcome.hidden = true;
  showPlayInfo(true);
  els.title.textContent = plainText(song.title);
  els.artist.textContent = plainText(song.artist);
  els.cover.hidden = true;
  els.infoCover.hidden = true;
  els.infoPopCover.hidden = true;
  els.instrument.replaceChildren();
  els.difficulty.replaceChildren();
  els.sectionSelect.replaceChildren(new Option('No sections', ''));
  els.sectionSelect.disabled = true;
  els.sectionBtn.disabled = true;
  els.sectionPop.replaceChildren();
  els.sectionText.textContent = 'No sections';
  els.instrumentCards.replaceChildren();
  els.mixerInfo.replaceChildren();
  els.mixer.replaceChildren();
  renderSongInfo(song);
  infoScroll.scrollTop = 0; // a new song starts at the top
  setInfoOpen(true); // the info screen opens right away and the load runs behind it
  setLoadState('loading', 'Reading the chart…', 0.02);

  const isMidi = song.files.has('notes.mid'); // notes.mid wins when both exist; notes.chart is read by chartfile.js
  const chartName = isMidi ? 'notes.mid' : 'notes.chart';
  const midiEntry = song.files.get(chartName);
  if (!midiEntry) {
    setLoadState('error', 'This song has no notes.mid or notes.chart.');
    return;
  }
  let midi;
  try {
    const bytes = await readBytes(midiEntry);
    midi = isMidi ? parseMidi(bytes) : parseChart(bytes);
  } catch (err) {
    if (token === loadToken) setLoadState('error', `Could not read ${chartName}: ${err.message}`);
    return;
  }
  const coverEntry = findCover(song);
  let coverUrl = null;
  try {
    if (coverEntry) coverUrl = coverEntry.url || URL.createObjectURL(await coverEntry.getFile());
  } catch { /* a missing cover must not block the song */ }
  if (token !== loadToken) {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    return;
  }
  if (els.cover.src.startsWith('blob:')) URL.revokeObjectURL(els.cover.src);
  for (const img of [els.cover, els.infoCover, els.infoPopCover]) {
    img.src = coverUrl || '';
    img.hidden = !coverUrl;
  }

  current = { song, midi, coverUrl, options: instrumentOptions(midi, song.ini), diffChoice: {}, pins: new Set(), choosers: [], chooserSeq: 0, hiddenActive: false, statsCache: new Map(), expandedStats: new Set(), modeChoice: {} };
  renderMeta(song, midi); // adds the BPM chip
  renderList({ keepScroll: true }); // highlight the loaded song
  syncUrl();
  fillInstrumentOptions();
  if (pendingInstruments) { applyInstruments(pendingInstruments); pendingInstruments = null; }
  updateChart(); // the chart exists as soon as the MIDI is read; only playback waits for the audio
  const stems = audioStemsOf(song, { censor: prefs.get('audio.censor') }); // read per load: a change applies to the next song load
  els.npPreview.hidden = !previewWindow(song.ini);
  previewStop = null;
  buildMixer(stems);

  current.stems = stems;
  setLoadState('idle', 'The audio loads when you press Play.', 0); // nothing is decoded until then
  if (chart && prefs.get('general.autoplay')) togglePlay(); // "Start playing as soon as I pick a song"
  else if (chart && wantAudio) ensureAudio(); // (playing needs a click: browsers block sound before one)
}

// The audio (the heavy part) loads on demand: Play, the Listen card or Space. A loading screen covers the song panel meanwhile.
let audioLoad = null; // { song, promise } while a load runs
function ensureAudio() {
  if (ready) return Promise.resolve(true);
  if (!current || !chart) return Promise.resolve(false);
  if (audioLoad?.song === current.song) return audioLoad.promise;
  const token = loadToken;
  const song = current.song;
  const promise = (async () => {
    setLoadState('loading', 'Loading audio…', 0.02);
    let loaded = false;
    try {
      loaded = await player.load(current.stems, {
        delay: songDelaySeconds(song.ini),
        onProgress: (p) => { if (token === loadToken) setLoadState('loading', `Loading audio… ${Math.round(p * 100)}%`, 0.02 + p * 0.98); },
      });
    } catch (err) {
      if (token === loadToken) { setLoadState('error', `Failed to decode audio: ${err.message}`); setInfoOpen(true); }
      return false;
    } finally {
      if (audioLoad?.song === song) audioLoad = null;
    }
    if (token !== loadToken || !loaded) return false;
    els.seek.max = player.duration.toFixed(2);
    els.timeTotal.textContent = fmt(player.duration);
    paintSectionTicks(); // the slider range is known now
    stemStates.forEach(applyStem); // volumes chosen while loading
    ready = true;
    setLoadState('ready', 'Ready to play', 1);
    return true;
  })();
  audioLoad = { song, promise };
  renderLoadState();
  return promise;
}

// ---------- Info screen ----------
function setLoadState(state, text, fraction = 0) {
  loadInfo = { state, text, fraction };
  renderLoadState();
}

function renderLoadState() {
  const { state, text, fraction } = loadInfo;
  els.infoState.textContent = text;
  els.infoBar.style.width = `${Math.round(fraction * 100)}%`;
  els.infoProgress.dataset.state = state;
  els.play.disabled = els.infoPlay.disabled = els.npPlay.disabled = !chart || (!ready && !!audioLoad);
  els.npSeek.disabled = !(ready && chart);
  els.npSeek.max = String(player.duration || 1);
  const screen = !!audioLoad && state === 'loading';
  els.loadScreen.hidden = !screen;
  if (screen) {
    els.lsTitle.textContent = `${plainText(current.song.title)} — ${plainText(current.song.artist)}`;
    els.lsBar.style.width = `${Math.round(fraction * 100)}%`;
    els.lsText.textContent = text;
    els.lsCover.src = els.cover.src || '';
    els.lsCover.hidden = !els.cover.src || els.cover.hidden;
  }
  const overlay = !infoOpen && !screen && state === 'error';
  els.loading.hidden = !overlay;
  if (overlay) els.loading.textContent = text;
}

// The floating menu button only gets a background once content scrolls under it.
const infoScroll = els.info.querySelector('.info-scroll');
function syncInfoScrolled() { els.info.classList.toggle('scrolled', infoScroll.scrollTop > 4); }
infoScroll.addEventListener('scroll', syncInfoScrolled, { passive: true });

function setInfoOpen(open) {
  infoOpen = open;
  els.info.hidden = !open;
  els.app.classList.toggle('info-open', open); // the top bar is redundant while the info screen shows everything
  els.infoBtn.setAttribute('aria-pressed', String(open));
  syncInfoScrolled();
  closePopovers();
  renderLoadState();
  syncUrl();
}

const kv = (rows) => rows.flatMap((r) => {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = r.label;
  dd.textContent = r.value;
  return [dt, dd];
});

// Header chips: a vertical list of icon + label + value. The BPM chip joins once the MIDI has been read.
function renderMeta(song, midi) {
  const shown = new Set(prefs.get('details.chips')); // the "Information chips" setting
  const rows = metaRows(song).filter((r) => r.label !== 'Artist'); // the artist is the subtitle
  const bpm = bpmLabel(midi?.tempos);
  if (bpm) rows.push({ key: 'bpm', label: 'BPM', value: bpm, icon: 'pulse' });
  rows.splice(0, rows.length, ...rows.filter((r) => shown.has(r.key)));
  const chip = (r) => {
    const li = document.createElement('li');
    li.className = 'chip';
    li.innerHTML = `<svg><use href="#i-${r.icon || 'info'}"/></svg><span class="chip-label"></span><span class="chip-value"></span>`;
    li.querySelector('.chip-label').textContent = r.label;
    li.querySelector('.chip-value').textContent = r.value;
    return li;
  };
  els.infoMeta.replaceChildren(...rows.map(chip));
  els.infoPopMeta.replaceChildren(...rows.map(chip)); // the small header in the top-bar popup
  balanceChips();
}

// Wrapped chips look unbalanced when the last row holds one chip. Find the narrowest width that keeps the
// same number of rows, so the rows come out even.
function balanceChips() {
  const list = els.infoMeta;
  list.style.maxWidth = '';
  const items = [...list.children];
  if (items.length < 2 || list.offsetParent === null) return;
  const rowsAt = () => new Set(items.map((li) => li.offsetTop)).size;
  const rows = rowsAt();
  if (rows < 2) return;
  let lo = Math.max(...items.map((li) => li.offsetWidth));
  let hi = list.clientWidth;
  while (hi - lo > 4) {
    const mid = Math.floor((lo + hi) / 2);
    list.style.maxWidth = `${mid}px`;
    if (rowsAt() > rows) lo = mid; else hi = mid;
  }
  list.style.maxWidth = `${hi}px`;
}
new ResizeObserver(() => balanceChips()).observe(els.info);

// The parts of the screen that depend only on the song (song.ini), shown before anything is loaded.
function renderSongInfo(song) {
  els.infoTitle.textContent = plainText(song.title);
  els.infoArtist.textContent = plainText(song.artist);
  els.infoPopTitle.textContent = plainText(song.title);
  els.infoPopArtist.textContent = plainText(song.artist);
  const quote = plainText(song.ini?.loading_phrase);
  els.infoQuote.textContent = quote ? `“${quote}”` : '';
  els.infoQuote.hidden = !quote;
  renderMeta(song, null);
  els.instrumentCards.replaceChildren();
  const extras = extraRows(song);
  // each property is a label/value pair in its own box, so the list can flow into several columns when there is room
  els.infoExtra.replaceChildren(...extras.map((r) => {
    const pair = document.createElement('div');
    pair.append(...kv([r]));
    return pair;
  }));
  els.infoExtra.closest('details').hidden = extras.length === 0;
  els.infoExtra.closest('.info-card').hidden = extras.length === 0; // no empty card when the song.ini has nothing else
}

// Each instrument is a small card: icon, song.ini level, its own difficulty buttons and the chart counts.
// The top-bar selects stay the source of truth for what is playing.
function selectInstrument(insId, diffId) {
  els.instrument.value = insId;
  fillDifficultyOptions();
  if (diffId && [...els.difficulty.options].some((o) => o.value === diffId)) els.difficulty.value = diffId;
  updateChart();
}

function cardStats(ins, diff) {
  const key = `${ins.id}:${diff.id}`;
  if (!current.statsCache.has(key)) {
    const built = ins.id === els.instrument.value && diff.id === els.difficulty.value && chart ? chart : buildChart(current.midi, ins, diff, current.song.ini);
    current.statsCache.set(key, chartStats(built));
  }
  return current.statsCache.get(key);
}

const INSTRUMENT_ICON = { guitar: 'guitar', bass: 'bass', rhythm: 'rhythm', keys: 'keys', drums: 'drum', vocals: 'mic', harmony: 'harmony' };

// The instruments as the pickers show them: every drum mode is one item ("Drums") with a mode selector
// (4 lanes / 5 lanes / Pro / Pro 7 lanes); the other instruments are single items.
function instrumentGroups() {
  const out = [];
  const byKey = new Map();
  for (const o of current.options) {
    const key = o.base === 'drums' ? 'drums' : o.mode === 'vocals' ? 'vocals' : o.id; // drum modes and vocal parts merge
    if (!byKey.has(key)) {
      const g = { key, label: key === 'drums' ? 'Drums' : key === 'vocals' ? 'Vocals' : o.label, options: [] };
      byKey.set(key, g);
      out.push(g);
    }
    byKey.get(key).options.push(o);
  }
  const activeId = els.instrument.value;
  for (const g of out) {
    g.chosen = g.options.find((o) => o.id === activeId)
      || g.options.find((o) => o.id === current.modeChoice[g.key])
      || (g.key === 'drums' ? g.options.find((o) => o.drumMode === 'pro') : null)
      || g.options[0];
    g.active = g.options.some((o) => o.id === activeId);
    g.pinned = !g.active && current.pins.has(g.key); // shown next to the active one
  }
  return out;
}

const diffFor = (ins) => {
  const diffs = availableDifficulties(current.midi, ins, current.song.ini);
  const chosen = diffs.find((d) => d.id === current.diffChoice[ins.id]) || diffs[diffs.length - 1];
  return { diffs, chosen };
};

// The instrument cards are laid out in even rows: with room for 3 columns, 4 cards are 2 + 2, not 3 + 1.
const ICARD_MIN_W = 260;
const ICARD_GAP = 10;
function layoutInstrumentCards() {
  const box = els.instrumentCards;
  const n = box.children.length;
  const fit = Math.max(1, Math.floor((box.clientWidth + ICARD_GAP) / (ICARD_MIN_W + ICARD_GAP)));
  box.style.setProperty('--icols', String(evenPerRow(n, fit)));
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layoutInstrumentCards).observe(els.instrumentCards);

// Several fretboards at once: a card (or menu row) can be pinned to show next to the active instrument.
function pinButton(group) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon small-icon pin-btn';
  b.innerHTML = '<svg><use href="#i-layers"/></svg>';
  b.title = group.pinned ? 'Stop showing it next to the others' : 'Show it together with the others';
  b.setAttribute('aria-label', `${group.pinned ? 'Hide' : 'Show'} ${group.label} together with the others`);
  b.setAttribute('aria-pressed', String(group.pinned));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    current.pins[group.pinned ? 'delete' : 'add'](group.key);
    updateChart();
  });
  return b;
}

// A difficulty button: on the active card or a card that is not shown it picks the instrument; on a pinned card it only changes that fretboard.
function pickDifficulty(group, ins, diffId) {
  if (group.pinned) {
    current.diffChoice[ins.id] = diffId;
    updateChart();
  } else selectInstrument(ins.id, diffId);
}

function renderPickers() {
  if (!current) return;
  const activeId = els.instrument.value;
  if (activeId) current.diffChoice[activeId] = els.difficulty.value;
  const activeIns = currentInstrument();
  if (activeIns) current.modeChoice[activeIns.base === 'drums' ? 'drums' : activeIns.mode === 'vocals' ? 'vocals' : activeIns.id] = activeIns.id; // the mode a merged card remembers
  // Vocal parts have a single chart: no difficulty buttons.
  els.instrumentCards.replaceChildren(...instrumentGroups().map((group) => {
    const ins = group.chosen; // the option this card stands for (for drums: the chosen mode)
    const { diffs, chosen } = diffFor(ins);
    const vocal = ins.mode === 'vocals';
    const card = document.createElement('div');
    card.className = 'icard';
    card.dataset.active = String(group.active);
    card.dataset.pinned = String(group.pinned);

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'icard-head';
    head.setAttribute('aria-pressed', String(group.active));
    head.innerHTML = `<svg><use href="#i-${INSTRUMENT_ICON[ins.base] || 'music'}"/></svg><span class="icard-name"></span>`;
    head.querySelector('.icard-name').textContent = group.label;

    // title row: [icon + name] [info button] ...... [level pips]
    const top = document.createElement('div');
    top.className = 'icard-top';
    top.append(head);
    const expanded = current.expandedStats.has(group.key);
    if (chosen) {
      const info = document.createElement('button');
      info.type = 'button';
      info.className = 'icon small-icon icard-info';
      info.title = 'Chart details';
      info.setAttribute('aria-label', `Chart details for ${ins.label}`);
      info.setAttribute('aria-expanded', String(expanded));
      info.innerHTML = '<svg><use href="#i-info"/></svg>';
      info.addEventListener('click', (e) => { // only shows or hides the counts; it does not select the instrument
        e.stopPropagation();
        const open = card.querySelector('.kv.mini').hidden;
        card.querySelector('.kv.mini').hidden = !open;
        info.setAttribute('aria-expanded', String(open));
        current.expandedStats[open ? 'add' : 'delete'](group.key);
      });
      top.append(info);
    }
    if (!group.active) top.append(pinButton(group));
    const level = instrumentLevel(current.song, ins);
    if (level !== null) {
      const pips = document.createElement('span');
      pips.className = 'pips';
      pips.title = `Level ${level} of 6`;
      pips.replaceChildren(...Array.from({ length: 6 }, (_, i) => Object.assign(document.createElement('i'), { className: i < level ? 'on' : '' })));
      top.append(pips);
    }
    // The whole card selects the instrument (with its remembered mode and difficulty); the buttons stop the click.
    card.addEventListener('click', () => selectInstrument(ins.id, chosen?.id));
    card.append(top);

    if (group.options.length > 1) { // drum mode selector, same look as the difficulty one
      const modes = document.createElement('div');
      modes.className = 'seg';
      for (const o of group.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = o.modeLabel ?? o.label;
        btn.setAttribute('aria-pressed', String((group.active || group.pinned) && o.id === group.chosen.id));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          current.modeChoice[group.key] = o.id;
          if (group.pinned) updateChart(); // a fretboard shown next to the active one keeps showing
          else selectInstrument(o.id, diffFor(o).chosen?.id);
        });
        modes.append(btn);
      }
      card.append(modes);
    }
    if (!vocal) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      for (const d of diffs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = d.label;
        btn.setAttribute('aria-pressed', String((group.active || group.pinned) && d.id === chosen?.id));
        btn.addEventListener('click', (e) => { e.stopPropagation(); pickDifficulty(group, ins, d.id); });
        seg.append(btn);
      }
      card.append(seg);
    }
    if (chosen) {
      const dl = document.createElement('dl');
      dl.className = 'kv mini';
      dl.hidden = !expanded; // the counts hide behind the info button
      dl.replaceChildren(...kv(cardStats(ins, chosen)));
      card.append(dl);
    }
    return card;
  }));
  layoutInstrumentCards();
}

els.infoPopMore.addEventListener('click', () => { closePopovers(); setInfoOpen(true); });
els.infoPlay.addEventListener('click', () => togglePlay());

function showPlayInfo(on) {
  els.now.hidden = !on;
  els.brand.hidden = on;
  els.chips.hidden = !on;
  els.transport.hidden = !on;
  els.seekbox.hidden = !on;
  els.tools.hidden = !on;
}

function fillInstrumentOptions() {
  els.instrument.replaceChildren(...current.options.map((ins) => new Option(ins.label, ins.id)));
  els.instrument.disabled = current.options.length === 0;
  fillDifficultyOptions();
}

function fillDifficultyOptions() {
  const ins = currentInstrument();
  const diffs = ins ? availableDifficulties(current.midi, ins, current.song.ini) : [];
  const previous = els.difficulty.value;
  els.difficulty.replaceChildren(...diffs.map((d) => new Option(d.label, d.id)));
  // Keep the previous choice when still available, otherwise prefer the highest difficulty (Expert).
  if (diffs.some((d) => d.id === previous)) els.difficulty.value = previous;
  else if (diffs.length) els.difficulty.value = diffs[diffs.length - 1].id;
}

function currentInstrument() {
  return current?.options.find((i) => i.id === els.instrument.value) || null;
}

// Special notes of the active chart: what kinds there are, how many, and buttons to jump to the previous / next one.
function renderSpecials() {
  const list = specialNotes(chart);
  for (const host of [els.specialList]) {
    host.replaceChildren(...list.map((item) => {
      const row = document.createElement('div');
      row.className = 'spc-row';
      row.innerHTML = '<i class="spc-dot"></i><span class="spc-name"></span><span class="spc-count"></span>';
      row.querySelector('.spc-dot').style.background = item.color;
      row.querySelector('.spc-name').textContent = item.label;
      row.querySelector('.spc-count').textContent = String(item.count);
      for (const [dir, label, path] of [[-1, 'Previous', 'M15 6l-6 6 6 6'], [1, 'Next', 'M9 6l6 6-6 6']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon small-icon';
        b.title = `${label} ${item.label.toLowerCase()}`;
        b.setAttribute('aria-label', b.title);
        b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${path}"/></svg>`;
        b.addEventListener('click', () => jumpToSpecial(item, dir));
        row.append(b);
      }
      return row;
    }));
  }
  els.specialCard.hidden = list.length === 0;
}

// Seeks to the next / previous occurrence (a little before it, so it arrives on the chart) and shows the chart.
async function jumpToSpecial(item, dir) {
  if (!(await ensureAudio())) return;
  const target = neighbourTime(item.times, player.currentTime() - settings.chartDelay, dir);
  if (target === null) return;
  seekTo(Math.max(0, target - 1.5 + settings.chartDelay));
  if (infoOpen) setInfoOpen(false);
}

function updateChart() {
  if (!current) return;
  const ins = currentInstrument();
  const diff = DIFFICULTIES.find((d) => d.id === els.difficulty.value);
  chart = ins && diff ? buildChart(current.midi, ins, diff, current.song.ini) : null;
  // Every chart on screen, in the order of the instruments: the active one plus the pinned ones.
  const items = [];
  current.choosers ??= [];
  for (const group of instrumentGroups()) {
    if (group.active) current.pins.delete(group.key);
    for (const c of current.choosers) if (c.at === group.key) items.push({ chooser: true, key: `choose:${c.id}` }); // a swap: the chooser takes the slot of the instrument that left
    const shown = group.active && current.hiddenActive ? null : group.active ? chart : group.pinned ? (() => { const o = group.chosen; const d = diffFor(o).chosen; return d ? buildChart(current.midi, o, d, current.song.ini) : null; })() : null;
    if (!shown) continue;
    const d = group.active ? diff : diffFor(group.chosen).chosen;
    items.push({ chart: shown, key: group.key, icon: INSTRUMENT_ICON[group.chosen.base] || 'music', label: shown.mode === 'vocals' ? group.label : `${group.label} · ${d.short}` });
  }
  for (const c of current.choosers) if (c.at === null) items.push({ chooser: true, key: `choose:${c.id}` }); // an added one goes last
  highway.setCharts(items);
  renderSpecials();
  fillSectionOptions();
  const hasLanes = items.some((x) => x.chooser || x.chart.mode !== 'vocals');
  const hasVocals = items.some((x) => !x.chooser && x.chart.mode === 'vocals');
  for (const g of els.paneMenu.querySelectorAll('[data-needs]')) g.hidden = !(g.dataset.needs === 'lanes' ? hasLanes : hasVocals); // view options: notes or karaoke for vocals, view and shape for fretboards
  renderPickers(); // (it records the active instrument's difficulty, which the menu and the chooser cards read: they come after it)
  if (!items.some((x) => !x.chooser)) els.paneMenu.hidden = true;
  else if (!els.paneMenu.hidden) buildPaneMenu(); // keep an open menu up to date
  for (const [key, el] of chooserEls) fillChooser(el, key); // the cards follow the instruments that are not on screen
  renderLoadState();
  syncUrl(); // the link carries the instruments on screen
}

els.instrument.addEventListener('change', () => { fillDifficultyOptions(); updateChart(); });
els.difficulty.addEventListener('change', updateChart);

let activeSection = -2; // index shown as current in the section chip and list

// Sections: the hidden select keeps the state, the chip and its list (same look as the instrument list) show it.
function fillSectionOptions() {
  const sections = chart?.sections ?? [];
  els.sectionSelect.replaceChildren(...sections.map((x, i) => new Option(`${fmt(x.time)} · ${x.name}`, String(i))));
  els.sectionSelect.disabled = sections.length === 0;
  els.sectionBtn.disabled = sections.length === 0;
  els.sectionPop.replaceChildren(...sections.map((x, i) => {
    const row = document.createElement('div');
    row.className = 'prow';
    row.dataset.index = String(i);
    row.dataset.active = 'false';
    row.innerHTML = '<span class="prow-time"></span><span class="prow-name"></span>';
    row.querySelector('.prow-time').textContent = fmt(x.time);
    row.querySelector('.prow-name').textContent = x.name;
    row.addEventListener('click', () => { seekToSection(i); closePopovers(); });
    const lb = document.createElement('button');
    lb.type = 'button';
    lb.className = 'icon small-icon row-loop';
    lb.title = 'Loop this section (with a loop on: extend it to include this section)';
    lb.setAttribute('aria-label', `Loop ${x.name}`);
    lb.innerHTML = '<svg><use href="#i-loop"/></svg>';
    lb.addEventListener('click', (e) => { e.stopPropagation(); loopSectionRow(i); lb.blur(); }); // (blur: keys like R, Space and G keep working)
    row.append(lb);
    return row;
  }));
  activeSection = -2;
  els.sectionText.textContent = sections.length ? sections[0].name : 'No sections';
  paintSectionTicks();
}

// Marks on the seek bar where each section starts. Positions follow the slider's thumb travel (12 px thumb).
function paintSectionTicks() {
  els.seekbox.querySelectorAll('.tick').forEach((t) => t.remove());
  const max = Number(els.seek.max);
  if (!chart?.sections.length || !(max > 0)) return;
  for (const s of chart.sections) {
    const at = s.time + settings.chartDelay; // the slider shows playback time; the chart is shifted by the delay
    if (at < 0 || at > max) continue;
    const tick = document.createElement('i');
    tick.className = 'tick';
    tick.style.left = `calc(${(at / max).toFixed(5)} * (100% - 12px) + 6px)`;
    tick.title = s.name;
    els.seekbox.append(tick);
  }
  paintLoop(); // the section starts moved with the delay; the loop stays where it is in song time
}

function setActiveSection(index) {
  if (index === activeSection) return;
  activeSection = index;
  els.sectionText.textContent = chart?.sections[index]?.name ?? 'No sections';
  for (const row of els.sectionPop.children) row.dataset.active = String(Number(row.dataset.index) === index);
  if (index >= 0) els.sectionSelect.value = String(index);
}

// The highway shows chart time t - delay, so seeking to a section needs the delay added back.
function seekToSection(i) {
  const section = chart?.sections[i];
  if (!section) return;
  seekTo(Math.max(0, section.time + settings.chartDelay));
}
els.sectionSelect.addEventListener('change', () => seekToSection(Number(els.sectionSelect.value)));
els.back.addEventListener('click', () => stepSection(-1));
els.forward.addEventListener('click', () => stepSection(1));
function stepSection(dir) {
  if (!chart?.sections.length) return;
  const here = sectionIndexAt(chart.sections, player.currentTime() - settings.chartDelay);
  const sectionStart = chart.sections[here].time + settings.chartDelay;
  // "Previous" first returns to the start of the current section, as media players do.
  let target = here + dir;
  if (dir < 0 && player.currentTime() - sectionStart > 2) target = here;
  seekToSection(Math.min(Math.max(target, 0), chart.sections.length - 1));
}

// ---------- Mixer and settings ----------
const LONG_PRESS_MS = 500;
// Master volume: one more mixer row (kept across songs) that scales every stem.
const masterState = { stem: { id: 'master', label: 'Master' }, master: true, value: savedMaster(), muted: store.get('masterMuted') === '1', views: [] };
player.setMaster(masterState.muted ? 0 : masterState.value); // from the first sound on, not only after a mixer is built

function savedMaster() {
  const v = Number(store.get('master'));
  return store.get('master') !== null && Number.isFinite(v) ? Math.min(1.5, Math.max(0, v)) : 1;
}
let stemStates = []; // { stem, value, muted, group, views[] }: one state per stem, shown in the menu and on the info screen
let groupList = []; // { key, label, members[], value, muted, expanded, views[] }: stems of one instrument, collapsed by default

const silent = (st) => st.muted || Boolean(st.group?.muted); // not audible because of its own or its group's mute
const groupSilent = (g) => g.muted || g.members.every((m) => m.muted);
const effectiveVolume = (st) => (silent(st) ? 0 : st.value * (st.group?.value ?? 1));

function buildMixer(stems) {
  stemStates = stems.map((stem) => ({ stem, value: 1, muted: false, group: null, views: [] }));
  const byKey = new Map();
  for (const st of stemStates) {
    const key = stemGroup(st.stem.label);
    if (!byKey.has(key)) byKey.set(key, { key, label: stemGroupLabel(key), members: [], value: 1, muted: false, expanded: false, views: [] });
    byKey.get(key).members.push(st);
  }
  groupList = [...byKey.values()];
  for (const g of groupList) if (g.members.length > 1) for (const m of g.members) m.group = g;
  groupList = groupList.filter((g) => g.members.length > 1); // a lone stem needs no group

  masterState.views = [];
  const grouped = new Set(groupList.flatMap((g) => g.members));
  for (const container of [els.mixer, els.mixerInfo]) {
    const master = mixerRow(masterState);
    master.classList.add('master');
    const rows = [master];
    const done = new Set();
    for (const st of stemStates) {
      if (!grouped.has(st)) { rows.push(mixerRow(st)); continue; }
      if (done.has(st.group)) continue;
      done.add(st.group);
      rows.push(groupBlock(st.group));
    }
    container.replaceChildren(...rows);
  }
  applyStem(masterState);
  groupList.forEach(renderGroup);
  stemStates.forEach(applyStem);
}

// A long press on a mute button solos what it stands for (mutes everything else); on the only audible one it restores all.
function pressHandlers(btn, solo, toggle) {
  let timer = 0;
  let longPressed = false;
  btn.addEventListener('pointerdown', () => {
    longPressed = false;
    clearTimeout(timer);
    if (solo) timer = setTimeout(() => { longPressed = true; solo(); }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(type, () => clearTimeout(timer));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    if (longPressed) { longPressed = false; return; } // the press already did its job
    toggle();
  });
}

// Sliders draw their fill and a marker at the default value from two CSS variables: --p (current) and --def.
function paintRange(input, def) {
  const min = Number(input.min);
  const span = Number(input.max) - min || 1;
  input.style.setProperty('--p', String((Number(input.value) - min) / span));
  if (def !== undefined) input.style.setProperty('--def', String((def - min) / span));
}

const ROW_HTML = (kind) => `
    <button class="stem-btn" type="button" aria-pressed="false"><svg><use href="#i-${kind}"/></svg><b class="badge"></b></button>
    <span class="mix-name"></span>
    <input type="range" min="0" max="1.5" step="0.01" value="1">
    <span class="mix-val">100%</span>
    <button class="icon small-icon reset" type="button" title="Reset volume" aria-label="Reset volume"><svg><use href="#i-reset"/></svg></button>`;

function mixerRow(st) {
  const row = document.createElement('div');
  row.className = 'mix-row';
  row.innerHTML = ROW_HTML(st.master ? 'volume' : stemKind(st.stem.label));
  const mute = row.querySelector('.stem-btn');
  mute.querySelector('.badge').textContent = st.master ? '' : stemBadge(st.stem.label);
  const number = st.master ? '' : /^\d+$/.test(stemBadge(st.stem.label)) ? ` ${stemBadge(st.stem.label)}` : '';
  row.querySelector('.mix-name').textContent = st.master ? 'Master' : `${stemGroupLabel(stemGroup(st.stem.label))}${number}`; // shown only in wide cards
  const view = { row, range: row.querySelector('input'), val: row.querySelector('.mix-val'), mute, reset: row.querySelector('.reset') };
  paintRange(view.range, st.master ? 1 : 1);
  st.views.push(view);
  view.range.addEventListener('input', () => { st.value = Number(view.range.value); st.muted = false; applyStem(st); }); // moving the slider re-enables the track
  pressHandlers(mute, st.master ? null : () => soloStem(st), () => {
    if (st.group?.muted) { st.group.muted = false; applyGroup(st.group); return; } // the group was muted: this click turns it back on
    st.muted = !st.muted;
    applyStem(st);
  });
  row.querySelector('.reset').addEventListener('click', () => { st.value = 1; st.muted = false; applyStem(st); });
  return row;
}

// One slider for a whole instrument (it scales every member), with a button that shows the individual sliders.
function groupBlock(g, own = null) { // own: the instrument menu keeps its own open/closed state for the tracks ({ open, toggle })
  const block = document.createElement('div');
  block.className = 'mix-group';
  const row = document.createElement('div');
  row.className = 'mix-row';
  row.classList.add('has-expand'); // one more (narrow) column, only on group rows
  row.innerHTML = ROW_HTML(stemKind(g.members[0].stem.label));
  const mute = row.querySelector('.stem-btn');
  mute.insertAdjacentHTML('afterend', '<button class="icon small-icon expand-btn" type="button" aria-expanded="false"><svg><use href="#i-chevron"/></svg></button>');
  mute.querySelector('.badge').textContent = String(g.members.length);
  row.querySelector('.mix-name').textContent = g.label;
  const kids = document.createElement('div');
  kids.className = 'mix-kids';
  kids.hidden = !g.expanded;
  for (const m of g.members) kids.append(mixerRow(m));
  const expand = row.querySelector('.expand-btn');
  const view = { row, range: row.querySelector('input'), val: row.querySelector('.mix-val'), mute, reset: row.querySelector('.reset'), expand, kids };
  paintRange(view.range, 1);
  g.views.push(view);
  view.range.addEventListener('input', () => { g.value = Number(view.range.value); unmuteGroup(g); applyGroup(g); });
  pressHandlers(mute, () => soloGroup(g), () => {
    if (groupSilent(g)) unmuteGroup(g);
    else g.muted = true;
    applyGroup(g);
  });
  row.querySelector('.reset').addEventListener('click', () => { g.value = 1; unmuteGroup(g); applyGroup(g); });
  if (own) view.own = own.open; // this view opens and closes on its own, not with the Stem volume card
  expand.addEventListener('click', () => {
    if (own) { view.own = !view.own; own.toggle(view.own); } else g.expanded = !g.expanded;
    renderGroup(g);
  });
  block.append(row, kids);
  return block;
}

function unmuteGroup(g) {
  g.muted = false;
  for (const m of g.members) m.muted = false;
}

function applyGroup(g) {
  renderGroup(g);
  g.members.forEach(applyStem);
}

function renderGroup(g) {
  const muted = groupSilent(g);
  for (const v of g.views) {
    v.range.value = g.value;
    paintRange(v.range);
    v.val.textContent = `${Math.round(g.value * 100)}%`;
    v.row.classList.toggle('muted', muted);
    v.mute.setAttribute('aria-pressed', String(muted));
    v.mute.title = `${g.label} (${g.members.length} tracks) — ${muted ? 'unmute' : 'mute'} (hold to solo)`;
    v.mute.setAttribute('aria-label', `${muted ? 'Unmute' : 'Mute'} ${g.label}`);
    v.range.setAttribute('aria-label', `${g.label} volume`);
    v.reset.disabled = g.value === 1 && !muted;
    const open = v.own ?? g.expanded;
    v.kids.hidden = !open;
    v.expand.setAttribute('aria-expanded', String(open));
    v.expand.title = open ? 'Collapse tracks' : 'Show each track';
    v.expand.setAttribute('aria-label', v.expand.title);
  }
}

function soloStem(st) {
  const others = stemStates.filter((o) => o !== st);
  const alreadySolo = !silent(st) && others.every(silent);
  groupList.forEach((g) => { g.muted = false; });
  for (const o of others) o.muted = !alreadySolo;
  st.muted = false;
  applyEverything();
}

function soloGroup(g) {
  const others = stemStates.filter((o) => o.group !== g);
  const alreadySolo = g.members.every((m) => !silent(m)) && others.every(silent);
  groupList.forEach((x) => { x.muted = false; });
  for (const o of others) o.muted = !alreadySolo;
  for (const m of g.members) m.muted = false;
  applyEverything();
}

function applyEverything() {
  groupList.forEach(renderGroup);
  stemStates.forEach(applyStem);
}

// The slider keeps its value while a stem is muted; every view of the stem is updated together.
function applyStem(st) {
  if (st.master) {
    player.setMaster(st.muted ? 0 : st.value);
    store.set('master', String(st.value)); // the master level and its mute are kept between visits
    store.set('masterMuted', st.muted ? '1' : '0');
  } else player.setVolume(st.stem.id, effectiveVolume(st));
  const off = st.master ? st.muted : silent(st);
  for (const v of st.views) {
    v.range.value = st.value;
    paintRange(v.range);
    v.val.textContent = `${Math.round(st.value * 100)}%`;
    v.row.classList.toggle('muted', off);
    v.mute.setAttribute('aria-pressed', String(off));
    v.mute.title = `${st.stem.label} — ${off ? 'unmute' : 'mute'} (hold to solo)`;
    v.reset.disabled = st.value === 1 && !off; // already at the default
    v.mute.setAttribute('aria-label', `${off ? 'Unmute' : 'Mute'} ${st.stem.label}`);
    v.range.setAttribute('aria-label', `${st.stem.label} volume`);
  }
}

// Settings: one value each, shown by every [data-setting] slider (menu popover and info screen).
const SETTING_DEFAULTS = { speed: 1, neck: 1.2, chartDelay: 0 };
const SETTING_FORMAT = {
  speed: (v) => `${v.toFixed(1)}×`,
  neck: (v) => `${v.toFixed(1)}×`,
  // Chart delay: only the highway is shifted. Positive = notes arrive later than the audio.
  chartDelay: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} s`,
};
function setSetting(name, value) {
  settings[name] = value;
  for (const input of document.querySelectorAll(`[data-setting="${name}"]`)) {
    input.value = value;
    paintRange(input, SETTING_DEFAULTS[name]);
  }
  for (const out of document.querySelectorAll(`[data-out="${name}"]`)) out.textContent = SETTING_FORMAT[name](value);
  for (const btn of document.querySelectorAll(`[data-reset="${name}"]`)) btn.disabled = value === SETTING_DEFAULTS[name];
  if (name === 'chartDelay') { paintSectionTicks(); highway.delay = value; }
  if (name === 'speed') player.setRate(value);
  if (name === 'neck') highway.setNeckSpeed(value);
}
document.addEventListener('input', (e) => {
  const name = e.target.dataset?.setting;
  if (name) setSetting(name, Number(e.target.value));
});
for (const name of Object.keys(SETTING_DEFAULTS)) setSetting(name, SETTING_DEFAULTS[name]); // starts the reset buttons disabled
for (const btn of document.querySelectorAll('[data-reset]')) {
  btn.addEventListener('click', () => setSetting(btn.dataset.reset, SETTING_DEFAULTS[btn.dataset.reset]));
}

const popovers = [[els.infoBtn, els.infoPop], [els.sectionBtn, els.sectionPop], [els.mixerBtn, els.mixerPop], [els.settingsBtn, els.settingsPop]];
function closePopovers(except) {
  for (const [btn, pop] of popovers) {
    if (pop === except) continue;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
}
// Opens the popover under its button, aligned to the button's right edge but clamped inside the viewport.
function placePopover(btn, pop) {
  const b = btn.getBoundingClientRect();
  const width = pop.offsetWidth;
  const anchor = pop.classList.contains('align-left') ? b.left : b.right - width; // popovers near the left edge open to the right
  const left = Math.min(Math.max(8, anchor), window.innerWidth - width - 8);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${b.bottom + 8}px`;
  pop.style.maxHeight = `${Math.max(120, window.innerHeight - b.bottom - 16)}px`;
}
window.addEventListener('resize', () => closePopovers());
function registerPopover(btn, pop) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail > 0) btn.blur(); // keep the keyboard shortcuts working after a mouse click
    closePopovers(pop);
    pop.hidden = !pop.hidden;
    if (!pop.hidden) {
      placePopover(btn, pop);
      pop.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'center' }); // long lists open on the current item
    }
    btn.setAttribute('aria-expanded', String(!pop.hidden));
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
}
for (const [btn, pop] of popovers) registerPopover(btn, pop);
popovers.push([{ setAttribute() {} }, els.paneMenu]); // the instrument menu is opened by the tags over the charts (see below)
els.paneMenu.addEventListener('click', (e) => e.stopPropagation());

// The library's <select>s (sort, genre, decade) keep their native element as the value holder but are shown and
// picked through a popover in the same style as the section and instrument lists (the native list ignores the theme).
function customSelect(select, { multi = false, placeholder = '' } = {}) {
  const label = select.closest('label');
  const icon = label.querySelector('svg').cloneNode(true);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip-btn select-btn';
  btn.title = label.title;
  btn.setAttribute('aria-label', select.getAttribute('aria-label'));
  btn.setAttribute('aria-expanded', 'false');
  const text = document.createElement('span');
  const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chev.setAttribute('class', 'chev');
  chev.innerHTML = '<use href="#i-chevron"/>';
  btn.append(icon, text, chev);
  const pop = document.createElement('div');
  pop.className = 'popover part-pop sel-pop align-left';
  pop.hidden = true;
  if (multi) select.multiple = true; // the native select only holds the options and the selection
  label.classList.add('enhanced');
  label.append(btn);
  document.body.append(pop); // fixed popovers must not live inside the sliding drawer (a transformed ancestor)
  const notify = () => {
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const sync = () => {
    const chosen = [...select.selectedOptions];
    // several values: "Genre · 3"; one: its name; none: the placeholder
    text.textContent = multi ? (chosen.length === 0 ? placeholder : chosen.length === 1 ? chosen[0].textContent : `${placeholder} · ${chosen.length}`) : (chosen[0]?.textContent ?? '');
    const rows = [];
    if (multi) { // always there (the list never shifts): a check-all row, checked when all are, a dash when only some
      const all = chosen.length === select.options.length;
      const row = document.createElement('div');
      row.className = 'prow all-row';
      row.dataset.active = String(all);
      row.dataset.partial = String(!all && chosen.length > 0);
      row.setAttribute('role', 'option');
      row.innerHTML = '<span class="check"><svg><use href="#i-check"/></svg></span><span class="prow-name">All</span>';
      row.addEventListener('click', () => { for (const o of select.options) o.selected = !all; notify(); sync(); }); // all on, or all off when all were on
      rows.push(row);
    }
    for (const o of select.options) {
      const row = document.createElement('div');
      row.className = 'prow';
      row.dataset.active = String(o.selected);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(o.selected));
      row.innerHTML = `${multi ? '<span class="check"><svg><use href="#i-check"/></svg></span>' : ''}<span class="prow-name"></span>`;
      row.querySelector('.prow-name').textContent = o.textContent;
      row.addEventListener('click', () => {
        if (multi) {
          o.selected = !o.selected; // toggles; the list stays open for the next pick
          notify();
          sync();
          return;
        }
        select.value = o.value;
        notify();
        sync();
        closePopovers();
      });
      rows.push(row);
    }
    pop.replaceChildren(...rows);
  };
  popovers.push([btn, pop]);
  registerPopover(btn, pop);
  selectSyncs.push(sync);
  sync();
}
customSelect(els.sortBy);
customSelect(els.filterPack, { multi: true, placeholder: 'Pack' });
customSelect(els.filterGenre, { multi: true, placeholder: 'Genre' });
customSelect(els.filterDecade, { multi: true, placeholder: 'Decade' });

document.addEventListener('click', (e) => {
  closePopovers();
  // Drop focus from clicked buttons so Space and the other shortcuts keep working afterwards.
  if (e.target.closest?.('button') && e.detail > 0) document.activeElement?.blur();
});

// ---------- Transport ----------
els.play.addEventListener('click', togglePlay);
function paintSeek(at = Number(els.seek.value)) { // the fill: the playing position (the thumb alone follows the pointer while it is dragged)
  const max = Number(els.seek.max) || 1;
  els.seek.style.setProperty('--pct', `${Math.min(100, (at / max) * 100)}%`);
}
els.seek.addEventListener('input', () => {
  seeking = true;
  els.timeNow.textContent = fmt(Number(els.seek.value));
});
els.seek.addEventListener('change', () => { previewStop = null; seekTo(Number(els.seek.value)); seeking = false; });
// The mouse wheel over the seek bar moves the song: up goes forward, down goes back, 5 s per notch (1 s with Shift).
els.seekbox.addEventListener('wheel', (e) => {
  if (!ready) return;
  e.preventDefault(); // (the page would otherwise scroll or zoom)
  const delta = e.deltaY || e.deltaX; // with Shift some browsers report the wheel as horizontal
  const notches = -delta / (e.deltaMode === 1 ? 3 : 100); // a notch is 100 px or 3 lines; smooth touchpads give fractions
  const to = Math.max(0, Math.min(player.duration, player.currentTime() + notches * (e.shiftKey ? 1 : 5)));
  previewStop = null;
  seekTo(to);
}, { passive: false });

// ---------- Loop (A-B repeat) ----------
// The loop is a range of PLAYER time (the seek bar's scale), so it survives instrument / difficulty changes and is
// cleared when another song opens. State is per session. Two handles on the seek bar move its ends (magnets on the
// section starts, the song start and end; Alt turns them off); a band shows the region.
// Wrap rule: playback jumps back to the start only when it leaves the END of the region from INSIDE it. A loop is
// dormant while playback is outside the region (after a seek before or past it) and re-arms once playback enters it.
let loop = null; // { start, end } or null
let loopPrev = null; // the previous frame's time, to tell a wrap from a seek
let loopDrag = null;
const LOOP_SNAP_PX = 10;
const sectionStartsPlayer = () => (chart?.sections ?? []).map((s) => s.time + settings.chartDelay);
const seekMax = () => Number(els.seek.max) || 0;
// x position of a time on the seek bar, the same mapping as the section ticks (12 px thumb travel)
const timeLeft = (at) => `calc(${(at / (seekMax() || 1)).toFixed(5)} * (100% - 12px) + 6px)`;

function setLoop(range) {
  loop = range && seekMax() > 0 ? range : null;
  loopPrev = null;
  paintLoop();
}
function paintLoop() {
  const on = !!loop;
  els.loopBtn.setAttribute('aria-pressed', String(on));
  els.loopBtn.title = on ? 'End the loop (R)' : 'Loop the current section (R)';
  for (const el of [els.loopBand, els.loopStart, els.loopEnd]) el.hidden = !on;
  if (!on) return;
  els.loopStart.style.left = timeLeft(loop.start);
  els.loopEnd.style.left = timeLeft(loop.end);
  els.loopBand.style.left = timeLeft(loop.start);
  els.loopBand.style.width = `calc(${((loop.end - loop.start) / seekMax()).toFixed(5)} * (100% - 12px))`;
}
async function toggleLoop() {
  if (loop) { setLoop(null); return; }
  if (!chart || !(await ensureAudio())) return;
  setLoop(currentSectionRange(sectionStartsPlayer(), player.currentTime(), player.duration));
}
// A loop changed while the song plays and it no longer covers the playhead: rewind to its start (paused, the playhead stays).
function rewindIntoLoop() {
  if (!loop || !ready || !player.playing) return;
  const now = player.currentTime();
  if (now < loop.start || now >= loop.end) seekTo(loop.start);
}
function loopSectionRow(i) {
  const sec = sectionRange(sectionStartsPlayer(), i, seekMax());
  if (sec) { setLoop(loopForSection(loop, sec)); rewindIntoLoop(); }
}
els.loopBtn.addEventListener('click', toggleLoop);

// Dragging a handle (mouse and touch): pointer capture keeps the move events on the handle; the seek input is untouched.
function timeAtClientX(x) {
  const r = els.seek.getBoundingClientRect();
  const travel = Math.max(1, r.width - 12);
  return Math.max(0, Math.min(seekMax(), ((x - r.left - 6) / travel) * seekMax()));
}
const pxPerSec = () => (els.seek.getBoundingClientRect().width - 12) / (seekMax() || 1);
const loopLabel = (which) => (which === 'start' ? 'Loop start' : 'Loop end');
for (const handle of [els.loopStart, els.loopEnd]) {
  handle.addEventListener('pointerdown', (e) => {
    if (!loop || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    loopDrag = { which: handle.dataset.which, id: e.pointerId };
    showSeekTip(e.clientX, loop[loopDrag.which], loopLabel(loopDrag.which));
  });
  handle.addEventListener('pointermove', (e) => {
    if (!loopDrag || loopDrag.id !== e.pointerId || !loop) return;
    let t = timeAtClientX(e.clientX);
    if (!e.altKey) t = snapTime(t, snapPoints(sectionStartsPlayer(), seekMax()), pxPerSec(), LOOP_SNAP_PX);
    setLoop(clampLoop(loopDrag.which, t, loop, seekMax(), MIN_LOOP));
    showSeekTip(e.clientX, loop[loopDrag.which], loopLabel(loopDrag.which));
  });
  const end = (e) => {
    if (!loopDrag || loopDrag.id !== e.pointerId) return;
    loopDrag = null;
    handle.classList.remove('dragging');
    hideSeekTip();
    rewindIntoLoop();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', end);
}

// Hover tooltip on the seek bar: the section under the pointer and the time there (or a loop handle's time).
// Fixed-position and pointer-events:none, so it also works with the top bar collapsed (only the 4 px line shows).
function showSeekTip(x, time, label) {
  const tip = els.seekTip;
  tip.textContent = `${label} · ${fmt(time)}`;
  tip.hidden = false;
  const r = els.seekbox.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 4, x - w / 2))}px`;
  tip.style.top = `${r.bottom + 6}px`;
}
function hideSeekTip() { els.seekTip.hidden = true; }
els.seekbox.addEventListener('pointermove', (e) => {
  if (!(seekMax() > 0) || loopDrag) return;
  const handle = e.target.closest?.('.loop-handle');
  if (handle && loop) {
    const which = handle.dataset.which;
    showSeekTip(handle.getBoundingClientRect().left + 7, loop[which], loopLabel(which));
    return;
  }
  const t = timeAtClientX(e.clientX); // while the seek input is dragged this shows the dragged time
  const secs = chart?.sections ?? [];
  const name = secs.length ? secs[sectionIndexAt(secs, t - settings.chartDelay)].name : '';
  showSeekTip(e.clientX, t, name || 'Position');
});
els.seekbox.addEventListener('pointerleave', () => { if (!loopDrag) hideSeekTip(); });

// A seek. While the song plays and the jump is long enough to be animated, the audio is not cut to the new place: it rushes
// through the skipped stretch for as long as the fretboards take to get there (see scrub.js), then plays on. Paused, or with the
// animation off, it is immediate.
function seekTo(t) {
  const dist = Math.abs(t - player.currentTime());
  if (!ready || !player.playing || dist <= SEEK_JUMP_SEC || !prefs.get('highway.seekAnimation')) { player.seek(t); return; }
  const ms = seekAnimMs(dist);
  pendingSeekDur = ms;
  player.scrubTo(t, ms);
}

async function togglePlay() {
  if (!chart) return;
  previewStop = null;
  if (player.playing) player.pause();
  else {
    if (infoOpen) setInfoOpen(false); // starting from the details goes to the chart
    if (!(await ensureAudio())) return; // the first Play loads the audio behind the loading screen
    await player.play();
  }
  syncPlayButton();
}

function syncPlayButton() {
  const playing = player.playing;
  els.play.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  els.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  els.npPlay.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  setImmersive();
}

// ---------- 2D / 3D view ----------
function setView(view) {
  highway.setView(view);
  for (const b of els.viewChoice.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  if (prefs.get('highway.view') !== view) prefs.set('highway.view', view); // the last choice is the default
}
setView(prefs.get('highway.view'));
els.viewChoice.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });

// ---------- Vocal view: notes with lyrics, or karaoke (the lyrics alone) ----------
function setVocalView(view) {
  highway.setVocalView(view);
  for (const b of els.vocalChoice.querySelectorAll('[data-vocal]')) b.setAttribute('aria-pressed', String(b.dataset.vocal === view));
  if (prefs.get('highway.vocalView') !== view) prefs.set('highway.vocalView', view);
}
setVocalView(prefs.get('highway.vocalView'));
els.vocalChoice.addEventListener('click', (e) => { const b = e.target.closest('[data-vocal]'); if (b) setVocalView(b.dataset.vocal); });

// ---------- Instrument tags: a tag over every chart opens a menu for that instrument ----------
// The charts are canvas drawings, so the tags are real buttons that follow the rectangles the highway reports (paneRects).
const paneTags = new Map();
let menuKey = null; // the instrument whose menu is open
function syncPaneTags() {
  const seen = new Set();
  for (const r of highway.paneRects) {
    seen.add(r.key);
    if (r.chooser) { // a slot for choosing an instrument: the cards fill the rectangle
      let box = chooserEls.get(r.key);
      if (!box) {
        box = document.createElement('div');
        box.className = 'pane-chooser';
        els.paneTags.append(box);
        chooserEls.set(r.key, box);
        fillChooser(box, r.key);
      }
      const st = `${Math.round(r.x + 8)}|${Math.round(r.y + 8)}|${Math.round(r.w - 16)}|${Math.round(r.h - 16)}`;
      if (box._st !== st) {
        const [bx, by, bw, bh] = st.split('|');
        Object.assign(box.style, { left: `${bx}px`, top: `${by}px`, width: `${bw}px`, height: `${bh}px` });
        box._st = st;
      }
      continue;
    }
    let el = paneTags.get(r.key);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'pane-tag';
      el.innerHTML = '<svg><use href=""/></svg><span></span><i class="chev"></i>';
      el.addEventListener('click', (e) => { e.stopPropagation(); openPaneMenu(el.dataset.key, el); });
      els.paneTags.append(el);
      paneTags.set(r.key, el);
    }
    el.dataset.key = r.key;
    if (el._icon !== r.icon) { el.querySelector('use').setAttribute('href', `#i-${r.icon}`); el._icon = r.icon; }
    if (el._label !== r.label) { el.querySelector('span').textContent = r.label; el._label = r.label; }
    const tx = `translate(${Math.round(r.x + 8)}px, ${Math.round(r.y + 8)}px)`;
    if (el._tx !== tx) { el.style.transform = tx; el._tx = tx; }
    const open = menuKey === r.key && !els.paneMenu.hidden;
    if (el._open !== open) { el.setAttribute('aria-expanded', String(open)); el._open = open; }
  }
  for (const [key, el] of paneTags) if (!seen.has(key)) { el.remove(); paneTags.delete(key); }
  for (const [key, el] of chooserEls) if (!seen.has(key)) { el.remove(); chooserEls.delete(key); }
}

function openPaneMenu(key, anchor) {
  if (!els.paneMenu.hidden && menuKey === key) { els.paneMenu.hidden = true; return; } // the tag again closes it
  closePopovers(els.paneMenu);
  menuKey = key;
  buildPaneMenu();
  els.paneMenu.hidden = false;
  placePopover(anchor, els.paneMenu);
}

// Close / swap / add, for the instruments of the song. A swap or an add opens a slot where the instrument cards are shown.
function closePane(group) {
  if (group.pinned) { current.pins.delete(group.key); updateChart(); return; }
  const next = instrumentGroups().find((g) => g.pinned); // the active one closes: another one takes its place
  if (!next) return;
  current.pins.delete(next.key);
  selectInstrument(next.chosen.id, diffFor(next.chosen).chosen?.id);
}
const hiddenGroups = () => instrumentGroups().filter((g) => !(g.active && !current.hiddenActive) && !g.pinned);
function openChooser(at) {
  current.chooserSeq = (current.chooserSeq ?? 0) + 1;
  current.choosers.push({ id: current.chooserSeq, at, modes: {} });
}
function swapPane(group) { // the fretboard and its tag go; the cards to choose the next instrument take its place
  if (group.pinned) current.pins.delete(group.key);
  else {
    const next = instrumentGroups().find((g) => g.pinned);
    if (next) { current.pins.delete(next.key); selectInstrument(next.chosen.id, diffFor(next.chosen).chosen?.id); }
    else current.hiddenActive = true; // the only instrument: it keeps driving the timeline, but is not drawn until another is chosen
  }
  openChooser(group.key);
  els.paneMenu.hidden = true;
  updateChart();
}
function addPane() {
  openChooser(null);
  els.paneMenu.hidden = true;
  updateChart();
}

// The instrument cards shown in a chooser slot: instrument, type and difficulty, like the details screen's.
const chooserEls = new Map();
function pickInto(chooser, group, ins, diffId) {
  current.choosers = current.choosers.filter((c) => c !== chooser);
  current.modeChoice[group.key] = ins.id;
  if (current.hiddenActive) { // the slot was the only instrument's: the pick becomes the active one
    current.hiddenActive = false;
    selectInstrument(ins.id, diffId);
    return;
  }
  current.diffChoice[ins.id] = diffId;
  current.pins.add(group.key);
  updateChart();
}
// "Add all": every instrument not on screen goes up at once, each with the type and difficulty its card shows.
function addAllInto(chooser) {
  const groups = hiddenGroups();
  current.choosers = current.choosers.filter((c) => c !== chooser);
  if (!groups.length) { updateChart(); return; }
  const picks = groups.map((group) => {
    const ins = group.options.find((o) => o.id === chooser.modes[group.key]) ?? group.chosen;
    return { group, ins, diffId: diffFor(ins).chosen?.id };
  });
  for (const { group, ins, diffId } of picks) { current.modeChoice[group.key] = ins.id; current.diffChoice[ins.id] = diffId; }
  if (current.hiddenActive) { // the slot was the only instrument's: the first pick becomes the active one, the rest are pinned
    current.hiddenActive = false;
    for (const { group } of picks.slice(1)) current.pins.add(group.key);
    selectInstrument(picks[0].ins.id, picks[0].diffId);
    return;
  }
  for (const { group } of picks) current.pins.add(group.key);
  updateChart();
}
function cancelChooser(chooser) {
  current.choosers = current.choosers.filter((c) => c !== chooser);
  if (!current.choosers.length) current.hiddenActive = false; // nothing was picked: the instrument that was swapped is back
  updateChart();
}
function fillChooser(el, key) {
  const chooser = current?.choosers?.find((c) => `choose:${c.id}` === key);
  if (!chooser) return;
  const head = document.createElement('div');
  head.className = 'pc-head';
  head.innerHTML = '<b>Choose an instrument</b><button type="button" class="pc-all" title="Put every instrument on screen">Add all</button><button type="button" class="icon small-icon pc-cancel" title="Cancel" aria-label="Cancel"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
  head.querySelector('.pc-cancel').addEventListener('click', () => cancelChooser(chooser));
  const all = head.querySelector('.pc-all');
  all.hidden = hiddenGroups().length < 2;
  all.addEventListener('click', () => addAllInto(chooser));
  const cards = document.createElement('div');
  cards.className = 'pc-cards';
  for (const group of hiddenGroups()) {
    const ins = group.options.find((o) => o.id === chooser.modes[group.key]) ?? group.chosen; // the type the card shows
    const { diffs, chosen } = diffFor(ins);
    const card = document.createElement('div');
    card.className = 'icard';
    const top = document.createElement('button');
    top.type = 'button';
    top.className = 'icard-head';
    top.innerHTML = `<svg><use href="#i-${INSTRUMENT_ICON[ins.base] || 'music'}"/></svg><span class="icard-name"></span>`;
    top.querySelector('.icard-name').textContent = group.label;
    top.addEventListener('click', () => pickInto(chooser, group, ins, chosen?.id));
    card.append(top);
    if (group.options.length > 1) { // the type
      const modes = document.createElement('div');
      modes.className = 'seg';
      for (const o of group.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o.modeLabel ?? o.label;
        b.setAttribute('aria-pressed', String(o.id === ins.id));
        b.addEventListener('click', () => { chooser.modes[group.key] = o.id; fillChooser(el, key); });
        modes.append(b);
      }
      card.append(modes);
    }
    if (ins.mode !== 'vocals') {
      const seg = document.createElement('div');
      seg.className = 'seg';
      for (const d of diffs) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = d.label;
        b.setAttribute('aria-pressed', String(d.id === chosen?.id));
        b.addEventListener('click', () => pickInto(chooser, group, ins, d.id));
        seg.append(b);
      }
      card.append(seg);
    }
    cards.append(card);
  }
  if (!cards.children.length) cards.textContent = 'Every instrument of this song is on screen.';
  el.replaceChildren(head, cards);
}

// The mixer rows of an instrument inside its menu. They are the same rows as in Stem volume (the slider, the mute button, the
// reset), registered as extra views of the same stem states, so both places always agree; the old ones are dropped on rebuild.
let menuMixViews = [];
function dropMenuMixViews() {
  for (const { owner, added } of menuMixViews) owner.views = owner.views.filter((v) => !added.includes(v));
  menuMixViews = [];
}
function menuVolume(group) {
  const members = stemStates.filter((st) => stemGroup(st.stem.label) === group.key);
  if (!members.length) return null;
  const grouped = groupList.find((g) => g.members[0] && stemGroup(g.members[0].stem.label) === group.key);
  const owners = [...members, ...(grouped ? [grouped] : [])];
  const before = owners.map((o) => o.views.length);
  const wrap = document.createElement('div');
  wrap.className = 'mixer pm-mixer';
  // The tracks of a group show only when their volumes differ (closed while they are all the same); the user can open them.
  const same = members.every((m) => m.value === members[0].value && m.muted === members[0].muted);
  current.menuExpand ??= {};
  const own = grouped ? { open: current.menuExpand[group.key] ?? !same, toggle: (v) => { current.menuExpand[group.key] = v; } } : null;
  wrap.append(grouped ? groupBlock(grouped, own) : mixerRow(members[0]));
  if (grouped) renderGroup(grouped);
  menuMixViews = owners.map((owner, i) => ({ owner, added: owner.views.slice(before[i]) }));
  return wrap;
}

function buildPaneMenu() {
  const host = els.paneMenuDyn;
  dropMenuMixViews();
  host.replaceChildren();
  if (!current) return;
  const groups = instrumentGroups();
  const group = groups.find((g) => g.key === menuKey);
  if (!group) { els.paneMenu.hidden = true; return; }
  const ins = group.chosen;
  const { diffs, chosen } = diffFor(ins);
  const part = (title, node) => {
    const box = document.createElement('div');
    box.className = 'fp-group';
    const label = document.createElement('span');
    label.className = 'fp-label';
    label.textContent = title;
    box.append(label, node);
    host.append(box);
  };
  const seg = (items, pressed, onPick) => {
    const box = document.createElement('div');
    box.className = 'seg fret-seg';
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      b.setAttribute('aria-pressed', String(pressed(item)));
      b.addEventListener('click', () => onPick(item));
      box.append(b);
    }
    return box;
  };
  const canClose = group.pinned || groups.some((g) => g.pinned);
  const head = document.createElement('div');
  head.className = 'pm-head';
  head.innerHTML = `<svg class="pm-icon"><use href="#i-${INSTRUMENT_ICON[ins.base] || 'music'}"/></svg><b></b>`;
  head.querySelector('b').textContent = group.label;
  host.append(head);
  if (ins.mode !== 'vocals' && diffs.length) part('Difficulty', seg(diffs, (d) => d.id === chosen?.id, (d) => pickDifficulty(group, ins, d.id)));
  if (group.options.length > 1) { // the type: 4 lanes / Pro / Pro 7 lanes, Vocals / Harmony
    part('Type', seg(group.options.map((o) => ({ label: o.modeLabel ?? o.label, option: o })), (m) => m.option.id === ins.id, (m) => {
      current.modeChoice[group.key] = m.option.id;
      if (group.pinned) updateChart(); // a fretboard shown next to the active one stays in place
      else selectInstrument(m.option.id, diffFor(m.option).chosen?.id);
    }));
  }
  const volume = menuVolume(group); // the volume of this instrument's track (or tracks), like the Stem volume card
  if (volume) part('Volume', volume);
  const free = hiddenGroups().length - current.choosers.length; // instruments with no slot yet
  const row = els.paneMenuActions; // at the end of the menu: swap, add and remove
  row.replaceChildren();
  for (const [label, enabled, onClick, cls] of [
    ['Swap instrument', hiddenGroups().length > 0, () => swapPane(group), 'chip-btn'],
    ['Add instrument', free > 0, addPane, 'chip-btn'],
    ['Remove instrument', true, () => { if (canClose) { closePane(group); els.paneMenu.hidden = true; } else swapPane(group); }, 'chip-btn pm-remove'], // the only one on screen: it goes, and the cards to choose another take its place
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.disabled = !enabled;
    if (label.startsWith('Remove') && !canClose) b.title = 'It is the only instrument on screen: choose another one';
    b.addEventListener('click', onClick);
    row.append(b);
  }
}

// ---------- Several fretboards: swipe (or drag) sideways to bring the next one into view when they do not all fit ----------
els.highway.style.touchAction = 'none'; // the stage does not scroll: the gestures are ours
const canvasPoint = (e) => {
  const r = els.highway.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
let swipe = null;
const slopFor = (e) => (e.pointerType === 'touch' ? 14 : 6);
// The sizes of the fretboards (dragged dividers) are kept in the browser.
try { highway.setSizes(JSON.parse(localStorage.getItem('yargremote.paneSizes'))); } catch { /* defaults */ }
highway.onResize = () => { try { localStorage.setItem('yargremote.paneSizes', JSON.stringify(highway.getSizes())); } catch { /* optional */ } };
els.highway.addEventListener('pointerdown', (e) => {
  const [px, py] = canvasPoint(e);
  const back = highway.sheetButtonAt(px, py);
  if (back) { highway.resumeSheet(back); return; } // "Autoscroll"
  const play = highway.sheetPlayButtonAt(px, py);
  if (play) { // "Play from here"
    if (ready) { seekTo(Math.max(0, play.playBtn.time + settings.chartDelay)); highway.resumeSheet(play); }
    return;
  }
  const divider = highway.dividerAt(px, py, slopFor(e));
  if (divider) { // resizing: drag a divider between two fretboards, or the one under the vocal band
    swipe = { divider, lastX: e.clientX, lastY: e.clientY, resizing: true };
    highway.hover = divider;
    els.highway.setPointerCapture(e.pointerId);
    return;
  }
  swipe = { x: e.clientX, y: e.clientY, lastY: e.clientY, sheet: highway.sheetAt(px, py), moved: 0 };
});
els.highway.addEventListener('dblclick', (e) => { // double click on a divider: back to the default size
  const divider = highway.dividerAt(...canvasPoint(e), slopFor(e));
  if (divider) { highway.resetSizes(divider); highway.onResize?.(); }
});
els.highway.addEventListener('pointermove', (e) => {
  if (swipe?.resizing) {
    highway.dragDivider(swipe.divider, e.clientX - swipe.lastX, e.clientY - swipe.lastY);
    swipe.lastX = e.clientX;
    swipe.lastY = e.clientY;
    return;
  }
  if (!swipe) { // hovering: light the divider up and show the resize cursor
    highway.pointerAt(...canvasPoint(e));
    const d = highway.dividerAt(...canvasPoint(e), slopFor(e));
    highway.hover = d;
    const jump = highway.sheetPlayButtonAt(...canvasPoint(e)); // over the "jump to" button of a lyric row
    const toCurrent = highway.sheetButtonAt(...canvasPoint(e)); // over the button that goes back to the line being sung
    els.highway.style.cursor = jump || toCurrent ? 'pointer' : d ? (d.type === 'row' ? 'row-resize' : 'col-resize') : '';
    els.highway.title = jump ? `Jump to ${highway.fmtTime(jump.playBtn.time + settings.chartDelay)}` : toCurrent ? 'Jump to the line being sung' : '';
    return;
  }
  if (!swipe.sheet) return;
  const dy = swipe.lastY - e.clientY; // dragging the lyrics up shows the next lines
  swipe.lastY = e.clientY;
  swipe.moved += Math.abs(dy);
  if (swipe.moved > 6 && swipe.sheet.step) highway.scrollSheet(swipe.sheet, dy / swipe.sheet.step);
});
els.highway.addEventListener('pointerleave', () => { highway.pointer = null; if (!swipe) { highway.hover = null; els.highway.style.cursor = ''; } });
els.highway.addEventListener('pointerup', (e) => {
  if (!swipe) return;
  if (swipe.resizing) { // the drag is over: keep the sizes
    swipe = null;
    highway.hover = null;
    highway.onResize?.();
    return;
  }
  const { x, y, sheet } = swipe;
  swipe = null;
  if (sheet) return; // (dragging the lyrics only scrolls them; playing from a line is the button that shows when the pointer rests on it)
  const dx = e.clientX - x;
  const dy = e.clientY - y;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) highway.shiftFocus(dx < 0 ? 1 : -1);
});
els.highway.addEventListener('pointercancel', () => { swipe = null; highway.hover = null; });
els.highway.addEventListener('wheel', (e) => { // the mouse wheel scrolls the lyrics when the pointer is over them
  const sheet = highway.sheetAt(...canvasPoint(e));
  if (!sheet || !sheet.step) return;
  e.preventDefault();
  highway.scrollSheet(sheet, e.deltaY / sheet.step);
}, { passive: false });

// ---------- Note style: circles or rounded rectangles ----------
function setNoteStyle(style) {
  highway.setNoteStyle(style);
  for (const b of els.noteChoice.querySelectorAll('[data-note]')) b.setAttribute('aria-pressed', String(b.dataset.note === style));
  if (prefs.get('highway.noteStyle') !== style) prefs.set('highway.noteStyle', style);
}
setNoteStyle(prefs.get('highway.noteStyle'));
els.noteChoice.addEventListener('click', (e) => { const b = e.target.closest('[data-note]'); if (b) setNoteStyle(b.dataset.note); });

// ---------- Hide / show the top bar (the chart takes its space) ----------
// The stage buttons line up with the right edge of the top bar's content (which stops growing on wide screens).
function alignStageButtons() {
  const main = document.querySelector('.tb-main');
  const stage = els.stage ?? document.getElementById('stage');
  const right = Math.round(stage.getBoundingClientRect().right - main.getBoundingClientRect().right);
  stage.style.setProperty('--stage-btn-right', `${Math.max(10, right)}px`);
}
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(alignStageButtons);
  ro.observe(document.getElementById('stage'));
  ro.observe(document.querySelector('.tb-main'));
}
window.addEventListener('resize', alignStageButtons);
els.app.addEventListener('transitionend', alignStageButtons); // the library slides in and out
function setBarHidden(hidden, persist = true) {
  els.app.classList.toggle('bar-hidden', hidden);
  els.barShow.hidden = !hidden;
  if (persist) store.set('barHidden', hidden ? '1' : '0');
  closePopovers();
  alignStageButtons();
}
setBarHidden(prefs.get('highway.barHidden') === 'hidden' || (prefs.get('highway.barHidden') === 'last' && store.get('barHidden') === '1'));
if (prefs.get('highway.neck') !== SETTING_DEFAULTS.neck) setSetting('neck', prefs.get('highway.neck')); // the starting neck speed
els.barHide.addEventListener('click', () => setBarHidden(true));
els.barShow.addEventListener('click', () => setBarHidden(false));

// ---------- Background visualizer ----------
// One animated background behind every fretboard (src/visualizers.js, Highway.setVisualizer). The picker is a popover from the
// tools row; the choice, its visibility and its blur live in prefs (highway.visualizer, highway.visualizerVisibility, highway.visualizerBlur).
let vizSrc = null;
const vizDriver = createVisualizerDriver({
  getSource() { // rebuilt only when the charts on screen change (setCharts makes a new panes array)
    if (!current || !highway.panes.length) return null;
    if (vizSrc?.key !== highway.panes) {
      const ini = current.song.ini || {};
      vizSrc = {
        key: highway.panes, coverUrl: current.coverUrl,
        song: { title: plainText(current.song.title), artist: plainText(current.song.artist), genre: ini.genre, year: ini.year, length: (Number(ini.song_length) || 0) / 1000, bpmRange: bpmRange(current.midi?.tempos) },
        charts: highway.panes.map((p) => p.chart).filter(Boolean),
      };
    }
    return vizSrc;
  },
});
const vizBtn = document.getElementById('visualizerBtn');
const vizPop = document.getElementById('visualizerPop');
// A slider row led by an icon instead of a text label (shown only when a visualizer is selected).
function vizSlider(icon, label, min, max, step, pref) {
  const row = document.createElement('label');
  row.className = 'viz-level viz-slider';
  row.title = label;
  row.innerHTML = `<svg aria-hidden="true"><use href="#${icon}"/></svg><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}"><output></output>`;
  const input = row.querySelector('input');
  input.addEventListener('input', () => prefs.set(pref, Number(input.value)));
  return { row, input, output: row.querySelector('output') };
}
const vizVis = vizSlider('i-eye', 'Visibility', 10, 95, 5, 'highway.visualizerVisibility');
const vizBlur = vizSlider('i-blur', 'Blur', 0, 40, 1, 'highway.visualizerBlur');
const vizColor = document.createElement('div'); // the stage colour: shown with "None" too, and behind visualizers that let it through
vizColor.className = 'viz-level viz-color';
vizColor.innerHTML = '<span>Background</span><span class="viz-color-row"><input type="color" aria-label="Stage colour"><button type="button" class="seg-btn">Theme</button></span><output></output>';
const vizColorInput = vizColor.querySelector('input');
vizColorInput.addEventListener('input', () => { prefs.set('highway.stageColor', vizColorInput.value); prefs.set('highway.stageColorOn', true); });
vizColor.querySelector('button').addEventListener('click', () => prefs.set('highway.stageColorOn', false));
const vizList = document.createElement('div'); // scrolls when the effects do not fit; the sliders below stay in view
vizList.className = 'viz-list';
vizList.replaceChildren(...VISUALIZERS.map((v) => {
  const row = document.createElement('div');
  row.className = 'prow';
  row.dataset.id = v.id;
  row.setAttribute('role', 'option');
  row.innerHTML = '<span class="viz-sw"></span><span class="viz-text"><span class="prow-name"></span><small></small></span>';
  const sw = row.querySelector('.viz-sw');
  if (v.id === 'none') sw.dataset.none = ''; else sw.style.background = v.swatch;
  row.querySelector('.prow-name').textContent = v.label;
  row.querySelector('small').textContent = v.hint;
  row.addEventListener('click', () => prefs.set('highway.visualizer', v.id)); // the list stays open: the chart behind shows the result
  return row;
}));
const vizFoot = document.createElement('div');
vizFoot.className = 'viz-foot';
vizFoot.append(vizVis.row, vizBlur.row, vizColor);
vizPop.replaceChildren(vizList, vizFoot);
function syncVizPop() {
  const id = prefs.get('highway.visualizer');
  for (const row of vizPop.querySelectorAll('.prow')) {
    row.dataset.active = String(row.dataset.id === id);
    row.setAttribute('aria-selected', String(row.dataset.id === id));
  }
  vizVis.row.hidden = vizBlur.row.hidden = id === 'none';
  vizVis.input.value = prefs.get('highway.visualizerVisibility');
  vizBlur.input.value = prefs.get('highway.visualizerBlur');
  const custom = prefs.get('highway.stageColorOn');
  vizColorInput.value = custom ? prefs.get('highway.stageColor') : themeStage;
  vizColor.querySelector('button').hidden = !custom;
  vizVis.output.textContent = `${vizVis.input.value}%`;
  vizBlur.output.textContent = `${vizBlur.input.value}px`;
}
popovers.push([vizBtn, vizPop]);
registerPopover(vizBtn, vizPop);
function cycleVisualizer(step) { // key G (Shift+G goes back)
  const i = VISUALIZERS.findIndex((v) => v.id === prefs.get('highway.visualizer'));
  const next = VISUALIZERS[(i + step + VISUALIZERS.length) % VISUALIZERS.length];
  prefs.set('highway.visualizer', next.id);
}

// ---------- Fullscreen and idle bar ----------
let idleTimer = 0;
function setImmersive() {
  const on = !!document.fullscreenElement;
  els.app.classList.toggle('immersive', on);
  els.fullscreen.querySelector('use').setAttribute('href', on ? '#i-shrink' : '#i-expand');
  wake();
}
function wake() {
  els.app.classList.remove('idle');
  clearTimeout(idleTimer);
  if (document.fullscreenElement && player.playing) {
    idleTimer = setTimeout(() => {
      if (popovers.every(([, pop]) => pop.hidden)) els.app.classList.add('idle');
    }, 2500);
  }
}
els.fullscreen.addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else els.app.requestFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', setImmersive);
document.addEventListener('mousemove', wake);

// ---------- Keyboard ----------
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target.tagName;
  if (typeof settingsPage !== 'undefined' && settingsPage.isOpen()) { // the settings page owns the keyboard while it is open
    if (e.code === 'Escape') settingsPage.close();
    return;
  }
  if (e.code === 'Escape') {
    if (popovers.every(([, pop]) => pop.hidden) && infoOpen && loadInfo.state !== 'idle') setInfoOpen(false); // details -> chart
    closePopovers();
    return;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return;
  if (e.code === 'Space' && chart) { e.preventDefault(); togglePlay(); }
  else if (e.code === 'KeyI' && (current || loadInfo.state !== 'idle')) setInfoOpen(!infoOpen);
  else if (e.code === 'KeyL') setLibraryOpen(!libraryOpen());
  else if (e.code === 'KeyD') setSongPanelOpen(!songPanelOpen());
  else if (e.code === 'KeyB') setBarHidden(!els.app.classList.contains('bar-hidden'));
  else if (e.code === 'KeyF') toggleFullscreen();
  else if (e.code === 'KeyV') setView(highway.view === '3d' ? '2d' : '3d');
  else if (e.code === 'BracketRight') highway.shiftFocus(1);
  else if (e.code === 'BracketLeft') highway.shiftFocus(-1);
  else if (e.code === 'KeyK' && highway.panes.some((p) => p.chart.mode === 'vocals')) setVocalView(highway.vocalView === 'karaoke' ? 'track' : 'karaoke');
  else if (e.code === 'KeyP') cyclePerfOverlay();
  else if (e.code === 'KeyR' && chart) toggleLoop();
  else if (e.code === 'KeyG') cycleVisualizer(e.shiftKey ? -1 : 1);
  else if (e.code === 'KeyN') setNoteStyle(highway.noteStyle === 'rect' ? 'round' : 'rect');
  else if (e.code === 'BracketLeft') stepSection(-1);
  else if (e.code === 'BracketRight') stepSection(1);
  else if (e.code === 'ArrowLeft' && ready) seekTo(Math.max(0, player.currentTime() - 5));
  else if (e.code === 'ArrowRight' && ready) seekTo(Math.min(player.duration, player.currentTime() + 5));
});

// ---------- Frame loop (started once) ----------
// Jumps in the song (seeking, a section, a lyric line) are animated on the fretboards: the notes rush past to the new place
// instead of the chart snapping there. Only what the highway draws is eased; the clock, the sections and the audio use the real time.
let vis = { shown: null, last: null, anim: null, chart: null, step: 0 };
let instantJump = false; // the next jump is not animated (the loop wrap-around)
const MOTION_BLUR_MIN_STEP = 0.06; // seconds of song per frame from which the jump is blurred
const SEEK_JUMP_SEC = 0.75; // a bigger step between two frames than playback or a drag can make
const seekAnimMs = (dist) => Math.min(700, 280 + dist * 25); // longer for longer jumps, 0.7 s at most
let pendingSeekDur = null; // set by seekTo: the duration the audio scrub takes, so the fretboards' animation lasts the same
function visualChartTime(ct) {
  const now = performance.now();
  if (!prefs.get('highway.seekAnimation') || vis.chart !== chart || vis.last === null) {
    instantJump = false; // (a pending instant jump is moot: nothing is animated now)
    vis = { shown: ct, last: ct, anim: null, chart, step: 0 };
    return ct;
  }
  if (instantJump) { // a loop wrap: land at once, no rush and no blur
    instantJump = false;
    vis = { shown: ct, last: ct, anim: null, chart, step: 0 };
    return ct;
  }
  if (Math.abs(ct - vis.last) > SEEK_JUMP_SEC) { // a jump: ease from where the chart is shown now
    const from = vis.anim ? vis.shown : vis.last;
    vis.anim = { from, t0: now, dur: pendingSeekDur ?? seekAnimMs(Math.abs(ct - from)) };
    pendingSeekDur = null;
  }
  vis.last = ct;
  const before = vis.shown;
  if (vis.anim) {
    const p = (now - vis.anim.t0) / vis.anim.dur;
    if (p >= 1) { vis.anim = null; vis.shown = ct; } else vis.shown = vis.anim.from + (ct - vis.anim.from) * (1 - (1 - p) ** 3); // ease-out: fast, then settles
  } else vis.shown = ct;
  vis.step = vis.shown - before; // how far the drawn time moved this frame
  return vis.shown;
}

function frame() {
  const frameStart = performance.now();
  let drawMs = 0;
  if (current && chart) {
    let t = player.currentTime();
    if (loop && player.playing) {
      // Look-ahead: the audio restarts after the output latency, so asking a little early makes the new start audible
      // right when the old end would have been heard.
      const ahead = ((player.outputLatency || 0) + 0.01) * player.rate;
      if (shouldWrap(loop, loopPrev, t, ahead)) {
        player.seek(loop.start);
        instantJump = true;
        t = loop.start;
      }
    }
    loopPrev = t;
    if (previewStop != null && (!player.playing || t >= previewStop)) {
      if (player.playing) { player.pause(); syncPlayButton(); }
      previewStop = null;
    }
    if (player.playing && t >= player.duration) {
      player.pause();
      syncPlayButton();
    }
    const chartTime = t - settings.chartDelay;
    const shownTime = visualChartTime(chartTime);
    if (vis.anim && Math.abs(vis.step) > MOTION_BLUR_MIN_STEP && prefs.get('highway.motionBlur')) { // a fast jump: blur the motion
      const span = Math.max(-0.6, Math.min(0.6, vis.step * 0.85)); // the exposure: most of the frame, within limits
      const d0 = performance.now();
      highway.renderBlur(Array.from({ length: 8 }, (_, k) => shownTime - span * (1 - k / 7)));
      drawMs = performance.now() - d0;
    } else {
      const d0 = performance.now();
      highway.render(shownTime);
      drawMs = performance.now() - d0;
    }
    syncPaneTags();
    const index = chart.sections.length ? sectionIndexAt(chart.sections, chartTime) : -1;
    if (index >= 0) setActiveSection(index);
    if (seeking) paintSeek(t); // dragging: the thumb is in the user's hand, the fill goes on with the music
    else {
      const barT = t; // the bar is always at the real position: the thumb is already where the song went and only the fretboards travel there
      els.seek.value = barT;
      els.seekbox.classList.toggle('animating', !!vis.anim);
      paintSeek(vis.anim ? Math.max(0, Math.min(player.duration, shownTime + settings.chartDelay)) : barT); // the fill travels with the fretboards (the thumb is already at the target)
      els.timeNow.textContent = fmt(barT);
    }
    if (infoOpen) { // the Listen card
      if (document.activeElement !== els.npSeek) els.npSeek.value = t;
      els.npTime.textContent = `${fmt(t)} / ${fmt(player.duration)}`;
    }
  } else {
    const d0 = performance.now();
    highway.render(0);
    drawMs = performance.now() - d0;
    syncPaneTags();
  }
  perf.frame(frameStart, drawMs);
  perfOverlay.tick(frameStart);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function fmt(sec) {
  const s = Math.floor(sec || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- Settings: what each setting does, and the settings page ----------
const fontCss = (key) => (FONT_OPTIONS.find((f) => f.value === key) ?? FONT_OPTIONS[0]).css;
const cardsConfig = () => ({
  thumbs: prefs.get('library.thumbs'), scale: prefs.get('library.cardScale') / 100, iconSize: prefs.get('library.iconSize'),
  compact: { artist: prefs.get('cards.compact.artist'), pack: prefs.get('cards.compact.pack') },
  normal: { artist: prefs.get('cards.normal.artist'), pack: prefs.get('cards.normal.pack'), icons: prefs.get('cards.normal.icons') },
  large: Object.fromEntries(Object.keys(DEFAULT_CARDS.large).map((k) => [k, prefs.get(`cards.large.${k}`)])),
});
const applyCards = () => list.setCards(cardsConfig());
const applyColumns = () => {
  const c = prefs.get('library.columns');
  if (c === 'auto') list.setColumns(1, { minWidth: 'auto' });
  else list.setColumns(Number(c));
};
const COVER_SIZES = { small: 96, medium: 160, large: 240 };
function applyDetails() {
  const info = els.info;
  const hidden = ['listen', 'specials', 'instruments', 'adjust', 'volume', 'extra'].filter((s) => !prefs.get('details.sections').includes(s));
  info.dataset.hide = hidden.join(' ');
  info.dataset.layout = prefs.get('details.layout');
  info.dataset.cover = prefs.get('details.cover');
  info.dataset.quote = prefs.get('details.quote') ? 'on' : 'off';
  info.dataset.names = prefs.get('details.stemNames');
  info.classList.toggle('compact', prefs.get('details.compact'));
  info.style.setProperty('--info-max', `${prefs.get('details.maxWidth')}px`);
  if (current) renderMeta(current.song, current.midi); // the chips
}
const EFFECTS = {
  'highway.lyricsAbove': (v) => { highway.sheetPeek = v / 100; },
  'highway.countdown': (v) => { highway.countdowns = v; },
  'highway.vocalView': (v) => { if (highway.vocalView !== v) setVocalView(v); },
  'highway.paneMin': (v) => highway.setPaneMin(v),
  'highway.view': (v) => { if (highway.view !== v) setView(v); },
  'highway.noteStyle': (v) => setNoteStyle(v),
  'perf.overlay': (v) => perfOverlay.setMode(v),
  'perf.position': (v) => perfOverlay.setPosition(v),
  'details.chips': applyDetails, 'details.cover': applyDetails, 'details.quote': applyDetails, 'details.sections': applyDetails,
  'details.layout': applyDetails, 'details.stemNames': applyDetails, 'details.maxWidth': applyDetails, 'details.compact': applyDetails,
  'library.cardStyle': (v) => { list.setMode(v); syncViewSeg(); },
  'library.sort': (v) => { if (els.sortBy.value !== v) els.sortBy.value = v; syncFilterUi(); renderList(); },
  'library.sortDesc': (v) => { sortDesc = v; renderList(); },
  'library.columns': applyColumns,
  'library.dividers': () => renderList(),
  'library.rail': (v) => document.querySelector('.songs-wrap').classList.toggle('no-rail', !v),
  'library.thumbs': applyCards, 'library.cardScale': applyCards, 'library.iconSize': applyCards,
  ...Object.fromEntries(['compact.artist', 'compact.pack', 'normal.artist', 'normal.pack', 'normal.icons', ...Object.keys(DEFAULT_CARDS.large).map((k) => `large.${k}`)].map((k) => [`cards.${k}`, applyCards])),
  'theme.preset': applyThemeSetting,
  'theme.overrides': applyThemeSetting,
  'theme.saved': applyThemeSetting,
  'ui.radius': (v) => document.documentElement.style.setProperty('--radius', `${v}px`),
  'ui.font': (v) => document.documentElement.style.setProperty('--font', fontCss(v)),
  'highway.visualizer': (v) => { vizDriver.select(v); highway.setVisualizer(vizDriver.fn); syncVizPop(); },
  'highway.visualizerVisibility': (v) => { vizDriver.visibility = v / 100; syncVizPop(); },
  'highway.visualizerBlur': (v) => { vizDriver.blur = v; syncVizPop(); },
  'highway.trackOpacity': (v) => { highway.trackOpacity = v / 100; },
  'highway.stageColorOn': () => { applyStage(); syncVizPop(); },
  'highway.stageColor': () => { applyStage(); syncVizPop(); },
  'ui.animations': (v) => { document.documentElement.dataset.motion = v ? 'on' : 'off'; },
};
for (const [id, fn] of Object.entries(EFFECTS)) fn(prefs.get(id));
prefs.subscribe((id, value) => EFFECTS[id]?.(value));

const settingsPage = mountSettings({
  root: document.getElementById('settingsPage'), settings: prefs, sections: SECTIONS,
  renderers: {
    theme: (host, ctx) => renderThemeStudio(host, { ...ctx, prefersDark: () => darkQuery.matches, notify: setStatus }),
    'data.tools': (host, ctx) => renderDataTools(host, {
      ...ctx, notify: setStatus,
      extra: [{ label: 'Clear thumbnail cache', help: 'Album thumbnails are rebuilt as you scroll.', run: async () => { await clearThumbs(); return 'Thumbnail cache cleared; thumbnails are rebuilt as you scroll.'; } }],
    }),
  },
});
document.getElementById('openSettings').addEventListener('click', () => settingsPage.open());
document.addEventListener('keydown', (e) => {
  if (e.key === ',' && !e.ctrlKey && !e.metaKey && !e.altKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); settingsPage.isOpen() ? settingsPage.close() : settingsPage.open(); }
});

// ---------- Deep links: the URL hash names the open song ----------
// The hash is only replaced (no history entries): a reload or a shared link opens the same song, and the two panels
// stay in place. #/song/<id> opens the details, #/song/<id>/play the chart.
// The instruments on screen for the link: the active one first, then the pinned ones, each with its difficulty.
function instrumentsOnScreen() {
  if (!current?.options?.length) return [];
  const out = [];
  for (const g of instrumentGroups()) {
    if (!(g.active && !current.hiddenActive) && !g.pinned) continue;
    const d = g.active ? els.difficulty.value : diffFor(g.chosen).chosen?.id;
    out.push({ id: g.chosen.id, diff: d || undefined, active: g.active });
  }
  out.sort((x, y) => Number(!!y.active) - Number(!!x.active)); // the active one leads
  return out.map(({ id, diff }) => ({ id, diff }));
}
// Puts the instruments of a link on screen: the first is the active one, the others are pinned. Unknown ones are ignored.
function applyInstruments(list) {
  const known = (list || []).filter((x) => current.options.some((o) => o.id === x.id));
  if (!known.length) return false;
  const [first, ...rest] = known;
  els.instrument.value = first.id;
  fillDifficultyOptions();
  if (first.diff && [...els.difficulty.options].some((o) => o.value === first.diff)) els.difficulty.value = first.diff;
  current.pins.clear();
  current.hiddenActive = false;
  const groups = instrumentGroups();
  for (const x of rest) {
    const g = groups.find((gr) => gr.options.some((o) => o.id === x.id));
    if (!g || g.active) continue;
    current.modeChoice[g.key] = x.id;
    if (x.diff) current.diffChoice[x.id] = x.diff;
    current.pins.add(g.key);
  }
  return true;
}
function syncUrl() {
  if (!current) return;
  store.set('lastSong', current.song.id); // for "Reopen the last song"
  const hash = formatRoute({ view: infoOpen ? 'song' : 'play', id: current.song.id, instruments: instrumentsOnScreen() });
  if (location.hash !== hash) history.replaceState(null, '', hash);
  document.title = `${plainText(current.song.title)} - ${plainText(current.song.artist)} · YARG Remote`;
}
function openFromHash() {
  const route = parseRoute(location.hash);
  if (route.view === 'library') return;
  if (current?.song.id === route.id) { // the same song: a link with other instruments rearranges the screen
    if (route.instruments && applyInstruments(route.instruments)) updateChart();
    return;
  }
  const song = songs.find((s) => s.id === route.id);
  if (!song) return;
  loadAudioWithSong = route.view === 'play';
  pendingInstruments = route.instruments || null;
  selectSong(song);
  if (route.view === 'play') setInfoOpen(false);
}
window.addEventListener('hashchange', openFromHash);
