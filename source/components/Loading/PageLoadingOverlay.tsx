import React, { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface IPageLoadingOverlayProps {
  hasBanner?: boolean;
  hasHeader?: boolean;
  isLoading: boolean;
  message?: string;
  nonBlocking?: boolean;
}

export const MAX_BLOCKING_LOADING_MS = 2000;

export const PageLoadingOverlay = memo(
  ({
    isLoading,
    hasHeader = true,
    hasBanner = false,
    message,
    nonBlocking = false,
  }: IPageLoadingOverlayProps) => {
    const { t } = useTranslation();
    const [showSpinner, setShowSpinner] = useState(false);
    const [showOverlay, setShowOverlay] = useState(false);
    const [isSlow, setIsSlow] = useState(false);

    useEffect(() => {
      setShowSpinner(false);
      setShowOverlay(false);
      setIsSlow(false);
      if (!isLoading) return;

      const spinnerTimer = setTimeout(() => setShowSpinner(true), 150);
      const overlayTimer = setTimeout(() => setShowOverlay(true), 500);
      const slowTimer = setTimeout(
        () => setIsSlow(true),
        MAX_BLOCKING_LOADING_MS
      );
      return () => {
        clearTimeout(spinnerTimer);
        clearTimeout(overlayTimer);
        clearTimeout(slowTimer);
      };
    }, [isLoading]);

    if (!isLoading || (!nonBlocking && !showSpinner && !showOverlay))
      return null;

    const status = message || t('buttons.loading');
    if (isSlow || nonBlocking) {
      // A slow RPC must not hold the whole wallet hostage or be mistaken for a
      // failed operation. The layout separately guards context-sensitive actions.
      return (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-3 left-3 right-3 z-[55] pointer-events-none flex items-center justify-center gap-2 rounded-lg bg-bkg-1/95 border border-brand-blue500/30 p-3 text-xs text-brand-white shadow-lg"
        >
          <span className="animate-spin rounded-full h-4 w-4 shrink-0 border-2 border-brand-blue500 border-t-transparent" />
          <span>
            {nonBlocking
              ? status
              : t('networkConnection.operationSlow', { operation: status })}
          </span>
        </div>
      );
    }

    return (
      <>
        {showOverlay && (
          <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px] transition-opacity duration-200" />
        )}
        {showSpinner && (
          <div
            role="status"
            aria-label={status}
            className="fixed z-[55] pointer-events-none"
            style={{
              top: hasHeader ? (hasBanner ? '148px' : '80px') : '0',
              left: '0',
              right: '0',
              bottom: '0',
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-blue500 drop-shadow-lg" />
            </div>
          </div>
        )}
      </>
    );
  }
);

PageLoadingOverlay.displayName = 'PageLoadingOverlay';
