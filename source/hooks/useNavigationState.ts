import { useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  loadNavigationState,
  clearNavigationState,
} from 'utils/navigationState';

import { useController } from './useController';

// Flag to track if we're currently restoring to avoid save/restore loops
let isRestoringNavigation = false;
// Flag to prevent saving during initial app load period
let isInitialAppLoad = true;

export const useNavigationState = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const hasRestoredRef = useRef(false);
  const isAppReadyRef = useRef(false);

  // Get auth state to determine if we should persist
  const { isUnlocked, isLoading } = useController();

  // Restore navigation state on app startup
  const restoreState = useCallback(async () => {
    // Only restore once per session
    if (hasRestoredRef.current) return;

    // Don't restore if still loading auth state
    if (isLoading) return;

    // Don't restore if not authenticated
    if (!isUnlocked) {
      // Clear any saved state if user is not authenticated
      await clearNavigationState();
      return;
    }

    try {
      const savedState = await loadNavigationState();
      if (!savedState) {
        // Mark app as ready since we're done with restoration attempt
        setTimeout(() => {
          isInitialAppLoad = false;
          isAppReadyRef.current = true;
        }, 500);
        return;
      }

      // Mark that we've attempted restoration
      hasRestoredRef.current = true;
      isRestoringNavigation = true;

      // For restoration, navigate directly without creating cycles
      // Build URL with tab parameter if provided
      let path = savedState.currentPath;
      if (savedState.tab) {
        path += `?tab=${savedState.tab}`;
      }

      // Navigate directly to restored path with original context (no nesting)
      navigate(path, {
        state: {
          ...savedState.state,
          returnContext: savedState.returnContext, // Preserve original navigation chain
          scrollPosition: savedState.scrollPosition,
        },
      });

      // Reset the restoring flag after navigation completes
      setTimeout(() => {
        isRestoringNavigation = false;
        isInitialAppLoad = false;
        isAppReadyRef.current = true;
        console.log('[useNavigationState] 🏁 Restoration complete, app ready');
      }, 1000); // Longer delay to ensure navigation completes
    } catch (error) {
      console.error('[useNavigationState] Failed to restore state:', error);
      isRestoringNavigation = false;
      isInitialAppLoad = false;
      isAppReadyRef.current = true;
    }
  }, [navigate, isUnlocked, isLoading, location.pathname]);

  // Clear navigation state on route changes (after app ready)
  useEffect(() => {
    // Only act after app is ready and not during restoration
    if (isAppReadyRef.current && !isRestoringNavigation && !isInitialAppLoad) {
      // Clear any existing saved state on navigation
      clearNavigationState();
    }
  }, [location.pathname]);

  return {
    restoreState,
  };
};
