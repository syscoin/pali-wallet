import { useCallback, useEffect, useRef } from 'react';

import { getControllerStatus } from 'hooks/controllerStatus';
import {
  captureNavigationScroll,
  getWalletNavigationScope,
  saveNavigationState,
  sanitizeBrowsingState,
} from 'utils/navigationState';

interface ISendDraftWriter {
  enabled: boolean;
  form: { getFieldsValue: () => Record<string, any> };
  location: { hash?: string; pathname: string; search?: string; state?: any };
  navigate: (path: string, options?: any) => void;
  scopeKey: string;
  state: Record<string, any>;
}

export const getScopedSendDraft = (
  path: string,
  state: any,
  scopeKey: string
) => {
  const scope = JSON.parse(scopeKey);
  return state?.walletScope?.account === scope.account &&
    state?.walletScope?.network === scope.network
    ? sanitizeBrowsingState(path, state)
    : {};
};

/** Async form preparation must remain in the document, wallet and route that started it. */
export const useSendPreparationGuard = (scopeKey: string, pathname: string) => {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    (requireTrustedAuth = true) => {
      const status = getControllerStatus();
      const browserRoute = window.location.hash.startsWith('#/')
        ? window.location.hash.slice(1).split(/[?#]/)[0]
        : undefined;
      return (
        mounted.current &&
        (!requireTrustedAuth ||
          (status.isUnlocked &&
            !status.isLoading &&
            !status.connectionUnavailable)) &&
        scopeKey === JSON.stringify(getWalletNavigationScope()) &&
        (!browserRoute || browserRoute === pathname)
      );
    },
    [scopeKey, pathname]
  );
};

/** Send forms own their live draft. A departed or locked form must never write it back. */
export const useSendDraftWriter = (options: ISendDraftWriter) => {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(true);

  const save = useCallback(
    async (formValues?: Record<string, any>, mirror = true) => {
      const current = latest.current;
      const status = getControllerStatus();
      if (
        !mounted.current ||
        !current.enabled ||
        !status.isUnlocked ||
        status.isLoading ||
        status.connectionUnavailable ||
        current.scopeKey !== JSON.stringify(getWalletNavigationScope())
      )
        return;

      // HashRouter can change the browser URL before the departed form unmounts.
      const browserRoute = window.location.hash.startsWith('#/')
        ? window.location.hash.slice(1).split(/[?#]/)[0]
        : undefined;
      if (browserRoute && browserRoute !== current.location.pathname) return;

      const {
        pathname,
        search = '',
        hash = '',
        state: routeState,
      } = current.location;
      const path = pathname + search + hash;
      const values = formValues || current.form.getFieldsValue();
      const state = sanitizeBrowsingState(path, {
        ...current.state,
        formValues: values,
        ...(current.state.selectedAsset?.isNft &&
        typeof values.nftTokenId === 'string'
          ? { selectedNftTokenId: values.nftTokenId }
          : {}),
      });
      if (
        mirror &&
        JSON.stringify(state) !==
          JSON.stringify(sanitizeBrowsingState(path, routeState))
      ) {
        current.navigate(path, {
          replace: true,
          state: {
            ...state,
            returnContext: routeState?.returnContext,
            walletScope: getWalletNavigationScope(),
            scrollPosition: window.scrollY || 0,
            scrollPositions: captureNavigationScroll(),
          },
        });
      }
      await saveNavigationState(
        path,
        undefined,
        state,
        routeState?.returnContext
      );
    },
    []
  );

  useEffect(() => {
    mounted.current = true;
    const flush = () => {
      void save(undefined, false);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [save]);

  // Save the current page even for a blank draft. Values are never read from stale route state.
  useEffect(() => {
    void save();
  }, [save, options.enabled, options.state, options.location]);
  return save;
};
