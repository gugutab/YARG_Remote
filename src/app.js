import { parseMidi } from './midi.js';
import { parseChart } from './chartfile.js';
import { DIFFICULTIES, EXTENDED_DRUM_LANES, instrumentOptions, availableDifficulties, buildChart, sectionIndexAt } from './chart.js';
import { MultiTrackPlayer } from './player.js';
import { Metronome } from './metronome.js';
import { Highway } from './highway.js';
import { rebuildYNote, noteCutFraction } from './gfx.js';
import { countdownColors, vocalColors } from './uicolors.js';
import { createErrorGate } from './errorgate.js';
import { PerfMeter } from './perf.js';
import { createPerfOverlay, PERF_MODES } from './perf-overlay.js';
import { walkHandle, entriesFromFileList, scanSongs, audioStemsOf, findCover, readBytes, serializeSongs, restoreSongs, restoreRemoteSongs } from './library.js';
import { songDelaySeconds, plainText, packOf } from './ini.js';
import { actionFor, comboOf } from './shortcuts.js';
import { dropStems, stemPriority } from './stempriority.js';
import { rememberPick, serializePick, parsePick } from './lastpick.js';
import { parseVolumes, serializeVolumes, remember as rememberLevel, recall as recallLevel } from './volmemory.js';
import { attachScrollThumb } from './scrollthumb.js';
import { previewWindow } from './preview.js';
import { setLoopPoint, restartNote, pausePanelWanted } from './practice.js';
import { isFreshStart, overlayLines, startPlan, INFO_FIRST_PLAY_MS } from './startinfo.js';
import { metaRows, extraRows, bpmLabel, bpmRange, instrumentLevel, stemKind, stemBadge, stemGroup, stemGroupLabel, relabelStems } from './songinfo.js';
import { parseRoute, formatRoute } from './route.js';
import { createSettings } from './settings.js';
import { SECTIONS, buildDefaults, buildValidator, FONT_OPTIONS, RENAMES, SETTINGS_VERSION, itemById } from './settings-schema.js';
import { resolveTheme, applyTheme } from './themes.js';
import { mountSettings } from './settings-ui.js';
import { renderThemeStudio, renderDataTools, renderShortcuts } from './settings-custom.js';
import { WIN_MARGIN, WIN_BORDER, SETTINGS_MIN_W, contentMaxFor } from './windowframe.js';
import { isPhone, createWidthPref, createWindowFrame } from './windowframe-dom.js';
import { saveLibrary, loadLibrary, loadThumb, saveThumb, clearThumbs } from './store.js';
import { filterSongs, parseQuery, rankByRelevance, sortSongs, genresOf, decadesOf, packsOf, evenPerRow, songSummary, buildItems, anchorLabel, INSTRUMENTS, hasInstrument } from './songlist.js';
import { createVirtualList, DEFAULT_CARDS } from './virtuallist.js';
import { createThumbs, renderCoverThumb } from './thumbs.js';
import { chartFacts, factRows } from './songstats.js';
import { recommend } from './recommend.js';
import { snapPoints, snapTime, clampLoop, currentSectionRange, sectionRange, loopForSection, shouldWrap, MIN_LOOP } from './looprange.js';
import { trainerConfig, startTrainer, nextTrainerState, trainerStatus, stepNote } from './trainer.js';
import { VISUALIZERS, createDriver as createVisualizerDriver } from './visualizers.js';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'app', 'library', 'closeLibrary', 'splitter', 'libTab', 'settingsTab', 'edgeDock', 'dockHandle', 'edgeL', 'edgeR', 'npPlay', 'npPreview', 'npPreviewBox', 'npSeek', 'npBand', 'npTime', 'loadScreen', 'lsTitle', 'lsBar', 'lsText', 'lsCover', 'groupLabel', 'rail', 'scrim', 'pick', 'resume', 'rescan', 'folderInput', 'status',
  'search', 'sortBy', 'sortDir', 'filterBtn', 'filterBadge', 'filterPanel', 'instChips', 'levelSeg', 'filterGenre', 'filterDecade', 'filterPack', 'filterClear', 'activeFilters', 'viewSeg', 'count', 'songs', 'empty',
  'now', 'brand', 'cover', 'title', 'artist', 'tertiary', 'chips', 'instrument', 'difficulty',
  'transport', 'play', 'back', 'forward', 'seekbox', 'seek', 'loopBtn', 'loopBand', 'loopStart', 'loopEnd', 'seekTip', 'timeNow', 'timeTotal',
  'tools', 'sectionSelect', 'mixerBtn', 'mixerPop', 'sectionBtn', 'sectionPop', 'sectionText', 'infoPop', 'infoPopCover', 'infoPopTitle', 'infoPopArtist', 'infoPopMeta', 'infoPopMore', 'mixer', 'settingsBtn', 'settingsPop',
  'barHide', 'metronomeBtn', 'mixerVal', 'speedVal', 'stagePlay', 'songInfo', 'siCover', 'siCredits', 'siInsts', 'siPicker', 'siPlay', 'siPlayText', 'pauseDim', 'pausePanel', 'ppSlower', 'ppFaster', 'ppSpeed', 'ppMetronome', 'ppVolume', 'ppVolVal', 'ppResume', 'siTitle', 'siArtist', 'siDetails', 'paneTags', 'paneMenu', 'paneMenuDyn', 'paneMenuActions', 'viewChoice', 'noteChoice', 'vocalChoice', 'infoBtn', 'libList', 'info', 'infoWindow', 'infoClose', 'infoWinTitle', 'infoWinArtist', 'infoCover', 'infoTitle', 'infoArtist', 'infoQuote', 'infoMeta', 'instrumentCards',
  'mixerInfo', 'infoExtra', 'infoProgress', 'infoBar', 'infoState', 'infoPlay',
  'stage', 'highway', 'loading', 'welcome', 'welcomeOpen',
  'endScreen', 'endCover', 'endTitle', 'endArtist', 'endAgain', 'endSearch', 'endCards', 'endNextBox', 'endNext',
].map((id) => [id, $(id)]));

for (const img of [els.cover, els.infoCover, els.infoPopCover, els.endCover]) img.addEventListener('error', () => { img.hidden = true; });
const player = new MultiTrackPlayer();
const highway = new Highway(els.highway);
let frameSleep = 0; // the timer while the frame loop ticks slowly (paused and idle, see `idleDeep`); 0 while it runs on requestAnimationFrame
{ const invalidate = highway.invalidate; highway.invalidate = function () { invalidate.call(this); wakeLoop(); }; } // (any change to the picture wakes a sleeping loop)
highway.setBackgroundCanvas(document.getElementById('bgCanvas'));
const perf = new PerfMeter();
let perfMode = 'off'; // the perf.overlay setting, kept here so the frame loop does not read the prefs every frame
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
let audioSong = null; // the song whose audio is in the player (it can differ from `current`: another song's details may be open while it plays)
const backgroundAudio = () => !!audioSong && audioSong !== current?.song; // the loaded audio is of a song other than the selected one
// While the details of ANOTHER song are browsed, the song that is on the stage keeps it: its fretboards, its bar and its sound go on (liveStage:
// the song and chart the frame loop needs). The selected song (`current`, `chart`) only feeds the details until it is played (Play or Listen):
// takeStage() then puts it on the stage the old way (the stage holds its last picture while the new audio loads).
let liveStage = null; // { song, chart, coverUrl }
function setLiveStage(v) {
  liveStage = v;
  els.app.classList.toggle('live-stage', !!v); // (the stage's own controls that need its chart are switched off meanwhile)
  return v;
}
const stageIsLive = () => !!(current && chart && ready && audioSong === current.song && stageEverLive && !holdStage);
async function toggleBackground() { // the bar's play/pause while the stage belongs to another song than the details
  if (player.playing) player.pause(); else await player.play();
  syncPlayButton();
}
// The bar's texts, cover, sections, seek and time for `current`; the details of a song never write them while the stage is live.
function bindStageText(song) {
  showPlayInfo(true);
  els.title.textContent = plainText(song.title);
  requestAnimationFrame(fitTitleWidth);
  els.artist.textContent = plainText(song.artist);
  els.tertiary.textContent = [packOf(song), plainText(song.ini?.charter || '')].filter(Boolean).join(' - '); // pack - charter, shown in the wide open bar
  els.cover.hidden = true;
}
function resetStageBar() {
  els.sectionSelect.replaceChildren(new Option('No sections', ''));
  els.sectionSelect.disabled = true;
  els.sectionBtn.disabled = true;
  els.sectionPop.replaceChildren();
  els.sectionText.textContent = 'No sections';
  activeSection = -2;
  els.seek.value = 0; // the bar shows nothing of the previous song until the audio of this one loads
  els.seek.max = 0;
  els.seekbox.querySelectorAll('.tick').forEach((t) => t.remove());
  paintSeek(0);
  els.timeNow.textContent = els.timeTotal.textContent = fmt(0);
}
// The selected song takes the stage from the live one (Play or Listen on it): the stage freezes on its last picture under the bar's ghost, the bar and
// the fretboards of the new song are prepared behind it and come in when its audio has loaded (the usual way).
function takeStage() {
  if (!liveStage || !current) return;
  const old = liveStage;
  setLiveStage(null);
  holdStageNow();
  setLoop(null); // a loop belongs to one song, and so do the options of each window
  highway.paneOpts = {};
  bindStageText(current.song);
  resetStageBar();
  if (current.coverUrl) { els.cover.src = current.coverUrl; els.cover.hidden = false; }
  if (old.coverUrl?.startsWith('blob:')) URL.revokeObjectURL(old.coverUrl);
  buildMixer(current.stems); // (both mixers: the levels were kept in the memory of volumes)
  updateChart(); // its fretboards (not drawn while the stage is held)
}

let infoOpen = false;
let loadInfo = { state: 'idle', text: '', fraction: 0 };
const PREF_DEFAULTS = buildDefaults();
const settings = { speed: 1, neck: PREF_DEFAULTS['highway.neck'], chartDelay: 0 }; // (neck: the user's starting value is applied by the highway.neck EFFECT)
let remote = false; // library comes from server.mjs (/api/library); no folder permission needed
let detached = false; // list restored from storage without file access (browsers without showDirectoryPicker)
let pendingSongId = null; // song clicked while detached; opened once the folder is picked again

// ---------- Settings and theme (applied first, so the first frame already has the right colours) ----------
const prefs = createSettings({ defaults: PREF_DEFAULTS, validate: buildValidator(SECTIONS), renames: RENAMES, version: SETTINGS_VERSION, storage: (() => { try { return localStorage; } catch { return null; } })() });
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
// Reduced motion: the setting ui.reduceMotion (auto = the OS preference, on, off) turns the three motion settings off while it
// applies; otherwise each switch decides on its own.
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let osReduceMotion = reduceQuery.matches; // cached: reading .matches every frame makes Chrome skip the 'change' event
const MOTION_IDS = ['ui.animations', 'highway.seekAnimation', 'highway.motionBlur'];
const motionReduced = () => { const m = prefs.get('ui.reduceMotion'); return m === 'on' || (m === 'auto' && osReduceMotion); };
function motionPref(id) {
  return prefs.get(id) && !motionReduced();
}
// Migration of the old hidden key (before ui.reduceMotion): it listed the motion switches the user had set by hand, which the OS
// preference then no longer overrode. Those values now rule (Reduce motion: Off), and the switches the OS was turning off stay off.
try {
  const OLD_MOTION_KEY = 'yargremote.motionTouched';
  const raw = localStorage.getItem(OLD_MOTION_KEY);
  if (raw !== null) {
    const touched = new Set([(() => { try { return JSON.parse(raw); } catch { return []; } })()].flat().filter((x) => typeof x === 'string'));
    if (touched.size && prefs.isDefault('ui.reduceMotion')) {
      if (osReduceMotion) for (const id of MOTION_IDS) if (!touched.has(id) && prefs.isDefault(id)) prefs.set(id, false);
      prefs.set('ui.reduceMotion', 'off');
    }
    localStorage.removeItem(OLD_MOTION_KEY);
  }
} catch { /* no storage: nothing to migrate */ }
let themeStage = '#0d1117';
let themeUi = { accent: '#2f80ed', text: '#e6edf3', muted: '#8b949e', panel: '#161b22' }; // the active theme's colours the vocal view and the countdowns derive from
// The colours of the wait countdowns and the vocal view: the theme's (default), the classic fixed ones, or from a colour the user picked.
function applyUiColors() {
  highway.setUiColors(
    countdownColors(prefs.get('highway.countdownColors'), prefs.get('highway.countdownColor'), themeUi),
    vocalColors(prefs.get('highway.vocalColors'), prefs.get('highway.vocalColor'), themeUi),
  );
}
// The stage colour: the theme's, or the one picked in the visualizer menu / settings.
function applyStage() {
  highway.setBackground(prefs.get('highway.stageColorOn') ? prefs.get('highway.stageColor') : themeStage);
}
function applyThemeSetting() {
  const theme = resolveTheme({ preset: prefs.get('theme.preset'), overrides: prefs.get('theme.overrides'), saved: prefs.get('theme.saved') }, darkQuery.matches);
  applyTheme(theme);
  themeStage = theme.vars.stage;
  themeUi = { accent: theme.vars.accent, text: theme.vars.text, muted: theme.vars.muted, panel: theme.vars.panel };
  applyStage();
  applyUiColors();
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

// ---------- Library window ----------
// The library is a glass window floating over the stage (left). It never takes room from the chart: the stage always spans the whole
// screen, so opening and closing it resizes nothing. `persist` is false for the automatic closes (a phone, "hide when I pick a song"),
// so they do not become the saved preference. On a phone it is a full-height drawer with a scrim.
const narrow = isPhone;
const libraryOpen = () => !els.app.classList.contains('lib-closed');
function savePanelState() {
  if (narrow()) return;
  try { localStorage.setItem('yargremote.panelState', JSON.stringify({ library: libraryOpen() })); } catch { /* optional */ }
}
function setLibraryOpen(open, persist = true) {
  if (open && typeof settingsPage !== 'undefined' && settingsPage.isOpen()) settingsPage.close(); // one window at a time: the library and the settings never share the screen
  els.app.classList.toggle('lib-closed', !open);
  syncWindow();
  layoutWindow();
  syncPanelUi();
  if (persist) savePanelState();
}
// The library window's frame (declared early: the startup code below already opens and closes the window). The settings window gets its own
const winPrefs = createWidthPref(store); // (the width the user chose for the windows, shared with the settings window: store key 'winWidth')
// The shared window frame of the library: the same controller drives the settings window (src/windowframe-dom.js). `--win-w` goes on .app
// because --lib-inset (also on .app) reads it; the library keeps its own #edgeL / #edgeR handles.
const libFrame = createWindowFrame({
  el: els.library, prefs: winPrefs, container: () => stageEl.clientWidth || window.innerWidth, contentMax: () => contentMax(), minWidth: () => minWinWidth(),
  relayout: () => layoutWindow(), widthVars: els.app, edges: [els.edgeL, els.edgeR],
});
// The library window holds two panes: the list (open unless `lib-closed`) and the song details (`infoOpen`). With the list closed and the
// details open only the details pane shows (`details-only`: the window stays up); with neither the window is out of the way. Whatever is not
// shown is `inert` (it is only moved and faded out, not removed), so nothing in it takes focus or clicks.
function syncWindow() {
  const list = libraryOpen();
  els.app.classList.toggle('details-only', infoOpen && !list);
  libFrame.setClosed(!list && !infoOpen); // (the shared window frame: slides out and fades, inert)
  els.libList.inert = !list;
}
// The edge tabs bring a closed library back (the settings tab keeps Settings one click away while the library header, which holds the gear, is hidden).
let dockTimer = 0; // (the dock's close timer; declared before syncPanelUi first runs)
// The dock on the left edge is always there (on a phone it gives way while a window is open: the drawer and the settings fill the screen).
// It shows which windows are open: the Library button (the list and/or the song details) and the Settings button light up, and the handle
// takes the accent colour; pressing the button of an open window closes it.
// The windows (the shared frame: library and settings) are fixed over the whole page; they leave the player bar visible: the room the bar takes at
// the top or the bottom of the page is published as --win-top / --win-bottom (the bar is not there before a song has played, or when it floats over the stage).
function syncWindowInsets() {
  const bar = document.getElementById('topbar');
  const r = bar.getBoundingClientRect();
  const shown = r.height > 0 && getComputedStyle(bar).display !== 'none' && !els.app.classList.contains('stage-unborn') && !els.app.classList.contains('immersive');
  const bottom = shown && els.app.classList.contains('bar-bottom') ? Math.max(0, Math.round(innerHeight - r.top)) : 0;
  const top = shown && !els.app.classList.contains('bar-bottom') ? Math.max(0, Math.round(r.bottom)) : 0;
  const root = document.documentElement.style;
  if (root.getPropertyValue('--win-bottom') !== `${bottom}px`) root.setProperty('--win-bottom', `${bottom}px`);
  if (root.getPropertyValue('--win-top') !== `${top}px`) root.setProperty('--win-top', `${top}px`);
}
window.addEventListener('resize', syncWindowInsets);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncWindowInsets).observe(document.getElementById('topbar'));
new MutationObserver(syncWindowInsets).observe(els.app, { attributes: true, attributeFilter: ['class'] }); // (bar position, hidden bar, first play)
let settingsFlag = false; // the settings window is open (set by its onOpen / onClose: the page object itself is created further down)
const settingsIsOpen = () => settingsFlag;
function syncPanelUi() {
  const lib = libraryOpen() || infoOpen;
  const settingsOn = settingsIsOpen();
  els.edgeDock.hidden = narrow() && (lib || settingsOn);
  els.libTab.classList.toggle('on', lib);
  els.libTab.setAttribute('aria-pressed', String(lib));
  els.settingsTab.classList.toggle('on', settingsOn);
  els.settingsTab.setAttribute('aria-pressed', String(settingsOn));
  els.edgeDock.classList.toggle('has-open', lib || settingsOn);
  document.body.classList.toggle('settings-open', settingsOn); // (the dock rises above the settings window)
}
(() => { // the library at startup: open, closed, or as it was last time (the "Panels" settings). A phone starts with the drawer closed, unless no song is being opened.
  let last = {};
  try { last = JSON.parse(localStorage.getItem('yargremote.panelState')) || {}; } catch { /* none */ }
  const start = prefs.get('panels.libraryStart');
  const opening = parseRoute(location.hash).view !== 'library'; // a deep link names a song: the drawer would only be in the way
  const playLink = parseRoute(location.hash).view === 'play'; // a link that goes straight to the player: no library window
  const open = playLink ? false : narrow() ? !opening : (start === 'last' ? last.library !== false : start !== 'closed');
  els.app.classList.toggle('lib-closed', !open);
  syncWindow();
  syncPanelUi();
})();
// Entering or leaving the phone layout keeps the library as it is (open stays open: it becomes the side drawer, and a drawer left open stays open on the way back).
window.matchMedia('(max-width: 700px)').addEventListener('change', () => {
  syncWindow();
  layoutWindow();
  syncPanelUi();
});
// Minimizing the library (its back arrow, or L while the list is open) closes the details with it: the window goes away as a whole.
// (Other things that close the list on their own, like picking a song with auto-hide, leave the details up.)
function minimizeLibrary() {
  setLibraryOpen(false, false);
  if (infoOpen) setInfoOpen(false);
}
els.closeLibrary.addEventListener('click', minimizeLibrary);
els.scrim.addEventListener('click', () => { if (infoOpen) setInfoOpen(false); setLibraryOpen(false, false); }); // (phone) everything out of the way
els.welcomeOpen.addEventListener('click', () => setLibraryOpen(true));
// The dock: a handle on the left edge; hovering it (mouse) or clicking/tapping it opens the Library and Settings buttons, which fold back
// when the pointer leaves, on Esc or on a tap elsewhere.
function setDockOpen(open) {
  clearTimeout(dockTimer);
  els.edgeDock.classList.toggle('open', open);
  els.dockHandle.setAttribute('aria-expanded', String(open));
}
let dockWasOpen = false; // the state when the pointer went down (focusing the button opens the dock before the click arrives)
els.dockHandle.addEventListener('pointerdown', () => { dockWasOpen = els.edgeDock.classList.contains('open'); });
els.dockHandle.addEventListener('click', (e) => setDockOpen(e.pointerType === 'mouse' ? true : !dockWasOpen)); // (a mouse already opened it by hovering: a click keeps it open; a touch toggles)
els.edgeDock.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setDockOpen(true); });
els.edgeDock.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { clearTimeout(dockTimer); dockTimer = setTimeout(() => setDockOpen(false), 350); } });
els.edgeDock.addEventListener('focusin', () => setDockOpen(true));
els.edgeDock.addEventListener('focusout', (e) => { if (e.relatedTarget && !els.edgeDock.contains(e.relatedTarget)) setDockOpen(false); }); // (a blur with no target is the app dropping the focus of a clicked button: not a reason to fold)
document.addEventListener('pointerdown', (e) => { if (!els.edgeDock.contains(e.target)) setDockOpen(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDockOpen(false); }, true);
els.libTab.addEventListener('click', () => {
  if (libraryOpen() || infoOpen) { setLibraryOpen(false, false); if (infoOpen) setInfoOpen(false); } else setLibraryOpen(true); // an open window is closed by its button
});
els.settingsTab.addEventListener('click', () => (settingsIsOpen() ? settingsPage.close() : settingsPage.open()));

let listenQueued = false; // a press while the audio is still loading: it plays when ready (more presses meanwhile do nothing)
els.npPlay.addEventListener('click', async () => { // the Listen card: play here, without leaving the details
  clearPreview();
  if (listenQueued) return;
  if (!ready) { // loads the audio the first time (only the audio: the stage is left alone); a hover may have started it already
    listenQueued = true;
    const ok = await ensureAudio({ listen: true, at: Number(els.npSeek.value) || 0 });
    listenQueued = false;
    if (!ok) return;
    setEnded(false);
    await player.play();
    syncPlayButton();
    return;
  }
  setEnded(false); // (play() starts over from the end by itself)
  if (player.playing) player.pause(); else await player.play();
  syncPlayButton();
});
els.npSeek.addEventListener('input', () => {
  const to = Number(els.npSeek.value);
  if (previewStop != null && (to < previewStart || to > previewStop)) clearPreview(); // a seek outside the preview section turns the preview off
  player.seek(to);
});

// Preview button of the Listen card: plays the window song.ini defines (preview_start_time .. preview_end_time).
// The times are positions in the audio file; the chart clock is the file position minus the audio delay.
let previewStop = null; // chart-clock second where the preview ends, or null when none is running
let previewStart = 0; // ... and where it starts (the band on the Listen slider shows [previewStart, previewStop])
function paintPreviewBand() {
  const on = previewStop != null && player.duration > 0;
  els.npBand.hidden = !on;
  if (!on) return;
  const k = (s) => Math.max(0, Math.min(1, s / player.duration));
  els.npBand.style.left = `calc(8px + ${k(previewStart).toFixed(5)} * (100% - 16px))`;
  els.npBand.style.width = `calc(${(k(previewStop) - k(previewStart)).toFixed(5)} * (100% - 16px))`;
}
function clearPreview() { previewStop = null; if (els.npBand) els.npBand.hidden = true; if (els.npPreview) els.npPreview.checked = false; }
// The Preview checkbox: on = play only the song.ini preview section (starts there, stops at its end); a seek outside it, or unchecking, turns it off.
els.npPreview.addEventListener('change', async () => {
  if (!els.npPreview.checked) { previewStop = null; els.npBand.hidden = true; return; }
  const win = current && previewWindow(current.song.ini);
  if (!win) { els.npPreview.checked = false; return; }
  const delay = songDelaySeconds(current.song.ini);
  if (!(await ensureAudio({ listen: true, at: Math.max(0, win.start - delay) }))) { els.npPreview.checked = false; return; }
  previewStart = Math.max(0, win.start - delay);
  player.seek(previewStart);
  previewStop = Math.min(win.end - delay, player.duration);
  paintPreviewBand();
  if (!player.playing) await player.play();
  syncPlayButton();
});

// The handle on the list pane's right edge (the window's right edge, or the divider while the details are open): drag to resize the LIST pane
// (remembered; the window grows with it while the details are open); double-click restores the default width. The stage keeps its size either way. The window leaves the same margin on the right as on the left.
const MIN_LIB_W = 300; // the list pane's minimum
const INFO_MIN_W = 380; // the details pane never gets narrower than one column of cards; same as the .info width fallback in styles.css (test/css-js-constants.test.js)
const stageEl = document.getElementById('stage');
// the room the panes may take: the content area (--content-max, centred) between its two margins (the window starts at --lib-left), minus the border
// The content area is 1400 px, and grows (up to 4K, 3840 px) when the "Maximum width" of the details asks for more than the list and the details fit in 1400.
const contentMax = () => contentMaxFor(Math.round(libPref()) + prefs.get('details.maxWidth') + 2 * WIN_MARGIN + WIN_BORDER);
const contentWidth = () => libFrame.room();
// the list pane's widest width: all the room, or all but one column for the details while they are open
const minWinWidth = () => (infoOpen && libraryOpen() ? MIN_LIB_W + INFO_MIN_W : infoOpen ? INFO_MIN_W : MIN_LIB_W); // (the narrowest the window may be made: both panes at their minimum, or the one that is open)
const maxLibWidth = () => Math.max(MIN_LIB_W, contentWidth() - (infoOpen ? INFO_MIN_W : 0));
const libPref = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lib-w')) || MIN_LIB_W; // the list width the user chose (or the default)
let winTotal = 0; // the panes' total width as last laid out (the window is WIN_BORDER wider)
// Sizes the two panes (--list-w, --info-w) and the window (--win-w = list + details). The details get the room the list leaves, between one
// column and the "Max width" setting; if both do not fit the list shrinks (down to MIN_LIB_W) and then the details, never overlapping. With
// the list closed the window is the details pane alone. Phone: the drawer's own CSS sizes everything.
// Wide mode only: the user's window width (null = the full content width, the window stays centred) and the list's share of the window
// while the details are open (null = the default split); both are remembered.
let splitFrac = Number(store.get('splitFrac')) > 0 && Number(store.get('splitFrac')) < 1 ? Number(store.get('splitFrac')) : null;
// The library window is centred and takes the whole content width at every width above the phone drawer (it used to switch to a narrow sidebar below a 1100 px stage,
// measured on the stage itself, which a sidebar shrinks: so a window made smaller dropped to a partial width and could not come back).
const wideWindow = () => !narrow();
function layoutWindow() {
  const style = els.app.style;
  const wide = wideWindow();
  els.app.classList.toggle('lib-wide', wide);
  document.documentElement.style.setProperty('--content-max', `${contentMax()}px`); // (the CSS side of the content area: where the window starts, how wide the settings may be)
  if (narrow()) { for (const v of ['--list-w', '--info-w']) style.removeProperty(v); libFrame.clearWidth(); return; }
  const listOn = libraryOpen();
  if (!listOn && !infoOpen) return; // closed: keep the size it slides out with
  const room = wide ? libFrame.fit() : contentWidth(); // (wide: the window is as wide as the user made it, up to the content width; libFrame.fit)
  let list = 0;
  let info = 0;
  if (infoOpen) {
    const infoMax = prefs.get('details.maxWidth');
    if (listOn) {
      if (wide && splitFrac) { // the user moved the divider: that proportion rules
        list = Math.min(Math.max(room * splitFrac, MIN_LIB_W), Math.max(MIN_LIB_W, room - INFO_MIN_W));
        info = room - list;
      } else {
        list = Math.min(Math.max(libPref(), MIN_LIB_W), Math.max(MIN_LIB_W, room - INFO_MIN_W));
        info = Math.max(0, Math.min(infoMax, room - list));
        if (wide) list = Math.max(MIN_LIB_W, room - info); // the window takes the whole width: the list gets what the details leave
      }
    } else info = wide ? room : Math.min(infoMax, room);
  } else list = wide ? room : Math.min(Math.max(libPref(), MIN_LIB_W), room);
  winTotal = Math.round(list) + Math.round(info);
  if (listOn) style.setProperty('--list-w', `${Math.round(list)}px`);
  if (infoOpen) style.setProperty('--info-w', `${Math.round(info)}px`);
  libFrame.setWidth(winTotal);
}
function setLibWidth(px) {
  if (px == null) document.documentElement.style.removeProperty('--lib-w');
  else document.documentElement.style.setProperty('--lib-w', `${Math.round(px)}px`);
  layoutWindow();
}
const savedLibW = Number(store.get('libWidth'));
if (savedLibW >= MIN_LIB_W && !narrow()) setLibWidth(Math.min(savedLibW, maxLibWidth()));
layoutWindow();
els.splitter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  els.splitter.setPointerCapture(e.pointerId);
  els.splitter.classList.add('dragging');
  document.body.classList.add('resizing');
});
els.splitter.addEventListener('pointermove', (e) => {
  if (!els.splitter.classList.contains('dragging')) return;
  if (wideWindow() && infoOpen) { // the divider between the list and the details: it moves the proportion, the window keeps its width
    const r = els.library.getBoundingClientRect();
    splitFrac = Math.min(0.9, Math.max(0.05, (e.clientX - r.left - 1) / Math.max(1, r.width - WIN_BORDER)));
    layoutWindow();
    return;
  }
  setLibWidth(Math.min(Math.max(e.clientX - els.library.getBoundingClientRect().left, MIN_LIB_W), maxLibWidth()));
});
const endDrag = () => {
  if (!els.splitter.classList.contains('dragging')) return;
  els.splitter.classList.remove('dragging');
  document.body.classList.remove('resizing');
  if (wideWindow() && infoOpen) store.set('splitFrac', String(+splitFrac.toFixed(4)));
  else store.set('libWidth', String(Math.round(libPref())));
};
els.splitter.addEventListener('pointerup', endDrag);
els.splitter.addEventListener('pointercancel', endDrag);
els.splitter.addEventListener('dblclick', () => {
  if (wideWindow() && infoOpen) { splitFrac = null; store.set('splitFrac', ''); layoutWindow(); return; }
  setLibWidth(null);
  store.set('libWidth', '');
});
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
// Typing waits a moment (120 ms) so a fast typist filters once, not at every key.
let searchTimer = 0;
els.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderList, 120); });
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { // the first result opens
    clearTimeout(searchTimer);
    renderList();
    if (shownSongs[0]) { e.preventDefault(); selectSong(shownSongs[0]); }
  } else if (e.key === 'Escape' && els.search.value) { // Esc clears the text first; a second Esc leaves the field
    e.preventDefault();
    e.stopPropagation();
    els.search.value = '';
    clearTimeout(searchTimer);
    renderList();
  }
});
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

