import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeNotificationCoordinator, emptyNotificationDocument } from '../src/notifications/coordinator.ts';
import { startNotificationLifecycle } from '../src/notifications/lifecycle.ts';
import type { NativeNotificationScope, NotificationDocument, NotificationStore } from '../src/notifications/types.ts';

const address = `0x${'11'.repeat(20)}`;
const external = `0x${'22'.repeat(20)}`;
const scope = (id = 'watch:one'): NativeNotificationScope => ({ id, accountId: id, accountType: 'watch', accountAddress: address,
  network: { id: 'ethereum', chainId: '1', kind: 'evm', rpcUrl: 'https://rpc.example', registrationHash: '0x' + '33'.repeat(32) } as NativeNotificationScope['network'] });
function harness() {
  let document = emptyNotificationDocument();
  let serial: Promise<unknown> = Promise.resolve();
  let commitHook: (() => Promise<void>) | undefined;
  let storageUnavailable = false;
  const store: NotificationStore = { initialize: async () => undefined,
    transact<T>(action: (doc: NotificationDocument) => Promise<T> | T, guard: () => void): Promise<T> {
      const result = serial.then(async () => { if (storageUnavailable) throw Error('Storage unavailable'); guard(); const next = structuredClone(document); const output = await action(next); await commitHook?.(); guard(); document = next; return output; });
      serial = result.catch(() => undefined); return result;
    } };
  const posted: string[] = [], removed: string[] = [], reads: string[] = [];
  let rows: unknown[] = [], permission: 'granted' | 'denied' = 'granted', prompts = 0, registered = false, counter = 0;
  let readHook: ((scope: NativeNotificationScope, signal: AbortSignal, guard: () => void) => Promise<void>) | undefined;
  let promptHook: (() => Promise<void>) | undefined;
  let postHook: ((id: string) => Promise<void>) | undefined;
  let pruneHook: (() => Promise<void>) | undefined;
  const ports: ConstructorParameters<typeof NativeNotificationCoordinator>[0] = { store,
    delivery: {
      permission: async (request) => { if (request) { prompts++; await promptHook?.(); } return permission; }, backgroundStatus: async () => 'available',
      register: async () => { registered = true; }, unregister: async () => { registered = false; },
      post: async (id) => { posted.push(id); await postHook?.(id); }, remove: async (id) => { removed.push(id); },
      prune: async (keep) => { await pruneHook?.(); for (const id of posted) if (!keep.includes(id) && !removed.includes(id)) removed.push(id); },
    }, normalize: (value) => structuredClone(value),
    factScope: (value) => ({ accountId: value.accountId, accountType: value.accountType, accountAddress: value.accountAddress,
      chainId: '1', networkType: 'evm', networkKey: 'registration' }),
    read: async (value, _previous, signal, guard) => { reads.push(value.id); await readHook?.(value, signal, guard); return { transactions: rows, historyReadSucceeded: true }; },
    randomId: () => 'pali-alert-' + (++counter).toString(16).padStart(32, '0'), now: () => 100000,
  };
  const coordinator = new NativeNotificationCoordinator(ports);
  return { coordinator, secondCoordinator: () => new NativeNotificationCoordinator(ports), posted, removed, reads, get document() { return document; }, get prompts() { return prompts; }, get registered() { return registered; },
    rows: (next: unknown[]) => { rows = next; }, permission: (next: typeof permission) => { permission = next; }, hook: (next: typeof readHook) => { readHook = next; },
    commitHook: (next: typeof commitHook) => { commitHook = next; }, promptHook: (next: typeof promptHook) => { promptHook = next; }, postHook: (next: typeof postHook) => { postHook = next; },
    pruneHook: (next: typeof pruneHook) => { pruneHook = next; }, storageUnavailable: (next: boolean) => { storageUnavailable = next; } };
}
const transfer = (hash = 'a', changes = {}) => ({ hash: '0x' + hash.repeat(64), from: external, to: address, ...changes });

test('load does not prompt; enrollment baselines history and first external incoming movement into an empty account alerts', async () => {
  const h = harness(); await h.coordinator.load(); assert.equal(h.prompts, 0);
  await h.coordinator.enable([scope()], () => undefined); assert.equal(h.prompts, 1); assert.equal(h.registered, true); assert.deepEqual(h.posted, []);
  h.rows([transfer()]); await h.coordinator.runForeground(); assert.equal(h.posted.length, 1);
  await h.coordinator.runForeground(); assert.equal(h.posted.length, 1);
  assert.equal(h.document.events[0]?.fact.direction, 'incoming');
});

