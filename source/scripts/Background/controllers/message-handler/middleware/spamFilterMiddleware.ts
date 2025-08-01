import { ethErrors } from 'helpers/errors';

import { popupPromise } from '../popup-promise';
import { Middleware, requestCoordinator } from '../request-pipeline';
import { recordRequest, blockDapp, showWarning } from 'state/spamFilter';
import {
  isDappBlocked,
  shouldShowSpamWarning,
} from 'state/spamFilter/selectors';
import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';

/**
 * Spam Filter Middleware
 * Protects users from spammy dapps by tracking popup requests
 *
 * Features:
 * - Tracks popup request counts per dapp within a time window
 * - Shows warning after threshold is reached (default: 3 requests in 10 seconds)
 * - User can choose to temporarily block the dapp (default: 1 minute)
 * - Grace period after warning to prevent duplicate warnings (default: 30 seconds)
 * - Blocked dapps get authorization errors without showing popups
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

    // Mark that we're showing the warning (grace period will prevent duplicates)
    store.dispatch(showWarning({ host }));

    // Show spam warning popup through coordinator
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

    // If user chose not to block, continue with grace period
    console.log(
      `[SpamFilter] User chose not to block ${host}, continuing with grace period`
    );
  }

  // Continue to next middleware
  return next();
};
