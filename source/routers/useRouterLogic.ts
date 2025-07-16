import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { rehydrateStore } from 'state/rehydrate';
import store, { RootState } from 'state/store';
import { SYSCOIN_UTXO_MAINNET_NETWORK } from 'utils/constants';

export const useRouterLogic = () => {
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setmodalMessage] = useState('');
  const [showUtf8ErrorModal, setShowUtf8ErrorModal] = useState(false);
  const [initialCheckComplete, setInitialCheckComplete] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(window.innerWidth > 600);
  const navigationLockRef = useRef(false);
  const lastNavigationRef = useRef<string>('');
  const navigationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { navigate } = useUtils();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { networkStatus } = useSelector(
    (state: RootState) => state.vaultGlobal
  );
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { isUnlocked, isLoading, controllerEmitter } = useController();
  const [providerStatus, setProviderStatus] = useState<{
    errorMessage: string | { code?: number; message?: string } | any;
    serverHasAnError: boolean;
  }>({
    serverHasAnError: false,
    errorMessage: '',
  });

  const { serverHasAnError, errorMessage } = providerStatus;

  const isNetworkChanging = networkStatus === 'switching';

  const utf8ErrorData = JSON.parse(
    window.localStorage.getItem('sysweb3-utf8Error') ??
      JSON.stringify({ hasUtf8Error: false })
  );

  const hasUtf8Error = utf8ErrorData?.hasUtf8Error ?? false;

  useEffect(() => {
    // Don't run provider status check during initial loading or network changes
    if (isLoading || isNetworkChanging) {
      return;
    }

    if (!isBitcoinBased) {
      controllerEmitter(['wallet', 'getProviderStatus'], [])
        .then((status: any) => {
          setProviderStatus({
            serverHasAnError: status.serverHasAnError || false,
            errorMessage: status.errorMessage || '',
          });
        })
        .catch(() => {
          setProviderStatus({ serverHasAnError: false, errorMessage: '' });
        });
    }
  }, [controllerEmitter, isBitcoinBased, isLoading, isNetworkChanging]);

  // Debounced navigation function to prevent rapid navigation
  const debouncedNavigate = useCallback(
    (targetRoute: string) => {
      // Clear any existing timeout
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }

      // Skip if we just navigated to this route
      if (lastNavigationRef.current === targetRoute) {
        return;
      }

      // Set a small delay to debounce navigation
      navigationTimeoutRef.current = setTimeout(() => {
        // Use current pathname from location instead of dependency
        const currentPathname = window.location.hash.slice(1) || '/';

        if (currentPathname !== targetRoute && !navigationLockRef.current) {
          navigationLockRef.current = true;
          lastNavigationRef.current = targetRoute;

          navigate(targetRoute);

          // Release lock after navigation is complete
          setTimeout(() => {
            navigationLockRef.current = false;
          }, 200);
        }
      }, 50);
    },
    [navigate] // Remove pathname dependency to prevent recreation
  );

  // Handle window resize events to properly track fullscreen state
  useEffect(() => {
    const handleResize = () => {
      // Clear existing resize timeout
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      // Debounce the resize handling to prevent rapid state changes
      resizeTimeoutRef.current = setTimeout(() => {
        const newIsFullscreen = window.innerWidth > 600;
        setIsFullscreen(newIsFullscreen);
      }, 300); // Longer delay for resize to prevent aggressive navigation
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      // Clean up timeouts
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isRehydrating = false;

    function handleStateChange(message: any) {
      if (message.type === 'CONTROLLER_STATE_CHANGE' && message.data) {
        // Prevent rehydration loops by checking if we're already rehydrating
        if (isRehydrating) {
          console.warn(
            '[useRouterLogic] Skipping rehydration - already in progress'
          );
          return true;
        }

        isRehydrating = true;
        rehydrateStore(store, message.data).finally(() => {
          isRehydrating = false;
        });
        return true;
      }
      return false;
    }

    chrome.runtime.onMessage.addListener(handleStateChange);

    return () => {
      chrome.runtime.onMessage.removeListener(handleStateChange);
    };
  }, []);

  useEffect(() => {
    if (isUnlocked) {
      setShowUtf8ErrorModal(hasUtf8Error);
    }
  }, [hasUtf8Error, isUnlocked]);

  // CONSOLIDATED NAVIGATION LOGIC - Single source of truth for all navigation
  useEffect(() => {
    // Prevent navigation loops with a lock mechanism
    if (navigationLockRef.current) {
      return;
    }

    // Don't navigate while loading or if network is changing
    if (isLoading || isNetworkChanging) {
      return;
    }

    const canProceed = isUnlocked && accounts;
    const isOnExternalRoute = pathname.includes('external');

    // IMPORTANT: Skip automatic navigation for external routes
    // External routes should handle their own navigation logic
    if (isOnExternalRoute) {
      console.log('[useRouterLogic] Skipping navigation - on external route');
      setInitialCheckComplete(true);
      return;
    }

    // Handle initial navigation after unlock
    if (canProceed && !initialCheckComplete) {
      // Check if we're in external context and preserve the route
      const urlParams = new URLSearchParams(window.location.search);
      const externalRoute = urlParams.get('route');

      if (isOnExternalRoute && externalRoute) {
        // Preserve external route after login
        debouncedNavigate(`/external/${externalRoute}`);
      } else {
        // Navigate to home page for main app
        debouncedNavigate('/home');
      }
      setInitialCheckComplete(true);
      return;
    }

    // Handle app route check for locked state
    // BUT ONLY for non-external routes - external routes handle their own auth
    if (!canProceed && !initialCheckComplete) {
      if (isOnExternalRoute) {
        // External routes handle their own auth - just mark as complete
        setInitialCheckComplete(true);
      } else {
        // Regular app route navigation for locked state
        controllerEmitter(['appRoute']).then((route) => {
          if (route !== '/' && typeof route === 'string') {
            debouncedNavigate(route);
          }
          setInitialCheckComplete(true);
        });
      }
    }
  }, [
    isUnlocked,
    isLoading,
    initialCheckComplete,
    // Remove 'accounts' from dependencies to prevent re-renders during rehydration
    // The canProceed check will still work correctly
    pathname,
    isFullscreen,
    isNetworkChanging,
    debouncedNavigate,
    controllerEmitter, // Add this since it's used in the effect
  ]);

  // Removed unused development-only useEffect that was calling non-existent functions

  useEffect(() => {
    if (
      serverHasAnError &&
      isUnlocked &&
      !isBitcoinBased &&
      !isNetworkChanging
    ) {
      if (typeof errorMessage !== 'string' && errorMessage?.code === -32016) {
        setmodalMessage(
          'The current RPC provider has a low rate-limit. We are applying a cooldown that will affect Pali performance. Modify the RPC URL in the network settings to resolve this issue.'
        );
      } else {
        setmodalMessage(
          'The RPC provider from network has an error. Pali performance may be affected. Modify the RPC URL in the network settings to resolve this issue.'
        );
      }
      setShowModal(true);
    }
  }, [serverHasAnError]);

  const handleUtf8ErrorClose = async () => {
    setShowUtf8ErrorModal(false);
    if (activeNetwork.chainId !== SYSCOIN_UTXO_MAINNET_NETWORK.chainId) {
      await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        [SYSCOIN_UTXO_MAINNET_NETWORK]
      );
    }

    await controllerEmitter(['wallet', 'lock']);
    navigate('/');
  };

  const warningMessage = `Provider Error: ${
    typeof errorMessage === 'string' || typeof errorMessage === 'undefined'
      ? errorMessage
      : errorMessage?.message || 'Unknown error'
  }`;

  return {
    showModal,
    setShowModal,
    modalMessage,
    showUtf8ErrorModal,
    setShowUtf8ErrorModal,
    t,
    activeNetwork,
    handleUtf8ErrorClose,
    warningMessage,
    navigate,
  };
};
