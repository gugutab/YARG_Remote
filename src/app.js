import { parseMidi } from './midi.js';
import { DIFFICULTIES, instrumentOptions, availableDifficulties, buildChart, sectionIndexAt } from './chart.js';
import { MultiTrackPlayer } from './player.js';
import { Highway } from './highway.js';
import { walkHandle, entriesFromFileList, scanSongs, audioStemsOf, readBytes, serializeSongs, restoreSongs } from './library.js';
import { songDelaySeconds } from './ini.js';
import { saveLibrary, loadLibrary } from './store.js';
import { filterSongs, sortSongs, genresOf } from './songlist.js';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'app', 'library', 'toggleLibrary', 'closeLibrary', 'scrim', 'pick', 'resume', 'rescan', 'folderInput', 'status',
  'search', 'sortBy', 'sortDir', 'filterInstrument', 'filterGenre', 'count', 'songs', 'empty',
  'now', 'brand', 'cover', 'title', 'artist', 'chips', 'instrument', 'difficulty',
  'transport', 'play', 'back', 'forward', 'seekbox', 'seek', 'timeNow', 'timeTotal',
  'tools', 'sectionSelect', 'mixerBtn', 'mixerPop', 'mixer', 'settingsBtn', 'settingsPop',
  'speed', 'speedVal', 'neck', 'neckVal', 'chartDelay', 'chartDelayVal', 'resetSettings', 'fullscreen',
  'stage', 'highway', 'loading', 'welcome', 'welcomeOpen',
].map((id) => [id, $(id)]));

const player = new MultiTrackPlayer();
const highway = new Highway(els.highway);
let songs = [];
let current = null; // { song, midi, coverUrl, options }
let connectedRoot = null; // folder handle of the library on screen, when it came from the File System Access API
let savedRecord = null; // folder and index stored from the last visit
let chart = null; // chart for the selected instrument and difficulty
let seeking = false;
let loadToken = 0; // bumped on every song selection, so a slow load cannot overwrite a newer one
let sortDesc = false;
let detached = false; // list restored from storage without file access (browsers without showDirectoryPicker)
let pendingSongId = null; // song clicked while detached; opened once the folder is picked again

