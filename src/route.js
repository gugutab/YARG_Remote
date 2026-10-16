// The app's screens are addressed by the URL hash, so the browser's Back/Forward and a reload keep working:
//   #/                                      the library (home screen)
//   #/song/<id>                             the details of a song
//   #/song/<id>/play                        the player (chart) of a song
//   #/song/<id>/play?i=guitar:expert,bass   the instruments on screen: the active one first, then the others
//                                           (instrument id, and its difficulty after a colon when it has one)
// <id> is the song's library id (its folder path), URI-encoded.

const DIFFICULTY_IDS = new Set(['easy', 'medium', 'hard', 'expert']); // DIFFICULTIES in chart.js

export function parseRoute(hash = '') {
  const m = /^#\/song\/([^/?]+)(\/play)?\/?(?:\?(.*))?$/.exec(String(hash));
  if (!m) return { view: 'library' };
  let id;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return { view: 'library' };
  }
  const route = { view: m[2] ? 'play' : 'song', id };
  const list = m[3] ? new URLSearchParams(m[3]).get('i') : null;
  if (list) {
    const instruments = list.split(',').filter(Boolean).map((part) => {
      const [ins, diff] = part.split(':');
      return DIFFICULTY_IDS.has(diff) ? { id: ins, diff } : { id: ins }; // an unknown difficulty is dropped, not passed on
    });
    if (instruments.length) route.instruments = instruments;
  }
  return route;
}

export function formatRoute({ view, id, instruments } = {}) {
  if (!id || (view !== 'song' && view !== 'play')) return '#/';
  const list = (instruments || []).map((x) => (x.diff ? `${x.id}:${x.diff}` : x.id)).join(',');
  return `#/song/${encodeURIComponent(id)}${view === 'play' ? '/play' : ''}${list ? `?i=${list}` : ''}`;
}
