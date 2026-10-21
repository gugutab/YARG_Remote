// Instrument tiles: the cards of the details, the pause screen and the stage menu (on/off, type and difficulty), the row of tools at the bottom
// of a tile (volume, neck speed, chart delay, view) and the small popup those tools open. Moved out of app.js as is: app.js injects its state
// getters and functions through `initTilesUi(ctx)`, called where the tile popup used to be created (same DOM order, same listener order).
// The chooser slots (`fillChooser`) and the stage menu (`buildPaneMenu`) stay in app.js and use the builders exported here.
import { NECK_VALUES, neckIndex, neckAt } from './neckscale.js';
import { paintLevel, isSolo } from './levelicon.js';
import { instrumentLevel, stemGroup } from './songinfo.js';
import { paintRange } from './range-ui.js';

let ctx = null;
// ctx: { highway, INSTRUMENT_ICON, current(), stemStates(), groupList(), instrumentGroups(), diffFor(ins), isOn(group), turnOn(group, ins, diff),
// turnOff(group), pickDifficulty(group, ins, diff), selectInstrument(id, diff), updateChart(), setVocalView(view), mixerRow(st), groupBlock(g, own), renderGroup(g) }

// The instrument cards (on/off switches with the difficulty and mode buttons): in the details and in the song window shown while paused.
// The difficulty selector is one row of four. When a label would be cut (an ellipsis) the buttons that are not selected shrink to their initial
// first; only if that is not enough does it go to two rows. Checked whenever its width changes.
const DIFF_ABBR = { Easy: 'E', Medium: 'M', Hard: 'H', Expert: 'X' }; // (Expert is X: Easy already took the E)
export function setDiffLabel(btn, label) {
  btn.setAttribute('aria-label', label);
  btn.replaceChildren(Object.assign(document.createElement('span'), { className: 'd-full', textContent: label }), Object.assign(document.createElement('span'), { className: 'd-abbr', textContent: DIFF_ABBR[label] ?? label[0] }));
}
export let diffSegObserver = null; // (created by initTilesUi)
const fitDiffSegs = (entries) => {
  for (const { target: seg, contentRect } of entries) {
    if (seg._w === Math.round(contentRect.width)) continue; // (a height change from the classes below must not run this again)
    seg._w = Math.round(contentRect.width);
    const clipped = () => [...seg.children].some((b) => b.scrollWidth > b.clientWidth);
    seg.classList.remove('abbr', 'two-rows');
    if (!clipped()) continue;
    seg.classList.add('abbr');
    if (clipped()) seg.classList.replace('abbr', 'two-rows');
  }
};
// The Notes / Karaoke selector of a vocal tile (the same look as the drum type selector); it follows the global vocal view.
export function vocalViewSeg() {
  const modes = document.createElement('div');
  modes.className = 'seg seg-modes vocal-modes';
  for (const [value, label] of [['track', 'Notes'], ['karaoke', 'Karaoke']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.vocal = value;
    b.textContent = label;
    b.setAttribute('aria-pressed', String(ctx.highway.vocalView === value));
    b.dataset.next = String(ctx.highway.vocalView === value); // (an instrument that is off shows its choice dimmed, like the type and difficulty)
    b.addEventListener('click', (e) => { e.stopPropagation(); ctx.setVocalView(value); });
    modes.append(b);
  }
  return modes;
}
export function buildInstrumentCards() {
  return ctx.instrumentGroups().map((group) => buildInstrumentCard(group));
}
// One instrument tile. `menu`: it is the content of the stage menu of that instrument ({ onRemove }): always on, a remove button where the dot is, no click on the tile.
export function buildInstrumentCard(group, menu = null) {
  {
    // Vocal parts have a single chart: no difficulty buttons.
    const ins = group.chosen; // the option this card stands for (for drums: the chosen mode)
    const { diffs, chosen } = ctx.diffFor(ins);
    const vocal = ins.mode === 'vocals';
    const card = document.createElement('div');
    card.className = 'icard';
    card.dataset.key = group.key;
    const on = menu ? true : ctx.isOn(group);
    card.dataset.active = String(on); // (lit when its fretboard is on screen)
    card.dataset.pinned = 'false';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'icard-head';
    head.setAttribute('aria-pressed', String(on));
    head.innerHTML = `<svg><use href="#i-${ctx.INSTRUMENT_ICON[ins.base] || 'music'}"/></svg><span class="icard-name"></span><span class="icard-dot" aria-hidden="true"></span>`; // (the dot: the pause screen's on/off mark)
    head.querySelector('.icard-name').textContent = group.label;

    // title row: [icon + name] [info button] ...... [level pips]
    const top = document.createElement('div');
    top.className = 'icard-top';
    top.append(head);
    const level = instrumentLevel(ctx.current().song, ins);
    if (level !== null) {
      const pips = document.createElement('span');
      pips.className = 'pips';
      pips.title = `Level ${level} of 6`;
      pips.replaceChildren(...Array.from({ length: 6 }, (_, i) => Object.assign(document.createElement('i'), { className: i < level ? 'on' : '' })));
      top.append(pips);
    }
    // The whole card selects the instrument (with its remembered mode and difficulty); the buttons stop the click.
    if (!menu) card.addEventListener('click', () => { if (on) ctx.turnOff(group); else ctx.turnOn(group, ins, undefined); }); // (the buttons stop the click)
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
          ctx.current().modeChoice[group.key] = o.id;
          if (group.pinned) ctx.updateChart(); // a fretboard shown next to the active one keeps showing
          else if (group.active && !ctx.current().hiddenActive) ctx.selectInstrument(o.id, ctx.diffFor(o).chosen?.id);
          else ctx.turnOn(group, o, undefined); // it was off: it goes on in that mode
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
        btn.addEventListener('click', (e) => { e.stopPropagation(); ctx.pickDifficulty(group, ins, d.id); });
        seg.append(btn);
      }
      card.append(seg);
    }
    card.append(buildTileTools(group));
    return card;
  }
}

