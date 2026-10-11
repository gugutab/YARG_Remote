import { parseMidi } from './midi.js';
import { DIFFICULTIES, EXTENDED_DRUM_LANES, instrumentOptions, availableDifficulties, buildChart, sectionIndexAt } from './chart.js';
import { MultiTrackPlayer } from './player.js';
import { Highway } from './highway.js';
import { walkHandle, entriesFromFileList, scanSongs, audioStemsOf, findCover, readBytes, serializeSongs, restoreSongs, restoreRemoteSongs } from './library.js';
import { songDelaySeconds, plainText } from './ini.js';
import { metaRows, extraRows, chartStats, bpmLabel, instrumentLevel, stemKind, stemBadge, stemGroup, stemGroupLabel } from './songinfo.js';
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

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'app', 'library', 'toggleLibrary', 'closeLibrary', 'splitter', 'groupLabel', 'rail', 'scrim', 'pick', 'resume', 'rescan', 'folderInput', 'status',
  'search', 'sortBy', 'sortDir', 'filterBtn', 'filterBadge', 'filterPanel', 'instChips', 'levelSeg', 'filterGenre', 'filterDecade', 'filterPack', 'filterClear', 'activeFilters', 'viewSeg', 'count', 'songs', 'empty',
  'now', 'brand', 'cover', 'title', 'artist', 'chips', 'instrument', 'difficulty',
  'transport', 'play', 'back', 'forward', 'seekbox', 'seek', 'timeNow', 'timeTotal',
  'tools', 'sectionSelect', 'mixerBtn', 'mixerPop', 'partBtn', 'partPop', 'partText', 'partIcon', 'sectionBtn', 'sectionPop', 'sectionText', 'partDiff', 'infoPop', 'infoPopCover', 'infoPopTitle', 'infoPopArtist', 'infoPopMeta', 'infoPopMore', 'mixer', 'settingsBtn', 'settingsPop',
  'fullscreen', 'barHide', 'barShow', 'fretBtn', 'fretPop', 'viewChoice', 'noteChoice', 'infoBtn', 'info', 'infoCover', 'infoTitle', 'infoArtist', 'infoQuote', 'infoMeta', 'instrumentCards',
  'mixerInfo', 'infoExtra', 'infoProgress', 'infoBar', 'infoState', 'infoPlay', 'infoMenu',
  'stage', 'highway', 'loading', 'welcome', 'welcomeOpen',
].map((id) => [id, $(id)]));