test('existing history is silent, and pending-to-confirmed produces one distinct notice', async () => {
  const h = harness(); h.rows([transfer('b')]); await h.coordinator.enable([scope()], () => undefined); assert.equal(h.posted.length, 0);
  h.rows([transfer('b', { blockNumber: 5, timestamp: 101, txreceipt_status: '1' })]);
  await h.coordinator.runForeground(); await h.coordinator.runForeground(); assert.equal(h.posted.length, 1);
  assert.equal(h.document.events[0]?.fact.kind, 'transaction-confirmed');
});

test('revocation during an outstanding public read prevents posting and old taps cannot route', async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined); h.rows([transfer()]);
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  h.hook(async () => { started(); await new Promise<void>((resolve) => { release = resolve; }); });
  const poll = h.coordinator.runForeground(); await waiting;
  await h.coordinator.disableScope(scope().id); release(); await poll;
  assert.equal(h.posted.length, 0); assert.equal(h.registered, false);
  assert.equal(await h.coordinator.resolveTapAfterUnlock('pali-alert-' + '1'.padStart(32, '0'), () => true), null);
});

test('a revoked later account in an already captured batch is never read', async () => {
  const h = harness(), a = scope('watch:a'), b = scope('watch:b');
  await h.coordinator.enable([a, b], () => undefined); h.reads.length = 0;
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  h.hook(async value => { if (value.id === a.id) { started.resolve(); await release.promise; } });
  const poll = h.coordinator.runForeground(); await started.promise;
  await h.coordinator.disableScope(b.id); release.resolve(); await poll;
  assert.deepEqual(h.reads, [a.id]);
});

test('revocation aborts the admitted scope before its later RPC steps', async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined);
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined, laterSteps = 0;
  h.hook(async (_value, admittedSignal, guard) => { signal = admittedSignal; started.resolve(); await release.promise; guard(); laterSteps++; });
  const poll = h.coordinator.runForeground(); await started.promise;
  await h.coordinator.disableScope(scope().id); assert.equal(signal?.aborted, true);
  release.resolve(); await poll; assert.equal(laterSteps, 0);
});

test('taps use local enrolled metadata and are rejected after account removal or by current-catalog validation', async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined); h.rows([transfer()]); await h.coordinator.runForeground();
  const id = h.posted[0]!; h.coordinator.recordTap(id);
  assert.equal(h.coordinator.getSnapshot().pendingEventId, id);
  assert.equal(await h.coordinator.resolveTapAfterUnlock(id, () => false), null);
  assert.equal(h.coordinator.getSnapshot().pendingEventId, id);
  assert.deepEqual(await h.coordinator.getPendingOwner(), { accountId: scope().accountId, accountType: 'watch' });
  assert.equal((await h.coordinator.resolveTapAfterUnlock(id, () => true))?.accountId, scope().accountId);
  await h.coordinator.disableOwner('watch', scope().accountId);
  assert.ok(h.removed.includes(id)); assert.equal(await h.coordinator.resolveTapAfterUnlock(id, () => true), null);
});

test('resolving one notification does not consume a newer tap', async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined);
  h.rows([transfer('a')]); await h.coordinator.runForeground();
  h.rows([transfer('a'), transfer('b')]); await h.coordinator.runForeground();
  const [first, second] = h.posted; assert.ok(first && second);
  h.coordinator.recordTap(first);
  assert.ok(await h.coordinator.resolveTapAfterUnlock(first, () => { h.coordinator.recordTap(second); return true; }));
  assert.equal(h.coordinator.getSnapshot().pendingEventId, second);
  await h.coordinator.disableAll(); assert.equal(await h.coordinator.getPendingOwner(), null);
});

test('scope replacement revokes changed endpoints and never enrolls unselected accounts', async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined);
  await h.coordinator.replaceScopes([{ ...scope(), network: { ...scope().network, id: 'changed' } } as NativeNotificationScope, scope('watch:two')]);
  assert.deepEqual(h.coordinator.getSnapshot().enabledScopeIds, []);
});

test('OS permission revocation cancels old notices and unregisters monitoring without prompting', async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined); h.rows([transfer()]); await h.coordinator.runForeground();
  h.permission('denied'); await h.coordinator.runForeground();
  assert.equal(h.prompts, 1); assert.equal(h.registered, false); assert.deepEqual(h.coordinator.getSnapshot().enabledScopeIds, []);
  assert.ok(h.removed.includes(h.posted[0]!));
});

test('concurrent foreground triggers coalesce and bounded runs advance through all enabled scopes', async () => {
  const h = harness(); const scopes = Array.from({ length: 12 }, (_, i) => scope(`watch:${String(i).padStart(2, '0')}`));
  await h.coordinator.enable(scopes, () => undefined); h.reads.length = 0;
  await Promise.all([h.coordinator.runForeground(), h.coordinator.runForeground()]); assert.equal(h.reads.length, 8);
  await h.coordinator.runForeground(); assert.equal(new Set(h.reads).size, 12);
});

