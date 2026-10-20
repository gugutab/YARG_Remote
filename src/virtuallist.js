import { evenPerRow, highlightRanges, packCode } from './songlist.js';

// The pack beside the title of a medium card: a card whose text block is narrower than PACK_CODE_BELOW px (a phone) always shows the short code, so the
// rows of a narrow list agree; a wider one shows the full name when the title and the name both fit, the code when not. (The full name is always the tooltip.)
export const PACK_CODE_BELOW = 300;
export function packShort(boxWidth, titleWidth, gap, fullWidth) {
  return boxWidth < PACK_CODE_BELOW || titleWidth + gap + fullWidth > boxWidth;
}

// A windowed list for the library: only the rows near the viewport exist in the DOM, so ~750 songs with album
// thumbnails scroll smoothly and stay light on memory. Items are fixed-height song rows and group headers.

// Row heights per card style: compact (one text line), normal (thumb + 2 lines), large (big thumb + details).
export const ROW_HEIGHTS = { compact: 34, normal: 58, large: 128 };
export const ROW_H = ROW_HEIGHTS.normal;

// What the cards show and how big they are (the settings page edits this; the list gets it through setCards()).
export const DEFAULT_CARDS = {
  thumbs: true, scale: 1, iconSize: 15,
  compact: { artist: true, pack: false },
  normal: { artist: true, pack: true, icons: true },
  large: { album: true, year: true, length: true, genre: true, charter: false, pack: true, instruments: true, levels: true },
};

// Height of a card of a style with a configuration: it follows the lines the card shows and the thumbnail size.
function cardHeight(mode, cards = DEFAULT_CARDS) {
  const { thumbs, scale } = cards;
  if (mode === 'compact') return Math.max(22, Math.round(ROW_HEIGHTS.compact * scale));
  if (mode === 'normal') return Math.max(46, thumbs ? Math.round(50 * scale + 10) : 0); // the art (50 px) fills the card: + 4 px gap and 1 px border on each side
  const l = cards.large;
  const meta = l.album || l.year || l.genre || l.charter; // (the length sits at the title's right)
  const text = 20 + 17 + (meta ? 15 : 0) + (l.pack ? 15 : 0) + (l.instruments ? 45 : 0); // title, artist, meta, pack, chips (2 lines)
  return Math.max(thumbs ? Math.round(92 * scale + 16) : 0, text + 16);
}
// Narrowest a card of each style may get before the list drops a column (the grid appears as soon as two cards fit).
export const CARD_MIN_WIDTHS = { compact: 300, normal: 360, large: 400 };
export const HEAD_H = 26;
// The rail is 4px wider than before: the letters and ticks sit 4px further in from the right edge (the handle does not move).
const RAIL_PAD = 4;
const OVERSCAN_PX = 5 * ROW_H;
const THUMB_DELAY_MS = 120; // a row asks for its thumbnail only after it stayed visible this long (skips flings)

// offsets[i] = top of item i, offsets[n] = total height.
export function layoutOffsets(items, rowH = ROW_H) {
  const offsets = new Float64Array(items.length + 1);
  for (let i = 0; i < items.length; i++) offsets[i + 1] = offsets[i] + (items[i].type === 'head' ? HEAD_H : rowH);
  return offsets;
}

// Multi-column layout (the wide library on the home screen): song cards fill rows of `cols`, a group header takes a whole
// row. Returns offsets (top of each item, then the total height), bottoms (bottom of each item) and col (column of each
// item). With cols = 1 the offsets are the same as layoutOffsets().
export function layoutGrid(items, cols, rowH = ROW_H) {
  const n = items.length;
  const offsets = new Float64Array(n + 1);
  const bottoms = new Float64Array(n);
  const col = new Uint16Array(n);
  let y = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (items[i].type === 'head') {
      if (c > 0) { y += rowH; c = 0; }
      offsets[i] = y;
      bottoms[i] = y + HEAD_H;
      y += HEAD_H;
    } else {
      offsets[i] = y;
      bottoms[i] = y + rowH;
      col[i] = c;
      if (++c >= cols) { c = 0; y += rowH; }
    }
  }
  if (c > 0) y += rowH;
  offsets[n] = y;
  return { offsets, bottoms, col };
}

