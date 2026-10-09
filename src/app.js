import { parseMidi } from './midi.js';
import { DIFFICULTIES, instrumentOptions, availableDifficulties, buildChart, sectionIndexAt } from './chart.js';
import { MultiTrackPlayer } from './player.js';
import { Highway } from './highway.js';
import { walkHandle, entriesFromFileList, scanSongs, audioStemsOf, findCover, readBytes, serializeSongs, restoreSongs, restoreRemoteSongs } from './library.js';
import { songDelaySeconds, plainText } from './ini.js';
import { metaRows, extraRows, chartStats, bpmLabel, instrumentLevel, stemKind, stemBadge } from './songinfo.js';
import { saveLibrary, loadLibrary } from './store.js';
import { filterSongs, sortSongs, genresOf } from './songlist.js';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'app', 'library', 'toggleLibrary', 'closeLibrary', 'scrim', 'pick', 'resume', 'rescan', 'folderInput', 'status',
  'search', 'sortBy', 'sortDir', 'filterInstrument', 'filterGenre', 'count', 'songs', 'empty',
  'now', 'brand', 'cover', 'title', 'artist', 'chips', 'instrument', 'difficulty',
  'transport', 'play', 'back', 'forward', 'seekbox', 'seek', 'timeNow', 'timeTotal',
  'tools', 'sectionSelect', 'mixerBtn', 'mixerPop', 'partBtn', 'partPop', 'partText', 'partIcon', 'sectionBtn', 'sectionPop', 'sectionText', 'mixer', 'settingsBtn', 'settingsPop',
  'fullscreen', 'viewBtn', 'infoBtn', 'info', 'infoCover', 'infoTitle', 'infoArtist', 'infoQuote', 'infoMeta', 'instrumentCards',
  'mixerInfo', 'infoExtra', 'infoProgress', 'infoBar', 'infoState', 'infoClose', 'infoPlay', 'infoMenu',
  'stage', 'highway', 'loading', 'welcome', 'welcomeOpen',
].map((id) => [id, $(id)]));

for (const img of [els.cover, els.infoCover]) img.addEventListener('error', () => { img.hidden = true; });
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
let ready = false; // audio decoded and a chart built: playback is allowed
let infoOpen = false;
let loadInfo = { state: 'idle', text: '', fraction: 0 };
const settings = { speed: 1, neck: 1, chartDelay: 0 };
let remote = false; // library comes from server.mjs (/api/library); no folder permission needed
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
    setStatus(`"${data.rootName}" no servidor`);
    afterLibraryLoaded();
    return true;
  } catch {
    return false; // static hosting: no API
  }
}

