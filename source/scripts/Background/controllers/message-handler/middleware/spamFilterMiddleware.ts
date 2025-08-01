import { ethErrors } from 'helpers/errors';

import { popupPromise } from '../popup-promise';
import { Middleware, requestCoordinator } from '../request-pipeline';
import { recordRequest, blockDapp, resetDappRequests } from 'state/spamFilter';
import {
  isDappBlocked,
  shouldShowSpamWarning,
} from 'state/spamFilter/selectors';
import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';

/**
 * Spam Filter Middleware
 * Implements PPOM-like protection against spam requests
 *
 * Features:
 * - Tracks request counts per dapp
 * - Shows warning after threshold is reached
 * - Blocks dapps temporarily if user chooses
 * - Returns 4100 error code when blocked
 */
export const spamFilterMiddleware: Middleware = async (context, next) => {
  const { originalRequest, methodConfig } = context;
  const { host, method } = originalRequest;

  // Only count requests that would open popups
  if (!methodConfig?.hasPopup) {
    return next(); // Skip spam filter for non-popup requests
  }

  const state = store.getState();

  // Check if dapp is currently blocked
  if (isDappBlocked(state, host)) {
    console.log(
      `[SpamFilter] Popup request blocked for ${host} - spam filter active`
    );

    // Just reject the request without showing a popup (like MetaMask does)
    throw cleanErrorStack(
      ethErrors.provider.unauthorized('Request blocked due to spam filter.')
    );
  }

  // Record the popup request
  store.dispatch(recordRequest({ host, method }));

  // Check if we should show spam warning
  const updatedState = store.getState();
  if (shouldShowSpamWarning(updatedState, host)) {
    console.log(
      `[SpamFilter] Popup spam threshold reached for ${host}, showing warning`
    );

    try {
      // Show spam warning popup through coordinator to prevent duplicates
      const result = await requestCoordinator.coordinatePopupRequest(
        context,
        () =>
          popupPromise({
            host,
            route: 'spam-warning' as any,
            eventName: 'spamWarningResponse',
            data: {
              requestCount:
                updatedState.spamFilter.dapps[host]?.requests.length || 0,
            },
          }),
        'spam-warning' as any
      );

      // Handle user response
      if (result && (result as any).action === 'block') {
        console.log(`[SpamFilter] User chose to block ${host}`);
        store.dispatch(blockDapp({ host }));

        // Throw error to block this request
        throw cleanErrorStack(
          ethErrors.provider.unauthorized('Request blocked due to spam filter.')
        );
      }

      // If user chose not to block, reset the request count to start fresh
      console.log(
        `[SpamFilter] User chose not to block ${host}, resetting count and continuing`
      );
      store.dispatch(resetDappRequests({ host }));
    } catch (error) {
      // If popup was closed or errored, treat as rejection
      console.error('[SpamFilter] Error showing spam warning:', error);
      throw cleanErrorStack(
        ethErrors.provider.userRejectedRequest('Spam warning rejected')
      );
    }
  }

  // Continue to next middleware
  return next();
};
