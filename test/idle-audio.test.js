import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suspendDue, settlesWithin, SUSPEND_AFTER_MS } from '../src/clock.js';
import { AudioIdle, LegacyPlayer } from '../src/player.js';
import { createThumbs } from '../src/thumbs.js';
import { EDGE_FADE_STOPS, BOTTOM_FADE_STOPS, LYRIC_RAMP_STOPS } from '../src/gfx.js';

test('suspendDue: only after being paused long enough', () => {
  assert.equal(suspendDue(true, 0, 1e9), false); // playing
  assert.equal(suspendDue(false, null, 1e9), false); // never paused
  assert.equal(suspendDue(false, 1000, 1000 + SUSPEND_AFTER_MS - 1), false);
  assert.equal(suspendDue(false, 1000, 1000 + SUSPEND_AFTER_MS), true);
});

test('settlesWithin: true when it settles in time, false on a timeout or a rejection', async () => {
  assert.equal(await settlesWithin(Promise.resolve(), 50), true);
  assert.equal(await settlesWithin(new Promise(() => {}), 20), false);
  assert.equal(await settlesWithin(Promise.reject(new Error('x')), 50), false);
});

function fakeCtx(state = 'running') {
  const ctx = {
    state, calls: [],
    suspend: async () => { ctx.calls.push('suspend'); ctx.state = 'suspended'; },
    resume: () => { ctx.calls.push('resume'); return ctx.neverResume ? new Promise(() => {}) : Promise.resolve().then(() => { ctx.state = 'running'; }); },
  };
  return ctx;
}

test('AudioIdle suspends after the delay and resumes for play', async () => {
  const ctx = fakeCtx();
  const idle = new AudioIdle(ctx, 20);
  idle.arm();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(ctx.calls, ['suspend']);
  assert.equal(await idle.ensureRunning(), true);
  assert.deepEqual(ctx.calls, ['suspend', 'resume']);
  assert.equal(ctx.state, 'running');
});

test('AudioIdle: playing again before the delay cancels the suspend', async () => {
  const ctx = fakeCtx();
  const idle = new AudioIdle(ctx, 30);
  idle.arm();
  assert.equal(await idle.ensureRunning(), true);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(ctx.calls, []);
});

test('AudioIdle: a resume that never settles does not hang play()', async () => {
  const ctx = fakeCtx('suspended');
  ctx.neverResume = true;
  const idle = new AudioIdle(ctx, 20);
  const t0 = Date.now();
  assert.equal(await idle.ensureRunning(), false);
  assert.ok(Date.now() - t0 < 5000);
});

test('AudioIdle ignores a context without suspend() (the unit-test fakes)', () => {
  const idle = new AudioIdle({}, 1);
  idle.arm();
  assert.equal(idle.timer, null);
});

test('LegacyPlayer.play stays paused when the context cannot resume', async () => {
  const ctx = fakeCtx('suspended');
  ctx.neverResume = true;
  const p = new LegacyPlayer(ctx, {});
  p.stems = new Map([['a', { buffer: { duration: 1 }, gain: {} }]]);
  p.duration = 1;
  p.idle = new AudioIdle(ctx, 20);
  p.startSources = () => { p.playing = true; };
  await p.play();
  assert.equal(p.playing, false);
});

test('a failed cover fetch is not remembered as "no cover"', async () => {
  const saved = [];
  let fail = true;
  const thumbs = createThumbs({
    render: async () => { if (fail) throw new Error('503'); return new Blob(['x']); },
    save: async (id, v) => { saved.push([id, v]); },
    makeUrl: () => 'blob:x', revoke() {},
  });
  assert.equal(await thumbs.get({ id: 'a' }), null);
  assert.deepEqual(saved, []); // nothing persisted
  const none = createThumbs({ render: async () => null, save: async (id, v) => { saved.push([id, v]); } });
  assert.equal(await none.get({ id: 'b' }), null);
  assert.deepEqual(saved, [['b', 'none']]); // no cover entry: 'none' is saved
});

test('edge fade stop lists are non-decreasing in position and end opaque/transparent as drawn', () => {
  for (const list of [EDGE_FADE_STOPS, BOTTOM_FADE_STOPS, LYRIC_RAMP_STOPS]) {
    for (let i = 1; i < list.length; i++) assert.ok(list[i][0] > list[i - 1][0]);
  }
  assert.equal(EDGE_FADE_STOPS.length, 13);
  assert.equal(EDGE_FADE_STOPS[0][1], 'rgba(0,0,0,1.000)');
  assert.equal(BOTTOM_FADE_STOPS.at(-1)[1], 'rgba(0,0,0,1)');
});
