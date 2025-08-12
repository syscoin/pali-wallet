import { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';

import { RootState } from 'state/store';

interface IPageLoadingState {
  hasTimedOut?: boolean;
  isLoading: boolean;
  message?: string;
}

const TEN_SECONDS = 10000;

export const usePageLoadingState = (
  additionalLoadingConditions: boolean[] = []
): IPageLoadingState => {
  const location = useLocation();
  const navigate = useNavigate();
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [hasTimedOut, setHasTimedOut] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const networkStatus = useSelector(
    (state: RootState) => state.vaultGlobal.networkStatus
  );
  const isSwitchingAccount = useSelector(
    (state: RootState) => state.vaultGlobal.isSwitchingAccount
  );
  const networkTarget = useSelector(
    (state: RootState) => state.vaultGlobal.networkTarget
  );
  const { isLoadingBalances } = useSelector(
    (state: RootState) => state.vaultGlobal.loadingStates
  );
  const isPollingUpdate = useSelector(
    (state: RootState) => state.vaultGlobal.isPollingUpdate
  );

  // Only apply timeout logic on pages where users expect quick loading
  const timeoutEnabledPages = ['/home'];

  // Never show loading overlay on these pages - they handle their own loading states
  const loadingExcludedPages = [
    '/chain-fail-to-connect',
    '/settings/networks/custom-rpc',
  ];

  const shouldEnableTimeout = timeoutEnabledPages.some(
    (page) =>
      location.pathname === page || location.pathname.startsWith(`${page}/`)
  );

  const isOnExcludedPage = loadingExcludedPages.some(
    (page) => location.pathname === page
  );

  // Determine if we're loading
  const isNetworkChanging = networkStatus === 'switching';
  const isConnecting = networkStatus === 'connecting';
  // Consider balance loading (non-polling) as a network operation that should timeout
  const isNonPollingBalanceLoad = isLoadingBalances && !isPollingUpdate;

  const isLoading =
    navigationLoading ||
    isNetworkChanging ||
    isConnecting ||
    isSwitchingAccount ||
    isNonPollingBalanceLoad ||
    additionalLoadingConditions.some((condition) => condition);

  // Handle network operation timeout (switching or non-polling balance load)
  useEffect(() => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Only set timeout if we're on a page where timeouts are enabled
    if (!shouldEnableTimeout) {
      setHasTimedOut(false);
      return;
    }

    // Timeout for network switching OR non-polling balance/transaction loads (like after unlock/retry) OR connecting
    if (isNetworkChanging || isNonPollingBalanceLoad || isConnecting) {
      // Set 10-second timeout for network operations
      timeoutRef.current = setTimeout(() => {
        setHasTimedOut(true);
      }, TEN_SECONDS);
    } else {
      // Reset timeout state when not in a network operation
      setHasTimedOut(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [
    isNetworkChanging,
    isNonPollingBalanceLoad,
    isConnecting,
    shouldEnableTimeout,
  ]);

  // Reset hasTimedOut when network status becomes idle
  useEffect(() => {
    if (networkStatus === 'idle') {
      setHasTimedOut(false);
    }
  }, [networkStatus]);

  // Handle timeout redirect
  useEffect(() => {
    if (hasTimedOut) {
      // Don't redirect if we're already on the error page
      if (location.pathname === '/chain-fail-to-connect') {
        return;
      }

      // Clear the timeout immediately to prevent duplicate redirects
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Small delay to ensure state is stable before redirecting
      const redirectTimer = setTimeout(() => {
        navigate('/chain-fail-to-connect');
      }, 100);

      return () => clearTimeout(redirectTimer);
    }
  }, [hasTimedOut, navigate, location.pathname]);

  // Track navigation changes
  useEffect(() => {
    setNavigationLoading(true);

    const navigationTimer = setTimeout(() => {
      setNavigationLoading(false);
    }, 100); // Give time for component to mount

    return () => clearTimeout(navigationTimer);
  }, [location.pathname]);

  // Determine message based on current state
  let message: string | undefined;
  if (isNetworkChanging && networkTarget) {
    message = `Connecting to ${networkTarget.label}...`;
  } else if (isConnecting || isNonPollingBalanceLoad) {
    message = 'Connecting to network...';
  } else if (isSwitchingAccount) {
    message = 'Switching account...';
  } else if (navigationLoading) {
    message = 'Loading...';
  }

  return {
    isLoading: isOnExcludedPage ? false : isLoading,
    message,
    hasTimedOut,
  };
};
