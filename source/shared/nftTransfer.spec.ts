/** @jest-environment node */
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import {
  decodeNftTransferData,
  decodeRetainedNftTransfer,
  encodeNftTransferData,
  snapshotNftTransferIntent,
} from './nftTransfer';

const signer = new Wallet('0x' + '1'.padStart(64, '0'));
const contract = '0x' + '22'.repeat(20);
const recipient = '0x' + '33'.repeat(20);
const intentFor = (tokenStandard: 'ERC-721' | 'ERC-1155') =>
  snapshotNftTransferIntent({
    kind: 'nft-transfer',
    chainId: '57',
    from: signer.address,
    contractAddress: contract,
    recipient,
    tokenStandard,
    tokenId: ((BigInt(1) << BigInt(256)) - BigInt(1)).toString(),
    amountUnits: tokenStandard === 'ERC-721' ? '1' : '4',
  });

it.each(['ERC-721', 'ERC-1155'] as const)(
  'decodes the exact canonical %s call and rejects altered bytes or sender',
  (standard) => {
    const intent = intentFor(standard);
    const data = encodeNftTransferData(intent);
    expect(decodeNftTransferData(data, intent)).toEqual(intent);
    expect(decodeNftTransferData(data + '00', intent)).toBeUndefined();
    expect(
      decodeNftTransferData('0x00000000' + data.slice(10), intent)
    ).toBeUndefined();
    expect(
      decodeNftTransferData(data, { ...intent, from: recipient })
    ).toBeUndefined();
    expect(
      decodeNftTransferData(data, { ...intent, chainId: '0' })
    ).toBeUndefined();
  }
);
it('rejects a noncanonical ERC1155 dynamic-data offset', () => {
  const intent = intentFor('ERC-1155');
  const data = encodeNftTransferData(intent);
  const offsetStart = 10 + 4 * 64;
  const altered =
    data.slice(0, offsetStart) + '0'.repeat(64) + data.slice(offsetStart + 64);
  expect(decodeNftTransferData(altered, intent)).toBeUndefined();
});
it.each(['ERC-721', 'ERC-1155'] as const)(
  'keeps retained %s signature and record identity checks around the common decoder',
  async (standard) => {
    const intent = intentFor(standard);
    const raw = await signer.signTransaction({
      type: 2,
      chainId: 57,
      nonce: 7,
      to: contract,
      value: 0,
      data: encodeNftTransferData(intent),
      gasLimit: 50000,
      maxFeePerGas: 3,
      maxPriorityFeePerGas: 1,
    });
    const tx = Transaction.from(raw);
    const entry = {
      chainId: '57',
      from: signer.address.toLowerCase(),
      hash: tx.hash!,
      nonce: 7,
      operation: standard === 'ERC-721' ? 'erc721' : 'erc1155',
      rawTransaction: raw,
    };
    expect(decodeRetainedNftTransfer(entry, tx)).toEqual(intent);
    for (const change of [
      { hash: '0x' + '44'.repeat(32) },
      { rawTransaction: raw + '00' },
      { nonce: 8 },
      { chainId: '1' },
      { from: recipient },
    ])
      expect(
        decodeRetainedNftTransfer({ ...entry, ...change }, tx)
      ).toBeUndefined();
  }
);