// The mixer rows of an instrument inside its menu. They are the same rows as in Stem volume (the slider, the mute button, the
// reset), registered as extra views of the same stem states, so both places always agree; the old ones are dropped on rebuild.
let menuMixViews = [];
export function dropMenuMixViews() {
  for (const { owner, added } of menuMixViews) owner.views = owner.views.filter((v) => !added.includes(v));
  menuMixViews = [];
}
function menuVolume(group) {
  const members = ctx.stemStates().filter((st) => stemGroup(st.stem.label) === group.key);
  if (!members.length) return null;
  const grouped = ctx.groupList().find((g) => g.members[0] && stemGroup(g.members[0].stem.label) === group.key);
  const owners = [...members, ...(grouped ? [grouped] : [])];
  const before = owners.map((o) => o.views.length);
  const wrap = document.createElement('div');
  wrap.className = 'mixer pm-mixer';
  // The tracks of a group show only when their volumes differ (closed while they are all the same); the user can open them.
  const same = members.every((m) => m.value === members[0].value && m.muted === members[0].muted);
  ctx.current().menuExpand ??= {};
  const own = grouped ? { open: ctx.current().menuExpand[group.key] ?? !same, toggle: (v) => { ctx.current().menuExpand[group.key] = v; } } : null;
  wrap.append(grouped ? ctx.groupBlock(grouped, own) : ctx.mixerRow(members[0]));
  if (grouped) ctx.renderGroup(grouped);
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
  const neck = name === 'neck'; // (the neck speed slider moves over the positions of NECK_VALUES)
  Object.assign(input, neck ? { min: 0, max: NECK_VALUES.length - 1, step: 1 } : { min, max, step });
  input.setAttribute('aria-label', neck ? 'Neck speed' : 'Chart delay');
  const paint = () => {
    const v = ctx.highway.paneOpt(group.key, name);
    input.value = neck ? neckIndex(v) : v;
    out.textContent = fmtValue(v);
    reset.disabled = Math.abs(v - def()) < 1e-9;
    paintRange(input, neck ? neckIndex(def()) : def());
    onChange?.();
  };
  input.addEventListener('input', () => { ctx.highway.setPaneOpt(group.key, name, neck ? neckAt(input.value) : Number(input.value)); paint(); });
  reset.addEventListener('click', () => { ctx.highway.clearPaneOpt(group.key, name); paint(); });
  paint();
  return box;
}
export const NECK_FMT = (v) => `${v.toFixed(1)}×`;
export const DELAY_FMT = (v) => { // 0 -> "0s", 0.35 -> ".35s", -0.4 -> "-.4s"
  const n = Math.abs(v) < 0.005 ? '0' : Math.abs(v).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace(/^0\./, '.');
  return `${v < -0.005 ? '-' : ''}${n}s`;
};

