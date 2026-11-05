import type { EvmSignedPhase } from '../../../../source/wallet/evmSignedRecords.ts';
import type { Erc20TransferIntent } from './transferIntent.ts';

/** Native screen DTO. Persistence and retention belong to the shared signed-record policy. */
export type TransferJournalPhase = EvmSignedPhase;
export type TransferJournalScope = Readonly<{ walletFingerprint: string; address: string; chainId: string }>;
export type TransferJournalEntry = Readonly<{
  version: 1;
  scope: TransferJournalScope;
  phase: TransferJournalPhase;
  rawTransaction: string;
  hash: string;
  nonce: number;
  createdAt: number;
  intent?: Erc20TransferIntent;
}>;

/** Host-facing classification; the shared store supplies all persistence decisions. */
export class TransferJournalError extends Error {
  readonly code: 'CORRUPT' | 'CONTEXT_CHANGED' | 'PENDING_TRANSFER' | 'INVALID_TRANSITION' | 'CAPACITY' | 'CONFLICT' | 'REOPEN_REQUIRED' | 'HISTORY_UNAVAILABLE';
  constructor(code: TransferJournalError['code']) { super(code); this.name = 'TransferJournalError'; this.code = code; }
}
