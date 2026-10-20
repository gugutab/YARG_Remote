// ---------- End of song: the window ----------
// With the setting general.endScreen, a glass window (#endScreen) replaces the fretboards while the song is ended (and not dismissed): facts
// about each instrument on screen (songstats.js) and a few songs to play next (recommend.js). The ended / dismissed state itself, restart,
// "play next" and closing the song stay in app.js (playback); this module owns whether the window is shown (`isEndShown`).
// Moved out of app.js as is; app.js injects what it needs through `initEndUi(ctx)`, called where `list.bindTip(els.endNext)` used to run.
import { plainText } from './ini.js';
import { chartFacts, factRows } from './songstats.js';
import { recommend } from './recommend.js';

const NEXT_COUNT = 20;
let ctx = null;
let endShown = false;
export const isEndShown = () => endShown;

// ctx: { els, list, prefs, highway, ended(), endDismissed(), chart(), current(), infoOpen(), songs(), wakeUp(), closePopovers(), playNext(song), kv(rows) }
export function initEndUi(context) {
  ctx = context;
  ctx.list.bindTip(ctx.els.endNext); // the instrument icons of the suggestions show the same hover tip (name and difficulty) as in the library
}

export function syncEndScreen() {
  const { els } = ctx;
  const show = ctx.ended() && !ctx.endDismissed() && !!ctx.chart() && !!ctx.current() && !ctx.infoOpen() && ctx.prefs.get('general.endScreen');
  if (show === endShown) return;
  endShown = show;
  els.endScreen.hidden = !show;
  els.app.classList.toggle('song-ended', show);
  ctx.highway.invalidate();
  ctx.wakeUp();
  if (!show) return;
  ctx.closePopovers();
  els.paneMenu.hidden = true;
  buildEndScreen();
  els.endScreen.querySelector('.end-scroll').scrollTop = 0;
  if (!/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) els.endAgain.focus({ preventScroll: true });
}

function endCard(it) {
  const card = document.createElement('div');
  card.className = 'end-inst';
  const head = document.createElement('div');
  head.className = 'end-inst-head';
  head.innerHTML = `<svg><use href="#i-${it.icon}"/></svg><strong></strong><span class="end-diff"></span>`;
  head.querySelector('strong').textContent = it.name;
  const diff = head.querySelector('.end-diff');
  diff.textContent = it.diffLabel;
  diff.hidden = !it.diffLabel;
  const dl = document.createElement('dl');
  dl.className = 'end-facts';
  dl.append(...ctx.kv(factRows(chartFacts(it.chart), { base: it.base })));
  card.append(head, dl);
  return card;
}

function endRow(song, reason) {
  const li = ctx.list.cardFor(song, (picked) => ctx.playNext(picked)); // the library's own song card (its style and what it shows)
  li.title = `${plainText(song.title)} - ${plainText(song.artist)}${reason ? ` (${reason})` : ''}`;
  return li;
}

export function buildEndScreen() {
  const { els } = ctx;
  const current = ctx.current();
  const song = current.song;
  els.endTitle.textContent = plainText(song.title);
  els.endArtist.textContent = [plainText(song.artist), plainText(song.album)].filter(Boolean).join(' · ');
  els.endCover.src = current.coverUrl || '';
  els.endCover.hidden = !current.coverUrl;
  const screen = [...(current.screen || [])].sort((a, b) => Number(!!b.active) - Number(!!a.active));
  els.endCards.replaceChildren(...screen.map(endCard));
  els.endCards.hidden = screen.length === 0;
  const parts = [...new Set(screen.map((it) => (it.base === 'harmony' ? 'vocals' : it.base)))];
  const picks = recommend(song, ctx.songs(), { count: NEXT_COUNT, instruments: parts });
  els.endNext.replaceChildren(...picks.map((r) => endRow(r.song, r.reason)));
  els.endNextBox.hidden = picks.length === 0;
}
