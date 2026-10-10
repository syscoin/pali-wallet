import { startTransition, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  createBrowsingNavigationContext,
  getWalletNavigationScope,
  isRestorableWalletRoute,
} from 'utils/navigationState';

/**
 * Custom navigation hook that wraps navigation in startTransition
 * to prevent synchronous loading errors with lazy-loaded components
 */
export function useSafeNavigate() {
  const navigate = useNavigate();
  const location = useLocation();

  const safeNavigate = useCallback(
    (to: string | number, options?: any) => {
      startTransition(() => {
        if (typeof to === 'number') {
          navigate(to);
        } else {
          const state = options?.state;
          const contextual =
            !options?.replace &&
            to !== '/home' &&
            isRestorableWalletRoute(location.pathname) &&
            !to.startsWith('/external') &&
            to.startsWith('/') &&
            to !== '/' &&
            !state?.returnContext;
          navigate(
            to,
            contextual
              ? {
                  ...options,
                  state: {
                    ...state,
                    walletScope: getWalletNavigationScope(),
                    returnContext: createBrowsingNavigationContext(location),
                  },
                }
              : options
          );
        }
      });
    },
    [navigate, location]
  );

  return safeNavigate;
}
