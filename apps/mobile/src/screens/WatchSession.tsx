import React, { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, BackHandler } from 'react-native';
import type { WatchOnlyAuthority } from '../core/watchOnlyAuthority';
import { getNetwork } from '../core/networks';
import { RealAppShell, UnavailableActivity } from './RealAppShell';
import { RealTools } from './RealTools';
import { RealSettings } from './RealSettings';
import { WatchAccountPortfolio } from './WatchAccountPortfolio';
import { useRealShell } from './useRealShell';

/** Owns public navigation only; the existing App-owned authority remains authoritative. */
export function WatchSession({ authority, onAccounts, onExit }: {
  authority: WatchOnlyAuthority; onAccounts(): void; onExit(): void;
}) {
  const subscribe = useCallback((listener: () => void) => authority.subscribe(listener), [authority]);
  const getSnapshot = useCallback(() => authority.getSnapshot(), [authority]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
  const account = snapshot.accounts.find((row) => row.id === snapshot.selectedAccountId);
  const network = getNetwork(snapshot.selectedNetworkId);
  const label = account?.name ?? 'Watch account';
  const openAccounts = () => { if (AppState.currentState === 'active' && currentScope()) onAccounts(); };
  let content: React.ReactNode;
  if (shell.tab === 'wallet') content = <WatchAccountPortfolio authority={authority} onAccounts={openAccounts} onExit={onExit} onLock={onExit} navigation={shell.navigation} />;
  else if (shell.tab === 'activity') content = <UnavailableActivity accountLabel={`${label} · ${network.name}`} watchOnly onBack={() => shell.select('wallet')} />;
  else if (shell.tab === 'tools') content = <RealTools accountLabel={label} networkLabel={network.name} watchOnly onAccounts={openAccounts} onBack={() => shell.select('wallet')} />;
  else content = <RealSettings accountLabel={label} watchOnly onLock={onExit} onBack={() => shell.select('wallet')} />;
  return <RealAppShell tab={shell.tab} onTab={shell.select} immersive={shell.immersive || snapshot.status !== 'ready'}>{content}</RealAppShell>;
}
