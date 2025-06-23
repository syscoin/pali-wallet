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

  // Determine if we're loading
  const isNetworkChanging = networkStatus === 'switching';
  const isLoading =
    navigationLoading ||
    isNetworkChanging ||
    isSwitchingAccount ||
    additionalLoadingConditions.some((condition) => condition);

  // Handle network switching timeout
  useEffect(() => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (isNetworkChanging) {
      // Set 10-second timeout for network switching
      timeoutRef.current = setTimeout(() => {
        setHasTimedOut(true);
      }, TEN_SECONDS);
    } else {
      // Reset timeout state when not switching networks
      setHasTimedOut(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isNetworkChanging]);

  // Handle timeout redirect
  useEffect(() => {
    if (hasTimedOut) {
      // Clear the timeout immediately to prevent duplicate redirects
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      window.location.hash = '/chain-fail-to-connect';
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
