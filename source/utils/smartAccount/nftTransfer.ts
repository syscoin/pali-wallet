import {
  encodeNftSafeTransferData,
  snapshotNftTransferIntent,
  type NftTransferIntent,
} from '../../shared/nftTransfer.ts';

/** The Smart-account transfer selectors shared by both wallet hosts. */
export function buildSmartAccountNftTransfer(value: NftTransferIntent) {
  const intent = snapshotNftTransferIntent(value);
  return Object.freeze({
    target: intent.contractAddress,
    value: '0x0',
    data: encodeNftSafeTransferData(intent),
  });
}
