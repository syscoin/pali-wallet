import { ISpamFilterState, IDappSpamState } from 'types/security';

// Define a minimal state interface that matches what we actually get from store.getState()
interface ISpamFilterRootState {
  spamFilter: ISpamFilterState;
}

export const getSpamFilterState = (
  state: ISpamFilterRootState
): ISpamFilterState => state.spamFilter;

export const getDappSpamState = (
  state: ISpamFilterRootState,
  host: string
): IDappSpamState | undefined => state.spamFilter.dapps[host];

export const isDappBlocked = (
  state: ISpamFilterRootState,
  host: string
): boolean => {
  const dappState = getDappSpamState(state, host);
  if (!dappState || !dappState.blockedUntil) {
    return false;
  }
  return dappState.blockedUntil > Date.now();
};

export const shouldShowSpamWarning = (
  state: ISpamFilterRootState,
  host: string
): boolean => {
  const dappState = getDappSpamState(state, host);
  const config = state.spamFilter.config;

  if (!dappState || !config.enabled) {
    return false;
  }

  // Don't show warning if already blocked
  if (isDappBlocked(state, host)) {
    return false;
  }

  // Count recent requests within time window
  const now = Date.now();
  const cutoffTime = now - config.timeWindowMs;
  const recentRequests = dappState.requests.filter(
    (req) => req.timestamp > cutoffTime
  );

  return recentRequests.length >= config.requestThreshold;
};

export const getRecentRequestCount = (
  state: ISpamFilterRootState,
  host: string
): number => {
  const dappState = getDappSpamState(state, host);
  if (!dappState) {
    return 0;
  }

  const now = Date.now();
  const cutoffTime = now - state.spamFilter.config.timeWindowMs;
  return dappState.requests.filter((req) => req.timestamp > cutoffTime).length;
};
