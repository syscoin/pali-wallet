import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { RootState } from 'state/store';

const TWENTY_SECONDS = 20000;

export const Loading = ({
  usePopupSize = true,
}: {
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
      }, TWENTY_SECONDS);
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

  // Blue tinted background for skeleton instead of gray
  const CustomSkeleton = ({
    width = '100%',
    height = '20px',
    className = '',
  }: {
    className?: string;
    height?: string;
    width?: string;
  }) => (
    <div
      className={`animate-pulse ${className}`}
      style={{
        backgroundColor: 'rgba(59, 130, 246, 0.15)', // More blue tint
        borderRadius: '4px',
        width,
        height,
      }}
    ></div>
  );

  // Rounded avatar component
  const CircleSkeleton = ({
    size = '24px',
    className = '',
  }: {
    className?: string;
    size?: string;
  }) => (
    <div
      className={`animate-pulse rounded-full ${className}`}
      style={{
        backgroundColor: 'rgba(59, 130, 246, 0.15)', // Blue tint
        width: size,
        height: size,
      }}
    ></div>
  );

  return (
    <div
      className={`${usePopupSize && 'min-w-popup min-h-popup'} w-full h-full`}
    >
      {timeoutError ? (
        <div className="flex flex-col items-center justify-center text-center h-full">
          <Icon name="WarningIcon" className="text-red-500 mb-4" />
          <p className="text-brand-white">Network connection timed out</p>
        </div>
      ) : (
        <div className="flex flex-col w-full h-full">
          {/* Header section */}
          <div className="p-4 border-b border-blue-900">
            <div className="flex items-center justify-between mb-3">
              <CustomSkeleton width="150px" height="24px" />
              <div className="flex">
                <CircleSkeleton size="24px" className="mr-4" />
                <div
                  className="animate-pulse rounded"
                  style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    width: '24px',
                    height: '24px',
                  }}
                ></div>
              </div>
            </div>

            <div className="flex items-center">
              <CircleSkeleton size="40px" className="mr-3" />
              <div className="flex flex-col">
                <CustomSkeleton width="100px" height="18px" className="mb-1" />
                <CustomSkeleton width="120px" height="14px" />
              </div>
            </div>
          </div>

          {/* Main balance area */}
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <CustomSkeleton width="200px" height="40px" className="mb-2" />
            <CustomSkeleton
              width="100px"
              height="20px"
              className="mb-10"
            />{' '}
            {/* More space before buttons */}
            {/* Send/Receive buttons positioned lower */}
            <div className="flex justify-center items-center w-full mt-8">
              {' '}
              {/* Increased margin top */}
              <CustomSkeleton
                width="30%"
                height="34px"
                className="mr-px rounded-l-full"
              />
              <CustomSkeleton
                width="30%"
                height="34px"
                className="rounded-r-full"
              />
            </div>
          </div>

          {/* Tabs section */}
          <div className="flex border-b border-blue-900 mt-4">
            <CustomSkeleton width="50%" height="40px" />
            <CustomSkeleton width="50%" height="40px" />
          </div>

          {/* Assets/Activity section - more realistic */}
          <div className="flex-1 p-4">
            {/* Asset item with token icon, name, balance */}
            <div className="flex items-center justify-between mb-6 p-2">
              <div className="flex items-center">
                <CircleSkeleton size="36px" className="mr-3" />
                <div className="flex flex-col">
                  <CustomSkeleton width="80px" height="16px" className="mb-1" />
                  <CustomSkeleton width="60px" height="14px" />
                </div>
              </div>
              <div className="flex flex-col items-end">
                <CustomSkeleton width="70px" height="16px" className="mb-1" />
                <CustomSkeleton width="50px" height="14px" />
              </div>
            </div>

            {/* Second asset item */}
            <div className="flex items-center justify-between mb-6 p-2">
              <div className="flex items-center">
                <CircleSkeleton size="36px" className="mr-3" />
                <div className="flex flex-col">
                  <CustomSkeleton width="90px" height="16px" className="mb-1" />
                  <CustomSkeleton width="70px" height="14px" />
                </div>
              </div>
              <div className="flex flex-col items-end">
                <CustomSkeleton width="80px" height="16px" className="mb-1" />
                <CustomSkeleton width="60px" height="14px" />
              </div>
            </div>

            {/* Third asset item */}
            <div className="flex items-center justify-between p-2">
              <div className="flex items-center">
                <CircleSkeleton size="36px" className="mr-3" />
                <div className="flex flex-col">
                  <CustomSkeleton width="85px" height="16px" className="mb-1" />
                  <CustomSkeleton width="65px" height="14px" />
                </div>
              </div>
              <div className="flex flex-col items-end">
                <CustomSkeleton width="75px" height="16px" className="mb-1" />
                <CustomSkeleton width="55px" height="14px" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
