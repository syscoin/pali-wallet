import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { unavailableAppUpdateState } from '../modules/pali-app-updates/index.ts';
import type { MobileUpdateSnapshot } from '../src/updates/types.ts';
import type { AppUpdateState } from '../modules/pali-app-updates/index.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture({ allowed = false, empty = false, exported = 'WalletUpdatePanel', initialStore = {}, phase = 'ready' }: {
  allowed?: boolean; empty?: boolean; exported?: string; initialStore?: Partial<AppUpdateState>; phase?: 'closing' | 'ready' | 'failed';
} = {}) {
  let snapshot: MobileUpdateSnapshot = { status: 'ready', lastCheckedAt: Date.now(), lastAttemptAt: Date.now(), error: null,
    alertsEnabled: true, permission: 'granted', release: empty ? null : {
      platform: 'android', version: '5.0.1', build: 2, severity: 'important', title: 'Improved recovery', summary: 'Recovery fixes.',
      publishedAt: '2026-01-01T00:00:00Z', releaseNotesUrl: 'https://github.com/syscoin/pali-wallet/releases/tag/v5.0.1', availability: { status: 'published' },
    } };
  let store: AppUpdateState = { ...unavailableAppUpdateState, supported: true, storeAvailable: true, availability: 'available', flexibleAllowed: true, ...initialStore };
  let queued: ReturnType<typeof Promise.withResolvers<AppUpdateState>> | undefined;
  let startHold: ReturnType<typeof Promise.withResolvers<'accepted'>> | undefined;
  const signals: AbortSignal[] = [];
  const openedUrls: string[] = [];
  const listeners = new Set<(state: AppUpdateState) => void>();
  let panelMounts = 0, panelUnmounts = 0;
  let starts = 0, completes = 0, checks = 0, locks = 0;
  const service = { getSnapshot: () => snapshot, subscribe: () => () => {}, async check() { checks++; }, async setAlerts() {} };
  const imports = {
    '../platform/localization': nativeTranslationFixture,
    'react-native': { AppState: { currentState: 'active' }, Linking: { openURL: async (url: string) => { openedUrls.push(url); } }, Modal: 'Modal', Platform: { OS: 'android' }, View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../../source/shared/walletStores': { PALI_STORES: { android: 'https://play.google.com/store/apps/details?id=com.paliwallet.mobile', ios: null } },
    '../platform/appUpdates': {
      async checkAppUpdate() { if (queued) { const pending = queued; queued = undefined; return pending.promise; } return store; },
      async startAppUpdate(mode: string, signal: AbortSignal) { assert.equal(mode, 'flexible'); starts++; signals.push(signal); return startHold?.promise ?? 'accepted'; },
      async completeAppUpdate(signal: AbortSignal) { completes++; signals.push(signal); },
      subscribeAppUpdates(listener: (state: AppUpdateState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    '../updates/service': { mobileUpdates: service },
    '../ui': { Button: 'Button', Card: 'Card', Header: 'Header', Icon: 'Icon', Notice: 'Notice', Screen: 'Screen', Text: 'Text', colors: {} },
  };
  const createScreen = (name: string) => screenFixture(new URL('../src/screens/WalletUpdatePanel.tsx', import.meta.url), name, imports, { AbortController });
  const screen = createScreen(exported);
  const updateScreen = createScreen('WalletUpdateScreen');
  let child: ReturnType<typeof createScreen> | undefined;
  let opened = false;
  let props = { allowInstall: allowed, service, phase, onCloseWallet: () => { locks++; }, onOpen: () => { opened = true; }, onBack: () => { opened = false; } };
  const render = () => {
    const elements = screenElements(exported === 'LockedWalletUpdate' && opened ? updateScreen.render(props) : screen.render(props));
    if (exported === 'WalletUpdatePanel') return elements;
    const panel = elements.find(item => typeof item.type === 'function' && item.type.name === 'WalletUpdatePanel');
    if (panel) {
      if (!child) { child = createScreen('WalletUpdatePanel'); panelMounts++; }
      return [...elements, ...screenElements(child.render(panel.props))];
    }
    if (child) { child.close(); child = undefined; panelUnmounts++; }
    return elements;
  };
  const find = (title: string) => render().find(item => item.type === 'Button' && item.props.title === title);
  const press = (title: string) => { const item = find(title); assert(item, title); assert.notEqual(item.props.disabled, true); item.props.onPress(); };
  render();
  return { render, find, press, screen: { ...screen, close() { child?.close(); child = undefined; screen.close(); updateScreen.close(); } }, signals, openedUrls,
    publish(next: Partial<AppUpdateState>) { store = { ...store, ...next }; for (const listener of [...listeners]) listener(store); },
    allow(value: boolean) { props = { ...props, allowInstall: value }; render(); },
    fail() { snapshot = { ...snapshot, status: 'error', error: 'unavailable' }; },
    downloaded() { store = { ...store, installStatus: 'downloaded' }; },
    holdStart() { return startHold = Promise.withResolvers<'accepted'>(); },
    queueStore() { return queued = Promise.withResolvers<AppUpdateState>(); },
    get panelMounts() { return panelMounts; }, get panelUnmounts() { return panelUnmounts; },
    get starts() { return starts; }, get completes() { return completes; }, get locks() { return locks; }, get checks() { return checks; },
  };
}

test('unlocked About cannot launch an in-app install', async () => {
  const f = fixture(); await settle();
  assert.equal(f.find('Download update'), undefined); f.press('Close wallet to update');
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
  assert.notEqual(f.find('Close wallet to update')?.props.disabled, true);
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

for (const empty of [true, false]) test(`locked ${empty ? 'Play-only' : 'feed-backed'} update remains mounted through the native download lifecycle`, async () => {
  const f = fixture({ empty, exported: 'LockedWalletUpdate' }); await settle();
  try {
    f.press(empty ? 'Update available' : 'Update available · 5.0.1'); f.render(); await settle();
    assert.equal(f.panelMounts, 1); assert.equal(f.panelUnmounts, 0);
    f.press('Download update'); await settle(); assert.equal(f.starts, 1); assert.equal(f.completes, 0);
    for (const [state, expected] of [
      ['pending', 'Update download pending.'],
      ['downloading', 'Downloading update · 42%'],
      ['downloaded', 'Your update is ready to install.'],
    ] as const) {
      f.publish({ availability: 'in-progress', installStatus: state, bytesDownloaded: 42, totalBytesToDownload: 100 });
      const elements = f.render();
      assert(elements.some(item => item.type === 'Header' && item.props.title === 'Update Pali'));
      assert(elements.some(item => item.children.includes(expected)), expected);
      assert.equal(elements.some(item => item.children.includes('No newer published release was found.')), false);
      assert.equal(f.find('Download update'), undefined);
      assert.equal(f.panelMounts, 1); assert.equal(f.panelUnmounts, 0);
      assert.equal(f.completes, 0, 'A native status event must never install automatically');
      if (!empty) assert(elements.some(item => item.children.includes('Recovery fixes.')));
    }
    assert(f.find('Restart and install')); f.press('Restart and install'); await settle();
    assert.equal(f.completes, 1); assert.equal(f.starts, 1);
    f.press('Done'); f.render(); assert.equal(f.panelUnmounts, 1);
  } finally { f.screen.close(); }
});

for (const installStatus of ['pending', 'downloading', 'unknown'] as const) test(`a reopened locked panel can observe a Play-only ${installStatus} update already in progress`, async () => {
  const f = fixture({ empty: true, exported: 'LockedWalletUpdate', initialStore: { availability: 'in-progress', installStatus } }); await settle();
  try {
    assert(f.find('Update in progress')); f.press('Update in progress'); f.render(); await settle();
    assert(f.render().some(item => item.children.some(child => typeof child === 'string' && /pending|Downloading|in progress/.test(child))));
    assert.equal(f.find('Download update'), undefined); assert.equal(f.find('Restart and install'), undefined);
    assert.equal(f.starts, 0); assert.equal(f.completes, 0);
  } finally { f.screen.close(); }
});

test('native progress takes precedence over a stale available flag without granting unlocked installation', async () => {
  const f = fixture({ empty: true }); await settle();
  try {
    f.publish({ availability: 'available', installStatus: 'downloading', bytesDownloaded: 5, totalBytesToDownload: 10 });
    assert(f.render().some(item => item.children.includes('Downloading update · 50%')));
    assert.equal(f.find('Download update'), undefined); assert.equal(f.find('Restart and install'), undefined);
    f.press('Close wallet to update'); assert.equal(f.locks, 1); assert.equal(f.starts, 0); assert.equal(f.completes, 0);
  } finally { f.screen.close(); }
});

for (const installStatus of ['failed', 'cancelled'] as const) test(`a native ${installStatus} event overrides stale in-progress availability and exposes manual recovery`, async () => {
  const f = fixture({ empty: true, exported: 'LockedWalletUpdate' }); await settle();
  try {
    f.press('Update available'); f.render(); await settle();
    f.press('Download update'); await settle();
    f.publish({ availability: 'in-progress', installStatus: 'pending' }); f.render();
    f.publish({ installStatus: 'downloading', bytesDownloaded: 42, totalBytesToDownload: 100 }); f.render();
    f.publish({ installStatus });
    const elements = f.render();
    assert(elements.some(item => item.type === 'Header' && item.props.title === 'Update Pali'));
    assert(elements.some(item => item.children.some(value => typeof value === 'string' && value.includes(`update download ${installStatus === 'cancelled' ? 'was cancelled' : 'failed'}`))));
    assert.equal(elements.some(item => item.children.some(value => typeof value === 'string' && /[Ii]n progress|Downloading update|No newer published/.test(value))), false);
    assert(f.find('View in app store')); assert(f.find('Check for updates'));
    assert.equal(f.find('Download update'), undefined); assert.equal(f.find('Restart and install'), undefined);
    assert.equal(f.starts, 1); assert.equal(f.completes, 0); assert.deepEqual(f.openedUrls, []);
    assert.equal(f.panelMounts, 1); assert.equal(f.panelUnmounts, 0);
    f.press('View in app store'); await settle();
    assert.deepEqual(f.openedUrls, ['https://play.google.com/store/apps/details?id=com.paliwallet.mobile']);
  } finally { f.screen.close(); }
});

for (const phase of ['closing', 'failed'] as const) test(`update surface cannot install while wallet shutdown is ${phase}`, async () => {
  const f = fixture({ exported: 'WalletUpdateScreen', phase }); await settle();
  try {
    assert.equal(f.find('Download update'), undefined);
    assert.equal(f.find('Restart and install'), undefined);
    assert.equal(f.find('View in app store'), undefined);
    assert.equal(f.panelMounts, 0);
    assert.equal(f.find('Done')?.props.disabled, phase === 'closing');
    assert.equal(f.starts, 0); assert.equal(f.completes, 0);
  } finally { f.screen.close(); }
});

test('an installed event is terminal even when availability still says in-progress', async () => {
  const f = fixture({ empty: true, exported: 'LockedWalletUpdate' }); await settle();
  try {
    f.press('Update available'); f.render(); await settle();
    f.publish({ availability: 'in-progress', installStatus: 'installed' });
    const elements = f.render();
    assert(elements.some(item => item.children.includes('The update was installed.')));
    assert.equal(elements.some(item => item.children.includes('In progress')), false);
    assert.equal(f.find('Download update'), undefined); assert.equal(f.find('Restart and install'), undefined);
    assert.equal(f.starts, 0); assert.equal(f.completes, 0);
  } finally { f.screen.close(); }
});