let shownSongs = []; // the list as it is on screen (Enter in the search opens the first one)
function renderList({ keepScroll = false } = {}) {
  const query = els.search.value;
  const terms = parseQuery(query).terms;
  const ranked = terms.length > 0 && prefs.get('library.searchRelevance'); // free text in the search: best match first
  let shown = sortSongs(filterSongs(songs, {
    query, instruments: [...filters.instruments], minLevel: filters.minLevel, genre: picked(els.filterGenre), decade: picked(els.filterDecade), pack: picked(els.filterPack),
  }), els.sortBy.value, sortDesc);
  if (ranked) shown = rankByRelevance(shown, query);
  shownSongs = shown;
  list.setHighlight(terms);
  els.sortDir.classList.toggle('desc', sortDesc); // the arrow points up when descending
  els.sortDir.title = sortDesc ? 'Descending (click to reverse)' : 'Ascending (click to reverse)';
  list.setActive(infoOpen ? current?.song ?? null : null); // marked while its details are open
  const heads = prefs.get('library.dividers') && !ranked; // (a relevance order has no letter groups)
  list.setItems(heads ? buildItems(shown, els.sortBy.value) : shown.map((song) => ({ type: 'song', song })), { keepScroll, evenGroups: heads && els.sortBy.value === 'pack' }); // pack sort: every pack gets a label on the rail
  els.count.textContent = songs.length ? `${shown.length} of ${songs.length} songs${ranked ? ' · best match first' : ''}` : '';
  els.empty.hidden = songs.length > 0;
}

function setStatus(text) {
  els.status.textContent = text;
}

// A title that takes two lines (extended bar in a wide area) is shrink-wrapped to its longest line, so the info icon sits right
// after the text instead of at the end of the box.
function fitTitleWidth() {
  const t = els.title;
  t.style.width = '';
  t.closest('.now')?.style.removeProperty('--info-offset');
  if (getComputedStyle(t).whiteSpace === 'nowrap') return; // single-line modes need nothing
  const range = document.createRange();
  range.selectNodeContents(t);
  const rects = [...range.getClientRects()];
  if (rects.length < 2) { t.parentElement?.closest('.now')?.style.removeProperty('--info-offset'); return; }
  const widest = rects.reduce((best, r) => (r.width > best.width ? r : best), rects[0]);
  t.style.width = `${Math.ceil(widest.width) + 2}px`;
  // the info icon goes beside the longest line of a two-line title
  t.closest('.now')?.style.setProperty('--info-offset', `${Math.round(widest.top + widest.height / 2 - t.getBoundingClientRect().top - 12)}px`); // (12 = half of the 24 px icon)
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => requestAnimationFrame(fitTitleWidth)).observe(document.querySelector('.main'));

// ---------- Song and chart selection ----------
let pendingInstruments = null; // the instruments of a link, applied once the chart is read
// The instruments and difficulties used last (src/lastpick.js): offered again on the next song unless a link or "play next" names them.
let lastPick = parsePick(store.get('lastPick'));
let openingSong = false; // while a song is being opened its first chart is not a choice of the user: it must not overwrite the memory
function saveLastPick() {
  if (openingSong || !current?.screen || !prefs.get('general.rememberInstruments')) return;
  const off = instrumentGroups().filter((g) => !isOn(g)).map((g) => g.key);
  lastPick = rememberPick(lastPick, current.screen, off);
  store.set('lastPick', serializePick(lastPick));
}
let loadAudioWithSong = false; // a #/song/<id>/play link: the audio loads with the song, like a Play press would
// Picking a song opens its details, and the player bar and the fretboards keep showing what they showed (a frozen picture of the last
// song) until the audio starts to load (or the details close): then the new song fades in. The chart itself loads in the background.
let holdStage = false;
let listenMode = false; // the audio was loaded by the Listen card and no real Play happened: the fretboards stay at the start (the sound does not drive the visualizer)
let ghostObserver = null;
let barGhost = null; // a still copy of the player bar, laid over the real one while the stage is held
let stageEverLive = false; // a song has been played (or opened with /play) since the page loaded: until then the player bar is not shown
function holdStageNow() {
  if (holdStage) return;
  if (!stageEverLive) { holdStage = true; els.app.classList.add('stage-held'); return; } // nothing was ever shown: hold with no picture to keep (the bar stays away)
  if (!current || !chart) return; // nothing on screen: nothing to keep
  holdStage = true;
  const bar = document.getElementById('topbar');
  const main = bar.parentElement;
  const ghost = bar.cloneNode(true);
  ghost.removeAttribute('id');
  for (const e of ghost.querySelectorAll('[id]')) e.removeAttribute('id');
  ghost.classList.add('bar-ghost');
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  const place = () => { // the ghost follows the real bar when the window or the panes resize
    const rb = bar.getBoundingClientRect();
    const mb = main.getBoundingClientRect();
    ghost.style.cssText = `left:${rb.left - mb.left}px;top:${rb.top - mb.top}px;width:${rb.width}px;height:${rb.height}px;`;
  };
  place();
  main.append(ghost);
  barGhost = ghost;
  if (typeof ResizeObserver !== 'undefined') {
    ghostObserver = new ResizeObserver(place);
    ghostObserver.observe(bar);
    ghostObserver.observe(main);
  }
  els.app.classList.add('stage-held');
}
// The audio of the held song starts loading: the loading screen gets the plain background (the old bar copy and the frozen fretboards go)
function dropGhost() {
  ghostObserver?.disconnect();
  ghostObserver = null;
  barGhost?.remove();
  barGhost = null;
}
let loadingBackdrop = 0; // while the held song's audio loads: when it started (the background visualizer keeps animating behind the loading screen)
function stageLoading() {
  if (!holdStage) return;
  loadingBackdrop = performance.now();
  els.app.classList.add('stage-loading');
  dropGhost();
}
// The audio of a song loaded (or failed): the bar belongs to the screen from now on, whether or not the stage was being held.
// A song that was picked but never played has no player bar yet: while its chart is on screen (details closed, nothing loading) a Play
// button on the stage is the way to start it (on a phone it was a dead end).
function syncStagePlay() {
  const show = !!(current && chart) && (holdStage || els.app.classList.contains('stage-unborn')) && !infoOpen && !audioLoad && !endShown; // (held: the details were closed without playing the song: the stage still shows what it showed before)
  els.stagePlay.hidden = !show;
}
els.stagePlay.addEventListener('click', () => togglePlay());
function markStageLive() {
  listenMode = false;
  stageEverLive = true;
  els.app.classList.remove('stage-unborn');
  syncStagePlay();
}
let revealTimer = 0;
let leavingGhost = null;
let ghostTimer = 0;
let infoSwapTimer = 0;
function releaseStage() {
  if (!holdStage) { syncStagePlay(); return; }
  holdStage = false;
  loadingBackdrop = 0;
  els.app.classList.remove('stage-held', 'stage-loading');
  if (stageEverLive) els.app.classList.remove('stage-unborn'); // (closing the details of a song that was never played shows its chart but still no bar)
  els.app.classList.add('stage-reveal');
  highway.invalidate();
  const g = barGhost;
  ghostObserver?.disconnect();
  ghostObserver = null;
  barGhost = null;
  if (g) {
    clearTimeout(ghostTimer);
    leavingGhost?.remove(); // (a ghost still fading from the release before is gone at once)
    leavingGhost = g;
    g.classList.add('leaving');
    ghostTimer = setTimeout(() => { g.remove(); if (leavingGhost === g) leavingGhost = null; }, 450);
  }
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => els.app.classList.remove('stage-reveal'), 500);
  syncStagePlay();
}

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
  // A live stage (a song playing or paused on it) is kept as it is while the details of this song are browsed; otherwise the stage holds its last
  // picture (and the bar) until the audio of the new song loads.
  const keep = liveStage || (stageIsLive() ? setLiveStage({ song: current.song, chart, coverUrl: current.coverUrl }) : null);
  if (!keep) holdStageNow();
  const token = ++loadToken;
  clearRewind();
  if (!keep) { cancelStartWait(); hideSongInfo(); }
  else if (startDone && keep.song !== song) cancelStartWait(); // a start delay waiting on the stage: browsing another song's details cancels it (the song stays paused at 0; a song already playing keeps playing)
  setEnded(false);
  // (the sound that is playing is left alone: browsing the details of another song does not stop it; the audio of the new song, when it
  // loads, replaces it, and the old decoded audio is freed then)
  syncPlayButton();
  ready = false;
  if (!keep) {
    setLoop(null); // a loop belongs to one song
    highway.paneOpts = {}; // so do the options of each window
  }
  audioLoad = null;
  current = null;
  chart = null;
  vizAll = null;
  if (!keep) highway.setCharts([]);
  renderList({ keepScroll: true });
  if (!narrow() && prefs.get('panels.libraryAutoHide')) setLibraryOpen(false, false); // the list gets out of the way (the details stay; a phone keeps the list behind them)

  els.welcome.hidden = true;
  if (!keep) bindStageText(song);
  els.infoCover.hidden = true;
  els.infoPopCover.hidden = true;
  els.instrument.replaceChildren();
  els.difficulty.replaceChildren();
  if (!keep) resetStageBar();
  els.instrumentCards.replaceChildren();
  els.mixerInfo.replaceChildren();
  if (!keep) els.mixer.replaceChildren();
  const swapping = infoOpen; // the details of another song were showing: the new ones slide in
  renderSongInfo(song);
  infoScroll.scrollTop = 0; // a new song starts at the top
  if (swapping) {
    els.info.classList.remove('info-swap');
    void els.info.offsetWidth; // restart the animation when songs are picked in a row
    els.info.classList.add('info-swap');
    clearTimeout(infoSwapTimer);
    infoSwapTimer = setTimeout(() => els.info.classList.remove('info-swap'), 450);
  }
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
  } catch (err) { console.debug(err); /* a missing cover must not block the song */ }
  if (token !== loadToken) {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    return;
  }
  if (!liveStage && els.cover.src.startsWith('blob:')) URL.revokeObjectURL(els.cover.src); // (a live stage still shows its own cover)
  for (const img of liveStage ? [els.infoCover, els.infoPopCover] : [els.cover, els.infoCover, els.infoPopCover]) {
    img.src = coverUrl || '';
    img.hidden = !coverUrl;
  }

  try {
    current = { song, midi, coverUrl, options: instrumentOptions(midi, song.ini), diffChoice: {}, pins: new Set(), choosers: [], chooserSeq: 0, hiddenActive: false, modeChoice: {} };
    syncPlayButton(); // (the Listen card's button now knows whose sound is playing)
    renderMeta(song, midi); // adds the BPM chip
    renderList({ keepScroll: true }); // highlight the loaded song
    syncUrl();
    const remember = prefs.get('general.rememberInstruments');
    if (remember) for (const o of current.options) if (o.base && lastPick.diffs[o.base]) current.diffChoice[o.id] = lastPick.diffs[o.base]; // each instrument opens at the difficulty it had last
    fillInstrumentOptions();
    openingSong = true;
    const openedPending = !!pendingInstruments;
    if (pendingInstruments) { applyInstruments(pendingInstruments); pendingInstruments = null; } // (a link or "play next" names them)
    else if (remember && lastPick.items.length) applyInstruments(lastPick.items); // otherwise the ones used last, where this song has them
    if (!openedPending) { // not named by a link: everything is on, except what the user switched off (remembered)
      const off = new Set(remember ? lastPick.off : []);
      const groups = instrumentGroups();
      for (const g of groups) if (!g.active && !current.pins.has(g.key) && !off.has(g.key)) current.pins.add(g.key);
      if (groups.length && groups.every((g) => off.has(g.key))) current.hiddenActive = true; // all off: the active one only keeps the clock
    }
    updateChart(); // the chart exists as soon as the MIDI is read; only playback waits for the audio
    openingSong = false;
    const stems = dropStems(relabelStems(audioStemsOf(song, { censor: prefs.get('audio.censor') }), (inst) => hasInstrument(song, inst))); // (the crowd is never loaded) // read per load: a change applies to the next song load
    els.npPreviewBox.hidden = !previewWindow(song.ini);
    clearPreview();
    buildMixer(stems);

    current.stems = stems;
    setLoadState('idle', 'The audio loads when you press Play.', 0); // nothing is decoded until then
  } catch (err) {
    console.error(err);
    if (token === loadToken) setLoadState('error', `Could not build the chart: ${err.message}`);
    return;
  }
  if (!chart) setLoadState('error', 'This song has no playable instrument parts.');
  if (chart && prefs.get('general.autoplay')) togglePlay(); // "Start playing as soon as I pick a song"
  else if (chart && wantAudio) ensureAudio(); // (playing needs a click: browsers block sound before one)
}

