import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
// Removed unused development-only imports
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

  // Check if this is a direct navigation (e.g., hardware wallet opened via button)
  const urlParams = new URLSearchParams(window.location.search);
  const isDirectNavigation = urlParams.get('direct') === 'true';

  useEffect(() => {
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
  }, [controllerEmitter, isBitcoinBased]);

  const { serverHasAnError, errorMessage } = providerStatus;

  const isNetworkChanging = networkStatus === 'switching';

  const utf8ErrorData = JSON.parse(
    window.localStorage.getItem('sysweb3-utf8Error') ??
      JSON.stringify({ hasUtf8Error: false })
  );

  const hasUtf8Error = utf8ErrorData?.hasUtf8Error ?? false;

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
        if (pathname !== targetRoute && !navigationLockRef.current) {
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
    [navigate, pathname]
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
    // Try to get current state from background script
    chrome.runtime.sendMessage({ type: 'getCurrentState' }, (response) => {
      // Handle potential errors gracefully
      if (chrome.runtime.lastError) {
        // Service worker might not be ready yet - that's ok
        console.log(
          '[useRouterLogic] Service worker not ready, will receive state via message'
        );
        return;
      }

      if (response?.data) {
        rehydrateStore(store, response.data);
      }
    });

    function handleStateChange(message: any) {
      if (message.type === 'CONTROLLER_STATE_CHANGE' && message.data) {
        rehydrateStore(store, message.data);
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
    const isOnHardwareWalletPage = pathname === '/settings/account/hardware';

    // Skip automatic navigation if this is a direct navigation to hardware wallet
    if (isDirectNavigation && isOnHardwareWalletPage) {
      setInitialCheckComplete(true);
      // Clear the direct parameter from URL to prevent issues on subsequent loads
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('direct');
      window.history.replaceState({}, '', newUrl.toString());
      return;
    }

    // Handle initial navigation after unlock
    if (canProceed && !initialCheckComplete) {
      // Determine target route based on screen size
      const targetRoute = isFullscreen ? '/settings/account/hardware' : '/home';

      debouncedNavigate(targetRoute);
      setInitialCheckComplete(true);
      return;
    }

    // IMPORTANT: Don't auto-navigate away from hardware wallet page
    // Hardware wallet operations should be focused and uninterrupted
    if (isOnHardwareWalletPage) {
      // If user is on hardware wallet page, let them stay there regardless of screen size
      // They can manually navigate away using browser controls if needed
      // Block ANY automatic navigation attempts including resize-based changes
      return;
    }

    // Handle navigation based on screen size changes (only after initial setup)
    // Only apply automatic navigation for non-hardware wallet pages
    if (canProceed && initialCheckComplete && !isOnHardwareWalletPage) {
      // Only navigate to hardware wallet if fullscreen AND not already there AND currently on home page
      if (isFullscreen && pathname === '/home') {
        debouncedNavigate('/settings/account/hardware');
      }
      return;
    }

    // Handle app route check for locked state
    if (!canProceed && !initialCheckComplete) {
      controllerEmitter(['appRoute']).then((route) => {
        if (route !== '/' && typeof route === 'string') {
          debouncedNavigate(route);
        }
        setInitialCheckComplete(true);
      });
    }
  }, [
    isUnlocked,
    isLoading,
    initialCheckComplete,
    accounts,
    pathname,
    isFullscreen,
    isNetworkChanging,
    debouncedNavigate,
    isDirectNavigation,
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

    controllerEmitter(['wallet', 'lock']);
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
