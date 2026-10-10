import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  clearNavigationState,
  getWalletNavigationScope,
  isRestorableWalletRoute,
  loadNavigationState,
  saveNavigationState,
} from 'utils/navigationState';

import { useController } from './useController';

// HashRouter maps the manifest's bare app.html popup to '/'. Every named
// route, including bare '/home', is an explicit destination.
const POPUP_ENTRY_ROUTES = new Set(['/']);
const SEND_DRAFT_ROUTES = new Set(['/send/eth', '/send/sys']);
const SCROLL_SAVE_THROTTLE_MS = 200;

const isExternalNavigation = (pathname: string, search: string) => {
  const documentPath = window.location.pathname;
  const queries = [window.location.search, search].map(
    (query) => new URLSearchParams(query)
  );
  return (
    documentPath === '/external.html' ||
    documentPath === '/external' ||
    documentPath.startsWith('/external/') ||
    pathname === '/external' ||
    pathname.startsWith('/external/') ||
    queries.some((query) => query.has('route') || query.has('externalRoute'))
  );
};

/** Preserve ordinary browsing in the main popup, never an approval or secret view. */
export const useNavigationState = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isUnlocked, isLoading, connectionUnavailable } = useController();
  // Balance updates do not restart storage work; account/network changes do.
  const scope = useSelector(() => JSON.stringify(getWalletNavigationScope()));
  const external = isExternalNavigation(location.pathname, location.search);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const settledRef = useRef(false);
  const needsNeutralFallbackRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const pendingRef = useRef<{
    generation: number;
    key: string;
    scope: string;
  } | null>(null);
  const restoredTargetRef = useRef<{
    path: string;
    previousKey: string;
  } | null>(null);
  const latestRef = useRef<any>();
  latestRef.current = {
    location,
    scope,
    external,
    isUnlocked,
    isLoading,
    connectionUnavailable,
  };

  const markReady = useCallback(() => {
    settledRef.current = true;
    readyRef.current = true;
    if (mountedRef.current) setReady(true);
  }, []);

  const restoreState = useCallback(async () => {
    const start = latestRef.current;
    if (
      !start.external &&
      start.isUnlocked &&
      (start.isLoading || start.connectionUnavailable) &&
      start.location.pathname === '/' &&
      !start.location.search &&
      !start.location.hash
    ) {
      // A popup can be offline before its first lookup starts. Once trusted
      // auth reconnects, a missing snapshot still needs the neutral Home default.
      needsNeutralFallbackRef.current = true;
    }
    if (
      settledRef.current ||
      pendingRef.current ||
      start.external ||
      start.isLoading ||
      start.connectionUnavailable ||
      !start.isUnlocked
    )
      return;

    // An explicit route is user intent. Restore only the neutral popup entry.
    if (
      !POPUP_ENTRY_ROUTES.has(start.location.pathname) ||
      start.location.search ||
      start.location.hash
    ) {
      markReady();
      return;
    }
    const generation = ++generationRef.current;
    pendingRef.current = {
      generation,
      key: start.location.key,
      scope: start.scope,
    };
    try {
      const saved = await loadNavigationState();
      const current = latestRef.current;
      if (
        !mountedRef.current ||
        generationRef.current !== generation ||
        current.location.key !== start.location.key ||
        current.scope !== start.scope ||
        JSON.stringify(getWalletNavigationScope()) !== start.scope ||
        current.external ||
        isExternalNavigation(
          current.location.pathname,
          current.location.search
        ) ||
        current.isLoading ||
        current.connectionUnavailable ||
        !current.isUnlocked
      )
        return;
      pendingRef.current = null;
      if (saved && isRestorableWalletRoute(saved.currentPath)) {
        const target = new URL(saved.currentPath, 'https://wallet.invalid');
        if (saved.tab) target.searchParams.set('tab', saved.tab);
        const path = target.pathname + target.search + target.hash;
        restoredTargetRef.current = { path, previousKey: start.location.key };
        navigate(path, {
          replace: true,
          state: {
            ...saved.state,
            returnContext: saved.returnContext,
            scrollPosition: saved.scrollPosition,
            scrollPositions: saved.scrollPositions,
            walletScope: saved.walletScope,
          },
        });
      } else if (
        needsNeutralFallbackRef.current &&
        current.location.pathname === '/' &&
        !current.location.search &&
        !current.location.hash
      ) {
        navigate('/home', { replace: true });
      }
      needsNeutralFallbackRef.current = false;
      markReady();
    } catch {
      if (mountedRef.current && generationRef.current === generation) {
        pendingRef.current = null;
        markReady();
      }
    }
  }, [markReady, navigate]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ++generationRef.current;
      pendingRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    if (
      pending &&
      (pending.key !== location.key ||
        pending.scope !== scope ||
        external ||
        isLoading ||
        connectionUnavailable ||
        !isUnlocked)
    ) {
      ++generationRef.current;
      pendingRef.current = null;
      const neutral =
        POPUP_ENTRY_ROUTES.has(location.pathname) &&
        !location.search &&
        !location.hash;
      if (pending.key === location.key && neutral && !external && isUnlocked) {
        settledRef.current = false;
        readyRef.current = false;
        needsNeutralFallbackRef.current = true;
        setReady(false);
      } else {
        markReady();
      }
    }
    if (!external && !isLoading && !connectionUnavailable && !isUnlocked) {
      ++generationRef.current;
      pendingRef.current = null;
      restoredTargetRef.current = null;
      needsNeutralFallbackRef.current = false;
      markReady();
      void clearNavigationState();
    }
  }, [
    location.key,
    location.pathname,
    location.search,
    location.hash,
    scope,
    external,
    isLoading,
    isUnlocked,
    connectionUnavailable,
    markReady,
  ]);

  useEffect(() => {
    void restoreState();
  }, [
    restoreState,
    external,
    isLoading,
    isUnlocked,
    connectionUnavailable,
    scope,
  ]);

  const saveCurrentState = useCallback(() => {
    const current = latestRef.current;
    if (
      !readyRef.current ||
      current.external ||
      isExternalNavigation(
        current.location.pathname,
        current.location.search
      ) ||
      current.isLoading ||
      current.connectionUnavailable ||
      !current.isUnlocked
    )
      return;
    const { pathname, search, hash, state } = current.location;
    const path = pathname + search + hash;
    const restored = restoredTargetRef.current;
    // Do not overwrite the saved leaf while its route is still committing.
    if (restored && current.location.key === restored.previousKey) return;
    if (!isRestorableWalletRoute(path)) {
      void clearNavigationState();
      return;
    }
    // Send forms own their live values. Their location.state is an old snapshot.
    if (SEND_DRAFT_ROUTES.has(pathname)) return;
    const tab = new URLSearchParams(search).get('tab') || state?.tab;
    void saveNavigationState(path, tab, state, state?.returnContext);
  }, []);

  useEffect(() => {
    if (!ready || external || isLoading || connectionUnavailable || !isUnlocked)
      return;
    const restored = restoredTargetRef.current;
    if (restored && location.key !== restored.previousKey) {
      restoredTargetRef.current = null;
      // AppLayout restores scroll as lazy content grows from the route metadata.
      // Preserve the loaded snapshot until its first real interaction or scroll.
      if (location.pathname + location.search + location.hash === restored.path)
        return;
    }
    saveCurrentState();
  }, [
    ready,
    location,
    scope,
    external,
    isLoading,
    isUnlocked,
    connectionUnavailable,
    saveCurrentState,
  ]);

  useEffect(() => {
    let scrollSave: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (scrollSave !== undefined) clearTimeout(scrollSave);
      scrollSave = undefined;
      saveCurrentState();
    };
    const onScroll = () => {
      if (scrollSave === undefined) {
        scrollSave = setTimeout(flush, SCROLL_SAVE_THROTTLE_MS);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    // Capture sees scrolling inside the popup and independently scrolling lists.
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (scrollSave !== undefined) clearTimeout(scrollSave);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [saveCurrentState]);

  return { restoreState };
};
