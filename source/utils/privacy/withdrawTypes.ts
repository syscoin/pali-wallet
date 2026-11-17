import type { IPrivacyProofProgress, IPrivacyProofResult } from './proverTypes';
import type { IPrivacyRelayerClient } from './relayers';
import type { PrivacyRelayerJobState } from './relayJobs';
import type {
  IPrivacyDepositFees,
  IPrivacySubmissionFailure,
} from './transactionTypes';
import type { IPrivacySnapshotAccess } from './trustedSnapshot';
import type { PrivacyPoolId } from './types';
import type {
  IPrivacyWithdrawalPreparationOptions,
  IPrivacyWithdrawalRequest,
} from './withdrawal';
import type {
  IPrivacyWithdrawalAcknowledgement,
  IPrivacyWithdrawalAttempt,
  IPrivacyWithdrawalSession,
  IPrivacyWithdrawalStatusRecord,
  IPrivacyWithdrawalTransaction,
} from './withdrawalTransactionTypes';

export interface IPrivacyWithdrawalPrepareRequest {
  mode: 'direct' | 'relayed';
  noteId: string;
  recipient: string;
  relayerId?: string;
}
/** Transient approval of one immutable prepared withdrawal; never persisted. */
export interface IPrivacyWithdrawalSubmitApproval {
  acceptPreviousWithdrawalRisk: true;
}
export interface IPrivacyWithdrawalPreviousAttempt {
  jobId?: string;
  mode: 'direct' | 'relayed';
  outcome: 'unknown' | 'submitted';
  recipient?: string;
  transactionHash?: string;
  transactionHashes?: readonly string[];
}
export interface IPrivacyWithdrawalHistory {
  binding: string;
  previousWithdrawals: readonly Readonly<IPrivacyWithdrawalPreviousAttempt>[];
}
export interface IPrivacyWithdrawalSubmissionApproval
  extends IPrivacyWithdrawalSubmitApproval {
  historyBinding: string;
}
/** Explicit public projection shared by the prepared review and its renderer. */
export function capturePreviousWithdrawalAttempts(
  value: unknown
): readonly Readonly<IPrivacyWithdrawalPreviousAttempt>[] {
  if (!Array.isArray(value) || value.length > 64)
    throw new Error('privacy_withdrawal_invalid');
  const hash = /^0x[0-9a-fA-F]{64}$/;
  const jobId = /^[A-Za-z0-9_-]{1,128}$/;
  return Object.freeze(
    value.map((row) => {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        !['direct', 'relayed'].includes(row.mode) ||
        !['unknown', 'submitted'].includes(row.outcome) ||
        (row.recipient !== undefined &&
          (typeof row.recipient !== 'string' ||
            !/^0x[0-9a-fA-F]{40}$/.test(row.recipient))) ||
        (row.transactionHash !== undefined &&
          (typeof row.transactionHash !== 'string' ||
            !hash.test(row.transactionHash))) ||
        (row.jobId !== undefined &&
          (typeof row.jobId !== 'string' || !jobId.test(row.jobId))) ||
        (row.transactionHashes !== undefined &&
          (!Array.isArray(row.transactionHashes) ||
            row.transactionHashes.length > 16 ||
            row.transactionHashes.some(
              (item: unknown) => typeof item !== 'string' || !hash.test(item)
            )))
      )
        throw new Error('privacy_withdrawal_invalid');
      return Object.freeze({
        mode: row.mode,
        outcome: row.outcome,
        ...(row.recipient !== undefined ? { recipient: row.recipient } : {}),
        ...(row.transactionHash !== undefined
          ? { transactionHash: row.transactionHash }
          : {}),
        ...(row.transactionHashes !== undefined
          ? { transactionHashes: Object.freeze([...row.transactionHashes]) }
          : {}),
        ...(row.jobId !== undefined ? { jobId: row.jobId } : {}),
      });
    })
  );
}
export interface IPrivacyWithdrawalReview {
  account: IPrivacyWithdrawalSession['context']['account'];
  amount: string;
  chainId: 1;
  expiresAt: number;
  feeWei: string;
  gasLimit: string;
  intentId: string;
  maxNetworkFeeWei: string;
  mode: 'direct' | 'relayed';
  noteId: string;
  poolAddress: string;
  poolId: PrivacyPoolId;
  previousWithdrawals?: readonly Readonly<IPrivacyWithdrawalPreviousAttempt>[];
  receiveWei: string;
  recipient: string;
  relayerEndpoint?: string;
  relayerId?: string;
  relayerName?: string;
  serviceFeeWei: string;
}
export interface IPrivacyWithdrawalSubmission
  extends IPrivacyWithdrawalAcknowledgement {
  intentId: string;
  noteId: string;
  phase: 'submitted' | 'unknown';
  signedTransactionHash?: string;
}
export interface IPrivacyWithdrawalStatus {
  claimedStatus?: PrivacyRelayerJobState;
  jobId?: string;
  mode?: 'direct' | 'relayed';
  noteId: string;
  phase: 'none' | 'unknown' | 'submitted';
  transactionHash?: string;
}
export interface IPrivacyRelayerChoice {
  feePercent?: string;
  health: 'unavailable' | 'reported-healthy' | 'reported-unhealthy';
  id: string;
  name: string;
  supportedPools: readonly PrivacyPoolId[];
}
export interface IPrivacyWithdrawalsHost {
  /** Consume durable unsigned evidence immediately before dispatch, under current custody. */
  beforeDispatch: (
    attempt: IPrivacyWithdrawalAttempt,
    approval: Readonly<IPrivacyWithdrawalSubmissionApproval>
  ) => Promise<void>;
  /** Durably reserve the attempt and return its synchronous final-submission fence. */
  beforeSubmission: (
    attempt: IPrivacyWithdrawalAttempt,
    approval: Readonly<IPrivacyWithdrawalSubmissionApproval>
  ) => Promise<() => void>;
  captureSession: (requireSigner?: boolean) => IPrivacyWithdrawalSession;
  /** Classify only owned submission-stage evidence, never provider error fields. */
  classifySubmissionFailure(
    error: unknown
  ): Readonly<IPrivacySubmissionFailure>;
  getSnapshot: (poolId: PrivacyPoolId) => Promise<IPrivacySnapshotAccess>;
  getWithdrawalAttempt: (
    noteId: string,
    session: IPrivacyWithdrawalSession
  ) => Promise<IPrivacyWithdrawalStatusRecord | null>;
  onProgress?: (progress: IPrivacyProofProgress) => void;
  prove: (
    request: IPrivacyWithdrawalRequest,
    options: IPrivacyWithdrawalPreparationOptions
  ) => Promise<IPrivacyProofResult>;
  /** Fixed gas 650000; quote only wallet fees, nonce and balance. No estimate/call containing the note. */
  quoteDirectFees: (
    session: IPrivacyWithdrawalSession
  ) => Promise<IPrivacyDepositFees>;
  /** Public gas-price observation only, never note-specific calldata. */
  quoteRelayerGasPrice: (session: IPrivacyWithdrawalSession) => Promise<string>;
  recordJobStatus: (
    noteId: string,
    attemptHash: string,
    acknowledgement: IPrivacyWithdrawalAcknowledgement,
    session: IPrivacyWithdrawalSession
  ) => Promise<void>;
  recordNotBroadcast: (attempt: IPrivacyWithdrawalAttempt) => Promise<void>;
  /** Must journal against the original attempt after an acknowledgement, even if the UI session changed. */
  recordSubmission: (
    attempt: IPrivacyWithdrawalAttempt,
    acknowledgement: IPrivacyWithdrawalAcknowledgement
  ) => Promise<void>;
  relayers: IPrivacyRelayerClient;
  sendTransaction: (
    transaction: IPrivacyWithdrawalTransaction,
    session: IPrivacyWithdrawalSession,
    onBroadcast: (acknowledgement: { hash: string }) => Promise<void>,
    assertCurrent: () => void,
    beforeDispatch: () => Promise<void>
  ) => Promise<{ hash: string }>;
  /** Decrypted note may exist only for this background callback and its proof worker. */
  withNote: <T>(
    noteId: string,
    session: IPrivacyWithdrawalSession,
    use: (
      note: string,
      poolId: PrivacyPoolId,
      history: Readonly<IPrivacyWithdrawalHistory>
    ) => Promise<T>
  ) => Promise<T>;
}
export interface IPrivacyWithdrawalsController {
  cancelPreparation: () => void;
  close: () => void;
  discardWithdrawal: (intentId: string) => Promise<void>;
  getRelayers: () => Promise<readonly IPrivacyRelayerChoice[]>;
  prepareWithdrawal: (
    request: IPrivacyWithdrawalPrepareRequest
  ) => Promise<IPrivacyWithdrawalReview>;
  statusByNote: (noteId: string) => Promise<IPrivacyWithdrawalStatus>;
  submitWithdrawal: (
    intentId: string,
    approval: Readonly<IPrivacyWithdrawalSubmitApproval>
  ) => Promise<IPrivacyWithdrawalSubmission>;
}
