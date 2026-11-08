import { getAddress } from 'ethers/address';
import { recoverAddress, Transaction } from 'ethers/transaction';

import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeApproval.ts';

import { paliGuardianRecoveryModuleInterface } from './contracts.ts';
import type { GuardianRecoveryObservation } from './guardianStatus.ts';
import type { SmartAccountGuardianRecoveryOperation } from './recovery.ts';
import type { EvmRetainedSignedRecord } from '../../wallet/evmSignedRecords.ts';

export type GuardianRecoveryApprovalVerification = Readonly<
  { guardian: string; kind: 'ecdsa' } | { guardian: string; kind: 'contract' }
>;

/** Match the retained signed envelope, never transaction metadata or a reply.
 * Contract guardians carry opaque ERC-1271 approvals. Matching their exact call
 * only retains an unresolved attempt; it never proves that approval succeeded.
 */
export function matchesGuardianRecoveryTransaction(
  entry: EvmRetainedSignedRecord,
  operation: SmartAccountGuardianRecoveryOperation,
  approval: GuardianRecoveryApprovalVerification
): boolean {
  try {
    if (approval.kind !== 'ecdsa' && approval.kind !== 'contract') return false;
    const transaction = Transaction.from(entry.rawTransaction);
    if (
      !transaction.isSigned() ||
      transaction.hash !== entry.hash ||
      transaction.nonce !== entry.nonce ||
      transaction.from?.toLowerCase() !== entry.from.toLowerCase() ||
      transaction.chainId.toString() !== entry.chainId ||
      entry.chainId !== String(operation.chainId) ||
      transaction.to?.toLowerCase() !==
        operation.recoveryModule.toLowerCase() ||
      transaction.value !== BigInt(0)
    )
      return false;
    const call = paliGuardianRecoveryModuleInterface.parseTransaction({
      data: transaction.data,
    });
    if (
      !call ||
      !['scheduleRecovery', 'executeRecovery'].includes(call.name) ||
      getAddress(call.args[0]) !== operation.account ||
      call.args[1].toLowerCase() !== operation.salt.toLowerCase() ||
      call.args[2].toLowerCase() !== operation.mode.toLowerCase() ||
      call.args[3].toLowerCase() !== operation.executionCalldata.toLowerCase()
    )
      return false;
    if (
      call.name === 'scheduleRecovery' &&
      (call.args[4].length !== 1 ||
        getAddress(call.args[4][0].guardian) !==
          getAddress(approval.guardian) ||
        (approval.kind === 'ecdsa' &&
          getAddress(
            recoverAddress(operation.hash, call.args[4][0].signature)
          ) !== getAddress(approval.guardian)))
    )
      return false;
    return (
      paliGuardianRecoveryModuleInterface
        .encodeFunctionData(call.fragment, call.args)
        .toLowerCase() === transaction.data.toLowerCase()
    );
  } catch {
    return false;
  }
}

export type GuardianRecoveryTransactionRecords = Readonly<{
  observe(entry: EvmRetainedSignedRecord): Promise<
    Readonly<{
      observation:
        | { status: 'mined' }
        | { latestNonce: string; status: 'missing' };
      terminalPhase: string | null;
    }>
  >;
  read(): Promise<readonly EvmRetainedSignedRecord[]>;
}>;

/** Only matching signed attempts enter the existing canonical receipt observer. */
export async function pendingGuardianRecoveryTransaction(
  operation: SmartAccountGuardianRecoveryOperation,
  approval: GuardianRecoveryApprovalVerification,
  records: GuardianRecoveryTransactionRecords,
  assertCurrent: () => void
): Promise<string | null> {
  if (!approval || !['ecdsa', 'contract'].includes(approval.kind))
    throw new Error('Guardian recovery approval verification is required');
  getAddress(approval.guardian);
  const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
  check();
  const saved = await records.read();
  check();
  const matching = saved.filter((entry) =>
    matchesGuardianRecoveryTransaction(entry, operation, approval)
  );
  const consumed = new Map<string, bigint>();
  let queries = 0;
  for (const entry of matching.sort(
    (left, right) => right.nonce - left.nonce
  )) {
    if (BigInt(entry.nonce) < (consumed.get(entry.from) ?? BigInt(0))) continue;
    if (++queries > 48)
      throw new Error('Recovery transaction observation is incomplete');
    const observed = await records.observe(entry);
    check();
    const next =
      observed.observation.status === 'mined'
        ? BigInt(entry.nonce) + BigInt(1)
        : BigInt(observed.observation.latestNonce);
    if (next > (consumed.get(entry.from) ?? BigInt(0)))
      consumed.set(entry.from, next);
    if (!observed.terminalPhase) return entry.hash;
  }
  const latest = await records.read();
  check();
  if (
    latest.map((entry) => entry.hash).join(',') !==
    saved.map((entry) => entry.hash).join(',')
  )
    throw new Error('Recovery transactions changed during observation');
  return null;
}

/** A fresh policy revision can retire an unsent intent only after its full signed-byte scan. */
export function guardianRecoveryIntentResolved(
  operation: SmartAccountGuardianRecoveryOperation,
  observation: GuardianRecoveryObservation,
  pendingHash: string | null | undefined
): boolean {
  if (
    observation.account !== operation.account ||
    observation.chainId !== operation.chainId ||
    observation.moduleAddress.toLowerCase() !==
      operation.recoveryModule.toLowerCase()
  )
    return false;
  if (observation.knownOperation?.status === 'executed') return true;
  return (
    pendingHash === null &&
    (!observation.exists ||
      observation.policyEpoch !== operation.policyEpoch ||
      ['canceled', 'expired', 'inactive'].includes(
        observation.knownOperation?.status ?? ''
      ))
  );
}
