import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { getControllerStatus } from 'hooks/controllerStatus';
import {
  captureNavigationScroll,
  getSendDraftId,
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
  const [draftId] = useState(() => uuidv4());
  const priorDraftId = useRef(
    getSendDraftId(options.location.state?.sendDraftId)
  );
  const hasSaved = useRef(false);
  const claimOnSave = useRef(false);
  const pendingClaim = useRef<symbol>();
  const queuedMirror = useRef<boolean>();

  const save = useCallback(
    async function saveDraft(
      formValues?: Record<string, any>,
      {
        automatic = false,
        mirror = true,
        stateOverrides,
      }: {
        automatic?: boolean;
        mirror?: boolean;
        stateOverrides?: Record<string, any>;
      } = {}
    ) {
      if (automatic && pendingClaim.current && !claimOnSave.current) {
        queuedMirror.current = mirror;
        return;
      }
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
        ...stateOverrides,
        sendDraftId: draftId,
        formValues: values,
        ...(current.state.selectedAsset?.isNft &&
        typeof values.nftTokenId === 'string'
          ? { selectedNftTokenId: values.nftTokenId }
          : {}),
      });
      const prior = priorDraftId.current;
      const guard =
        automatic && !claimOnSave.current && (hasSaved.current || prior)
          ? {
              draftIds: prior ? [draftId, prior] : [draftId],
              requireOwnedDraft: true,
            }
          : undefined;
      claimOnSave.current = false;
      const claim = guard ? undefined : Symbol();
      // A queued automatic write must not supersede a deliberate edit waiting
      // for the shared storage lock.
      if (claim) pendingClaim.current = claim;
      hasSaved.current = true;
      try {
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
        const saved = guard
          ? await saveNavigationState(
              path,
              undefined,
              state,
              routeState?.returnContext,
              undefined,
              guard
            )
          : await saveNavigationState(
              path,
              undefined,
              state,
              routeState?.returnContext
            );
        if (saved) priorDraftId.current = undefined;
      } finally {
        if (claim && pendingClaim.current === claim) {
          pendingClaim.current = undefined;
          const nextMirror = queuedMirror.current;
          queuedMirror.current = undefined;
          if (nextMirror !== undefined)
            await saveDraft(undefined, { mirror: nextMirror, automatic: true });
        }
      }
    },
    [draftId]
  );

  useEffect(() => {
    mounted.current = true;
    const flush = () => {
      void save(undefined, { mirror: false, automatic: true });
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
    void save(undefined, { automatic: true });
  }, [save, options.enabled, options.state, options.location]);
  const saveAutomatically = useCallback(
    (values?: Record<string, any>) => save(values, { automatic: true }),
    [save]
  );
  const claimDraft = useCallback(() => {
    claimOnSave.current = true;
  }, []);
  return { claimDraft, draftId, save, saveAutomatically };
};
