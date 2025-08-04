import React, { memo, useEffect, useState, useRef } from 'react';

interface IPageLoadingOverlayProps {
  hasBanner?: boolean;
  hasHeader?: boolean;
  hasTimedOut?: boolean;
  isLoading: boolean;
}

export const PageLoadingOverlay = memo(
  ({
    isLoading,
    hasHeader = true,
    hasBanner = false,
    hasTimedOut = false,
  }: IPageLoadingOverlayProps) => {
    const [showOverlay, setShowOverlay] = useState(false);
    const [showSpinner, setShowSpinner] = useState(false);
    const overlayTimerRef = useRef<NodeJS.Timeout | null>(null);
    const spinnerTimerRef = useRef<NodeJS.Timeout | null>(null);

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

      if (isLoading) {
        // Show spinner immediately for instant feedback (no overlay yet)
        spinnerTimerRef.current = setTimeout(() => {
          setShowSpinner(true);
        }, 150);

        // Show overlay if still loading (darkens screen)
        overlayTimerRef.current = setTimeout(() => {
          setShowOverlay(true);
        }, 500);
      } else {
        // Reset states when loading is complete
        setShowOverlay(false);
        setShowSpinner(false);
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
      };
    }, [isLoading]);

    // If we've timed out (redirecting to error page), don't show spinner
    if (hasTimedOut) {
      return null;
    }

    if (!showSpinner && !showOverlay) return null;

    // Calculate content area positioning for spinner
    const spinnerTopPosition = hasHeader ? (hasBanner ? '148px' : '80px') : '0';

    return (
      <>
        {/* Overlay - covers entire screen, header appears on top due to higher z-index */}
        {showOverlay && (
          <div
            className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px] transition-opacity duration-200"
            style={{
              pointerEvents: 'auto', // Blocks all clicks
              opacity: showOverlay ? 1 : 0,
            }}
          />
        )}

        {/* Spinner - positioned in content area below header */}
        {showSpinner && (
          <div
            className="fixed z-[55] pointer-events-none"
            style={{
              top: spinnerTopPosition,
              left: '0',
              right: '0',
              bottom: '0',
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-blue500 drop-shadow-lg"></div>
            </div>
          </div>
        )}
      </>
    );
  }
);

PageLoadingOverlay.displayName = 'PageLoadingOverlay';
