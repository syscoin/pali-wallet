import type { NativeSmartModuleDraft } from '../smartAccount/modules.ts';
import type { NativeSmartAccountIntent, NativeGuardianPolicyDraft } from '../smartAccount/operation.ts';
import type { NativeAssetTransferIntent } from './transferIntent.ts';
import type { NativeReplacementMode } from './transferRpc.ts';
import type { NativeUtxoAsset } from './utxoSend.ts';

export type NativeSmartLocalAction =
  | Readonly<{kind:'operation';intent:Exclude<NativeSmartAccountIntent,{kind:'guardian-policy' | 'authenticator' | 'modules' | 'dapp-call' | 'dapp-batch'}>}>
  | Readonly<{kind:'guardian-policy';draft:NativeGuardianPolicyDraft}>
  | Readonly<{kind:'wallet-authenticator'}>
  | Readonly<{kind:'modules';draft:NativeSmartModuleDraft}>
  | Readonly<{kind:'slh-installation';keyId:string}>;

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
  | Readonly<{ kind: 'external-psbt' }>
  | Readonly<{ kind: 'external-signing' }>
  | Readonly<{kind:'smart-operation'}>
  | Readonly<{
      kind: 'utxo';
      recipient: string;
      amount: string;
      max?: boolean;
      asset?: NativeUtxoAsset;
      rbf?: boolean;
    }>
);

export type NativeTrezorSnapshot = Readonly<{
  phase: 'idle' | 'opening' | 'waiting' | 'resume' | 'importing' | 'error';
  operation: 'import' | 'send' | 'utxo-send' | 'external-psbt' | 'external-signing' | 'smart-operation' | null;
  networkLabel: string;
  accountLabel: string;
  address: string | null;
  signer: Readonly<{ label: string; address: string; step: number; total: number }> | null;
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
  background(): void;
  cancel(): Promise<void>;
}