// The row of tools at the bottom of an instrument tile: volume, neck speed and chart delay open a small slider window; the view (2D / 3D) and the
// note shape (circles / rectangles) switch on the spot. All of them belong to that instrument's fretboard only (pane options and the stem volume).
let tilePop = null; // (created by initTilesUi)
let tilePopBtn = null;
export function closeTilePop() {
  if (tilePop.hidden) return;
  tilePop.hidden = true;
  tilePop.replaceChildren();
  dropMenuMixViews(); // (the volume rows registered themselves as views of the stems)
  tilePopBtn?.setAttribute('aria-expanded', 'false');
  tilePopBtn = null;
}
export function openTilePop(btn, title, content) {
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

// When the tool chips do not fit: the gaps between them shrink (6 px down to 2 px), then the values lose their unit (the last character: s, x, %), and only then an ellipsis cuts them.
let tileToolsObserver = null; // (created by initTilesUi)
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
export function buildTileTools(group) {
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
  const membersNow = () => ctx.stemStates().filter((st) => stemGroup(st.stem.label) === group.key);
  const volText = () => {
    const owner = ctx.groupList().find((g) => g.members[0] && stemGroup(g.members[0].stem.label) === group.key) ?? membersNow()[0];
    return !owner ? '' : owner.muted ? 'Off' : `${Math.round(owner.value * 100)}%`;
  };
  const volume = tool('volume', 'Volume', (b) => {
    const content = menuVolume(group);
    if (content) openTilePop(b, `${group.label} volume`, content);
  });
  volume.refresh = () => { // (the stems may load after the tile was built: a song opened by a link)
    volume.disabled = !membersNow().length;
    text(volume, volText());
    const owner = ctx.groupList().find((g) => g.members[0] && stemGroup(g.members[0].stem.label) === group.key) ?? membersNow()[0];
    if (owner) {
      const members = owner.members ?? [owner];
      const silent = (st) => st.muted || Boolean(st.group?.muted);
      paintLevel(volume, { value: owner.value, off: members.every(silent), solo: isSolo(members, ctx.stemStates(), silent), swapIcon: true });
    }
  };
  volume.refresh();
  tileVolumeRefresh.add(volume);
  const optTool = (icon, title, name, min, max, step, def, fmt) => {
    const b = tool(icon, title, () => openTilePop(b, `${group.label} ${title.toLowerCase()}`, paneRange(group, name, min, max, step, def, fmt, paint)));
    const paint = () => {
      const v = ctx.highway.paneOpt(group.key, name);
      text(b, name === 'delay' && Math.abs(v) < 0.005 ? '' : fmt(v)); // (no label for a delay of 0)
      b.dataset.mod = String(Math.abs(v - def()) > 1e-9);
    };
    paint();
    return b;
  };
  optTool('speed', 'Neck speed', 'neck', 0.5, 3, 0.1, () => ctx.highway.paneDefault(group.key, 'neck'), NECK_FMT); // (the reset goes back to the instrument's own starting speed, else the global one)
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
          btn.setAttribute('aria-pressed', String(ctx.highway.paneOpt(group.key, name) === value));
          btn.addEventListener('click', () => {
            ctx.highway.setPaneOpt(group.key, name, value);
            for (const o of el.children) o.setAttribute('aria-pressed', String(o === btn));
            paintView();
          });
          el.append(btn);
        }
        return el;
      };
      box.append(seg('view', [['2d', '2D', 'view-normal'], ['3d', '3D', 'cube']]), seg('noteStyle', [['round', 'Circles', 'circle'], ['rect', 'Rectangles', 'shapes']]), seg('leftHanded', [[false, 'Normal lanes', 'arrow-right'], [true, 'Mirrored lanes', 'arrow-left']]));
      openTilePop(b, `${group.label} view`, box);
    });
    const paintView = () => {
      const v = ctx.highway.paneOpt(group.key, 'view');
      const n = ctx.highway.paneOpt(group.key, 'noteStyle');
      view.title = view.ariaLabel = `View: ${v === '3d' ? '3D' : '2D'}, notes as ${n === 'rect' ? 'rectangles' : 'circles'}`;
    };
    paintView();
  }
  return row;
}
const tileVolumeRefresh = new Set(); // the volume buttons of the tiles on screen: they show the level, which the small window (or the mixer) can change
export const refreshTileVolumes = () => setTimeout(() => { for (const b of tileVolumeRefresh) { if (b.isConnected) b.refresh(); else tileVolumeRefresh.delete(b); } }, 0);

// What app.js did at load, in the same order, where the tile popup used to be created (after the diff observer, which has no visible effect).
export function initTilesUi(context) {
  ctx = context;
  diffSegObserver = new ResizeObserver(fitDiffSegs);
  tilePop = document.createElement('div');
  tilePop.className = 'popover tile-pop';
  tilePop.hidden = true;
  document.body.append(tilePop);
  document.addEventListener('pointerdown', (e) => { if (!tilePop.hidden && !tilePop.contains(e.target) && !tilePopBtn?.contains(e.target)) closeTilePop(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !tilePop.hidden) { e.stopPropagation(); closeTilePop(); } }, true);
  window.addEventListener('resize', closeTilePop);
  tileToolsObserver = new ResizeObserver((entries) => { for (const { target } of entries) fitTileTools(target); });
  document.addEventListener('input', refreshTileVolumes, true);
  document.addEventListener('click', refreshTileVolumes, true);
}
