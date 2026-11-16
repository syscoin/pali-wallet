import { walletUiFixture } from './walletUiFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { WalletReleaseMonitor } from '../../../source/shared/walletReleaseMonitor.ts';
import { parseWalletReleaseFeed } from '../../../source/shared/walletRelease.ts';
import type { MobileUpdateService } from '../src/updates/types.ts';

function fixture(options: { ios?: boolean; severity?: string; store?: string | null;
  newerRoutine?: boolean; currentVersion?: string; currentBuild?: string } = {}) {
  let clock = Date.now(), reads = 0, posts = 0, requests = 0, failPost = false, failFeed = false;
  const data = new Map<string, string>(), removed: string[] = [];
  const platform = options.ios ? 'ios' : 'android';
  const feed = parseWalletReleaseFeed({ version: 1, releases: [{ platform, version: '5.0.1', build: 2,
    severity: options.severity ?? 'important', title: 'Recovery fixes', summary: 'Improves interrupted transfer recovery.',
    publishedAt: '2026-01-01T00:00:00Z', releaseNotesUrl: 'https://github.com/syscoin/pali-wallet/releases/tag/v5.0.1',
    availability: { status: 'published' } }, ...(options.newerRoutine ? [{ platform, version: '5.0.2', build: 3,
    severity: 'routine', title: 'Latest improvements', summary: 'Cumulative improvements.',
    publishedAt: '2026-01-02T00:00:00Z', releaseNotesUrl: 'https://github.com/syscoin/pali-wallet/releases/tag/v5.0.2',
    availability: { status: 'published' } }] : [])] });
  let permission = true, failPermission = false, failRead = false, registered = false, interval = 0;
  let hold: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let noticeWriteHold: { entered: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>> } | undefined;
  let backgroundHold: { entered: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>> } | undefined;
  let alertFailure: 'before' | 'after' | undefined, failAlertRead = false, failReconciliation = false, alertWrites = 0;
  let alertWriteHold: { entered: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>> } | undefined;
  const store = { getItem: async (key: string) => { if (failRead) { failRead = false; throw Error('read failed'); } if (key === 'pali.update-alerts.v1' && failAlertRead) throw Error('preference unavailable'); return data.get(key) ?? null; },
    setItem: async (key: string, value: string) => {
      if (key === 'pali.update-alerts.v1') {
        alertWrites++;
        if (alertWriteHold) { const gate = alertWriteHold; alertWriteHold = undefined; gate.entered.resolve(); await gate.release.promise; }
        const failure = alertFailure; alertFailure = undefined;
        if (failure && failReconciliation) failAlertRead = true;
        if (failure === 'before') throw Error('write refused before commit');
        data.set(key, value);
        if (failure === 'after') throw Error('write result unavailable after commit');
      } else data.set(key, value);
      if (key === 'pali.update-notice.v1' && noticeWriteHold) { const gate = noticeWriteHold; noticeWriteHold = undefined; gate.entered.resolve(); await gate.release.promise; }
    },
    removeItem: async (key: string) => { data.delete(key); } };
  const notifications = { IosAuthorizationStatus: { PROVISIONAL: 3 }, AndroidImportance: { DEFAULT: 3 },
    async getPermissionsAsync() { if (hold) { const item = hold; hold = undefined; await item.promise; } return { granted: permission }; },
    async requestPermissionsAsync() { requests++; if (failPermission) { failPermission = false; throw Error('Permission request failed'); } return { granted: permission }; },
    async setNotificationChannelAsync() {},
    async scheduleNotificationAsync() { posts++; if (failPost) throw Error('refused'); },
    async cancelScheduledNotificationAsync(id: string) { removed.push(id); },
    async dismissNotificationAsync() {},
  };
  const imports: Record<string, unknown> = {
    '@react-native-async-storage/async-storage': store,
    'react-native': { Platform: { OS: platform }, AppState: { currentState: 'active' } },
    'expo-application': { nativeApplicationVersion: options.currentVersion ?? '5.0.0', nativeBuildVersion: options.currentBuild ?? '1' },
    'expo-background-task': { BackgroundTaskStatus: { Available: 1 }, getStatusAsync: async () => {
      if (backgroundHold) { backgroundHold.entered.resolve(); await backgroundHold.release.promise; } return 1;
    }, registerTaskAsync: async (_name: string, options: { minimumInterval: number }) => { registered = true; interval = options.minimumInterval; }, unregisterTaskAsync: async () => { registered = false; } },
    'expo-task-manager': { isAvailableAsync: async () => true, isTaskRegisteredAsync: async () => registered },
    'expo-notifications': notifications,
    '../../../../source/shared/walletRelease': { readWalletReleaseFeed: async () => { reads++; return failFeed ? null : feed; } },
    '../../../../source/shared/walletReleaseMonitor': { WALLET_RELEASE_AUTOMATIC_INTERVAL_MS: 21600000,
      WalletReleaseMonitor: class extends WalletReleaseMonitor { constructor(config: ConstructorParameters<typeof WalletReleaseMonitor>[0]) { super({ ...config, now: () => clock }); } } },
    '../../../../source/shared/walletStores': { PALI_STORES: { ios: options.store ?? null } },
    '../platform/http': { walletFetch: () => { throw Error('unexpected'); } },
    './constants': { UPDATE_BACKGROUND_TASK: 'pali-store-updates-v1' },
    '../notifications/constants': { WALLET_BACKGROUND_INTERVAL_MINUTES: 15 },
    '../notifications/permission.native': { requestNativeNotificationPermission: async () => (await notifications.requestPermissionsAsync()).granted ? 'granted' : 'denied' },
  };
  const module = { exports: {} as { mobileUpdates: MobileUpdateService; runMobileUpdateBackground(): Promise<void>; isReleaseUpdateNotification(id: string): Promise<boolean> } };
  const code = ts.transpileModule(readFileSync(new NodeURL('../src/updates/service.native.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name: string) { const walletUi = walletUiFixture(name, imports); if (walletUi) return walletUi; assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { ...module.exports, data, removed, advance() { clock += 21600001; },
    get reads() { return reads; }, get posts() { return posts; }, get requests() { return requests; },
    get registered() { return registered; },
    get interval() { return interval; },
    failPost(value: boolean) { failPost = value; }, failFeed() { failFeed = true; },
    failReadOnce() { failRead = true; },
    failAlertsWrite(phase: 'before' | 'after', unreadable = false) { alertFailure = phase; failReconciliation = unreadable; },
    recoverAlertReads() { failAlertRead = false; },
    get alertWrites() { return alertWrites; },
    permission(value: boolean) { permission = value; },
    failPermissionOnce() { failPermission = true; },
    holdPermission() { hold = Promise.withResolvers<void>(); return hold; },
    holdNoticeWrite() { return noticeWriteHold = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }; },
    holdBackground() { return backgroundHold = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }; },
    holdAlertsWrite() { return alertWriteHold = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }; },
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

for (const initial of [false, true]) for (const failure of ['before', 'after', undefined] as const)
test(`update-alert acknowledgment follows persisted bytes after ${failure ?? 'healthy'} ${initial ? 'disable' : 'enable'}`, async () => {
  const f = fixture({ severity: 'routine' }); f.data.set('pali.update-alerts.v1', initial ? 'on' : 'off');
  await f.mobileUpdates.check();
  if (failure) f.failAlertsWrite(failure);
  const changed = f.mobileUpdates.setAlerts(!initial);
  if (failure) await assert.rejects(changed); else await changed;
  const expected = failure === 'before' ? initial : !initial;
  assert.equal(f.mobileUpdates.getSnapshot().alertsEnabled, expected);
  assert.equal(f.data.get('pali.update-alerts.v1'), expected ? 'on' : 'off');
  f.advance();
  await f.mobileUpdates.check(true);
  assert.equal(f.mobileUpdates.getSnapshot().alertsEnabled, expected);
  const cold = fixture({ severity: 'routine' }); for (const [key, value] of f.data) cold.data.set(key, value);
  await cold.mobileUpdates.check(); assert.equal(cold.mobileUpdates.getSnapshot().alertsEnabled, expected);
  assert.equal(f.alertWrites, 1); assert.equal(f.reads, 2); assert.equal(f.posts + cold.posts, 0);
});

test('unreadable ambiguous update preference suppresses alerts until a successful reload', async () => {
  const f = fixture({ severity: 'routine' }); await f.mobileUpdates.check();
  f.failAlertsWrite('after', true); await assert.rejects(f.mobileUpdates.setAlerts(false));
  assert.equal(f.data.get('pali.update-alerts.v1'), 'off'); assert.equal(f.registered, false);
  await assert.rejects(f.mobileUpdates.check(true)); assert.equal(f.posts, 0);
  f.recoverAlertReads(); await f.mobileUpdates.check(true);
  assert.equal(f.mobileUpdates.getSnapshot().alertsEnabled, false); assert.equal(f.registered, false);
});

test('a pending opt-out blocks fresh delivery before its storage write settles', async () => {
  const f = fixture(), gate = f.holdAlertsWrite();
  const disabling = f.mobileUpdates.setAlerts(false); await gate.entered.promise;
  await f.mobileUpdates.check(true); assert.equal(f.posts, 0);
  gate.release.resolve(); await disabling; assert.equal(f.registered, false); assert.equal(f.posts, 0);
});

test('serialized update preference writes let the latest toggle win over an older held write', async () => {
  const f = fixture({ severity: 'routine' }); f.data.set('pali.update-alerts.v1', 'off'); await f.mobileUpdates.check();
  const gate = f.holdAlertsWrite(), enabling = f.mobileUpdates.setAlerts(true); await gate.entered.promise;
  const disabling = f.mobileUpdates.setAlerts(false); gate.release.resolve(); await Promise.all([enabling, disabling]);
  await f.mobileUpdates.check(true);
  assert.equal(f.data.get('pali.update-alerts.v1'), 'off'); assert.equal(f.mobileUpdates.getSnapshot().alertsEnabled, false);
  assert.equal(f.alertWrites, 2); assert.equal(f.registered, false); assert.equal(f.posts, 0);
});

test('a newer failed permission action reloads an older committed write before acknowledging state', async () => {
  const f = fixture({ severity: 'routine' }); f.data.set('pali.update-alerts.v1', 'off'); await f.mobileUpdates.check();
  const gate = f.holdAlertsWrite(), older = f.mobileUpdates.setAlerts(true); await gate.entered.promise;
  f.failPermissionOnce(); const newer = assert.rejects(f.mobileUpdates.setAlerts(true));
  gate.release.resolve(); await Promise.all([older, newer]);
  assert.equal(f.data.get('pali.update-alerts.v1'), 'on');
  assert.equal(f.mobileUpdates.getSnapshot().alertsEnabled, true);
  f.advance(); await f.mobileUpdates.check(true); assert.equal(f.mobileUpdates.getSnapshot().alertsEnabled, true);
});
test('routine updates get a badge but no notification', async () => {
  const f = fixture({ severity: 'routine' }); await f.mobileUpdates.check();
  assert.equal(f.mobileUpdates.getSnapshot().release?.version, '5.0.1'); assert.equal(f.posts, 0);
});
test('a newer routine target still notifies for an unapplied critical fix', async () => {
  const f = fixture({ severity: 'critical', newerRoutine: true });
  await f.mobileUpdates.check();
  assert.equal(f.mobileUpdates.getSnapshot().release?.version, '5.0.2');
  assert.equal(f.mobileUpdates.getSnapshot().release?.severity, 'critical');
  assert.equal(f.posts, 1);
  f.advance(); await f.mobileUpdates.check(); assert.equal(f.posts, 1);
});
test('installing the critical fix stops critical notifications for a later routine target', async () => {
  const f = fixture({ severity: 'critical', newerRoutine: true, currentVersion: '5.0.1', currentBuild: '2' });
  await f.mobileUpdates.check();
  assert.equal(f.mobileUpdates.getSnapshot().release?.version, '5.0.2');
  assert.equal(f.mobileUpdates.getSnapshot().release?.severity, 'routine');
  assert.equal(f.posts, 0);
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
test('registering update alerts preserves the activity worker cadence', async () => {
  const f = fixture(); await f.mobileUpdates.check(); assert.equal(f.interval, 15);
});
test('cold background invocations throttle release I/O without changing worker cadence', async () => {
  const f = fixture(); await f.mobileUpdates.check();
  const cold = fixture();
  cold.data.set('pali.update-last-check.v1', f.data.get('pali.update-last-check.v1')!);
  await cold.runMobileUpdateBackground(); assert.equal(cold.reads, 0);
  // Foreground entry still loads the badge even when background I/O is throttled.
  await cold.mobileUpdates.check(); assert.equal(cold.reads, 1);
});


test('opt-out during notice persistence forgets the unsent marker and allows one later opted-in delivery', async () => {
  const f = fixture(), gate = f.holdNoticeWrite();
  const checking = f.mobileUpdates.check(); await gate.entered.promise;
  await f.mobileUpdates.setAlerts(false); gate.release.resolve(); await checking;
  assert.equal(f.posts, 0); assert.equal(f.data.has('pali.update-notice.v1'), false);
  await f.mobileUpdates.setAlerts(true); await f.mobileUpdates.check(true);
  assert.equal(f.posts, 1); assert.equal(f.mobileUpdates.getSnapshot().alertsEnabled, true);
  await f.mobileUpdates.check(true); f.advance(); await f.mobileUpdates.check();
  assert.equal(f.posts, 1);
});

test('retired unsent notice cleanup preserves another marker written before its continuation', async () => {
  const f = fixture(), gate = f.holdNoticeWrite();
  const checking = f.mobileUpdates.check(); await gate.entered.promise;
  await f.mobileUpdates.setAlerts(false);
  const newer = 'pali-update-android-6.0.0-3'; f.data.set('pali.update-notice.v1', newer);
  gate.release.resolve(); await checking;
  assert.equal(f.posts, 0); assert.equal(f.data.get('pali.update-notice.v1'), newer);
});