// The audio (the heavy part) loads on demand: Play, the Listen card or Space. A loading screen covers the stage meanwhile.
let audioLoad = null; // { song, promise } while a load runs
// `listen`: the Listen card only wants the sound: no loading screen, the stage (bar, fretboards, background) stays as it is and the progress
// shows in the card. A later full Play on a load still running upgrades it to the normal one (loading screen).
function refreshStemFailures() {
  if (audioSong !== current?.song) return; // (late stems of a song whose details are not open)
  const failedIds = new Set(player.failedStems.map((f) => f.id));
  for (const st of stemStates) st.failed = failedIds.has(st.stem.id);
  stemStates.forEach(applyStem);
}
function ensureAudio({ listen = false, at = 0 } = {}) {
  if (ready) return Promise.resolve(true);
  if (!current || !chart) return Promise.resolve(false);
  if (liveStage) takeStage(); // (Listen too: the sound of the live stage is about to be replaced)
  if (audioLoad?.song === current.song) {
    if (audioLoad.listen && !listen) { audioLoad.listen = false; stageLoading(); renderLoadState(); }
    return audioLoad.promise;
  }
  const token = loadToken;
  const song = current.song;
  const rec = { song, promise: null, listen }; // (audioLoad is cleared in the finally below, before the result is used: keep our own record)
  const promise = (async () => {
    if (!listen) stageLoading(); // the loading screen sits on the plain background: no old bar, no old fretboards
    setLoadState('loading', 'Loading audio…', 0.02);
    let loaded = false;
    try {
      audioSong = null; // (player.load frees the previous song's audio)
      const { first } = listen ? stemPriority(current.stems, current.midi, at) : { first: [] }; // (Listen: the sound starts when the backing track and the instruments playing around `at` are ready)
      loaded = await player.load(current.stems, {
        first,
        delay: songDelaySeconds(song.ini),
        onProgress: (p) => { if (token === loadToken) setLoadState('loading', `Loading audio… ${Math.round(p * 100)}%`, 0.02 + p * 0.98); },
      });
    } catch (err) {
      if (token === loadToken) { if (!rec.listen) markStageLive(); setLoadState('error', `${err?.name === 'EncodingError' || /decode/i.test(err?.message || '') ? 'Failed to decode audio' : 'Could not load the audio'}: ${err.message}`); setInfoOpen(true); }
      return false;
    } finally {
      if (audioLoad?.song === song) { audioLoad = null; renderLoadState(); } // (the Play buttons come back enabled, so a retry works)
    }
    if (token !== loadToken || !loaded) {
      if (token !== loadToken && loaded) player.unload(); // superseded after it installed (the player already refuses superseded loads): drop it
      return false;
    }
    els.seek.max = player.duration.toFixed(2);
    els.timeTotal.textContent = fmt(player.duration);
    paintSectionTicks(); // the slider range is known now
    const failedIds = new Set(player.failedStems.map((f) => f.id));
    for (const st of stemStates) st.failed = failedIds.has(st.stem.id);
    stemStates.forEach(applyStem); // volumes chosen while loading
    ready = true;
    audioSong = song;
    player.onLate = refreshStemFailures; // (the stems that were left for later join the mix or fail)
    const nFailed = failedIds.size;
    setLoadState('ready', nFailed ? `Ready to play (${nFailed} ${nFailed === 1 ? 'stem' : 'stems'} could not be decoded)` : 'Ready to play', 1);
    if (!rec.listen) { markStageLive(); releaseStage(); } else listenMode = true; // loaded: the bar and the tracks of the new song come in now (a listen-only load leaves the stage held)
    return true;
  })();
  rec.promise = promise;
  audioLoad = rec;
  renderLoadState();
  return promise;
}

// ---------- Info screen ----------
function setLoadState(state, text, fraction = 0) {
  loadInfo = { state, text, fraction };
  if (state === 'error') releaseStage();
  renderLoadState();
}

function renderLoadState() {
  const { state, text, fraction } = loadInfo;
  syncStagePlay();
  els.infoState.textContent = text;
  els.infoBar.style.width = `${Math.round(fraction * 100)}%`;
  els.infoProgress.dataset.state = state;
  els.play.disabled = els.infoPlay.disabled = !chart || (!ready && !!audioLoad);
  els.npPlay.disabled = !chart || (!ready && !!audioLoad && !audioLoad.listen); // (a press during the Listen load is queued)
  els.npSeek.disabled = !(ready && chart);
  const listenLoading = !!audioLoad?.listen && state === 'loading';
  els.npPlay.classList.toggle('loading', listenLoading); // a spinner on the button and the progress in the time text while the Listen card loads the audio
  if (listenLoading) els.npTime.textContent = text;
  els.npSeek.max = String(player.duration || 1);
  const screen = !!audioLoad && !audioLoad.listen && state === 'loading';
  els.loadScreen.hidden = true; // (the loading window is replaced by the start screen: its Play button is the loader)
  if (screen) {
    if (!startScreenOn && current && !infoOpen) { showSongInfo(null); showStartScreen(null); } // (a load that nobody opened the screen for)
    if (startScreenOn && els.siPlay.classList.contains('loading')) { els.siPlayText.textContent = `${Math.round(fraction * 100)}%`; els.siPlay.style.setProperty('--p', String(fraction)); }
  } else if (state === 'error') endStartScreen();
  else if (state === 'ready' && startScreenOn && !startDone && current && !current.started) endStartScreen(); // loaded with nobody pressing Play (a link without autostart): the pre-start screen takes the window back, its Play button ready
  const overlay = !infoOpen && !screen && state === 'error';
  els.loading.hidden = !overlay;
  if (overlay) els.loading.textContent = text;
}

// The details are the second pane of the library window (one glass window with the list). The chart keeps running behind it and the player
// bar stays visible. Settings and details are exclusive. Opened with the list closed, the window shows the details alone and closes with them.
const infoScroll = els.info.querySelector('.info-scroll');
attachScrollThumb(infoScroll); // the library's rail style instead of the native scrollbar
let infoOpener = null; // what had the focus when the pane opened, so it gets it back when the pane closes
let infoHideTimer = 0;

const LIST_GROW_MAX = 640; // closing the details: the list takes the freed room, but never grows beyond this (or its own preferred width)
function setInfoOpen(open, { grow = true, release = true } = {}) {
  const was = infoOpen;
  // closing the details next to the list: the list takes the window's width (the window does not jump); the grown width is not remembered
  const keep = grow && was && !open && !narrow() && !wideWindow() && libraryOpen() ? Math.min(winTotal, Math.max(LIST_GROW_MAX, libPref())) : 0;
  if (open && typeof settingsPage !== 'undefined' && settingsPage.isOpen()) settingsPage.close(); // one window at a time
  infoOpen = open;
  syncPanelUi();
  list.setActive(open ? current?.song ?? null : null); // closing the details unmarks the song in the list
  clearTimeout(infoHideTimer);
  els.info.inert = !open;
  if (open || libraryOpen()) els.info.hidden = !open;
  else infoHideTimer = setTimeout(() => { els.info.hidden = !infoOpen; }, 260); // the window slides out showing the details
  els.app.classList.toggle('info-open', open);
  document.body.classList.toggle('details-open', open); // (the edge tabs are outside .app)
  els.infoBtn.setAttribute('aria-pressed', String(open));
  syncWindow();
  if (keep) {
    setLibWidth(Math.min(maxLibWidth(), keep));
  } else layoutWindow();
  closePopovers();
  renderLoadState();
  syncUrl();
  syncEndScreen(); // the details cover the end window
  highway.invalidate();
  if (open && !was) {
    const a = document.activeElement;
    infoOpener = a && a !== document.body && !els.info.contains(a) ? a : null;
    els.infoWindow.focus({ preventScroll: true });
  } else if (!open && was) {
    const stopListening = listenMode && player.playing; // closing the details while the Listen card plays only stops the music: the stage is left as it is
    if (stopListening) { clearPreview(); player.pause(); player.seek(0); syncPlayButton(); }
    // (closing the details does not load the song into the stage: only Play does) // the details are closed: the song they were about is what the stage shows now (while its audio loads the stage waits for the load)
    const a = document.activeElement;
    if (infoOpener?.isConnected && infoOpener.offsetParent !== null && (!a || a === document.body || els.info.contains(a))) infoOpener.focus({ preventScroll: true });
    infoOpener = null;
  }
}
els.infoClose.addEventListener('click', () => setInfoOpen(false));
// The bar's info button toggles the window while it is open (otherwise it opens its small popup).
els.infoBtn.addEventListener('click', (e) => { if (infoOpen) { e.stopImmediatePropagation(); e.stopPropagation(); setInfoOpen(false); } }, true);
// A click outside the window closes the details only when they are alone: with the list next to them the window is a working
// space (the chart behind keeps being used) and stays as it is. Menus that live in <body> (custom selects, popovers) and the buttons
// that toggle it are not "outside".
document.addEventListener('pointerdown', (e) => {
  if (!infoOpen || libraryOpen() || els.library.contains(e.target) || e.target.closest?.('.sel-pop, .popover, #infoBtn, #libTab, #scrim, #topbar')) return;
  setInfoOpen(false);
});

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
new ResizeObserver(() => balanceChips()).observe(els.infoWindow);

// The parts of the screen that depend only on the song (song.ini), shown before anything is loaded.
function renderSongInfo(song) {
  els.infoTitle.textContent = plainText(song.title);
  els.infoWinTitle.textContent = plainText(song.title);
  els.infoWinArtist.textContent = plainText(song.artist);
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
const ICARD_MIN_W = 180;
const ICARD_GAP = 10;
function layoutInstrumentCards() {
  const box = els.instrumentCards;
  const n = box.children.length;
  const fit = Math.max(1, Math.floor((box.clientWidth + ICARD_GAP) / (ICARD_MIN_W + ICARD_GAP)));
  box.style.setProperty('--icols', String(evenPerRow(n, fit)));
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layoutInstrumentCards).observe(els.instrumentCards);
// The start / pause screen's tiles: the same even rows, every tile the same width (4 tiles: 4, or 2 + 2, never 3 + 1).
const PICKER_MIN_W = 190;
function layoutPicker() {
  const box = els.siPicker;
  const n = box.children.length;
  if (!n || !box.clientWidth) return;
  const fit = Math.max(1, Math.floor((box.clientWidth + ICARD_GAP) / (PICKER_MIN_W + ICARD_GAP)));
  box.style.setProperty('--icols', String(evenPerRow(n, fit)));
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layoutPicker).observe(els.siPicker);
new MutationObserver(layoutPicker).observe(els.siPicker, { childList: true });

// Several fretboards at once: a card (or menu row) can be pinned to show next to the active instrument.
// An instrument card is an on/off switch: on = its fretboard is on screen. Turning one on uses the difficulty it had last (diffChoice, kept from
// the memory of the last picks) unless a difficulty button is pressed; turning the active one off keeps it driving the timeline (hiddenActive).
const isOn = (group) => (group.active && !current.hiddenActive) || group.pinned;
function turnOn(group, ins, diffId) {
  current.modeChoice[group.key] = ins.id;
  const diff = diffId ?? diffFor(ins).chosen?.id;
  if (group.active) { // the (hidden) active instrument comes back
    current.hiddenActive = false;
    selectInstrument(ins.id, diff);
  } else if (current.hiddenActive) { // nothing was on: this one becomes the active one
    current.hiddenActive = false;
    selectInstrument(ins.id, diff);
  } else {
    if (diff) current.diffChoice[ins.id] = diff;
    current.pins.add(group.key);
    updateChart();
  }
}
function turnOff(group) {
  if (group.pinned) { current.pins.delete(group.key); updateChart(); return; }
  const next = instrumentGroups().find((g) => g.pinned); // the active one goes off: another one drives the timeline
  if (next) { current.pins.delete(next.key); selectInstrument(next.chosen.id, diffFor(next.chosen).chosen?.id); }
  else { current.hiddenActive = true; updateChart(); } // the only one: it stays the clock, but is not drawn
}

// A difficulty button: on the active card or a card that is not shown it picks the instrument; on a pinned card it only changes that fretboard.
function pickDifficulty(group, ins, diffId) {
  if (group.pinned) {
    current.diffChoice[ins.id] = diffId;
    updateChart();
  } else if (group.active && !current.hiddenActive) selectInstrument(ins.id, diffId); // the active one: a new difficulty
  else turnOn(group, ins, diffId); // an instrument that was off: it goes on at that difficulty
}

function renderPickers() {
  if (!current) return;
  const activeId = els.instrument.value;
  if (activeId) current.diffChoice[activeId] = els.difficulty.value;
  const activeIns = currentInstrument();
  if (activeIns) current.modeChoice[activeIns.base === 'drums' ? 'drums' : activeIns.mode === 'vocals' ? 'vocals' : activeIns.id] = activeIns.id; // the mode a merged card remembers
  els.instrumentCards.replaceChildren(...buildInstrumentCards());
  layoutInstrumentCards();
  if (els.songInfo.classList.contains('paused')) fillInfoInsts(); // (the paused song window shows the same cards)
}

// The instrument cards (on/off switches with the difficulty and mode buttons): in the details and in the song window shown while paused.
// The difficulty selector is one row of four. When a label would be cut (an ellipsis) the buttons that are not selected shrink to their initial
// first; only if that is not enough does it go to two rows. Checked whenever its width changes.
const DIFF_ABBR = { Easy: 'E', Medium: 'M', Hard: 'H', Expert: 'X' }; // (Expert is X: Easy already took the E)
function setDiffLabel(btn, label) {
  btn.setAttribute('aria-label', label);
  btn.replaceChildren(Object.assign(document.createElement('span'), { className: 'd-full', textContent: label }), Object.assign(document.createElement('span'), { className: 'd-abbr', textContent: DIFF_ABBR[label] ?? label[0] }));
}
const diffSegObserver = new ResizeObserver((entries) => {
  for (const { target: seg, contentRect } of entries) {
    if (seg._w === Math.round(contentRect.width)) continue; // (a height change from the classes below must not run this again)
    seg._w = Math.round(contentRect.width);
    const clipped = () => [...seg.children].some((b) => b.scrollWidth > b.clientWidth);
    seg.classList.remove('abbr', 'two-rows');
    if (!clipped()) continue;
    seg.classList.add('abbr');
    if (clipped()) seg.classList.replace('abbr', 'two-rows');
  }
});
// The Notes / Karaoke selector of a vocal tile (the same look as the drum type selector); it follows the global vocal view.
function vocalViewSeg() {
  const modes = document.createElement('div');
  modes.className = 'seg seg-modes vocal-modes';
  for (const [value, label] of [['track', 'Notes'], ['karaoke', 'Karaoke']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.vocal = value;
    b.textContent = label;
    b.setAttribute('aria-pressed', String(highway.vocalView === value));
    b.dataset.next = String(highway.vocalView === value); // (an instrument that is off shows its choice dimmed, like the type and difficulty)
    b.addEventListener('click', (e) => { e.stopPropagation(); setVocalView(value); });
    modes.append(b);
  }
  return modes;
}
function buildInstrumentCards() {
  return instrumentGroups().map((group) => buildInstrumentCard(group));
}
// One instrument tile. `menu`: it is the content of the stage menu of that instrument ({ onRemove }): always on, a remove button where the dot is, no click on the tile.
function buildInstrumentCard(group, menu = null) {
  {
    // Vocal parts have a single chart: no difficulty buttons.
    const ins = group.chosen; // the option this card stands for (for drums: the chosen mode)
    const { diffs, chosen } = diffFor(ins);
    const vocal = ins.mode === 'vocals';
    const card = document.createElement('div');
    card.className = 'icard';
    card.dataset.key = group.key;
    const on = menu ? true : isOn(group);
    card.dataset.active = String(on); // (lit when its fretboard is on screen)
    card.dataset.pinned = 'false';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'icard-head';
    head.setAttribute('aria-pressed', String(on));
    head.innerHTML = `<svg><use href="#i-${INSTRUMENT_ICON[ins.base] || 'music'}"/></svg><span class="icard-name"></span><span class="icard-dot" aria-hidden="true"></span>`; // (the dot: the pause screen's on/off mark)
    head.querySelector('.icard-name').textContent = group.label;

    // title row: [icon + name] [info button] ...... [level pips]
    const top = document.createElement('div');
    top.className = 'icard-top';
    top.append(head);
    const level = instrumentLevel(current.song, ins);
    if (level !== null) {
      const pips = document.createElement('span');
      pips.className = 'pips';
      pips.title = `Level ${level} of 6`;
      pips.replaceChildren(...Array.from({ length: 6 }, (_, i) => Object.assign(document.createElement('i'), { className: i < level ? 'on' : '' })));
      top.append(pips);
    }
    // The whole card selects the instrument (with its remembered mode and difficulty); the buttons stop the click.
    if (!menu) card.addEventListener('click', () => { if (on) turnOff(group); else turnOn(group, ins, undefined); }); // (the buttons stop the click)
    else {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'icard-remove icard-more';
      rm.title = 'Instrument actions';
      rm.setAttribute('aria-label', 'Instrument actions');
      rm.setAttribute('aria-haspopup', 'menu');
      rm.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        const list = document.createElement('div');
        list.className = 'ctx-list';
        list.setAttribute('role', 'menu');
        for (const act of menu.actions) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = `ctx-item${act.danger ? ' danger' : ''}`;
          item.setAttribute('role', 'menuitem');
          item.textContent = act.label;
          item.disabled = !act.enabled;
          if (act.title) item.title = act.title;
          item.addEventListener('click', () => { closeTilePop(); act.run(); });
          list.append(item);
        }
        openTilePop(rm, null, list);
      });
      top.append(rm);
    }
    card.append(top);

    if (group.options.length > 1) { // drum mode selector, same look as the difficulty one
      const modes = document.createElement('div');
      modes.className = 'seg seg-modes';
      for (const o of group.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const label = o.modeLabel ?? o.label;
        const parts = /^(.*?)lanes$/.exec(label); // "4 lanes" / "Pro 7 lanes": "lanes" may shrink to "ln" in a narrow tile (CSS container query on .si-picker)
        if (parts) {
          btn.setAttribute('aria-label', label);
          btn.append(parts[1], Object.assign(document.createElement('span'), { className: 'ln-full', textContent: 'lanes' }), Object.assign(document.createElement('span'), { className: 'ln-abbr', textContent: 'ln', title: 'lanes' }));
        } else btn.textContent = label;
        btn.setAttribute('aria-pressed', String(on && o.id === group.chosen.id));
        if (!on && o.id === group.chosen.id) btn.dataset.next = 'true'; // the type a click on the card will use
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          current.modeChoice[group.key] = o.id;
          if (group.pinned) updateChart(); // a fretboard shown next to the active one keeps showing
          else if (group.active && !current.hiddenActive) selectInstrument(o.id, diffFor(o).chosen?.id);
          else turnOn(group, o, undefined); // it was off: it goes on in that mode
        });
        modes.append(btn);
      }
      card.append(modes);
    }
    if (vocal) card.append(vocalViewSeg());
    if (!vocal) {
      const seg = document.createElement('div');
      seg.className = 'seg seg-diffs';
      diffSegObserver.observe(seg);
      for (const d of diffs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        setDiffLabel(btn, d.label);
        btn.setAttribute('aria-pressed', String(on && d.id === chosen?.id));
        if (!on && d.id === chosen?.id) btn.dataset.next = 'true'; // the difficulty a click on the card will use
        btn.addEventListener('click', (e) => { e.stopPropagation(); pickDifficulty(group, ins, d.id); });
        seg.append(btn);
      }
      card.append(seg);
    }
    card.append(buildTileTools(group));
    return card;
  }
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
    items.push({
      chart: shown, key: group.key, icon: INSTRUMENT_ICON[group.chosen.base] || 'music', label: shown.mode === 'vocals' ? group.label : `${group.label} · ${d.short}`,
      // for the end-of-song window
      name: group.chosen.label, base: group.chosen.base, optionId: group.chosen.id, diffId: d?.id, diffLabel: shown.mode === 'vocals' ? '' : d?.label ?? '', active: group.active,
    });
  }
  if (!liveStage) { // with no instrument on screen the stage offers the cards to add one (the details' cards are all off); they go as soon as one is on
    current.choosers = current.choosers.filter((c) => !c.auto || !items.some((x) => !x.chooser));
    if (!items.some((x) => !x.chooser) && !current.choosers.length) openChooser(null, true);
  }
  for (const c of current.choosers) if (c.at === null) items.push({ chooser: true, key: `choose:${c.id}` }); // an added one goes last
  current.screen = items.filter((x) => !x.chooser); // what is on screen, for the end-of-song window
  if (els.songInfo.classList.contains('show')) fillInfoInsts(); // (the song window lists every instrument and whether it is on)
  if (liveStage) { // the stage is another song's: these details only choose what will go there
    renderPickers();
    renderLoadState();
    syncUrl();
    saveLastPick();
    return;
  }
  highway.setCharts(items);
  if (endShown) buildEndScreen();
  fillSectionOptions();
  const hasLanes = items.some((x) => x.chooser || x.chart.mode !== 'vocals');
  const hasVocals = items.some((x) => !x.chooser && x.chart.mode === 'vocals');
  for (const g of els.paneMenu.querySelectorAll('[data-needs]')) g.hidden = !(g.dataset.needs === 'lanes' ? hasLanes : hasVocals); // view options: notes or karaoke for vocals, view and shape for fretboards
  renderPickers(); // (it records the active instrument's difficulty, which the menu and the chooser cards read: they come after it)
  if (!items.some((x) => !x.chooser)) els.paneMenu.hidden = true;
  else if (!els.paneMenu.hidden) buildPaneMenu(); // keep an open menu up to date
  for (const [key, el] of chooserEls) fillChooser(el, key); // the cards follow the instruments that are not on screen
  renderLoadState();
  vizAll = null; // (the equalizer's layers follow what is on screen)
  syncUrl(); // the link carries the instruments on screen
  saveLastPick(); // (the user's own changes; see openingSong)
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
  if (liveStage) return;
  const section = chart?.sections[i];
  if (!section) return;
  seekTo(Math.max(0, section.time + settings.chartDelay));
}
els.sectionSelect.addEventListener('change', () => seekToSection(Number(els.sectionSelect.value)));
els.back.addEventListener('click', () => stepSection(-1));
els.forward.addEventListener('click', () => stepSection(1));
function stepSection(dir) {
  if (liveStage || !chart?.sections.length) return;
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
els.mixerVal.textContent = masterState.muted ? 'Muted' : `${Math.round(masterState.value * 100)}%`;
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

// The volume of every track is remembered (src/volmemory.js, store key `stemVolumes`, setting `audio.rememberVolumes`): a song opens with the levels you left.
let volMem = parseVolumes(store.get('stemVolumes'));
let volTimer = 0;
function rememberVolume(kind, key, value) {
  if (!prefs.get('audio.rememberVolumes')) return;
  rememberLevel(volMem, kind, key, value);
  clearTimeout(volTimer);
  volTimer = setTimeout(() => store.set('stemVolumes', serializeVolumes(volMem)), 250); // (a slider drag sends many values)
}
function buildMixer(stems) {
  const restore = prefs.get('audio.rememberVolumes');
  const owner = current?.song ?? null; // (whose audio the track is: another song's sound is not touched by this mixer)
  stemStates = stems.map((stem) => ({ stem, owner, value: restore ? recallLevel(volMem, 'stems', stem.label) : 1, muted: false, group: null, views: [] }));
  const byKey = new Map();
  for (const st of stemStates) {
    const key = stemGroup(st.stem.label);
    if (!byKey.has(key)) byKey.set(key, { key, label: stemGroupLabel(key), members: [], value: 1, muted: false, expanded: false, views: [] });
    byKey.get(key).members.push(st);
  }
  groupList = [...byKey.values()];
  if (restore) for (const g of groupList) g.value = recallLevel(volMem, 'groups', g.key);
  for (const g of groupList) if (g.members.length > 1) for (const m of g.members) m.group = g;
  groupList = groupList.filter((g) => g.members.length > 1); // a lone stem needs no group

  masterState.views = liveStage ? masterState.views.filter((v) => v.container !== els.mixerInfo) : []; // (a live stage keeps its own bar mixer and the master row in it)
  const grouped = new Set(groupList.flatMap((g) => g.members));
  for (const container of liveStage ? [els.mixerInfo] : [els.mixer, els.mixerInfo]) {
    const master = mixerRow(masterState);
    masterState.views[masterState.views.length - 1].container = container;
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
  queueMicrotask(() => refreshTileVolumes()); // (the tiles' volume buttons wait for the stems)
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
  view.range.addEventListener('input', () => { st.value = Number(view.range.value); st.muted = false; applyStem(st); if (!st.master) rememberVolume('stems', st.stem.label, st.value); }); // moving the slider re-enables the track
  pressHandlers(mute, st.master ? null : () => soloStem(st), () => {
    if (st.group?.muted) { st.group.muted = false; applyGroup(st.group); return; } // the group was muted: this click turns it back on
    st.muted = !st.muted;
    applyStem(st);
  });
  row.querySelector('.reset').addEventListener('click', () => { st.value = 1; st.muted = false; applyStem(st); if (!st.master) rememberVolume('stems', st.stem.label, 1); });
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
  view.range.addEventListener('input', () => { g.value = Number(view.range.value); unmuteGroup(g); applyGroup(g); rememberVolume('groups', g.key, g.value); });
  pressHandlers(mute, () => soloGroup(g), () => {
    if (groupSilent(g)) unmuteGroup(g);
    else g.muted = true;
    applyGroup(g);
  });
  row.querySelector('.reset').addEventListener('click', () => { g.value = 1; unmuteGroup(g); applyGroup(g); rememberVolume('groups', g.key, 1); });
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
    els.mixerVal.textContent = st.muted ? 'Muted' : `${Math.round(st.value * 100)}%`; // (shown beside the volume icon on wide screens)
    player.setMaster(st.muted ? 0 : st.value);
    store.set('master', String(st.value)); // the master level and its mute are kept between visits
    store.set('masterMuted', st.muted ? '1' : '0');
  } else if (st.owner === audioSong || !audioSong) player.setVolume(st.stem.id, effectiveVolume(st)); // (the sound of another song is not touched by this song's mixer)
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
    if (st.failed) { // never decoded: nothing to control
      v.row.classList.add('muted');
      v.row.title = 'Could not be decoded';
      v.mute.title = `${st.stem.label} — could not be decoded`;
      for (const el of [v.range, v.mute, v.reset]) el.disabled = true;
    }
  }
}

