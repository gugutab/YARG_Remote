// Regression tests for the server hardening batch: path traversal inside the app root, malformed URLs, loopback
// default + Host check, /songs extension allowlist and headers, generic 500 body.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';

const SERVER_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');

// Raw request: the path goes out exactly as given (fetch/URL would normalise some of the tricks).
function raw(base, reqPath, headers = {}, method = 'GET') {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: reqPath, method, headers, timeout: 3000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function makeApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-app-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put('index.html', '<html>index</html>');
  put('styles.css', 'body{}');
  put('src/app.js', 'export default 1;');
  put('src/.hidden.js', 'hidden');
  put('src/notes.md', 'markdown');
  put('vendor/soundtouch.js', 'vendor');
  put('vendor/README.md', 'readme');
  put('server.mjs', 'SERVER SECRET');
  put('package.json', '{"secret":1}');
  put('CLAUDE.md', 'notes');
  put('README.md', 'readme');
  put('.git/config', 'GIT SECRET');
  put('.cache/library.json', 'CACHE SECRET');
  put('test/x.test.js', 'test');
  put('scripts/s.mjs', 'script');
  return root;
}

function makeSongs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-songs-'));
  const song = path.join(dir, 'Pack', 'Band - Song');
  fs.mkdirSync(song, { recursive: true });
  fs.writeFileSync(path.join(song, 'song.ini'), '[song]\nname = S\n');
  fs.writeFileSync(path.join(song, 'song.ogg'), '0123456789');
  for (const name of ['evil.html', 'evil.js', 'evil.svg', 'evil.css', 'evil.mjs', 'noext']) fs.writeFileSync(path.join(song, name), '<script>alert(1)</script>');
  return dir;
}

async function withServer(opts, fn) {
  const appRoot = makeApp();
  const songsDir = makeSongs();
  const server = createServer({ songsDir, appRoot, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, { appRoot, songsDir });
  } finally {
    server.close();
    server.closeAllConnections?.();
    fs.rmSync(appRoot, { recursive: true, force: true });
    fs.rmSync(songsDir, { recursive: true, force: true });
  }
}

test('item 1: encoded traversal inside the app root is refused', async () => {
  await withServer({}, async (base) => {
    const attacks = [
      '/src/..%2fserver.mjs', '/src/..%5cpackage.json', '/vendor/..%2f.git/config', '/src/..%2f.cache/library.json',
      '/src/..%2fCLAUDE.md', '/src/..%2fREADME.md', '/src/..%2ftest/x.test.js', '/src/..%2fscripts/s.mjs',
      '/src/%2e%2e%2fserver.mjs', '/src/%2e%2e/server.mjs', '/src/..%2f..%2fserver.mjs', '/src/%252e%252e%252fserver.mjs',
      '/src/.hidden.js', '/src/notes.md', '/vendor/README.md', '/src%2f..%2fserver.mjs', '/src/%00.js', '/src/app.js%00.txt',
      '/server.mjs', '/package.json', '/CLAUDE.md', '/.git/config', '/.cache/library.json', '/test/x.test.js', '/src/..%5c..%5cserver.mjs',
      '/src/%ZZ', '/src/app.js::$DATA',
    ];
    for (const p of attacks) {
      const r = await raw(base, p);
      assert.ok(r.status >= 400, `${p} -> ${r.status}`);
      assert.ok(!/SECRET|"secret"|readme|markdown|hidden/.test(r.body), `${p} leaked`);
    }
  });
});

test('item 1: the app files the page needs are still served', async () => {
  await withServer({}, async (base) => {
    for (const [p, type] of [['/', 'text/html'], ['/index.html', 'text/html'], ['/styles.css', 'text/css'],
      ['/src/app.js', 'text/javascript'], ['/vendor/soundtouch.js', 'text/javascript']]) {
      const r = await raw(base, p);
      assert.equal(r.status, 200, p);
      assert.ok(r.headers['content-type'].startsWith(type), p);
    }
  });
});

