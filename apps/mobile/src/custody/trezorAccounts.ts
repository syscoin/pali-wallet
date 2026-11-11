import type { NativeSmartModuleDraft } from '../smartAccount/modules.ts';
import type { NativeSmartAccountIntent, NativeGuardianPolicyDraft } from '../smartAccount/operation.ts';
import type { NativeAssetTransferIntent } from './transferIntent.ts';
import type { NativeReplacementMode } from './transferRpc.ts';
import type { NativeUtxoAsset } from './utxoSend.ts';
import { PALI_INFRASTRUCTURE_METADATA_BY_ID, type PaliInfrastructureContractId } from '../../../../source/utils/smartAccount/deploymentMetadata.ts';
import { DAPP_REQUEST_LIMITS } from '../../../../source/utils/requestPayloadBudget.ts';

export type NativeInfrastructureLocalAction = Readonly<{
  kind: 'infrastructure'; contractId: PaliInfrastructureContractId; attemptId: string; unsignedTransaction: string;
}>;

/** Public correlation only; the owned continuation must independently match every byte. */
export function snapshotNativeInfrastructureLocalAction(action: NativeInfrastructureLocalAction): NativeInfrastructureLocalAction {
  const invalid = (): never => { throw new Error('Invalid infrastructure continuation'); };
  if (!action || typeof action !== 'object' || Array.isArray(action)) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(action);
  if (Object.keys(descriptors).sort().join() !== 'attemptId,contractId,kind,unsignedTransaction' ||
      Object.values(descriptors).some(value => !('value' in value))) return invalid();
  const kind = descriptors.kind!.value, contractId = descriptors.contractId!.value;
  const attemptId = descriptors.attemptId!.value, unsignedTransaction = descriptors.unsignedTransaction!.value;
  if (kind !== 'infrastructure' || typeof contractId !== 'string' || !Object.hasOwn(PALI_INFRASTRUCTURE_METADATA_BY_ID, contractId) ||
      typeof attemptId !== 'string' || !/^0x[0-9a-f]{64}$/.test(attemptId) ||
      typeof unsignedTransaction !== 'string' || unsignedTransaction.length > DAPP_REQUEST_LIMITS.bytes ||
      !/^0x(?:[0-9a-f]{2})+$/.test(unsignedTransaction)) return invalid();
  return Object.freeze({ kind, contractId: contractId as PaliInfrastructureContractId, attemptId, unsignedTransaction });
}

export type NativeSmartLocalAction =
  | Readonly<{kind:'operation';intent:Exclude<NativeSmartAccountIntent,{kind:'guardian-policy' | 'authenticator' | 'modules' | 'dapp-call' | 'dapp-batch'}>}>
  | Readonly<{kind:'guardian-policy';draft:NativeGuardianPolicyDraft}>
  | Readonly<{kind:'wallet-authenticator'}>
  | Readonly<{kind:'passkey-authenticator';credentialIdHash:string}>
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
  | Readonly<{kind:'infrastructure'}>
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
  operation: 'import' | 'send' | 'utxo-send' | 'external-psbt' | 'external-signing' | 'smart-operation' | 'infrastructure' | null;
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
