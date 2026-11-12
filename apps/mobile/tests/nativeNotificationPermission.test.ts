import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { WalletReleaseMonitor } from '../../../source/shared/walletReleaseMonitor.ts';
import { parseWalletReleaseFeed } from '../../../source/shared/walletRelease.ts';
import { createPermissionPresentation } from '../src/platform/permissionPresentation.ts';
import type { NotificationDelivery } from '../src/notifications/types.ts';
import type { MobileUpdateService } from '../src/updates/types.ts';

type Permission = { granted: boolean; canAskAgain: boolean; ios?: { status: number } };
type PermissionModule = {
  isNotificationPermissionPromptActive(): boolean;
  requestNativeNotificationPermission(request?: boolean): Promise<'granted' | 'denied'>;
};
function evaluate<T>(file: string, imports: Record<string, unknown>): T {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new NodeURL(file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  return module.exports as T;
}
function fixture() {
  let state = 'active', status: Permission = { granted: false, canAskAgain: true }, requests = 0;
  let pending = Promise.withResolvers<Permission>();
  const listeners = new Set<(state: string) => void>(), channels: { name: string; options: unknown }[] = [];
  const requestedOptions: unknown[] = [];
  const native = { Platform: { OS: 'android' }, AppState: { get currentState() { return state; },
    addEventListener(_event: string, listener: (state: string) => void) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; } } };
  const notifications = { IosAuthorizationStatus: { PROVISIONAL: 3 }, AndroidImportance: { DEFAULT: 3 }, AndroidNotificationVisibility: { PRIVATE: 0 },
    getPermissionsAsync: async () => status,
    requestPermissionsAsync(options: unknown) { requests++; requestedOptions.push(options); return pending.promise; },
    async setNotificationChannelAsync(name: string, options: unknown) { channels.push({ name, options }); },
    setNotificationHandler() {}, addNotificationResponseReceivedListener() {},
    async getLastNotificationResponseAsync() { return null; }, async clearLastNotificationResponseAsync() {},
    async cancelScheduledNotificationAsync() {}, async dismissNotificationAsync() {},
  };
  const permission = evaluate<PermissionModule>('../src/notifications/permission.native.ts', {
    'react-native': native, 'expo-notifications': notifications, '../platform/permissionPresentation.ts': { createPermissionPresentation },
  });
  let delivery!: NotificationDelivery;
  const background = { BackgroundTaskStatus: { Available: 1 }, getStatusAsync: async () => 1,
    registerTaskAsync: async () => undefined, unregisterTaskAsync: async () => undefined };
  const taskManager = { isAvailableAsync: async () => true, isTaskRegisteredAsync: async () => false };
  const activity = evaluate<{ isNotificationPermissionPromptActive(): boolean }>('../src/notifications/service.native.ts', {
    'react-native': native, 'expo-notifications': notifications, 'expo-background-task': background, 'expo-task-manager': taskManager,
    './permission.native.ts': permission,
    './coordinator.ts': { NativeNotificationCoordinator: class {
      constructor(options: { delivery: NotificationDelivery }) { delivery = options.delivery; }
      async load() {} getSnapshot() { return { status: 'ready' }; }
    } },
    './reader.ts': { createNotificationReader: () => ({}), normalizeNotificationScope() {}, notificationFactScope() {} },
    './store.native.ts': { createNativeNotificationStore: () => ({}) },
    './constants.ts': { ACTIVITY_BACKGROUND_TASK: 'activity', ACTIVITY_NOTIFICATION_CHANNEL: 'activity-channel', WALLET_BACKGROUND_INTERVAL_MINUTES: 15 },
    './lifecycle.ts': { startNotificationLifecycle: () => () => undefined },
  });
  const data = new Map<string, string>();
  const updates = evaluate<{ mobileUpdates: MobileUpdateService }>('../src/updates/service.native.ts', {
    '@react-native-async-storage/async-storage': { getItem: async (key: string) => data.get(key) ?? null,
      setItem: async (key: string, value: string) => { data.set(key, value); }, removeItem: async (key: string) => { data.delete(key); } },
    'react-native': native, 'expo-notifications': notifications, 'expo-background-task': background, 'expo-task-manager': taskManager,
    'expo-application': { nativeApplicationVersion: '5.0.0', nativeBuildVersion: '1' },
    '../../../../source/shared/walletRelease': { readWalletReleaseFeed: async () => parseWalletReleaseFeed({ version: 1, releases: [] }) },
    '../../../../source/shared/walletReleaseMonitor': { WalletReleaseMonitor, WALLET_RELEASE_AUTOMATIC_INTERVAL_MS: 21600000 },
    '../../../../source/shared/walletStores': { PALI_STORES: { ios: null } },
    '../platform/http': { walletFetch() { throw Error('Unexpected network'); } },
    '../notifications/permission.native': permission,
    '../notifications/constants': { WALLET_BACKGROUND_INTERVAL_MINUTES: 15 },
    './constants': { UPDATE_BACKGROUND_TASK: 'updates' },
  });
  return { permission, activity, delivery, updates: updates.mobileUpdates, channels, requestedOptions,
    get requests() { return requests; }, get listenerCount() { return listeners.size; },
    status(value: Permission) { status = value; },
    move(next: string) { state = next; for (const listener of [...listeners]) listener(next); },
    complete(value: Permission = { granted: true, canAskAgain: true }) { status = value; pending.resolve(value); },
    retry() { pending = Promise.withResolvers<Permission>(); status = { granted: false, canAskAgain: true }; },
  };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

for (const category of ['activity', 'updates']) test(`${category} uses the same active permission marker through inactive and foreground return`, async () => {
  const f = fixture();
  const pending = category === 'activity' ? f.delivery.permission(true) : f.updates.setAlerts(true);
  await flush();
  assert.equal(f.requests, 1);
  assert.equal(f.activity.isNotificationPermissionPromptActive, f.permission.isNotificationPermissionPromptActive);
  assert.equal(f.activity.isNotificationPermissionPromptActive(), true);
  f.move('inactive'); f.complete(); await Promise.resolve();
  assert.equal(f.activity.isNotificationPermissionPromptActive(), true);
  f.move('active'); await pending;
  assert.equal(f.permission.isNotificationPermissionPromptActive(), false); assert.equal(f.listenerCount, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.requestedOptions)), [{ ios: { allowAlert: true, allowBadge: false, allowSound: false } }]);
  if (category === 'activity') {
    assert.equal(f.channels[0]!.name, 'activity-channel');
    assert.deepEqual(JSON.parse(JSON.stringify(f.channels[0]!.options)), { name: 'Account activity', importance: 3, lockscreenVisibility: 0, sound: null });
  }
});

