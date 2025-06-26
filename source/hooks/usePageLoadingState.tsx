import { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

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
    additionalLoadingConditions.some((condition) => condition);

  // Handle network operation timeout (switching or non-polling balance load)
  useEffect(() => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Timeout for network switching OR non-polling balance loads (like after unlock/retry) OR connecting
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
  }, [isNetworkChanging, isNonPollingBalanceLoad, isConnecting]);

  // Handle timeout redirect
  useEffect(() => {
    if (hasTimedOut) {
      // Clear the timeout immediately to prevent duplicate redirects
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Small delay to ensure state is stable before redirecting
      const redirectTimer = setTimeout(() => {
        window.location.hash = '/chain-fail-to-connect';
      }, 100);

      return () => clearTimeout(redirectTimer);
    }
  }, [hasTimedOut]);

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
    isLoading,
    message,
    hasTimedOut,
  };
};
