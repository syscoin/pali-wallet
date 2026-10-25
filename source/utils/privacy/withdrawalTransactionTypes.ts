import type {
  IPrivacyDepositSession,
  PrivacyDepositTransaction,
} from './transactionTypes';
import type { PrivacyPoolId } from './types';

export type IPrivacyWithdrawalSession = IPrivacyDepositSession;
export type IPrivacyWithdrawalTransaction = PrivacyDepositTransaction;

interface IWithdrawalAttemptBase {
  context: IPrivacyWithdrawalSession['context'];
  createdAt: number;
  expiresAt: number;
  fee: string;
  intentId: string;
  noteId: string;
  nullifierHash: string;
  poolId: PrivacyPoolId;
  /** Kept only in background memory and encrypted custody; never in a UI review. */
  proof: string;
  recipient: string;
  refund: '0';
  relayer: string;
  root: string;
}

export type IPrivacyWithdrawalAttempt = Readonly<
  IWithdrawalAttemptBase &
    (
      | {
          mode: 'direct';
          transaction: IPrivacyWithdrawalTransaction;
        }
      | {
          endpoint: string;
          ensHash: string;
          mode: 'relayed';
          rewardAccount: string;
        }
    )
>;

export interface IPrivacyWithdrawalAcknowledgement {
  jobId?: string;
  transactionHash?: string;
}

export interface IPrivacyWithdrawalJournal {
  attemptHash: string;
  createdAt: number;
  endpoint?: string;
  ensHash?: string;
  from?: string;
  inputHash: string;
  intentId: string;
  jobId?: string;
  mode: 'direct' | 'relayed';
  nonce?: string;
  phase: 'unknown' | 'submitted';
  proofHash: string;
  transactionHash?: string;
}

export interface IPrivacyWithdrawalStatusRecord
  extends IPrivacyWithdrawalJournal {
  noteId: string;
  poolId: PrivacyPoolId;
}