// Settings: one value each, shown by every [data-setting] slider (menu popover and info screen). The neck's "default" (what a reset
// restores) is the user's starting value, the highway.neck setting.
const SETTING_DEFAULTS = { speed: 1, get neck() { return prefs.get('highway.neck'); }, chartDelay: 0 };
const SETTING_FORMAT = {
  speed: (v) => `${Number(v.toFixed(2))}×`, // (also the bar's readout, the quick settings and the speed note)
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
  if (name === 'speed') { player.setRate(value); els.speedVal.textContent = SETTING_FORMAT.speed(value); }
  if (name === 'neck') highway.setNeckSpeed(value);
}
// The mouse wheel over any slider moves it (up = more, 5 notches... one step per notch; a slider with many steps moves 2% of its range per
// notch); touchpads give fractions, which add up. The seek bar keeps its own wheel (5 s per notch). Listeners elsewhere hear a normal `input`.
let wheelAcc = new WeakMap();
// The (non-passive) listener sits on each range input, not on the document, so scrolling lists never waits for the main thread. It is bound lazily, the first
// time the pointer goes over the slider or it takes the focus (one passive delegated listener each; no MutationObserver over the document).
function onRangeWheel(e) {
  const el = e.currentTarget;
  if (el.disabled) return;
  e.preventDefault();
  const delta = e.deltaY || e.deltaX;
  const acc = (wheelAcc.get(el) || 0) + -delta / (e.deltaMode === 1 ? 3 : 100);
  const notches = Math.trunc(acc);
  wheelAcc.set(el, acc - notches);
  if (!notches) return;
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const step = Number(el.step) > 0 ? Number(el.step) : 1;
  const move = (max - min) / step > 100 ? (max - min) * 0.02 : step; // fine-grained sliders: 2% of the range
  const next = Math.min(max, Math.max(min, Number(el.value) + notches * move));
  const rounded = Math.round((next - min) / step) * step + min;
  el.value = String(Math.min(max, Math.max(min, +rounded.toFixed(6))));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
// The other sliders (settings, the pause panel, the visualizer menu, the Listen card) get the same custom look: they are painted here, whatever sets their value
// (an input event, a script assigning .value, .min or .max; the static ones once at start, and again when the pointer or the focus reaches them).
// Every such slider is given its value through `.value` after it is built (settings refreshers, syncMetPop, the visualizer menu, the Listen card).
const GENERIC_RANGE = '.sp-range input[type=range], .pp-row input[type=range], .viz-level input[type=range], .listen input[type=range], .now-playing input[type=range]';
function paintGenericRange(el) {
  if (!el.matches?.(GENERIC_RANGE)) return;
  const min = Number(el.min || 0);
  const span = Number(el.max || 100) - min || 1;
  el.style.setProperty('--p', String(Math.min(1, Math.max(0, (Number(el.value) - min) / span))));
}
for (const prop of ['value', 'min', 'max']) {
  const own = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, prop);
  Object.defineProperty(HTMLInputElement.prototype, prop, { ...own, set(v) { own.set.call(this, v); if (this.type === 'range') paintGenericRange(this); } });
}
document.addEventListener('input', (e) => { if (e.target.type === 'range') paintGenericRange(e.target); }, true);
document.querySelectorAll('input[type=range]').forEach(paintGenericRange);
const wheelBound = new WeakSet();
function reachRange(e) {
  const el = e.target;
  if (el?.type !== 'range' || el.tagName !== 'INPUT') return;
  paintGenericRange(el);
  if (wheelBound.has(el) || el.closest('#seekbox')) return;
  wheelBound.add(el);
  el.addEventListener('wheel', onRangeWheel, { passive: false });
}
document.addEventListener('pointerover', reachRange, { capture: true, passive: true });
document.addEventListener('focusin', reachRange, true);
// ...and over the volume button of the bar it moves the master volume (5% per notch; it also un-mutes)
let masterWheelAcc = 0;
els.mixerBtn.addEventListener('wheel', (e) => {
  e.preventDefault();
  masterWheelAcc += -(e.deltaY || e.deltaX) / (e.deltaMode === 1 ? 3 : 100);
  const notches = Math.trunc(masterWheelAcc);
  masterWheelAcc -= notches;
  if (!notches) return;
  masterState.value = Math.min(1.5, Math.max(0, Math.round((masterState.value + notches * 0.05) * 100) / 100));
  masterState.muted = false;
  applyStem(masterState);
}, { passive: false });
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
const barAtBottom = () => els.app.classList.contains('bar-bottom');
function placePopover(btn, pop) {
  const b = btn.getBoundingClientRect();
  const width = pop.offsetWidth;
  const anchor = pop.classList.contains('align-left') ? b.left : b.right - width; // popovers near the left edge open to the right
  const left = Math.min(Math.max(8, anchor), window.innerWidth - width - 8);
  pop.style.left = `${Math.max(8, left)}px`;
  if (barAtBottom() && btn.closest('.topbar')) { // the bar is under the stage: its menus open upwards
    pop.style.top = 'auto';
    pop.style.bottom = `${window.innerHeight - b.top + 8}px`;
    pop.style.maxHeight = `${Math.max(120, b.top - 16)}px`;
  } else {
    pop.style.bottom = 'auto';
    pop.style.top = `${b.bottom + 8}px`;
    pop.style.maxHeight = `${Math.max(120, window.innerHeight - b.bottom - 16)}px`;
  }
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
els.play.addEventListener('click', () => (liveStage ? toggleBackground() : togglePlay())); // (the bar belongs to the song on the stage)
// The bar is written every frame, so it is written only when the picture can change: while playing the fill and the thumb move in whole device
// pixels of the bar (a write per pixel of travel, not per frame); paused, the exact position (so a paused bar looks as it always did).
let seekBarPx = 0; // the bar's width in device pixels
new ResizeObserver(([e]) => { seekBarPx = e.devicePixelContentBoxSize?.[0]?.inlineSize || e.contentRect.width * window.devicePixelRatio; }).observe(els.seek);
let seekPct = '';
function paintSeek(at = Number(els.seek.value)) { // the fill: the playing position (the thumb alone follows the pointer while it is dragged)
  const max = Number(els.seek.max) || 1;
  let pct = Math.min(100, (at / max) * 100);
  if (player.playing && seekBarPx > 0) { const q = 100 / seekBarPx; pct = Math.floor(pct / q) * q; }
  const s = `${pct}%`;
  if (s !== seekPct) { seekPct = s; els.seek.style.setProperty('--pct', s); }
}
let seekValueAt = NaN;
let seekValueStr = '';
function setSeekValue(t) { // the thumb (same rule as the fill; written again if anything else moved it)
  if (player.playing && seekBarPx > 0) { const q = (Number(els.seek.max) || 1) / seekBarPx; t = Math.floor(t / q) * q; }
  if (t === seekValueAt && els.seek.value === seekValueStr) return;
  seekValueAt = t;
  els.seek.value = t;
  seekValueStr = els.seek.value;
}
els.seek.addEventListener('input', () => {
  seeking = true;
  els.timeNow.textContent = fmt(Number(els.seek.value));
});
els.seek.addEventListener('change', () => {
  if (liveStage) { player.seek(Number(els.seek.value)); seeking = false; return; } // (the song on the stage, not the one in the details)
  clearPreview();
  seekTo(Number(els.seek.value));
  seeking = false;
});
// The mouse wheel over the seek bar moves the song: up goes forward, down goes back, 5 s per notch (1 s with Shift).
els.seekbox.addEventListener('wheel', (e) => {
  if (!ready) return;
  e.preventDefault(); // (the page would otherwise scroll or zoom)
  const delta = e.deltaY || e.deltaX; // with Shift some browsers report the wheel as horizontal
  const notches = -delta / (e.deltaMode === 1 ? 3 : 100); // a notch is 100 px or 3 lines; smooth touchpads give fractions
  const to = Math.max(0, Math.min(player.duration, player.currentTime() + notches * (e.shiftKey ? 1 : 5)));
  clearPreview();
  seekTo(to);
}, { passive: false });

// ---------- Loop (A-B repeat) ----------
// The loop is a range of PLAYER time (the seek bar's scale), so it survives instrument / difficulty changes and is
// cleared when another song opens. State is per session. Two handles on the seek bar move its ends (magnets on the
// section starts, the song start and end; Alt turns them off); a band shows the region.
// Wrap rule: playback jumps back to the start only when it leaves the END of the region from INSIDE it. A loop is
// dormant while playback is outside the region (after a seek before or past it) and re-arms once playback enters it.
let loop = null; // { start, end } or null
let trainer = null; // the speed trainer while it runs ({ speed, passes, done }, trainer.js): practice.trainer is on and so is a loop
let loopPrev = null; // the previous frame's time, to tell a wrap from a seek
let loopDrag = null;
const LOOP_SNAP_PX = 10;
const sectionStartsPlayer = () => (chart?.sections ?? []).map((s) => s.time + settings.chartDelay);
const seekMax = () => Number(els.seek.max) || 0;
// x position of a time on the seek bar, the same mapping as the section ticks (12 px thumb travel)
const timeLeft = (at) => `calc(${(at / (seekMax() || 1)).toFixed(5)} * (100% - 12px) + 6px)`;

function setLoop(range) {
  cancelLoopWait();
  loopHeld = false;
  if (range) clearRewind();
  const had = !!loop;
  loop = range && seekMax() > 0 ? range : null;
  loopPrev = null;
  paintLoop();
  if (!loop) stopTrainer(); else if (!had) beginTrainer(); // (moving a handle keeps the trainer's progress)
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
// A: the loop start / B: the loop end at the playhead (an end set past the other one swaps them; shorter than MIN_LOOP is refused).
function setLoopHere(which) {
  if (!chart || liveStage || !ready) return;
  const at = player.currentTime();
  const range = setLoopPoint(loop, which, at, seekMax(), MIN_LOOP);
  if (!range) { flashNote('Loop too short'); return; }
  setLoop(range);
  // say what changed: an end set past the other one swaps them, so the pressed key may have become the other end
  flashNote(Math.abs(range.start - Math.max(0, Math.min(at, seekMax()))) < 1e-9 ? 'Loop start set' : 'Loop end set');
  rewindIntoLoop();
}
// Loop restart delay (YARG's practice restart delay): at the loop end the song pauses (the play button keeps its playing state, the fretboards stay at the end)
// for playback.loopRestartDelay seconds, then restarts like a normal wrap. Play/pause, a seek, a loop change, a focus-loss pause or closing the song cancel it.
let loopWait = null; // { until, timer, shown } while the wait runs
let loopHeld = false; // the user paused during the wait: the next Play does the wrap itself (the hold was served for this pass)
function cancelLoopWait() {
  if (!loopWait) return;
  clearInterval(loopWait.timer);
  loopWait = null;
  if (flashEl) flashEl.style.opacity = '0';
  syncPlayButton();
}
function holdAtLoopEnd(delaySec) {
  player.pause();
  const w = { until: performance.now() + delaySec * 1000, timer: 0, shown: Math.ceil(delaySec) };
  loopWait = w;
  w.timer = setInterval(() => {
    const left = (w.until - performance.now()) / 1000;
    if (left <= 0) { finishLoopWait(); return; }
    const n = Math.ceil(left - 1e-9);
    if (n !== w.shown) { w.shown = n; flashNote(restartNote(left)); }
  }, 100);
  flashNote(restartNote(delaySec));
  syncPlayButton();
}
async function finishLoopWait() {
  const w = loopWait;
  if (!w) return;
  clearInterval(w.timer);
  loopWait = null;
  if (flashEl) flashEl.style.opacity = '0';
  if (!loop || !ready || player.playing) { syncPlayButton(); return; }
  wrapLoop();
  loopPrev = null;
  await player.play();
  syncPlayButton();
}
// The restart itself: one second before the loop start (the same rewind as after a pause) with the notes of that second drawn disabled, until the song
// reaches the start. Returns the new player time.
function wrapLoop() {
  trainerPass(); // (before the seek: a speed step starts with the new pass)
  const back = prefs.get('playback.resumeRewind') ? Math.max(0, loop.start - PAUSE_REWIND_SEC) : loop.start;
  internalSeek = true;
  player.seek(back); // the audio restarts at once (no scrub)...
  internalSeek = false;
  pendingSeekDur = 450; // ...and the fretboards rewind with the usual seek animation, a little quicker
  if (back < loop.start) { replay = { from: back, to: loop.start }; highway.replayWindow = replay; } else clearRewind();
  return back;
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

// Speed trainer (setting practice.trainer; rules in trainer.js): while a loop runs, every completed pass (a wrap, counted in wrapLoop, so
// the restart delay and a pause during it count once) moves it on; after practice.trainerPasses passes the speed goes up one step through
// setSetting (the audio stretch follows). Starting it (a new loop, or the setting turned on during one) sets the start speed; ending the
// loop (R, a seek out of it, another song) or turning it off keeps the speed reached. It only reads the wait/rewind state, never changes it.
const trainerCfg = () => trainerConfig((id) => prefs.get(id));
function beginTrainer() {
  trainer = null;
  if (loop && prefs.get('practice.trainer')) {
    trainer = startTrainer(trainerCfg());
    setSetting('speed', trainer.speed);
    flashNote(`Speed trainer: ${stepNote(trainer)}`);
  }
  paintTrainer();
}
function stopTrainer() {
  trainer = null;
  paintTrainer();
}
function trainerPass() {
  if (!trainer) return;
  trainer = nextTrainerState(trainer, { type: 'wrap', speed: settings.speed }, trainerCfg());
  if (trainer.stepped) { setSetting('speed', trainer.speed); flashNote(stepNote(trainer)); }
  paintTrainer();
}
// The trainer row of the speed popover: an On/Off switch bound to practice.trainer and a status line (pass count, speed, target).
const trainerBox = document.createElement('div');
trainerBox.className = 'fp-group trainer-box';
trainerBox.innerHTML = '<span class="fp-label">Speed trainer</span><div class="seg fret-seg" role="group" aria-label="Speed trainer"><button type="button" data-value="true">On</button><button type="button" data-value="false">Off</button></div><div class="trainer-status" role="status"></div>';
for (const b of trainerBox.querySelectorAll('button')) b.addEventListener('click', () => prefs.set('practice.trainer', b.dataset.value === 'true'));
els.settingsPop.append(trainerBox);
const trainerStatusEl = trainerBox.querySelector('.trainer-status');
function paintTrainer() {
  const on = prefs.get('practice.trainer');
  for (const b of trainerBox.querySelectorAll('button')) b.setAttribute('aria-pressed', String(String(on) === b.dataset.value));
  if (trainer) trainer = nextTrainerState(trainer, { type: 'paint', speed: settings.speed }, trainerCfg()); // (the speed may have been moved by hand, the target changed)
  setText(trainerStatusEl, trainerStatus({ on, looping: !!loop, state: trainer, cfg: trainerCfg() }));
  els.settingsBtn.classList.toggle('trainer-on', !!trainer);
}
els.settingsPop.addEventListener('input', paintTrainer); // (the speed slider)
els.settingsBtn.addEventListener('click', paintTrainer);

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
  tip.style.top = barAtBottom() ? `${r.top - tip.offsetHeight - 6}px` : `${r.bottom + 6}px`; // above the seek bar when the bar is at the bottom
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
  if (loop && (t < loop.start - 1e-6 || t > loop.end + 1e-6)) setLoop(null); // a seek out of the loop ends it (the playhead is free again)
  // Optionally the seek lands PAUSE_REWIND_SEC early, as a resume from a pause does: the notes of that second are drawn disabled until the song reaches the target.
  if (ready && !loop && prefs.get('playback.seekRewind') && t > 0.05) {
    const back = Math.max(0, t - PAUSE_REWIND_SEC);
    clearRewind();
    internalSeek = true;
    seekPlain(back);
    internalSeek = false;
    if (back < t) { replay = { from: back, to: t }; highway.replayWindow = replay; highway.invalidate(); }
    return;
  }
  seekPlain(t);
}
function seekPlain(t) {
  const dist = Math.abs(t - player.currentTime());
  if (!ready || !player.playing || dist <= SEEK_JUMP_SEC || !motionPref('highway.seekAnimation')) { player.seek(t); return; }
  const ms = seekAnimMs(dist);
  pendingSeekDur = ms;
  player.scrubTo(t, ms);
}

// Resuming from a pause (YARG's GameManager.Resume / RewindAndResume): the song goes back PAUSE_REWIND_SEC before the pause point, never before the limit set
// by the first pause when pausing again (rewindLimit), the screen takes REWIND_ANIM_MS to travel back, then the sound starts; the notes of the stretch up to the
// pause point are drawn disabled (YARG judges no input until the song has passed the pause point). Not with a loop, after a seek, or when the setting is off.
const PAUSE_REWIND_SEC = 1;
const REWIND_ANIM_MS = 500;
let pausedAt = null; // where the song was paused by the user (null: not a resume from a pause)
let rewindLimit = -Infinity;
let resumeTimer = 0;
let replay = null; // { from, to }: the replayed stretch while it runs
let internalSeek = false;
function rememberPause() {
  const t = player.currentTime();
  if (!replay) { // (pausing again during the replay keeps the first pause's point and limit)
    pausedAt = t;
    rewindLimit = Math.max(t - PAUSE_REWIND_SEC, rewindLimit);
  }
}
function clearRewind() {
  clearTimeout(resumeTimer);
  resumeTimer = 0;
  pausedAt = null;
  rewindLimit = -Infinity;
  replay = null;
  highway.replayWindow = null;
}
let resumeDone = null; // resolves the wait of a rewind that is running (a cancel resolves it too)
let resumeCancelled = false;
function cancelResumeRewind() {
  clearTimeout(resumeTimer);
  resumeTimer = 0;
  resumeCancelled = true;
  resumeDone?.();
}
async function rewindBeforePlay() {
  const at = replay?.to ?? pausedAt;
  if (at === null || !prefs.get('playback.resumeRewind') || loop || listenMode || ended) return false;
  if (rewindLimit === -Infinity) return false; // (no pause point: a seek that already landed early (seekRewind) plays on from there; Math.max(0, -Infinity) used to send it to 0)
  const target = Math.max(0, rewindLimit);
  const now = player.currentTime();
  if (now - target < 0.05 || target >= at) { return false; }
  internalSeek = true;
  pendingSeekDur = REWIND_ANIM_MS; // the fretboards travel back in this time
  player.seek(target);
  internalSeek = false;
  replay = { from: target, to: at };
  highway.replayWindow = replay;
  highway.invalidate();
  resumeCancelled = false;
  await new Promise((resolve) => { resumeDone = resolve; resumeTimer = setTimeout(() => { resumeTimer = 0; resolve(); }, REWIND_ANIM_MS); });
  resumeDone = null;
  if (resumeCancelled || replay === null) return true; // (cancelled while waiting: it stays paused at the rewound point)
  await player.play();
  syncPlayButton();
  return true;
}

async function togglePlay() {
  if (!chart) return;
  if (liveStage) takeStage(); // the details' Play: this song goes onto the stage (the sound that was playing is replaced when its audio loads)
  if (ended && !player.playing) return restartSong(); // the button reads Restart
  clearPreview();
  if (player.playing && listenMode && !backgroundAudio()) { // listening from the Listen card: Play takes the sound to the chart and keeps it going
    if (libraryOpen()) setLibraryOpen(false, false);
    markStageLive();
    if (infoOpen) setInfoOpen(false);
    releaseStage();
    syncPlayButton();
    return;
  }
  if (loopWait) { rememberPause(); cancelLoopWait(); loopHeld = true; return; } // Play (pause) pressed during the loop restart delay: a user pause at the loop end (the panel shows, Play resumes with the wrap)
  if (resumeTimer) { cancelResumeRewind(); syncPlayButton(); return; } // Play pressed again during the rewind: stay paused
  if (holdActive) { skipStartWait(); return; } // the screen is waiting for Play (no focus when it loaded): the bar's Play starts the song
  if (startDone) { cancelStartWait(); syncPlayButton(); return; } // Play (pause) pressed during the start delay: stay at the start
  if (player.playing && !backgroundAudio()) {
    rememberPause();
    player.pause();
  } else {
    if ((infoOpen || !ready) && libraryOpen()) setLibraryOpen(false, false); // Play from the details (or the first Play of a song) gets the library out of the chart's way
    if (current) current.started = true; // (the pre-start pause screen goes: this song is being played)
    const firstScreen = !current.startShown && prefs.get('playback.songInfoOverlay') && !ready; // the start screen comes with the first load of a song
    if (firstScreen && isFreshStart({ position: 0, resumed: pausedAt !== null, loop: !!loop, background: listenMode || backgroundAudio(), ended }) && !infoOpen) { showSongInfo(null); showStartScreen(null); }
    const loading = ensureAudio(); // (starts the load first: closing the details must not release the held stage before it)
    if (infoOpen) setInfoOpen(false); // starting from the details goes to the chart
    if (!(await loading)) return; // the first Play loads the audio behind the loading screen
    markStageLive(); // (the audio may have been loaded by the Listen card with the stage held: now the chart and the bar come in)
    releaseStage();
    if (await rewindBeforePlay()) return; // (resumed from a pause: the rewind starts the sound itself)
    if (loopHeld) { // paused during the loop restart delay: the hold was served, restart the loop now instead of waiting again
      loopHeld = false;
      if (loop) { wrapLoop(); loopPrev = null; }
    }
    if (startScreenOn && !document.hasFocus()) { // the load finished while the browser has no focus: no autostart
      showStartScreen('hold');
      const clicked = await waitForPlay();
      if (startCancelled) { syncPlayButton(); return; }
      if (clicked) { fadeOutInfo(); current.startShown = true; await player.play(); syncPlayButton(); return; } // the Play button: start at once
    }
    const plan = startPlan({
      fresh: isFreshStart({ position: player.currentTime(), resumed: pausedAt !== null, loop: !!loop, background: listenMode || backgroundAudio(), ended }),
      delay: prefs.get('playback.startDelay'), overlayOn: prefs.get('playback.songInfoOverlay'), keep: prefs.get('playback.keepSongInfo'), firstOfSong: !current.startShown,
    });
    if (plan.show) showSongInfo(plan.delay > 0 ? null : plan.hideMs);
    if (plan.screen) { current.startShown = true; showStartScreen(plan.delay); }
    if (plan.delay > 0) { await startAfterDelay(plan); return; } // (the sound starts itself when the wait is over)
    await player.play();
  }
  syncPlayButton();
}

// Song start delay (YARG's SONG_START_DELAY) and the song information overlay (SongInfoText). A Play from the very beginning waits playback.startDelay
// seconds with the fretboards at the start and the button in its playing state; Play/pause or a seek during the wait cancels it (like the resume rewind's
// timer: startDone resolves the wait early and startCancelled tells it not to play). The overlay fades in with the wait (or with the first play of a song when
// there is no delay) and out INFO_*_MS after the sound starts, unless playback.keepSongInfo; closing the song or opening another hides it at once.
let startTimer = 0;
let startDone = null; // resolves the wait of a start delay that is running (a cancel resolves it too)
let startCancelled = false;
let infoShownFor = null; // the song whose overlay was shown (a first play of another song shows it again)
let infoTimer = 0;
function showSongInfo(hideMs) {
  const song = current?.song;
  if (!song) return;
  const l = overlayLines(song);
  els.siTitle.textContent = l.title;
  els.siArtist.textContent = l.artist;
  els.siDetails.replaceChildren(...l.details.map((d) => Object.assign(document.createElement('div'), { textContent: d })));
  els.siCredits.replaceChildren(...l.credits.map((r) => { // a second line: the pack and the charter
    const item = document.createElement('div');
    item.textContent = r.value; // (no labels: the pack and the charter are told apart by the pack's name itself)
    item.title = r.label;
    return item;
  }));
  els.siCover.hidden = !current.coverUrl;
  if (current.coverUrl) els.siCover.src = current.coverUrl;
  // the instruments on screen with their difficulty (Expert...) and the song's own level for them (the pips of the cards)
  fillInfoInsts();
  infoShownFor = song;
  els.songInfo.classList.remove('closing');
  els.songInfo.classList.add('show');
  scheduleInfoHide(hideMs);
}
// All the instruments of the song with the song's level pips (read only: no difficulty, the cards below choose it), and, while the window is the paused one, the same instrument
// cards as the song details below them (on/off, mode and difficulty buttons).
function fillInfoInsts() {
  if (!current) return;
  const song = current.song;
  els.siInsts.replaceChildren(...instrumentGroups().map((g) => { // every instrument the song has (not only the ones on screen), without a difficulty
    const row = document.createElement('div');
    row.className = 'si-inst';
    const level = instrumentLevel(song, { base: g.chosen.base });
    const pips = level === null || level === undefined ? '' : `<span class="mini-pips" title="Level ${level}">${Array.from({ length: 6 }, (_, k) => `<i${k < level ? ' class="on"' : ''}></i>`).join('')}</span>`;
    row.innerHTML = `<svg><use href="#i-${INSTRUMENT_ICON[g.chosen.base] || 'music'}"/></svg><span class="si-inst-name"></span>${pips}`;
    row.querySelector('.si-inst-name').textContent = g.label;
    return row;
  }));
  if (els.songInfo.classList.contains('paused')) els.siPicker.replaceChildren(...buildInstrumentCards());
}
els.siPlay.addEventListener('click', () => {
  if (skipStartWait()) return;
  if (ready && !startScreenOn && current && !current.started) current.startShown = true; // Play pressed on the idle pre-start screen (audio loaded): start now, no 3 s count
  togglePlay();
});
function scheduleInfoHide(ms) {
  clearTimeout(infoTimer);
  infoTimer = 0;
  if (ms == null || prefs.get('playback.keepSongInfo')) return;
  infoTimer = setTimeout(() => { infoTimer = 0; els.songInfo.classList.remove('show'); }, ms);
}
// The start screen: the first play of a song shows the pause screen (the song window with the instrument cards, the stage darkened) for START_SCREEN_SEC; its
// Play button drains as the time runs out and starts the song at once when pressed; when the time is up the song starts by itself.
let startScreenOn = false;
// `sec` null: the audio is still loading, the Play button is a loader (text and spinner); a number: it is loaded, the button is Play and drains over `sec`.
function showStartScreen(sec) {
  startScreenOn = true;
  const hold = sec === 'hold'; // loaded, but the browser has no focus: the Play button is ready, the count starts when the page is focused
  const loading = sec == null;
  els.siPlay.classList.toggle('loading', loading);
  els.siPlay.disabled = loading;
  els.siPlay.classList.remove('counting');
  if (loading) { els.siPlayText.textContent = '0%'; els.siPlay.style.setProperty('--p', '0'); }
  else if (hold) { els.siPlayText.textContent = 'Play'; els.siPlay.style.setProperty('--p', '1'); }
  else {
    els.siPlay.style.setProperty('--p', '1');
    els.siPlayText.textContent = 'Play';
    els.songInfo.style.setProperty('--si-ms', `${sec * 1000}ms`);
    void els.siPlay.offsetWidth; // (restarts the drain animation)
    els.siPlay.classList.add('counting');
  }
  els.songInfo.classList.add('paused', 'starting');
  els.songInfo.setAttribute('aria-hidden', 'false');
  els.pauseDim.classList.add('show');
  fillInfoInsts();
}
function endStartScreen() {
  if (!startScreenOn) return;
  startScreenOn = false;
  pauseInfoShown = false; // (the pause screen sync shows its own again if it is still wanted)
  els.siPlay.classList.remove('counting', 'loading');
  els.siPlay.disabled = false;
  els.siPlayText.textContent = 'Play';
  els.songInfo.classList.remove('paused', 'starting');
  els.songInfo.setAttribute('aria-hidden', 'true');
  els.pauseDim.classList.remove('show');
  els.siPicker.replaceChildren();
}
// The load finished without the browser having the focus: no autostart at all (not even when the focus comes back); the screen waits with its Play button ready.
// Resolves true when Play is pressed (the screen's button or the bar's), false when the wait is cancelled.
let holdClicked = false;
let holdActive = false;
function waitForPlay() {
  startCancelled = false;
  holdClicked = false;
  holdActive = true;
  return new Promise((resolve) => {
    startDone = () => { holdActive = false; startDone = null; resolve(holdClicked); };
  });
}
function skipStartWait() { // the Play button of the start screen: start now
  if (!startDone) return false;
  clearTimeout(startTimer);
  startTimer = 0;
  holdClicked = true; // (only read by the focus hold)
  startDone(); // (not a cancel: startAfterDelay goes on to play)
  return true;
}
// The song window goes away with a fade: it keeps its full content and layout for the fade (0.5 s) and is only reset afterwards (resetting it at once showed the
// old small overlay while it faded).
let infoCleanupTimer = 0;
function fadeOutInfo() {
  startScreenOn = false;
  pauseInfoShown = false;
  clearTimeout(infoTimer);
  infoTimer = 0;
  els.songInfo.classList.add('closing'); // (not clickable while it fades)
  els.songInfo.classList.remove('show');
  els.pauseDim.classList.remove('show');
  clearTimeout(infoCleanupTimer);
  infoCleanupTimer = setTimeout(() => {
    infoCleanupTimer = 0;
    els.songInfo.classList.remove('closing');
    if (els.songInfo.classList.contains('show') || startScreenOn || pauseInfoShown) return; // (shown again meanwhile)
    els.siPlay.classList.remove('counting', 'loading');
    els.siPlay.disabled = false;
    els.siPlayText.textContent = 'Play';
    els.songInfo.classList.remove('paused', 'starting');
    els.songInfo.setAttribute('aria-hidden', 'true');
    els.siPicker.replaceChildren();
  }, 650);
}
function hideSongInfo() {
  clearTimeout(infoTimer);
  infoTimer = 0;
  endStartScreen();
  els.songInfo.classList.remove('show');
}
function cancelStartWait() {
  clearTimeout(startTimer);
  startTimer = 0;
  if (!startDone) return;
  startCancelled = true;
  startDone();
  hideSongInfo();
}
async function startAfterDelay(plan) {
  startCancelled = false;
  const wait = new Promise((resolve) => { startDone = resolve; startTimer = setTimeout(() => { startTimer = 0; resolve(); }, plan.delay * 1000); });
  syncPlayButton();
  await wait;
  startDone = null;
  if (startCancelled) { syncPlayButton(); return; }
  if (plan.screen && plan.hideMs === 0) fadeOutInfo(); // the start screen fades out as the song starts
  else { endStartScreen(); scheduleInfoHide(plan.hideMs); }
  await player.play();
  syncPlayButton();
}

// Focus loss (YARG's PauseOnFocusLoss / MuteOnFocusLoss): the window or the tab goes away. Pause is the same as the user's (rememberPause, so Play
// resumes with the rewind) and only for the song's own player, never the Listen card's or another song's sound; nothing resumes by itself. Mute silences the
// master output without touching the saved volume or mute, and is undone on return.
let focusLost = false;
function onFocusLoss() {
  if (focusLost) return;
  focusLost = true;
  if (prefs.get('playback.muteOnFocusLoss')) player.setMaster(0);
  if (!prefs.get('playback.pauseOnFocusLoss')) return;
  if (loopWait) cancelLoopWait();
  else if (startDone) { cancelStartWait(); syncPlayButton(); }
  else if (resumeTimer) { cancelResumeRewind(); syncPlayButton(); }
  else if (player.playing && !listenMode && !backgroundAudio() && !liveStage) { rememberPause(); player.pause(); syncPlayButton(); }
}
function onFocusBack() {
  if (!focusLost || document.hidden) return;
  focusLost = false;
  player.setMaster(masterState.muted ? 0 : masterState.value);
}
window.addEventListener('blur', onFocusLoss);
window.addEventListener('focus', onFocusBack);
document.addEventListener('visibilitychange', () => (document.hidden ? onFocusLoss() : onFocusBack()));

const PLAY_TITLES = { play: els.play.title, npPlay: els.npPlay.title };
function syncPlayButton() {
  wakeLoop(); // (playback can start without input: media keys, autoplay, a wait ending)
  const playing = player.playing || !!startDone || !!loopWait; // (the start delay shows the playing state)
  const restart = ended && !playing; // at the end of the song the play button restarts it
  const icon = playing ? '#i-pause' : restart ? '#i-replay' : '#i-play';
  const detailIcon = playing && !backgroundAudio() ? '#i-pause' : '#i-play'; // (the Listen card: the sound of another song is not its)
  els.play.querySelector('use').setAttribute('href', icon);
  els.play.setAttribute('aria-label', playing ? 'Pause' : restart ? 'Restart' : 'Play');
  els.play.title = restart ? 'Restart (Space)' : PLAY_TITLES.play;
  els.npPlay.querySelector('use').setAttribute('href', detailIcon);
  els.npPlay.title = restart ? 'Restart' : PLAY_TITLES.npPlay;
  els.infoPlay.querySelector('use').setAttribute('href', restart ? '#i-replay' : '#i-play');
  els.infoPlay.querySelector('span').textContent = restart ? 'Restart' : 'Play';
  setImmersive();
}

// ---------- End of song ----------
// When playback reaches the end by itself the song is "ended": the play buttons turn into Restart and, with the setting
// general.endScreen, a glass window (#endScreen) replaces the fretboards: facts about each instrument on screen (songstats.js) and a few
// songs to play next (recommend.js). Any seek (the player's onSeek hook), a restart, Play or a song change clears the state; Esc only
// hides the window (the buttons stay Restart). The canvas is hidden by CSS (.song-ended), so the background visualizer keeps running.
let ended = false;
let endDismissed = false;
let endShown = false;
const NEXT_COUNT = 20;
player.onSeek = () => { cancelLoopWait(); loopHeld = false; metronome.reset(); setEnded(false); cancelStartWait(); if (!internalSeek) clearRewind(); }; // (a seek of the user ends a rewind; the rewind's own seek does not)

function setEnded(on) {
  if (ended === on) return;
  ended = on;
  endDismissed = false;
  syncEndScreen();
  syncPlayButton();
}

// Restarts from the beginning, or from the start of the loop, and plays.
async function restartSong() {
  if (!chart) return;
  clearPreview();
  if (infoOpen) setInfoOpen(false);
  if (!(await ensureAudio())) return;
  setEnded(false);
  player.seek(loop ? loop.start : 0);
  // from the beginning it is a fresh Play: the start delay and the info overlay apply (not when it restarts a loop)
  const plan = startPlan({
    fresh: !loop, delay: prefs.get('playback.startDelay'), overlayOn: prefs.get('playback.songInfoOverlay'), keep: prefs.get('playback.keepSongInfo'), firstOfSong: !current.startShown,
  });
  if (plan.show) showSongInfo(plan.delay > 0 ? null : plan.hideMs);
  if (plan.delay > 0) { await startAfterDelay(plan); return; }
  await player.play();
  syncPlayButton();
}

function syncEndScreen() {
  const show = ended && !endDismissed && !!chart && !!current && !infoOpen && prefs.get('general.endScreen');
  if (show === endShown) return;
  endShown = show;
  els.endScreen.hidden = !show;
  els.app.classList.toggle('song-ended', show);
  highway.invalidate();
  wakeUp();
  if (!show) return;
  closePopovers();
  els.paneMenu.hidden = true;
  buildEndScreen();
  els.endScreen.querySelector('.end-scroll').scrollTop = 0;
  if (!/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) els.endAgain.focus({ preventScroll: true });
}

function endCard(it) {
  const card = document.createElement('div');
  card.className = 'end-inst';
  const head = document.createElement('div');
  head.className = 'end-inst-head';
  head.innerHTML = `<svg><use href="#i-${it.icon}"/></svg><strong></strong><span class="end-diff"></span>`;
  head.querySelector('strong').textContent = it.name;
  const diff = head.querySelector('.end-diff');
  diff.textContent = it.diffLabel;
  diff.hidden = !it.diffLabel;
  const dl = document.createElement('dl');
  dl.className = 'end-facts';
  dl.append(...kv(factRows(chartFacts(it.chart), { base: it.base })));
  card.append(head, dl);
  return card;
}

list.bindTip(els.endNext); // the instrument icons of the suggestions show the same hover tip (name and difficulty) as in the library
function endRow(song, reason) {
  const li = list.cardFor(song, (picked) => playNext(picked)); // the library's own song card (its style and what it shows)
  li.title = `${plainText(song.title)} - ${plainText(song.artist)}${reason ? ` (${reason})` : ''}`;
  return li;
}

function buildEndScreen() {
  const song = current.song;
  els.endTitle.textContent = plainText(song.title);
  els.endArtist.textContent = [plainText(song.artist), plainText(song.album)].filter(Boolean).join(' · ');
  els.endCover.src = current.coverUrl || '';
  els.endCover.hidden = !current.coverUrl;
  const screen = [...(current.screen || [])].sort((a, b) => Number(!!b.active) - Number(!!a.active));
  els.endCards.replaceChildren(...screen.map(endCard));
  els.endCards.hidden = screen.length === 0;
  const parts = [...new Set(screen.map((it) => (it.base === 'harmony' ? 'vocals' : it.base)))];
  const picks = recommend(song, songs, { count: NEXT_COUNT, instruments: parts });
  els.endNext.replaceChildren(...picks.map((r) => endRow(r.song, r.reason)));
  els.endNextBox.hidden = picks.length === 0;
}

// A recommended song: opened with the same instruments and difficulties where it has them, and played.
let playingNext = false; // a second click while the first is opening its song is ignored
async function playNext(song) {
  if (playingNext || !current) return;
  playingNext = true;
  try {
    await playNextNow(song);
  } finally {
    playingNext = false;
  }
}
async function playNextNow(song) {
  pendingInstruments = [...(current.screen || [])].sort((a, b) => Number(!!b.active) - Number(!!a.active)).map((it) => ({ id: it.optionId, diff: it.diffId, base: it.base }));
  loadAudioWithSong = false;
  await selectSong(song);
  if (chart && current?.song === song && !prefs.get('general.autoplay')) togglePlay(); // (that setting already starts it)
}

// "View my library": the song is closed (audio unloaded, chart and player UI gone) and the library window is what is left
function closeSong() {
  clearRewind();
  cancelStartWait();
  hideSongInfo();
  infoShownFor = null;
  if (liveStage?.coverUrl?.startsWith('blob:')) URL.revokeObjectURL(liveStage.coverUrl);
  setLiveStage(null);
  if (infoOpen) setInfoOpen(false, { grow: false, release: false });
  loadToken++; // a load in flight is dropped
  player.pause();
  setEnded(false);
  endDismissed = false;
  player.unload();
  ready = false;
  setLoop(null);
  audioLoad = null;
  const oldCover = current?.coverUrl;
  current = null;
  chart = null;
  if (oldCover) { // the cover's object URL is released once nothing shows it
    for (const img of [els.cover, els.infoCover, els.infoPopCover, els.endCover]) { img.removeAttribute('src'); img.hidden = true; }
    if (oldCover.startsWith('blob:')) URL.revokeObjectURL(oldCover);
  }
  highway.paneOpts = {};
  highway.setCharts([]);
  // the stage is "never played" again: no bar until the next song plays
  holdStage = false;
  loadingBackdrop = 0;
  stageEverLive = false;
  dropGhost();
  els.app.classList.remove('stage-held', 'stage-loading', 'stage-reveal');
  els.app.classList.add('stage-unborn');
  showPlayInfo(false);
  els.welcome.hidden = false;
  setLoadState('idle', '', 0);
  syncPlayButton();
  syncEndScreen();
  history.replaceState(null, '', '#/');
  document.title = 'YARG Remote';
  renderList({ keepScroll: true }); // (the loaded song is no longer highlighted)
  setLibraryOpen(true);
  setTimeout(() => { els.search.focus(); els.search.select(); }, 0); // (after the click handler that drops focus from clicked buttons)
}
els.endAgain.addEventListener('click', () => restartSong());
els.endSearch.addEventListener('click', () => closeSong());

// ---------- 2D / 3D view ----------
function setView(view) {
  highway.setView(view);
  highway.clearPaneOpt(null, 'view'); // a global choice (the V key, the settings) applies to every window again
  for (const b of els.viewChoice.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  if (prefs.get('highway.view') !== view) prefs.set('highway.view', view); // the last choice is the default
}
setView(prefs.get('highway.view'));
// In the instrument menu, the view and the note shape belong to that window only.
els.viewChoice.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  if (menuKey) { highway.setPaneOpt(menuKey, 'view', b.dataset.view); syncMenuView(); } else setView(b.dataset.view);
});

// ---------- Vocal view: notes with lyrics, or karaoke (the lyrics alone) ----------
function setVocalView(view) {
  highway.setVocalView(view);
  for (const b of document.querySelectorAll('[data-vocal]')) { b.setAttribute('aria-pressed', String(b.dataset.vocal === view)); if ('next' in b.dataset) b.dataset.next = String(b.dataset.vocal === view); } // (also the tiles' selectors)
  if (prefs.get('highway.vocalView') !== view) prefs.set('highway.vocalView', view);
}
setVocalView(prefs.get('highway.vocalView'));
els.vocalChoice.addEventListener('click', (e) => { const b = e.target.closest('[data-vocal]'); if (b) setVocalView(b.dataset.vocal); });

// ---------- Instrument tags: a tag over every chart opens a menu for that instrument ----------
// The charts are canvas drawings, so the tags are real buttons that follow the rectangles the highway reports (paneRects).
const paneTags = new Map();
let menuKey = null; // the instrument whose menu is open
const seenTags = new Set(); // (reused: one Set per frame was garbage)
function syncPaneTags() {
  const seen = seenTags;
  seen.clear();
  const rects = highway.paneRects;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
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
      const bx = Math.round(r.x + 8);
      const by = Math.round(r.y + 8);
      const bw = Math.round(r.w - 16);
      const bh = Math.round(r.h - 16);
      if (box._bx !== bx || box._by !== by || box._bw !== bw || box._bh !== bh) { // (numbers compared, no string per frame)
        Object.assign(box.style, { left: `${bx}px`, top: `${by}px`, width: `${bw}px`, height: `${bh}px` });
        box._bx = bx; box._by = by; box._bw = bw; box._bh = bh;
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
    if (el._key !== r.key) { el.dataset.key = r.key; el._key = r.key; }
    if (el._icon !== r.icon) { el.querySelector('use').setAttribute('href', `#i-${r.icon}`); el._icon = r.icon; }
    if (el._label !== r.label) { el.querySelector('span').textContent = r.label; el.title = r.label; el.setAttribute('aria-label', r.label); el._label = r.label; el._w = 0; }
    if (!el._w) el._w = el.offsetWidth; // measured when the label changes, not every frame
    const tx = Math.round(r.x + r.w - 8 - el._w); // the top right corner of its window
    const ty = Math.round(r.y + 8);
    if (el._tx !== tx || el._ty !== ty) { el.style.transform = `translate(${tx}px, ${ty}px)`; el._tx = tx; el._ty = ty; }
    const open = menuKey === r.key && !els.paneMenu.hidden;
    if (el._open !== open) { el.setAttribute('aria-expanded', String(open)); el._open = open; }
  }
  paneTags.forEach(dropGoneTag); // (forEach with a module function: for-of over a Map made an entry array per tag per frame)
  chooserEls.forEach(dropGoneChooser);
}
function dropGoneTag(el, key) { if (!seenTags.has(key)) { el.remove(); paneTags.delete(key); } }
function dropGoneChooser(el, key) { if (!seenTags.has(key)) { el.remove(); chooserEls.delete(key); } }

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
function openChooser(at, auto = false) { // auto: opened by the app because no instrument is on screen (it cannot be cancelled: there is nothing to go back to)
  current.chooserSeq = (current.chooserSeq ?? 0) + 1;
  current.choosers.push({ id: current.chooserSeq, at, modes: {}, auto });
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
  head.querySelector('.pc-cancel').hidden = !!chooser.auto;
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
    card.dataset.key = group.key;
    card.dataset.active = 'false'; // (not on screen: the tile of an instrument that can be added)
    const top = document.createElement('button');
    top.type = 'button';
    top.className = 'icard-head';
    top.innerHTML = `<svg><use href="#i-${INSTRUMENT_ICON[ins.base] || 'music'}"/></svg><span class="icard-name"></span><span class="icard-dot" aria-hidden="true"></span>`;
    top.querySelector('.icard-name').textContent = group.label;
    top.addEventListener('click', () => pickInto(chooser, group, ins, chosen?.id));
    const row = document.createElement('div'); // the name with the song's level bar under it, like the details cards
    row.className = 'icard-top';
    row.append(top);
    const level = instrumentLevel(current.song, ins);
    if (level !== null) {
      const pips = document.createElement('span');
      pips.className = 'pips';
      pips.title = `Level ${level} of 6`;
      pips.replaceChildren(...Array.from({ length: 6 }, (_, i) => Object.assign(document.createElement('i'), { className: i < level ? 'on' : '' })));
      row.append(pips);
    }
    card.append(row);
    if (group.options.length > 1) { // the type
      const modes = document.createElement('div');
      modes.className = 'seg seg-modes';
      for (const o of group.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o.modeLabel ?? o.label;
        b.setAttribute('aria-pressed', String(o.id === ins.id));
        if (o.id === ins.id) b.dataset.next = 'true';
        b.addEventListener('click', () => { chooser.modes[group.key] = o.id; fillChooser(el, key); });
        modes.append(b);
      }
      card.append(modes);
    }
    if (ins.mode === 'vocals') card.append(vocalViewSeg());
    if (ins.mode !== 'vocals') {
      const seg = document.createElement('div');
      seg.className = 'seg seg-diffs';
      diffSegObserver.observe(seg);
      for (const d of diffs) {
        const b = document.createElement('button');
        b.type = 'button';
        setDiffLabel(b, d.label);
        b.setAttribute('aria-pressed', String(d.id === chosen?.id));
        if (d.id === chosen?.id) b.dataset.next = 'true';
        b.addEventListener('click', () => pickInto(chooser, group, ins, d.id));
        seg.append(b);
      }
      card.append(seg);
    }
    card.append(buildTileTools(group));
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

// A slider with a reset button, for an option that belongs to one window only (see Highway.setPaneOpt). `onChange` runs after every change.
function paneRange(group, name, min, max, step, def, fmtValue, onChange) {
  const box = document.createElement('div');
  box.className = 'pm-range';
  box.innerHTML = '<input type="range"><output></output><button class="icon small-icon reset" type="button" title="Reset" aria-label="Reset"><svg><use href="#i-reset"/></svg></button>';
  const input = box.querySelector('input');
  const out = box.querySelector('output');
  const reset = box.querySelector('button');
  Object.assign(input, { min, max, step });
  input.setAttribute('aria-label', name === 'neck' ? 'Neck speed' : 'Chart delay');
  const paint = () => {
    const v = highway.paneOpt(group.key, name);
    input.value = v;
    out.textContent = fmtValue(v);
    reset.disabled = Math.abs(v - def()) < 1e-9;
    paintRange(input, def());
    onChange?.();
  };
  input.addEventListener('input', () => { highway.setPaneOpt(group.key, name, Number(input.value)); paint(); });
  reset.addEventListener('click', () => { highway.clearPaneOpt(group.key, name); paint(); });
  paint();
  return box;
}
const NECK_FMT = (v) => `${v.toFixed(1)}×`;
const DELAY_FMT = (v) => { // 0 -> "0s", 0.35 -> ".35s", -0.4 -> "-.4s"
  const n = Math.abs(v) < 0.005 ? '0' : Math.abs(v).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace(/^0\./, '.');
  return `${v < -0.005 ? '-' : ''}${n}s`;
};

// The row of tools at the bottom of an instrument tile: volume, neck speed and chart delay open a small slider window; the view (2D / 3D) and the
// note shape (circles / rectangles) switch on the spot. All of them belong to that instrument's fretboard only (pane options and the stem volume).
const tilePop = document.createElement('div');
tilePop.className = 'popover tile-pop';
tilePop.hidden = true;
document.body.append(tilePop);
let tilePopBtn = null;
function closeTilePop() {
  if (tilePop.hidden) return;
  tilePop.hidden = true;
  tilePop.replaceChildren();
  dropMenuMixViews(); // (the volume rows registered themselves as views of the stems)
  tilePopBtn?.setAttribute('aria-expanded', 'false');
  tilePopBtn = null;
}
function openTilePop(btn, title, content) {
  const same = tilePopBtn === btn;
  closeTilePop();
  if (same) return;
  const label = document.createElement('b');
  label.className = 'tp-title';
  label.textContent = title ?? '';
  tilePop.replaceChildren(...(title ? [label, content] : [content]));
  tilePop.hidden = false;
  tilePopBtn = btn;
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  const w = tilePop.offsetWidth;
  const h = tilePop.offsetHeight;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
  const below = r.bottom + 6 + h <= window.innerHeight - 8;
  tilePop.style.left = `${left}px`;
  tilePop.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - 6 - h)}px`;
}
document.addEventListener('pointerdown', (e) => { if (!tilePop.hidden && !tilePop.contains(e.target) && !tilePopBtn?.contains(e.target)) closeTilePop(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !tilePop.hidden) { e.stopPropagation(); closeTilePop(); } }, true);
window.addEventListener('resize', closeTilePop);

// When the tool chips do not fit: the gaps between them shrink (6 px down to 2 px), then the values lose their unit (the last character: s, x, %), and only then an ellipsis cuts them.
const tileToolsObserver = new ResizeObserver((entries) => { for (const { target } of entries) fitTileTools(target); });
function fitTileTools(row) {
  const vals = [...row.querySelectorAll('.tile-tool')].map((b) => [b.querySelector('.tt-val'), b.dataset.full ?? '']);
  const textW = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
  const cut = () => [...row.children].some((b) => { // (fractional widths: a text a hair wider than its box is cut at the edge even when scrollWidth rounds it away)
    const v = b.querySelector('.tt-val');
    return b.scrollWidth > b.clientWidth || (v && v.textContent && textW(v) > v.getBoundingClientRect().width + 0.05);
  });
  for (const [el, full] of vals) el.textContent = full;
  row.style.gap = '';
  row.classList.remove('units-cut');
  if (!row.isConnected || !row.clientWidth || !cut()) return;
  for (let gap = 5; gap >= 2; gap--) { // first the space between the chips goes down to 2 px
    row.style.gap = `${gap}px`;
    if (!cut()) return;
  }
  for (const [el, full] of vals) if (/\D$/.test(full)) el.textContent = full.slice(0, -1);
  row.classList.add('units-cut'); // (and the icon moves 2 px closer to its value)
}
function buildTileTools(group) {
  const vocal = group.chosen.mode === 'vocals';
  const row = document.createElement('div');
  row.className = 'icard-tools';
  tileToolsObserver.observe(row);
  // A button: the icon with its current value under it (for the sliders), opening a small window.
  const tool = (icon, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile-tool';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = `<svg><use href="#i-${icon}"/></svg><span class="tt-val"></span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
    row.append(b);
    return b;
  };
  const text = (b, v) => { b.dataset.full = v; fitTileTools(row); };
  const membersNow = () => stemStates.filter((st) => stemGroup(st.stem.label) === group.key);
  const volText = () => {
    const owner = groupList.find((g) => g.members[0] && stemGroup(g.members[0].stem.label) === group.key) ?? membersNow()[0];
    return !owner ? '' : owner.muted ? 'Off' : `${Math.round(owner.value * 100)}%`;
  };
  const volume = tool('volume', 'Volume', (b) => {
    const content = menuVolume(group);
    if (content) openTilePop(b, `${group.label} volume`, content);
  });
  volume.refresh = () => { // (the stems may load after the tile was built: a song opened by a link)
    volume.disabled = !membersNow().length;
    text(volume, volText());
  };
  volume.refresh();
  tileVolumeRefresh.add(volume);
  const optTool = (icon, title, name, min, max, step, def, fmt) => {
    const b = tool(icon, title, () => openTilePop(b, `${group.label} ${title.toLowerCase()}`, paneRange(group, name, min, max, step, def, fmt, paint)));
    const paint = () => {
      const v = highway.paneOpt(group.key, name);
      text(b, name === 'delay' && Math.abs(v) < 0.005 ? '' : fmt(v)); // (no label for a delay of 0)
      b.dataset.mod = String(Math.abs(v - def()) > 1e-9);
    };
    paint();
    return b;
  };
  optTool('speed', 'Neck speed', 'neck', 0.5, 3, 0.1, () => highway.neck, NECK_FMT);
  optTool('clock', 'Chart delay', 'delay', -1, 1, 0.05, () => 0, DELAY_FMT);
  if (!vocal) { // the view (2D / 3D) and the note shape (circles / rectangles) share one window
    const view = tool('eye', 'Fretboard view', (b) => {
      const box = document.createElement('div');
      box.className = 'tp-segs';
      const seg = (name, items) => {
        const el = document.createElement('div');
        el.className = 'seg fret-seg';
        for (const [value, label, icon] of items) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.innerHTML = `<svg><use href="#i-${icon}"/></svg>`;
          btn.append(label);
          btn.setAttribute('aria-pressed', String(highway.paneOpt(group.key, name) === value));
          btn.addEventListener('click', () => {
            highway.setPaneOpt(group.key, name, value);
            for (const o of el.children) o.setAttribute('aria-pressed', String(o === btn));
            paintView();
          });
          el.append(btn);
        }
        return el;
      };
      box.append(seg('view', [['2d', '2D', 'view-normal'], ['3d', '3D', 'cube']]), seg('noteStyle', [['round', 'Circles', 'circle'], ['rect', 'Rectangles', 'shapes']]));
      openTilePop(b, `${group.label} view`, box);
    });
    const paintView = () => {
      const v = highway.paneOpt(group.key, 'view');
      const n = highway.paneOpt(group.key, 'noteStyle');
      view.title = view.ariaLabel = `View: ${v === '3d' ? '3D' : '2D'}, notes as ${n === 'rect' ? 'rectangles' : 'circles'}`;
    };
    paintView();
  }
  return row;
}
const tileVolumeRefresh = new Set(); // the volume buttons of the tiles on screen: they show the level, which the small window (or the mixer) can change
const refreshTileVolumes = () => setTimeout(() => { for (const b of tileVolumeRefresh) { if (b.isConnected) b.refresh(); else tileVolumeRefresh.delete(b); } }, 0);
document.addEventListener('input', refreshTileVolumes, true);
document.addEventListener('click', refreshTileVolumes, true);

