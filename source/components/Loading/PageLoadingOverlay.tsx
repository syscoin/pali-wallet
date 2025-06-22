import React, { memo, useEffect, useState, useRef } from 'react';

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
        // Show spinner immediately for instant feedback (no overlay yet)
        spinnerTimerRef.current = setTimeout(() => {
          setShowSpinner(true);
        }, 150);

        // Show overlay if still loading (darkens screen)
        overlayTimerRef.current = setTimeout(() => {
          setShowOverlay(true);
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

    if (!showSpinner && !showOverlay) return null;

    // Calculate top position based on header and banner
    // Header is 52px, banner is 68px based on existing Loading components
    const topPosition = hasHeader ? (hasBanner ? '120px' : '52px') : '0';

    return (
      <>
        {/* Overlay - only shows after delay */}
        {showOverlay && (
          <div
            className="fixed z-50 bg-black/20 backdrop-blur-[1px] transition-opacity duration-200"
            style={{
              top: topPosition,
              left: '0',
              right: '0',
              bottom: '0',
              pointerEvents: 'auto', // Blocks all clicks
              opacity: showOverlay ? 1 : 0,
            }}
          />
        )}

        {/* Spinner - shows immediately, positioned in center of content area */}
        {showSpinner && (
          <div
            className="fixed z-[55] pointer-events-none"
            style={{
              top: topPosition,
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
