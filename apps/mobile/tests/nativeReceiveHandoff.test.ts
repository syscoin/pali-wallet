import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(deferPassiveEffects = false) {
  const network = { id: 'ethereum', kind: 'evm', chainId: '1', testnet: false };
  const choice = { scope: { id: 'choice-eth', accountId: 'hd:60:0', accountAddress: '0x' + '11'.repeat(20), network }, networkName: 'Ethereum', symbol: 'ETH' };
  const state = { status: 'ready', filter: 'all', currency: 'usd', knownValue: 1, partial: false, refreshing: false,
    choices: [choice], rows: [{ choice, status: 'available', units: '100', decimals: 18, price: null, tokens: [], collectibles: [], assetsAvailable: true }] };
  const appState = { currentState: 'active' };
  let tree: unknown;
  let rejectNavigation = false;
  let back: (() => boolean) | undefined;
  let sends = 0;
  const observations: { visibleAtNavigation: boolean | undefined; receive: boolean }[] = [];
  const modal = () => screenElements(tree).find(node => node.type === 'Modal');
  const sheet = () => screenElements(tree).find(node => node.type === 'NetworkSourceSheet');
  const source = { getCatalogue: () => ({ active: { accountId: 'hd:60:0' } }),
    getSnapshot: () => ({ account: { network: network.id }, backup: 'confirmed' }) };
  const controller = { getSnapshot: () => state, subscribe: () => () => {}, connect: () => () => {},
    setCurrency() {}, cachedBalances: () => [], refresh: async () => {}, selectFilter: async () => {} };
  const ui = { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'Icon', 'IconButton', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {} };
  const f = screenFixture(new URL('../src/screens/NativeAccountOverview.tsx', import.meta.url), 'NativeAccountOverview', {
    '../ui/WalletModal': { WalletModal: 'Modal' },
    'react-native': { AppState: appState, View: 'View', StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../platform/localization': { useNativeTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) },
    '../portfolio/accountPortfolio': {}, '../core/amounts': { formatBaseUnits: (value: string) => value },
    '../../../../source/shared/erc20': { formatTokenUnits: (value: string) => value },
    '../portfolio/fiatDisplay': { formatIndicativeFiat: () => '1 USD' },
    '../platform/fiatPreferences': { useFiatCurrency: () => ({ status: 'ready', currency: 'usd' }) },
    '../platform/balancePrivacy': { HIDDEN_BALANCE: 'hidden', useBalancePrivacy: () => ({ hidden: false }) },
    '../custody/networkContext': { nativeSigningEnabled: () => true }, '../ui': ui,
    './IdleActivityBoundary': { IdlePressable: 'Pressable' }, './NativePortfolio': { NativePortfolio: 'NativePortfolio' },
    './NetworkSourceSheet': { NetworkSourceSheet: 'NetworkSourceSheet' }, './WalletBackupBadge': { WalletBackupBadge: 'WalletBackupBadge' },
    '../activity/activityAmountLabel': { compactActivityAmountLabel: (value: string) => value },
  }, {}, {}, { deferPassiveEffects });
  const props = { controller, portfolio: { source, onSend() {}, onExit() {}, onLock() {}, onViewRecovery() {},
      navigation: { beginNavigation() {}, registerBack(callback: () => boolean) { back = callback; return () => {}; } } },
    selectNetwork: async () => {}, send: async () => { sends++; },
    async navigateDetail(_choice: unknown, receive: boolean, _token: unknown, check: () => void) {
      check(); observations.push({ visibleAtNavigation: modal()?.props.visible, receive });
      if (rejectNavigation) throw new Error('Synthetic navigation failure');
    } };
  const render = () => { tree = f.render(props); return tree; };
  const open = (title = 'buttons.receive') => {
    render(); f.flushPassiveEffects();
    screenElements(tree).find(node => node.type === 'Button' && node.props.title === title)!.props.onPress();
    render(); f.flushPassiveEffects(); assert.equal(modal()?.props.visible, true);
  };
  return { open, render, close: f.close, observations, modal, sheet, flushPassive: f.flushPassiveEffects,
    select: () => sheet()!.props.onSelect('choice-eth:native'), back: () => back!(),
    rejectNavigation: (value: boolean) => { rejectNavigation = value; }, background: () => { appState.currentState = 'background'; },
    asset: () => screenElements(tree).find(node => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('ETH,'))!.props.onPress(),
    sends: () => sends };
}

test('Receive waits for a committed closed sheet and admits only one busy handoff', async () => {
  const f = fixture(true);
  try {
    f.open(); f.select(); f.select();
    assert.equal(f.observations.length, 0);
    f.render(); assert.equal(f.modal()?.props.visible, false); assert.equal(f.sheet()?.props.busy, true);
    f.flushPassive(); await flush();
    assert.deepEqual(f.observations, [{ visibleAtNavigation: false, receive: true }]);
    f.render(); assert.equal(f.sheet()?.props.busy, false);
  } finally { f.close(); }
});

for (const afterCommit of [false, true]) test(`Back retires Receive ${afterCommit ? 'after the closed commit, before passive release' : 'before the closed commit'}`, async () => {
  const f = fixture(true);
  try {
    f.open(); f.select();
    if (afterCommit) { f.render(); assert.equal(f.modal()?.props.visible, false); }
    assert.equal(f.back(), true);
    f.render(); f.flushPassive(); await flush(); f.render();
    assert.equal(f.observations.length, 0); assert.equal(f.modal()?.props.visible, false);
  } finally { f.close(); }
});

test('a current navigation failure restores an enabled Receive chooser and permits retry', async () => {
  const f = fixture(true);
  try {
    f.rejectNavigation(true); f.open(); f.select(); f.render(); f.flushPassive(); await flush(); f.render();
    assert.equal(f.observations.length, 1); assert.equal(f.modal()?.props.visible, true);
    assert.equal(f.sheet()?.props.busy, false); assert.equal(f.sheet()?.props.error, 'mobile.accountPortfolio.error');
    f.rejectNavigation(false); f.select(); f.render(); f.flushPassive(); await flush(); f.render();
    assert.equal(f.observations.length, 2); assert.equal(f.modal()?.props.visible, false);
    assert.equal(f.sheet()?.props.busy, false); assert.equal(f.sheet()?.props.error, undefined);
  } finally { f.close(); }
});

test('unmount releases a pending Receive handoff without dispatch', async () => {
  const f = fixture(true);
  f.open(); f.select(); f.close(); await flush(); assert.equal(f.observations.length, 0);
});

test('background retirement cannot dispatch or reopen Receive', async () => {
  const f = fixture(true);
  try {
    f.open(); f.select(); f.render(); f.background(); f.flushPassive(); await flush(); f.render();
    assert.equal(f.observations.length, 0); assert.equal(f.modal()?.props.visible, false);
  } finally { f.close(); }
});

test('asset detail and Send-from retain their immediate handoff paths', async () => {
  const f = fixture(true);
  try {
    f.render(); f.flushPassive(); f.asset();
    assert.deepEqual(f.observations, [{ visibleAtNavigation: false, receive: false }]);
    await flush(); f.open('buttons.send'); f.select();
    assert.equal(f.sends(), 1); await flush(); f.render(); assert.equal(f.modal()?.props.visible, false);
  } finally { f.close(); }
});
