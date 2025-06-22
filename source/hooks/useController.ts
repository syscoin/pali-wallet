import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';

export function useController() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  // Function to check unlock status
  const checkUnlockStatus = async () => {
    try {
      const unlocked = await controllerEmitter(['wallet', 'isUnlocked'], []);
      const wasUnlocked = isUnlocked;
      const nowUnlocked = !!unlocked;

      setIsUnlocked(nowUnlocked);

      // If wallet was unlocked but now locked, redirect to unlock screen
      if (wasUnlocked && !nowUnlocked && !isLoading) {
        console.log(
          '[useController] Wallet became locked, redirecting to unlock screen'
        );
        navigate('/', { replace: true });
      }

      return nowUnlocked;
    } catch (error) {
      console.error('[useController] Error checking unlock status:', error);
      // If we can't check status, assume locked for security
      setIsUnlocked(false);
      return false;
    }
  };

  // Reset auto-lock timer on user activity
  const resetAutoLockTimer = async () => {
    try {
      await controllerEmitter(['wallet', 'resetAutoLockTimer'], []);
    } catch (error) {
      console.error('[useController] Error resetting auto-lock timer:', error);
    }
  };

  // Handle lock state change messages from background
  const handleLockStateMessage = (message: any) => {
    if (message.type === 'CONTROLLER_STATE_CHANGE') {
      // State changes are handled by Redux, but we might have missed a lock event
      // Double-check unlock status to be safe
      checkUnlockStatus();
    } else if (message.type === 'logout') {
      // Explicit logout message - immediately redirect
      console.log('[useController] Logout message received, redirecting');
      setIsUnlocked(false);
      navigate('/', { replace: true });
    }
  };

  useEffect(() => {
    // Initial unlock status check
    checkUnlockStatus().then(() => {
      setIsLoading(false);
    });

    // Listen for Chrome runtime messages about state changes
    const messageListener = (message: any) => {
      handleLockStateMessage(message);
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Set up periodic polling as a fallback to catch missed lock events
    // Poll every 10 seconds when unlocked, more frequently when locked
    const startPolling = () => {
      const pollInterval = setInterval(async () => {
        try {
          const currentlyUnlocked = await checkUnlockStatus();

          // If we're locked, check more frequently to detect unlock quickly
          if (!currentlyUnlocked) {
            clearInterval(pollInterval);
            // Start faster polling when locked (every 2 seconds)
            const lockedPollInterval = setInterval(async () => {
              const stillLocked = !(await checkUnlockStatus());
              if (!stillLocked) {
                // When unlocked, switch back to normal polling
                clearInterval(lockedPollInterval);
                startPolling();
              }
            }, 2000);
          }
        } catch (error) {
          console.error('[useController] Polling error:', error);
        }
      }, 10000); // 10 seconds for normal polling

      return pollInterval;
    };

    const pollInterval = startPolling();

    // Add user activity listeners to reset auto-lock timer
    const activityEvents = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
    ];

    const handleUserActivity = () => {
      resetAutoLockTimer();
    };

    // Add activity listeners
    activityEvents.forEach((event) => {
      document.addEventListener(event, handleUserActivity, true);
    });

    // Cleanup
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      clearInterval(pollInterval);

      // Remove activity listeners
      activityEvents.forEach((event) => {
        document.removeEventListener(event, handleUserActivity, true);
      });
    };
  }, [navigate]);

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

    if (isWalletLockedError) {
      console.log(
        '[useController] Wallet locked error detected, redirecting to unlock screen'
      );
      navigate('/', { replace: true });
      return true; // Error was handled
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
}
