import type { IEvmTransactionContext } from '../evmTransactionContext';
import type { PrivacyPoolId } from './types';

export interface IPrivacyDepositSession {
  assertCurrent: () => void;
  context: IEvmTransactionContext;
}

export interface IPrivacyDepositCall {
  chainId: 1;
  data: string;
  from: string;
  to: string;
  value: string;
}

export interface IPrivacyDepositFees {
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce: string;
}

export type PrivacyDepositTransaction = Readonly<
  IPrivacyDepositCall & IPrivacyDepositFees
>;

export interface IPrivacyDepositAttempt {
  context: IEvmTransactionContext;
  createdAt: number;
  expiresAt: number;
  intentId: string;
  noteId: string;
  poolId: PrivacyPoolId;
  transaction: PrivacyDepositTransaction;
}

export interface IPrivacyDepositReview {
  account: IEvmTransactionContext['account'];
  amount: string;
  chainId: 1;
  createdAt: number;
  expiresAt: number;
  feeMode: 'eip1559' | 'legacy';
  gasLimit: string;
  gasPrice?: string;
  intentId: string;
  maxFeePerGas?: string;
  maxNetworkFeeWei: string;
  maxPriorityFeePerGas?: string;
  maxTotalWei: string;
  nonce: string;
  noteId: string;
  poolAddress: string;
  poolId: PrivacyPoolId;
  valueWei: string;
}

export interface IPrivacyDepositFailure {
  signedTransactionHash?: string;
  transactionNotBroadcast: boolean;
}

export interface IPrivacyDepositSubmission {
  intentId: string;
  noteId: string;
  phase: 'submitted' | 'unknown';
  signedTransactionHash?: string;
  transactionHash?: string;
}

export interface IPrivacyTransactionsHost {
  /** Durably reserve this intent and return its synchronous final-signing fence. */
  beforeSubmission: (attempt: IPrivacyDepositAttempt) => Promise<() => void>;
  /** Capture the active account/network/session; assertCurrent must fence ABA changes. */
  captureContext: () => IPrivacyDepositSession;
  /** Interpret only host-owned stage evidence; provider error fields are untrusted. */
  classifySubmissionFailure(error: unknown): Readonly<IPrivacyDepositFailure>;
  /** Read-only gas/fee/nonce/balance preflight against the captured provider. Never sign. */
  prepareFees: (
    transaction: Readonly<IPrivacyDepositCall>,
    session: IPrivacyDepositSession
  ) => Promise<IPrivacyDepositFees>;
  /** Return only an already-durable generated note eligible for its first deposit. */
  prepareNote: (
    poolId: PrivacyPoolId,
    noteId: string | undefined,
    session: IPrivacyDepositSession
  ) => Promise<{ id: string; poolId: PrivacyPoolId }>;
  /** This must journal against the original attempt, even after visible account changes. */
  recordBroadcast: (
    attempt: IPrivacyDepositAttempt,
    transactionHash: string
  ) => Promise<void>;
  /** Recover a matching reservation only after proven pre-broadcast failure. */
  recordNotBroadcast: (attempt: IPrivacyDepositAttempt) => Promise<void>;
  /** Assert the fence at final signing; record acknowledgments before later context checks. */
  sendTransaction: (
    transaction: PrivacyDepositTransaction,
    session: IPrivacyDepositSession,
    onBroadcast: (response: { hash: string }) => Promise<void>,
    assertBeforeSign: () => void
  ) => Promise<{ hash: string }>;
  /** The implementation reads/decrypts locally; only the commitment enters this callback. */
  withCommitment: <T>(
    noteId: string,
    session: IPrivacyDepositSession,
    use: (commitment: string) => T
  ) => Promise<T>;
}

export interface IPrivacyTransactionsController {
  close: () => void;
  discardDeposit: (intentId: string) => Promise<void>;
  prepareDeposit: (request: {
    noteId?: string;
    poolId: PrivacyPoolId;
  }) => Promise<IPrivacyDepositReview>;
  submitDeposit: (intentId: string) => Promise<IPrivacyDepositSubmission>;
}
