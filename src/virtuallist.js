// A windowed list for the library: only the rows near the viewport exist in the DOM, so ~750 songs with album
// thumbnails scroll smoothly and stay light on memory. Items are fixed-height song rows and group headers.

// Row heights per card style: compact (one text line), normal (thumb + 2 lines), large (big thumb + details).
export const ROW_HEIGHTS = { compact: 32, normal: 56, large: 128 };
export const ROW_H = ROW_HEIGHTS.normal;
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

export function createVirtualList({ scroller, label, rail, thumbs, onSelect, text, describe = () => ({ instruments: [] }), anchor = (l) => l[0], mode: initialMode = 'normal' }) {
  let mode = initialMode;
  let rowH = ROW_HEIGHTS[mode];
  let items = [];
  let offsets = layoutOffsets(items, rowH);
  let bottoms = null; // set when the list has several columns
  let colOf = null;
  let cols = 1;
  let minColW = 0; // > 0: the number of columns follows the width (cards at least this wide)
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
  scroller.addEventListener('mouseover', (e) => {
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
  scroller.addEventListener('mouseout', (e) => { if (e.target.closest?.('.song-icons .inst')) hideTip(); });
  scroller.addEventListener('scroll', hideTip, { passive: true });

  const spacer = document.createElement('li');
  spacer.className = 'spacer';
  spacer.setAttribute('aria-hidden', 'true');
  scroller.replaceChildren(spacer);

  function makeRow(index) {
    const item = items[index];
    const el = document.createElement('li');
    el.style.top = `${offsets[index]}px`;
    if (colOf) el.style.setProperty('--col', String(colOf[index]));
    if (item.type === 'head') {
      el.className = 'divider';
      el.style.height = `${HEAD_H}px`;
      el.textContent = item.label;
      el.setAttribute('role', 'presentation');
      return { el, timer: 0 };
    }
    const song = item.song;
    el.className = `row ${mode}` + (song === activeSong ? ' active' : '');
    el.style.height = `${rowH}px`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(song === activeSong));
    if (mode === 'compact') { // one line: Title — Artist
      el.innerHTML = '<span class="song-line"><span class="song-title"></span><span class="song-artist"></span></span>';
      el.querySelector('.song-title').textContent = text(song.title);
      el.querySelector('.song-artist').textContent = ` — ${text(song.artist)}`;
      el.title = `${text(song.title)} — ${text(song.artist)}`;
      el.addEventListener('click', () => onSelect(song));
      return { el, timer: 0 };
    }
    el.innerHTML = '<span class="thumb"><img alt="" decoding="async" hidden></span><span class="song-text"><span class="song-title"></span><span class="song-artist"></span></span>';
    el.querySelector('.song-title').textContent = text(song.title);
    el.querySelector('.song-artist').textContent = text(song.artist);
    if (mode === 'normal') { // the pack at the top right, next to the title
      const packName = describe(song).pack;
      if (packName) {
        const top = document.createElement('span');
        top.className = 'song-top';
        const title = el.querySelector('.song-title');
        title.replaceWith(top);
        const pack = document.createElement('span');
        pack.className = 'song-packtag';
        pack.textContent = packName;
        pack.title = packName;
        top.append(title, pack);
      }
    }
    if (mode === 'normal') { // the instruments the song has, as small icons to the right of the artist
      const sub = document.createElement('span');
      sub.className = 'song-sub';
      const artist = el.querySelector('.song-artist');
      artist.replaceWith(sub);
      sub.append(artist);
      const icons = document.createElement('span');
      icons.className = 'song-icons';
      for (const i of describe(song).instruments) {
        const ic = document.createElement('span');
        ic.className = 'inst';
        ic.dataset.label = i.label; // shown by the hover tip: the name and the difficulty level
        ic.dataset.level = i.level === null ? '' : String(i.level);
        ic.innerHTML = `<svg><use href="#i-${i.icon}"/></svg>${i.badge ? `<sup>${i.badge}</sup>` : ''}`;
        icons.append(ic);
      }
      sub.append(icons);
    }
    if (mode === 'large') {
      const d = describe(song);
      const facts = [d.album, d.year, d.length, d.genre].filter(Boolean);
      const text2 = el.querySelector('.song-text');
      const meta = document.createElement('span');
      meta.className = 'song-meta';
      meta.textContent = facts.join(' · ');
      text2.append(meta);
      if (d.pack) {
        const pack = document.createElement('span');
        pack.className = 'song-pack';
        pack.innerHTML = '<svg><use href="#i-package"/></svg><span></span>';
        pack.querySelector('span').textContent = d.pack;
        text2.append(pack);
      }
      const insts = document.createElement('span');
      insts.className = 'song-insts';
      for (const i of d.instruments) {
        const chip = document.createElement('span');
        chip.className = 'inst';
        chip.title = i.level === null ? i.label : `${i.label}: level ${i.level}`;
        const pips = i.level === null ? '' : `<span class="mini-pips">${Array.from({ length: 6 }, (_, k) => `<i${k < i.level ? ' class="on"' : ''}></i>`).join('')}</span>`; // no pips when song.ini has no level
        chip.innerHTML = `<svg><use href="#i-${i.icon}"/></svg>${i.badge ? `<sup>${i.badge}</sup>` : ''}${pips}`;
        insts.append(chip);
      }
      text2.append(insts);
    }
    el.addEventListener('click', () => onSelect(song));
    const entry = { el, timer: 0 };
    const cached = thumbs.peek(song);
    const img = el.querySelector('img');
    const show = (url) => { if (url && rows.get(index) === entry) { img.src = url; img.hidden = false; } };
    if (cached) { img.src = cached; img.hidden = false; } // already in memory: show it right away (the row is not in the map yet)
    else {
      entry.timer = setTimeout(() => {
        entry.timer = 0;
        thumbs.get(song, () => rows.get(index) === entry).then(show);
      }, THUMB_DELAY_MS);
    }
    return entry;
  }

  function css(name, fallback) {
    return getComputedStyle(scroller).getPropertyValue(name).trim() || fallback;
  }

  // Ticks for every group header and a short label at the first group of each initial / decade / bucket.
  function drawRail() {
    if (!rail) return;
    const H = rail.clientHeight;
    const W = rail.clientWidth;
    const off = range() <= 0 || H <= 0; // nothing to scroll: the rail is invisible but keeps its size
    rail.classList.toggle('off', off);
    if (off) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    const th = thumbH();
    const tick = css('--line', '#2a3140');
    const muted = css('--muted', '#8b95a7');
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
    for (let i = first; i < last; i++) {
      if (rows.has(i)) continue;
      const entry = makeRow(i);
      rows.set(i, entry);
      scroller.append(entry.el);
    }
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
    // to the right of the rail when the window has room for it there, otherwise to the left (over the list)
    const room = window.innerWidth - rail.getBoundingClientRect().right - 8;
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
  // With a minimum card width, the columns follow the list's width.
  function autoColumns() {
    if (!minColW) return;
    const railW = parseFloat(getComputedStyle(scroller.closest('.songs-wrap') ?? scroller).getPropertyValue('--rail-w')) || 0;
    const next = Math.max(1, Math.floor((scroller.clientWidth - railW) / minColW));
    if (next !== cols) { cols = next; relayout(true); }
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(autoColumns).observe(scroller);

  return {
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
      rowH = ROW_HEIGHTS[mode];
      relayout(true);
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
