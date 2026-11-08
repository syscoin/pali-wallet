import { getAddress } from 'ethers/address';

import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';

import type { SmartAccountPendingRecords } from './evmSignedRecords.ts';
import {
  observeSmartAccountActivity,
  type RetainedSmartAccountOperation,
} from './smartAccountActivity.ts';
import type { EvmObservationMethod } from '../shared/evmTransactionObservation.ts';
import type { GuardianRecoveryObservation } from '../utils/smartAccount/guardianStatus.ts';

export function guardianPolicyObservationIdentity(
  observation: GuardianRecoveryObservation | null
): string {
  return JSON.stringify([
    observation?.exists ?? false,
    observation?.moduleAddress ?? null,
    observation?.policyEpoch ?? null,
    observation?.active?.operationId ?? null,
  ]);
}

export type GuardianRemovalInspection = Readonly<{
  status: 'removed' | 'pending' | 'retry-ready' | 'unknown';
  totalPending: number;
  transactions: readonly RetainedSmartAccountOperation[];
}>;

/** Inspect authenticated removal envelopes. A failed read never grants retry authority. */
export async function inspectGuardianRemovals({
  account,
  chainId,
  moduleAddress,
  records,
  read,
  assertCurrent,
}: {
  account: string;
  assertCurrent(): void;
  chainId: number;
  moduleAddress: string;
  read(
    method: EvmObservationMethod,
    params: readonly unknown[]
  ): Promise<unknown>;
  records: SmartAccountPendingRecords;
}): Promise<GuardianRemovalInspection> {
  const owner = getAddress(account),
    module = getAddress(moduleAddress);
  const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
  const matching = (entries: readonly RetainedSmartAccountOperation[]) =>
    entries.filter(
      (entry) =>
        entry.account === owner &&
        entry.chainId === String(chainId) &&
        entry.guardianRemoval?.moduleAddress === module
    );
  const identity = (entries: readonly RetainedSmartAccountOperation[]) =>
    JSON.stringify(
      entries.map((entry) => [
        entry.hash,
        entry.operationHash,
        entry.operationNonce,
        entry.payer,
        entry.payerNonce,
      ])
    );
  check();
  const attempts = matching(await records.read(true));
  check();
  const pending: RetainedSmartAccountOperation[] = [];
  const consumed = new Map<string, bigint>();
  let queries = 0,
    incomplete = false;
  for (const attempt of [...attempts].sort(
    (left, right) => right.payerNonce - left.payerNonce
  )) {
    const nonce = BigInt(attempt.payerNonce);
    if (nonce < (consumed.get(attempt.payer) ?? BigInt(0))) continue;
    if (queries++ >= 48) {
      incomplete = true;
      break;
    }
    const observed = await observeSmartAccountActivity(
      { ...attempt, nonce: attempt.payerNonce },
      read,
      check
    );
    check();
    const next =
      observed.status === 'missing'
        ? BigInt(observed.latestNonce)
        : nonce + BigInt(1);
    if (next > (consumed.get(attempt.payer) ?? BigInt(0)))
      consumed.set(attempt.payer, next);
    if (observed.status === 'missing' && next <= nonce) pending.push(attempt);
  }
  const latest = matching(await records.read(true));
  check();
  if (identity(latest) !== identity(attempts))
    throw new Error('Guardian removal records changed during observation');
  return Object.freeze({
    status: incomplete ? 'unknown' : pending.length ? 'pending' : 'retry-ready',
    transactions: Object.freeze(pending.slice(0, 20)),
    totalPending: pending.length,
  });
}
