import { fetchPrivacySnapshot } from 'utils/privacy/client';
import { PRIVACY_POOLS } from 'utils/privacy/registry';
import {
  assertPrivacyServiceStable,
  changePrivacyServiceOrigin,
  getPrivacyServiceOrigin,
  privacyServiceRevision,
} from 'utils/privacy/service';
import type { PrivacyController, PrivacyPoolId } from 'utils/privacy/types';

export async function fetchConfiguredPrivacySnapshot(
  poolId: PrivacyPoolId,
  signal: AbortSignal
) {
  const revision = privacyServiceRevision();
  const origin = await getPrivacyServiceOrigin();
  const snapshot = await fetchPrivacySnapshot(poolId, signal, origin);
  assertPrivacyServiceStable(revision);
  return snapshot;
}

export function createPrivacySettings(
  privacy: Pick<PrivacyController, 'clear'>,
  invalidateWithdrawals: () => Promise<void>
) {
  return {
    getServiceOrigin: getPrivacyServiceOrigin,
    setServiceOrigin: (origin: string, expectedOrigin: string) => {
      if (typeof expectedOrigin !== 'string')
        throw new Error('privacy_service_changed');
      return changePrivacyServiceOrigin(
        origin,
        async () => {
          const results = await Promise.allSettled([
            ...PRIVACY_POOLS.map((pool) => privacy.clear(pool.id)),
            invalidateWithdrawals(),
          ]);
          if (results.some((result) => result.status === 'rejected'))
            throw new Error('privacy_service_update_failed');
        },
        expectedOrigin
      );
    },
  };
}
