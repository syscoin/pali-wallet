import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
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
    release() { permission.resolve('granted'); }, emit(value: Response) { listener(value); }, tap(value: Response) { last = value; listener(value); } };
}

test('a newer live tap during cold loading owns selection and cannot be cleared by the historical restore', async () => {
  const f = fixture(), load = f.nativeActivityNotifications.load();
  await flush(); f.tap(response(2)); f.release(); await load;
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, id(2));
  assert.equal(f.reads(), 0); assert.equal(f.clears(), 0); assert.equal(f.last()?.notification.request.identifier, id(2));
});

test('a cold response alone restores once and is cleared before a later live tap', async () => {
  const f = fixture(); f.release(); await f.nativeActivityNotifications.load();
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, id(1));
  assert.equal(f.reads(), 1); assert.equal(f.clears(), 1); assert.equal(f.last(), null);
  f.tap(response(2));
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, id(2));
});

test('an invalid live action cannot discard the legitimate cold response', async () => {
  const f = fixture(), load = f.nativeActivityNotifications.load();
  await flush(); f.emit({ ...response(2), actionIdentifier: 'other-action' });
  f.release(); await load;
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, id(1));
  assert.equal(f.reads(), 1); assert.equal(f.clears(), 1);
});

test('a scheduled background wake never consumes the cold response', async () => {
  const f = fixture(); f.release(); await f.runNotificationBackgroundTask(new AbortController().signal);
  assert.equal(f.reads(), 0); assert.equal(f.clears(), 0);
  assert.equal(f.nativeActivityNotifications.getSnapshot().pendingEventId, null);
});
