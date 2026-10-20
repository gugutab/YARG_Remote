// Keeps the screen awake while a song plays (Screen Wake Lock API), where the browser has it. `nav` is injectable for the tests.
export function createWakeLock(nav = typeof navigator === 'undefined' ? null : navigator, doc = typeof document === 'undefined' ? null : document) {
  let want = false;
  let lock = null;
  let busy = false;
  const acquire = async () => {
    if (!want || lock || busy || !nav?.wakeLock || doc?.visibilityState === 'hidden') return;
    busy = true;
    try {
      const l = await nav.wakeLock.request('screen');
      if (!want) { await l.release().catch(() => {}); } else { lock = l; l.addEventListener?.('release', () => { if (lock === l) lock = null; }); }
    } catch { /* refused (battery saver, no permission): playback goes on */ }
    busy = false;
  };
  doc?.addEventListener?.('visibilitychange', () => { if (doc.visibilityState === 'visible') acquire(); }); // (the browser drops the lock in a hidden tab)
  return {
    set(on) {
      want = !!on;
      if (want) acquire();
      else if (lock) { const l = lock; lock = null; l.release().catch(() => {}); }
    },
    get held() { return !!lock; },
  };
}
