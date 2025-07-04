/**
 * Navigation state management utility
 * Handles preservation of tab states and navigation context when moving between pages
 */

import { chromeStorage } from './storageAPI';

export interface INavigationContext {
  // Component state to preserve
  componentState?: Record<string, any>;
  // Nested return context for chained back navigation
  returnContext?: INavigationContext;
  // The route to return to
  returnRoute: string;
  // Scroll position to restore
  scrollPosition?: number;
  // Tab or view state to restore
  tab?: string;
}

// Storage key for navigation state
const NAVIGATION_STATE_KEY = 'pali_navigation_state';

export interface ISavedNavigationState {
  componentState?: Record<string, any>;
  currentPath: string;
  returnContext?: INavigationContext;
  scrollPosition?: number;
  tab?: string; // Preserve return navigation
  timestamp: number; // To validate freshness
}

/**
 * Save current navigation state to Chrome storage
 */
export const saveNavigationState = async (
  path: string,
  tab?: string,
  componentState?: Record<string, any>,
  returnContext?: INavigationContext
): Promise<void> => {
  try {
    // Prevent recursive nesting - only preserve one level of back navigation
    if (returnContext) {
      returnContext.returnContext = undefined;
    }

    const state: ISavedNavigationState = {
      currentPath: path,
      tab,
      componentState,
      returnContext,
      scrollPosition: window.scrollY || 0,
      timestamp: Date.now(),
    };

    await chromeStorage.setItem(NAVIGATION_STATE_KEY, JSON.stringify(state));
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

      const state = JSON.parse(savedState) as ISavedNavigationState;

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
  componentState?: Record<string, any>
): INavigationContext => ({
  returnRoute,
  tab,
  scrollPosition: window.scrollY || 0,
  componentState,
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
        componentState: returnContext.componentState,
        returnContext: returnContext.returnContext, // Preserve nested return context
        fromNavigation: true,
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
