import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  clearNavigationState,
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
  connectionUnavailable,
}: {
  connectionUnavailable?: boolean;
  controllerEmitter: (...args: any[]) => Promise<any>;
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
  const internalRef = useRef(internal);
  const pathRef = useRef(location.pathname);
  const mountedRef = useRef(true);
  const markerRef = useRef<any>();
  const markerKeyRef = useRef<string>();
  const safeRestoreRef = useRef(false);
  const departedRef = useRef(false);
  const liveRef = useRef({ location, isUnlocked, connectionUnavailable });
  liveRef.current = { location, isUnlocked, connectionUnavailable };
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
  const isCurrent = () => {
    const live = liveRef.current;
    return (
      mountedRef.current &&
      !departedRef.current &&
      nativeLocationMatches() &&
      live.isUnlocked &&
      !live.connectionUnavailable &&
      (!internalRef.current ||
        JSON.stringify(getWalletNavigationScope()) === scopeRef.current) &&
      live.location.pathname === pathRef.current &&
      ((live.location.key === entryRef.current &&
        live.location.state?.submissionStarted !== true) ||
        (live.location.state?.submissionStarted === true &&
          (live.location.key === markerKeyRef.current ||
            live.location.state === markerRef.current)))
    );
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!isCurrent()) departedRef.current = true;
  }, [location, isUnlocked, connectionUnavailable, scopeChanged]);
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
    markerRef.current = { submissionStarted: true };
    navigate(location.pathname, { replace: true, state: markerRef.current });
    const nativeKey =
      typeof window !== 'undefined' ? window.history.state?.key : undefined;
    if (typeof nativeKey === 'string' && nativeKey !== entryRef.current)
      markerKeyRef.current = nativeKey;
    await clearNavigationState();
    try {
      if (!isCurrent()) return;
      await action();
    } finally {
      if (!isCurrent()) return;
      setPending(false);
      if (!attempt.mayBroadcast || attempt.definitelyNotBroadcast) {
        consumedEntries.delete(entryRef.current);
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
    blocked:
      blocked || scopeChanged || !isUnlocked || Boolean(connectionUnavailable),
    pending,
    unknown,
    state:
      scopeChanged || !isUnlocked || connectionUnavailable || !isCurrent()
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
