import { parseMidi } from './midi.js';
import { DIFFICULTIES, instrumentOptions, availableDifficulties, buildChart, sectionIndexAt } from './chart.js';
import { MultiTrackPlayer } from './player.js';
import { Highway } from './highway.js';
import { walkHandle, entriesFromFileList, scanSongs, audioStemsOf, readBytes, serializeSongs, restoreSongs } from './library.js';
import { songDelaySeconds } from './ini.js';
import { saveLibrary, loadLibrary } from './store.js';

const $ = (id) => document.getElementById(id);
const els = {
  pick: $('pick'),
  resume: $('resume'),
  rescan: $('rescan'),
  folderInput: $('folderInput'),
  status: $('status'),
  search: $('search'),
  songs: $('songs'),
  empty: $('empty'),
  player: $('player'),
  cover: $('cover'),
  title: $('title'),
  artist: $('artist'),
  instrument: $('instrument'),
  difficulty: $('difficulty'),
  play: $('play'),
  seek: $('seek'),
  time: $('time'),
  speed: $('speed'),
  speedVal: $('speedVal'),
  neck: $('neck'),
  neckVal: $('neckVal'),
  chartDelay: $('chartDelay'),
  chartDelayVal: $('chartDelayVal'),
  sectionNow: $('sectionNow'),
  sectionSelect: $('sectionSelect'),
  loading: $('loading'),
  mixer: $('mixer'),
  highway: $('highway'),
};

const player = new MultiTrackPlayer();
const highway = new Highway(els.highway);
let songs = [];
let current = null; // { song, midi, coverUrl }
let connectedRoot = null; // folder handle of the library on screen, when it came from the File System Access API
let savedRecord = null; // folder and index stored from the last visit
let chart = null; // chart for the selected instrument and difficulty
let seeking = false;

els.sectionSelect.addEventListener('change', () => {
  const section = chart?.sections[Number(els.sectionSelect.value)];
  if (!section) return;
  // The highway shows chart time t - delay, so seek to the section's time plus the delay to show it on time.
  player.seek(section.time + Number(els.chartDelay.value));
});

els.pick.addEventListener('click', pickFolder);
els.resume.addEventListener('click', reopenFolder);
els.rescan.addEventListener('click', rescanFolder);
offerSavedFolder();
els.folderInput.addEventListener('change', () => loadEntries(entriesFromFileList(els.folderInput.files)));
els.search.addEventListener('input', renderList);
els.instrument.addEventListener('change', updateChart);
els.difficulty.addEventListener('change', updateChart);
els.play.addEventListener('click', togglePlay);
els.seek.addEventListener('input', () => { seeking = true; });
els.seek.addEventListener('change', () => { player.seek(Number(els.seek.value)); seeking = false; });
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
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && current && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
    e.preventDefault();
    togglePlay();
  }
});