function buildPaneMenu() {
  const host = els.paneMenuDyn;
  dropMenuMixViews();
  host.replaceChildren();
  if (!current) return;
  const groups = instrumentGroups();
  const group = groups.find((g) => g.key === menuKey);
  if (!group) { els.paneMenu.hidden = true; return; }
  const ins = group.chosen;
  const canClose = group.pinned || groups.some((g) => g.pinned);
  syncMenuView();
  // Only the vocal view (notes / karaoke) stays as its own section: the view and note shape of the lanes are in the tile's tools.
  for (const g of els.paneMenu.querySelectorAll('[data-needs]')) g.hidden = true; // (the vocal view is in the vocal tile)
  // The menu is the instrument's tile, like the one of the start screen and the details; its corner button opens a context menu: swap, remove, add.
  const free = hiddenGroups().length - current.choosers.length; // instruments with no slot yet
  const actions = [
    { label: 'Add instrument', enabled: free > 0, run: addPane },
    { label: 'Swap instrument', enabled: hiddenGroups().length > 0, run: () => swapPane(group) },
    { label: 'Remove instrument', enabled: true, danger: true, title: canClose ? '' : 'It is the only instrument on screen: choose another one', run: () => { if (canClose) { closePane(group); els.paneMenu.hidden = true; } else swapPane(group); } },
  ];
  host.append(buildInstrumentCard(group, { actions }));
  els.paneMenuActions.replaceChildren();
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
  highway.clearPaneOpt(null, 'noteStyle');
  for (const b of els.noteChoice.querySelectorAll('[data-note]')) b.setAttribute('aria-pressed', String(b.dataset.note === style));
  if (prefs.get('highway.noteStyle') !== style) prefs.set('highway.noteStyle', style);
}
setNoteStyle(prefs.get('highway.noteStyle'));
els.noteChoice.addEventListener('click', (e) => {
  const b = e.target.closest('[data-note]');
  if (!b) return;
  if (menuKey) { highway.setPaneOpt(menuKey, 'noteStyle', b.dataset.note); syncMenuView(); } else setNoteStyle(b.dataset.note);
});
// The pressed state of the view and shape buttons for the window the menu is open on.
function syncMenuView() {
  if (!menuKey) return;
  const view = highway.paneOpt(menuKey, 'view');
  const style = highway.paneOpt(menuKey, 'noteStyle');
  for (const b of els.viewChoice.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  for (const b of els.noteChoice.querySelectorAll('[data-note]')) b.setAttribute('aria-pressed', String(b.dataset.note === style));
}

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
function setBarHidden(hidden, persist = true) {
  els.app.classList.toggle('bar-hidden', hidden);
  els.barHide.title = hidden ? 'Expand the top bar (B)' : 'Make the top bar compact (B)';
  els.barHide.setAttribute('aria-label', hidden ? 'Expand the top bar' : 'Make the top bar compact');
  if (persist) store.set('barHidden', hidden ? '1' : '0');
  closePopovers();
  alignStageButtons();
}
setBarHidden(prefs.get('highway.barHidden') === 'hidden' || (prefs.get('highway.barHidden') === 'last' && store.get('barHidden') === '1'));
els.barHide.addEventListener('click', () => setBarHidden(!els.app.classList.contains('bar-hidden'))); // compact <-> full

// ---------- Background visualizer ----------
// One animated background behind every fretboard (src/visualizers.js, Highway.setVisualizer). The picker is a popover from the
// tools row; the choice and its blur live in prefs (highway.visualizer, highway.visualizerBlur).
let vizSrc = null;
let vizAll = null; // the equalizer's source: every instrument of the song (the ones on screen are marked); null = rebuild
const vizSongInfo = () => {
  const ini = current.song.ini || {};
  return { title: plainText(current.song.title), artist: plainText(current.song.artist), genre: ini.genre, year: ini.year, length: (Number(ini.song_length) || 0) / 1000, bpmRange: bpmRange(current.midi?.tempos) };
};
// One layer per instrument group of the song (drums: the chosen mode; vocals: the lead and the harmony together), each with the chart at its chosen
// difficulty (cached for the song), and whether the group is on screen.
function buildVizAll() {
  const ini = current.song.ini || {};
  const cache = (current.vizCharts ??= new Map());
  const chartOf = (o, d) => {
    const k = `${o.id}:${d.id}`;
    if (!cache.has(k)) cache.set(k, buildChart(current.midi, o, d, ini));
    return cache.get(k);
  };
  const layers = instrumentGroups().map((g) => {
    const options = g.key === 'vocals' ? g.options : [g.chosen];
    const charts = options.map((o) => { const d = diffFor(o).chosen; return d ? chartOf(o, d) : null; }).filter(Boolean);
    return { g, charts };
  }).filter((l) => l.charts.length);
  if (!layers.length) return null;
  return {
    key: layers, coverUrl: current.coverUrl, song: vizSongInfo(),
    charts: layers.map((l) => l.charts[0]),
    kinds: layers.map((l) => INSTRUMENT_ICON[l.g.chosen.base] || 'music'),
    layerCharts: layers.map((l) => l.charts),
    shown: layers.map((l) => isOn(l.g)),
  };
}
const vizDriver = createVisualizerDriver({
  getSource() { // rebuilt only when the charts on screen change (setCharts makes a new panes array)
    if (!current || !highway.panes.length) return null;
    if (['equalizer', 'radial', 'spotlights', 'embers', 'aurora', 'warp'].includes(vizDriver.id) && !liveStage) { // the visualizers that follow the notes show every instrument of the song, the ones on screen highlighted
      vizAll ??= buildVizAll();
      if (vizAll) return vizAll;
    }
    if (vizSrc?.key !== highway.panes) {
      const ini = current.song.ini || {};
      vizSrc = {
        key: highway.panes, coverUrl: current.coverUrl,
        song: { title: plainText(current.song.title), artist: plainText(current.song.artist), genre: ini.genre, year: ini.year, length: (Number(ini.song_length) || 0) / 1000, bpmRange: bpmRange(current.midi?.tempos) },
        charts: highway.panes.map((p) => p.chart).filter(Boolean),
        kinds: highway.panes.filter((p) => p.chart).map((p) => p.icon), // (the instrument of each chart: the equalizer's layers)
      };
    }
    return vizSrc;
  },
});
highway.vizScale = () => vizDriver.scale; // the background canvas resolution follows the visualizer quality
let vizFps = 60; // how often the background is redrawn (the setting; Infinity = every screen frame)
highway.vizFps = () => vizFps;
const vizBtn = document.getElementById('visualizerBtn');
const vizPop = document.getElementById('visualizerPop');
// A slider row led by an icon instead of a text label (shown only when a visualizer is selected).
function vizSlider(icon, label, min, max, step, pref, unit = '') {
  const row = document.createElement('label');
  row.className = 'viz-level viz-slider';
  row.title = label;
  row.innerHTML = `<svg aria-hidden="true"><use href="#${icon}"/></svg><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}"><output></output>`;
  const input = row.querySelector('input');
  input.addEventListener('input', () => prefs.set(pref, Number(input.value)));
  return { row, input, output: row.querySelector('output'), pref, unit };
}
const vizBlur = vizSlider('i-blur', 'Blur', 0, 40, 1, 'highway.visualizerBlur', 'px');
const vizOpacity = vizSlider('i-opacity', 'Opacity', 0, 100, 1, 'highway.visualizerOpacity', '%');
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
vizFoot.append(vizOpacity.row, vizBlur.row, vizColor);
vizPop.replaceChildren(vizList, vizFoot);
// The visualizer's blur is a glass layer over the background canvas (CSS backdrop-filter, composited on the GPU) instead of
// a blur drawn into the canvas every frame; the chart canvas is above it, so the notes stay sharp.
function applyVizGlass() {
  const px = prefs.get('highway.visualizerBlur');
  const on = px > 0 && prefs.get('highway.visualizer') !== 'none';
  document.documentElement.style.setProperty('--viz-blur', `${px}px`);
  els.app.classList.toggle('viz-glass', on);
  highway.invalidate?.();
}
function syncVizPop() {
  const id = prefs.get('highway.visualizer');
  for (const row of vizPop.querySelectorAll('.prow')) {
    row.dataset.active = String(row.dataset.id === id);
    row.setAttribute('aria-selected', String(row.dataset.id === id));
  }
  for (const sl of [vizOpacity, vizBlur]) {
    sl.row.hidden = id === 'none';
    sl.input.value = prefs.get(sl.pref);
    sl.output.textContent = `${sl.input.value}${sl.unit}`;
  }
  const custom = prefs.get('highway.stageColorOn');
  vizColorInput.value = custom ? prefs.get('highway.stageColor') : themeStage;
  vizColor.querySelector('button').hidden = !custom;
}
// The opacity of the visualizer over the stage colour: the background canvas is made translucent (the stage colour is the CSS background behind it).
function applyVizOpacity() {
  document.documentElement.style.setProperty('--viz-opacity', String(prefs.get('highway.visualizerOpacity') / 100));
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
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else els.app.requestFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', setImmersive);
document.addEventListener('mousemove', wake);

// ---------- Keyboard ----------
// What each shortcut action does; the keys are in src/shortcuts.js and the `shortcuts.bindings` setting.
// Opens the library if it is closed and puts the cursor in its search box (the text is selected, so typing replaces it).
function focusSearch() {
  if (!libraryOpen()) setLibraryOpen(true);
  requestAnimationFrame(() => { els.search.focus({ preventScroll: true }); els.search.select(); });
}
const SHORTCUT_HANDLERS = {
  playPause: () => { if (liveStage) toggleBackground(); else if (chart) togglePlay(); },
  details: () => { if (current || loadInfo.state !== 'idle') setInfoOpen(!infoOpen); },
  search: () => focusSearch(),
  library: () => (libraryOpen() ? minimizeLibrary() : setLibraryOpen(true)),
  topBar: () => setBarHidden(!els.app.classList.contains('bar-hidden')),
  fullscreen: () => toggleFullscreen(),
  view3d: () => setView(highway.view === '3d' ? '2d' : '3d'),
  focusNext: () => highway.shiftFocus(1),
  focusPrev: () => highway.shiftFocus(-1),
  vocalView: () => { if (highway.panes.some((p) => p.chart.mode === 'vocals')) setVocalView(highway.vocalView === 'karaoke' ? 'track' : 'karaoke'); },
  perf: () => cyclePerfOverlay(),
  loop: () => { if (chart && !liveStage) toggleLoop(); },
  loopStart: () => setLoopHere('start'),
  loopEnd: () => setLoopHere('end'),
  metronome: () => prefs.set('audio.metronome', !prefs.get('audio.metronome')),
  speedDown: () => stepSpeed(-1),
  speedUp: () => stepSpeed(1),
  speedReset: () => stepSpeed(0),
  visualizerNext: () => cycleVisualizer(1),
  visualizerPrev: () => cycleVisualizer(-1),
  noteStyle: () => setNoteStyle(highway.noteStyle === 'rect' ? 'round' : 'rect'),
  prevSection: () => stepSection(-1),
  nextSection: () => stepSection(1),
  back5: () => { if (liveStage) player.seek(Math.max(0, player.currentTime() - 5)); else if (ready) seekTo(Math.max(0, player.currentTime() - 5)); },
  forward5: () => { if (liveStage) player.seek(Math.min(player.duration, player.currentTime() + 5)); else if (ready) seekTo(Math.min(player.duration, player.currentTime() + 5)); },
  settings: () => (settingsPage.isOpen() ? settingsPage.close() : settingsPage.open()),
};
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK' && !(typeof settingsPage !== 'undefined' && settingsPage.isOpen())) { e.preventDefault(); focusSearch(); return; } // Ctrl/Cmd+K: search
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target.tagName;
  // the seek bars keep the keyboard focus after a click: the app's shortcuts (Space, arrows) still apply there (other sliders, e.g. volumes, keep their arrows)
  const typing = (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) && !(e.target.type === 'range' && (e.target === els.seek || e.target === els.npSeek))) || e.target.isContentEditable;
  const action = actionFor(prefs.get('shortcuts.bindings'), comboOf(e));
  if (typeof settingsPage !== 'undefined' && settingsPage.isOpen()) { // the settings page owns the keyboard while it is open
    if (e.code === 'Escape' || (action === 'settings' && !typing)) { e.preventDefault(); settingsPage.close(); }
    return;
  }
  if (e.code === 'Escape') {
    if (pauseInfoShown && !pausePanelShown && popovers.every(([, pop]) => pop.hidden)) { piDismissed = true; syncPauseInfo(); return; } // the paused song window closes (the song stays paused)
    if (pausePanelShown && popovers.every(([, pop]) => pop.hidden)) { ppDismissed = true; syncPausePanel(); return; } // the quick settings close (the song stays paused); an open popover/menu goes first
    if (endShown && popovers.every(([, pop]) => pop.hidden)) { endDismissed = true; syncEndScreen(); els.play.focus({ preventScroll: true }); return; } // the end window goes, the fretboards come back
    if (popovers.every(([, pop]) => pop.hidden) && infoOpen) setInfoOpen(false); // details -> chart
    const open = popovers.find(([, pop]) => !pop.hidden);
    const owner = open && (open[1] === els.paneMenu ? document.querySelector('.pane-tag[aria-expanded="true"]') : open[0]);
    closePopovers();
    if (owner?.isConnected && owner.offsetParent !== null) owner.focus({ preventScroll: true }); // keyboard users land back on the button
    return;
  }
  if (typing) return;
  if (tag === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return; // those keys press the focused button
  const run = action && SHORTCUT_HANDLERS[action];
  if (!run) return;
  e.preventDefault();
  run();
});

