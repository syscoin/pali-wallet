import assert from 'node:assert/strict';
import test from 'node:test';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { quietActivityNotifications } from './notificationFixture.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(kind: 'transaction-confirmed' | 'recovery-started', locked = false) {
  const address = '0x' + '22'.repeat(20), network = getNativeNetwork('base');
  let state = { status: locked ? 'locked' : 'ready', generation: 1, selectedAccountId: 'watch-1', selectedNetworkId: 'ethereum',
    accounts: [{ id: 'watch-1', name: 'First', addresses: { ethereum: '0x' + '11'.repeat(20) } },
      { id: 'watch-2', name: 'Second', addresses: { base: address } }] };
  const scope = { id: 'watch:watch-2:base', accountId: 'watch-2', accountType: 'watch', accountAddress: address, network, guardian: true };
  let choices = [{ scope, label: 'Second', networkName: 'Base', symbol: 'ETH' }];
  let tab = 'wallet', resolutions = 0;
  let pending: Promise<void> | undefined;
  const selections: string[] = [];
  const notification = { ...quietActivityNotifications.getSnapshot(), pendingEventId: `pali-alert-${'ab'.repeat(16)}` };
  const service = {
    ...quietActivityNotifications, getSnapshot: () => notification,
    async getPendingOwner() { return { accountId: 'watch-2', accountType: 'watch' }; },
    async resolveTapAfterUnlock(_id: string, validate: (value: typeof scope) => boolean) {
      resolutions++; await pending;
      return validate(scope) ? { scopeId: scope.id, accountId: scope.accountId, accountType: 'watch', networkId: 'base', kind, transactionHash: '0x' + 'ab'.repeat(32) } : null;
    },
  };
  const authority = {
    getSnapshot: () => state, subscribe: () => () => {}, getNetwork: (id: string) => getNativeNetwork(id),
    selectAccount(id: string) { selections.push(`account:${id}`); state = { ...state, selectedAccountId: id, selectedNetworkId: 'base', generation: state.generation + 1 }; },
    selectNetwork(id: string) { selections.push(`network:${id}`); state = { ...state, selectedNetworkId: id, generation: state.generation + 1 }; },
    async refresh() {},
  };
  const screen = screenFixture(new URL('../src/screens/WatchSession.tsx', import.meta.url), 'WatchSession', {
    'react-native': { AppState: { currentState: 'active' }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
    '../platform/security': {}, './AutoLockSettings': { AutoLockSettings: 'AutoLockSettings' },
    './RealAppShell': { RealAppShell: 'RealAppShell' }, './RealTools': { RealTools: 'RealTools' }, './RealSettings': { RealSettings: 'RealSettings' },
    './WatchAccountPortfolio': { WatchAccountPortfolio: 'WatchAccountPortfolio' }, './UtxoActivityScreen': { UtxoActivityScreen: 'UtxoActivityScreen' },
    './NativeActivity': { NativeActivityScreen: 'NativeActivityScreen' }, '../activity/watchActivity': { createWatchEvmActivity: () => ({}) },
    '../platform/http': {}, '../notifications/service': { nativeActivityNotifications: service },
    '../notifications/choices': { watchNotificationChoices: () => choices },
    './useRealShell': { useRealShell: () => ({ tab, immersive: false, navigation: {}, goBack() {}, select() {},
      restoreRoot(next: string) { tab = next; } }) },
  });
  const render = () => screenElements(screen.render({ authority, onAccounts() {}, onExit() {} }));
  return { render, close: screen.close, selections, tab: () => tab, resolutions: () => resolutions,
    hold(value: Promise<void>) { pending = value; }, replace() { choices = []; } };
}

test('watch transaction tap selects its saved account/network before showing Activity', async () => {
  const f = fixture('transaction-confirmed');
  try {
    f.render(); await settle();
    assert.deepEqual(f.selections, ['account:watch-2']); assert.equal(f.tab(), 'activity');
    assert.equal(f.render().find(node => node.type === 'NativeActivityScreen')?.props.initialHash, '0x' + 'ab'.repeat(32));
  } finally { f.close(); }
});

test('watch guardian tap resumes the existing recovery tool for that exact scope', async () => {
  const f = fixture('recovery-started');
  try {
    f.render(); await settle(); assert.equal(f.tab(), 'tools');
    const tools = f.render().find(node => node.type === 'RealTools');
    assert.equal(tools?.props.initialGuardianScope, '2:watch-2:base');
  } finally { f.close(); }
});

test('watch catalogue changes retire pending tap resolution', async () => {
  const f = fixture('transaction-confirmed'), held = Promise.withResolvers<void>(); f.hold(held.promise);
  try {
    f.render(); await settle(); f.replace(); held.resolve(); await settle();
    assert.deepEqual(f.selections, []); assert.equal(f.tab(), 'wallet');
  } finally { f.close(); }
});

test('privacy-locked watch sessions leave a pending tap unresolved', async () => {
  const f = fixture('transaction-confirmed', true);
  try { f.render(); await settle(); assert.equal(f.resolutions(), 0); assert.deepEqual(f.selections, []); }
  finally { f.close(); }
});
