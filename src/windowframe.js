// The geometry rules of the floating windows (the library and the settings), as pure functions: no DOM, no storage.
//
// Plan (what lives where):
//   - this file: the arithmetic shared by every window (content area width, room, clamping the user's width between a window's own
//     minimum and the room, the centred left position, the symmetric edge drag). Tested in test/windowframe.test.js.
//   - src/windowframe-dom.js: the DOM controller that applies those rules to one window element (--win-w, the edge handles, the drag,
//     the shared 'winWidth' preference, resize) and the open/closed state.
//   - styles.css, "Window frame" block: the shared look and motion (`.win-frame`: glass, radius, shadow, centring, insets for the
//     player bar, open animation, phone drawer).
//   - src/app.js: only what is specific to a window (the library's list/details split) and calls these functions for the rest.
//
// CONTENT_MAX, WIN_MARGIN and WIN_BORDER have CSS twins (--content-max, --lib-gap, the 1 px border): test/css-js-constants.test.js.

export const CONTENT_MAX = 1400; // the content area never gets narrower than this (same as the :root default of --content-max)
export const CONTENT_ABS_MAX = 3840; // ... and never wider than 4K
export const WIN_MARGIN = 12; // the gap between a window and the edge of the screen (--lib-gap)
export const SETTINGS_MIN_W = 560; // the narrowest the settings window may be made (the nav turns into a row of tabs below 760 px, in CSS)
export const WIN_BORDER = 2; // a window's own 1 px border, left and right: the panes share the width inside it

// The content area's width: `wanted` clamped between CONTENT_MAX and 4K. (The library asks for more than 1400 when the "Maximum width"
// of the details needs it.)
export const contentMaxFor = (wanted) => Math.min(CONTENT_ABS_MAX, Math.max(CONTENT_MAX, wanted));

// The room a window's panes may take in a container `containerW` wide: the content area (`contentMax`, centred) between its two
// margins, minus the border.
export const roomFor = (containerW, contentMax, margin = WIN_MARGIN, border = WIN_BORDER) =>
  Math.max(0, containerW - 2 * Math.max(margin, (containerW - contentMax) / 2) - border);

// The width a window gets: the user's preferred width (null = none: the whole room) between the window's own minimum and the room.
// (When the room is smaller than the minimum the room wins: the window never overflows the screen.)
export const clampWidth = (pref, min, room) => (pref == null ? room : Math.min(room, Math.max(min, pref)));

// The left position of a window `winW` wide (border included) centred in the container, never closer than `margin` to the edge.
export const centeredLeft = (containerW, winW, margin = WIN_MARGIN) => Math.max(margin, (containerW - winW) / 2);

// Dragging one edge of a centred window by `dx` px moves both edges: the width changes by 2*dx (the right edge, side +1, grows with a
// positive dx; the left edge, side -1, with a negative one). Clamped like clampWidth.
export const dragWidth = (startW, dx, side, min, room) => clampWidth(Math.round(startW + 2 * side * dx), min, room);
