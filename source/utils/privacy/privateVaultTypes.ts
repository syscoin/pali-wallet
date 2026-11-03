import type { IClassicNoteIdentity } from './note';
import type { PrivacyPoolId } from './types';

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
  withdrawal?: {
    jobId?: string;
    mode: 'direct' | 'relayed';
    phase: 'unknown' | 'submitted';
    transactionHash?: string;
  };
}

export type PrivateVaultCapacity = 128 | 256 | 512;

export interface IPrivateVaultCapacity {
  capacity: PrivateVaultCapacity;
  noteCount: number;
  bundleLimitBytes: number;
  storedBytes: number;
}

export interface IPrivateVaultView {
  notes: IPrivateNoteView[];
}

export interface IPrivateVaultController {
  clearCompletedNotes: (
    ids: string[]
  ) => Promise<{ removed: string[]; unresolved: string[] }>;
  createDepositNote: (poolId: PrivacyPoolId) => Promise<IPrivateNoteView>;
  getNotes: () => Promise<IPrivateVaultView>;
  getCapacity: () => Promise<IPrivateVaultCapacity>;
  setCapacity: (
    capacity: PrivateVaultCapacity
  ) => Promise<IPrivateVaultCapacity>;
  importNote: (note: string) => Promise<IPrivateNoteView>;
  revealNote: (id: string, password: string) => Promise<string>;
}
