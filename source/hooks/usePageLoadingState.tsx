import { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { RootState } from 'state/store';

interface PageLoadingState {
  isLoading: boolean;
  message?: string;
}

export const usePageLoadingState = (
  additionalLoadingConditions: boolean[] = []
): PageLoadingState => {
  const location = useLocation();
  const [navigationLoading, setNavigationLoading] = useState(false);

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
  };
};
