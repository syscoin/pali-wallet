import { ethErrors } from 'helpers/errors';

import { popupPromise } from '../popup-promise';
import { Middleware, requestCoordinator } from '../request-pipeline';
import {
  recordRequest,
  blockDapp,
  resetDappRequests,
  showWarning,
} from 'state/spamFilter';
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
 * - Counts the first actual popup opening attempt for each request
 * - Warns at 3 attempts within 10 seconds; completed approvals reset the burst
 * - User can choose to temporarily block the dapp (default: 1 minute)
 * - Resets an allowed burst so normal follow-up requests are not interrupted
 * - Blocked dapps get authorization errors without showing popups
 */
export const spamFilterMiddleware: Middleware = async (context, next) => {
  const { originalRequest, methodConfig } = context;
  const { host, method } = originalRequest;

  // Only count requests that would open popups
  if (!methodConfig?.hasPopup) {
    return next(); // Skip spam filter for non-popup requests
  }

  const assertNotBlocked = () => {
    if (isDappBlocked(store.getState(), host)) {
      throw cleanErrorStack(
        ethErrors.provider.unauthorized('Request blocked due to spam filter.')
      );
    }
  };
  assertNotBlocked();

  let attemptedOpening = false;
  // A popup-capable method may fail before it opens anything. Count only its
  // first opening attempt, after the coordinator has acquired the popup slot.
  const unregisterGuard = requestCoordinator.registerPopupGuard(
    context,
    async () => {
      assertNotBlocked();
      attemptedOpening = true;
      store.dispatch(recordRequest({ host, method }));
      const updatedState = store.getState();
      if (!shouldShowSpamWarning(updatedState, host)) return;

      console.log(
        `[SpamFilter] Popup spam threshold reached for ${host}, showing warning`
      );

      // Mark the warning as active so concurrent requests do not open duplicates.
      store.dispatch(showWarning({ host }));

      try {
        // The coordinator already owns this slot. Opening the warning here keeps
        // it serialized with approval without recursively queuing the same request.
        const result = await popupPromise({
          signal: context.originalRequest.signal,
          sender: context.originalRequest.sender,
          host,
          route: 'spam-warning' as any,
          eventName: 'spamWarningResponse',
          data: {
            requestCount:
              updatedState.spamFilter.dapps[host]?.requests.length || 0,
          },
        });

        // Handle user response
        if (result && (result as any).action === 'block') {
          console.log(`[SpamFilter] User chose to block ${host}`);
          store.dispatch(blockDapp({ host }));

          // Throw error to block this request
          throw cleanErrorStack(
            ethErrors.provider.unauthorized(
              'Request blocked due to spam filter.'
            )
          );
        }

        console.log(
          `[SpamFilter] User chose not to block ${host}, resetting request burst`
        );
      } finally {
        // Start a fresh burst after allow or popup dismissal. Without this reset,
        // every later popup request immediately retriggers the warning. Preserve
        // the blocked state when the user explicitly chose to block the site.
        if (!isDappBlocked(store.getState(), host)) {
          store.dispatch(resetDappRequests({ host }));
        }
      }
      // Give the warning window the same closing space as ordinary approvals.
      await new Promise((resolve) => setTimeout(resolve, 100));
      assertNotBlocked();
    }
  );

  try {
    // A completed popup is legitimate interaction, not an accumulating spam
    // burst. Rejected or failed popup attempts still protect against repeated
    // unwanted prompts, including failures to create the approval window.
    const result = await next();
    if (attemptedOpening) store.dispatch(resetDappRequests({ host }));
    return result;
  } finally {
    unregisterGuard();
  }
};
