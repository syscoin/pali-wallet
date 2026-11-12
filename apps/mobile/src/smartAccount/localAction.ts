import { snapshotNativeSmartModuleDraft } from './modules.ts';
import { getAddress } from 'ethers/address';
import { createErc20Policy, parseErc20Units } from '../../../../source/shared/erc20.ts';
import { snapshotNftTransferIntent } from '../../../../source/shared/nftTransfer.ts';
import { snapshotEvmFeeChoice } from '../../../../source/shared/transactionFeeChoice.ts';
import type { NativeSmartLocalAction } from '../custody/trezorAccounts.ts';

const { parseMetadata } = createErc20Policy(getAddress);
const invalid = (): never => { throw new Error('Invalid public Smart account action'); };

/** Copy only the public action DTO. The original builders revalidate policy and custody on return. */
export function snapshotNativeSmartLocalAction(action: NativeSmartLocalAction): NativeSmartLocalAction {
  if (!action || typeof action !== 'object') return invalid();
  if (action.kind === 'modules') return Object.freeze({ kind: action.kind, draft: snapshotNativeSmartModuleDraft(action.draft) });
  if (action.kind === 'wallet-authenticator') return Object.freeze({ kind: action.kind });
  if (action.kind === 'passkey-authenticator') {
    if (!/^0x[0-9a-f]{64}$/i.test(action.credentialIdHash)) return invalid();
    return Object.freeze({ kind: action.kind, credentialIdHash: action.credentialIdHash.toLowerCase() });
  }
  if (action.kind === 'slh-installation') {
    if (typeof action.keyId !== 'string' || !action.keyId || action.keyId.length > 256) return invalid();
    return Object.freeze({ kind: action.kind, keyId: action.keyId });
  }
  if (action.kind === 'guardian-policy') {
    const draft = action.draft;
    if (!draft || typeof draft !== 'object' || (draft.acknowledgedPendingOperationId !== null && typeof draft.acknowledgedPendingOperationId !== 'string')) return invalid();
    const acknowledgedPendingOperationId = draft.acknowledgedPendingOperationId;
    if (draft.action === 'remove' && draft.recoveryLossAcknowledged === true)
      return Object.freeze({ kind: action.kind, draft: Object.freeze({ action: 'remove', recoveryLossAcknowledged: true, acknowledgedPendingOperationId }) });
    if (draft.action === 'set' && Number.isSafeInteger(draft.delaySeconds) && draft.delaySeconds > 0)
      return Object.freeze({ kind: action.kind, draft: Object.freeze({ action: 'set', guardian: getAddress(draft.guardian), delaySeconds: draft.delaySeconds, acknowledgedPendingOperationId }) });
    return invalid();
  }
  if (action.kind !== 'operation' || !action.intent) return invalid();
  const intent = action.intent;
  const choice = intent.feeChoice === undefined ? undefined : snapshotEvmFeeChoice(intent.feeChoice);
  if (choice && (choice.kind !== 'custom' || choice.gasLimit !== undefined)) return invalid();
  const fees = choice ? { feeChoice: choice } : {};
  if (intent.kind === 'deploy') return Object.freeze({ kind: action.kind, intent: Object.freeze({ kind: intent.kind }) });
  if (intent.kind === 'native-max')
    return Object.freeze({ kind: action.kind, intent: Object.freeze({ kind: intent.kind, recipient: getAddress(intent.recipient), ...fees }) });
  if (intent.kind === 'native-transfer')
    return Object.freeze({ kind: action.kind, intent: Object.freeze({ kind: intent.kind, recipient: getAddress(intent.recipient), amountUnits: parseErc20Units(intent.amountUnits), ...fees }) });
  if (intent.kind === 'erc20-transfer')
    return Object.freeze({ kind: action.kind, intent: Object.freeze({ kind: intent.kind, recipient: getAddress(intent.recipient), amountUnits: parseErc20Units(intent.amountUnits), token: parseMetadata(intent.token), ...fees }) });
  if (intent.kind === 'nft-transfer') {
    const { feeChoice: _choice, ...transfer } = intent;
    return Object.freeze({ kind: action.kind, intent: Object.freeze({ ...snapshotNftTransferIntent(transfer), ...fees }) });
  }
  return invalid();
}