for (const img of [els.cover, els.infoCover, els.infoPopCover]) img.addEventListener('error', () => { img.hidden = true; });
const player = new MultiTrackPlayer();
const highway = new Highway(els.highway);
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
function applyThemeSetting() {
  const theme = resolveTheme({ preset: prefs.get('theme.preset'), overrides: prefs.get('theme.overrides'), saved: prefs.get('theme.saved') }, darkQuery.matches);
  applyTheme(theme);
  highway.setBackground(theme.vars.stage);
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
function setLibraryOpen(open, persist = true) {
  els.app.classList.toggle('lib-closed', !open);
  if (persist) store.set('library', open ? '1' : '0');
  // Let the layout settle, then the canvas resizes itself on the next frame.
}
const narrow = () => window.matchMedia('(max-width: 700px)').matches;
const libraryOpen = () => !els.app.classList.contains('lib-closed');
setLibraryOpen(!narrow(), false); // two panels: the library starts open on a desktop screen (collapsing it only lasts for the session)
// The drawer overlay on narrow screens starts closed; entering that layout closes it.
window.matchMedia('(max-width: 700px)').addEventListener('change', (e) => { if (e.matches) setLibraryOpen(false, false); });
els.toggleLibrary.addEventListener('click', () => setLibraryOpen(!libraryOpen(), false));
els.closeLibrary.addEventListener('click', () => setLibraryOpen(false, false));
els.scrim.addEventListener('click', () => setLibraryOpen(false, false));
els.welcomeOpen.addEventListener('click', () => setLibraryOpen(true));

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
for (const [legacy, id] of [['cardMode', 'library.cardStyle'], ['sortBy', 'library.sort']]) {
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
async function selectSong(song) {
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
  current = null;
  chart = null;
  highway.setChart(null);
  renderList({ keepScroll: true });
  if (narrow()) setLibraryOpen(false, false);

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

  const midiEntry = song.files.get('notes.mid');
  if (!midiEntry) {
    setLoadState('error', 'This song has no notes.mid (.chart-only is not supported in this version).');
    return;
  }
  let midi;
  try {
    midi = parseMidi(await readBytes(midiEntry));
  } catch (err) {
    if (token === loadToken) setLoadState('error', `Could not read notes.mid: ${err.message}`);
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

  current = { song, midi, coverUrl, options: instrumentOptions(midi), diffChoice: {}, statsCache: new Map(), expandedStats: new Set(), modeChoice: {} };
  renderMeta(song, midi); // adds the BPM chip
  renderList({ keepScroll: true }); // highlight the loaded song
  syncUrl();
  fillInstrumentOptions();
  updateChart(); // the chart exists as soon as the MIDI is read; only playback waits for the audio
  const stems = audioStemsOf(song);
  buildMixer(stems);

  setLoadState('loading', 'Loading audio…', 0.1);
  let loaded = false;
  try {
    loaded = await player.load(stems, {
      delay: songDelaySeconds(song.ini),
      onProgress: (p) => {
        if (token === loadToken) setLoadState('loading', `Loading audio… ${Math.round(p * 100)}%`, 0.1 + p * 0.9);
      },
    });
  } catch (err) {
    if (token === loadToken) setLoadState('error', `Failed to decode audio: ${err.message}`);
    return;
  }
  if (token !== loadToken || !loaded) return;
  els.seek.max = player.duration.toFixed(2);
  els.timeTotal.textContent = fmt(player.duration);
  paintSectionTicks(); // the slider range is known now
  stemStates.forEach(applyStem); // volumes chosen while loading
  ready = true;
  setLoadState('ready', chart ? 'Ready to play' : 'No playable instrument in this song.', 1);
  if (chart && prefs.get('general.autoplay')) togglePlay(); // "Play as soon as a song has loaded"
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
  els.play.disabled = els.infoPlay.disabled = !(ready && chart);
  const overlay = !infoOpen && (state === 'loading' || state === 'error');
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
  const rows = metaRows(song).filter((r) => r.label !== 'Artist'); // the artist is the subtitle
  const bpm = bpmLabel(midi?.tempos);
  if (bpm) rows.push({ label: 'BPM', value: bpm, icon: 'pulse' });
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
    const built = ins.id === els.instrument.value && diff.id === els.difficulty.value && chart ? chart : buildChart(current.midi, ins, diff);
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
  }
  return out;
}

const diffFor = (ins) => {
  const diffs = availableDifficulties(current.midi, ins);
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
        btn.setAttribute('aria-pressed', String(group.active && o.id === activeId));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          current.modeChoice[group.key] = o.id;
          selectInstrument(o.id, diffFor(o).chosen?.id);
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
        btn.setAttribute('aria-pressed', String(group.active && d.id === els.difficulty.value));
        btn.addEventListener('click', (e) => { e.stopPropagation(); selectInstrument(ins.id, d.id); });
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
  renderPartMenu();
}

// Top-bar item: one chip for instrument + difficulty, opening a compact vertical list (icon, name, difficulty buttons).
// Drums are one row with a second line of mode buttons.
function renderPartMenu() {
  const ins = currentInstrument();
  const diffInfo = DIFFICULTIES.find((d) => d.id === els.difficulty.value);
  const diffLabel = diffInfo?.label;
  const diffShort = diffInfo?.short;
  els.partIcon.setAttribute('href', `#i-${ins ? INSTRUMENT_ICON[ins.base] || 'music' : 'music'}`);
  els.partText.textContent = ins ? ins.label : 'No instrument';
  const letter = ins && ins.mode !== 'vocals' && diffShort ? diffShort : '';
  els.partDiff.textContent = letter;
  els.partDiff.title = diffLabel || '';
  els.partDiff.hidden = !letter; // difficulty as a single letter, like the list rows
  const shortMode = { four: '4', five: '5', pro: 'Pro', extended: String(EXTENDED_DRUM_LANES.length) };
  els.partPop.replaceChildren(...(current ? instrumentGroups() : []).map((group) => {
    const o = group.chosen;
    const { diffs, chosen } = diffFor(o);
    const row = document.createElement('div');
    row.className = 'prow';
    row.dataset.active = String(group.active);
    row.innerHTML = `<svg><use href="#i-${INSTRUMENT_ICON[o.base] || 'music'}"/></svg><span class="prow-name"></span>`;
    row.querySelector('.prow-name').textContent = group.label;
    row.addEventListener('click', () => { selectInstrument(o.id, chosen?.id); });
    if (o.mode !== 'vocals') {
      const seg = document.createElement('div');
      seg.className = 'seg compact';
      for (const d of diffs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = d.short; // E, M, H, X
        btn.title = d.label;
        btn.setAttribute('aria-label', `${group.label}, ${d.label}`);
        btn.setAttribute('aria-pressed', String(group.active && d.id === els.difficulty.value));
        btn.addEventListener('click', (e) => { e.stopPropagation(); selectInstrument(o.id, d.id); });
        seg.append(btn);
      }
      row.append(seg);
    }
    if (group.options.length > 1) {
      const line = document.createElement('div');
      line.className = 'modes-line';
      const modes = document.createElement('div');
      modes.className = 'seg compact modes';
      for (const m of group.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = shortMode[m.drumMode] ?? (m.harmony ? 'H' : 'V');
        btn.title = m.modeLabel ?? m.label;
        btn.setAttribute('aria-label', m.label);
        btn.setAttribute('aria-pressed', String(group.active && m.id === els.instrument.value));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          current.modeChoice[group.key] = m.id;
          selectInstrument(m.id, diffFor(m).chosen?.id);
        });
        modes.append(btn);
      }
      if (o.mode === 'vocals') { // no difficulty buttons: the modes take the same line as the name
        row.append(modes);
      } else {
        line.append(modes);
        row.append(line);
      }
    }
    return row;
  }));
}

