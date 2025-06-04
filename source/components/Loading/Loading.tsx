import React, { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from '..';
import { RootState } from 'state/store';

const TEN_SECONDS = 10000;

export const Loading = ({
  opacity = 60,
  usePopupSize = true,
}: {
  opacity?: number;
  usePopupSize?: boolean;
}) => {
  const networkStatus = useSelector(
    (state: RootState) => state.vault.networkStatus
  );
  const networkTarget = useSelector(
    (state: RootState) => state.vault.networkTarget
  );

  const isNetworkChanging = networkStatus === 'switching';

  const [timeoutError, setTimeoutError] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const validateTimeoutError = () => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (isNetworkChanging) {
      timeoutRef.current = setTimeout(() => {
        setTimeoutError(true);
      }, TEN_SECONDS);
    }
  };

  useEffect(() => {
    validateTimeoutError();

    return () => {
      // Cleanup timeout on unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setTimeoutError(false);
    };
  }, [isNetworkChanging]); // Add isNetworkChanging as dependency

  useEffect(() => {
    // If network status changed to idle/error, clear timeout and reset error
    if (!isNetworkChanging) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setTimeoutError(false);
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
      className={`bg-bkg-1 z-50 h-screen ${
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
        <p className="text-sm text-white mt-2">
          Switching to {networkTarget.label}...
        </p>
      )}
    </div>
  );
};
