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
import { watchNotificationChoices } from '../notifications/choices';
import { nativeActivityNotifications } from '../notifications/service';

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
  const notifications = useSyncExternalStore(nativeActivityNotifications.subscribe, nativeActivityNotifications.getSnapshot, nativeActivityNotifications.getSnapshot);
  const evmActivity = useMemo(() => createWatchEvmActivity(authority), [authority]);
  const currentScope = useCallback(() => {
    const state = authority.getSnapshot();
    return state.status === 'ready' ? `${state.generation}:${state.selectedAccountId}:${state.selectedNetworkId}` : null;
  }, [authority]);
  const identity = snapshot.status === 'ready' ? `${snapshot.selectedAccountId}:${snapshot.selectedNetworkId}` : null;
  const shell = useRealShell(identity, currentScope, onExit);
  const restoreRoot = shell.restoreRoot;
  const latestBack = useRef(shell.goBack);
  useLayoutEffect(() => { latestBack.current = shell.goBack; });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { latestBack.current(); return true; });
    return () => subscription.remove();
  }, []);
  const [autoLockScope, setAutoLockScope] = useState<string | null>(null);
  const liveScope = currentScope();
  const [notificationActivity, setNotificationActivity] = useState<{ scope: string; hash: string } | null>(null);
  const [notificationGuardian, setNotificationGuardian] = useState<string | null>(null);
  const notificationTransition = useRef<object | null>(null);
  const [notificationWake, setNotificationWake] = useState(0);
  const lastNotificationAttempt = useRef('');
  const lifetime = useRef({ alive: true, authority, immersive: shell.immersive, autoLockScope });
  useLayoutEffect(() => { lifetime.current.authority = authority; lifetime.current.immersive = shell.immersive; lifetime.current.autoLockScope = autoLockScope; });
  useLayoutEffect(() => { const owner = lifetime.current; owner.alive = true; return () => { owner.alive = false; notificationTransition.current = null; }; }, []);
  const notificationSettings = liveScope ? {
    scope: liveScope,
    assertCurrent() {
      if (!lifetime.current.alive || lifetime.current.authority !== authority || AppState.currentState !== 'active' || currentScope() !== liveScope)
        throw Error('CANCELLED');
    },
    readChoices: () => watchNotificationChoices(authority),
  } : undefined;
  useEffect(() => {
    if (snapshot.status !== 'ready') return;
    try {
      const choices = watchNotificationChoices(authority), catalogueKey = JSON.stringify(choices);
      const check = () => {
        const current = authority.getSnapshot();
        if (!lifetime.current.alive || lifetime.current.authority !== authority || current.status !== 'ready' ||
            current.generation !== snapshot.generation || JSON.stringify(watchNotificationChoices(authority)) !== catalogueKey) throw Error('CANCELLED');
      };
      check();
      void nativeActivityNotifications.replaceAccountTypes(['watch'], choices.map(choice => choice.scope), check).catch(() => undefined);
    } catch { /* Keep enrollment while a full, current public catalogue is unavailable. */ }
  }, [authority, snapshot.status, snapshot.generation, snapshot.accounts]);
  useEffect(() => {
    const eventId = notifications.pendingEventId, attemptKey = `${eventId}:${liveScope}`;
    if (!eventId || !liveScope || autoLockScope || shell.immersive || notificationTransition.current ||
        lastNotificationAttempt.current === attemptKey || AppState.currentState !== 'active') return;
    const token = {};
    notificationTransition.current = token; lastNotificationAttempt.current = attemptKey;
    const check = () => {
      const owner = lifetime.current;
      if (!owner.alive || owner.authority !== authority || owner.immersive || owner.autoLockScope ||
          notificationTransition.current !== token || AppState.currentState !== 'active' || !currentScope()) throw Error('CANCELLED');
    };
    void (async () => {
      const owner = await nativeActivityNotifications.getPendingOwner();
      check();
      if (owner?.accountType !== 'watch' || nativeActivityNotifications.getSnapshot().pendingEventId !== eventId) return;
      const catalogueKey = JSON.stringify(watchNotificationChoices(authority));
      const currentChoice = (id: string) => {
        check();
        const choices = watchNotificationChoices(authority);
        if (JSON.stringify(choices) !== catalogueKey) throw Error('CANCELLED');
        return choices.find(choice => choice.scope.id === id);
      };
      const route = await nativeActivityNotifications.resolveTapAfterUnlock(eventId, scope => {
        try { return currentScope() === liveScope && JSON.stringify(currentChoice(scope.id)?.scope) === JSON.stringify(scope); } catch { return false; }
      });
      if (!route) return;
      const choice = currentChoice(route.scopeId);
      if (!choice || currentScope() !== liveScope || route.accountId !== choice.scope.accountId || route.networkId !== choice.scope.network.id) return;
      const before = authority.getSnapshot();
      if (before.selectedAccountId !== route.accountId) authority.selectAccount(route.accountId);
      if (authority.getSnapshot().selectedNetworkId !== route.networkId) authority.selectNetwork(choice.scope.network.id);
      check();
      const after = authority.getSnapshot(), scope = currentScope();
      if (!scope || after.selectedAccountId !== route.accountId || after.selectedNetworkId !== route.networkId ||
          after.accounts.find(account => account.id === route.accountId)?.addresses[after.selectedNetworkId] !== choice.scope.accountAddress) return;
      if (route.kind.startsWith('transaction-')) {
        setNotificationActivity(route.transactionHash ? { scope, hash: route.transactionHash } : null);
        restoreRoot('activity', `${route.accountId}:${route.networkId}`);
      } else {
        setNotificationGuardian(scope);
        restoreRoot('tools', `${route.accountId}:${route.networkId}`);
      }
      void authority.refresh().catch(() => undefined);
    })().catch(() => undefined).finally(() => {
      if (notificationTransition.current !== token) return;
      notificationTransition.current = null;
      const pending = nativeActivityNotifications.getSnapshot().pendingEventId;
      if (lifetime.current.alive && pending && pending !== eventId) setNotificationWake(value => value + 1);
    });
  }, [notifications.pendingEventId, notificationWake, liveScope, autoLockScope, shell.immersive, authority, currentScope, restoreRoot]);
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
    ? <UtxoActivityScreen authority={authority} selectedNetwork={network} accountLabel={label} initialHash={notificationActivity?.scope === liveScope ? notificationActivity.hash : undefined} navigation={shell.navigation} onBack={() => shell.select('wallet')} />
    : <NativeActivityScreen controller={evmActivity} accountLabel={label} initialHash={notificationActivity?.scope === liveScope ? notificationActivity.hash : undefined} onBack={() => shell.select('wallet')} navigation={shell.navigation} />;
  else if (shell.tab === 'tools') {
    const address = network.kind === 'evm' && account?.addresses[network.id];
    content = <RealTools accountLabel={label} networkLabel={network.name} watchOnly onAccounts={openAccounts}
      initialGuardianScope={notificationGuardian} onGuardianOpened={() => setNotificationGuardian(null)}
      onBack={() => shell.select('wallet')} navigation={shell.navigation} guardianRecovery={liveScope && address ? {
        scope: liveScope, address,
        read: (signal, check) => authority.readGuardianRecovery(readGuardianStatus, signal, () => {
          if (AppState.currentState !== 'active' || currentScope() !== liveScope) throw new Error('CANCELLED');
          check();
        }),
      } : undefined} />;
  }
  else content = <RealSettings navigation={shell.navigation} notifications={notificationSettings} accountLabel={label} watchOnly onAutoLock={() => {
    if (liveScope && AppState.currentState === 'active' && currentScope() === liveScope) setAutoLockScope(liveScope);
  }} onLock={onExit} onBack={() => shell.select('wallet')} />;
  return <RealAppShell tab={shell.tab} onTab={tab => { notificationTransition.current = null; shell.select(tab); }} immersive={shell.immersive || snapshot.status !== 'ready'}>{content}</RealAppShell>;
}
