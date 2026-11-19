import { getAddress } from 'ethers/address';

import { createErc20Policy, decodeErc20Transfer } from '../../../shared/erc20';
import {
  assertEvmAssetStateCanonical,
  readEvmAssetState,
  simulateEvmAssetTransfer,
  type EvmAssetEnvelope,
  type EvmTransferAsset,
} from '../../../shared/evmAssetState';
import {
  assertEvmAssetReservations,
  type EvmAutoNonceSnapshot,
} from '../../../shared/evmAutoNonce';
import { evmEstimateRequest } from '../../../shared/evmEstimateRequest';
import { decodeNftTransferData } from '../../../shared/nftTransfer';

import type { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
import type { Transaction } from 'ethers/transaction';

type RetainedIntent = NonNullable<
  Awaited<ReturnType<EvmSignedRecords['readEoaSpeedUpIntent']>>
>;

export async function assertEvmReplacementExecution(
  read: (method: string, params: unknown[]) => Promise<unknown>,
  tx: Transaction,
  retained: RetainedIntent,
  snapshot: EvmAutoNonceSnapshot | undefined,
  block: { hash: string; number: string },
  check: () => void
) {
  if (tx.data === '0x') return;
  check();
  const { executionOperation, original } = retained;
  const { to, from, data, type } = tx;
  if (!to || !from || (type !== 0 && type !== 2))
    throw new Error('Replacement intent unavailable');
  const envelope: EvmAssetEnvelope = {
    to,
    from,
    data,
    nonce: String(tx.nonce),
    chainId: tx.chainId.toString(),
    value: tx.value.toString(),
    gasLimit: tx.gasLimit.toString(),
    ...(type === 0
      ? { type, gasPrice: tx.gasPrice!.toString() }
      : {
          type,
          accessList: tx.accessList ?? [],
          maxFeePerGas: tx.maxFeePerGas!.toString(),
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas!.toString(),
        }),
  };
  let asset: EvmTransferAsset | undefined;
  if (executionOperation === 'erc20') {
    asset = {
      standard: 'ERC20',
      contractAddress: to,
      amountUnits: decodeErc20Transfer(data).amountUnits,
    };
  } else if (
    executionOperation === 'erc721' ||
    executionOperation === 'erc1155'
  ) {
    const nft = decodeNftTransferData(data, {
      chainId: envelope.chainId,
      from,
      contractAddress: to,
      tokenStandard: executionOperation === 'erc721' ? 'ERC-721' : 'ERC-1155',
    });
    if (!nft) throw new Error('Replacement intent unavailable');
    asset = {
      standard: executionOperation === 'erc721' ? 'ERC721' : 'ERC1155',
      amountUnits: nft.amountUnits,
      contractAddress: to,
      tokenId: nft.tokenId,
    };
  }
  if (asset) {
    if (!snapshot) throw new Error('Replacement asset state unavailable');
    const assetRead = (method: string, params: readonly unknown[]) =>
      read(method, [...params]);
    const state = await readEvmAssetState(assetRead, from, asset, block);
    const intent = original.metadata?.intent as { token?: unknown } | undefined;
    if (asset.standard === 'ERC20' && intent) {
      const token = createErc20Policy(getAddress).parseMetadata(intent.token);
      const decimals = await read('eth_call', [
        { to, data: '0x313ce567' },
        block.number,
      ]);
      if (
        typeof decimals !== 'string' ||
        !/^0x[0-9a-f]{64}$/i.test(decimals) ||
        BigInt(decimals) !== BigInt(token.decimals)
      )
        throw new Error('Replacement token decimals changed');
    }
    await assertEvmAssetReservations(state, tx.nonce, snapshot, check);
    await simulateEvmAssetTransfer(assetRead, state, envelope, 'manual');
    await assertEvmAssetStateCanonical(assetRead, state);
  } else {
    const estimate = await read('eth_estimateGas', [
      evmEstimateRequest(envelope),
      block.number,
    ]);
    if (
      typeof estimate !== 'string' ||
      !/^0x[0-9a-f]{1,64}$/i.test(estimate) ||
      BigInt(estimate) === BigInt(0) ||
      BigInt(estimate) > tx.gasLimit
    )
      throw new Error('Replacement contract execution changed');
  }
  check();
}