els.infoPopMore.addEventListener('click', () => { closePopovers(); setInfoOpen(true); });
els.infoMenu.addEventListener('click', () => setLibraryOpen(!libraryOpen()));
els.infoPlay.addEventListener('click', () => togglePlay());

function showPlayInfo(on) {
  els.now.hidden = !on;
  els.brand.hidden = on;
  els.chips.hidden = !on;
  els.transport.hidden = !on;
  els.seekbox.hidden = !on;
  els.tools.hidden = !on;
  els.fretBtn.hidden = true; // shown once there is a lane chart (updateChart)
  els.fretPop.hidden = true;
}

function fillInstrumentOptions() {
  els.instrument.replaceChildren(...current.options.map((ins) => new Option(ins.label, ins.id)));
  els.instrument.disabled = current.options.length === 0;
  fillDifficultyOptions();
}

function fillDifficultyOptions() {
  const ins = currentInstrument();
  const diffs = ins ? availableDifficulties(current.midi, ins) : [];
  const previous = els.difficulty.value;
  els.difficulty.replaceChildren(...diffs.map((d) => new Option(d.label, d.id)));
  // Keep the previous choice when still available, otherwise prefer the highest difficulty (Expert).
  if (diffs.some((d) => d.id === previous)) els.difficulty.value = previous;
  else if (diffs.length) els.difficulty.value = diffs[diffs.length - 1].id;
}

function currentInstrument() {
  return current?.options.find((i) => i.id === els.instrument.value) || null;
}

