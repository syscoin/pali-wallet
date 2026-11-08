import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeApproval.ts';
import { readPrivateDepositAttempt } from '../utils/privacy/depositMetadata.ts';

import type { EvmRetainedSignedRecord } from './evmSignedRecords.ts';
import type { EvmReplayAuthorization } from './evmSignedReplay.ts';
import type { IPrivacyDepositAttempt } from '../utils/privacy/transactionTypes.ts';

/** Both hosts authorize the authenticated private marker through their existing vault. */
export async function authorizePrivateDepositReplay(
  entry: EvmRetainedSignedRecord,
  assertCurrent: () => void,
  authorizePrivate: (
    attempt: Readonly<IPrivacyDepositAttempt>
  ) => Promise<EvmReplayAuthorization>
): Promise<EvmReplayAuthorization> {
  assertSynchronousEvmFeeGuard(assertCurrent);
  const attempt = readPrivateDepositAttempt(entry);
  if (attempt) {
    const lease = await authorizePrivate(attempt);
    assertSynchronousEvmFeeGuard(assertCurrent);
    assertSynchronousEvmFeeGuard(lease.assertCurrent);
    return Object.freeze({
      assertCurrent() {
        assertSynchronousEvmFeeGuard(assertCurrent);
        assertSynchronousEvmFeeGuard(lease.assertCurrent);
      },
      withAdmission<T>(admit: () => Promise<Readonly<{ result: T }>>) {
        return lease.withAdmission(async () => {
          assertSynchronousEvmFeeGuard(assertCurrent);
          return admit();
        });
      },
      // A true ACK belongs to the original wallet even after a UI selection changes.
      onAcknowledged: lease.onAcknowledged,
    });
  }
  return Object.freeze({
    assertCurrent,
    async withAdmission<T>(admit: () => Promise<Readonly<{ result: T }>>) {
      assertSynchronousEvmFeeGuard(assertCurrent);
      return admit();
    },
    async onAcknowledged() {
      assertSynchronousEvmFeeGuard(assertCurrent);
    },
  });
}
