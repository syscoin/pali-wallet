import { getAddress } from 'ethers/address';

import {
  normalizeNftExecutionRevert,
  verifyERC1155OwnershipHelper,
  verifyERC721OwnershipHelper,
} from '../scripts/Background/controllers/assets/nft-utils.ts';
import { normalizeNftTokenId } from '../utils/nftTokenId.ts';

import { decodeErc20Transfer, parseErc20Units } from './erc20.ts';
import { snapshotEvmFeeEnvelope } from './evmFeeApproval.ts';
import type { EvmFeeEnvelope } from './evmFeeApproval.ts';
import { decodeNftTransferData } from './nftTransfer.ts';

export type EvmTransferAsset = Readonly<{
  amountUnits: string;
  contractAddress: string;
  standard: 'ERC20' | 'ERC721' | 'ERC1155';
  tokenId?: string;
}>;
export type EvmAssetState = Readonly<{
  asset: EvmTransferAsset;
  balanceUnits: bigint;
  from: string;
  hash: string;
  nonce: number;
  number: string;
}>;
export type EvmAssetReadMethod =
  | 'eth_getBlockByNumber'
  | 'eth_getTransactionCount'
  | 'eth_getCode'
  | 'eth_call';
export type EvmAssetRead = (
  method: EvmAssetReadMethod,
  params: readonly unknown[]
) => Promise<unknown>;
export type EvmAssetEnvelope = EvmFeeEnvelope & Readonly<{ nonce: string }>;
export class EvmAssetStateError extends Error {
  readonly code:
    | 'INVALID_INPUT'
    | 'INVALID_RESPONSE'
    | 'INSUFFICIENT_ASSET'
    | 'TRANSFER_REJECTED'
    | 'REVIEW_REQUIRED';

  constructor(code: EvmAssetStateError['code']) {
    super(code);
    this.name = 'EvmAssetStateError';
    this.code = code;
  }
}
const fail = (code: EvmAssetStateError['code']): never => {
  throw new EvmAssetStateError(code);
};
function address(value: string): string {
  try {
    const result = getAddress(value);
    if (/^0x0{40}$/i.test(result)) return fail('INVALID_INPUT');
    return result;
  } catch {
    return fail('INVALID_INPUT');
  }
}
export function snapshotEvmTransferAsset(
  input: EvmTransferAsset
): EvmTransferAsset {
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
      return fail('INVALID_INPUT');
    const fields: Record<string, PropertyDescriptor> =
      Object.getOwnPropertyDescriptors(input);
    const standard = fields.standard?.value;
    const names =
      standard === 'ERC20'
        ? ['standard', 'contractAddress', 'amountUnits']
        : ['standard', 'contractAddress', 'amountUnits', 'tokenId'];
    if (
      Reflect.ownKeys(input).length !== names.length ||
      names.some(
        (name) =>
          !fields[name]?.enumerable || !Object.hasOwn(fields[name]!, 'value')
      )
    )
      return fail('INVALID_INPUT');
    const amountUnits = parseErc20Units(fields.amountUnits!.value);
    if (
      amountUnits === '0' ||
      (standard !== 'ERC20' && standard !== 'ERC721' && standard !== 'ERC1155')
    )
      return fail('INVALID_INPUT');
    const contractAddress = address(fields.contractAddress!.value);
    if (standard === 'ERC20') {
      if (Object.hasOwn(fields, 'tokenId')) return fail('INVALID_INPUT');
      return Object.freeze({ standard, contractAddress, amountUnits });
    }
    if (
      typeof fields.tokenId!.value !== 'string' ||
      (standard === 'ERC721' && amountUnits !== '1')
    )
      return fail('INVALID_INPUT');
    return Object.freeze({
      standard,
      contractAddress,
      amountUnits,
      tokenId: normalizeNftTokenId(fields.tokenId!.value),
    });
  } catch {
    return fail('INVALID_INPUT');
  }
}
function quantity(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)
  )
    return fail('INVALID_RESPONSE');
  return BigInt(value);
}
function block(input: unknown): Readonly<{ hash: string; number: string }> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return fail('INVALID_RESPONSE');
  const value = input as Record<string, unknown>;
  const number = `0x${quantity(value.number).toString(16)}`;
  if (typeof value.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value.hash))
    return fail('INVALID_RESPONSE');
  return Object.freeze({ number, hash: value.hash.toLowerCase() });
}
function nonce(value: unknown): number {
  const number = quantity(value);
  if (number > BigInt(Number.MAX_SAFE_INTEGER)) return fail('INVALID_RESPONSE');
  return Number(number);
}
function word(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
    return fail('INVALID_RESPONSE');
  return BigInt(value);
}

