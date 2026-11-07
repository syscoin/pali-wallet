import { Interface } from 'ethers/abi';
import { getAddress } from 'ethers/address';

import { normalizeNftTokenId } from '../utils/nftTokenId.ts';

import { createErc20Policy, parseErc20Units } from './erc20.ts';
import type { Transaction } from 'ethers/transaction';

/** A single item and exact integer amount, without provider names or artwork. */
export type NftTransferIntent = Readonly<{
  amountUnits: string;
  chainId: string;
  contractAddress: string;
  from: string;
  kind: 'nft-transfer';
  recipient: string;
  tokenId: string;
  tokenStandard: 'ERC-721' | 'ERC-1155';
}>;

const fields = [
  'kind',
  'chainId',
  'from',
  'contractAddress',
  'recipient',
  'tokenStandard',
  'tokenId',
  'amountUnits',
] as const;
const erc721Method = 'transferFrom(address,address,uint256)';
const erc1155Method = 'safeTransferFrom(address,address,uint256,uint256,bytes)';
const abi = new Interface([
  `function ${erc721Method}`,
  `function ${erc1155Method}`,
]);
const { normalizeNonzeroHexAddress } = createErc20Policy(getAddress);
const invalid = (): never => {
  throw new Error('Invalid NFT transfer');
};

function record(value: unknown): object {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return invalid();
  return value;
}

function own(value: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
    return invalid();
  return descriptor.value;
}

export function snapshotNftTransferIntent(value: unknown): NftTransferIntent {
  const input = record(value);
  if (
    Reflect.ownKeys(input).length !== fields.length ||
    own(input, 'kind') !== 'nft-transfer'
  )
    return invalid();
  const chainId = own(input, 'chainId');
  const tokenStandard = own(input, 'tokenStandard');
  const tokenId = own(input, 'tokenId');
  const units = own(input, 'amountUnits');
  if (
    typeof chainId !== 'string' ||
    !/^[1-9][0-9]{0,15}$/.test(chainId) ||
    BigInt(chainId) > BigInt(Number.MAX_SAFE_INTEGER) ||
    (tokenStandard !== 'ERC-721' && tokenStandard !== 'ERC-1155') ||
    typeof tokenId !== 'string' ||
    typeof units !== 'string'
  )
    return invalid();
  const amountUnits = parseErc20Units(units);
  if (
    amountUnits === '0' ||
    (tokenStandard === 'ERC-721' && amountUnits !== '1')
  )
    return invalid();
  return Object.freeze({
    kind: 'nft-transfer',
    chainId,
    from: normalizeNonzeroHexAddress(own(input, 'from')),
    contractAddress: normalizeNonzeroHexAddress(own(input, 'contractAddress')),
    recipient: normalizeNonzeroHexAddress(own(input, 'recipient')),
    tokenStandard,
    tokenId: normalizeNftTokenId(tokenId),
    amountUnits,
  });
}

/** Encode a validated intent with the published keyring's ordinary software-wallet selectors. */
export function encodeNftTransferData(intent: NftTransferIntent): string {
  const args = [intent.from, intent.recipient, intent.tokenId];
  return intent.tokenStandard === 'ERC-721'
    ? abi.encodeFunctionData(erc721Method, args)
    : abi.encodeFunctionData(erc1155Method, [
        ...args,
        intent.amountUnits,
        '0x',
      ]);
}

type RetainedNftContext = Readonly<{
  chainId: string;
  from: string;
  hash: string;
  nonce: number;
  operation: string;
  rawTransaction: string;
}>;

export function isRetainedNftReplayEnvelope(
  tx: Pick<Transaction, 'type' | 'accessList'>
): boolean {
  return (tx.type === 0 || tx.type === 2) && !tx.accessList?.length;
}

/** Decode the canonical wallet transfer call shared by review and retained-byte verification. */
export function decodeNftTransferData(
  data: string,
  context: Pick<
    NftTransferIntent,
    'chainId' | 'from' | 'contractAddress' | 'tokenStandard'
  >
): NftTransferIntent | undefined {
  try {
    const isErc721 = context.tokenStandard === 'ERC-721';
    if (!isErc721 && context.tokenStandard !== 'ERC-1155') return undefined;
    const method = isErc721 ? erc721Method : erc1155Method;
    // Three static words, or five head words and one zero-length bytes tail.
    if (data.length !== 2 + 2 * (4 + (isErc721 ? 3 : 6) * 32)) return undefined;
    const from = normalizeNonzeroHexAddress(context.from);
    const decoded = abi.decodeFunctionData(method, data);
    if (decoded[0] !== from || (!isErc721 && decoded[4] !== '0x'))
      return undefined;
    const intent = snapshotNftTransferIntent({
      kind: 'nft-transfer',
      chainId: context.chainId,
      from,
      contractAddress: context.contractAddress,
      recipient: decoded[1],
      tokenStandard: context.tokenStandard,
      tokenId: decoded[2].toString(),
      amountUnits: isErc721 ? '1' : decoded[3].toString(),
    });
    return encodeNftTransferData(intent) === data ? intent : undefined;
  } catch {
    return undefined;
  }
}

/** Derive typed intent from authenticated retained bytes and operation. */
export function decodeRetainedNftTransfer(
  entry: RetainedNftContext,
  tx: Transaction
): NftTransferIntent | undefined {
  if (entry.operation !== 'erc721' && entry.operation !== 'erc1155')
    return undefined;
  try {
    if (
      !tx.to ||
      tx.value !== BigInt(0) ||
      !tx.isSigned() ||
      tx.serialized !== entry.rawTransaction ||
      tx.hash !== entry.hash ||
      tx.nonce !== entry.nonce ||
      tx.chainId.toString() !== entry.chainId
    )
      return undefined;
    const from = tx.from;
    if (!from || from.toLowerCase() !== entry.from) return undefined;
    return decodeNftTransferData(tx.data, {
      chainId: entry.chainId,
      from,
      contractAddress: tx.to,
      tokenStandard: entry.operation === 'erc721' ? 'ERC-721' : 'ERC-1155',
    });
  } catch {
    return undefined;
  }
}
