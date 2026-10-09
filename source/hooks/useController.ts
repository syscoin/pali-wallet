import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';

import {
  getControllerStatus,
  resetControllerAutoLock,
  resetControllerAutoLockForRoute,
  subscribeControllerStatus,
} from './controllerStatus';

export const useController = () => {
  const { isUnlocked, isLoading, connectionUnavailable } = useSyncExternalStore(
    subscribeControllerStatus,
    getControllerStatus,
    getControllerStatus
  );
  const navigate = useNavigate();
  const location = useLocation();

  // Get hasEncryptedVault from global state to distinguish between locked and forgotten states
  const hasEncryptedVault = useSelector(
    (state: RootState) => state.vaultGlobal.hasEncryptedVault
  );

  // Check if this is the hardware wallet page that handles its own authentication
  const isExternalPage = location.pathname.includes('external');

  const wasUnlocked = useRef(isUnlocked);

  useEffect(() => {
    if (
      wasUnlocked.current &&
      !isUnlocked &&
      !isLoading &&
      hasEncryptedVault &&
      !isExternalPage
    ) {
      navigate('/', { replace: true });
    }
    wasUnlocked.current = isUnlocked;
  }, [isUnlocked, isLoading, hasEncryptedVault, isExternalPage, navigate]);

  useEffect(() => {
    resetControllerAutoLockForRoute(
      `${location.pathname}${location.search}${location.hash}`
    );
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
    connectionUnavailable,
    isUnlocked,
    isLoading,
    handleWalletLockedError,
    resetAutoLockTimer: resetControllerAutoLock,
  };
};
