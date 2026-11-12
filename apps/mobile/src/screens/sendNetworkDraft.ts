import { normalizePublicAddress } from '../core/addresses.ts';
import { normalizeUtxoAddress } from '../core/utxoAddresses.ts';
import type { UtxoNetwork } from '../core/utxoNetworks.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';
import { snapshotUtxoRbf } from '../../../../source/shared/utxoTransactionOptions.ts';
import type { EvmFeeChoice, UtxoFeeChoice } from '../../../../source/shared/transactionFeeChoice.ts';

/** Form text only. Reviews, credentials, resolutions and signed bytes never travel with it. */
export type NativeUnsignedSendDraft = Readonly<{
  kind: 'evm'; recipient: string; amount: string; nonce: string; tokenId?: string; max: boolean; advanced: boolean; feeChoice?: EvmFeeChoice;
}> | Readonly<{
  kind: 'utxo'; recipient: string; amount: string; max: boolean; rbf: boolean; feeChoice?: UtxoFeeChoice;
}>;

export const NETWORK_CHANGED_DRAFT_NOTICE = 'Network changed. Check the recipient and enter the amount again. Asset selection, MAX and advanced transaction settings were reset.';

/** Only an address validated for the selected network survives an actual network change. */
export function sendDraftForNetwork(draft: NativeUnsignedSendDraft, target: NativeNetworkRegistration | UtxoNetwork): NativeUnsignedSendDraft {
  let recipient = '';
  const utxo = 'addressNetwork' in target;
  if (utxo && draft.kind === 'utxo') {
    try { recipient = normalizeUtxoAddress(draft.recipient, target); } catch { /* Select the recipient again. */ }
  } else if (!utxo && draft.kind === 'evm') {
    try { recipient = normalizePublicAddress(draft.recipient, target.id); } catch { /* Names must be resolved again on their supported network. */ }
  }
  return Object.freeze(utxo
    ? { kind: 'utxo', recipient, amount: '', max: false, rbf: snapshotUtxoRbf(undefined) }
    : { kind: 'evm', recipient, amount: '', nonce: '', max: false, advanced: false });
}
