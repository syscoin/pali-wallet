import { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';

export const useController = () => {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // Use refs for intervals to maintain stable references
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lockedPollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Get hasEncryptedVault from global state to distinguish between locked and forgotten states
  const hasEncryptedVault = useSelector(
    (state: RootState) => state.vaultGlobal.hasEncryptedVault
  );

  // Check if this is the hardware wallet page that handles its own authentication
  const isExternalPage = location.pathname.includes('external');

  // Use refs to store latest values without causing re-renders
  const latestValuesRef = useRef({
    isUnlocked,
    isLoading,
    hasEncryptedVault,
    isExternalPage,
  });

  // Update the ref whenever values change
  useEffect(() => {
    latestValuesRef.current = {
      isUnlocked,
      isLoading,
      hasEncryptedVault,
      isExternalPage,
    };
  }, [isUnlocked, isLoading, hasEncryptedVault, isExternalPage]);

  // Function to check unlock status - stable reference
  const checkUnlockStatus = useCallback(async () => {
    try {
      const unlocked = await controllerEmitter(['wallet', 'isUnlocked'], []);
      const wasUnlocked = latestValuesRef.current.isUnlocked;
      const nowUnlocked = !!unlocked;

      setIsUnlocked(nowUnlocked);

      // Use latest values from ref
      const {
        isLoading: currentIsLoading,
        hasEncryptedVault: currentHasEncryptedVault,
        isExternalPage: currentIsExternalPage,
      } = latestValuesRef.current;

      // If wallet was unlocked but now locked, redirect to unlock screen
      // BUT only if there's still an encrypted vault (not forgotten) AND not on hardware wallet page
      if (
        wasUnlocked &&
        !nowUnlocked &&
        !currentIsLoading &&
        currentHasEncryptedVault &&
        !currentIsExternalPage
      ) {
        console.log(
          '[useController] Wallet became locked, redirecting to unlock screen'
        );
        navigate('/', { replace: true });
      }

      // Special log for hardware wallet page
      if (
        wasUnlocked &&
        !nowUnlocked &&
        !currentIsLoading &&
        currentHasEncryptedVault &&
        currentIsExternalPage
      ) {
        console.log(
          '[useController] Wallet became locked on hardware wallet page, staying on page'
        );
      }

      // If there's no encrypted vault, don't force redirect - let routing logic handle it
      if (
        wasUnlocked &&
        !nowUnlocked &&
        !currentIsLoading &&
        !currentHasEncryptedVault
      ) {
        console.log(
          '[useController] Wallet was forgotten, allowing routing logic to handle navigation'
        );
      }

      return nowUnlocked;
    } catch (error: any) {
      // Don't spam console with connection errors during service worker lifecycle
      if (
        !error.message?.includes('Could not establish connection') &&
        !error.message?.includes('Receiving end does not exist') &&
        !error.message?.includes('Network request timed out')
      ) {
        console.error('[useController] Error checking unlock status:', error);
      }
      // If we can't check status due to service worker issues, maintain current state
      // This prevents flickering during service worker restarts
      return latestValuesRef.current.isUnlocked;
    }
  }, [navigate]); // Only depends on navigate which is stable

  // Reset auto-lock timer on user activity
  const resetAutoLockTimer = async () => {
    try {
      await controllerEmitter(['wallet', 'resetAutoLockTimer'], []);
    } catch (error: any) {
      // Don't spam console with connection errors during service worker lifecycle
      if (
        !error.message?.includes('Could not establish connection') &&
        !error.message?.includes('Receiving end does not exist') &&
        !error.message?.includes('Network request timed out')
      ) {
        console.error(
          '[useController] Error resetting auto-lock timer:',
          error
        );
      }
      // Silently ignore service worker connection errors - timer will be reset on next successful call
    }
  };

  // Handle lock state change messages from background - stable reference
  const handleLockStateMessage = useCallback(
    (message: any) => {
      if (message.type === 'CONTROLLER_STATE_CHANGE') {
        // State changes are handled by Redux, but we might have missed a lock event
        // Double-check unlock status to be safe
        checkUnlockStatus();
      } else if (message.type === 'logout') {
        // Explicit logout message - only redirect if there's still an encrypted vault AND not on hardware wallet page
        console.log('[useController] Logout message received');
        setIsUnlocked(false);

        // Use latest values from ref
        const {
          hasEncryptedVault: currentHasEncryptedVault,
          isExternalPage: currentIsExternalPage,
        } = latestValuesRef.current;

        if (currentHasEncryptedVault && !currentIsExternalPage) {
          console.log(
            '[useController] Redirecting to unlock screen after logout'
          );
          navigate('/', { replace: true });
        } else if (currentHasEncryptedVault && currentIsExternalPage) {
          console.log(
            '[useController] Logout on hardware wallet page, staying on page'
          );
        } else {
          console.log(
            '[useController] No encrypted vault, letting routing logic handle navigation'
          );
        }
      } else if (message.type === 'wallet_forgotten') {
        // Wallet was explicitly forgotten - don't redirect, let routing logic handle it
        console.log(
          '[useController] Wallet forgotten message received, letting routing logic handle navigation'
        );
        setIsUnlocked(false);
      }
    },
    [checkUnlockStatus, navigate]
  ); // Only depends on stable references

  // Set up message listener - this should only run once
  useEffect(() => {
    const messageListener = (message: any) => {
      handleLockStateMessage(message);
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [handleLockStateMessage]);

  // Initial unlock status check
  useEffect(() => {
    checkUnlockStatus().then(() => {
      setIsLoading(false);
    });
  }, []); // Run only once on mount

  // Set up polling - separate effect to manage lifecycle properly
  useEffect(() => {
    // Don't start polling until initial load is complete
    if (isLoading) return;

    const startPolling = () => {
      // Clear any existing intervals
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (lockedPollIntervalRef.current) {
        clearInterval(lockedPollIntervalRef.current);
        lockedPollIntervalRef.current = null;
      }

      pollIntervalRef.current = setInterval(async () => {
        try {
          const currentlyUnlocked = await checkUnlockStatus();

          // If we're locked, check more frequently to detect unlock quickly
          if (!currentlyUnlocked) {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }

            // Start faster polling when locked (every 2 seconds)
            lockedPollIntervalRef.current = setInterval(async () => {
              try {
                const stillLocked = !(await checkUnlockStatus());
                if (!stillLocked) {
                  // When unlocked, switch back to normal polling
                  if (lockedPollIntervalRef.current) {
                    clearInterval(lockedPollIntervalRef.current);
                    lockedPollIntervalRef.current = null;
                  }
                  startPolling();
                }
              } catch (error: any) {
                // Ignore connection errors during locked polling
              }
            }, 2000);
          }
        } catch (error: any) {
          // Only log non-connection errors
          if (
            !error.message?.includes('Could not establish connection') &&
            !error.message?.includes('Receiving end does not exist') &&
            !error.message?.includes('Network request timed out') &&
            !error.message?.includes('Failed to connect to service worker')
          ) {
            console.error('[useController] Polling error:', error);
          }
        }
      }, 10000); // 10 seconds for normal polling
    };

    startPolling();

    // Cleanup
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (lockedPollIntervalRef.current) {
        clearInterval(lockedPollIntervalRef.current);
        lockedPollIntervalRef.current = null;
      }
    };
  }, [isLoading, checkUnlockStatus]); // checkUnlockStatus is now stable

  // Reset auto-lock timer on route changes (user navigation activity)
  useEffect(() => {
    // Reset auto-lock timer whenever user navigates to a new route
    resetAutoLockTimer();
  }, [location.pathname, location.search, location.hash]);

  // Handle wallet locked errors and redirect to unlock screen
  const handleWalletLockedError = (error: any): boolean => {
    const errorMessage = error?.message || String(error);

    const walletLockedPatterns = [
      /Target keyring.*locked/i,
      /Wallet must be unlocked/i,
      /Wallet is locked/i,
      /Please unlock the wallet first/i,
      /No unlocked keyring found/i,
    ];

    const isWalletLockedError = walletLockedPatterns.some((pattern) =>
      pattern.test(errorMessage)
    );

    if (isWalletLockedError && hasEncryptedVault && !isExternalPage) {
      console.log(
        '[useController] Wallet locked error detected, redirecting to unlock screen'
      );
      navigate('/', { replace: true });
      return true; // Error was handled
    }

    if (isWalletLockedError && hasEncryptedVault && isExternalPage) {
      console.log(
        '[useController] Wallet locked error on hardware wallet page, staying on page'
      );
      return true; // Error was handled (by staying on page)
    }

    return false; // Error was not handled
  };

  return {
    controllerEmitter,
    isUnlocked,
    isLoading,
    handleWalletLockedError,
    resetAutoLockTimer,
  };
};