async function rescanFolder() {
  if (remote) {
    setStatus('Atualizando…');
    await loadRemoteLibrary(true);
    return;
  }
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
  els.rescan.hidden = !connectedRoot && !remote;
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
    li.querySelector('.song-title').textContent = plainText(song.title);
    li.querySelector('.song-artist').textContent = plainText(song.artist);
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
  ready = false;
  current = null;
  chart = null;
  highway.setChart(null);
  renderList();
  if (narrow()) setLibraryOpen(false);

  els.welcome.hidden = true;
  showPlayInfo(true);
  els.title.textContent = plainText(song.title);
  els.artist.textContent = plainText(song.artist);
  els.cover.hidden = true;
  els.infoCover.hidden = true;
  els.instrument.replaceChildren();
  els.difficulty.replaceChildren();
  els.sectionSelect.replaceChildren(new Option('Sem seções', ''));
  els.sectionSelect.disabled = true;
  els.sectionBtn.disabled = true;
  els.sectionPop.replaceChildren();
  els.sectionText.textContent = 'Sem seções';
  els.instrumentCards.replaceChildren();
  els.mixerInfo.replaceChildren();
  els.mixer.replaceChildren();
  renderSongInfo(song);
  setInfoOpen(true); // the info screen opens right away and the load runs behind it
  setLoadState('loading', 'Lendo o chart…', 0.02);

  const midiEntry = song.files.get('notes.mid');
  if (!midiEntry) {
    setLoadState('error', 'Esta música não tem notes.mid (apenas .chart não é suportado nesta versão).');
    return;
  }
  let midi;
  try {
    midi = parseMidi(await readBytes(midiEntry));
  } catch (err) {
    if (token === loadToken) setLoadState('error', `Não foi possível ler notes.mid: ${err.message}`);
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
  for (const img of [els.cover, els.infoCover]) {
    img.src = coverUrl || '';
    img.hidden = !coverUrl;
  }

  current = { song, midi, coverUrl, options: instrumentOptions(midi), diffChoice: {}, statsCache: new Map() };
  renderMeta(song, midi); // adds the BPM chip
  renderList(); // highlight the loaded song
  fillInstrumentOptions();
  updateChart(); // the chart exists as soon as the MIDI is read; only playback waits for the audio
  const stems = audioStemsOf(song);
  buildMixer(stems);

  setLoadState('loading', 'Carregando áudio…', 0.1);
  let loaded = false;
  try {
    loaded = await player.load(stems, {
      delay: songDelaySeconds(song.ini),
      onProgress: (p) => {
        if (token === loadToken) setLoadState('loading', `Carregando áudio… ${Math.round(p * 100)}%`, 0.1 + p * 0.9);
      },
    });
  } catch (err) {
    if (token === loadToken) setLoadState('error', `Falha ao decodificar áudio: ${err.message}`);
    return;
  }
  if (token !== loadToken || !loaded) return;
  els.seek.max = player.duration.toFixed(2);
  els.timeTotal.textContent = fmt(player.duration);
  stemStates.forEach(applyStem); // volumes chosen while loading
  ready = true;
  setLoadState('ready', chart ? 'Pronto para tocar' : 'Nenhum instrumento jogável nesta música.', 1);
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

function setInfoOpen(open) {
  infoOpen = open;
  els.info.hidden = !open;
  els.app.classList.toggle('info-open', open); // the top bar is redundant while the info screen shows everything
  els.infoBtn.setAttribute('aria-pressed', String(open));
  closePopovers();
  renderLoadState();
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
  const rows = metaRows(song).filter((r) => r.label !== 'Artista'); // the artist is the subtitle
  const bpm = bpmLabel(midi?.tempos);
  if (bpm) rows.push({ label: 'BPM', value: bpm, icon: 'pulse' });
  els.infoMeta.replaceChildren(...rows.map((r) => {
    const li = document.createElement('li');
    li.className = 'chip';
    li.innerHTML = `<svg><use href="#i-${r.icon || 'info'}"/></svg><span class="chip-label"></span><span class="chip-value"></span>`;
    li.querySelector('.chip-label').textContent = r.label;
    li.querySelector('.chip-value').textContent = r.value;
    return li;
  }));
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
  const quote = plainText(song.ini?.loading_phrase);
  els.infoQuote.textContent = quote ? `“${quote}”` : '';
  els.infoQuote.hidden = !quote;
  renderMeta(song, null);
  els.instrumentCards.replaceChildren();
  const extras = extraRows(song);
  els.infoExtra.replaceChildren(...kv(extras));
  els.infoExtra.closest('details').hidden = extras.length === 0;
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

const INSTRUMENT_ICON = { guitar: 'guitar', bass: 'guitar', rhythm: 'guitar', keys: 'keys', drums: 'drum', vocals: 'mic', harmony: 'mic' };

function renderPickers() {
  if (!current) return;
  const activeId = els.instrument.value;
  if (activeId) current.diffChoice[activeId] = els.difficulty.value;
  // Vocal parts have a single chart: no difficulty buttons.
  els.instrumentCards.replaceChildren(...current.options.map((ins) => {
    const diffs = availableDifficulties(current.midi, ins);
    const vocal = ins.mode === 'vocals';
    const wanted = current.diffChoice[ins.id];
    const chosen = diffs.find((d) => d.id === wanted) || diffs[diffs.length - 1];
    const card = document.createElement('div');
    card.className = 'icard';
    card.dataset.active = String(ins.id === activeId);

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'icard-head';
    head.setAttribute('aria-pressed', String(ins.id === activeId));
    head.innerHTML = `<svg><use href="#i-${INSTRUMENT_ICON[ins.base] || 'music'}"/></svg><span class="icard-name"></span><span class="pips"></span>`;
    head.querySelector('.icard-name').textContent = ins.label;
    const level = instrumentLevel(current.song, ins);
    const pips = head.querySelector('.pips');
    if (level === null) pips.remove();
    else {
      pips.title = `Nível ${level} de 6`;
      pips.replaceChildren(...Array.from({ length: 6 }, (_, i) => Object.assign(document.createElement('i'), { className: i < level ? 'on' : '' })));
    }
    // The whole card selects the instrument (with its remembered difficulty); the difficulty buttons stop the click.
    card.addEventListener('click', () => selectInstrument(ins.id, chosen?.id));
    card.append(head);

    if (!vocal) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      for (const d of diffs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = d.label;
        btn.setAttribute('aria-pressed', String(ins.id === activeId && d.id === els.difficulty.value));
        btn.addEventListener('click', (e) => { e.stopPropagation(); selectInstrument(ins.id, d.id); });
        seg.append(btn);
      }
      card.append(seg);
    }
    if (chosen) {
      const dl = document.createElement('dl');
      dl.className = 'kv mini';
      dl.replaceChildren(...kv(cardStats(ins, chosen)));
      card.append(dl);
    }
    return card;
  }));
  renderPartMenu();
}

// Top-bar item: one chip for instrument + difficulty, opening a compact vertical list (icon, name, difficulty buttons).
function renderPartMenu() {
  const ins = currentInstrument();
  const diffLabel = DIFFICULTIES.find((d) => d.id === els.difficulty.value)?.label;
  els.partIcon.setAttribute('href', `#i-${ins ? INSTRUMENT_ICON[ins.base] || 'music' : 'music'}`);
  els.partText.textContent = !ins ? 'Sem instrumento' : ins.mode === 'vocals' || !diffLabel ? ins.label : `${ins.label} · ${diffLabel}`;
  els.partPop.replaceChildren(...(current?.options ?? []).map((o) => {
    const diffs = availableDifficulties(current.midi, o);
    const wanted = current.diffChoice[o.id];
    const chosen = diffs.find((d) => d.id === wanted) || diffs[diffs.length - 1];
    const active = o.id === els.instrument.value;
    const row = document.createElement('div');
    row.className = 'prow';
    row.dataset.active = String(active);
    row.innerHTML = `<svg><use href="#i-${INSTRUMENT_ICON[o.base] || 'music'}"/></svg><span class="prow-name"></span>`;
    row.querySelector('.prow-name').textContent = o.label;
    row.addEventListener('click', () => { selectInstrument(o.id, chosen?.id); closePopovers(); });
    if (o.mode !== 'vocals') {
      const seg = document.createElement('div');
      seg.className = 'seg compact';
      for (const d of diffs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = d.label[0]; // F, M, D, E
        btn.title = d.label;
        btn.setAttribute('aria-label', `${o.label}, ${d.label}`);
        btn.setAttribute('aria-pressed', String(active && d.id === els.difficulty.value));
        btn.addEventListener('click', (e) => { e.stopPropagation(); selectInstrument(o.id, d.id); closePopovers(); });
        seg.append(btn);
      }
      row.append(seg);
    }
    return row;
  }));
}

els.infoBtn.addEventListener('click', () => { if (current || loadInfo.state !== 'idle') setInfoOpen(!infoOpen); });
els.infoMenu.addEventListener('click', () => setLibraryOpen(!libraryOpen()));
els.infoClose.addEventListener('click', () => setInfoOpen(false));
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
  els.sectionText.textContent = sections.length ? sections[0].name : 'Sem seções';
}

function setActiveSection(index) {
  if (index === activeSection) return;
  activeSection = index;
  els.sectionText.textContent = chart?.sections[index]?.name ?? 'Sem seções';
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
let stemStates = []; // { stem, value, muted, views[] }: one state per stem, shown in the menu and on the info screen

function buildMixer(stems) {
  stemStates = stems.map((stem) => ({ stem, value: 1, muted: false, views: [] }));
  for (const container of [els.mixer, els.mixerInfo]) {
    container.replaceChildren(...stemStates.map(mixerRow));
  }
  stemStates.forEach(applyStem);
}

function mixerRow(st) {
  const row = document.createElement('div');
  row.className = 'mix-row';
  const kind = stemKind(st.stem.label);
  row.innerHTML = `
    <button class="stem-btn" type="button" aria-pressed="false"><svg><use href="#i-${kind}"/></svg><b class="badge"></b></button>
    <input type="range" min="0" max="1.5" step="0.01" value="1">
    <span class="mix-val">100%</span>
    <button class="icon small-icon reset" type="button" title="Restaurar volume" aria-label="Restaurar volume"><svg><use href="#i-reset"/></svg></button>`;
  const mute = row.querySelector('.stem-btn');
  mute.querySelector('.badge').textContent = stemBadge(st.stem.label);
  const view = { row, range: row.querySelector('input'), val: row.querySelector('.mix-val'), mute, reset: row.querySelector('.reset') };
  st.views.push(view);
  view.range.addEventListener('input', () => { st.value = Number(view.range.value); st.muted = false; applyStem(st); }); // moving the slider re-enables the track
  // Long press solos the stem (mutes all the others); a long press on the only active stem restores them all.
  let pressTimer = 0;
  let longPressed = false;
  mute.addEventListener('pointerdown', () => {
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { longPressed = true; soloStem(st); }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) mute.addEventListener(type, () => clearTimeout(pressTimer));
  mute.addEventListener('contextmenu', (e) => e.preventDefault());
  mute.addEventListener('click', () => {
    if (longPressed) { longPressed = false; return; } // the press already did its job
    st.muted = !st.muted;
    applyStem(st);
  });
  row.querySelector('.reset').addEventListener('click', () => { st.value = 1; st.muted = false; applyStem(st); });
  return row;
}

function soloStem(st) {
  const others = stemStates.filter((o) => o !== st);
  const alreadySolo = !st.muted && others.every((o) => o.muted);
  for (const o of others) o.muted = !alreadySolo;
  st.muted = false;
  stemStates.forEach(applyStem);
}

// The slider keeps its value while a stem is muted; every view of the stem is updated together.
function applyStem(st) {
  player.setVolume(st.stem.id, st.muted ? 0 : st.value);
  for (const v of st.views) {
    v.range.value = st.value;
    v.val.textContent = `${Math.round(st.value * 100)}%`;
    v.row.classList.toggle('muted', st.muted);
    v.mute.setAttribute('aria-pressed', String(st.muted));
    v.mute.title = `${st.stem.label} — ${st.muted ? 'ativar' : 'desativar'} (segure para solo)`;
    v.reset.disabled = st.value === 1 && !st.muted; // already at the default
    v.mute.setAttribute('aria-label', `${st.muted ? 'Ativar' : 'Desativar'} ${st.stem.label}`);
    v.range.setAttribute('aria-label', `Volume de ${st.stem.label}`);
  }
}

// Settings: one value each, shown by every [data-setting] slider (menu popover and info screen).
const SETTING_DEFAULTS = { speed: 1, neck: 1, chartDelay: 0 };
const SETTING_FORMAT = {
  speed: (v) => `${v.toFixed(2)}×`,
  neck: (v) => `${v.toFixed(1)}×`,
  // Chart delay: only the highway is shifted. Positive = notes arrive later than the audio.
  chartDelay: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} s`,
};
function setSetting(name, value) {
  settings[name] = value;
  for (const input of document.querySelectorAll(`[data-setting="${name}"]`)) input.value = value;
  for (const out of document.querySelectorAll(`[data-out="${name}"]`)) out.textContent = SETTING_FORMAT[name](value);
  for (const btn of document.querySelectorAll(`[data-reset="${name}"]`)) btn.disabled = value === SETTING_DEFAULTS[name];
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

const popovers = [[els.partBtn, els.partPop], [els.sectionBtn, els.sectionPop], [els.mixerBtn, els.mixerPop], [els.settingsBtn, els.settingsPop]];
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
  const left = Math.min(Math.max(8, b.right - width), window.innerWidth - width - 8);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${b.bottom + 8}px`;
  pop.style.maxHeight = `${Math.max(120, window.innerHeight - b.bottom - 16)}px`;
}
window.addEventListener('resize', () => closePopovers());
for (const [btn, pop] of popovers) {
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
    if (infoOpen) setInfoOpen(false); // starting from the info screen goes to the chart
    await player.play();
  }
  syncPlayButton();
}

function syncPlayButton() {
  const playing = player.playing;
  els.play.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  els.play.setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
  setImmersive();
}

// ---------- 2D / 3D view ----------
function setView(view) {
  highway.setView(view);
  els.viewBtn.setAttribute('aria-pressed', String(view === '3d'));
  els.viewBtn.title = view === '3d' ? 'Visão 2D (V)' : 'Visão 3D (V)';
  store.set('view', view);
}
setView(store.get('view') === '3d' ? '3d' : '2d');
els.viewBtn.addEventListener('click', () => setView(highway.view === '3d' ? '2d' : '3d'));

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
  if (e.code === 'Escape') {
    if (popovers.every(([, pop]) => pop.hidden) && infoOpen && loadInfo.state !== 'idle') setInfoOpen(false);
    closePopovers();
    return;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return;
  if (e.code === 'Space' && ready) { e.preventDefault(); togglePlay(); }
  else if (e.code === 'KeyI' && (current || loadInfo.state !== 'idle')) setInfoOpen(!infoOpen);
  else if (e.code === 'KeyL') setLibraryOpen(!libraryOpen());
  else if (e.code === 'KeyF') toggleFullscreen();
  else if (e.code === 'KeyV') setView(highway.view === '3d' ? '2d' : '3d');
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
