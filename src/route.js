// The app's screens are addressed by the URL hash, so the browser's Back/Forward and a reload keep working:
//   #/                                      the library (home screen)
//   #/song/<id>                             the details of a song
//   #/song/<id>/play                        the player (chart) of a song
//   #/song/<id>/play?i=guitar:expert,bass   the instruments on screen: the active one first, then the others
//                                           (instrument id, and its difficulty after a colon when it has one)
//   #/song/<id>/play?i=drums-pro:expert&t=27.9   the song position in seconds the player opens at (paused at that point)
// <id> is the song's library id (its folder path), URI-encoded.

export const MAX_LINK_TIME = 36000;
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
  const params = m[3] ? new URLSearchParams(m[3]) : null;
  const list = params ? params.get('i') : null;
  const at = params?.get('t');
  if (at !== null && at !== undefined && at !== '') { // a position in seconds: a finite number from 0 to 10 hours, one decimal
    const secs = Number(at);
    if (Number.isFinite(secs) && secs >= 0 && secs <= MAX_LINK_TIME) route.time = Math.round(secs * 10) / 10;
  }
  if (list) {
    const instruments = list.split(',').filter(Boolean).map((part) => {
      const [ins, diff] = part.split(':');
      return DIFFICULTY_IDS.has(diff) ? { id: ins, diff } : { id: ins }; // an unknown difficulty is dropped, not passed on
    });
    if (instruments.length) route.instruments = instruments;
  }
  return route;
}

export function formatRoute({ view, id, instruments, time } = {}) {
  if (!id || (view !== 'song' && view !== 'play')) return '#/';
  const list = (instruments || []).map((x) => (x.diff ? `${x.id}:${x.diff}` : x.id)).join(',');
  const query = [];
  if (list) query.push(`i=${list}`);
  if (Number.isFinite(time) && time > 0 && time <= MAX_LINK_TIME) query.push(`t=${Math.round(time * 10) / 10}`);
  return `#/song/${encodeURIComponent(id)}${view === 'play' ? '/play' : ''}${query.length ? `?${query.join('&')}` : ''}`;
}