// ---------- Frame loop (started once) ----------
// Jumps in the song (seeking, a section, a lyric line) are animated on the fretboards: the notes rush past to the new place
// instead of the chart snapping there. Only what the highway draws is eased; the clock, the sections and the audio use the real time.
let vis = { shown: null, last: null, anim: null, chart: null, step: 0 };
const MOTION_BLUR_MIN_STEP = 0.06; // seconds of song per frame from which the jump is blurred
const SEEK_JUMP_SEC = 0.75; // a bigger step between two frames than playback or a drag can make
const seekAnimMs = (dist) => Math.min(700, 280 + dist * 25); // longer for longer jumps, 0.7 s at most
let pendingSeekDur = null; // set by seekTo: the duration the audio scrub takes, so the fretboards' animation lasts the same
function visualChartTime(ct) {
  const now = performance.now();
  if (!motionPref('highway.seekAnimation') || vis.chart !== chart || vis.last === null) {
    vis = { shown: ct, last: ct, anim: null, chart, step: 0 };
    return ct;
  }
  if (Math.abs(ct - vis.last) > SEEK_JUMP_SEC) { // a jump: ease from where the chart is shown now
    const from = vis.anim ? vis.shown : vis.last;
    vis.anim = { from, t0: now, dur: pendingSeekDur ?? seekAnimMs(Math.abs(ct - from)) };
  }
  pendingSeekDur = null; // (a duration set for a jump that was too short to animate must not leak into a later one)
  vis.last = ct;
  const before = vis.shown;
  if (vis.anim) {
    const p = (now - vis.anim.t0) / vis.anim.dur;
    if (p >= 1) { vis.anim = null; vis.shown = ct; } else vis.shown = vis.anim.from + (ct - vis.anim.from) * (1 - (1 - p) ** 3); // ease-out: fast, then settles
  } else vis.shown = ct;
  vis.step = vis.shown - before; // how far the drawn time moved this frame
  return vis.shown;
}

