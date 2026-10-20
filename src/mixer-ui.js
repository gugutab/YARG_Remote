// ---------- Mixer ----------
// The stem volumes: one state per stem (`stemStates`), stems of one instrument grouped (`groupList`), the master row (`masterState`), each shown
// by one or more views (the bar's mixer, the details' card, the tile popups) that are kept in step; levels remembered in the store. Moved out of
// app.js as is: `stemStates`, `groupList` and `masterState` are exported live bindings (only this module assigns them); app.js injects the rest
// through `initMixer(ctx)`, called where the master level used to be read.
import { stemKind, stemBadge, stemGroup, stemGroupLabel } from './songinfo.js';
import { parseVolumes, serializeVolumes, remember as rememberLevel, recall as recallLevel } from './volmemory.js';
import { paintRange } from './range-ui.js';
import { refreshTileVolumes } from './tiles-ui.js';
import { paintLevel, isSolo } from './levelicon.js';

const LONG_PRESS_MS = 500;
// Master volume: one more mixer row (kept across songs) that scales every stem.
export let masterState = null; // (created by initMixer)
export let stemStates = []; // { stem, value, muted, group, views[] }: one state per stem, shown in the menu and on the info screen
export let groupList = []; // { key, label, members[], value, muted, expanded, views[] }: stems of one instrument, collapsed by default
let ctx = null;
// ctx: { els, store, prefs, player, current(), liveStage(), audioSong() }
// What app.js did at this point of its start-up: the master level from the store, shown and applied; the remembered stem volumes read.
export function initMixer(context) {
  ctx = context;
  masterState = { stem: { id: 'master', label: 'Master' }, master: true, value: savedMaster(), muted: ctx.store.get('masterMuted') === '1', views: [] };
  ctx.els.mixerVal.textContent = masterState.muted ? 'Muted' : `${Math.round(masterState.value * 100)}%`;
  ctx.player.setMaster(masterState.muted ? 0 : masterState.value); // from the first sound on, not only after a mixer is built
  volMem = parseVolumes(ctx.store.get('stemVolumes'));
}

function savedMaster() {
  const v = Number(ctx.store.get('master'));
  return ctx.store.get('master') !== null && Number.isFinite(v) ? Math.min(1.5, Math.max(0, v)) : 1;
}

const silent = (st) => st.muted || Boolean(st.group?.muted); // not audible because of its own or its group's mute
const groupSilent = (g) => g.muted || g.members.every((m) => m.muted);
const effectiveVolume = (st) => (silent(st) ? 0 : st.value * (st.group?.value ?? 1));

// The volume of every track is remembered (src/volmemory.js, store key `stemVolumes`, setting `audio.rememberVolumes`): a song opens with the levels you left.
let volMem = null; // (read by initMixer)
let volTimer = 0;
export function rememberVolume(kind, key, value) {
  if (!ctx.prefs.get('audio.rememberVolumes')) return;
  rememberLevel(volMem, kind, key, value);
  clearTimeout(volTimer);
  volTimer = setTimeout(() => ctx.store.set('stemVolumes', serializeVolumes(volMem)), 250); // (a slider drag sends many values)
}
export function buildMixer(stems) {
  const restore = ctx.prefs.get('audio.rememberVolumes');
  const owner = ctx.current()?.song ?? null; // (whose audio the track is: another song's sound is not touched by this mixer)
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

  masterState.views = ctx.liveStage() ? masterState.views.filter((v) => v.container !== ctx.els.mixerInfo) : []; // (a live stage keeps its own bar mixer and the master row in it)
  const grouped = new Set(groupList.flatMap((g) => g.members));
  for (const container of ctx.liveStage() ? [ctx.els.mixerInfo] : [ctx.els.mixer, ctx.els.mixerInfo]) {
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
export function pressHandlers(btn, solo, toggle) {
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

const ROW_HTML = (kind) => `
    <button class="stem-btn" type="button" aria-pressed="false"><svg><use href="#i-${kind}"/></svg><b class="badge"></b></button>
    <span class="mix-name"></span>
    <input type="range" min="0" max="1.5" step="0.01" value="1">
    <span class="mix-val">100%</span>
    <button class="icon small-icon reset" type="button" title="Reset volume" aria-label="Reset volume"><svg><use href="#i-reset"/></svg></button>`;

export function mixerRow(st) {
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
export function groupBlock(g, own = null) { // own: the instrument menu keeps its own open/closed state for the tracks ({ open, toggle })
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

export function unmuteGroup(g) {
  g.muted = false;
  for (const m of g.members) m.muted = false;
}

export function applyGroup(g) {
  renderGroup(g);
  g.members.forEach(applyStem);
}

export function renderGroup(g) {
  const muted = groupSilent(g);
  const solo = isSolo(g.members, stemStates, silent);
  for (const v of g.views) {
    v.range.value = g.value;
    paintRange(v.range);
    v.val.textContent = `${Math.round(g.value * 100)}%`;
    v.row.classList.toggle('muted', muted);
    paintLevel(v.mute, { value: g.value, off: muted, solo });
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

export function soloStem(st) {
  const others = stemStates.filter((o) => o !== st);
  const alreadySolo = !silent(st) && others.every(silent);
  groupList.forEach((g) => { g.muted = false; });
  for (const o of others) o.muted = !alreadySolo;
  st.muted = false;
  applyEverything();
}

export function soloGroup(g) {
  const others = stemStates.filter((o) => o.group !== g);
  const alreadySolo = g.members.every((m) => !silent(m)) && others.every(silent);
  groupList.forEach((x) => { x.muted = false; });
  for (const o of others) o.muted = !alreadySolo;
  for (const m of g.members) m.muted = false;
  applyEverything();
}

export function applyEverything() {
  groupList.forEach(renderGroup);
  stemStates.forEach(applyStem);
}

// The slider keeps its value while a stem is muted; every view of the stem is updated together.
export function applyStem(st) {
  if (st.master) {
    ctx.els.mixerVal.textContent = st.muted ? 'Muted' : `${Math.round(st.value * 100)}%`; // (shown beside the volume icon on wide screens)
    ctx.player.setMaster(st.muted ? 0 : st.value);
    ctx.store.set('master', String(st.value)); // the master level and its mute are kept between visits
    ctx.store.set('masterMuted', st.muted ? '1' : '0');
  } else if (st.owner === ctx.audioSong() || !ctx.audioSong()) ctx.player.setVolume(st.stem.id, effectiveVolume(st)); // (the sound of another song is not touched by this song's mixer)
  const off = st.master ? st.muted : silent(st);
  const solo = !st.master && isSolo([st], stemStates, silent);
  if (st.master) paintLevel(ctx.els.mixerBtn, { value: st.value, off: st.muted, swapIcon: true });
  for (const v of st.views) {
    v.range.value = st.value;
    paintRange(v.range);
    v.val.textContent = `${Math.round(st.value * 100)}%`;
    v.row.classList.toggle('muted', off);
    paintLevel(v.mute, { value: st.value, off, solo, swapIcon: st.master });
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
