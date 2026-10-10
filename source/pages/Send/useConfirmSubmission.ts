import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { getControllerStatus } from 'hooks/controllerStatus';
import {
  clearTransactionNavigationState,
  getTransactionReturnContext,
  getWalletNavigationScope,
} from 'utils/navigationState';

// Consumed entries live only in this document. Browser history never stores a
// submission token or the transaction payload once an attempt starts.
const consumedEntries = new Map<string, symbol>();
const BROADCAST_METHODS = new Set([
  'signSendAndSaveTransaction',
  'sendAndSaveEthTransaction',
  'sendAndSaveTokenTransaction',
  'submitSmartAccountExecution',
]);

export const useConfirmSubmission = ({
  location,
  navigate,
  controllerEmitter,
  isUnlocked,
  isLoading,
  connectionUnavailable,
}: {
  connectionUnavailable?: boolean;
  controllerEmitter: (...args: any[]) => Promise<any>;
  isLoading?: boolean;
  isUnlocked: boolean;
  location: { key: string; pathname: string; state: any };
  navigate: (path: string, options?: any) => void;
}) => {
  const currentScope = useSelector(() =>
    JSON.stringify(getWalletNavigationScope())
  );
  const internal =
    !location.pathname.startsWith('/external') &&
    location.state?.external !== true;
  const validInitialScope =
    !internal || JSON.stringify(location.state?.walletScope) === currentScope;
  const consumed =
    location.state?.submissionStarted === true ||
    consumedEntries.has(location.key);
  const stateRef = useRef(
    consumed || !validInitialScope ? undefined : location.state
  );
  const entryRef = useRef(location.key);
  const scopeRef = useRef(currentScope);
  const walletScopeRef = useRef(getWalletNavigationScope());
  const internalRef = useRef(internal);
  const pathRef = useRef(location.pathname);
  const mountedRef = useRef(true);
  const markerRef = useRef<any>();
  const markerKeyRef = useRef<string>();
  const safeRestoreRef = useRef(false);
  const departedRef = useRef(false);
  const liveRef = useRef({
    location,
    isUnlocked,
    isLoading,
    connectionUnavailable,
  });
  liveRef.current = { location, isUnlocked, isLoading, connectionUnavailable };
  const blockedRef = useRef(consumed);
  const attemptRef = useRef<{
    definitelyNotBroadcast: boolean;
    mayBroadcast: boolean;
    successful: boolean;
  } | null>(null);
  const [blocked, setBlocked] = useState(consumed);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(consumed);
  const scopeChanged = internalRef.current && currentScope !== scopeRef.current;
  if (
    safeRestoreRef.current &&
    !departedRef.current &&
    !scopeChanged &&
    location.pathname === pathRef.current &&
    location.state === stateRef.current
  ) {
    entryRef.current = location.key;
    safeRestoreRef.current = false;
  }
  const nativeLocationMatches = () => {
    if (typeof window === 'undefined') return true;
    const nativeKey = window.history.state?.key;
    if (
      typeof nativeKey === 'string' &&
      nativeKey !== entryRef.current &&
      nativeKey !== markerKeyRef.current
    )
      return false;
    const hashRoute = window.location.hash.startsWith('#/')
      ? window.location.hash.slice(1).split(/[?#]/)[0]
      : undefined;
    // A memory router has no native entry. Actual popup/hash and external
    // document routes must agree even before React commits their navigation.
    if (
      !hashRoute &&
      window.location.pathname === '/' &&
      typeof nativeKey !== 'string'
    )
      return true;
    return (hashRoute || window.location.pathname) === pathRef.current;
  };
  const ownsRoute = () => {
    const live = liveRef.current;
    return (
      mountedRef.current &&
      nativeLocationMatches() &&
      live.location.pathname === pathRef.current &&
      (live.location.key === entryRef.current ||
        (live.location.state?.submissionStarted === true &&
          (live.location.key === markerKeyRef.current ||
            live.location.state === markerRef.current)))
    );
  };
  const hasTrustedAuth = () => {
    const live = liveRef.current;
    const fresh = getControllerStatus();
    const trusted =
      live.isUnlocked &&
      !live.isLoading &&
      !live.connectionUnavailable &&
      fresh.isUnlocked &&
      !fresh.isLoading &&
      !fresh.connectionUnavailable;
    // Status can publish before React commits new auth props. A begun attempt
    // must stay consumed even if trust recovers before the next render.
    if (!trusted && attemptRef.current) departedRef.current = true;
    return trusted;
  };
  const isCurrent = () => {
    const live = liveRef.current;
    return (
      ownsRoute() &&
      !departedRef.current &&
      hasTrustedAuth() &&
      (!internalRef.current ||
        JSON.stringify(getWalletNavigationScope()) === scopeRef.current) &&
      ((live.location.key === entryRef.current &&
        live.location.state?.submissionStarted !== true) ||
        (live.location.state?.submissionStarted === true &&
          (live.location.key === markerKeyRef.current ||
            live.location.state === markerRef.current)))
    );
  };
  const trustedAuth = hasTrustedAuth();
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    // A focus check temporarily removes trust. Keep an idle entry in memory,
    // while an attempt that has started can never resume after losing trust.
    if (
      !ownsRoute() ||
      scopeChanged ||
      !isUnlocked ||
      (!trustedAuth && attemptRef.current)
    ) {
      departedRef.current = true;
      if (attemptRef.current) {
        setPending(false);
        setUnknown(
          attemptRef.current.mayBroadcast && !attemptRef.current.successful
        );
      }
    }
  }, [location, isUnlocked, trustedAuth, scopeChanged]);
  const assertCurrent = () => {
    if (!isCurrent())
      throw Object.assign(new Error('Confirmation is no longer active.'), {
        transactionNotBroadcast: true,
      });
  };

  const recordError = (error: any) => {
    if (attemptRef.current && error?.transactionNotBroadcast === true) {
      attemptRef.current.definitelyNotBroadcast = true;
    }
  };
  const invoke = async (...args: any[]) => {
    const broadcasting = BROADCAST_METHODS.has(args[0]?.[1]);
    if (broadcasting && attemptRef.current) {
      assertCurrent();
      attemptRef.current.mayBroadcast = true;
      attemptRef.current.definitelyNotBroadcast = false;
      attemptRef.current.successful = false;
    }
    try {
      const response = await controllerEmitter(...args);
      if (broadcasting && attemptRef.current)
        attemptRef.current.successful = true;
      return response;
    } catch (error) {
      if (broadcasting) recordError(error);
      throw error;
    }
  };
  const run = async (action: () => Promise<void>) => {
    if (blockedRef.current || !stateRef.current?.tx || !isCurrent()) return;
    blockedRef.current = true;
    consumedEntries.set(entryRef.current, Symbol('submission'));
    const attempt = {
      mayBroadcast: false,
      successful: false,
      definitelyNotBroadcast: false,
    };
    attemptRef.current = attempt;
    setBlocked(true);
    setPending(true);
    setUnknown(false);
    // Keep the active component's required transaction only in its ref. Native
    // Back/Forward or a recreated document sees an inert marker, never a send.
    markerRef.current = {
      submissionStarted: true,
      walletScope: walletScopeRef.current,
      returnContext: getTransactionReturnContext(
        stateRef.current?.returnContext,
        walletScopeRef.current
      ),
    };
    navigate(location.pathname, { replace: true, state: markerRef.current });
    const nativeKey =
      typeof window !== 'undefined' ? window.history.state?.key : undefined;
    if (typeof nativeKey === 'string' && nativeKey !== entryRef.current)
      markerKeyRef.current = nativeKey;
    try {
      await clearTransactionNavigationState({
        requireDiscard: true,
        assertCurrent: isCurrent,
      });
      if (!isCurrent()) return;
      await action();
    } finally {
      if (!isCurrent()) {
        if (ownsRoute()) {
          setPending(false);
          setUnknown(attempt.mayBroadcast && !attempt.successful);
        }
        return;
      }
      setPending(false);
      if (!attempt.mayBroadcast || attempt.definitelyNotBroadcast) {
        consumedEntries.delete(entryRef.current);
        attemptRef.current = null;
        blockedRef.current = false;
        setBlocked(false);
        setUnknown(false);
        safeRestoreRef.current = true;
        navigate(location.pathname, { replace: true, state: stateRef.current });
        const restoredKey =
          typeof window !== 'undefined' ? window.history.state?.key : undefined;
        if (typeof restoredKey === 'string') entryRef.current = restoredKey;
      } else {
        setUnknown(!attempt.successful);
      }
    }
  };

  return {
    blocked: blocked || scopeChanged || !trustedAuth,
    pending,
    unknown,
    interrupted: Boolean(departedRef.current && attemptRef.current),
    hasUsableEntry: Boolean(stateRef.current?.tx) && !scopeChanged,
    isActive: isCurrent,
    ownsRoute,
    returnContext:
      consumed || attemptRef.current || !validInitialScope || scopeChanged
        ? getTransactionReturnContext(
            stateRef.current?.returnContext || location.state?.returnContext,
            getWalletNavigationScope()
          )
        : stateRef.current?.returnContext || location.state?.returnContext,
    state:
      scopeChanged || !trustedAuth || !isCurrent()
        ? undefined
        : stateRef.current,
    controllerEmitter: invoke,
    recordError,
    beforeBroadcast: async () => {
      assertCurrent();
      if (attemptRef.current) {
        attemptRef.current.mayBroadcast = true;
        attemptRef.current.definitelyNotBroadcast = false;
        attemptRef.current.successful = false;
      }
    },
    run,
  };
};