// Idle redraws: when the music is paused and nothing moves (no seek animation, no visualizer, no pointer or key activity for a few
// seconds, no change to the highway), the picture would be identical, so most frames skip the whole draw. Anything that can change it
// wakes the loop: user input (any event below), a change to the highway's state (`highway.dirtyAt`), a new time, or a new canvas size.
// A slow refresh (IDLE_REFRESH_MS) still runs, to catch what no event announces (a hover tooltip delay, lyric sheet easing).
const IDLE_AFTER_MS = 3000;
const IDLE_REFRESH_MS = 250;
let lastInputAt = performance.now();
const wakeUp = () => { lastInputAt = performance.now(); wakeLoop(); };
for (const type of ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'input', 'change', 'click', 'touchstart', 'dragover', 'drop']) document.addEventListener(type, wakeUp, { capture: true, passive: true });
for (const type of ['resize', 'hashchange', 'popstate', 'focus', 'visibilitychange']) window.addEventListener(type, wakeUp);
const lastDraw = { at: -Infinity, t: NaN, w: 0, h: 0, dpr: 0, panes: null, chart: null };
function canSkipDraw(now, t) {
  if (player.playing || vis.anim || seeking || perfMode !== 'off') return false;
  if (now - Math.max(lastInputAt, highway.dirtyAt) < IDLE_AFTER_MS || now - lastDraw.at >= IDLE_REFRESH_MS) return false;
  const c = els.highway;
  return lastDraw.t === t && lastDraw.w === c.clientWidth && lastDraw.h === c.clientHeight && lastDraw.dpr === window.devicePixelRatio && lastDraw.panes === highway.panes && lastDraw.chart === chart;
}
// Deep idle: on top of the idle conditions above, nothing that animates by itself (no visualizer, no loading backdrop, no start/resume/loop wait).
// The loop then ticks at IDLE_REFRESH_MS on a timer instead of every display frame (the refresh it would draw anyway), and any input,
// `highway.invalidate()` or play-button change wakes it at once (`wakeLoop`).
function idleDeep(now) {
  return !player.playing && !vis.anim && !seeking && perfMode === 'off' && !highway.visualizer && !holdStage && !loadingBackdrop
    && !startDone && !resumeTimer && !loopWait && now - Math.max(lastInputAt, highway.dirtyAt) >= IDLE_AFTER_MS;
}
function wakeLoop() {
  if (!frameSleep) return;
  clearTimeout(frameSleep);
  frameSleep = 0;
  requestAnimationFrame(frame);
}
function noteDraw(now, t) {
  const c = els.highway;
  const d = lastDraw; // (one object, updated in place)
  d.at = now; d.t = t; d.w = c.clientWidth; d.h = c.clientHeight; d.dpr = window.devicePixelRatio; d.panes = highway.panes; d.chart = chart;
}

let lastClock = null; // the previous frame's music time and timestamp, for the clock jitter meter

// Errors in the frame loop must not stop it: the next frame is scheduled first, every part runs under `guarded`, and a
// failure is reported (console + a small toast) once per distinct message, then at most every 5 s.
const frameErrorGate = createErrorGate(5000);
let errorToast = null;
function reportFrameError(part, err) {
  const message = `${part}: ${err?.message || err}`;
  if (!frameErrorGate(message, performance.now())) return;
  console.error(`Frame loop error in ${part}:`, err);
  try {
    if (!errorToast) {
      errorToast = document.createElement('div');
      errorToast.setAttribute('role', 'status');
      errorToast.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;max-width:90vw;padding:8px 14px;border-radius:8px;background:rgba(40,10,10,.92);color:#fff;font:13px system-ui,sans-serif;pointer-events:none;transition:opacity .3s';
      document.body.append(errorToast);
    }
    errorToast.textContent = `Something went wrong (${message}). See the console.`;
    errorToast.style.opacity = '1';
    clearTimeout(errorToast.hideTimer);
    errorToast.hideTimer = setTimeout(() => { errorToast.style.opacity = '0'; }, 5000);
  } catch { /* the toast is a courtesy */ }
}
function guarded(part, fn) {
  try { return fn(); } catch (err) { reportFrameError(part, err); }
}

function frame(frameTs) {
  // first, so nothing below can end the loop
  if (guarded('idle check', () => idleDeep(performance.now()))) frameSleep = setTimeout(() => { frameSleep = 0; requestAnimationFrame(frame); }, IDLE_REFRESH_MS);
  else requestAnimationFrame(frame);
  guarded('pause panel', syncPausePanel);
  guarded('pause info', syncPauseInfo);
  const frameStart = performance.now();
  if (frameTs) player.frameNow = frameTs; // the clock of this animation frame (vsync aligned)
  let drawMs = 0;
  const draw = (fn) => { if (holdStage) { if (loadingBackdrop) guarded('loading background', () => highway.drawBackground((performance.now() - loadingBackdrop) / 1000)); return; } const d0 = performance.now(); guarded('draw', fn); drawMs = performance.now() - d0; }; // (held: the fretboards keep the last picture)
  if (current && chart && !liveStage) {
    let t = guarded('clock', () => {
      let t = player.currentTime();
      if (loop && player.playing) {
        // Look-ahead: the audio restarts after the output latency, so asking a little early makes the new start audible
        // right when the old end would have been heard.
        const ahead = ((player.outputLatency || 0) + 0.01) * player.rate;
        if (shouldWrap(loop, loopPrev, t, ahead)) {
          const delay = prefs.get('playback.loopRestartDelay');
          if (delay > 0) holdAtLoopEnd(delay); else t = wrapLoop();
        }
      }
      loopPrev = t;
      const wantLoopEnd = loop ? loop.end : null; // (the notes after the end of a loop are disabled on the fretboards)
      if (highway.loopEnd !== wantLoopEnd) { highway.loopEnd = wantLoopEnd; highway.invalidate(); }
      if (replay && t >= replay.to) clearRewind(); // the song has passed the pause point: the stretch is live again
      if (previewStop != null && (!player.playing || t >= previewStop)) {
        if (player.playing) { player.pause(); syncPlayButton(); }
        clearPreview();
      }
      if (player.playing && t >= player.duration) { // the song ran out by itself
        player.pause();
        setEnded(true);
        syncPlayButton();
      }
      if (perfMode !== 'off' && player.playing && lastClock && Math.abs(t - lastClock.t) < SEEK_JUMP_SEC) perf.clock(((t - lastClock.t) - (((frameTs || frameStart) - lastClock.at) / 1000) * player.rate) * 1000); // steadiness of the music clock
      lastClock = { t, at: frameTs || frameStart };
      return t;
    });
    if (t === undefined) lastClock = null; // no reliable time this frame: skip the drawing, keep the loop (and the jitter meter) clean
    else {
      const chartTime = listenMode ? 0 : t - settings.chartDelay; // (listening only: the chart stays at its start)
      const shownTime = guarded('visual time', () => visualChartTime(chartTime)) ?? chartTime;
      if (vis.anim && Math.abs(vis.step) > MOTION_BLUR_MIN_STEP && motionPref('highway.motionBlur')) { // a fast jump: blur the motion
        const span = Math.max(-0.6, Math.min(0.6, vis.step * 0.85)); // the exposure: most of the frame, within limits
        draw(() => highway.renderBlur(Array.from({ length: 8 }, (_, k) => shownTime - span * (1 - k / 7))));
      } else if (canSkipDraw(frameStart, shownTime)) { // idle: the panes are unchanged; a visualizer behind them (own canvas) keeps moving
        if (highway.visualizer) draw(() => highway.drawBackground(shownTime));
      } else {
        draw(() => highway.render(shownTime));
        noteDraw(frameStart, shownTime);
      }
      guarded('pane tags', syncPaneTags);
      guarded('seek bar', () => { // (a failed render still lets the bar, the time and the section update)
        const index = chart.sections.length ? sectionIndexAt(chart.sections, chartTime) : -1;
        if (index >= 0) setActiveSection(index);
        if (seeking) paintSeek(t); // dragging: the thumb is in the user's hand, the fill goes on with the music
        else {
          const barT = t; // the bar is always at the real position: the thumb is already where the song went and only the fretboards travel there
          setSeekValue(barT);
          if (els.seekbox.classList.contains('animating') !== !!vis.anim) els.seekbox.classList.toggle('animating', !!vis.anim);
          paintSeek(vis.anim ? Math.max(0, Math.min(player.duration, shownTime + settings.chartDelay)) : barT); // the fill travels with the fretboards (the thumb is already at the target)
          setText(els.timeNow, fmt(barT));
        }
        if (infoOpen) { // the Listen card
          if (document.activeElement !== els.npSeek) els.npSeek.value = t;
          if (!audioLoad) setText(els.npTime, `${fmt(t)} / ${fmt(player.duration)}`); // (while loading the card shows the progress)
        }
      });
    }
  } else if (liveStage) { // another song's details are open: the song on the stage goes on (fretboards, bar, time)
    const t = player.currentTime();
    if (player.playing && t >= player.duration) { player.pause(); syncPlayButton(); }
    const chartTime = t - settings.chartDelay;
    draw(() => highway.render(chartTime));
    guarded('seek bar', () => {
      if (seeking) { paintSeek(t); return; }
      setSeekValue(t);
      paintSeek(t);
      setText(els.timeNow, fmt(t));
    });
  } else {
    if (player.playing && current && player.currentTime() >= player.duration) { player.pause(); syncPlayButton(); } // (a song that plays on in the background reached its end: nothing to show, the sound just stops)
    if (canSkipDraw(frameStart, 0)) {
      if (highway.visualizer) draw(() => highway.drawBackground(0));
    } else {
      draw(() => highway.render(0));
      noteDraw(frameStart, 0);
    }
    guarded('pane tags', syncPaneTags);
  }
  if (perfMode !== 'off') guarded('perf', () => { perf.frame(frameStart, drawMs); perfOverlay.tick(frameStart); }); // (no meters while the overlay is off)
}
requestAnimationFrame(frame);

