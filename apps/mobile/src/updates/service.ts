import type { MobileUpdateService, MobileUpdateSnapshot } from './types';

const snapshot: MobileUpdateSnapshot = Object.freeze({ status: 'idle', release: null, lastCheckedAt: null, lastAttemptAt: null,
  error: null, alertsEnabled: false, permission: 'unknown' });
/** Browser design previews never check stores or request device permissions. */
export const mobileUpdates: MobileUpdateService = {
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  check: async () => undefined,
  setAlerts: async () => undefined,
};
