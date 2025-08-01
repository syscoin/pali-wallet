import { clearDappState } from 'state/spamFilter';
import { getDappSpamState } from 'state/spamFilter/selectors';
import store from 'state/store';

const CLEANUP_INTERVAL = 60000; // 1 minute
const STALE_STATE_THRESHOLD = 3600000; // 1 hour

/**
 * Cleans up expired spam filter states
 * - Removes dapp states where block has expired
 * - Removes dapp states that haven't been used in over an hour
 */
export function cleanupExpiredSpamStates(): void {
  const state = store.getState();
  const now = Date.now();

  Object.keys(state.spamFilter.dapps).forEach((host) => {
    const dappState = getDappSpamState(state, host);
    if (!dappState) return;

    // Check if block has expired
    if (dappState.blockedUntil && dappState.blockedUntil < now) {
      console.log(`[SpamFilterCleanup] Removing expired block for ${host}`);
      store.dispatch(clearDappState({ host }));
      return;
    }

    // Check if state is stale (no recent requests)
    const lastRequestTime =
      dappState.requests.length > 0
        ? Math.max(...dappState.requests.map((r) => r.timestamp))
        : dappState.lastResetTime;

    if (now - lastRequestTime > STALE_STATE_THRESHOLD) {
      console.log(`[SpamFilterCleanup] Removing stale state for ${host}`);
      store.dispatch(clearDappState({ host }));
    }
  });
}

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Starts the spam filter cleanup interval
 */
export function startSpamFilterCleanup(): void {
  if (cleanupInterval) {
    console.log('[SpamFilterCleanup] Cleanup already running');
    return;
  }

  console.log('[SpamFilterCleanup] Starting cleanup interval');

  // Run initial cleanup
  cleanupExpiredSpamStates();

  // Set up interval
  cleanupInterval = setInterval(() => {
    cleanupExpiredSpamStates();
  }, CLEANUP_INTERVAL);
}

/**
 * Stops the spam filter cleanup interval
 */
export function stopSpamFilterCleanup(): void {
  if (cleanupInterval) {
    console.log('[SpamFilterCleanup] Stopping cleanup interval');
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
