import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeApproval.ts';
import { readPrivateDepositAttempt } from '../utils/privacy/depositMetadata.ts';
import { readPrivateWithdrawalAttempt } from '../utils/privacy/withdrawalMetadata.ts';

import type { EvmRetainedSignedRecord } from './evmSignedRecords.ts';
import type { EvmReplayAuthorization } from './evmSignedReplay.ts';
import type { IPrivacyDepositAttempt } from '../utils/privacy/transactionTypes.ts';
import type { IPrivacyWithdrawalAttempt } from '../utils/privacy/withdrawalTransactionTypes.ts';

/** Both hosts authorize the authenticated private marker through their existing vault. */
export async function authorizePrivateNoteReplay(
  entry: EvmRetainedSignedRecord,
  assertCurrent: () => void,
  authorizeDeposit: (
    attempt: Readonly<IPrivacyDepositAttempt>
  ) => Promise<EvmReplayAuthorization>,
  authorizeWithdrawal: (
    attempt: Readonly<Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }>>
  ) => Promise<EvmReplayAuthorization>
): Promise<EvmReplayAuthorization> {
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (
    entry.metadata &&
    Object.hasOwn(entry.metadata, 'privateDeposit') &&
    Object.hasOwn(entry.metadata, 'privateWithdrawal')
  )
    throw new Error('EVM_PRIVATE_NOTE_METADATA_INVALID');
  const deposit = readPrivateDepositAttempt(entry);
  const withdrawal = readPrivateWithdrawalAttempt(entry);
  if (deposit || withdrawal) {
    const lease = deposit
      ? await authorizeDeposit(deposit)
      : await authorizeWithdrawal(withdrawal!);
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