// Assigns textContent only when it changed: setting the same text still replaces the text node (a DOM mutation every frame).
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

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
  const hidden = ['listen', 'instruments', 'adjust', 'volume', 'extra'].filter((s) => !prefs.get('details.sections').includes(s));
  info.dataset.hide = hidden.join(' ');
  info.dataset.layout = prefs.get('details.layout');
  info.dataset.cover = prefs.get('details.cover');
  info.dataset.quote = prefs.get('details.quote') ? 'on' : 'off';
  info.dataset.names = prefs.get('details.stemNames');
  info.classList.toggle('compact', prefs.get('details.compact'));
  layoutWindow(); // ("Max width" caps the details pane)
  if (current) renderMeta(current.song, current.midi); // the chips
}
// Metronome (src/metronome.js): clicks on the beat grid of the chart on screen, shifted by the chart delay like the notes
// (the chart is drawn at player time - delay, so beat b is heard at player time b + delay); out through the master gain.
const metronome = new Metronome({ ctx: player.ctx, destination: player.master, clock: () => player.metronomeClock(), beats: () => (liveStage ? null : chart?.beats), delay: () => settings.chartDelay });
function paintMetronome(on) {
  els.metronomeBtn.setAttribute('aria-pressed', String(on));
  els.metronomeBtn.title = on ? 'Metronome off (M)' : 'Metronome (M)';
}
// The bar's metronome button opens a small window with the metronome options (the M key and the pause panel still toggle it).
const metPop = document.getElementById('metronomePop');
{
  const title = document.createElement('div');
  title.className = 'pop-title';
  title.textContent = 'Metronome';
  const seg = (label, items, pref) => {
    const box = document.createElement('div');
    box.className = 'fp-group';
    box.innerHTML = `<span class="fp-label"></span><div class="seg fret-seg" role="group"></div>`;
    box.querySelector('.fp-label').textContent = label;
    const group = box.querySelector('.seg');
    for (const [value, text] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.value = String(value);
      b.textContent = text;
      b.addEventListener('click', () => prefs.set(pref, value));
      group.append(b);
    }
    return box;
  };
  const volume = document.createElement('label');
  volume.className = 'pp-row met-volume';
  volume.innerHTML = '<span>Volume</span><input type="range" min="0" max="100" step="5" aria-label="Metronome volume"><output></output>';
  volume.querySelector('input').addEventListener('input', (e) => prefs.set('audio.metronomeVolume', Number(e.target.value)));
  metPop.replaceChildren(title, seg('Status', [[true, 'On'], [false, 'Off']], 'audio.metronome'), volume, seg('Sound', itemById('audio.metronomeSound').options.map((o) => [o.value, o.label]), 'audio.metronomeSound'));
}
function syncMetPop() {
  const state = { 'audio.metronome': prefs.get('audio.metronome'), 'audio.metronomeSound': prefs.get('audio.metronomeSound') };
  const prefOf = (b) => (b.closest('.fp-group') === metPop.querySelectorAll('.fp-group')[0] ? 'audio.metronome' : 'audio.metronomeSound');
  for (const b of metPop.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(String(state[prefOf(b)]) === b.dataset.value));
  const vol = prefs.get('audio.metronomeVolume');
  metPop.querySelector('input').value = vol;
  metPop.querySelector('output').textContent = `${vol}%`;
}
popovers.push([els.metronomeBtn, metPop]);
registerPopover(els.metronomeBtn, metPop);
syncMetPop();
// Quick settings while paused (setting playback.pausePanel; rules in practice.js `pausePanelWanted`). The panel fades in 0.3 s after the user pauses and
// goes when the sound resumes, a seek (it clears `pausedAt`), a wait starts, Esc (stays closed until the next pause) or any other blocker; it reuses the
// bar's own functions (stepSpeed, the metronome setting, masterState/applyStem, togglePlay) and keeps no state of its own.
// The song information window while paused (setting playback.pauseInfo): the same window as at the start of a song, now with a Play button and the instruments as
// on/off buttons. It follows the same rules as the quick settings panel (pausePanelWanted) and gives way to that panel when it is enabled; it goes when the sound
// resumes, on a seek, on Esc (until the next pause) or when a blocker appears.
let pauseInfoShown = false;
let piDismissed = false;
// Also before the song was ever played (a link to a song opens it paused at the start): the same screen, with its Play button, until the first Play.
const preStartScreen = () => !!chart && !!current && !current.started && !startDone && !ended && !listenMode && player.currentTime() < 0.5;
function syncPauseInfo() {
  const pre = preStartScreen();
  const want = pausePanelWanted({
    enabled: prefs.get('playback.pauseInfo') && !prefs.get('playback.pausePanel'), pausedByUser: pausedAt !== null || pre, playing: player.playing, ready: ready || pre,
    waiting: !!(startDone || resumeTimer || loopWait), listen: listenMode, background: backgroundAudio(), liveStage: !!liveStage, ended, hidden: false, focusLost: false, // (it stays up when the window loses focus)
    overlayOpen: libraryOpen() || infoOpen || (typeof settingsPage !== 'undefined' && settingsPage.isOpen()), infoVisible: false, dismissed: piDismissed, // (the library, the details or the settings take its place)
  });
  if (pausedAt === null) piDismissed = false; // (the Esc applies to this pause only)
  if (want && pre && !current.kicked) { // decided when the song opens (a short grace for the browser to report the activation): a click or key later (to give the page the focus, say) must not start it
    current.preAt ??= performance.now();
    if (prefs.get('playback.linkAutoplay') && prefs.get('playback.songInfoOverlay') && navigator.userActivation?.hasBeenActive) {
      current.kicked = true; // opened from a link and the page has had a click or key: load the audio now, count 3 s and start
      togglePlay();
    } else if (performance.now() - current.preAt > 1500) current.kicked = true; // no activation by now: it waits for Play
  }
  if (want && !pauseInfoShown) {
    pauseInfoShown = true;
    showSongInfo(null); // (no timer: it stays until the sound resumes)
    els.songInfo.classList.add('paused');
    els.pauseDim.classList.add('show');
    els.songInfo.setAttribute('aria-hidden', 'false');
    fillInfoInsts(); // (now with the picker)
  } else if (!want && pauseInfoShown && startScreenOn) {
    pauseInfoShown = false; // (the start screen has taken the window over)
  } else if (!want && pauseInfoShown) {
    fadeOutInfo();
  }
}
let pausePanelShown = false;
let ppDismissed = false;
let ppTimer = 0;
function syncPausePanel() {
  if (!pausePanelShown && !ppTimer && !prefs.get('playback.pausePanel')) return;
  const basic = pausePanelWanted({
    enabled: prefs.get('playback.pausePanel'), pausedByUser: pausedAt !== null, playing: player.playing, ready, waiting: !!(startDone || resumeTimer || loopWait),
    listen: listenMode, background: backgroundAudio(), liveStage: !!liveStage, ended, hidden: document.hidden, focusLost,
    overlayOpen: infoOpen || (typeof settingsPage !== 'undefined' && settingsPage.isOpen()),
    infoVisible: els.songInfo.classList.contains('show') && !prefs.get('playback.keepSongInfo'), // (a fading overlay: the panel waits for it; a kept one is covered by the panel instead)
  });
  if (!basic) ppDismissed = false; // (the Esc applies to this pause only)
  const want = basic && !ppDismissed;
  if (want && !pausePanelShown && !ppTimer) ppTimer = setTimeout(() => { ppTimer = 0; pausePanelShown = true; syncPausePanel(); }, 300);
  if (!want) { clearTimeout(ppTimer); ppTimer = 0; }
  if (pausePanelShown && !want) pausePanelShown = false;
  const on = pausePanelShown;
  els.songInfo.classList.toggle('under-panel', on); // (a kept overlay hides while the panel is up)
  if (els.pausePanel.classList.contains('show') !== on) { els.pausePanel.classList.toggle('show', on); els.pausePanel.setAttribute('aria-hidden', String(!on)); }
  if (!on) return;
  const speed = SETTING_FORMAT.speed(settings.speed);
  if (els.ppSpeed.textContent !== speed) els.ppSpeed.textContent = speed;
  const met = prefs.get('audio.metronome');
  if (els.ppMetronome.getAttribute('aria-pressed') !== String(met)) { els.ppMetronome.setAttribute('aria-pressed', String(met)); els.ppMetronome.textContent = met ? 'On' : 'Off'; }
  const vol = masterState.muted ? 0 : masterState.value;
  if (Number(els.ppVolume.value) !== vol && document.activeElement !== els.ppVolume) els.ppVolume.value = vol;
  setText(els.ppVolVal, masterState.muted ? 'Muted' : `${Math.round(masterState.value * 100)}%`); // (runs every frame: an unconditional write dirtied layout)
}
els.ppSlower.addEventListener('click', () => stepSpeed(-1));
els.ppFaster.addEventListener('click', () => stepSpeed(1));
els.ppMetronome.addEventListener('click', () => prefs.set('audio.metronome', !prefs.get('audio.metronome')));
els.ppVolume.addEventListener('input', () => { masterState.value = Number(els.ppVolume.value); masterState.muted = false; applyStem(masterState); });
els.ppResume.addEventListener('click', () => togglePlay());
// A small note over the player for a moment (the speed after a shortcut).
let flashEl = null;
function flashNote(text) {
  if (!flashEl) {
    flashEl = document.createElement('div');
    flashEl.setAttribute('role', 'status');
    flashEl.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9998;padding:6px 14px;border-radius:8px;background:rgba(20,22,28,.9);color:#fff;font:600 14px system-ui,sans-serif;pointer-events:none;transition:opacity .25s;opacity:0';
    document.body.append(flashEl);
  }
  flashEl.textContent = text;
  flashEl.style.opacity = '1';
  clearTimeout(flashEl.hideTimer);
  flashEl.hideTimer = setTimeout(() => { flashEl.style.opacity = '0'; }, 1200);
}
// Speed in 5 % steps (YARG practice: song speed +-0.05); dir 0 = back to 1x.
function stepSpeed(dir) {
  const v = dir ? Math.min(2, Math.max(0.2, Math.round((settings.speed + dir * 0.05) * 100) / 100)) : 1;
  setSetting('speed', v);
  flashNote(`Speed ${SETTING_FORMAT.speed(v)}`);
}
const EFFECTS = {
  'audio.metronome': (v) => { metronome.setEnabled(v); paintMetronome(v); syncMetPop(); },
  'audio.metronomeVolume': (v) => { metronome.setVolume(v); syncMetPop(); },
  'audio.metronomeSound': (v) => { metronome.setSound(v); syncMetPop(); },
  'practice.trainer': (v) => { if (!v) stopTrainer(); else if (!trainer) beginTrainer(); },
  'practice.trainerStart': () => paintTrainer(), 'practice.trainerTarget': () => paintTrainer(), 'practice.trainerStep': () => paintTrainer(), 'practice.trainerPasses': () => paintTrainer(),
  'highway.lyricsAbove': (v) => { highway.sheetPeek = v / 100; },
  'highway.countdown': (v) => { highway.countdowns = v; },
  'highway.countdownColors': applyUiColors,
  'highway.countdownColor': applyUiColors,
  'highway.vocalColors': applyUiColors,
  'highway.vocalColor': applyUiColors,
  'highway.countdownUnit': (v) => { highway.countdownUnit = v; highway.invalidate(); },
  'highway.vocalView': (v) => { if (highway.vocalView !== v) setVocalView(v); },
  'highway.paneMin': (v) => highway.setPaneMin(v),
  'highway.view': (v) => { if (highway.view !== v) setView(v); },
  'highway.noteStyle': (v) => setNoteStyle(v),
  'perf.overlay': (v) => { perfMode = v === 'compact' || v === 'detailed' ? v : 'off'; perf.reset(); lastClock = null; perfOverlay.setMode(v); },
  'perf.position': (v) => perfOverlay.setPosition(v),
  'details.chips': applyDetails, 'details.cover': applyDetails, 'details.quote': applyDetails, 'details.sections': applyDetails,
  'details.layout': applyDetails, 'details.stemNames': applyDetails, 'details.maxWidth': applyDetails, 'details.compact': applyDetails,
  'library.cardStyle': (v) => { list.setMode(v); syncViewSeg(); },
  'library.sort': (v) => { if (els.sortBy.value !== v) els.sortBy.value = v; syncFilterUi(); renderList(); },
  'library.sortDesc': (v) => { sortDesc = v; renderList(); },
  'library.columns': applyColumns,
  'library.dividers': () => renderList(),
  'library.searchRelevance': () => renderList(),
  'library.rail': (v) => document.querySelector('.songs-wrap').classList.toggle('no-rail', !v),
  'library.thumbs': applyCards, 'library.cardScale': applyCards, 'library.iconSize': applyCards,
  ...Object.fromEntries(['compact.artist', 'compact.pack', 'normal.artist', 'normal.pack', 'normal.icons', ...Object.keys(DEFAULT_CARDS.large).map((k) => `large.${k}`)].map((k) => [`cards.${k}`, applyCards])),
  'theme.preset': applyThemeSetting,
  'theme.overrides': applyThemeSetting,
  'theme.saved': applyThemeSetting,
  'ui.radius': (v) => document.documentElement.style.setProperty('--radius', `${v}px`),
  'ui.font': (v) => document.documentElement.style.setProperty('--font', fontCss(v)),
  'highway.visualizer': (v) => { vizDriver.select(v); highway.setVisualizer(vizDriver.fn); applyVizGlass(); syncVizPop(); },
  'highway.visualizerQuality': (v) => { vizDriver.quality = { high: 1, medium: 0.6, low: 0.4 }[v] ?? 0.6; },
  'highway.visualizerFps': (v) => { vizFps = v === 'unlimited' ? Infinity : Math.max(1, Number(v) || 60); highway.invalidate(); },
  'highway.visualizerOpacity': () => { applyVizOpacity(); syncVizPop(); },
  'highway.visualizerBlur': () => { applyVizGlass(); syncVizPop(); },
  'highway.trackOpacity': (v) => { highway.trackOpacity = v / 100; },
  'highway.starPowerBand': (v) => { highway.starPowerBand = !!v; },
  'highway.fillBand': (v) => { highway.fillBand = !!v; },
  'highway.soloBand': (v) => { highway.soloBand = !!v; },
  'highway.breBand': (v) => { highway.breBand = v === 'pulse' && motionReduced() ? 'steady' : v; }, // (the pulse is flashing: reduced motion draws it steady)
  'highway.beatLines': (v) => { highway.beatLines = v; },
  'highway.laneStripes': (v) => { highway.laneStripes = !!v; },
  'highway.noteScale': (v) => { highway.noteSize = v / 100; },
  'highway.noteBase': (v) => { highway.noteBase = v / 100; },
  'highway.noteCut': (v) => { rebuildYNote(noteCutFraction(v)); highway.invalidate(); },
  'highway.sustainWidth': (v) => { highway.sustainWidth = v / 100; },
  'highway.kickBarHeight': (v) => { highway.kickBar = v / 100; },
  'highway.padLook': (v) => { highway.padLook = v / 100; },
  'highway.heldPulse': (v) => { highway.heldMotion = !!v; },
  'highway.lyricSize': (v) => { highway.lyricScale = v / 100; },
  'highway.lyricOutline': (v) => { highway.lyricOutline = !!v; },
  'highway.countdownMin': (v) => { highway.countdownMin = Number(v) || 9; },
  'highway.stageColorOn': () => { applyStage(); syncVizPop(); },
  'highway.stageColor': () => { applyStage(); syncVizPop(); },
  'ui.barPosition': (v) => { els.app.classList.toggle('bar-bottom', v !== 'top'); closePopovers(); },
  'general.endScreen': () => syncEndScreen(),
  'playback.songInfoOverlay': (v) => { if (!v) hideSongInfo(); },
  'playback.keepSongInfo': (v) => { if (!v && els.songInfo.classList.contains('show') && !startDone) scheduleInfoHide(INFO_FIRST_PLAY_MS); },
  'ui.animations': () => { document.documentElement.dataset.motion = motionPref('ui.animations') ? 'on' : 'off'; },
  'ui.reduceMotion': () => { EFFECTS['ui.animations'](); EFFECTS['highway.breBand'](prefs.get('highway.breBand')); },
  'highway.neck': (v) => setSetting('neck', v), // the starting neck speed; also what the tracks' own neck speed resets to
};
for (const [id, fn] of Object.entries(EFFECTS)) fn(prefs.get(id));
prefs.subscribe((id, value) => { wakeUp(); EFFECTS[id]?.(value); });
reduceQuery.addEventListener?.('change', (e) => { osReduceMotion = e.matches; EFFECTS['ui.reduceMotion'](); });

// The settings window is the second window of the shared frame: the same controller as the library's (same width, edges, motion, drawer).
const settingsFrame = createWindowFrame({
  el: document.getElementById('settingsPage'), prefs: winPrefs, container: () => stageEl.clientWidth || window.innerWidth, contentMax, minWidth: () => SETTINGS_MIN_W,
  label: 'Make the settings window narrower or wider',
});
const settingsPage = mountSettings({
  root: document.getElementById('settingsPage'), frame: settingsFrame, settings: prefs, sections: SECTIONS,
  onClose: () => { settingsFlag = false; syncPanelUi(); },
  onOpen: () => { settingsFlag = true; syncWindowInsets(); if (libraryOpen()) setLibraryOpen(false, false); if (infoOpen) setInfoOpen(false); syncPanelUi(); }, // (the list first, so it does not grow into the details' room; not remembered: the library comes back as it was at the next start)
  renderers: {
    'shortcuts.bindings': (host, ctx) => renderShortcuts(host, { ...ctx, notify: setStatus }),
    theme: (host, ctx) => renderThemeStudio(host, { ...ctx, prefersDark: () => darkQuery.matches, notify: setStatus }),
    'data.tools': (host, ctx) => renderDataTools(host, {
      ...ctx, notify: setStatus,
      extra: [{ label: 'Clear thumbnail cache', help: 'Album thumbnails are rebuilt as you scroll.', run: async () => { await clearThumbs(); return 'Thumbnail cache cleared; thumbnails are rebuilt as you scroll.'; } }],
    }),
  },
});
attachScrollThumb(document.querySelector('#settingsPage .sp-content')); // the same slim thumb as the details

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
  // (a link names ids; the pick of another song may only share the kind of instrument: drums in another mode, vocals for harmony)
  const seen = new Set();
  const known = (list || []).map((x) => {
    const o = current.options.find((c) => c.id === x.id) ?? (x.base ? current.options.find((c) => c.base === x.base) ?? (x.base === 'harmony' ? current.options.find((c) => c.mode === 'vocals') : null) : null);
    return o && !seen.has(o.id) && seen.add(o.id) ? { ...x, id: o.id } : null;
  }).filter(Boolean);
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
  if (route.view === 'play') { markStageLive(); setInfoOpen(false, { grow: false, release: false }); } // (the stage stays held until the audio of the link has loaded) // a /play link is the player: the bar shows, the library keeps its width
}
window.addEventListener('hashchange', openFromHash);
