import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeControllerLifecycle } from '../src/custody/nativeControllerLifecycle.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';

const deferred = () => { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const events: string[] = []; let count = 0;
  let close: Promise<void> = Promise.resolve(), recoveryClose: Promise<void> = Promise.resolve();
  let removalClose: Promise<void> = Promise.resolve(), removed = false;
  let connectionClose = () => Promise.resolve();
  let onLock = () => {}, onCreate = () => {}, onRecovery = () => {};
  let presence: 'existing' | 'empty' = 'existing';
  const gate = new NativeControllerLifecycle({
    async protect() { events.push('privacy'); },
    create() {
      const id = ++count; events.push(`create${id}`); onCreate();
      let state: CustodySnapshot = { phase: presence === 'existing' ? 'locked' : 'empty', presence, backup: 'confirmed', revision: 0, account: null, error: null };
      return {
        authority: { getSnapshot: () => state, async initialize() { events.push(`init${id}`); }, lock() { events.push(`lock${id}`); onLock(); }, async dispose() { events.push(`close${id}`); await close; state = { ...state, phase: 'disposed' }; } },
        backup: { dispose() { events.push(`backup${id}`); } }, keyExport: { dispose() {} }, disposeTokens() {}, disposeTransfers() {},
        disposeConnections() { events.push(`connections-close${id}`); return connectionClose(); },
        removal: { cancel() {}, async dispose() { await removalClose; }, hasVerifiedRemoval() { return removed; } },
      };
    },
    recovery() { onRecovery(); return { cancel() { events.push('cancel'); }, async dispose() { events.push('recovery-close'); await recoveryClose; } }; },
  });
  return { gate, events, count: () => count, closing(value: Promise<void>) { close = value; }, recoveryClosing(value: Promise<void>) { recoveryClose = value; },
    onLock(value: () => void) { onLock = value; }, onCreate(value: () => void) { onCreate = value; }, onRecovery(value: () => void) { onRecovery = value; }, empty() { presence = 'empty'; },
    removalClosing(value: Promise<void>) { removalClose = value; }, verifyRemoval() { removed = true; },
    connectionClosing(value: () => Promise<void>) { connectionClose = value; } };
}

for (const mode of ['release', 'replacement'] as const) test(`${mode} drains connections before closing storage or admitting a replacement`, async () => {
  const f = fixture(), first = {}, next = {}, connections = deferred();
  await f.gate.acquire(first, () => true);
  f.connectionClosing(() => connections.promise);
  const retiring = mode === 'release' ? f.gate.release(first) : undefined;
  const opening = f.gate.acquire(next, () => true);
  assert(f.events.includes('lock1'));
  assert(f.events.includes('connections-close1'));
  assert(f.events.indexOf('lock1') < f.events.indexOf('connections-close1'));
  await tick();
  assert(!f.events.includes('close1'));
  assert.equal(f.count(), 1);
  connections.resolve();
  await retiring;
  assert(await opening);
  assert(f.events.indexOf('connections-close1') < f.events.indexOf('close1'));
  assert(f.events.indexOf('close1') < f.events.indexOf('create2'));
  assert.equal(f.events.filter((event) => event === 'connections-close1').length, 1);
  await f.gate.release(next);
});

test('failed connection drain still closes authority before rejecting release and replacement', async () => {
  const f = fixture(), first = {}, connections = deferred(), authority = deferred();
  await f.gate.acquire(first, () => true);
  f.connectionClosing(() => connections.promise);
  f.closing(authority.promise);
  const retiring = f.gate.release(first), opening = f.gate.acquire({}, () => true);
  const rejectedRetirement = assert.rejects(retiring, { message: 'REOPEN_REQUIRED' });
  const rejectedReplacement = assert.rejects(opening, { message: 'REOPEN_REQUIRED' });
  let settled = false;
  void retiring.catch(() => { settled = true; });
  await tick();
  assert(!f.events.includes('close1'));
  connections.reject(new Error('private transport error'));
  await tick();
  assert(f.events.includes('close1'));
  assert.equal(settled, false);
  assert.equal(f.count(), 1);
  authority.resolve();
  await Promise.all([rejectedRetirement, rejectedReplacement]);
  assert.equal(f.count(), 1);
});

test('synchronous connection cleanup failure still retires authority and blocks replacement', async () => {
  const f = fixture(), first = {};
  await f.gate.acquire(first, () => true);
  f.connectionClosing(() => { throw new Error('private transport error'); });
  await assert.rejects(f.gate.release(first), { message: 'REOPEN_REQUIRED' });
  assert(f.events.includes('lock1'));
  assert(f.events.includes('close1'));
  await assert.rejects(f.gate.acquire({}, () => true), { message: 'REOPEN_REQUIRED' });
  assert.equal(f.count(), 1);
});

