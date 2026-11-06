import {
  snapshotNftTransferIntent,
  type NftTransferIntent,
} from '../../../../source/shared/nftTransfer.ts';
import {
  snapshotSavedCollectible,
  type SavedCollectible,
} from '../portfolio/tokenRegistry.ts';
import { EvmTransferReadError, readOwnData, rejectRead } from './evmFeeContracts.ts';
import {
  snapshotNativeNetwork,
  type NativeNetworkRegistration,
} from './networkContext.ts';

export type NftTransferSelection = Readonly<{
  network: NativeNetworkRegistration;
  owner: string;
  saved: SavedCollectible;
}>;
export type NftTransferRequest = Readonly<{
  recipient: string;
  tokenId: string;
  amountUnits: string;
}>;

/** Retire protected reads promptly when either the transfer or inventory changes. */
export async function withNftInventorySignal<T>(
  signal: AbortSignal,
  inventory: AbortSignal,
  read: (owned: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const retire = () => controller.abort();
  signal.addEventListener('abort', retire, { once: true });
  inventory.addEventListener('abort', retire, { once: true });
  if (signal.aborted || inventory.aborted) retire();
  try {
    return await read(controller.signal);
  } finally {
    signal.removeEventListener('abort', retire);
    inventory.removeEventListener('abort', retire);
  }
}

/** Capture a reviewed item from the caller's current account inventory. */
export function snapshotNftTransferSelection(
  selection: NftTransferSelection,
  request: NftTransferRequest,
  network: NativeNetworkRegistration
): NftTransferIntent {
  const selected = readOwnData(selection, ['network', 'owner', 'saved']);
  const requested = readOwnData(request, ['recipient', 'tokenId', 'amountUnits']);
  try {
    if (
      snapshotNativeNetwork(selected.network).registrationHash !==
      network.registrationHash
    )
      return rejectRead('PROFILE_CHANGED');
    const saved = snapshotSavedCollectible(selected.saved);
    const intent = snapshotNftTransferIntent({
      kind: 'nft-transfer',
      chainId: network.chainId,
      from: selected.owner,
      contractAddress: saved.contractAddress,
      tokenStandard: saved.tokenStandard,
      recipient: requested.recipient,
      tokenId: requested.tokenId,
      amountUnits: requested.amountUnits,
    });
    if (saved.tokenStandard === 'ERC-1155' && saved.tokenId !== intent.tokenId)
      return rejectRead('INVALID_INPUT');
    return intent;
  } catch (error) {
    if (error instanceof EvmTransferReadError) throw error;
    return rejectRead('INVALID_INPUT');
  }
}
