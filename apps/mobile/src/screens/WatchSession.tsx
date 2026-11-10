import { AutoLockSettings } from './AutoLockSettings';
import { securityPreferences, watchIdle } from '../platform/security';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler } from 'react-native';
import type { WatchOnlyAuthority } from '../core/watchOnlyAuthority';
import { RealAppShell } from './RealAppShell';
import { RealTools } from './RealTools';
import { RealSettings } from './RealSettings';
import { WatchAccountPortfolio } from './WatchAccountPortfolio';
import { useRealShell } from './useRealShell';
import { UtxoActivityScreen } from './UtxoActivityScreen';
import { createWatchEvmActivity } from '../activity/watchActivity';
import { NativeActivityScreen } from './NativeActivity';
import { walletFetch } from '../platform/http';

const readGuardianStatus: import('../core/watchOnlyAuthority').GuardianRecoveryReader = async (network, address, signal, check) => {
  const { EvmTransferReadRpc } = await import('../custody/evmTransferReadRpc');
  check();
  return new EvmTransferReadRpc(network, { fetch: walletFetch }).readGuardianRecoveryStatus(address, signal, check);
};

/** Owns public navigation only; the existing App-owned authority remains authoritative. */
export function WatchSession({ authority, onAccounts, onExit }: {
  authority: WatchOnlyAuthority; onAccounts(): void; onExit(): void;
}) {
  const subscribe = useCallback((listener: () => void) => authority.subscribe(listener), [authority]);
  const getSnapshot = useCallback(() => authority.getSnapshot(), [authority]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const evmActivity = useMemo(() => createWatchEvmActivity(authority), [authority]);
  const currentScope = () => {
    const state = authority.getSnapshot();
    return state.status === 'ready' ? `${state.generation}:${state.selectedAccountId}:${state.selectedNetworkId}` : null;
  };
  const identity = snapshot.status === 'ready' ? `${snapshot.selectedAccountId}:${snapshot.selectedNetworkId}` : null;
  const shell = useRealShell(identity, currentScope, onExit);
  const latestBack = useRef(shell.goBack);
  useLayoutEffect(() => { latestBack.current = shell.goBack; });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { latestBack.current(); return true; });
    return () => subscription.remove();
  }, []);
  const [autoLockScope, setAutoLockScope] = useState<string | null>(null);
  const liveScope = currentScope();
  if (autoLockScope !== null && autoLockScope === liveScope) return <AutoLockSettings mode="watch" onBack={() => { if (currentScope() === autoLockScope) setAutoLockScope(null); }} save={(expected, minutes, _password, check) => {
    const captured = liveScope;
    return securityPreferences.save(expected, 'watch', minutes, () => { check(); watchIdle.assertCurrent(); if (captured !== currentScope()) throw Error('CANCELLED'); });
  }} />;
  const account = snapshot.accounts.find((row) => row.id === snapshot.selectedAccountId);
  const network = authority.getNetwork(snapshot.selectedNetworkId);
  const label = account?.name ?? 'Watch account';
  const openAccounts = () => { if (AppState.currentState === 'active' && currentScope()) onAccounts(); };
  let content: React.ReactNode;
  if (shell.tab === 'wallet') content = <WatchAccountPortfolio authority={authority} onAccounts={openAccounts} onExit={onExit} onLock={onExit} navigation={shell.navigation} />;
  else if (shell.tab === 'activity') content = network.kind === 'utxo'
    ? <UtxoActivityScreen authority={authority} selectedNetwork={network} accountLabel={label} navigation={shell.navigation} onBack={() => shell.select('wallet')} />
    : <NativeActivityScreen controller={evmActivity} accountLabel={label} onBack={() => shell.select('wallet')} navigation={shell.navigation} />;
  else if (shell.tab === 'tools') {
    const address = network.kind === 'evm' && account?.addresses[network.id];
    content = <RealTools accountLabel={label} networkLabel={network.name} watchOnly onAccounts={openAccounts}
      onBack={() => shell.select('wallet')} navigation={shell.navigation} guardianRecovery={liveScope && address ? {
        scope: liveScope, address,
        read: (signal, check) => authority.readGuardianRecovery(readGuardianStatus, signal, () => {
          if (AppState.currentState !== 'active' || currentScope() !== liveScope) throw new Error('CANCELLED');
          check();
        }),
      } : undefined} />;
  }
  else content = <RealSettings navigation={shell.navigation} accountLabel={label} watchOnly onAutoLock={() => {
    if (liveScope && AppState.currentState === 'active' && currentScope() === liveScope) setAutoLockScope(liveScope);
  }} onLock={onExit} onBack={() => shell.select('wallet')} />;
  return <RealAppShell tab={shell.tab} onTab={shell.select} immersive={shell.immersive || snapshot.status !== 'ready'}>{content}</RealAppShell>;
}
