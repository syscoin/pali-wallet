import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicViewLock } from '../src/core/publicViewLock.ts';
import { DEFAULT_MOBILE_IDLE_MINUTES, SecurityPreferences } from '../src/core/securityPreferences.ts';
import { DEFAULT_IDLE_MINUTES } from '../../../source/shared/idleLockPolicy.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { CustodyRuntime } from '../src/custody/types.ts';

const check = () => undefined;
function fixture(initial: string | null = null) {
  let raw = initial;
  const writes: string[] = [];
  const port = { get: async () => raw, async set(value: string) { writes.push(value); raw = value; } };
  return { view: new PublicViewLock(port), port, writes, raw: () => raw };
}
test('fresh mobile defaults to public entry and auto-lock Off without changing extension defaults', async () => {
  const f = fixture(); await f.view.load();
  assert.equal(f.view.getSnapshot().phase, 'unlocked'); assert.deepEqual(f.writes, []);
  const preferences = new SecurityPreferences({ get: async () => null, set: async () => undefined });
  const value = await preferences.load();
  assert.equal(DEFAULT_MOBILE_IDLE_MINUTES, 0); assert.equal(value.custodyIdleMinutes, 0); assert.equal(value.watchIdleMinutes, 0);
  assert.equal(DEFAULT_IDLE_MINUTES, 5);
});
test('manual lock hides immediately and survives a fresh instance', async () => {
  const f = fixture(); await f.view.load(); const pending = f.view.lock();
  assert.equal(f.view.getSnapshot().phase, 'locked'); await pending;
  const reopened = new PublicViewLock(f.port); await reopened.load();
  assert.equal(reopened.getSnapshot().phase, 'locked'); assert.throws(reopened.assertUnlocked);
});
test('view unlock requires completed owned authorization before persisting public entry', async () => {
  const f = fixture('locked'); await f.view.load();
  const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  let calls = 0;
  const pending = f.view.unlock(async (signal, guard) => { calls++; guard(); assert(!signal.aborted); started.resolve(); await finish.promise; guard(); }, check);
  await started.promise; assert.equal(f.raw(), 'locked'); assert.deepEqual(f.writes, []);
  finish.resolve(); await pending;
  assert.equal(calls, 1); assert.equal(f.raw(), 'unlocked'); f.view.assertUnlocked();
});
test('cancelled or failed OS authorization leaves the persistent privacy gate closed', async () => {
  for (const message of ['CREDENTIAL_USER_CANCELLED', 'CREDENTIAL_UNAVAILABLE']) {
    const f = fixture('locked'); await f.view.load();
    await assert.rejects(f.view.unlock(async () => { throw Error(message); }, check), new RegExp(message));
    assert.equal(f.raw(), 'locked'); assert.equal(f.view.getSnapshot().phase, 'locked'); assert.deepEqual(f.writes, []);
  }
});
test('a second lock cancels an active authorization and rejects its late success', async () => {
  const f = fixture('locked'); await f.view.load();
  const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>(); let signal: AbortSignal | undefined;
  const pending = f.view.unlock(async owner => { signal = owner; started.resolve(); await finish.promise; }, check);
  const refused = assert.rejects(pending, /PUBLIC_VIEW_LOCKED/); await started.promise;
  await f.view.lock(); assert.equal(signal?.aborted, true); finish.resolve(); await refused;
  assert.equal(f.raw(), 'locked'); assert.equal(f.view.getSnapshot().phase, 'locked');
});
test('leaving the unlock screen cancels OS authorization without altering the saved lock', async () => {
  const f = fixture('locked'); await f.view.load();
  const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>(); let signal: AbortSignal | undefined;
  const pending = f.view.unlock(async owner => { signal = owner; entered.resolve(); await finish.promise; }, check);
  const refused = assert.rejects(pending, /PUBLIC_VIEW_LOCKED/); await entered.promise;
  f.view.cancelUnlock(); assert.equal(signal?.aborted, true); finish.resolve(); await refused;
  assert.equal(f.raw(), 'locked'); assert.deepEqual(f.writes, []);
  await f.view.unlock(async () => undefined, check); assert.equal(f.raw(), 'unlocked');
});
test('retired screen and asynchronous guards cannot clear the lock', async () => {
  const f = fixture('locked'); await f.view.load(); let active = true, calls = 0;
  await assert.rejects(f.view.unlock(async () => { calls++; active = false; }, () => { if (!active) throw Error('retired'); }), /retired/);
  assert.equal(f.raw(), 'locked'); assert.equal(calls, 1);
  await assert.rejects(f.view.unlock(async () => { calls++; }, (() => Promise.resolve()) as never));
  assert.equal(calls, 1); assert.equal(f.raw(), 'locked');
});
test('an old startup read cannot undo a newer lock', async () => {
  const read = Promise.withResolvers<string | null>(); let first = true, raw: string | null = null;
  const view = new PublicViewLock({ get: () => first ? (first = false, read.promise) : Promise.resolve(raw), set: async value => { raw = value; } });
  const loading = view.load(); await Promise.resolve();
  const locking = view.lock(); read.resolve(null); await loading; await locking;
  assert.equal(view.getSnapshot().phase, 'locked'); assert.equal(raw, 'locked');
});
test('malformed markers and failed persistence never publish an open view', async () => {
  for (const raw of ['', 'false', '{}', 'locked '.repeat(1000)]) {
    const f = fixture(raw); await assert.rejects(f.view.load()); assert.equal(f.view.getSnapshot().phase, 'unavailable');
  }
  const view = new PublicViewLock({ get: async () => null, set: async () => { throw Error('storage'); } });
  await view.load(); await assert.rejects(view.lock()); assert.equal(view.getSnapshot().phase, 'unavailable'); assert.throws(view.assertUnlocked);
});
test('retry repairs a failed first lock write instead of reopening without authorization', async () => {
  let raw: string | null = null, failed = false;
  const port = { get: async () => raw, async set(value: string) {
    if (!failed) { failed = true; throw Error('storage'); }
    raw = value;
  } };
  const view = new PublicViewLock(port); await view.load();
  await assert.rejects(view.lock()); assert.equal(raw, null);
  assert.equal(view.getSnapshot().phase, 'unavailable');
  await view.load(); assert.equal(raw, 'locked'); assert.equal(view.getSnapshot().phase, 'locked');
  const reopened = new PublicViewLock(port); await reopened.load();
  assert.equal(reopened.getSnapshot().phase, 'locked');
  await view.unlock(async () => undefined, check); await view.load();
  assert.equal(view.getSnapshot().phase, 'unlocked');
});
test('retry remains unavailable if the required lock cannot be persisted', async () => {
  const view = new PublicViewLock({ get: async () => 'unlocked', set: async () => { throw Error('storage'); } });
  await view.load(); await assert.rejects(view.lock()); await assert.rejects(view.load());
  assert.equal(view.getSnapshot().phase, 'unavailable'); assert.throws(view.assertUnlocked);
});
for (const interruption of ['cancel', 'lock', 'write-error'] as const) test(`interrupted unlock write is repaired before reopen (${interruption})`, async () => {
  let raw = 'locked';
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const port = { get: async () => raw, async set(value: string) {
    if (value === 'unlocked') { entered.resolve(); await release.promise; raw = value; if (interruption === 'write-error') throw Error('lost acknowledgement'); }
    else raw = value;
  } };
  const view = new PublicViewLock(port); await view.load();
  const pending = view.unlock(async () => undefined, check), rejected = assert.rejects(pending);
  await entered.promise;
  const locking = interruption === 'lock' ? view.lock() : undefined;
  if (interruption === 'cancel') view.cancelUnlock();
  release.resolve(); await rejected; await locking;
  assert.equal(raw, 'locked'); assert.equal(view.getSnapshot().phase, 'locked');
  const reopened = new PublicViewLock(port); await reopened.load(); assert.equal(reopened.getSnapshot().phase, 'locked');
});
test('public custody cannot bypass a persisted view lock through initialize or unlock', async () => {
  const f = fixture('locked'); let publicOpens = 0;
  const runtime: CustodyRuntime = {
    session: { async createWallet() {}, async importWallet() {}, async unlock() { publicOpens++; return { authenticated: true }; },
      async readSelectedAddress() { return '0x52908400098527886E0F7030069857D2E4169EE7'; }, async lock() {} },
    storage: { async readState() { return { presence: 'existing', backup: 'confirmed' }; }, async close() {} },
  };
  const preferences = new SecurityPreferences({ get: async () => null, set: async () => undefined });
  const authority = new NativeCustodyAuthority({ open: async () => runtime }, { preferences, assertActive: check, viewLock: f.view });
  await authority.initialize(); assert.equal(authority.getSnapshot().phase, 'locked'); assert.equal(publicOpens, 0);
  await assert.rejects(authority.unlock()); assert.equal(publicOpens, 0);
  let authorizations = 0;
  await f.view.unlock(async () => { authorizations++; }, check); await authority.unlock();
  assert.equal(authorizations, 1); assert.equal(publicOpens, 1); assert.equal(authority.getSnapshot().phase, 'ready');
  await authority.dispose();
});
