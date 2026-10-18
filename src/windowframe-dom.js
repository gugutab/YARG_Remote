// The DOM side of the window frame (see src/windowframe.js for the plan): one controller that puts the shared geometry rules on a window
// element. The library (#library) and the settings (#settingsPage) both get one, so the width, the edge handles, the drag, the remembered
// width and the open/closed state work the same for both; the look and the motion are the `.win-frame` rules in styles.css.
import { WIN_BORDER, roomFor, clampWidth, dragWidth } from './windowframe.js';

export const PHONE_MAX = 700; // at this width and below a window is the full-height drawer (the same breakpoint as the CSS)
export const isPhone = () => window.matchMedia(`(max-width: ${PHONE_MAX}px)`).matches;

// The width the user chose by dragging an edge (null = the full content width). ONE value for every window (only one is open at a time),
// remembered under the store key 'winWidth' (store: { get(key), set(key, value) }).
export function createWidthPref(store) {
  let value = Number(store.get('winWidth')) > 0 ? Number(store.get('winWidth')) : null;
  return {
    get: () => value,
    set(px) { value = px == null ? null : Math.round(px); store.set('winWidth', value == null ? '' : String(value)); },
    peek(px) { value = px == null ? null : Math.round(px); }, // (while dragging: no write yet)
  };
}

const EDGE_HINT = 'Drag to resize the window (double-click for the full width)';
// The two edge handles, with the markup the library's own #edgeL / #edgeR have in index.html.
function makeEdge(side, label) {
  const e = document.createElement('div');
  e.className = `win-edge win-edge-${side}`;
  e.setAttribute('role', 'separator');
  e.setAttribute('aria-orientation', 'vertical');
  e.setAttribute('aria-label', label);
  e.title = EDGE_HINT;
  return e;
}

// el: the window element. prefs: createWidthPref(). container(): the width the window is centred in (the stage). contentMax(): the content
// area's width. minWidth(): this window's narrowest width (panes, border not included). relayout(): the window's own layout pass (it must
// end in setWidth()); the default is layout(). widthVars: the element whose style gets --win-w (the window itself unless something outside
// it reads the variable too: the library's .app). edges: the existing [left, right] handles, or none to have them created.
export function createWindowFrame({ el, prefs, container, contentMax, minWidth, relayout, widthVars = el, edges, label = 'Make the window narrower or wider' }) {
  let applied = 0; // the panes' width as last laid out (the window is WIN_BORDER wider)
  const frame = {
    el,
    room: () => roomFor(container(), contentMax()),
    // the width the window gets now: the user's width between this window's minimum and the room
    fit: () => clampWidth(prefs.get(), minWidth(), frame.room()),
    setWidth(panes) { applied = Math.round(panes); widthVars.style.setProperty('--win-w', `${applied + WIN_BORDER}px`); },
    clearWidth() { widthVars.style.removeProperty('--win-w'); },
    applied: () => applied,
    layout() { if (isPhone()) frame.clearWidth(); else frame.setWidth(frame.fit()); }, // (phone: the drawer's own CSS sizes it)
    // open/closed: `win-closed` slides it out and fades it (shared CSS); `inert` keeps focus and clicks out of it
    setClosed(closed) { el.classList.toggle('win-closed', closed); el.inert = closed; },
    isClosed: () => el.classList.contains('win-closed'),
  };
  const run = () => (relayout ?? frame.layout)();
  frame.relayout = run;

  const [edgeL, edgeR] = edges ?? [makeEdge('l', label), makeEdge('r', label)];
  if (!edges) el.prepend(edgeL, edgeR);
  // Drag an edge: both edges move (each pixel dragged changes the width by two), the window stays centred; double-click goes back to the
  // full content width.
  for (const edge of [edgeL, edgeR]) {
    const side = edge === edgeR ? 1 : -1;
    let drag = null;
    edge.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      edge.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, w: el.getBoundingClientRect().width - WIN_BORDER };
      edge.classList.add('dragging');
      document.body.classList.add('resizing');
    });
    edge.addEventListener('pointermove', (e) => {
      if (!drag) return;
      prefs.peek(dragWidth(drag.w, e.clientX - drag.x, side, minWidth(), frame.room()));
      run();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      edge.classList.remove('dragging');
      document.body.classList.remove('resizing');
      prefs.set(applied);
    };
    edge.addEventListener('pointerup', end);
    edge.addEventListener('pointercancel', end);
    edge.addEventListener('dblclick', () => { prefs.set(null); run(); });
  }
  window.addEventListener('resize', run); // a smaller browser window must not leave the window wider than the screen
  return frame;
}
