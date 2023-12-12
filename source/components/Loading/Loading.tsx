import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from '..';
import { RootState } from 'state/store';

const FIVE_SECONDS = 5000;

export const Loading = ({
  opacity = 60,
  usePopupSize = true,
}: {
  opacity?: number;
  usePopupSize?: boolean;
}) => {
  const isNetworkChanging = useSelector(
    (state: RootState) => state.vault.isNetworkChanging
  );

  const [timeoutError, setTimeoutError] = useState(false);

  const validateTimeoutError = () => {
    if (isNetworkChanging) {
      setTimeout(() => {
        setTimeoutError(true);
      }, FIVE_SECONDS);
    }
  };

  useEffect(() => {
    validateTimeoutError();
    return () => {
      setTimeoutError(false);
    };
  }, []);

  useEffect(() => {
    timeoutError
      ? (window.location.hash = '/chain-fail-to-connect')
      : setTimeoutError(false);
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
