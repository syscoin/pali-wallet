import type {
  IPrivacyDepositSession,
  PrivacyDepositTransaction,
} from './transactionTypes';
import type { PrivacyPoolId } from './types';
import type { IEvmTransactionContext } from '../evmTransactionContext';

export type IPrivacyWithdrawalSession = IPrivacyDepositSession;
export type IPrivacyWithdrawalTransaction = PrivacyDepositTransaction;
export const MAX_PRIVACY_RELAY_TRANSACTIONS = 16;
/** Public proof inputs retained only in encrypted custody and explicit backups. */
export interface IPrivacyWithdrawalPublicInputs {
  fee: string;
  nullifierHash: string;
  recipient: string;
  refund: '0';
  relayer: string;
  root: string;
}

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

export interface IPrivacyWithdrawalRecoveryReceipt {
  blockHash: string;
  /** Canonical decimal Ethereum block number. */
  blockNumber: string;
  kind?: 'relayed-proof-expired';
  root: string;
}

export interface IPrivacyWithdrawalRecovery
  extends IPrivacyWithdrawalRecoveryReceipt {
  recoveredAt: number;
}

/** Authenticated evidence that dispatch has not yet been entered. Never exported. */
export interface IPrivacyUnsignedWithdrawal {
  context: Omit<IEvmTransactionContext, 'sessionGeneration'>;
  lifetime: string;
  version: 1;
}

interface IPrivacyWithdrawalJournalFields {
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
  publicInputs?: IPrivacyWithdrawalPublicInputs;
  transactionHash?: string;
  transactionHashes?: readonly string[];
}

/** Inert local evidence retained when a recovered note starts a fresh attempt. */
export interface IPrivacyRetiredWithdrawal
  extends IPrivacyWithdrawalJournalFields {
  recovery: IPrivacyWithdrawalRecovery;
}

export interface IPrivacyWithdrawalJournal
  extends IPrivacyWithdrawalJournalFields {
  recovery?: IPrivacyWithdrawalRecovery;
  retired?: readonly IPrivacyRetiredWithdrawal[];
  unsigned?: IPrivacyUnsignedWithdrawal;
}

export interface IPrivacyWithdrawalStatusRecord
  extends Omit<IPrivacyWithdrawalJournal, 'unsigned'> {
  noteId: string;
  poolId: PrivacyPoolId;
}
