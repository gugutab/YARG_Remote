// Full-screen image viewer: a modal dialog over the page. Esc, a click anywhere or the close button dismisses it and focus goes back to the opener.
let open = null;

export function closeImageViewer() { open?.(); }

export function openImageViewer(src, alt = '') {
  if (!src || open) return;
  const opener = document.activeElement;
  const root = document.createElement('div');
  root.className = 'img-viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', alt || 'Album art');
  root.tabIndex = -1;
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon img-viewer-close';
  close.setAttribute('aria-label', 'Close');
  close.title = 'Close (Esc)';
  close.innerHTML = '<svg><use href="#i-x"/></svg>';
  root.append(img, close);
  const dismiss = () => {
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    open = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); }
    else if (e.key === 'Tab') { e.preventDefault(); close.focus(); } // the close button is the only stop
    else e.stopPropagation(); // shortcuts (space, arrows, M...) must not reach the player behind
  };
  root.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  open = dismiss;
  close.focus({ preventScroll: true });
}

// Makes an <img> open the viewer on click or Enter/Space (only while it has a picture).
export function makeZoomable(img, label) {
  img.tabIndex = 0;
  img.setAttribute('role', 'button');
  img.setAttribute('aria-label', label);
  img.classList.add('zoomable');
  const go = () => { if (img.src && !img.hidden) openImageViewer(img.currentSrc || img.src, img.dataset.alt || ''); };
  img.addEventListener('click', (e) => { e.stopPropagation(); go(); });
  img.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(); } });
}
