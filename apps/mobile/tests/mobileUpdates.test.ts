import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { WalletReleaseMonitor } from '../../../source/shared/walletReleaseMonitor.ts';
import { parseWalletReleaseFeed } from '../../../source/shared/walletRelease.ts';
import type { MobileUpdateService } from '../src/updates/types.ts';

function fixture(options: { ios?: boolean; severity?: string; store?: string | null } = {}) {
  let clock = Date.now(), reads = 0, posts = 0, requests = 0, failPost = false, failFeed = false;
  const data = new Map<string, string>(), removed: string[] = [];
  const platform = options.ios ? 'ios' : 'android';
  const feed = parseWalletReleaseFeed({ version: 1, releases: [{ platform, version: '5.0.1', build: 2,
    severity: options.severity ?? 'important', title: 'Recovery fixes', summary: 'Improves interrupted transfer recovery.',
    publishedAt: '2026-01-01T00:00:00Z', releaseNotesUrl: 'https://github.com/syscoin/pali-wallet/releases/tag/v5.0.1',
    availability: { status: 'published' } }] });
  let permission = true, failRead = false, registered = false;
  let hold: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let backgroundHold: { entered: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>> } | undefined;
  const store = { getItem: async (key: string) => { if (failRead) { failRead = false; throw Error('read failed'); } return data.get(key) ?? null; },
    setItem: async (key: string, value: string) => { data.set(key, value); },
    removeItem: async (key: string) => { data.delete(key); } };
  const notifications = { IosAuthorizationStatus: { PROVISIONAL: 3 }, AndroidImportance: { DEFAULT: 3 },
    async getPermissionsAsync() { if (hold) { const item = hold; hold = undefined; await item.promise; } return { granted: permission }; },
    async requestPermissionsAsync() { requests++; return { granted: permission }; },
    async setNotificationChannelAsync() {},
    async scheduleNotificationAsync() { posts++; if (failPost) throw Error('refused'); },
    async cancelScheduledNotificationAsync(id: string) { removed.push(id); },
    async dismissNotificationAsync() {},
  };
  const imports: Record<string, unknown> = {
    '@react-native-async-storage/async-storage': store,
    'react-native': { Platform: { OS: platform }, AppState: { currentState: 'active' } },
    'expo-application': { nativeApplicationVersion: '5.0.0', nativeBuildVersion: '1' },
    'expo-background-task': { BackgroundTaskStatus: { Available: 1 }, getStatusAsync: async () => {
      if (backgroundHold) { backgroundHold.entered.resolve(); await backgroundHold.release.promise; } return 1;
    }, registerTaskAsync: async () => { registered = true; }, unregisterTaskAsync: async () => { registered = false; } },
    'expo-task-manager': { isAvailableAsync: async () => true, isTaskRegisteredAsync: async () => registered },
    'expo-notifications': notifications,
    '../../../../source/shared/walletRelease': { readWalletReleaseFeed: async () => { reads++; return failFeed ? null : feed; } },
    '../../../../source/shared/walletReleaseMonitor': { WALLET_RELEASE_AUTOMATIC_INTERVAL_MS: 21600000,
      WalletReleaseMonitor: class extends WalletReleaseMonitor { constructor(config: ConstructorParameters<typeof WalletReleaseMonitor>[0]) { super({ ...config, now: () => clock }); } } },
    '../../../../source/shared/walletStores': { PALI_STORES: { ios: options.store ?? null } },
    '../platform/http': { walletFetch: () => { throw Error('unexpected'); } },
    './constants': { UPDATE_BACKGROUND_TASK: 'pali-store-updates-v1' },
  };
  const module = { exports: {} as { mobileUpdates: MobileUpdateService; isReleaseUpdateNotification(id: string): Promise<boolean> } };
  const code = ts.transpileModule(readFileSync(new NodeURL('../src/updates/service.native.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { ...module.exports, data, removed, advance() { clock += 21600001; },
    get reads() { return reads; }, get posts() { return posts; }, get requests() { return requests; },
    get registered() { return registered; },
    failPost(value: boolean) { failPost = value; }, failFeed() { failFeed = true; },
    failReadOnce() { failRead = true; },
    permission(value: boolean) { permission = value; },
    holdPermission() { hold = Promise.withResolvers<void>(); return hold; },
    holdBackground() { return backgroundHold = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }; },
  };
}

test('public update monitoring posts and deduplicates important releases without asking permission', async () => {
  const f = fixture(); assert.equal(f.reads, 0);
  await f.mobileUpdates.check(); await f.mobileUpdates.check();
  assert.equal(f.reads, 1); assert.equal(f.posts, 1); assert.equal(f.requests, 0);
  f.advance(); await f.mobileUpdates.check(); assert.equal(f.posts, 1);
  const id = f.data.get('pali.update-notice.v1')!;
  assert.equal(await f.isReleaseUpdateNotification(id), true);
  assert.equal(await f.isReleaseUpdateNotification('pali-update-android-9.0.0-100'), false);
});
test('routine updates get a badge but no notification', async () => {
  const f = fixture({ severity: 'routine' }); await f.mobileUpdates.check();
  assert.equal(f.mobileUpdates.getSnapshot().release?.version, '5.0.1'); assert.equal(f.posts, 0);
});
test('failed delivery is retryable, not remembered as notified', async () => {
  const f = fixture(); f.failPost(true);
  await assert.rejects(f.mobileUpdates.check()); assert.equal(f.data.has('pali.update-notice.v1'), false);
  f.failPost(false); f.advance(); await f.mobileUpdates.check(); assert.equal(f.posts, 2);
});
test('disabled alerts revoke presentation without disabling update checks', async () => {
  const f = fixture(); await f.mobileUpdates.check();
  const id = f.data.get('pali.update-notice.v1')!;
  await f.mobileUpdates.setAlerts(false); f.advance(); await f.mobileUpdates.check();
  assert.equal(f.reads, 2); assert.equal(f.posts, 1); assert(f.removed.includes(id));
  assert.equal(await f.isReleaseUpdateNotification(id), false);
});
test('permission refusal never posts or silently requests permission', async () => {
  const f = fixture(); f.permission(false); await f.mobileUpdates.check();
  assert.equal(f.posts, 0); assert.equal(f.requests, 0); assert.equal(f.mobileUpdates.getSnapshot().permission, 'denied');
});
test('invalid metadata leaves failure visible without advertising or notifying', async () => {
  const f = fixture(); f.failFeed(); await f.mobileUpdates.check();
  assert.equal(f.mobileUpdates.getSnapshot().status, 'error'); assert.equal(f.posts, 0);
});
test('unpublished iOS listing cannot advertise an uninstalled destination', async () => {
  const f = fixture({ ios: true }); await f.mobileUpdates.check();
  assert.equal(f.mobileUpdates.getSnapshot().release, null); assert.equal(f.posts, 0);
});
test('temporary preference read failure can be retried without restarting', async () => {
  const f = fixture(); f.failReadOnce(); await assert.rejects(f.mobileUpdates.check());
  await f.mobileUpdates.check(); assert.equal(f.reads, 1); assert.equal(f.posts, 1);
});
test('opt-out while background registration waits wins over the older check', async () => {
  const f = fixture(), gate = f.holdBackground();
  const checking = f.mobileUpdates.check(); await gate.entered.promise;
  const disabling = f.mobileUpdates.setAlerts(false);
  await new Promise<void>(resolve => setImmediate(resolve)); gate.release.resolve();
  await Promise.all([checking, disabling]); assert.equal(f.registered, false); assert.equal(f.posts, 0);
});
test('opt-out while permission observation waits cannot post the old notice', async () => {
  const f = fixture(), gate = f.holdPermission();
  const checking = f.mobileUpdates.check(); await new Promise<void>(resolve => setImmediate(resolve));
  await f.mobileUpdates.setAlerts(false); gate.resolve(); await checking;
  assert.equal(f.posts, 0);
});
