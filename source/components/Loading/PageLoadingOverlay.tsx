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

const spinnerClass = 'animate-spin rounded-full border-brand-royalbluemedium';

export const PageLoadingOverlay = memo(
  ({
    isLoading,
    hasHeader = true,
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
    const blockingOverlay = showOverlay && !isSlow && !nonBlocking && (
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px]" />
    );

    if (isSlow || nonBlocking || hasHeader) {
      // A slow RPC must not hold the whole wallet hostage or be mistaken for a
      // failed operation. The layout separately guards context-sensitive actions.
      // Ordinary wallet pages reserve the real translated height in page flow.
      // Headerless approval/hardware layouts retain their existing fixed status:
      // a viewport-covering child can otherwise paint over an in-flow sibling.
      const progress = (
        <div
          role="status"
          aria-live="polite"
          className={`${
            hasHeader
              ? 'relative z-[55] mx-3 my-3 shrink-0'
              : 'fixed bottom-3 left-3 right-3 z-[55]'
          } pointer-events-none flex items-center justify-center gap-2 rounded-lg bg-bkg-1/95 border border-brand-blue500/30 p-3 text-xs text-brand-white shadow-lg`}
        >
          <span
            className={`${spinnerClass} h-4 w-4 shrink-0 border-2 border-t-transparent`}
          />
          <span>
            {isSlow && !nonBlocking
              ? t('networkConnection.operationSlow', { operation: status })
              : status}
          </span>
        </div>
      );
      return blockingOverlay ? (
        <>
          {blockingOverlay}
          {progress}
        </>
      ) : (
        progress
      );
    }

    return (
      <>
        {blockingOverlay}
        {showSpinner && (
          <div
            role="status"
            aria-label={status}
            className="fixed inset-0 z-[55] pointer-events-none"
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-bkg-1 p-2">
                <div
                  className={`${spinnerClass} h-12 w-12 border-t-2 border-b-2 drop-shadow-lg`}
                />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
);

if (process.env.NODE_ENV !== 'production') {
  PageLoadingOverlay.displayName = 'PageLoadingOverlay';
}
