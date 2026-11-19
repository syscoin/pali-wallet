import { getAddress } from 'ethers/address';

import {
  createErc20Policy,
  decodeErc20Transfer,
  type Erc20Metadata,
} from '../shared/erc20.ts';
import {
  getObservedEvmTerminalPhase,
  type EvmObservationRequest,
  type EvmTransactionObservation,
} from '../shared/evmTransactionObservation.ts';
import {
  decodeRetainedNftTransfer,
  type NftTransferIntent,
} from '../shared/nftTransfer.ts';
import { getPrivacyPoolActivity } from '../shared/privacyPoolActivity.ts';

import {
  retainedEvmTransaction,
  type EvmSignedRecords,
  type EvmRetainedRecord,
  type EvmSignedRecordSession,
  type EvmSignedRecordSummary,
} from './evmSignedRecords.ts';
import type { Transaction } from 'ethers/transaction';

export type EvmSavedTransaction = Pick<
  EvmSignedRecordSummary,
  'hash' | 'nonce' | 'operation' | 'originalHash'
> &
  Readonly<{
    cancellationUnavailable?: true;
    chainId: string;
    collectibleTransfer?: NftTransferIntent;
    createdAt: number;
    dataBytes: number;
    feePerGas: string;
    from: string;
    gasLimit: string;
    maximumFee: string;
    phase: EvmSignedRecordSummary['phase'];
    selector: string | null;
    speedUpAvailable?: true;
    to: string | null;
    tokenTransfer?: Readonly<{
      amountUnits: string;
      recipient: string;
      token?: Erc20Metadata;
    }>;
    type: number | null;
    value: string;
  }>;

export class EvmReplayError extends Error {
  readonly code: 'NOT_FOUND' | 'CONTEXT_CHANGED' | 'INVALID_RESPONSE';
  constructor(code: EvmReplayError['code']) {
    super(code);
    this.code = code;
    this.name = 'EvmReplayError';
  }
}
const request = (entry: EvmRetainedRecord): EvmObservationRequest => {
  const tx = retainedEvmTransaction(entry);
  return Object.freeze({
    chainId: entry.chainId,
    hash: entry.hash,
    from: entry.from,
    to: tx.to,
    nonce: String(entry.nonce),
  });
};
function tokenTransfer(
  entry: EvmRetainedRecord,
  tx: Transaction
): EvmSavedTransaction['tokenTransfer'] {
  if (
    (entry.operation !== 'erc20' &&
      (entry.operation !== 'speed-up' || !entry.metadata?.intent)) ||
    !tx.to ||
    tx.value !== BigInt(0)
  )
    return undefined;
  try {
    const decoded = decodeErc20Transfer(tx.data);
    let token: Erc20Metadata | undefined;
    try {
      const intent = entry.metadata?.intent as
        | Record<string, unknown>
        | undefined;
      const candidate = createErc20Policy(getAddress).parseMetadata(
        intent?.token
      );
      if (candidate.contractAddress === tx.to) token = candidate;
    } catch {
      /* The signed call is still reviewable without cached token metadata. */
    }
    return Object.freeze({ ...decoded, ...(token ? { token } : {}) });
  } catch {
    return undefined;
  }
}
export function projectSavedEvmTransaction(
  entry: EvmRetainedRecord
): EvmSavedTransaction {
  const tx = retainedEvmTransaction(entry),
    fee = tx.maxFeePerGas ?? tx.gasPrice;
  if (fee === null) throw new EvmReplayError('INVALID_RESPONSE');
  const token = tokenTransfer(entry, tx);
  const collectible = decodeRetainedNftTransfer(entry, tx);
  const canSpeedUp =
    entry.payloadKind === 'unsigned-eoa' &&
    ['signed', 'attempted', 'submitted'].includes(entry.phase);
  return Object.freeze({
    hash: entry.hash,
    nonce: entry.nonce,
    operation: entry.operation,
    ...(entry.payloadKind === 'unsigned-eoa' ||
    Object.hasOwn(entry.metadata ?? {}, 'privateWithdrawal') ||
    getPrivacyPoolActivity(tx.chainId.toString(), tx.to, tx.data)?.kind ===
      'withdrawal'
      ? { cancellationUnavailable: true as const }
      : {}),
    ...(entry.originalHash ? { originalHash: entry.originalHash } : {}),
    chainId: entry.chainId,
    from: entry.from,
    to: tx.to,
    value: tx.value.toString(),
    createdAt: entry.createdAt,
    phase: entry.phase,
    type: tx.type,
    gasLimit: tx.gasLimit.toString(),
    feePerGas: fee.toString(),
    maximumFee: (tx.gasLimit * fee).toString(),
    dataBytes: (tx.data.length - 2) / 2,
    selector: tx.data.length >= 10 ? tx.data.slice(0, 10) : null,
    ...(canSpeedUp ? { speedUpAvailable: true as const } : {}),
    ...(token ? { tokenTransfer: token } : {}),
    ...(collectible ? { collectibleTransfer: collectible } : {}),
  });
}

/** Observe and reconcile a retained record under the caller’s captured wallet guard. */
export async function observeRetainedEvmTransaction(
  records: EvmSignedRecords,
  recordSession: EvmSignedRecordSession,
  chainId: string,
  from: string,
  hash: string,
  observe: (
    request: EvmObservationRequest
  ) => Promise<EvmTransactionObservation>,
  assertCurrent: () => void
): Promise<
  Readonly<{
    entry: EvmRetainedRecord;
    observation: EvmTransactionObservation;
    terminalPhase: 'confirmed' | 'reverted' | 'nonce-consumed' | null;
  }>
> {
  const session = Object.freeze({
    keyring: recordSession.keyring,
    assertCurrent: recordSession.assertCurrent,
  });
  const current = assertCurrent,
    read = observe;
  current();
  const saved = await records.readForObservation(session, chainId, from, hash);
  current();
  if (!saved) throw new EvmReplayError('NOT_FOUND');
  const { entry, revision } = saved;
  const observation = await read(request(entry));
  current();
  const terminalPhase = getObservedEvmTerminalPhase(observation, entry.nonce);
  const phase =
    terminalPhase ??
    (['confirmed', 'reverted', 'nonce-consumed'].includes(entry.phase)
      ? 'submitted'
      : entry.phase);
  try {
    if (entry.operation === 'cancel' && observation.status === 'mined') {
      await records.reconcileMinedCancellation(
        session,
        entry,
        revision,
        observation,
        () => {
          current();
          return read(request(entry));
        }
      );
    } else if (terminalPhase || phase !== entry.phase) {
      await records.updateObservedPhase(session, entry, revision, phase);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'EVM_SIGNED_RECORD_OBSERVATION_CHANGED'
    )
      throw new EvmReplayError('CONTEXT_CHANGED');
    throw error;
  }
  current();
  return Object.freeze({
    entry: Object.freeze({ ...entry, phase }),
    observation,
    terminalPhase,
  });
}
