import { Interface } from 'ethers/abi';
import { buildSmartAccountNftTransfer } from './nftTransfer';
import {
  decodeNftSafeTransferData,
  decodeNftTransferData,
  encodeNftTransferData,
  type NftTransferIntent,
} from '../../shared/nftTransfer';
const from = '0x1111111111111111111111111111111111111111';
const to = '0x2222222222222222222222222222222222222222';
const contract = '0x3333333333333333333333333333333333333333';
const abi = new Interface([
  'function safeTransferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256,uint256,bytes)',
]);
function intent(
  tokenStandard: NftTransferIntent['tokenStandard']
): NftTransferIntent {
  return {
    kind: 'nft-transfer',
    chainId: '1',
    from,
    recipient: to,
    contractAddress: contract,
    tokenStandard,
    tokenId: ((BigInt(1) << BigInt(256)) - BigInt(1)).toString(),
    amountUnits: tokenStandard === 'ERC-721' ? '1' : '900719925474099312345',
  };
}
it.each(['ERC-721', 'ERC-1155'] as const)(
  'shares exact %s Smart selectors and preserves ordinary EOA encoding',
  (standard) => {
    const transfer = intent(standard),
      execution = buildSmartAccountNftTransfer(transfer);
    const data =
      standard === 'ERC-721'
        ? abi.encodeFunctionData('safeTransferFrom(address,address,uint256)', [
            from,
            to,
            transfer.tokenId,
          ])
        : abi.encodeFunctionData(
            'safeTransferFrom(address,address,uint256,uint256,bytes)',
            [from, to, transfer.tokenId, transfer.amountUnits, '0x']
          );
    expect(execution).toEqual({ target: contract, data, value: '0x0' });
    expect(decodeNftSafeTransferData(data, transfer)).toEqual(transfer);
    if (standard === 'ERC-721') {
      expect(encodeNftTransferData(transfer).slice(0, 10)).toBe('0x23b872dd');
      expect(decodeNftTransferData(data, transfer)).toBeUndefined();
    }
    expect(
      decodeNftSafeTransferData(data, { ...transfer, from: to })
    ).toBeUndefined();
  }
);
it('requires exact positive quantities and valid identifiers before encoding', () => {
  expect(() =>
    buildSmartAccountNftTransfer({ ...intent('ERC-721'), amountUnits: '2' })
  ).toThrow();
  expect(() =>
    buildSmartAccountNftTransfer({ ...intent('ERC-1155'), amountUnits: '0' })
  ).toThrow();
  expect(() =>
    buildSmartAccountNftTransfer({
      ...intent('ERC-1155'),
      tokenId: (BigInt(1) << BigInt(256)).toString(),
    })
  ).toThrow();
});
