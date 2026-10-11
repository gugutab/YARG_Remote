// The app's screens are addressed by the URL hash, so the browser's Back/Forward and a reload keep working:
//   #/                      the library (home screen)
//   #/song/<id>             the details of a song
//   #/song/<id>/play        the player (chart) of a song
// <id> is the song's library id (its folder path), URI-encoded.

export function parseRoute(hash = '') {
  const m = /^#\/song\/([^/]+)(\/play)?\/?$/.exec(String(hash));
  if (!m) return { view: 'library' };
  let id;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return { view: 'library' };
  }
  return { view: m[2] ? 'play' : 'song', id };
}

export function formatRoute({ view, id } = {}) {
  if (!id || (view !== 'song' && view !== 'play')) return '#/';
  return `#/song/${encodeURIComponent(id)}${view === 'play' ? '/play' : ''}`;
}