// Index range [first, last) of the items that intersect [scrollTop - overscan, scrollTop + height + overscan].
export function visibleRange(offsets, scrollTop, height, overscan = OVERSCAN_PX, bottoms = null) {
  const n = offsets.length - 1;
  if (n <= 0) return [0, 0];
  const lo = Math.max(0, scrollTop - overscan);
  const hi = scrollTop + height + overscan;
  // first item whose bottom is below lo
  let a = 0;
  let b = n;
  while (a < b) {
    const m = (a + b) >> 1;
    if ((bottoms ? bottoms[m] : offsets[m + 1]) <= lo) a = m + 1; else b = m;
  }
  const first = a;
  // first item whose top is at or below hi
  a = first;
  b = n;
  while (a < b) {
    const m = (a + b) >> 1;
    if (offsets[m] < hi) a = m + 1; else b = m;
  }
  return [first, a];
}

// Index of the item at a given scroll position (for the sticky group label).
export function itemAt(offsets, y) {
  const n = offsets.length - 1;
  let a = 0;
  let b = Math.max(0, n - 1);
  while (a < b) {
    const m = (a + b + 1) >> 1;
    if (offsets[m] <= y) a = m; else b = m - 1;
  }
  return a;
}

// Pure geometry of the rail: where a scroll offset / group sits on it (thumb center), and the inverse.
export function railPos(offset, range, railH, thumbH) {
  return thumbH / 2 + (range > 0 ? Math.min(1, Math.max(0, offset / range)) : 0) * (railH - thumbH);
}
// Even rails (used when sorting by pack): every group gets the same share of the rail, whatever its length, so all of
// them have room for a label. `bounds` = the scroll offset of each group's header, then the maximum scroll offset
// (clamped to it and non-decreasing). The thumb moves piecewise: inside a group it follows the scroll linearly.
export function evenFrac(offset, bounds) {
  const n = bounds.length - 1;
  if (n <= 0) return 0;
  const off = Math.min(Math.max(offset, bounds[0]), bounds[n]);
  let a = 0;
  let b = n;
  while (b - a > 1) { // last group whose start is <= offset
    const m = (a + b) >> 1;
    if (bounds[m] <= off) a = m; else b = m;
  }
  const span = bounds[a + 1] - bounds[a];
  return (a + (span > 0 ? (off - bounds[a]) / span : 0)) / n;
}
export function evenOffset(frac, bounds) {
  const n = bounds.length - 1;
  if (n <= 0) return 0;
  const f = Math.min(Math.max(frac, 0), 1) * n;
  const a = Math.min(n - 1, Math.floor(f));
  return bounds[a] + (bounds[a + 1] - bounds[a]) * (f - a);
}

export function railScroll(y, range, railH, thumbH) {
  const f = railH - thumbH > 0 ? (y - thumbH / 2) / (railH - thumbH) : 0;
  return Math.min(1, Math.max(0, f)) * range;
}

// How many instrument chips (icon + level bars) fit on a line of the large card's text column.
const CHIP_W = 50;
const CHIP_GAP = 10;

// The favourite star of a card: a real button (its own click never opens the card), aria-pressed while the song is a favourite.
// `star` = { has(song), toggle(song) -> new state }. The visible box is small (CSS `.fav-btn`) so the card's layout and height
// do not change; a pseudo-element gives it a 32 px hit area.
export const FAV_LABELS = { off: 'Favourite', on: 'Remove from favourites' };
export function syncStarButton(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? FAV_LABELS.on : FAV_LABELS.off);
  btn.title = on ? FAV_LABELS.on : FAV_LABELS.off;
}
function starButton(song, star) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fav-btn';
  btn.innerHTML = '<svg aria-hidden="true"><use href="#i-star"/></svg>';
  syncStarButton(btn, star.has(song));
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // (the card's click opens the details)
    syncStarButton(btn, star.toggle(song));
  });
  return btn;
}

