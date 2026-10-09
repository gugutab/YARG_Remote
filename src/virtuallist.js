// A windowed list for the library: only the rows near the viewport exist in the DOM, so ~750 songs with album
// thumbnails scroll smoothly and stay light on memory. Items are fixed-height song rows and group headers.

export const ROW_H = 56;
export const HEAD_H = 26;
const OVERSCAN_PX = 5 * ROW_H;
const THUMB_DELAY_MS = 120; // a row asks for its thumbnail only after it stayed visible this long (skips flings)

// offsets[i] = top of item i, offsets[n] = total height.
export function layoutOffsets(items) {
  const offsets = new Float64Array(items.length + 1);
  for (let i = 0; i < items.length; i++) offsets[i + 1] = offsets[i] + (items[i].type === 'head' ? HEAD_H : ROW_H);
  return offsets;
}

// Index range [first, last) of the items that intersect [scrollTop - overscan, scrollTop + height + overscan].
export function visibleRange(offsets, scrollTop, height, overscan = OVERSCAN_PX) {
  const n = offsets.length - 1;
  if (n <= 0) return [0, 0];
  const lo = Math.max(0, scrollTop - overscan);
  const hi = scrollTop + height + overscan;
  // first item whose bottom is below lo
  let a = 0;
  let b = n;
  while (a < b) {
    const m = (a + b) >> 1;
    if (offsets[m + 1] <= lo) a = m + 1; else b = m;
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
export function railScroll(y, range, railH, thumbH) {
  const f = railH - thumbH > 0 ? (y - thumbH / 2) / (railH - thumbH) : 0;
  return Math.min(1, Math.max(0, f)) * range;
}

export function createVirtualList({ scroller, label, rail, thumbs, onSelect, text, anchor = (l) => l[0] }) {
  let items = [];
  let offsets = layoutOffsets(items);
  const rows = new Map(); // index -> { el, timer }
  let activeSong = null;
  let frame = 0;
  let groups = []; // { index, label, anchor } of the headers, for the rail
  const canvas = rail?.querySelector('canvas');
  const railThumb = rail?.querySelector('.rail-thumb');
  const bubble = rail?.querySelector('.rail-bubble');
  const range = () => Math.max(0, offsets[items.length] - scroller.clientHeight);
  const thumbH = () => Math.min(rail.clientHeight, Math.max(28, (scroller.clientHeight / Math.max(1, offsets[items.length])) * rail.clientHeight));

  const spacer = document.createElement('li');
  spacer.className = 'spacer';
  spacer.setAttribute('aria-hidden', 'true');
  scroller.replaceChildren(spacer);

  function makeRow(index) {
    const item = items[index];
    const el = document.createElement('li');
    el.style.top = `${offsets[index]}px`;
    if (item.type === 'head') {
      el.className = 'divider';
      el.style.height = `${HEAD_H}px`;
      el.textContent = item.label;
      el.setAttribute('role', 'presentation');
      return { el, timer: 0 };
    }
    const song = item.song;
    el.className = 'row' + (song === activeSong ? ' active' : '');
    el.style.height = `${ROW_H}px`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(song === activeSong));
    el.innerHTML = '<span class="thumb"><img alt="" decoding="async" hidden></span><span class="song-text"><span class="song-title"></span><span class="song-artist"></span></span>';
    el.querySelector('.song-title').textContent = text(song.title);
    el.querySelector('.song-artist').textContent = text(song.artist);
    el.addEventListener('click', () => onSelect(song));
    const entry = { el, timer: 0 };
    const cached = thumbs.peek(song);
    const img = el.querySelector('img');
    const show = (url) => { if (url && rows.get(index) === entry) { img.src = url; img.hidden = false; } };
    if (cached) show(cached);
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
    g.font = '600 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let lastText = null;
    let lastY = -99;
    for (const gr of groups) {
      const y = railPos(offsets[gr.index], range(), H, th);
      const isAnchor = gr.anchor !== lastText;
      if (isAnchor && y - lastY >= 11) {
        g.fillStyle = muted;
        g.fillText(gr.anchor, 8, y);
        lastY = y;
      }
      if (isAnchor) lastText = gr.anchor;
      g.fillStyle = isAnchor ? muted : tick;
      g.fillRect(W - 6, Math.round(y), isAnchor ? 5 : 3, 1);
    }
    railThumb.style.height = `${th}px`;
  }

  function updateThumb() {
    if (!rail || rail.classList.contains('off')) return;
    const th = thumbH();
    const y = railPos(scroller.scrollTop, range(), rail.clientHeight, th) - th / 2;
    railThumb.style.transform = `translateY(${y}px)`;
  }

  function render() {
    frame = 0;
    const top = scroller.scrollTop;
    const [first, last] = visibleRange(offsets, top, scroller.clientHeight);
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
    let target = railScroll(y, range(), box.height, th);
    for (const gr of groups) {
      if (Math.abs(railPos(offsets[gr.index], range(), box.height, th) - y) <= 4) { target = Math.min(offsets[gr.index], range()); break; }
    }
    return { target, y, height: box.height };
  }
  function showBubble(text, y, height) {
    bubble.textContent = text;
    bubble.hidden = !text;
    bubble.style.top = `${Math.min(height - 12, Math.max(12, y))}px`;
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

  return {
    setItems(next, { keepScroll = false } = {}) {
      items = next;
      offsets = layoutOffsets(items);
      groups = items.flatMap((it, index) => (it.type === 'head' ? [{ index, label: it.label, anchor: anchor(it.label) }] : []));
      for (const entry of rows.values()) { clearTimeout(entry.timer); entry.el.remove(); }
      rows.clear();
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
    scrollToSong(song) { // only when the row is not already fully visible
      const i = items.findIndex((it) => it.type === 'song' && it.song === song);
      if (i < 0) return;
      const top = offsets[i];
      const h = scroller.clientHeight;
      if (top < scroller.scrollTop || top + ROW_H > scroller.scrollTop + h) scroller.scrollTop = Math.max(0, top - h / 2);
    },
    get renderedCount() { return rows.size; },
  };
}
