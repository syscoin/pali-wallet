import type { NativeAssetTransferIntent } from './transferIntent.ts';
import type { NativeReplacementMode } from './transferRpc.ts';
import type { NativeUtxoAsset } from './utxoSend.ts';

export type NativeTrezorResumeIntent = Readonly<{
  id: string;
  accountId: string;
  networkId: string;
}> & (
  | Readonly<{
      kind: 'evm';
      unsignedTransaction: string;
      intent?: NativeAssetTransferIntent;
      replacement?: Readonly<{
        mode: NativeReplacementMode;
        originalHash: string;
      }>;
    }>
  | Readonly<{
      kind: 'utxo';
      recipient: string;
      amount: string;
      max?: boolean;
      asset?: NativeUtxoAsset;
    }>
);

export type NativeTrezorSnapshot = Readonly<{
  phase: 'idle' | 'opening' | 'waiting' | 'resume' | 'importing' | 'error';
  operation: 'import' | 'send' | 'utxo-send' | null;
  networkLabel: string;
  accountLabel: string;
  address: string | null;
  error: string | null;
}>;

/** Public handoff state contains no session, device handle or signing capability. */
export interface NativeTrezorView {
  getSnapshot(): NativeTrezorSnapshot;
  subscribe(listener: () => void): () => void;
  startImport(label: string): Promise<void>;
  resumeImport(): Promise<void>;
  /** Returns a draft for a new normal review; never signs or broadcasts. */
  resumeSend(): Promise<NativeTrezorResumeIntent>;
  cancel(): Promise<void>;
}