function updateChart() {
  if (!current) return;
  const ins = currentInstrument();
  const diff = DIFFICULTIES.find((d) => d.id === els.difficulty.value);
  chart = ins && diff ? buildChart(current.midi, ins, diff) : null;
  highway.setChart(chart);
  fillSectionOptions();
  els.fretBtn.hidden = !chart || chart.mode === 'vocals'; // vocals have no highway to turn 3D or note heads to reshape
  if (els.fretBtn.hidden) els.fretPop.hidden = true;
  renderPickers();
  renderLoadState();
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
  player.seek(Math.max(0, section.time + settings.chartDelay));
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
function groupBlock(g) {
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
  expand.addEventListener('click', () => { g.expanded = !g.expanded; renderGroup(g); });
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
    v.kids.hidden = !g.expanded;
    v.expand.setAttribute('aria-expanded', String(g.expanded));
    v.expand.title = g.expanded ? 'Collapse tracks' : 'Show each track';
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
  if (name === 'chartDelay') paintSectionTicks();
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

const popovers = [[els.infoBtn, els.infoPop], [els.partBtn, els.partPop], [els.sectionBtn, els.sectionPop], [els.mixerBtn, els.mixerPop], [els.settingsBtn, els.settingsPop], [els.fretBtn, els.fretPop]];
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
function paintSeek() {
  const max = Number(els.seek.max) || 1;
  els.seek.style.setProperty('--pct', `${Math.min(100, (Number(els.seek.value) / max) * 100)}%`);
}
els.seek.addEventListener('input', () => {
  paintSeek();
  seeking = true;
  els.timeNow.textContent = fmt(Number(els.seek.value));
});
els.seek.addEventListener('change', () => { player.seek(Number(els.seek.value)); seeking = false; });

async function togglePlay() {
  if (!ready || !chart) return; // playback waits for the audio to finish loading
  if (player.playing) player.pause();
  else {
    if (infoOpen) setInfoOpen(false); // starting from the details goes to the chart
    await player.play();
  }
  syncPlayButton();
}

function syncPlayButton() {
  const playing = player.playing;
  els.play.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  els.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  setImmersive();
}

// ---------- 2D / 3D view ----------
function setView(view) {
  highway.setView(view);
  for (const b of els.viewChoice.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  store.set('view', view);
}
setView(store.get('view') === '3d' ? '3d' : '2d');
els.viewChoice.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });

// ---------- Note style: circles or rounded rectangles ----------
function setNoteStyle(style) {
  highway.setNoteStyle(style);
  for (const b of els.noteChoice.querySelectorAll('[data-note]')) b.setAttribute('aria-pressed', String(b.dataset.note === style));
  store.set('noteStyle', style);
}
setNoteStyle(store.get('noteStyle') === 'rect' ? 'rect' : 'round');
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
function setBarHidden(hidden) {
  els.app.classList.toggle('bar-hidden', hidden);
  els.barShow.hidden = !hidden;
  store.set('barHidden', hidden ? '1' : '0');
  closePopovers();
  alignStageButtons();
}
setBarHidden(store.get('barHidden') === '1');
els.barHide.addEventListener('click', () => setBarHidden(true));
els.barShow.addEventListener('click', () => setBarHidden(false));

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
  if (e.code === 'Space' && ready) { e.preventDefault(); togglePlay(); }
  else if (e.code === 'KeyI' && (current || loadInfo.state !== 'idle')) setInfoOpen(!infoOpen);
  else if (e.code === 'KeyL') setLibraryOpen(!libraryOpen());
  else if (e.code === 'KeyB') setBarHidden(!els.app.classList.contains('bar-hidden'));
  else if (e.code === 'KeyF') toggleFullscreen();
  else if (e.code === 'KeyV') setView(highway.view === '3d' ? '2d' : '3d');
  else if (e.code === 'KeyN') setNoteStyle(highway.noteStyle === 'rect' ? 'round' : 'rect');
  else if (e.code === 'BracketLeft') stepSection(-1);
  else if (e.code === 'BracketRight') stepSection(1);
  else if (e.code === 'ArrowLeft' && ready) player.seek(Math.max(0, player.currentTime() - 5));
  else if (e.code === 'ArrowRight' && ready) player.seek(Math.min(player.duration, player.currentTime() + 5));
});

// ---------- Frame loop (started once) ----------
function frame() {
  if (current && chart) {
    const t = player.currentTime();
    if (player.playing && t >= player.duration) {
      player.pause();
      syncPlayButton();
    }
    const chartTime = t - settings.chartDelay;
    highway.render(chartTime);
    const index = chart.sections.length ? sectionIndexAt(chart.sections, chartTime) : -1;
    if (index >= 0) setActiveSection(index);
    if (!seeking) {
      els.seek.value = t;
      paintSeek();
      els.timeNow.textContent = fmt(t);
    }
  } else {
    highway.render(0);
  }
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
const EFFECTS = {
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
function syncUrl() {
  if (!current) return;
  store.set('lastSong', current.song.id); // for "Reopen the last song"
  const hash = formatRoute({ view: infoOpen ? 'song' : 'play', id: current.song.id });
  if (location.hash !== hash) history.replaceState(null, '', hash);
  document.title = `${plainText(current.song.title)} - ${plainText(current.song.artist)} · YARG Remote`;
}
function openFromHash() {
  const route = parseRoute(location.hash);
  if (route.view === 'library' || current?.song.id === route.id) return;
  const song = songs.find((s) => s.id === route.id);
  if (!song) return;
  selectSong(song);
  if (route.view === 'play') setInfoOpen(false);
}
window.addEventListener('hashchange', openFromHash);
