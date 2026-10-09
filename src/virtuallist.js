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

export function createVirtualList({ scroller, label, thumbs, onSelect, text }) {
  let items = [];
  let offsets = layoutOffsets(items);
  const rows = new Map(); // index -> { el, timer }
  let activeSong = null;
  let frame = 0;

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
      label.style.right = `${scroller.offsetWidth - scroller.clientWidth}px`; // keep the scrollbar uncovered
      const idx = itemAt(offsets, top);
      let head = '';
      for (let i = idx; i >= 0; i--) if (items[i]?.type === 'head') { head = items[i].label; break; }
      label.textContent = head;
      label.hidden = !head;
    }
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  scroller.addEventListener('scroll', schedule, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(scroller);

  return {
    setItems(next, { keepScroll = false } = {}) {
      items = next;
      offsets = layoutOffsets(items);
      for (const entry of rows.values()) { clearTimeout(entry.timer); entry.el.remove(); }
      rows.clear();
      spacer.style.height = `${offsets[items.length]}px`;
      if (!keepScroll) scroller.scrollTop = 0;
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
