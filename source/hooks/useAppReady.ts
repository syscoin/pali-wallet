import { useEffect, useRef } from 'react';

// Global flag to ensure we only dispatch the event once
let hasDispatchedAppReady = false;

/**
 * Hook to signal that the app is ready and content is visible.
 * This should be called by the first visible route component to prevent
 * a blue flash between loader and content.
 *
 * @param isReady - Whether the component is ready to be displayed
 */
export const useAppReady = (isReady = true) => {
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    // Only dispatch once globally, once per component instance, and when ready
    if (!hasDispatchedAppReady && !hasTriggeredRef.current && isReady) {
      hasTriggeredRef.current = true;
      hasDispatchedAppReady = true;

      // Use requestAnimationFrame to ensure content has been painted
      requestAnimationFrame(() => {
        console.log(
          '[useAppReady] Content rendered, dispatching pali-app-ready event'
        );
        window.dispatchEvent(new CustomEvent('pali-app-ready'));
      });
    }
  }, [isReady]);
};
