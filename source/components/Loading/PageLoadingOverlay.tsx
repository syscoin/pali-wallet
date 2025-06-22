import React, { memo, useEffect, useState, useRef } from 'react';

import { LoadingSvg } from '../Icon/Icon';

interface PageLoadingOverlayProps {
  hasBanner?: boolean;
  hasHeader?: boolean;
  isLoading: boolean;
  message?: string;
}

export const PageLoadingOverlay = memo(
  ({
    isLoading,
    message,
    hasHeader = true,
    hasBanner = false,
  }: PageLoadingOverlayProps) => {
    const [showOverlay, setShowOverlay] = useState(false);
    const [showSpinner, setShowSpinner] = useState(false);
    const [showSlowWarning, setShowSlowWarning] = useState(false);
    const overlayTimerRef = useRef<NodeJS.Timeout | null>(null);
    const spinnerTimerRef = useRef<NodeJS.Timeout | null>(null);
    const warningTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
      // Clear existing timers
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
        spinnerTimerRef.current = null;
      }
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
        warningTimerRef.current = null;
      }

      if (isLoading) {
        // Show overlay after just 50ms - almost immediate but prevents flash
        overlayTimerRef.current = setTimeout(() => {
          setShowOverlay(true);
        }, 200);

        // Show spinner after 500ms
        spinnerTimerRef.current = setTimeout(() => {
          setShowSpinner(true);
        }, 500);

        // Show slow warning after 5 seconds
        warningTimerRef.current = setTimeout(() => {
          setShowSlowWarning(true);
        }, 5000);
      } else {
        // Reset states when loading is complete
        setShowOverlay(false);
        setShowSpinner(false);
        setShowSlowWarning(false);
      }

      return () => {
        if (overlayTimerRef.current) {
          clearTimeout(overlayTimerRef.current);
          overlayTimerRef.current = null;
        }
        if (spinnerTimerRef.current) {
          clearTimeout(spinnerTimerRef.current);
          spinnerTimerRef.current = null;
        }
        if (warningTimerRef.current) {
          clearTimeout(warningTimerRef.current);
          warningTimerRef.current = null;
        }
      };
    }, [isLoading]);

    if (!showOverlay) return null;

    // Calculate top position based on header and banner
    // Header is 52px, banner is 68px based on existing Loading components
    const topPosition = hasHeader ? (hasBanner ? '120px' : '52px') : '0';

    return (
      <div
        className="fixed z-50 bg-black/20 backdrop-blur-[1px] transition-opacity duration-200"
        style={{
          top: topPosition,
          left: '0',
          right: '0',
          bottom: '0',
          pointerEvents: 'auto', // Blocks all clicks
          opacity: isLoading ? 1 : 0,
        }}
      >
        {showSpinner && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <LoadingSvg
              className="text-brand-white animate-spin-slow drop-shadow-lg"
              style={{ width: '48px', height: '48px' }}
            />
            {message && (
              <p className="mt-4 text-brand-white text-sm font-light animate-pulse drop-shadow-lg">
                {message}
              </p>
            )}
            {showSlowWarning && (
              <p className="text-xs text-yellow-400 mt-2 animate-pulse drop-shadow-lg">
                This is taking longer than expected...
              </p>
            )}
          </div>
        )}
      </div>
    );
  }
);

PageLoadingOverlay.displayName = 'PageLoadingOverlay';
