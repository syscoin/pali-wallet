import { createPrivacyPoolSync } from '../../../wallet/privacyPoolSync';
import { privacyCache, type PrivacyCache } from 'utils/privacy/cache';
import {
  fetchPrivacySnapshot,
  verifySnapshotAnchor,
} from 'utils/privacy/client';
import type { IPrivacyNoteReader } from 'utils/privacy/privateVaultTypes';
import type { IPrivacySnapshotReader } from 'utils/privacy/trustedSnapshot';
import type { PrivacyController, PrivacyPoolId } from 'utils/privacy/types';

export { PRIVACY_NOTE_MAX_BLOCK_AGE_MS } from '../../../wallet/privacyPoolSync';

export const PRIVACY_ALARM_PREFIX = 'privacy-pool-sync:';

type Dependencies = {
  cache?: PrivacyCache;
  fetchSnapshot?: typeof fetchPrivacySnapshot;
  now?: () => number;
  schedule?: (poolId: PrivacyPoolId, delay: number) => void;
  stop?: (poolId: PrivacyPoolId) => void;
  verifyAnchor?: typeof verifySnapshotAnchor;
};

/** Extension composition root. Keep Chrome alarms and cache outside the verifier. */
export function createPrivacyController(
  getNetwork: () => { chainId: number; isEthereum: boolean; url: string },
  dependencies: Dependencies = {},
  registerNoteReader?: (reader: IPrivacyNoteReader) => void,
  registerSnapshotReader?: (reader: IPrivacySnapshotReader) => void
): PrivacyController {
  const now = dependencies.now || Date.now;
  const timers = new Map<PrivacyPoolId, ReturnType<typeof setTimeout>>();
  const schedule =
    dependencies.schedule ||
    ((poolId, delay) => {
      // A durable alarm is the fallback if Chrome suspends a short-lived timer.
      chrome.alarms.create(PRIVACY_ALARM_PREFIX + poolId, {
        when: now() + Math.max(delay, 30000),
      });
      const previous = timers.get(poolId);
      if (previous) clearTimeout(previous);
      timers.set(
        poolId,
        setTimeout(() => {
          void resumePending(poolId).catch(() => undefined);
        }, delay)
      );
    });
  const stop =
    dependencies.stop ||
    ((poolId) => {
      const timer = timers.get(poolId);
      if (timer) clearTimeout(timer);
      timers.delete(poolId);
      void chrome.alarms.clear(PRIVACY_ALARM_PREFIX + poolId);
    });

  const controller: PrivacyController = createPrivacyPoolSync(
    getNetwork,
    {
      cache: dependencies.cache || privacyCache,
      fetchSnapshot: dependencies.fetchSnapshot || fetchPrivacySnapshot,
      verifyAnchor: dependencies.verifyAnchor || verifySnapshotAnchor,
      now,
      schedule,
      stop,
      startRequestTimeout(callback, delay) {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
    },
    registerNoteReader,
    registerSnapshotReader
  );
  const { resumePending } = controller;
  return controller;
}