test('item 1: /songs refuses a symlink that escapes the songs folder', async (t) => {
  await withServer({}, async (base, { songsDir }) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yarg-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.ogg'), 'OUTSIDE');
    try {
      fs.symlinkSync(path.join(outside, 'secret.ogg'), path.join(songsDir, 'Pack', 'link.ogg'));
      fs.symlinkSync(outside, path.join(songsDir, 'Pack', 'linkdir'), 'junction');
    } catch {
      fs.rmSync(outside, { recursive: true, force: true });
      t.skip('cannot create symlinks here');
      return;
    }
    try {
      for (const p of ['/songs/Pack/link.ogg', '/songs/Pack/linkdir/secret.ogg']) {
        const r = await raw(base, p);
        assert.ok(r.status >= 400, `${p} -> ${r.status}`);
        assert.ok(!r.body.includes('OUTSIDE'));
      }
      assert.equal((await raw(base, '/songs/Pack/Band%20-%20Song/song.ogg')).body, '0123456789');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('item 2: a malformed request target answers 4xx and the server keeps running', async () => {
  await withServer({}, async (base) => {
    for (const p of ['//[', '/%', '/songs/%E0%A4%A','/\\\\']) {
      const r = await raw(base, p);
      assert.ok(r.status >= 400 && r.status < 500, `${p} -> ${r.status}`);
    }
    assert.equal((await raw(base, '/')).status, 200);
  });
});

test('item 2/3: the real process binds loopback by default and survives a malformed URL', async () => {
  const songs = makeSongs();
  const child = spawn(process.execPath, [SERVER_FILE, songs], { env: { ...process.env, PORT: '0', HOST: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 5000);
      child.stdout.on('data', (d) => {
        out += d;
        const m = /(http:\/\/[\d.:[\]a-z]+)/i.exec(out);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      child.on('exit', () => reject(new Error(`server exited: ${out}`)));
    });
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/, 'default HOST is loopback');
    assert.ok((await raw(url, '//[')).status >= 400);
    assert.equal((await raw(url, '/')).status, 200);
    assert.equal((await raw(url, '/', { Host: 'evil.example' })).status, 403);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill();
    fs.rmSync(songs, { recursive: true, force: true });
  }
});

test('item 3: loopback bind rejects Host headers that are not IP literals, localhost or the machine name', async () => {
  await withServer({ host: '127.0.0.1' }, async (base) => {
    const ok = ['127.0.0.1:8080', 'localhost', 'localhost:8080', '[::1]:8080', '10.1.2.3', os.hostname()];
    for (const h of ok) assert.equal((await raw(base, '/', { Host: h })).status, 200, h);
    const bad = ['evil.example', 'evil.example:8080', '127.0.0.1.evil.example', 'localhost.evil.example', 'a b'];
    for (const h of bad) assert.ok((await raw(base, '/', { Host: h })).status >= 400, `Host ${JSON.stringify(h)}`);
    assert.ok((await raw(base, '/api/library', { Host: 'evil.example' })).status >= 400);
  });
});

test('item 3: an explicit non-loopback bind keeps accepting any Host', async () => {
  await withServer({ host: '0.0.0.0' }, async (base) => {
    assert.equal((await raw(base, '/', { Host: 'my-pc.lan:8080' })).status, 200);
  });
});

test('item 3: scripts bind loopback by default', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(SERVER_FILE), 'package.json'), 'utf8'));
  assert.match(pkg.scripts['start:static'], /--bind 127\.0\.0\.1/);
  assert.ok(!pkg.scripts['start:static'].includes('0.0.0.0'));
  assert.equal(pkg.scripts.start, 'node server.mjs');
});

test('item 4: /songs serves only song-pack extensions, with nosniff and a sandbox CSP', async () => {
  await withServer({}, async (base) => {
    const dir = '/songs/Pack/Band%20-%20Song/';
    for (const name of ['evil.html', 'evil.js', 'evil.svg', 'evil.css', 'evil.mjs', 'noext']) {
      const r = await raw(base, dir + name);
      assert.equal(r.status, 403, `${name} -> ${r.status}`);
      assert.ok(!r.body.includes('alert'), name);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
    }
    const ok = await raw(base, dir + 'song.ogg');
    assert.equal(ok.status, 200);
    assert.equal(ok.body, '0123456789');
    assert.equal(ok.headers['content-security-policy'], 'sandbox');
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    assert.equal((await raw(base, dir + 'song.ini')).status, 200);
  });
});

test('item 4: every response carries nosniff, including errors and the app', async () => {
  await withServer({}, async (base) => {
    for (const [p, method] of [['/', 'GET'], ['/nope', 'GET'], ['/src/app.js', 'GET'], ['/api/library', 'GET'], ['//[', 'GET'], ['/', 'POST']]) {
      const r = await raw(base, p, {}, method);
      assert.equal(r.headers['x-content-type-options'], 'nosniff', `${method} ${p}`);
    }
  });
});

test('item 4: the 500 handler logs the error but does not echo it', async () => {
  const secret = 'SECRET-INTERNAL-PATH C:\\private';
  const origError = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try {
    await withServer({ scan: async () => { throw new Error(secret); } }, async (base) => {
      const r = await raw(base, '/api/library?refresh');
      assert.equal(r.status, 500);
      assert.ok(!r.body.includes('SECRET') && !r.body.includes('private'), r.body);
    });
  } finally {
    console.error = origError;
  }
  assert.ok(logged.some((l) => l.includes('SECRET-INTERNAL-PATH')), 'error is logged server-side');
});
