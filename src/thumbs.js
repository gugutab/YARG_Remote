// Small album thumbnails for the library list. A thumbnail is a ~96 px JPEG made in the browser from the song's
// cover (the full image is never put in the page) and kept in two caches: an in-memory LRU of object URLs (bounded,
// revoked on eviction) and IndexedDB (so the next visit needs neither the network nor decoding big images).
// Jobs run a few at a time and are dropped if their row scrolled away before they started.

export class LruUrls {
  constructor(cap, revoke) {
    this.cap = cap;
    this.revoke = revoke;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const url = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, url); // most recently used goes last
    return url;
  }

  set(key, url) {
    if (this.map.has(key)) this.revoke(this.map.get(key));
    this.map.delete(key);
    this.map.set(key, url);
    while (this.map.size > this.cap) {
      const [oldKey, oldUrl] = this.map.entries().next().value;
      this.map.delete(oldKey);
      this.revoke(oldUrl);
    }
  }

  get size() { return this.map.size; }
}

// render(song) -> Blob | null ; load(id) -> Blob | 'none' | undefined ; save(id, Blob | 'none')
export function createThumbs({
  render, load = async () => undefined, save = async () => {}, cap = 300, concurrency = 3,
  makeUrl = (b) => URL.createObjectURL(b), revoke = (u) => URL.revokeObjectURL(u),
} = {}) {
  const lru = new LruUrls(cap, revoke);
  const missing = new Set(); // songs known to have no cover
  const pending = new Map(); // id -> promise
  const waiting = [];
  let running = 0;

  const pump = () => {
    while (running < concurrency && waiting.length) {
      const job = waiting.shift();
      running++;
      job().finally(() => { running--; pump(); });
    }
  };
  const enqueue = (fn) => new Promise((resolve) => {
    waiting.push(() => fn().then(resolve, () => resolve(null)));
    pump();
  });

  return {
    peek(song) { return lru.get(song.id); },
    get(song, wanted = () => true) {
      const id = song.id;
      const hit = lru.get(id);
      if (hit) return Promise.resolve(hit);
      if (missing.has(id)) return Promise.resolve(null);
      if (pending.has(id)) return pending.get(id);
      const p = enqueue(async () => {
        if (!wanted()) return null; // scrolled away before it started: nothing was spent
        let blob = await load(id);
        if (blob === undefined) {
          blob = (await render(song)) || 'none';
          await save(id, blob);
        }
        if (blob === 'none') { missing.add(id); return null; }
        const url = makeUrl(blob);
        lru.set(id, url);
        return url;
      }).finally(() => pending.delete(id));
      pending.set(id, p);
      return p;
    },
    get cached() { return lru.size; },
  };
}

// Browser side: cover file -> square JPEG blob of `size` px (center-cropped), or null when the song has no cover.
export async function renderCoverThumb(song, findCover, size = 96) {
  const entry = findCover(song);
  if (!entry) return null;
  let blob;
  if (entry.url) {
    const res = await fetch(entry.url);
    if (!res.ok) return null;
    blob = await res.blob();
  } else {
    blob = await entry.getFile();
  }
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { resizeWidth: size * 2, resizeQuality: 'medium' }); // decodes downscaled
  } catch (_) {
    bmp = await createImageBitmap(blob);
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const side = Math.min(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } finally {
    bmp.close();
  }
}
