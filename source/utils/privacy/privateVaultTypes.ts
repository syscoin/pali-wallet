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

export interface IPrivateNoteView extends IPrivateNoteStatus {
  amount: string;
  createdAt: number;
  id: string;
  poolId: PrivacyPoolId;
}

export interface IPrivateVaultView {
  notes: IPrivateNoteView[];
}

export interface IPrivateVaultController {
  getNotes: () => Promise<IPrivateVaultView>;
  importNote: (note: string) => Promise<IPrivateNoteView>;
  revealNote: (id: string, password: string) => Promise<string>;
}
