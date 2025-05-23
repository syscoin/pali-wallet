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
      window.location.hash = '/chain-fail-to-connect';
    }
  }, [timeoutError]);

  return (
    <>
      <div>
        <div>
          <div
            className={`${
              usePopupSize && 'min-w-popup min-h-popup'
            } relative z-20 flex flex-col items-center justify-center w-full bg-transparent`}
          >
            <div
              className={`flex items-center justify-center opacity-${opacity} ${
                timeoutError && 'mt-32'
              } `}
            >
              <Icon
                name="loading"
                className="text-brand-white animate-spin-slow"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
