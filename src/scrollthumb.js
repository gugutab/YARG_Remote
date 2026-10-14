// A slim overlay scrollbar in the style of the library's rail (a soft blue thumb flush with the edge): the native scrollbar of
// the scroller is hidden (CSS class `thumb-scroll`) and a track + thumb are laid over its right edge. Drag the thumb, or press
// the track to jump there. Pure DOM glue; the maths is `thumbGeometry`, tested without a browser.

// -> { size, offset, visible } of the thumb for a scroller (all px).
export function thumbGeometry({ clientHeight, scrollHeight, scrollTop, trackHeight = clientHeight, minThumb = 32 }) {
  if (scrollHeight <= clientHeight + 1 || trackHeight <= 0) return { size: 0, offset: 0, visible: false };
  const size = Math.min(trackHeight, Math.max(minThumb, (trackHeight * clientHeight) / scrollHeight));
  const room = trackHeight - size;
  const range = scrollHeight - clientHeight;
  const offset = room * Math.min(1, Math.max(0, scrollTop / range));
  return { size, offset, visible: true };
}

// scrollTop for a thumb dragged so its top is at `thumbTop` (px from the track top).
export function scrollTopFor({ clientHeight, scrollHeight, trackHeight = clientHeight, size, thumbTop }) {
  const room = Math.max(1, trackHeight - size);
  return Math.min(1, Math.max(0, thumbTop / room)) * (scrollHeight - clientHeight);
}

export function attachScrollThumb(scroller) {
  const host = scroller.parentElement; // must be positioned (position: relative)
  scroller.classList.add('thumb-scroll');
  const track = document.createElement('div');
  track.className = 'sthumb-track';
  const thumb = document.createElement('div');
  thumb.className = 'sthumb';
  track.append(thumb);
  host.append(track);

  const geo = () => thumbGeometry({ clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight, scrollTop: scroller.scrollTop });
  function update() {
    track.style.top = `${scroller.offsetTop}px`;
    track.style.height = `${scroller.clientHeight}px`;
    const g = geo();
    track.classList.toggle('off', !g.visible);
    thumb.style.height = `${g.size}px`;
    thumb.style.transform = `translateY(${g.offset}px)`;
  }
  scroller.addEventListener('scroll', update, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(scroller);
  for (const kid of scroller.children) ro.observe(kid);
  new MutationObserver(update).observe(scroller, { childList: true, subtree: true });

  let drag = null;
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    const g = geo();
    const r = track.getBoundingClientRect();
    if (e.target === thumb) drag = { grab: e.clientY - r.top - g.offset };
    else { // a press on the track: the thumb centres there and goes on with the drag
      drag = { grab: g.size / 2 };
      scroller.scrollTop = scrollTopFor({ clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight, size: g.size, thumbTop: e.clientY - r.top - drag.grab });
    }
    track.classList.add('dragging');
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const g = geo();
    const r = track.getBoundingClientRect();
    scroller.scrollTop = scrollTopFor({ clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight, size: g.size, thumbTop: e.clientY - r.top - drag.grab });
  });
  const end = () => { drag = null; track.classList.remove('dragging'); };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  update();
  return { update };
}
