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
import { WatchActivity } from './WatchActivity';
import { createWatchEvmActivity } from '../activity/watchActivity';
import { NativeActivityScreen } from './NativeActivity';

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
  if (autoLockScope !== null && autoLockScope === liveScope) return <AutoLockSettings mode="watch" onBack={() => setAutoLockScope(null)} save={(expected, minutes, _password, check) => {
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
    ? <WatchActivity authority={authority} navigation={shell.navigation} onBack={() => shell.select('wallet')} />
    : <NativeActivityScreen controller={evmActivity} accountLabel={label} onBack={() => shell.select('wallet')} navigation={shell.navigation} />;
  else if (shell.tab === 'tools') content = <RealTools accountLabel={label} networkLabel={network.name} watchOnly onAccounts={openAccounts} onBack={() => shell.select('wallet')} navigation={shell.navigation} />;
  else content = <RealSettings navigation={shell.navigation} accountLabel={label} watchOnly onAutoLock={() => setAutoLockScope(currentScope())} onLock={onExit} onBack={() => shell.select('wallet')} />;
  return <RealAppShell tab={shell.tab} onTab={shell.select} immersive={shell.immersive || snapshot.status !== 'ready'}>{content}</RealAppShell>;
}
