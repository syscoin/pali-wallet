import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon } from '..';
import { RootState } from 'state/store';

const TEN_SECONDS = 10000;
const FIVE_SECONDS = 5000;

export const Loading = ({
  opacity = 60,
  usePopupSize = true,
}: {
  opacity?: number;
  usePopupSize?: boolean;
}) => {
  const { t } = useTranslation();
  const networkStatus = useSelector(
    (state: RootState) => state.vaultGlobal.networkStatus
  );
  const networkTarget = useSelector(
    (state: RootState) => state.vaultGlobal.networkTarget
  );

  const isNetworkChanging = networkStatus === 'switching';

  const [timeoutError, setTimeoutError] = useState(false);
  const [showSlowWarning, setShowSlowWarning] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const validateTimeoutError = () => {
    // Clear any existing timeouts
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = null;
    }

    if (isNetworkChanging) {
      // Show slow connection warning after 5 seconds
      warningTimeoutRef.current = setTimeout(() => {
        setShowSlowWarning(true);
      }, FIVE_SECONDS);

      // Show error page after 10 seconds
      timeoutRef.current = setTimeout(() => {
        setTimeoutError(true);
      }, TEN_SECONDS);
    }
  };

  useEffect(() => {
    validateTimeoutError();

    return () => {
      // Cleanup timeouts on unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = null;
      }
      setTimeoutError(false);
      setShowSlowWarning(false);
    };
  }, [isNetworkChanging]); // Add isNetworkChanging as dependency

  useEffect(() => {
    // If network status changed to idle/error, clear timeouts and reset states
    if (!isNetworkChanging) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = null;
      }
      setTimeoutError(false);
      setShowSlowWarning(false);
    }
  }, [isNetworkChanging]);

  useEffect(() => {
    if (timeoutError) {
      // Clear the timeout immediately to prevent duplicate redirects
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      window.location.hash = '/chain-fail-to-connect';
    }
  }, [timeoutError]);

  // If we've already redirected to error page, don't show spinner
  if (timeoutError) {
    return null;
  }

  return (
    <div
      className={`bg-bkg-1 z-[60] h-screen ${
        usePopupSize ? 'min-w-popup' : 'w-full'
      } top-0 left-0 absolute flex flex-col items-center justify-center bg-opacity-${opacity}`}
      key={networkTarget?.chainId || 'loading'}
    >
      <Icon
        name="Loader"
        size={40}
        wrapperClassname="animate-spin"
        color="#0B1426"
      />
      {isNetworkChanging && networkTarget && (
        <div className="text-center mt-2">
          <p className="text-sm text-white">
            {t('networkConnection.connecting')} {networkTarget.label}...
          </p>
          {showSlowWarning && (
            <p className="text-xs text-yellow-400 mt-1">
              {t('networkConnection.slowConnection')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