/** A canonical block supplies one coherent balance and sender nonce basis. */
export async function readEvmAssetState(
  read: EvmAssetRead,
  sender: string,
  input: EvmTransferAsset,
  atBlock?: Readonly<{ hash: string; number: string }>
): Promise<EvmAssetState> {
  const asset = snapshotEvmTransferAsset(input);
  const from = address(sender);
  const sampled = block(
    atBlock ?? (await read('eth_getBlockByNumber', ['latest', false]))
  );
  const accountReads = await Promise.all([
    read('eth_getCode', [asset.contractAddress, sampled.number]),
    read('eth_getTransactionCount', [from, sampled.number]),
  ]);
  const code = accountReads[0];
  const rawNonce = accountReads[1];
  if (
    typeof code !== 'string' ||
    code.length > 65538 ||
    !/^0x(?:[0-9a-f]{2})+$/i.test(code)
  )
    return fail('INVALID_RESPONSE');
  let balanceUnits: bigint;
  if (asset.standard === 'ERC20') {
    balanceUnits = word(
      await read('eth_call', [
        {
          to: asset.contractAddress,
          data: `0x70a08231${from.slice(2).toLowerCase().padStart(64, '0')}`,
        },
        sampled.number,
      ])
    );
  } else {
    const verify =
      asset.standard === 'ERC721'
        ? verifyERC721OwnershipHelper
        : verifyERC1155OwnershipHelper;
    let calls = 0;
    const holdings = await verify(
      asset.contractAddress,
      from,
      [asset.tokenId!],
      {
        async call({ to, data }) {
          if (
            to !== asset.contractAddress ||
            typeof data !== 'string' ||
            ++calls > 3
          )
            return fail('INVALID_RESPONSE');
          try {
            const result = await read('eth_call', [
              { to, data },
              sampled.number,
            ]);
            if (
              typeof result !== 'string' ||
              result.length > 8194 ||
              !/^0x(?:[0-9a-f]{2})*$/i.test(result)
            )
              return fail('INVALID_RESPONSE');
            return result;
          } catch (error) {
            throw normalizeNftExecutionRevert(error, { to, data }) ?? error;
          }
        },
      }
    );
    const holding = holdings[0];
    if (!holding?.verified) return fail('INVALID_RESPONSE');
    balanceUnits = BigInt(
      asset.standard === 'ERC721' ? holding.balance : holding.rawBalance!
    );
  }
  return Object.freeze({
    asset,
    from,
    number: sampled.number,
    hash: sampled.hash,
    nonce: nonce(rawNonce),
    balanceUnits,
  });
}

/** Reorg or sender-state changes retire this observation without forbidding queued nonces. */
export async function assertEvmAssetStateCanonical(
  read: EvmAssetRead,
  state: EvmAssetState
): Promise<void> {
  const observed = block(
    await read('eth_getBlockByNumber', [state.number, false])
  );
  if (observed.number !== state.number || observed.hash !== state.hash)
    return fail('REVIEW_REQUIRED');
  const latest = await read('eth_getTransactionCount', [state.from, 'latest']);
  if (nonce(latest) !== state.nonce) return fail('REVIEW_REQUIRED');
}

/** Execute the exact approved call against the endpoint's best available queued state. */
export async function simulateEvmAssetTransfer(
  read: EvmAssetRead,
  state: EvmAssetState,
  input: EvmAssetEnvelope,
  mode: 'automatic' | 'manual'
): Promise<void> {
  let envelope: EvmAssetEnvelope;
  try {
    envelope = snapshotEvmFeeEnvelope(input) as EvmAssetEnvelope;
    if (
      envelope.nonce === undefined ||
      !['automatic', 'manual'].includes(mode) ||
      envelope.from !== state.from ||
      envelope.to !== state.asset.contractAddress ||
      envelope.value !== '0' ||
      BigInt(envelope.nonce) < BigInt(state.nonce)
    )
      return fail('INVALID_INPUT');
    if (state.asset.standard === 'ERC20') {
      if (
        decodeErc20Transfer(envelope.data).amountUnits !==
        state.asset.amountUnits
      )
        return fail('INVALID_INPUT');
    } else {
      const decoded = decodeNftTransferData(envelope.data, {
        chainId: envelope.chainId,
        from: state.from,
        contractAddress: state.asset.contractAddress,
        tokenStandard:
          state.asset.standard === 'ERC721' ? 'ERC-721' : 'ERC-1155',
      });
      if (
        !decoded ||
        decoded.tokenId !== state.asset.tokenId ||
        decoded.amountUnits !== state.asset.amountUnits
      )
        return fail('INVALID_INPUT');
    }
  } catch {
    return fail('INVALID_INPUT');
  }
  const hex = (value: string) => `0x${BigInt(value).toString(16)}`;
  const fees =
    envelope.type === 0
      ? { type: '0x0', gasPrice: hex(envelope.gasPrice) }
      : {
          type: '0x2',
          maxFeePerGas: hex(envelope.maxFeePerGas),
          maxPriorityFeePerGas: hex(envelope.maxPriorityFeePerGas),
        };
  const tag =
    mode === 'automatic' && BigInt(envelope.nonce) > BigInt(state.nonce)
      ? 'pending'
      : state.number;
  const call = Object.assign(
    {
      from: envelope.from,
      to: envelope.to,
      value: '0x0',
      data: envelope.data,
      gas: hex(envelope.gasLimit),
      nonce: hex(envelope.nonce),
    },
    fees
  );
  let result: unknown;
  try {
    result = await read('eth_call', [call, tag]);
  } catch (error) {
    if (
      normalizeNftExecutionRevert(error, {
        to: envelope.to,
        data: envelope.data,
      })
    )
      return fail('TRANSFER_REJECTED');
    throw error;
  }
  if (
    typeof result !== 'string' ||
    result.length > 8194 ||
    !/^0x(?:[0-9a-f]{2})*$/i.test(result)
  )
    return fail('INVALID_RESPONSE');
  if (state.asset.standard === 'ERC20') {
    if (result !== '0x' && word(result) !== BigInt(1))
      return fail('TRANSFER_REJECTED');
  } else if (result !== '0x') return fail('TRANSFER_REJECTED');
}
