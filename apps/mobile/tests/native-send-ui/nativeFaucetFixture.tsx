// Public-only component adapters. This fixture never opens the real faucet or reads a wallet.
import React, { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Linking } from 'react-native';
import type { CustodySnapshot } from '../../src/custody/types';
import { getNativeNetwork, type EvmNetworkId } from '../../src/custody/networkContext';
import { createEvmWatchAccount, WatchOnlyAuthority, type BalanceReader } from '../../src/core/watchOnlyAuthority';
import { NativePortfolio } from '../../src/screens/NativePortfolio';
import { WatchAccountPortfolio } from '../../src/screens/WatchAccountPortfolio';
import { Text } from '../../src/ui';

const addresses = ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'];
const watch = new URLSearchParams(window.location.search).has('watch');
let state: CustodySnapshot = Object.freeze<CustodySnapshot>({ phase: 'ready', revision: 1, presence: 'existing', backup: 'confirmed', account: { address: addresses[0]!, network: 'zksys-testnet' }, error: null });
const listeners = new Set<(state: CustodySnapshot) => void>();
const source = { getSnapshot: () => state, subscribe(listener: (state: CustodySnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
const publish = () => { for (const listener of listeners) listener(state); };
const reader: BalanceReader = { async readBalance(id) { return { chainId: Number(getNativeNetwork(id).chainId), units: '0' }; } };
const authority = new WatchOnlyAuthority(addresses.map((address, index) => createEvmWatchAccount(`watch-${index}`, `Watch ${index + 1}`, address)), reader);
authority.unlock(); authority.selectNetwork('zksys-testnet');
let appState = 'active';
const appListeners = new Set<(state: string) => void>();
const opened: string[] = [];
let nextOpen: 'success' | 'failure' | 'pending' = 'success';
let release: ((fail: boolean) => void) | null = null;
let close: () => void = () => undefined;
let sends = 0;

if (new URLSearchParams(window.location.search).has('faucet')) {
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState });
  AppState.addEventListener = ((_event: string, listener: (value: string) => void) => {
    appListeners.add(listener); return { remove() { appListeners.delete(listener); } };
  }) as typeof AppState.addEventListener;
  Linking.openURL = async (url: string) => {
    opened.push(url);
    const result = nextOpen; nextOpen = 'success';
    if (result === 'failure') throw Error('Synthetic open failure');
    if (result === 'pending') await new Promise<void>((resolve, reject) => { release = (fail) => { release = null; if (fail) reject(Error('Synthetic late failure')); else resolve(); }; });
  };
}

declare global {
  interface Window {
    __nativeFaucetFixture: {
      opened(): string[];
      nextOpen(mode: 'success' | 'failure' | 'pending'): void;
      release(fail?: boolean): void;
      select(network: EvmNetworkId, index?: number): void;
      lifecycle(state: 'active' | 'background'): void;
      lock(): void;
      unmount(): void;
      sends(): number;
    };
  }
}
window.__nativeFaucetFixture = {
  opened: () => [...opened], nextOpen(mode) { nextOpen = mode; }, release(fail = false) { release?.(fail); },
  select(network, index = 0) {
    if (watch) { authority.selectAccount(`watch-${index}`); authority.selectNetwork(network); }
    else { state = Object.freeze({ ...state, revision: state.revision + 1, account: { network, address: addresses[index]! } }); publish(); }
  },
  lifecycle(value) { appState = value; for (const listener of [...appListeners]) listener(value); },
  lock() { if (watch) authority.lock(); else { state = Object.freeze({ ...state, revision: state.revision + 1, phase: 'locked', account: null }); publish(); } },
  unmount() { close(); }, sends: () => sends,
};

export function NativeFaucetFixture() {
  const [visible, setVisible] = useState(true);
  useLayoutEffect(() => { close = () => setVisible(false); return () => { close = () => undefined; }; }, []);
  const current = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  if (!visible) return <Text>Fixture closed</Text>;
  return watch ? <WatchAccountPortfolio authority={authority} onAccounts={() => undefined} onExit={() => setVisible(false)} onLock={() => authority.lock()} /> :
    <NativePortfolio source={source} reader={reader} accountLabel={current.account?.address === addresses[1] ? 'Account 2' : 'Account 1'} onExit={() => setVisible(false)} onLock={() => window.__nativeFaucetFixture.lock()} onViewRecovery={() => undefined} onSend={() => { sends++; }} />;
}