test('new mount waits for both recovery and authority drain, with synchronous revocation', async () => {
  const f = fixture(), first = {}, next = {}, close = deferred(), recovery = deferred();
  const a = await f.gate.acquire(first, () => true); assert(a);
  f.gate.startRecovery(first, a); f.closing(close.promise); f.recoveryClosing(recovery.promise);
  const draining = f.gate.release(first), opening = f.gate.acquire(next, () => true);
  assert(f.events.includes('cancel')); assert(f.events.includes('lock1')); await tick(); assert.equal(f.count(), 1);
  close.resolve(); await tick(); assert.equal(f.count(), 1);
  recovery.resolve(); await draining; assert(await opening); assert.equal(f.count(), 2);
  await f.gate.release(next);
});
test('reentrant new mount from lock callback cannot pass the preinstalled close barrier', async () => {
  const f = fixture(), a = {}, b = {}, close = deferred(); await f.gate.acquire(a, () => true); f.closing(close.promise);
  let next: ReturnType<typeof f.gate.acquire> | undefined;
  f.onLock(() => { f.onLock(() => {}); next = f.gate.acquire(b, () => true); });
  const draining = f.gate.release(a); await tick(); assert.equal(f.count(), 1);
  close.resolve(); await draining; assert(await next); assert.equal(f.count(), 2); await f.gate.release(b);
});
test('a factory callback that releases the mount cannot initialize its obsolete owner', async () => {
  const f = fixture(), token = {}; f.onCreate(() => { void f.gate.release(token); });
  assert.equal(await f.gate.acquire(token, () => true), null);
  assert(!f.events.includes('init1')); assert(f.events.includes('close1'));
});
test('cleanup failure permanently prevents another factory invocation', async () => {
  const f = fixture(), a = {}; await f.gate.acquire(a, () => true);
  const failure = Promise.reject(new Error('private provider message')); void failure.catch(() => undefined); f.closing(failure);
  await assert.rejects(f.gate.release(a), { message: 'REOPEN_REQUIRED' });
  await assert.rejects(f.gate.acquire({}, () => true), { message: 'REOPEN_REQUIRED' }); assert.equal(f.count(), 1);
});
test('existing wallet can never become onboarding after recovery or remount', async () => {
  const f = fixture(), a = {}; await f.gate.acquire(a, () => true); await f.gate.release(a); f.empty();
  await assert.rejects(f.gate.acquire({}, () => true), { message: 'REOPEN_REQUIRED' });
});
test('only the verified retiring removal owner allows an empty replacement after reconciliation drains', async () => {
  const f = fixture(), first = {}, next = {}, reconciliation = deferred();
  await f.gate.acquire(first, () => true);
  f.removalClosing(reconciliation.promise);
  const retiring = f.gate.release(first), opening = f.gate.acquire(next, () => true);
  await tick(); assert.equal(f.count(), 1);
  f.verifyRemoval(); f.empty(); reconciliation.resolve();
  await retiring;
  assert.equal((await opening)?.authority.getSnapshot().phase, 'empty');
  await f.gate.release(next);
});

test('an unresolved removal quarantines reopening even when authority close itself succeeds', async () => {
  const f = fixture(), first = {};
  await f.gate.acquire(first, () => true);
  const failure = Promise.reject(new Error('REOPEN_REQUIRED')); void failure.catch(() => undefined);
  f.removalClosing(failure);
  await assert.rejects(f.gate.release(first), { message: 'REOPEN_REQUIRED' });
  await assert.rejects(f.gate.acquire({}, () => true), { message: 'REOPEN_REQUIRED' });
  assert.equal(f.count(), 1);
});
test('rapid mount/unmount before privacy completion never opens an abandoned owner', async () => {
  const privacy = deferred(); let creates = 0;
  const f = fixture();
  const gate = new NativeControllerLifecycle({ protect: () => privacy.promise, create: () => { creates++; throw new Error(); }, recovery: () => ({ cancel() {}, async dispose() {} }) });
  const token = {}, opening = gate.acquire(token, () => true); await tick(); await gate.release(token); privacy.resolve();
  assert.equal(await opening, null); assert.equal(creates, 0); assert.equal(f.count(), 0);
});
test('release during recovery construction drains the late capability before remount', async () => {
  const f = fixture(), a = {}, b = {}, held = deferred(); const owner = await f.gate.acquire(a, () => true); assert(owner);
  f.recoveryClosing(held.promise); f.onRecovery(() => { void f.gate.release(a); });
  assert.throws(() => f.gate.startRecovery(a, owner), { message: 'NOT_READY' });
  const next = f.gate.acquire(b, () => true); await tick(); assert.equal(f.count(), 1);
  held.resolve(); assert(await next); await f.gate.release(b);
});
test('same mounted token joins one admission and asynchronous guards never grant admission', async () => {
  const f = fixture(), a = {}; const one = f.gate.acquire(a, () => true); assert.equal(f.gate.acquire(a, () => true), one);
  await one; assert.equal(f.count(), 1); await f.gate.release(a);
  const invalid = () => Promise.resolve(true);
  assert.equal(await f.gate.acquire({}, invalid as unknown as () => boolean), null); assert.equal(f.count(), 1);
});
