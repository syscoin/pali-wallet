import { Interface } from 'ethers/abi';
import { getAddress } from 'ethers/address';

import type { ApprovalContractMetadata } from './approval.ts';
import type { IDecodedTx } from '../types/transactions';

const abi = new Interface([
  'function transfer(address to,uint256 amount)',
  'function transferFrom(address from,address to,uint256 amount)',
  'function safeTransferFrom(address from,address to,uint256 tokenId)',
  'function safeTransferFrom(address from,address to,uint256 tokenId,bytes data)',
  'function safeTransferFrom(address from,address to,uint256 tokenId,uint256 amount,bytes data)',
  'function safeBatchTransferFrom(address from,address to,uint256[] ids,uint256[] amounts,bytes data)',
]);
const selectors = new Set(
  abi.fragments
    .filter((fragment) => fragment.type === 'function')
    .map((fragment) => abi.getFunction(fragment.format())!.selector)
);
export type AssetTransferCall = Readonly<{
  contract: string;
  decoded: IDecodedTx;
  from: string | null;
  items: readonly Readonly<{ tokenId: string | null; units: string }>[];
  method: string;
  recipient: string;
  standard: 'ERC-20' | 'ERC-721' | 'ERC-1155' | 'Unknown';
  standardVerified: boolean;
  token:
    | Extract<ApprovalContractMetadata, { standard: 'ERC-20' }>['token']
    | null;
}>;

/** Describe canonical known calldata, never infer a contract's behavior from its selector. */
export function decodeAssetTransfer(
  data: unknown,
  contract: unknown,
  metadata?: ApprovalContractMetadata
): AssetTransferCall | null {
  if (
    typeof data !== 'string' ||
    data.length > 131074 ||
    !/^0x(?:[\da-fA-F]{2})+$/.test(data) ||
    !selectors.has(data.slice(0, 10).toLowerCase()) ||
    typeof contract !== 'string'
  )
    return null;
  try {
    const address = getAddress(contract);
    const call = abi.parseTransaction({ data });
    if (
      !call ||
      abi.encodeFunctionData(call.fragment, call.args).toLowerCase() !==
        data.toLowerCase()
    )
      return null;
    const simple = call.name === 'transfer';
    const from = simple ? null : getAddress(call.args[0]);
    const recipient = getAddress(call.args[simple ? 0 : 1]);
    const nft721 = call.name === 'safeTransferFrom' && call.args.length < 5;
    const nft1155 =
      call.name === 'safeBatchTransferFrom' || call.args.length === 5;
    const standard = nft1155
      ? 'ERC-1155'
      : nft721
      ? 'ERC-721'
      : metadata?.standard ?? 'Unknown';
    if (
      (simple && metadata && metadata.standard !== 'ERC-20') ||
      (nft721 && metadata && metadata.standard !== 'ERC-721') ||
      (nft1155 && metadata && metadata.standard !== 'ERC-1155') ||
      (!nft721 && !nft1155 && metadata?.standard === 'ERC-1155')
    )
      return decodeAssetTransfer(data, contract);
    if (
      metadata?.standard === 'ERC-20' &&
      getAddress(metadata.token.contractAddress) !== address
    )
      return decodeAssetTransfer(data, contract);
    if (
      call.name === 'safeBatchTransferFrom' &&
      (call.args[2].length < 1 ||
        call.args[2].length > 128 ||
        call.args[3].length !== call.args[2].length)
    )
      return null;
    const items =
      call.name === 'safeBatchTransferFrom'
        ? Array.from(call.args[2] as readonly bigint[], (id, index) => ({
            tokenId: id.toString(),
            units: call.args[3][index]?.toString(),
          }))
        : [
            {
              tokenId:
                standard === 'ERC-721' || nft1155
                  ? call.args[2].toString()
                  : null,
              units:
                standard === 'ERC-721'
                  ? '1'
                  : call.args[nft1155 ? 3 : simple ? 1 : 2].toString(),
            },
          ];
    if (
      !items.length ||
      items.length > 128 ||
      (call.name === 'safeBatchTransferFrom' &&
        call.args[3].length !== items.length) ||
      items.some(
        (item) => typeof item.units !== 'string' || !/^\d+$/.test(item.units)
      )
    )
      return null;
    const scalar = (value: any): any =>
      typeof value === 'bigint'
        ? value.toString()
        : Array.isArray(value)
        ? value.map(scalar)
        : value;
    const decoded = {
      method: call.name,
      types: call.fragment.inputs.map((input) => input.type),
      names: call.fragment.inputs.map((input) => input.name),
      inputs: Array.from(call.args, scalar),
    };
    return Object.freeze({
      decoded,
      contract: address,
      recipient,
      from,
      method: call.name,
      standard,
      standardVerified: metadata?.standard === standard,
      items: Object.freeze(items.map((item) => Object.freeze(item))),
      token: metadata?.standard === 'ERC-20' ? metadata.token : null,
    });
  } catch {
    return null;
  }
}
