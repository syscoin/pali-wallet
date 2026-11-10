import assert from 'node:assert/strict';
import test from 'node:test';
import { SecurityPreferences } from '../src/core/securityPreferences.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

async function fixture() {
  let raw: string | null = null, writes = 0, idleChecks = 0, exits = 0;
  const preferences = new SecurityPreferences({ get: async () => raw, set: async value => { raw = value; writes++; } });
  await preferences.load();
  let state = { status: 'ready', generation: 1, selectedAccountId: 'watch-1', selectedNetworkId: 'ethereum',
    accounts: [{ id: 'watch-1', name: 'Watch account', addresses: { ethereum: '0x1111111111111111111111111111111111111111' } }] };
  const native = { AppState: { currentState: 'active' }, BackHandler: { addEventListener: () => ({ remove() {} }) } };
  const authority = { getSnapshot: () => state, subscribe: () => () => {}, getNetwork: (id: string) => ({ kind: 'evm', id, name: 'Ethereum' }) };
  const navigation = { registerBack: () => () => {}, setImmersive() {} };
  const screen = screenFixture(new URL('../src/screens/WatchSession.tsx', import.meta.url), 'WatchSession', {
    'react-native': native,
    '../platform/security': { securityPreferences: preferences, watchIdle: { assertCurrent() { idleChecks++; } } },
    './AutoLockSettings': { AutoLockSettings: 'AutoLockSettings' },
    './RealAppShell': { RealAppShell: 'RealAppShell' }, './RealTools': { RealTools: 'RealTools' }, './RealSettings': { RealSettings: 'RealSettings' },
    './WatchAccountPortfolio': { WatchAccountPortfolio: 'WatchAccountPortfolio' }, './UtxoActivityScreen': { UtxoActivityScreen: 'UtxoActivityScreen' },
    './NativeActivity': { NativeActivityScreen: 'NativeActivityScreen' }, '../activity/watchActivity': { createWatchEvmActivity: () => ({}) },
    '../platform/http': { walletFetch: async () => { throw Error('Unexpected network'); } },
    './useRealShell': { useRealShell: () => ({ tab: 'settings', navigation, immersive: false, goBack() {}, select() {} }) },
  });
  const render = () => screen.render({ authority, onAccounts() {}, onExit() { exits++; } });
  const settings = () => screenElements(render()).find(node => node.type === 'RealSettings')!;
  return { render, settings, preferences, close: screen.close,
    changeScope() { state = { ...state, generation: state.generation + 1 }; },
    background() { native.AppState.currentState = 'background'; },
    counts: () => ({ writes, idleChecks, exits }) };
}

test('watch Settings opens Auto-lock, saves only watch timeout and returns to Settings on Back', async () => {
  const f = await fixture();
  try {
    const settings = f.settings(); assert.equal(settings.props.watchOnly, true);
    settings.props.onAutoLock(); const route = f.render();
    assert.equal(route.type, 'AutoLockSettings'); assert.equal(route.props.mode, 'watch');
    await route.props.save(f.preferences.getSnapshot().value, 30, '', () => undefined);
    assert.deepEqual(f.preferences.getSnapshot().value, { version: 1, custodyIdleMinutes: 5, watchIdleMinutes: 30 });
    assert(f.counts().idleChecks > 0); assert.equal(f.counts().writes, 1);
    route.props.onBack(); assert(f.settings()); assert.equal(f.counts().exits, 0);
  } finally { f.close(); }
});

test('stale watch Settings and Auto-lock callbacks cannot act on a replacement scope', async () => {
  const f = await fixture();
  try {
    const oldSettings = f.settings(); f.changeScope(); oldSettings.props.onAutoLock();
    assert(f.settings());
    f.settings().props.onAutoLock(); const oldRoute = f.render(); assert.equal(oldRoute.type, 'AutoLockSettings');
    const expected = f.preferences.getSnapshot().value;
    f.changeScope(); f.settings().props.onAutoLock();
    assert.equal(f.render().type, 'AutoLockSettings');
    oldRoute.props.onBack(); assert.equal(f.render().type, 'AutoLockSettings');
    await assert.rejects(oldRoute.props.save(expected, 30, '', () => undefined), /CANCELLED/);
    assert.equal(f.counts().writes, 0);
  } finally { f.close(); }
});

test('watch Auto-lock cannot open from a captured Settings callback after background', async () => {
  const f = await fixture();
  try {
    const settings = f.settings(); f.background(); settings.props.onAutoLock();
    assert(f.settings()); assert.equal(f.counts().writes, 0);
  } finally { f.close(); }
});
