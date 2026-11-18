import type { IClassicNoteIdentity } from './note';
import type { PrivacyPoolId } from './types';
import type { WalletAuthentication } from '../../shared/walletAuthentication.ts';

export interface IPrivateNoteStatus {
  blockNumber?: number;
  phase: 'verified' | 'spent' | 'waiting' | 'not-found';
}

// This callback stays in the background. It never sends a note-specific RPC.
export type IPrivacyNoteReader = (
  identity: IClassicNoteIdentity
) => Promise<IPrivateNoteStatus>;

export interface IPrivateNoteView extends Omit<IPrivateNoteStatus, 'phase'> {
  amount: string;
  createdAt: number;
  id: string;
  phase: IPrivateNoteStatus['phase'] | 'prepared';
  poolId: PrivacyPoolId;
  restoration?: 'review-required' | 'reviewed' | 'withdrawal-pending';
  withdrawal?: {
    canCheckRecovery?: true;
    jobId?: string;
    mode: 'direct' | 'relayed';
    phase: 'unknown' | 'submitted';
    transactionHash?: string;
  };
}

export type PrivateVaultCapacity = 128 | 256 | 512;
export interface IPrivateArchivedNoteView {
  amount: string;
  archivedAt: number;
  createdAt: number;
  id: string;
  poolId: PrivacyPoolId;
}
export interface IPrivateVaultArchiveView {
  bundleLimitBytes: number;
  limit: number;
  notes: IPrivateArchivedNoteView[];
  storedBytes: number;
}

export interface IPrivateVaultCapacity {
  bundleLimitBytes: number;
  capacity: PrivateVaultCapacity;
  noteCount: number;
  storedBytes: number;
}

export interface IPrivateVaultView {
  archiveSummary?: Omit<IPrivateVaultArchiveView, 'notes'> & {
    noteCount: number;
  };
  notes: IPrivateNoteView[];
}

export interface IPrivateVaultController {
  clearArchive: (
    password: WalletAuthentication
  ) => Promise<{ removed: number }>;
  clearCompletedNotes: (
    ids: string[]
  ) => Promise<{ removed: string[]; unresolved: string[] }>;
  createDepositNote: (poolId: PrivacyPoolId) => Promise<IPrivateNoteView>;
  getArchivedNotes: () => Promise<IPrivateVaultArchiveView>;
  getCapacity: () => Promise<IPrivateVaultCapacity>;
  getNotes: (includeArchiveSummary?: boolean) => Promise<IPrivateVaultView>;
  importNote: (note: string) => Promise<IPrivateNoteView>;
  recoverFailedWithdrawal: (
    id: string,
    password: WalletAuthentication
  ) => Promise<void>;
  restoreArchivedNote: (
    id: string,
    password: WalletAuthentication
  ) => Promise<void>;
  revealNote: (id: string, password: WalletAuthentication) => Promise<string>;
  reviewRestoredNote: (
    id: string,
    password: WalletAuthentication
  ) => Promise<void>;
  setCapacity: (
    capacity: PrivateVaultCapacity
  ) => Promise<IPrivateVaultCapacity>;
}
