import assert from 'node:assert/strict';
import test from 'node:test';
import { WatchAccounts } from '../src/core/watchAccounts.ts';
import * as core from '../src/core/index.ts';
import { createEvmWatchAccount, WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';
import { createWatchAccountCodec } from '../src/core/watchAccountCodec.ts';
import type { WatchRecordSnapshot } from '../src/core/publicAccountStorage.ts';
import { UTXO_NETWORKS } from '../src/core/utxoNetworks.ts';
import { accountIdentity, projectAccounts } from '../src/core/accountDirectory.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

const FIRST = '0x1111111111111111111111111111111111111111';
const SECOND = '0x2222222222222222222222222222222222222222';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const translation = nativeTranslationFixture.useNativeTranslation().t;
// App is evaluated in a VM while the real core is imported by Node. Transfer
// the App-built data across that artificial realm boundary without altering it.
class FixtureWatchAccounts extends WatchAccounts {
  override change(change: Parameters<WatchAccounts['change']>[0]) {
    return super.change(structuredClone(change));
  }
}

function fixture() {
  const first = createEvmWatchAccount('first', 'First', FIRST);
  const decoded = createWatchAccountCodec(UTXO_NETWORKS).validate([{ kind: 'address', ...first }]);
  let saved: WatchRecordSnapshot = { version: 1, records: decoded.records, accounts: decoded.accounts, utxoNetworks: decoded.utxoNetworks };
  let failWrite = false, failOpen = false, heldOpen: ReturnType<typeof deferred> | undefined, heldWrite: ReturnType<typeof deferred> | undefined;
  let openStarted = deferred();
  let writeStarted = deferred();
  const opened: WatchOnlyAuthority[] = [];
  const record = { writes: 0, opens: 0, reads: 0, credentials: 0, balances: 0 };
  const repository = {
    assertNetworkCurrent() {},
    async load() { record.reads++; return saved; },
    async compareAndSet(expected: WatchRecordSnapshot, records: WatchRecordSnapshot['records']) {
      record.writes++;
      const held = heldWrite; heldWrite = undefined; writeStarted.resolve(); if (held) await held.promise;
      if (failWrite) throw new Error('Public list write failed');
      assert.equal(expected, saved);
      const next = createWatchAccountCodec(UTXO_NETWORKS).validate(records);
      saved = { version: 1, records: next.records, accounts: next.accounts, utxoNetworks: next.utxoNetworks }; return saved;
    },
  };
  const openRecords: typeof WatchOnlyAuthority.openRecords = async options => {
    record.opens++; const held = heldOpen; heldOpen = undefined; openStarted.resolve();
    if (held) await held.promise;
    if (failOpen) throw new Error('Saved public accounts could not be opened');
    // Return late even after cancellation to exercise the parent's ownership check.
    const next = await WatchOnlyAuthority.openRecords({ ...options, signal: new AbortController().signal }); opened.push(next); return next;
  };
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const appState = { currentState: 'active', addEventListener(name: string, listener: (...args: any[]) => void) {
    const values = listeners.get(name) ?? new Set(); values.add(listener); listeners.set(name, values); return { remove() { values.delete(listener); } };
  } };
  const native = { View: 'View', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'ios' }, AppState: appState, BackHandler: { addEventListener: () => ({ remove() {} }) }, StyleSheet: { create: (value: unknown) => value },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) }, Linking: {}, Share: {} };
  const idle = { allowNewInput() {}, invalidate() {}, begin() {}, stop() {}, check: () => true, pause: () => () => true };
  let privacy: { phase: 'unlocked' | 'locked' } = { phase: 'unlocked' };
  const publicViewLock = { subscribe: () => () => {}, getSnapshot: () => privacy, load: async () => {}, assertUnlocked() { assert.equal(privacy.phase, 'unlocked'); },
    async unlock() { record.credentials++; assert.fail('Public reconnect must not request authentication'); }, cancelUnlock() {}, lock: async () => {} };
  const ui = { ...Object.fromEntries(['Button', 'Card', 'Header', 'IconButton', 'Notice', 'Screen', 'Text', 'Icon', 'Coin', 'PaliMark', 'Row', 'Label'].map(name => [name, name])), colors: {}, styles: {} };
  const accounts = screenFixture(new URL('../src/screens/WalletAccounts.tsx', import.meta.url), 'WalletAccounts', {
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    './IdleActivityBoundary': { IdlePressable: 'Pressable', IdleTextInput: 'Input' }, '../core/accountDirectory': { accountIdentity, projectAccounts }, '../core/networks': core,
    './Onboarding': { AddWatchAccount: 'AddWatchAccount' },
  });
  const app = screenFixture(new URL('../App.tsx', import.meta.url), 'default', {
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider' }, './src/ui': ui,
    './src/ui/WalletBackHandler': { WalletBackHandler: { addEventListener: () => ({ remove() {} }) } }, './src/ui/WalletModal': { WalletModal: 'Modal', WalletModalHost: 'WalletModalHost' },
    './src/platform/localization': { ...nativeTranslationFixture, nativeI18n: { t: translation } },
    './src/platform/security': { publicViewLock, watchIdle: idle, custodyIdle: idle, securityPreferences: { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready' }), load: async () => {} } },
    './src/screens/IdleActivityBoundary': { IdleActivityBoundary: 'IdleBoundary', IdlePressable: 'Pressable', IdleTextInput: 'Input' },
    './src/platform/credential': { isNativeCredentialPromptActive: () => false, authorizePublicView: async () => { record.credentials++; assert.fail('No credentials'); } },
    './src/platform/cameraPermission': { isCameraPermissionPromptActive: () => false },
    './src/connections/pairingLinks': { NativePairingInbox: class { getSnapshot = () => null; subscribe = () => () => {}; consume() {} }, observePairingLinks: () => () => {} },
    './src/notifications/service': { nativeActivityNotifications: { subscribe: () => () => {}, getSnapshot: () => ({ pendingEventId: null }), disableOwner: async () => {} }, isNotificationPermissionPromptActive: () => false },
    './src/notifications/choices': { watchNotificationChoices: () => [] },
    './src/notifications/permissionReturn': { NotificationPermissionReturn: class { discard() {} take() { return null; } pause() {} resume() {} } },
    './src/screens/Onboarding': { WelcomeScreen: 'WelcomeScreen', AddWatchAccount: 'AddWatchAccount' },
    './src/screens/NativeWallet': { NativeWalletScreen: 'NativeWalletScreen' }, './src/screens/WalletAccounts': { WalletAccounts: 'WalletAccounts' },
    './src/screens/WatchSession': { WatchSession: 'WatchSession' }, './src/screens/Settings': {}, './src/screens/NetworkSourceSheet': { NetworkSourceSheet: 'NetworkSourceSheet' }, './src/design/Studio': {},
    './src/core/watchAccounts': { WatchAccounts: FixtureWatchAccounts }, './src/core/accountDirectory': { accountIdentity, projectAccounts, nativeAccountSelection: () => null },
    './src/core/index': { ...core, WatchOnlyAuthority: { openRecords } },
    './src/platform': { publicAccountRecords: repository, balanceReader: { async readBalance() { record.balances++; return { chainId: 1, units: '1' }; } },
      activityReader: undefined, evmActivityReaders: undefined, isNativePersistence: false, loadAccountSelection: async () => null, saveAccountSelection: async () => {} },
    'expo-status-bar': { StatusBar: 'StatusBar' }, 'expo-clipboard': {}, 'react-native-qrcode-svg': 'QRCode',
  }, { AbortController, performance });
  const security = screenElements(app.render({})).find(element => typeof element.type === 'function' && element.type.name === 'SecurityGate')!; assert(security);
  const content = screenElements(app.renderChild(security)).find(element => typeof element.type === 'function' && element.type.name === 'AppContent')!; assert(content);
  const render = () => screenElements(app.renderChild(content));
  const accountProps = () => { const element = render().find(element => element.type === 'WalletAccounts'); assert(element, 'The actual App displays its public account chooser'); return element.props; };
  const chooser = () => screenElements(accounts.render(accountProps()));
  const button = (tree: ScreenElement[], title: string) => { const value = tree.find(element => element.type === 'Button' && element.props.title === title); assert(value, `${title}: ${JSON.stringify(tree.map(element => [String(element.type), element.props.title, element.props.body]))}`); return value; };
  const showAccounts = () => {
    const tree = render(), session = tree.find(element => element.type === 'WatchSession');
    if (session) session.props.onAccounts(); else button(tree, 'Accounts').props.onPress();
  }; render();
  return { record, opened, render, chooser, accountProps, button, showAccounts,
    async start() { await tick(); render(); await tick(); render(); },
    add: () => accountProps().onAdd({ name: 'Second', address: SECOND, network: 'evm' }),
    recover() { failOpen = false; }, failOpen() { failOpen = true; }, failWrite() { failWrite = true; },
    waitForOpen() { openStarted = deferred(); return openStarted.promise; }, holdOpen() { heldOpen = deferred(); return heldOpen; },
    waitForWrite() { writeStarted = deferred(); return writeStarted.promise; }, holdWrite() { heldWrite = deferred(); return heldWrite; },
    lockPublic() { privacy = { phase: 'locked' }; },
    background() { appState.currentState = 'background'; for (const listener of listeners.get('change') ?? []) listener('background'); },
    foreground() { appState.currentState = 'active'; for (const listener of listeners.get('change') ?? []) listener('active'); },
    saved: () => saved, close() { accounts.close(); app.close(); },
  };
}
const secondRow = (tree: ScreenElement[]) => { const row = tree.find(element => element.type === 'Pressable' && String(element.props.accessibilityLabel).includes(SECOND)); assert(row); return row; };
const reopen = 'Reopen watch accounts';
async function started() {
  const f = fixture(); await f.start();
  f.button(f.render(), 'View my accounts').props.onPress(); await tick();
  assert.equal(f.opened[0]!.getSnapshot().status, 'ready');
  f.showAccounts(); return f;
}

test('committed Add plus failed reopen exposes recovery, retires the old view and never requires a duplicate Add', async () => {
  const f = await started();
  try {
    f.failOpen(); await f.add();
    assert.equal(f.saved().accounts.length, 2); assert.equal(f.record.writes, 1); assert.equal(f.opened[0]!.getSnapshot().status, 'locked');
    const tree = f.chooser(); assert.equal(secondRow(tree).props.disabled, true); assert.equal(secondRow(tree).props.accessibilityState.disabled, true);
    assert.equal(f.button(tree, reopen).props.disabled, false); assert.equal(f.accountProps().watchConnection.status, 'unavailable'); assert.equal(f.record.credentials, 0);
    f.accountProps().onBack();
    assert(f.button(f.render(), 'View my accounts'), 'Retirement published the locked snapshot before the listener was removed');
    f.showAccounts(); assert.equal(f.button(f.chooser(), reopen).props.disabled, false);
  } finally { f.close(); }
});
test('healthy committed Add reopens the actual records and selects the new watch row', async () => {
  const f = await started();
  try { await f.add(); await tick(); assert.equal(f.record.writes, 1); assert.equal(f.record.opens, 2);
    assert.equal(f.render().find(element => element.type === 'WatchSession')?.props.authority.getSnapshot().selectedAccountId, f.saved().accounts[1]!.id); assert.equal(f.record.credentials, 0);
  } finally { f.close(); }
});
test('failed list write preserves the previous record and exposes Reopen without reopening', async () => {
  const f = await started();
  try { f.failWrite(); await assert.rejects(f.add(), /could not be verified/); assert.equal(f.saved().accounts.length, 1); assert.equal(f.record.opens, 1);
    assert.equal(f.accountProps().watch.status, 'unavailable'); assert.equal(f.button(f.chooser(), reopen).props.disabled, false);
  } finally { f.close(); }
});
test('explicit Reopen recovers the already committed row with exactly one write', async () => {
  const f = await started();
  try { f.failOpen(); await f.add(); f.recover(); f.button(f.chooser(), reopen).props.onPress(); await tick();
    const row = secondRow(f.chooser()); assert.equal(row.props.disabled, false); await row.props.onPress(); await tick();
    assert.equal(f.record.writes, 1); assert.equal(f.record.opens, 3);
    assert.equal(f.render().find(element => element.type === 'WatchSession')?.props.authority.getSnapshot().selectedAccountId, f.saved().accounts[1]!.id); assert.equal(f.record.credentials, 0);
  } finally { f.close(); }
});
for (const departure of ['navigation', 'background', 'lock', 'unmount'] as const) test(`late reconnect cannot install or unlock after ${departure}`, async () => {
  const f = await started();
  try { const gate = f.holdOpen(), entered = f.waitForOpen(); const pending = f.add(); await entered;
    if (departure === 'navigation') f.accountProps().onOpenWallet(); if (departure === 'background') f.background(); if (departure === 'lock') f.lockPublic(); if (departure === 'unmount') f.close();
    gate.resolve(); await pending; await tick(); assert.equal(f.saved().accounts.length, 2); assert.equal(f.record.writes, 1); assert.equal(f.opened.at(-1)!.getSnapshot().status, 'locked');
    if (departure === 'navigation') assert(f.render().some(element => element.type === 'NativeWalletScreen'));
    if (departure === 'background') { f.foreground(); assert.equal(f.accountProps().watchConnection.status, 'unavailable'); } assert.equal(f.record.credentials, 0);
  } finally { f.close(); }
});

for (const departure of ['navigation', 'background', 'lock'] as const) test(`a committed save after ${departure} does not start a stale reconnect`, async () => {
  const f = await started();
  try {
    const gate = f.holdWrite(), entered = f.waitForWrite();
    const pending = f.add(); await entered;
    if (departure === 'navigation') f.accountProps().onOpenWallet();
    if (departure === 'background') f.background();
    if (departure === 'lock') f.lockPublic();
    gate.resolve(); await pending; await tick();
    assert.equal(f.saved().accounts.length, 2); assert.equal(f.record.writes, 1);
    assert.equal(f.record.opens, 1); assert.equal(f.record.credentials, 0);
    if (departure === 'navigation') assert(f.render().some(element => element.type === 'NativeWalletScreen'));
  } finally { f.close(); }
});

test('an older late reconnect cannot replace a successful explicit retry', async () => {
  const f = await started();
  try {
    const gate = f.holdOpen(), entered = f.waitForOpen();
    const pending = f.add(); await entered;
    await f.accountProps().onRetry();
    const installed = f.opened.at(-1)!;
    gate.resolve(); await pending; await tick();
    assert.equal(f.accountProps().watchConnection.status, 'ready');
    const row = secondRow(f.chooser()); assert.equal(row.props.disabled, false);
    await row.props.onPress(); await tick();
    assert.equal(f.render().find(element => element.type === 'WatchSession')?.props.authority, installed);
    assert.equal(f.record.writes, 1); assert.equal(f.record.opens, 3); assert.equal(f.record.credentials, 0);
  } finally { f.close(); }
});