export function createVirtualList({ scroller, label, rail, thumbs, onSelect, text, describe = () => ({ instruments: [] }), anchor = (l) => l[0], mode: initialMode = 'normal', star = null }) {
  let mode = initialMode;
  let cards = DEFAULT_CARDS;
  let rowH = cardHeight(mode, cards);
  let items = [];
  let offsets = layoutOffsets(items, rowH);
  let bottoms = null; // set when the list has several columns
  let colOf = null;
  let cols = 1;
  let minColW = 0; // > 0: the number of columns follows the width (cards at least this wide); 'auto': by card style
  const rows = new Map(); // index -> { el, timer }
  let activeSong = null;
  let frame = 0;
  let groups = []; // { index, label, anchor } of the headers, for the rail
  let bounds = null; // even rail (see evenFrac), or null for the linear one
  const fracOf = (offset) => (bounds ? evenFrac(offset, bounds) : (range() > 0 ? offset / range() : 0));
  const offsetOf = (frac) => (bounds ? evenOffset(frac, bounds) : frac * range());
  const canvas = rail?.querySelector('canvas');
  const railThumb = rail?.querySelector('.rail-thumb');
  const bubble = rail?.querySelector('.rail-bubble');
  const range = () => Math.max(0, offsets[items.length] - scroller.clientHeight);
  const thumbH = () => Math.min(rail.clientHeight, Math.max(28, (scroller.clientHeight / Math.max(1, offsets[items.length])) * rail.clientHeight));

  // Hover tip of the instrument icons in normal cards: the instrument name and its difficulty level (mini pips).
  const tip = document.createElement('div');
  tip.className = 'inst-tip';
  tip.hidden = true;
  document.body.append(tip);
  const hideTip = () => { tip.hidden = true; };
  // (also bound to other windows that show the cards: see bindTip)
  const bindTip = (root) => {
  root.addEventListener('mouseover', (e) => {
    const ic = e.target.closest?.('.song-icons .inst');
    if (!ic) return;
    const level = ic.dataset.level === '' ? null : Number(ic.dataset.level);
    const pips = level === null ? '<em>no level</em>' : `<span class="mini-pips">${Array.from({ length: 6 }, (_, k) => `<i${k < level ? ' class="on"' : ''}></i>`).join('')}</span>`;
    tip.innerHTML = `<b></b>${pips}`;
    tip.querySelector('b').textContent = ic.dataset.label;
    tip.hidden = false;
    const r = ic.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)}px`;
    tip.style.top = `${r.top - tip.offsetHeight - 6 < 8 ? r.bottom + 6 : r.top - tip.offsetHeight - 6}px`; // above, or below near the top edge
  });
  root.addEventListener('mouseout', (e) => { if (e.target.closest?.('.song-icons .inst')) hideTip(); });
  root.addEventListener('scroll', hideTip, { passive: true });
  };
  bindTip(scroller);

  const spacer = document.createElement('li');
  spacer.className = 'spacer';
  spacer.setAttribute('aria-hidden', 'true');
  scroller.replaceChildren(spacer);

  function makeRow(index) {
    const item = items[index];
    const el = document.createElement('li');
    el.style.top = `${offsets[index]}px`;
    if (colOf) el.style.setProperty('--col', String(colOf[index]));
    const firstCol = item.type !== 'head' && cols > 1 && colOf?.[index] === 0; // gets the line on the left of the grid
    if (item.type === 'head') {
      el.className = 'divider';
      el.style.height = `${HEAD_H}px`;
      el.textContent = item.label;
      el.setAttribute('role', 'presentation');
      return { el, timer: 0 };
    }
    return buildCard(item.song, mode, rowH, el, firstCol, (entry) => rows.get(index) === entry, onSelect);
  }

  // The card of one song (the library's row, also used by the end-of-song window): `m` the card style, `h` its height, `alive(entry)` tells the thumbnail
  // loader whether the card is still wanted, `pick(song)` what a click does.
  function buildCard(song, m, h, el, firstCol, alive, pick, perLine = chipsPerLine()) {
    el.className = `row ${m}` + (song === activeSong ? ' active' : '') + (firstCol ? ' first-col' : '');
    el.style.height = `${h}px`;
    el.style.setProperty('--row-h', `${h}px`); // (the large card's art fills the card: its size follows the row)
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(song === activeSong));
    const d = describe(song);
    // Text with the matched part of the search marked (mark.hit); `prefix` is plain text before it (" — ").
    const put = (node, txt, prefix = '') => {
      const ranges = highlightTerms.length ? highlightRanges(txt, highlightTerms) : [];
      if (!ranges.length) { node.textContent = prefix + txt; return node; }
      node.textContent = prefix;
      let at = 0;
      for (const [a, b] of ranges) {
        if (a > at) node.append(txt.slice(at, a));
        const mark = document.createElement('mark');
        mark.className = 'hit';
        mark.textContent = txt.slice(a, b);
        node.append(mark);
        at = b;
      }
      if (at < txt.length) node.append(txt.slice(at));
      return node;
    };
    if (m === 'compact') { // one line: Title - Artist (· pack)
      const c = cards.compact;
      const line = document.createElement('span');
      line.className = 'song-line';
      const title = document.createElement('span');
      title.className = 'song-title';
      put(title, text(song.title));
      line.append(title);
      if (c.artist) {
        const artist = document.createElement('span');
        artist.className = 'song-artist';
        put(artist, text(song.artist), ' — ');
        line.append(artist);
      }
      if (c.pack && d.pack) {
        const pack = document.createElement('span');
        pack.className = 'song-artist song-inline-pack';
        pack.textContent = ` · ${d.pack}`;
        line.append(pack);
      }
      el.append(line);
      if (star) el.append(starButton(song, star));
      el.title = `${text(song.title)} — ${text(song.artist)}${d.pack ? ` · ${d.pack}` : ''}`;
      el.addEventListener('click', () => pick(song));
      return { el, timer: 0 };
    }
    if (cards.thumbs) {
      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      thumb.innerHTML = '<img alt="" decoding="async" hidden>';
      el.append(thumb);
    }
    const textBox = document.createElement('span');
    textBox.className = 'song-text';
    el.append(textBox);
    const mk = (cls, txt) => {
      const e = document.createElement('span');
      e.className = cls;
      e.textContent = txt;
      return e;
    };
    const titleEl = put(mk('song-title', ''), text(song.title));
    const artistEl = put(mk('song-artist', ''), text(song.artist));
    const iconList = (withBadge = true) => {
      const icons = document.createElement('span');
      icons.className = 'song-icons';
      for (const i of d.instruments) {
        const ic = document.createElement('span');
        ic.className = 'inst';
        ic.dataset.label = i.label; // shown by the hover tip: the name and the difficulty level
        ic.dataset.level = i.level === null ? '' : String(i.level);
        ic.innerHTML = `<svg><use href="#i-${i.icon}"/></svg>${withBadge && i.badge ? `<sup>${i.badge}</sup>` : ''}`;
        icons.append(ic);
      }
      return icons;
    };
    if (m === 'normal') {
      const n = cards.normal;
      if (n.pack && d.pack) { // the pack at the top right, next to the title
        const top = document.createElement('span');
        top.className = 'song-top';
        const tag = Object.assign(mk('song-packtag', d.pack), { title: d.pack });
        tag.dataset.pack = d.pack;
        top.append(titleEl, tag);
        if (star) top.append(starButton(song, star));
        textBox.append(top);
      } else if (star) { // (the star still sits at the right of the title)
        const top = document.createElement('span');
        top.className = 'song-top';
        top.append(titleEl, starButton(song, star));
        textBox.append(top);
      } else textBox.append(titleEl);
      if (n.icons && d.instruments.length) { // the instruments the song has, as small icons to the right of the artist
        const sub = document.createElement('span');
        sub.className = 'song-sub';
        if (n.artist) sub.append(artistEl);
        sub.append(iconList());
        textBox.append(sub);
      } else if (n.artist) textBox.append(artistEl);
    } else { // large
      const l = cards.large;
      const top = document.createElement('span'); // the title with the length at the top right corner
      top.className = 'song-top';
      top.append(titleEl);
      if (l.length && d.length) top.append(mk('song-len', d.length));
      if (star) top.append(starButton(song, star));
      textBox.append(top, artistEl);
      const facts = [l.album && d.album, l.year && d.year, l.genre && d.genre, l.charter && d.charter && `by ${d.charter}`].filter(Boolean);
      if (facts.length) textBox.append(mk('song-meta', facts.join(' · ')));
      const bottom = document.createElement('span'); // the pack and the instruments sit at the bottom of the card
      bottom.className = 'song-bottom';
      if (l.pack && d.pack) {
        const pack = document.createElement('span');
        pack.className = 'song-pack';
        pack.innerHTML = '<svg><use href="#i-package"/></svg><span></span>';
        const packName = pack.querySelector('span');
        packName.textContent = d.pack;
        packName.dataset.pack = d.pack;
        bottom.append(pack);
      }
      if (l.instruments && d.instruments.length) {
        const insts = document.createElement('span');
        insts.className = 'song-insts';
        insts.style.setProperty('--per', String(evenPerRow(d.instruments.length, perLine))); // 4 chips with room for 3: 2 + 2
        for (const i of d.instruments) {
          const chip = document.createElement('span');
          chip.className = 'inst';
          chip.title = i.level === null ? i.label : `${i.label}: level ${i.level}`;
          const pips = !l.levels || i.level === null ? '' : `<span class="mini-pips">${Array.from({ length: 6 }, (_, k) => `<i${k < i.level ? ' class="on"' : ''}></i>`).join('')}</span>`; // no pips when song.ini has no level
          chip.innerHTML = `<svg><use href="#i-${i.icon}"/></svg>${i.badge ? `<sup>${i.badge}</sup>` : ''}${pips}`;
          insts.append(chip);
        }
        bottom.append(insts);
      }
      if (bottom.childElementCount) textBox.append(bottom);
    }
    el.addEventListener('click', () => pick(song));
    const entry = { el, timer: 0 };
    const cached = thumbs.peek(song);
    const img = el.querySelector('img');
    const show = (url) => { if (url && img && alive(entry)) { img.src = url; img.hidden = false; } };
    if (!img) return entry; // thumbnails are switched off
    if (cached) { img.src = cached; img.hidden = false; } // already in memory: show it right away (the row is not in the map yet)
    else {
      entry.timer = setTimeout(() => {
        entry.timer = 0;
        thumbs.get(song, () => alive(entry)).then(show);
      }, THUMB_DELAY_MS);
    }
    return entry;
  }

  // Ticks for every group header and a short label at the first group of each initial / decade / bucket.
  function drawRail() {
    if (!rail) return;
    const H = rail.clientHeight;
    const off = range() <= 0 || H <= 0; // nothing to scroll: the rail is invisible...
    rail.classList.toggle('off', off);
    const wrap = scroller.closest('.songs-wrap');
    if (wrap && wrap.classList.contains('no-scroll') !== off) { // ...and its space goes to the rows (CSS: --rail-w becomes 0)
      wrap.classList.toggle('no-scroll', off);
      autoColumns();
      if (mode === 'large') { for (const entry of rows.values()) { clearTimeout(entry.timer); entry.el.remove(); } rows.clear(); schedule(); } // the chips per line follow the width
    }
    if (off) return;
    const W = rail.clientWidth; // (read after the no-scroll class is settled: while it was on the rail had no width and the canvas stayed empty until a resize)
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; } // (assigning a size reallocates and clears the bitmap even when it is the same)
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const th = thumbH();
    const cs = getComputedStyle(scroller); // (one style object for both colours; read each draw, so a theme change shows at once)
    const tick = cs.getPropertyValue('--line').trim() || '#2a3140';
    const muted = cs.getPropertyValue('--muted').trim() || '#8b95a7';
    g.font = `600 ${bounds ? 8 : 9}px system-ui, sans-serif`;
    g.textAlign = 'right'; // the labels end right before the ticks
    g.textBaseline = 'middle';
    let lastText = null;
    let lastY = -99;
    for (const gr of groups) {
      const y = railPos(fracOf(offsets[gr.index]), 1, H, th);
      const isAnchor = gr.anchor !== lastText;
      if (isAnchor && y - lastY >= 11) {
        g.fillStyle = muted;
        g.fillText(gr.anchor, W - 6 - RAIL_PAD - 5, y); // 5px between a label and its tick
        lastY = y;
      }
      if (isAnchor) lastText = gr.anchor;
      g.fillStyle = isAnchor ? muted : tick;
      g.fillRect(W - 6 - RAIL_PAD, Math.round(y), isAnchor ? 5 : 3, 1);
    }
    railThumb.style.height = `${th}px`;
  }

  function updateThumb() {
    if (!rail || rail.classList.contains('off')) return;
    const th = thumbH();
    const y = railPos(fracOf(scroller.scrollTop), 1, rail.clientHeight, th) - th / 2;
    railThumb.style.transform = `translateY(${y}px)`;
  }

  function render() {
    frame = 0;
    const top = scroller.scrollTop;
    const [first, last] = visibleRange(offsets, top, scroller.clientHeight, undefined, bottoms);
    for (const [i, entry] of rows) {
      if (i < first || i >= last) {
        clearTimeout(entry.timer);
        entry.el.remove();
        rows.delete(i);
      }
    }
    const fresh = [];
    for (let i = first; i < last; i++) {
      if (rows.has(i)) continue;
      const entry = makeRow(i);
      rows.set(i, entry);
      scroller.append(entry.el);
      fresh.push(entry.el);
    }
    fitPacks(fresh);
    if (label) {
      const idx = itemAt(offsets, top);
      let head = '';
      for (let i = idx; i >= 0; i--) if (items[i]?.type === 'head') { head = items[i].label; break; }
      label.textContent = head;
      label.hidden = !head;
    }
    updateThumb();
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  scroller.addEventListener('scroll', schedule, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { drawRail(); schedule(); }).observe(scroller);
  }

  // Scrubbing: press or drag on the rail to move through the list; near a group tick it snaps to that header.
  let hideBubble = 0;
  const headAt = (offset) => {
    for (let i = itemAt(offsets, offset); i >= 0; i--) if (items[i]?.type === 'head') return items[i].label;
    return '';
  };
  // Where the list would scroll for a pointer position (snapping to a header's tick when close to one).
  function railTarget(clientY) {
    const box = rail.getBoundingClientRect();
    const y = clientY - box.top;
    const th = thumbH();
    let target = offsetOf(railScroll(y, 1, box.height, th));
    for (const gr of groups) {
      if (Math.abs(railPos(fracOf(offsets[gr.index]), 1, box.height, th) - y) <= 4) { target = Math.min(offsets[gr.index], range()); break; }
    }
    return { target, y, height: box.height };
  }
  function showBubble(text, y, height) {
    bubble.textContent = text;
    bubble.hidden = !text;
    bubble.style.top = `${Math.min(height - 12, Math.max(12, y))}px`;
    // to the right of the rail when the library window has room for it there (the details are open beside the list), otherwise to the left (over the list):
    // the window clips what sticks out of it, so the room is measured to its edge, not to the page's
    const win = rail.closest('.library');
    const room = (win ? win.getBoundingClientRect().right : window.innerWidth) - rail.getBoundingClientRect().right - 8;
    bubble.classList.toggle('right', bubble.offsetWidth + 6 <= room);
  }
  function scrubTo(clientY) {
    const { target, y, height } = railTarget(clientY);
    scroller.scrollTop = target;
    render();
    showBubble(label?.textContent || '', y, height);
  }
  function hoverAt(clientY) { // not holding the handle: just name the section under the pointer
    const { target, y, height } = railTarget(clientY);
    showBubble(headAt(target), y, height);
  }
  if (rail) {
    rail.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      clearTimeout(hideBubble);
      rail.setPointerCapture(e.pointerId);
      rail.classList.add('dragging');
      scrubTo(e.clientY);
    });
    rail.addEventListener('pointermove', (e) => {
      if (rail.classList.contains('dragging')) scrubTo(e.clientY);
      else { clearTimeout(hideBubble); hoverAt(e.clientY); }
    });
    rail.addEventListener('pointerleave', () => { if (!rail.classList.contains('dragging')) bubble.hidden = true; });
    const end = () => {
      rail.classList.remove('dragging');
      hideBubble = setTimeout(() => { if (!rail.matches(':hover')) bubble.hidden = true; }, 500); // stays while the pointer is still over the rail
    };
    // The wheel over the rail scrolls the list like it does over the rows.
    rail.addEventListener('wheel', (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1; // lines / pages / pixels
      scroller.scrollTop += e.deltaY * unit;
      if (!rail.classList.contains('dragging')) hoverAt(e.clientY);
    }, { passive: false });
    rail.addEventListener('pointerup', end);
    rail.addEventListener('pointercancel', end);
  }

  // Recomputes the positions (items, card height or number of columns changed) and redraws the visible rows.
  // Pack names: the full name when it fits the room the card gives it, the short code (RB2+, GH3...) when it does not; never an ellipsis.
  // The room comes from the width of the card's own block (not from the text's size), and the text is measured with a canvas, so the choice
  // is the same on every layout pass; it is redone when the list is resized.
  let measure = null;
  const widthOf = (text, font) => {
    measure ||= document.createElement('canvas').getContext('2d');
    measure.font = font;
    return measure.measureText(text).width;
  };
  // Large card: when the lines do not all fit the card's height (the instrument chips can take two lines), the album/year/genre line goes.
  function fitMeta(rowEls) {
    const metas = rowEls.map((el) => el.querySelector('.song-meta')).filter(Boolean);
    for (const m of metas) m.hidden = false;
    const over = metas.filter((m) => { const box = m.parentElement; return box.scrollHeight > box.clientHeight + 1; });
    for (const m of over) m.hidden = true;
  }
  function fitPacks(rowEls = [...rows.values()].map((r) => r.el)) {
    const jobs = rowEls.flatMap((el) => [...el.querySelectorAll('[data-pack]')]);
    const room = jobs.map((e) => { // (all reads first, then the writes: one layout pass)
      const box = e.parentElement;
      const large = box.classList.contains('song-pack');
      const full = widthOf(e.dataset.pack, getComputedStyle(e).font);
      if (large) return { e, short: full > box.clientWidth - 18 }; // own line: the name, or its code when the line is too narrow
      // Medium card: the pack shares the row with the title. Order of preference: the full name; else the code (the title stays whole);
      // only when even the code does not leave the title all its room does the title end in an ellipsis.
      const title = box.querySelector('.song-title');
      const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
      const t = title ? widthOf(title.textContent, getComputedStyle(title).font) : 0;
      const starBtn = box.querySelector('.fav-btn'); // (the star takes its own room at the end of the row)
      return { e, short: packShort(box.clientWidth, t + (starBtn ? starBtn.offsetWidth + gap : 0), gap, full) };
    });
    for (const { e, short } of room) {
      e.classList.toggle('short', short);
      e.textContent = short ? packCode(e.dataset.pack) : e.dataset.pack;
      e.title = e.dataset.pack;
    }
    fitMeta(rowEls);
  }
  function relayout(keepTop = false) {
    const top = keepTop ? itemAt(offsets, scroller.scrollTop) : 0;
    ({ offsets, bottoms, col: colOf } = layoutGrid(items, cols, rowH));
    scroller.style.setProperty('--cols', String(cols));
    scroller.classList.toggle('multi', cols > 1);
    for (const entry of rows.values()) { clearTimeout(entry.timer); entry.el.remove(); }
    rows.clear();
    spacer.style.height = `${offsets[items.length]}px`;
    if (keepTop) scroller.scrollTop = offsets[Math.min(top, items.length)] ?? 0;
    drawRail();
    render();
  }
  // Instrument chips of the large card per line, from the card's width (the line breaks are then even: see evenPerRow).
  const railWidth = () => parseFloat(getComputedStyle(scroller.closest('.songs-wrap') ?? scroller).getPropertyValue('--rail-w')) || 0;
  function chipsPerLine() {
    const cardW = (scroller.clientWidth - railWidth()) / cols;
    const inset = cards.thumbs ? 6 + Math.round(92 * cards.scale) + 12 + 6 : 12; // margin, cover, gap, safety
    const chipW = (cards.large.levels ? CHIP_W : 24) + Math.max(0, cards.iconSize - 15);
    return Math.max(1, Math.floor((cardW - inset + CHIP_GAP) / (chipW + CHIP_GAP)));
  }
  let lastWidth = 0;
  new ResizeObserver(() => { // a width change can change the line breaks of the large cards: rebuild the visible rows
    const w = scroller.clientWidth;
    if (mode === 'large' && Math.abs(w - lastWidth) > 4 && lastWidth) { for (const entry of rows.values()) { clearTimeout(entry.timer); entry.el.remove(); } rows.clear(); schedule(); }
    lastWidth = w;
  }).observe(scroller);
  // With a minimum card width, the columns follow the list's width.
  function autoColumns() {
    if (!minColW) return;
    const railW = parseFloat(getComputedStyle(scroller.closest('.songs-wrap') ?? scroller).getPropertyValue('--rail-w')) || 0;
    const min = minColW === 'auto' ? CARD_MIN_WIDTHS[mode] : minColW;
    const next = Math.max(1, Math.floor((scroller.clientWidth - railW) / min));
    if (next !== cols) { cols = next; relayout(true); }
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { autoColumns(); fitPacks(); }).observe(scroller);
  document.fonts?.ready.then(() => fitPacks());

  let highlightTerms = [];
  return {
    // One song card in the current card style, for other windows (the end-of-song suggestions): a stand-alone <li> (not positioned like the list's rows)
    // whose click calls `pick(song)`; the thumbnail loads like in the list.
    bindTip, // the hover tip of the instrument icons (name and difficulty) for another container of cards
    cardFor(song, pick) {
      const el = document.createElement('li');
      const entry = buildCard(song, mode, rowH, el, false, () => true, pick, 6); // (the instrument chips of a large card: one line, the window's cards are wide)
      el.classList.add('end-card-row');
      return entry.el;
    },
    setCards(next) { // what the cards show / how big: rebuild the visible rows (the list keeps its place)
      cards = next;
      rowH = cardHeight(mode, cards);
      scroller.style.setProperty('--card-scale', String(cards.scale));
      scroller.style.setProperty('--card-icon', `${cards.iconSize}px`);
      relayout(true);
    },
    setColumns(n, { minWidth = 0 } = {}) { // fixed number of columns, or (minWidth) as many as fit
      minColW = minWidth;
      cols = Math.max(1, n);
      relayout(true);
      autoColumns();
    },
    setItems(next, { keepScroll = false, evenGroups = false } = {}) {
      items = next;
      ({ offsets, bottoms, col: colOf } = layoutGrid(items, cols, rowH));
      groups = items.flatMap((it, index) => (it.type === 'head' ? [{ index, label: it.label, anchor: anchor(it.label) }] : []));
      bounds = null;
      scroller.closest('.songs-wrap')?.classList.remove('even-rail');
      if (evenGroups && groups.length > 1) { // clamp the header offsets to the scroll range so the rail stays monotonic
        const max = Math.max(0, offsets[items.length] - scroller.clientHeight);
        bounds = [...groups.map((g) => Math.min(offsets[g.index], max)), max];
        scroller.closest('.songs-wrap')?.classList.add('even-rail'); // wider rail: room for the 4-character pack codes
      }
      for (const entry of rows.values()) { clearTimeout(entry.timer); entry.el.remove(); }
      rows.clear();
      scroller.style.setProperty('--cols', String(cols));
      scroller.classList.toggle('multi', cols > 1);
      spacer.style.height = `${offsets[items.length]}px`;
      if (!keepScroll) scroller.scrollTop = 0;
      drawRail();
      render();
    },
    setHighlight(terms) { highlightTerms = terms || []; }, // the free-text terms of the search: rows built after this mark them
    setActive(song) {
      activeSong = song;
      for (const [i, { el }] of rows) {
        if (items[i].type !== 'song') continue;
        const on = items[i].song === song;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', String(on));
      }
    },
    setMode(next) { // card style: the list keeps the item at the top of the view
      if (next === mode || !ROW_HEIGHTS[next]) return;
      mode = next;
      rowH = cardHeight(mode, cards);
      relayout(true);
      autoColumns(); // the card style changes how many columns fit
    },
    scrollToSong(song) { // only when the row is not already fully visible
      const i = items.findIndex((it) => it.type === 'song' && it.song === song);
      if (i < 0) return;
      const top = offsets[i];
      const h = scroller.clientHeight;
      if (top < scroller.scrollTop || top + rowH > scroller.scrollTop + h) scroller.scrollTop = Math.max(0, top - h / 2);
    },
    get renderedCount() { return rows.size; },
  };
}