test('independent foreground and background coordinators atomically claim one notification attempt', async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined); h.rows([transfer()]);
  const other = h.secondCoordinator();
  await Promise.all([h.coordinator.runForeground(), other.runForeground()]);
  assert.equal(h.posted.length, 1);
  assert.equal(h.document.events.length, 1);
  assert.equal(h.document.events[0]?.attempted, true);
});

test('stale enrollment after an OS permission prompt never persists the old account', async () => {
  const h = harness(); let current = true;
  h.promptHook(async () => { current = false; });
  await assert.rejects(h.coordinator.enable([scope()], () => { if (!current) throw new Error('stale owner'); }));
  assert.equal(h.document.scopes.length, 0); assert.equal(h.posted.length, 0);
});

test('owner loss while the first observation is in flight rolls back only the new enrollment', async () => {
  const h = harness(); let current = true;
  h.hook(async () => { current = false; });
  await assert.rejects(h.coordinator.enable([scope()], () => { if (!current) throw new Error('stale owner'); }));
  assert.equal(h.document.scopes.length, 0); assert.equal(h.posted.length, 0); assert.equal(h.registered, false);
});

test('OS presentation can reenter storage, and revocation during posting removes the late notice', { timeout: 1000 }, async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined); h.rows([transfer()]);
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  h.postHook(async (id) => {
    assert.equal(await h.coordinator.shouldPresent(id), true);
    started(); await new Promise<void>((resolve) => { release = resolve; });
  });
  const poll = h.coordinator.runForeground(); await waiting;
  await h.coordinator.disableScope(scope().id); release(); await poll;
  assert.ok(h.removed.includes(h.posted[0]!)); assert.equal(h.document.events.length, 0);
});

for (const fault of ['post', 'prune'] as const) test(`a transient ${fault} failure retries through load on foreground resume`, async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined);
  let timer: (() => void) | undefined, changed: ((state: string) => void) | undefined;
  const order: string[] = [], tick = () => new Promise<void>(resolve => setImmediate(resolve));
  h.hook(async () => { order.push('read'); });
  const stop = startNotificationLifecycle({
    load: async () => { order.push('load'); await h.coordinator.load(); },
    run: signal => h.coordinator.run(signal), getSnapshot: h.coordinator.getSnapshot, subscribe: h.coordinator.subscribe,
  }, { current: () => 'active', subscribe: listener => { changed = listener; return () => { changed = undefined; }; },
    everyMinute: listener => { timer = listener; return () => { timer = undefined; }; } });
  try {
    await tick(); order.length = 0; h.rows([transfer('a')]);
    if (fault === 'post') h.postHook(async () => { h.postHook(undefined); throw Error('Transient OS post failure'); });
    else h.pruneHook(async () => { h.pruneHook(undefined); throw Error('Transient OS prune failure'); });
    timer?.(); await tick();
    assert.equal(h.coordinator.getSnapshot().status, 'unavailable'); assert.ok(timer, 'failed work retains a bounded retry timer');
    changed?.('background'); assert.equal(timer, undefined);
    order.length = 0; h.rows([transfer('b')]); changed?.('active'); await tick();
    assert.equal(order[0], 'load'); assert.ok(order.indexOf('read') > order.indexOf('load'));
    assert.equal(h.coordinator.getSnapshot().status, 'ready'); assert.equal(h.prompts, 1); assert.ok(timer);
  } finally { stop(); }
});

test('unavailable retries never read public endpoints through corrupt storage or denied permission', async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined); h.reads.length = 0;
  h.storageUnavailable(true); await assert.rejects(h.coordinator.runForeground());
  await h.coordinator.runForeground(); assert.equal(h.coordinator.getSnapshot().status, 'unavailable'); assert.deepEqual(h.reads, []);
  h.storageUnavailable(false); h.permission('denied'); await h.coordinator.runForeground();
  assert.deepEqual(h.reads, []); assert.deepEqual(h.coordinator.getSnapshot().enabledScopeIds, []); assert.equal(h.prompts, 1);
});


test('stale catalogue reconciliation rolls back instead of pruning a current enrollment', async () => {
  const h = harness(); await h.coordinator.enable([scope()], () => undefined);
  let active = true, release!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { started = resolve; });
  h.commitHook(async () => { h.commitHook(undefined); started(); await new Promise<void>(resolve => { release = resolve; }); });
  const pending = h.coordinator.replaceAccountTypes(['watch'], [], () => { if (!active) throw Error('CANCELLED'); });
  await blocked; active = false; release();
  await assert.rejects(pending, /CANCELLED/);
  assert.equal(h.document.scopes.length, 1);
  assert.equal(h.coordinator.getSnapshot().status, 'ready');
});
