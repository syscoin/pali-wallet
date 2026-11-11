import { getPaliModuleAddress } from '../utils/smartAccount/contracts.ts';
import {
  readGuardianRecoveryObservation,
  type GuardianRecoveryObservation,
} from '../utils/smartAccount/guardianStatus.ts';

import {
  activityNotificationScopeKey,
  type ActivityNotificationScope,
} from './activityNotifications.ts';

/** The existing anchored runtime-attested reader, with the known module address
 * selected from the shared registry. Hosts supply their existing RPC transport.
 */
export async function observeGuardianActivity({
  scope,
  provider,
  knownOperationId,
  assertCurrent,
  now,
}: {
  assertCurrent?: () => void;
  knownOperationId?: string;
  now?: () => number;
  provider: Parameters<typeof readGuardianRecoveryObservation>[0]['provider'];
  scope: ActivityNotificationScope;
}): Promise<GuardianRecoveryObservation> {
  activityNotificationScopeKey(scope);
  const chainId = Number(scope.chainId);
  if (
    scope.networkType !== 'evm' ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0
  )
    throw new Error('Guardian activity requires an EVM account');
  return readGuardianRecoveryObservation({
    provider,
    account: scope.accountAddress,
    chainId,
    moduleAddress: getPaliModuleAddress(chainId, 'guardian-recovery'),
    knownOperationId,
    assertCurrent,
    now,
  });
}
