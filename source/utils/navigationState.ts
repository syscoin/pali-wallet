/**
 * Navigation state management utility
 * Handles preservation of tab states and navigation context when moving between pages
 */

import { chromeStorage } from './storageAPI';

export interface INavigationContext {
  // Nested return context for chained back navigation
  returnContext?: INavigationContext;
  // The route to return to
  returnRoute: string;
  // Scroll position to restore
  scrollPosition?: number;
  // Component state to preserve
  state?: Record<string, any>;
  // Tab or view state to restore
  tab?: string;
}

// Storage key for navigation state
const NAVIGATION_STATE_KEY = 'pali_navigation_state';

export interface ISavedNavigationState {
  currentPath: string;
  returnContext?: INavigationContext;
  scrollPosition?: number;
  state?: Record<string, any>;
  tab?: string; // Preserve return navigation
  timestamp: number; // To validate freshness
}

/**
 * Save current navigation state to Chrome storage
 */
export const saveNavigationState = async (
  path: string,
  tab?: string,
  state?: Record<string, any>,
  returnContext?: INavigationContext
): Promise<void> => {
  try {
    const navigationState: ISavedNavigationState = {
      currentPath: path,
      tab,
      state,
      returnContext,
      scrollPosition: window.scrollY || 0,
      timestamp: Date.now(),
    };

    await chromeStorage.setItem(NAVIGATION_STATE_KEY, navigationState);
  } catch (error) {
    console.error('[NavigationState] Failed to save navigation state:', error);
  }
};

/**
 * Load saved navigation state from Chrome storage
 */
export const loadNavigationState =
  async (): Promise<ISavedNavigationState | null> => {
    try {
      const savedState = await chromeStorage.getItem(NAVIGATION_STATE_KEY);
      if (!savedState) {
        return null;
      }

      const state = savedState as ISavedNavigationState;

      // Check if state is fresh (less than 24 hours old)
      const twentyFourHours = 24 * 60 * 60 * 1000;
      if (Date.now() - state.timestamp > twentyFourHours) {
        await clearNavigationState();
        return null;
      }

      console.log(
        '[NavigationState] Restored navigation to:',
        state.currentPath
      );
      return state;
    } catch (error) {
      console.error(
        '[NavigationState] Failed to load navigation state:',
        error
      );
      return null;
    }
  };

/**
 * Clear saved navigation state
 */
export const clearNavigationState = async (): Promise<void> => {
  try {
    await chromeStorage.removeItem(NAVIGATION_STATE_KEY);
  } catch (error) {
    console.error('[NavigationState] Failed to clear navigation state:', error);
  }
};

/**
 * Create navigation context for returning to a specific page with state
 */
export const createNavigationContext = (
  returnRoute: string,
  tab?: string,
  state?: Record<string, any>
): INavigationContext => ({
  returnRoute,
  tab,
  scrollPosition: window.scrollY || 0,
  state,
});

/**
 * Navigate to a detail page while preserving return context
 */
export const navigateWithContext = (
  navigate: (path: string, options?: any) => void,
  targetPath: string,
  targetState: Record<string, any>,
  returnContext: INavigationContext
) => {
  navigate(targetPath, {
    state: {
      ...targetState,
      returnContext,
    },
  });
};

/**
 * Navigate back using preserved context
 */
export const navigateBack = (
  navigate: (path: string | number, options?: any) => void,
  location: { state?: any }
) => {
  const returnContext = location.state?.returnContext as
    | INavigationContext
    | undefined;

  if (returnContext) {
    // Build URL with tab parameter if provided
    let path = returnContext.returnRoute;
    if (returnContext.tab) {
      path += `?tab=${returnContext.tab}`;
    }

    navigate(path, {
      state: {
        ...returnContext.state,
        returnContext: returnContext.returnContext, // Preserve nested return context
        scrollPosition: returnContext.scrollPosition,
      },
    });
  } else {
    navigate('/home');
  }
};

/**
 * Get current tab from URL search params or location state
 */
export const getCurrentTab = (
  searchParams: URLSearchParams,
  locationState: any,
  defaultTab: string
): string => {
  // Priority: URL param > location state > default
  const tabParam = searchParams.get('tab');
  if (tabParam) return tabParam;

  if (locationState?.tab) return locationState.tab;

  return defaultTab;
};
