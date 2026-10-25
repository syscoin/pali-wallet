import type { IPrivacyProofProgress, IPrivacyProofResult } from './proverTypes';
import type { IPrivacyRelayerClient } from './relayers';
import type { PrivacyRelayerJobState } from './relayJobs';
import type { IPrivacyDepositFees } from './transactionTypes';
import type { IPrivacySnapshotAccess } from './trustedSnapshot';
import type { PrivacyPoolId } from './types';
import type {
  IPrivacyWithdrawalOptions,
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
  beforeSubmission: (attempt: IPrivacyWithdrawalAttempt) => Promise<void>;
  captureSession: () => IPrivacyWithdrawalSession;
  getSnapshot: (poolId: PrivacyPoolId) => Promise<IPrivacySnapshotAccess>;
  getWithdrawalAttempt: (
    noteId: string,
    session: IPrivacyWithdrawalSession
  ) => Promise<IPrivacyWithdrawalStatusRecord | null>;
  onProgress?: (progress: IPrivacyProofProgress) => void;
  prove?: (
    request: IPrivacyWithdrawalRequest,
    options: IPrivacyWithdrawalOptions
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
  recordNotBroadcast?: (attempt: IPrivacyWithdrawalAttempt) => Promise<void>;
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
    assertCurrent: () => void
  ) => Promise<{ hash: string }>;
  /** Decrypted note may exist only for this background callback and its proof worker. */
  withNote: <T>(
    noteId: string,
    session: IPrivacyWithdrawalSession,
    use: (note: string, poolId: PrivacyPoolId) => Promise<T>
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
  submitWithdrawal: (intentId: string) => Promise<IPrivacyWithdrawalSubmission>;
}
