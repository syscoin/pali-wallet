import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { NativeNotificationCoordinator, emptyNotificationDocument } from '../src/notifications/coordinator.ts';
import type { NotificationDocument, NotificationStore } from '../src/notifications/types.ts';

type Response = { actionIdentifier: string; notification: { request: { identifier: string; content: { data: { eventId: string } } } } };
const id = (value: number) => 'pali-alert-' + value.toString(16).padStart(32, '0');
const response = (value: number): Response => ({ actionIdentifier: 'default', notification: { request: { identifier: id(value), content: { data: { eventId: id(value) } } } } });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture() {
  const permission = Promise.withResolvers<'granted'>();
  let document = emptyNotificationDocument(), listener!: (value: Response) => void;
  let last: Response | null = response(1), reads = 0, clears = 0;
  const store: NotificationStore = { initialize: async () => {}, async transact<T>(action: (draft: NotificationDocument) => Promise<T> | T, guard: () => void): Promise<T> {
    guard(); const next = structuredClone(document); const result = await action(next); guard(); document = next; return result;
  } };
  const imports: Record<string, unknown> = {
    'react-native': { Platform: { OS: 'ios' }, AppState: {} },
    'expo-notifications': { DEFAULT_ACTION_IDENTIFIER: 'default', setNotificationHandler() {},
      addNotificationResponseReceivedListener(value: typeof listener) { listener = value; },
      getLastNotificationResponse() { reads++; return last; },
      clearLastNotificationResponse() { clears++; last = null; },
      getAllScheduledNotificationsAsync: async () => [], getPresentedNotificationsAsync: async () => [] },
    'expo-background-task': { BackgroundTaskStatus: { Available: 1 }, getStatusAsync: async () => 1,
      registerTaskAsync: async () => {}, unregisterTaskAsync: async () => {} },
    'expo-task-manager': { isAvailableAsync: async () => true, isTaskRegisteredAsync: async () => false },
    './coordinator.ts': { NativeNotificationCoordinator },
    './reader.ts': { createNotificationReader: () => async () => ({ transactions: [], historyReadSucceeded: true }), normalizeNotificationScope: (value: unknown) => value, notificationFactScope() { throw Error('No enrolled scopes'); } },
    './store.native.ts': { createNativeNotificationStore: () => store },
    './constants.ts': { ACTIVITY_BACKGROUND_TASK: 'activity', ACTIVITY_NOTIFICATION_CHANNEL: 'activity', WALLET_BACKGROUND_INTERVAL_MINUTES: 15 },
    './lifecycle.ts': { startNotificationLifecycle: () => () => {} },
    './permission.native.ts': { requestNativeNotificationPermission: () => permission.promise, isNotificationPermissionPromptActive: () => false },
  };
  const module = { exports: {} as { nativeActivityNotifications: NativeNotificationCoordinator; runNotificationBackgroundTask(signal: AbortSignal): Promise<void> } };
  const code = ts.transpileModule(readFileSync(new NodeURL('../src/notifications/service.native.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, setInterval, clearInterval,
    require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { ...module.exports, reads: () => reads, clears: () => clears, last: () => last,
    release() { permission.resolve('granted'); }, emit(value: Response) { listener(value); }, tap(value: Response) { last = value; listener(value); },
    enroll(value: number) {
      const owner = { accountId: 'watch:one', accountType: 'watch', accountAddress: `0x${'11'.repeat(20)}` };
      const network = getNativeNetwork('ethereum');
      const scope = { ...owner, id: owner.accountId, network };
      document.scopes.push({ scope, generation: 'enrollment', baseline: null, enrolledAt: 0 });
      document.events.push({ id: id(value), scopeId: scope.id, generation: 'enrollment', attempted: true, createdAt: 1,
        fact: { key: id(value), kind: 'transaction-pending', direction: 'incoming', evidence: 'pending-intent',
          scope: { ...owner, chainId: network.chainId, networkKey: network.registrationHash, networkType: 'evm' } } });
    } };
}

test('a newer live tap during cold loading owns selection and cannot be cleared by the historical restore', async () => {
  const f = fixture(), load = f.nativeActivityNotifications.load();
  await flush(); f.tap(response(2)); f.release(); await load;
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, id(2));
  assert.equal(f.reads(), 1); assert.equal(f.clears(), 0); assert.equal(f.last()?.notification.request.identifier, id(2));
});

test('a cold response restores once across overlapping and later loads', async () => {
  const f = fixture();
  const first = f.nativeActivityNotifications.load(), second = f.nativeActivityNotifications.load();
  f.release(); await Promise.all([first, second]);
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, id(1));
  assert.equal(f.nativeActivityNotifications.getSnapshot().tapRevision, 1);
  await f.nativeActivityNotifications.load();
  assert.equal(f.nativeActivityNotifications.getSnapshot().tapRevision, 1);
  assert.equal(f.reads(), 1); assert.equal(f.clears(), 0);
});

test('a handled live response is never replayed from the native cache, and a real same-alert tap still routes', async () => {
  const f = fixture(), coordinator = f.nativeActivityNotifications;
  f.enroll(2); f.release(); await coordinator.load();
  const alert = response(2);
  f.tap(alert);
  const liveRevision = coordinator.getSnapshot().tapRevision!;
  assert.ok(await coordinator.readTapAfterUnlock(id(2), coordinator.getSnapshot().tapRevision!, () => true));
  coordinator.consumeTap(id(2), liveRevision!);
  await coordinator.load();
  assert.equal(f.last(), alert);
  assert.equal(coordinator.getSnapshot().pendingEventId, null);
  assert.equal(coordinator.getSnapshot().tapRevision, liveRevision);
  f.tap(response(2));
  assert.equal(coordinator.getSnapshot().pendingEventId, id(2));
  assert.equal(coordinator.getSnapshot().tapRevision, liveRevision + 1);
  assert.ok(await coordinator.readTapAfterUnlock(id(2), coordinator.getSnapshot().tapRevision!, () => true));
});

test('a live response received before hydration supersedes the cold cache', async () => {
  const f = fixture(); f.emit(response(2)); f.release(); await f.nativeActivityNotifications.load();
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, id(2));
  assert.equal(f.nativeActivityNotifications.getSnapshot().tapRevision, 1);
  assert.equal(f.reads(), 0); assert.equal(f.clears(), 0);
});

test('an invalid live action cannot discard the legitimate cold response', async () => {
  const f = fixture(), load = f.nativeActivityNotifications.load();
  await flush(); f.emit({ ...response(2), actionIdentifier: 'other-action' });
  f.release(); await load;
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, id(1));
  assert.equal(f.reads(), 1); assert.equal(f.clears(), 0);
});

test('a scheduled background wake never consumes the cold response', async () => {
  const f = fixture(); f.release(); await f.runNotificationBackgroundTask(new AbortController().signal);
  assert.equal(f.reads(), 0); assert.equal(f.clears(), 0);
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, null);
});
