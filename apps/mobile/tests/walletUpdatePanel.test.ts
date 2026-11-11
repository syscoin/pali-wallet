import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { unavailableAppUpdateState } from '../modules/pali-app-updates/index.ts';
import type { MobileUpdateSnapshot } from '../src/updates/types.ts';
import type { AppUpdateState } from '../modules/pali-app-updates/index.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture({ allowed = false, empty = false, exported = 'WalletUpdatePanel' } = {}) {
  let snapshot: MobileUpdateSnapshot = { status: 'ready', lastCheckedAt: Date.now(), lastAttemptAt: Date.now(), error: null,
    alertsEnabled: true, permission: 'granted', release: empty ? null : {
      platform: 'android', version: '5.0.1', build: 2, severity: 'important', title: 'Improved recovery', summary: 'Recovery fixes.',
      publishedAt: '2026-01-01T00:00:00Z', releaseNotesUrl: 'https://github.com/syscoin/pali-wallet/releases/tag/v5.0.1', availability: { status: 'published' },
    } };
  let store: AppUpdateState = { ...unavailableAppUpdateState, supported: true, storeAvailable: true, availability: 'available', flexibleAllowed: true };
  let queued: ReturnType<typeof Promise.withResolvers<AppUpdateState>> | undefined;
  let startHold: ReturnType<typeof Promise.withResolvers<'accepted'>> | undefined;
  const signals: AbortSignal[] = [];
  let starts = 0, completes = 0, checks = 0, locks = 0;
  const service = { getSnapshot: () => snapshot, subscribe: () => () => {}, async check() { checks++; }, async setAlerts() {} };
  const screen = screenFixture(new URL('../src/screens/WalletUpdatePanel.tsx', import.meta.url), exported, {
    'react-native': { AppState: { currentState: 'active' }, Linking: { openURL: async () => {} }, Modal: 'Modal', Platform: { OS: 'android' }, View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../../source/shared/walletStores': { PALI_STORES: { android: 'https://play.google.com/store/apps/details?id=com.paliwallet.mobile', ios: null } },
    '../platform/appUpdates': {
      async checkAppUpdate() { if (queued) { const pending = queued; queued = undefined; return pending.promise; } return store; },
      async startAppUpdate(mode: string, signal: AbortSignal) { assert.equal(mode, 'flexible'); starts++; signals.push(signal); return startHold?.promise ?? 'accepted'; },
      async completeAppUpdate(signal: AbortSignal) { completes++; signals.push(signal); },
      subscribeAppUpdates: () => () => {},
    },
    '../updates/service': { mobileUpdates: service },
    '../ui': { Button: 'Button', Card: 'Card', Header: 'Header', Icon: 'Icon', Notice: 'Notice', Screen: 'Screen', Text: 'Text', colors: {} },
  }, { AbortController });
  let props = { allowInstall: allowed, service, onLock: () => { locks++; } };
  const render = () => screenElements(screen.render(props));
  const find = (title: string) => render().find(item => item.type === 'Button' && item.props.title === title);
  const press = (title: string) => { const item = find(title); assert(item, title); assert.notEqual(item.props.disabled, true); item.props.onPress(); };
  render();
  return { render, find, press, screen, signals,
    allow(value: boolean) { props = { ...props, allowInstall: value }; render(); },
    fail() { snapshot = { ...snapshot, status: 'error', error: 'unavailable' }; },
    downloaded() { store = { ...store, installStatus: 'downloaded' }; },
    holdStart() { return startHold = Promise.withResolvers<'accepted'>(); },
    queueStore() { return queued = Promise.withResolvers<AppUpdateState>(); },
    get starts() { return starts; }, get completes() { return completes; }, get locks() { return locks; }, get checks() { return checks; },
  };
}

test('unlocked About cannot launch an in-app install', async () => {
  const f = fixture(); await settle();
  assert.equal(f.find('Download update'), undefined); f.press('Lock Pali to update');
  assert.equal(f.locks, 1); assert.equal(f.starts, 0); f.screen.close();
});
test('locked update uses flexible Play flow only after explicit action', async () => {
  const f = fixture({ allowed: true }); await settle();
  assert.equal(f.starts, 0); f.press('Download update'); await settle();
  assert.equal(f.starts, 1); assert.equal(f.completes, 0); f.screen.close();
});
test('download completion never installs automatically', async () => {
  const f = fixture({ allowed: true }); f.downloaded(); await settle();
  f.press('Check for updates'); await settle(); assert.equal(f.completes, 0);
  f.press('Restart and install'); await settle(); assert.equal(f.completes, 1); f.screen.close();
});
test('loss of safe surface aborts a pending install preflight and clears its busy presentation', async () => {
  const f = fixture({ allowed: true }); await settle(); const held = f.holdStart();
  f.press('Download update'); assert.equal(f.signals[0]?.aborted, false);
  f.allow(false); assert.equal(f.signals[0]?.aborted, true);
  assert.notEqual(f.find('Lock Pali to update')?.props.disabled, true);
  held.resolve('accepted'); await settle(); assert.equal(f.starts, 1); f.screen.close();
});
test('captured buttons cannot start an update after unmount', async () => {
  const f = fixture({ allowed: true }); await settle(); const button = f.find('Download update')!;
  f.screen.close(); button.props.onPress(); await settle(); assert.equal(f.starts, 0);
});
test('retained metadata reports latest check failure', async () => {
  const f = fixture(); f.fail(); await settle();
  assert(f.render().some(item => item.children.includes('The latest check failed. Showing the last known release.'))); f.screen.close();
});
test('Play-only update retains an entry on the locked screen without feed metadata', async () => {
  const f = fixture({ empty: true, exported: 'LockedWalletUpdate' }); await settle();
  assert(f.find('Update available')); f.screen.close();
});