for (const category of ['activity', 'updates']) test(`${category} clears the marker after background interruption and permits an explicit retry`, async () => {
  const f = fixture();
  const pending = category === 'activity' ? f.delivery.permission(true) : f.updates.setAlerts(true);
  const rejected = assert.rejects(pending, /interrupted/);
  await flush(); f.move('background'); f.complete(); f.move('active'); await rejected;
  assert.equal(f.permission.isNotificationPermissionPromptActive(), false); assert.equal(f.listenerCount, 0);
  f.retry(); const retried = category === 'activity' ? f.delivery.permission(true) : f.updates.setAlerts(true);
  await flush(); assert.equal(f.permission.isNotificationPermissionPromptActive(), true);
  f.complete(); await retried; assert.equal(f.requests, 2); assert.equal(f.permission.isNotificationPermissionPromptActive(), false);
});

test('granted and provisional status do not reprompt; denied and passive reads respect canAskAgain', async () => {
  const f = fixture();
  for (const status of [{ granted: true, canAskAgain: true }, { granted: false, canAskAgain: true, ios: { status: 3 } }]) {
    f.status(status); assert.equal(await f.permission.requestNativeNotificationPermission(), 'granted');
  }
  f.status({ granted: false, canAskAgain: false });
  assert.equal(await f.permission.requestNativeNotificationPermission(), 'denied');
  f.status({ granted: false, canAskAgain: true });
  assert.equal(await f.delivery.permission(false), 'denied');
  assert.equal(f.requests, 0); assert.equal(f.permission.isNotificationPermissionPromptActive(), false);
});

test('an OS permission refusal releases the marker and allows a later explicit retry', async () => {
  const f = fixture();
  const first = f.permission.requestNativeNotificationPermission(); await flush();
  f.complete({ granted: false, canAskAgain: true }); assert.equal(await first, 'denied');
  assert.equal(f.permission.isNotificationPermissionPromptActive(), false);
  f.retry(); const second = f.updates.setAlerts(true); await flush();
  assert.equal(f.permission.isNotificationPermissionPromptActive(), true);
  f.complete(); await second; assert.equal(f.requests, 2); assert.equal(f.permission.isNotificationPermissionPromptActive(), false);
});
