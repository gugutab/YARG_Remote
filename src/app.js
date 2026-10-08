import { parseMidi } from './midi.js';
import { INSTRUMENTS, DIFFICULTIES, findTrack, availableDifficulties, buildChart } from './chart.js';
import { MultiTrackPlayer } from './player.js';
import { Highway } from './highway.js';
import { walkHandle, entriesFromFileList, scanSongs, audioStemsOf, readBytes, readText } from './library.js';

const $ = (id) => document.getElementById(id);
const els = {
  pick: $('pick'),
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
  loading: $('loading'),
  mixer: $('mixer'),
  highway: $('highway'),
};

const player = new MultiTrackPlayer();
const highway = new Highway(els.highway);
let songs = [];
let current = null; // { song, midi, coverUrl }
let seeking = false;

els.pick.addEventListener('click', pickFolder);
els.folderInput.addEventListener('change', () => loadEntries(entriesFromFileList(els.folderInput.files)));
els.search.addEventListener('input', renderList);
els.instrument.addEventListener('change', updateChart);
els.difficulty.addEventListener('change', updateChart);
els.play.addEventListener('click', togglePlay);
els.seek.addEventListener('input', () => { seeking = true; });
els.seek.addEventListener('change', () => { player.seek(Number(els.seek.value)); seeking = false; });
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
    await loadEntries(walkHandle(dir, dir.name));
  } catch (err) {
    if (err.name !== 'AbortError') setStatus(`Erro ao abrir pasta: ${err.message}`);
  }
}

async function loadEntries(entries) {
  setStatus('Procurando músicas…');
  songs = await scanSongs(entries);
  setStatus(`${songs.length} música(s) encontrada(s).`);
  renderList();
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
    await player.load(audioStemsOf(song), (p) => {
      els.loading.textContent = `Carregando áudio… ${Math.round(p * 100)}%`;
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
  const options = INSTRUMENTS.filter((ins) => findTrack(midi, ins) && availableDifficulties(midi, ins).length);
  els.instrument.replaceChildren(...options.map((ins) => new Option(ins.label, ins.id)));
  if (options.length) fillDifficultyOptions();
}

function fillDifficultyOptions() {
  const ins = currentInstrument();
  const diffs = ins ? availableDifficulties(current.midi, ins) : [];
  els.difficulty.replaceChildren(...diffs.map((d) => new Option(d.label, d.id)));
  // Prefer Expert when available, otherwise the highest difficulty.
  if (diffs.length) els.difficulty.value = diffs[diffs.length - 1].id;
}

function currentInstrument() {
  return INSTRUMENTS.find((i) => i.id === els.instrument.value) || null;
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
  highway.setChart(ins && diff ? buildChart(current.midi, ins, diff) : null);
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
  highway.render(t);
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