const store = {
  get(key) { try { return localStorage.getItem(`yargremote.${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`yargremote.${key}`, value); } catch { /* storage unavailable */ } },
};

// ---------- Library panel ----------
function setLibraryOpen(open) {
  els.app.classList.toggle('lib-closed', !open);
  store.set('library', open ? '1' : '0');
  // Let the layout settle, then the canvas resizes itself on the next frame.
}
const narrow = () => window.matchMedia('(max-width: 700px)').matches;
const libraryOpen = () => !els.app.classList.contains('lib-closed');
setLibraryOpen(narrow() ? false : store.get('library') !== '0');
// The drawer overlay on narrow screens starts closed; entering that layout closes it.
window.matchMedia('(max-width: 700px)').addEventListener('change', (e) => { if (e.matches) setLibraryOpen(false); });
els.toggleLibrary.addEventListener('click', () => setLibraryOpen(!libraryOpen()));
els.closeLibrary.addEventListener('click', () => setLibraryOpen(false));
els.scrim.addEventListener('click', () => setLibraryOpen(false));
els.welcomeOpen.addEventListener('click', () => setLibraryOpen(true));

els.pick.addEventListener('click', pickFolder);
els.resume.addEventListener('click', reopenFolder);
els.rescan.addEventListener('click', rescanFolder);
els.folderInput.addEventListener('change', () => loadEntries(entriesFromFileList(els.folderInput.files)));
for (const el of [els.search, els.filterInstrument, els.filterGenre]) el.addEventListener('input', renderList);
els.sortBy.value = store.get('sortBy') || 'title';
els.sortBy.addEventListener('change', () => { store.set('sortBy', els.sortBy.value); renderList(); });
els.sortDir.addEventListener('click', () => {
  sortDesc = !sortDesc;
  renderList();
});
offerSavedFolder();

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
    if (err.name !== 'AbortError') setStatus(`Erro ao abrir pasta: ${err.message}`);
  }
}

// Scans a picked folder and remembers it, with its song index, for the next visit.
async function scanFolder(dir) {
  setStatus('Procurando músicas…');
  songs = await scanSongs(walkHandle(dir, dir.name));
  const saved = await saveLibrary({ root: dir, rootName: dir.name, index: serializeSongs(songs), savedAt: Date.now() });
  connectedRoot = dir;
  els.resume.hidden = true;
  setStatus(`"${dir.name}"${saved ? '' : ' (não foi possível guardar a pasta)'}`);
  afterLibraryLoaded();
}

// Reopens the remembered folder. Only the read permission is asked again, on this click.
async function reopenFolder() {
  if (!savedRecord) return;
  const { root, rootName, index } = savedRecord;
  try {
    const permission = await root.requestPermission({ mode: 'read' });
    if (permission !== 'granted') {
      setStatus('Sem permissão para ler a pasta. Escolha-a de novo.');
      return;
    }
  } catch (err) {
    setStatus(`Não foi possível reabrir a pasta: ${err.message}`);
    return;
  }
  songs = restoreSongs(index, root);
  connectedRoot = root;
  els.resume.hidden = true;
  setStatus(`"${rootName}" (lista guardada; use ⟳ se mudou algo)`);
  afterLibraryLoaded();
}

async function rescanFolder() {
  if (!connectedRoot) return;
  try {
    const permission = await connectedRoot.requestPermission({ mode: 'read' });
    if (permission !== 'granted') {
      setStatus('Sem permissão para ler a pasta. Escolha-a de novo.');
      return;
    }
    await scanFolder(connectedRoot);
  } catch (err) {
    setStatus(`Erro ao atualizar: ${err.message}`);
  }
}

async function loadEntries(entries) {
  setStatus('Procurando músicas…');
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
  els.rescan.hidden = !connectedRoot;
  const genres = genresOf(songs);
  els.filterGenre.replaceChildren(new Option('Gêneros', ''), ...genres.map((g) => new Option(g, g)));
  els.filterGenre.closest('label').hidden = genres.length === 0;
  renderList();
}

// On the first load, offer to reopen the folder from the last visit (no picker, one click).
async function offerSavedFolder() {
  savedRecord = await loadLibrary();
  if (!savedRecord) return;
  if (!savedRecord.root) {
    // No handle was stored: show the saved list now; the files are asked for when a song is opened.
    songs = savedRecord.index.map((s) => ({ ...s, files: new Map() }));
    detached = true;
    setStatus(`Lista guardada de "${savedRecord.rootName}". Escolha a pasta de novo ao abrir uma música.`);
    afterLibraryLoaded();
    return;
  }
  els.resume.querySelector('span').textContent = `Reabrir "${savedRecord.rootName}" (${savedRecord.index.length})`;
  els.resume.hidden = false;
}

function renderList() {
  const filters = { query: els.search.value, instrument: els.filterInstrument.value, genre: els.filterGenre.value };
  const shown = sortSongs(filterSongs(songs, filters), els.sortBy.value, sortDesc);
  els.sortDir.textContent = sortDesc ? 'Z→A' : 'A→Z';
  els.songs.replaceChildren(...shown.map((song) => {
    const li = document.createElement('li');
    li.className = current?.song === song ? 'active' : '';
    li.setAttribute('role', 'option');
    li.innerHTML = '<div class="song-title"></div><div class="song-artist"></div>';
    li.querySelector('.song-title').textContent = song.title;
    li.querySelector('.song-artist').textContent = song.artist;
    li.addEventListener('click', () => selectSong(song));
    return li;
  }));
  els.count.textContent = songs.length ? `${shown.length} de ${songs.length} músicas` : '';
  els.empty.hidden = songs.length > 0;
}

function setStatus(text) {
  els.status.textContent = text;
}

// ---------- Song and chart selection ----------
async function selectSong(song) {
  if (detached) {
    pendingSongId = song.id;
    setStatus('Escolha a pasta de músicas para abrir esta música.');
    els.folderInput.value = '';
    els.folderInput.click();
    return;
  }
  const token = ++loadToken;
  player.pause();
  syncPlayButton();
  current = null;
  chart = null;
  highway.setChart(null);
  renderList();
  if (narrow()) setLibraryOpen(false);

  els.welcome.hidden = true;
  els.loading.hidden = false;
  els.loading.textContent = 'Carregando…';
  showPlayInfo(true);
  els.title.textContent = song.title;
  els.artist.textContent = song.artist;
  els.cover.hidden = true;

  const midiEntry = song.files.get('notes.mid');
  if (!midiEntry) {
    els.loading.textContent = 'Esta música não tem notes.mid (apenas .chart não é suportado nesta versão).';
    return;
  }
  let midi;
  try {
    midi = parseMidi(await readBytes(midiEntry));
  } catch (err) {
    if (token === loadToken) els.loading.textContent = `Não foi possível ler notes.mid: ${err.message}`;
    return;
  }
  const coverEntry = ['album.jpg', 'album.png', 'album.jpeg'].map((n) => song.files.get(n)).find(Boolean);
  const coverUrl = coverEntry ? URL.createObjectURL(await coverEntry.getFile()) : null;
  if (token !== loadToken) {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    return;
  }
  if (els.cover.src.startsWith('blob:')) URL.revokeObjectURL(els.cover.src);
  els.cover.src = coverUrl || '';
  els.cover.hidden = !coverUrl;

  current = { song, midi, coverUrl, options: instrumentOptions(midi) };
  renderList(); // highlight the loaded song
  fillInstrumentOptions();
  buildMixer(audioStemsOf(song));

  try {
    await player.load(audioStemsOf(song), {
      delay: songDelaySeconds(song.ini),
      onProgress: (p) => {
        if (token === loadToken) els.loading.textContent = `Carregando áudio… ${Math.round(p * 100)}%`;
      },
    });
  } catch (err) {
    setStatus(`Falha ao decodificar áudio: ${err.message}`);
  }
  if (token !== loadToken) return;
  els.loading.hidden = true;
  els.seek.max = player.duration.toFixed(2);
  els.timeTotal.textContent = fmt(player.duration);
  updateChart();
}

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
  if (!chart) {
    els.loading.hidden = false;
    els.loading.textContent = 'Nenhum instrumento jogável nesta música.';
  }
}

els.instrument.addEventListener('change', () => { fillDifficultyOptions(); updateChart(); });
els.difficulty.addEventListener('change', updateChart);

function fillSectionOptions() {
  const sections = chart?.sections ?? [];
  els.sectionSelect.replaceChildren(...sections.map((s, i) => new Option(`${fmt(s.time)} · ${s.name}`, String(i))));
  els.sectionSelect.disabled = sections.length === 0;
  if (sections.length === 0) els.sectionSelect.replaceChildren(new Option('Sem seções', ''));
}

// The highway shows chart time t - delay, so seeking to a section needs the delay added back.
function seekToSection(i) {
  const section = chart?.sections[i];
  if (!section) return;
  player.seek(Math.max(0, section.time + Number(els.chartDelay.value)));
}
els.sectionSelect.addEventListener('change', () => seekToSection(Number(els.sectionSelect.value)));
els.back.addEventListener('click', () => stepSection(-1));
els.forward.addEventListener('click', () => stepSection(1));
function stepSection(dir) {
  if (!chart?.sections.length) return;
  const here = sectionIndexAt(chart.sections, player.currentTime() - Number(els.chartDelay.value));
  const sectionStart = chart.sections[here].time + Number(els.chartDelay.value);
  // "Previous" first returns to the start of the current section, as media players do.
  let target = here + dir;
  if (dir < 0 && player.currentTime() - sectionStart > 2) target = here;
  seekToSection(Math.min(Math.max(target, 0), chart.sections.length - 1));
}

// ---------- Mixer and settings ----------
function buildMixer(stems) {
  els.mixer.replaceChildren(...stems.map((stem) => {
    const row = document.createElement('label');
    row.className = 'mix-row';
    row.innerHTML = '<span class="mix-name"></span><input type="range" min="0" max="1.5" step="0.01" value="1"><span class="mix-val">100%</span>';
    row.querySelector('.mix-name').textContent = stem.label;
    row.querySelector('.mix-name').title = stem.label;
    const range = row.querySelector('input');
    const val = row.querySelector('.mix-val');
    range.addEventListener('input', () => {
      player.setVolume(stem.id, Number(range.value));
      val.textContent = `${Math.round(range.value * 100)}%`;
    });
    return row;
  }));
}

els.speed.addEventListener('input', () => {
  const rate = Number(els.speed.value);
  player.setRate(rate);
  els.speedVal.textContent = `${rate.toFixed(2)}×`;
});
// Chart delay: only the highway is shifted. Positive = notes arrive later than the audio.
els.chartDelay.addEventListener('input', () => {
  const d = Number(els.chartDelay.value);
  els.chartDelayVal.textContent = `${d >= 0 ? '+' : ''}${d.toFixed(2)} s`;
});
els.neck.addEventListener('input', () => {
  const neck = Number(els.neck.value);
  highway.setNeckSpeed(neck);
  els.neckVal.textContent = `${neck.toFixed(1)}×`;
});
els.resetSettings.addEventListener('click', () => {
  for (const [el, value] of [[els.speed, 1], [els.neck, 1], [els.chartDelay, 0]]) {
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }
});

const popovers = [[els.mixerBtn, els.mixerPop], [els.settingsBtn, els.settingsPop]];
function closePopovers(except) {
  for (const [btn, pop] of popovers) {
    if (pop === except) continue;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
}
for (const [btn, pop] of popovers) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePopovers(pop);
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', String(!pop.hidden));
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
}
document.addEventListener('click', (e) => {
  closePopovers();
  // Drop focus from clicked buttons so Space and the other shortcuts keep working afterwards.
  if (e.target.closest?.('button') && e.detail > 0) document.activeElement?.blur();
});

// ---------- Transport ----------
els.play.addEventListener('click', togglePlay);
els.seek.addEventListener('input', () => {
  seeking = true;
  els.timeNow.textContent = fmt(Number(els.seek.value));
});
els.seek.addEventListener('change', () => { player.seek(Number(els.seek.value)); seeking = false; });

async function togglePlay() {
  if (!current || !chart) return;
  if (player.playing) player.pause();
  else await player.play();
  syncPlayButton();
}

function syncPlayButton() {
  const playing = player.playing;
  els.play.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  els.play.setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
  setImmersive();
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
      if (els.mixerPop.hidden && els.settingsPop.hidden) els.app.classList.add('idle');
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
  if (e.code === 'Escape') { closePopovers(); return; }
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return;
  if (e.code === 'Space' && current) { e.preventDefault(); togglePlay(); }
  else if (e.code === 'KeyL') setLibraryOpen(!libraryOpen());
  else if (e.code === 'KeyF') toggleFullscreen();
  else if (e.code === 'BracketLeft') stepSection(-1);
  else if (e.code === 'BracketRight') stepSection(1);
  else if (e.code === 'ArrowLeft' && current) player.seek(Math.max(0, player.currentTime() - 5));
  else if (e.code === 'ArrowRight' && current) player.seek(Math.min(player.duration, player.currentTime() + 5));
});

// ---------- Frame loop (started once) ----------
function frame() {
  if (current && chart) {
    const t = player.currentTime();
    if (player.playing && t >= player.duration) {
      player.pause();
      syncPlayButton();
    }
    const chartTime = t - Number(els.chartDelay.value);
    highway.render(chartTime);
    const index = chart.sections.length ? sectionIndexAt(chart.sections, chartTime) : -1;
    if (index >= 0 && document.activeElement !== els.sectionSelect) els.sectionSelect.value = String(index);
    if (!seeking) {
      els.seek.value = t;
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