// Folder selection: File System Access API when available, <input webkitdirectory> otherwise.
async function pickFolder() {
  if (!window.showDirectoryPicker) {
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
  setStatus(`${songs.length} música(s) em "${dir.name}".${saved ? '' : ' (não foi possível guardar a pasta)'}`);
  showLibraryButtons();
  renderList();
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
  setStatus(`${songs.length} música(s) em "${rootName}" (lista guardada). Use "Atualizar lista" se mudou algo.`);
  els.resume.hidden = true;
  showLibraryButtons();
  renderList();
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

function showLibraryButtons() {
  els.rescan.hidden = !connectedRoot;
}

async function loadEntries(entries) {
  setStatus('Procurando músicas…');
  songs = await scanSongs(entries);
  setStatus(`${songs.length} música(s) encontrada(s).`);
  renderList();
}

// On the first load, offer to reopen the folder from the last visit (no picker, one click).
async function offerSavedFolder() {
  savedRecord = await loadLibrary();
  if (!savedRecord?.root) return;
  els.resume.textContent = `Reabrir "${savedRecord.rootName}"`;
  els.resume.hidden = false;
  setStatus(`Pasta da última visita: "${savedRecord.rootName}" (${savedRecord.index.length} música(s)).`);
}

function renderList() {
  const q = els.search.value.trim().toLowerCase();
  const filtered = songs.filter((s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q));
  els.songs.replaceChildren(...filtered.map((song) => {
    const li = document.createElement('li');
    li.className = current?.song === song ? 'active' : '';
    li.innerHTML = '<div class="song-title"></div><div class="song-artist"></div>';
    li.querySelector('.song-title').textContent = song.title;
    li.querySelector('.song-artist').textContent = song.artist;
    li.addEventListener('click', () => selectSong(song));
    return li;
  }));
  els.empty.hidden = songs.length > 0;
}

async function selectSong(song) {
  player.pause();
  renderList();
  els.player.hidden = false;
  els.title.textContent = song.title;
  els.artist.textContent = song.artist;
  els.loading.hidden = false;
  els.loading.textContent = 'Carregando áudio…';

  const midiEntry = song.files.get('notes.mid');
  if (!midiEntry) {
    els.loading.textContent = 'Esta música não tem notes.mid (apenas .chart não é suportado nesta versão).';
    return;
  }
  const midi = parseMidi(await readBytes(midiEntry));

  const coverEntry = ['album.jpg', 'album.png', 'album.jpeg'].map((n) => song.files.get(n)).find(Boolean);
  if (current?.coverUrl) URL.revokeObjectURL(current.coverUrl);
  const coverUrl = coverEntry ? URL.createObjectURL(await coverEntry.getFile()) : null;
  els.cover.src = coverUrl || '';
  els.cover.hidden = !coverUrl;

  current = { song, midi, coverUrl };
  fillInstrumentOptions(midi);
  buildMixer(audioStemsOf(song));

  try {
    await player.load(audioStemsOf(song), {
      delay: songDelaySeconds(song.ini),
      onProgress: (p) => {
        els.loading.textContent = `Carregando áudio… ${Math.round(p * 100)}%`;
      },
    });
  } catch (err) {
    setStatus(`Falha ao decodificar áudio: ${err.message}`);
  }
  els.loading.hidden = true;
  els.seek.max = player.duration.toFixed(2);
  updateChart();
  requestAnimationFrame(frame);
}

function fillInstrumentOptions(midi) {
  current.options = instrumentOptions(midi);
  els.instrument.replaceChildren(...current.options.map((ins) => new Option(ins.label, ins.id)));
  if (current.options.length) fillDifficultyOptions();
}

function fillDifficultyOptions() {
  const ins = currentInstrument();
  const diffs = ins ? availableDifficulties(current.midi, ins) : [];
  els.difficulty.replaceChildren(...diffs.map((d) => new Option(d.label, d.id)));
  // Prefer Expert when available, otherwise the highest difficulty.
  if (diffs.length) els.difficulty.value = diffs[diffs.length - 1].id;
}

function currentInstrument() {
  return current?.options.find((i) => i.id === els.instrument.value) || null;
}

function updateChart() {
  if (!current) return;
  if (els.instrument.value) {
    const previous = els.difficulty.value;
    fillDifficultyOptions();
    if ([...els.difficulty.options].some((o) => o.value === previous)) els.difficulty.value = previous;
  }
  const ins = currentInstrument();
  const diff = DIFFICULTIES.find((d) => d.id === els.difficulty.value);
  chart = ins && diff ? buildChart(current.midi, ins, diff) : null;
  highway.setChart(chart);
  fillSectionOptions();
}

function fillSectionOptions() {
  const sections = chart?.sections ?? [];
  els.sectionSelect.replaceChildren(...sections.map((s, i) => new Option(`${fmt(s.time)} · ${s.name}`, String(i))));
  els.sectionSelect.disabled = sections.length === 0;
  if (sections.length === 0) els.sectionNow.textContent = '—';
}

function buildMixer(stems) {
  els.mixer.replaceChildren(...stems.map((stem) => {
    const row = document.createElement('label');
    row.className = 'mix-row';
    row.innerHTML = '<span class="mix-name"></span><input type="range" min="0" max="1.5" step="0.01" value="1"><span class="mix-val">100%</span>';
    row.querySelector('.mix-name').textContent = stem.label;
    const range = row.querySelector('input');
    const val = row.querySelector('.mix-val');
    range.addEventListener('input', () => {
      player.setVolume(stem.id, Number(range.value));
      val.textContent = `${Math.round(range.value * 100)}%`;
    });
    return row;
  }));
}

async function togglePlay() {
  if (!current) return;
  if (player.playing) player.pause();
  else await player.play();
  els.play.textContent = player.playing ? 'Pausar' : 'Tocar';
}

function frame() {
  const t = player.currentTime();
  if (player.playing && t >= player.duration) {
    player.pause();
    els.play.textContent = 'Tocar';
  }
  const chartTime = t - Number(els.chartDelay.value);
  highway.render(chartTime);
  const index = chart ? sectionIndexAt(chart.sections, chartTime) : -1;
  if (index >= 0) {
    els.sectionNow.textContent = chart.sections[index].name;
    if (document.activeElement !== els.sectionSelect) els.sectionSelect.value = String(index);
  }
  if (!seeking) els.seek.value = t;
  els.time.textContent = `${fmt(t)} / ${fmt(player.duration)}`;
  requestAnimationFrame(frame);
}

function fmt(sec) {
  const s = Math.floor(sec || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setStatus(text) {
  els.status.textContent = text;
}
