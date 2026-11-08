import { parseEvmFeeQuantity } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import { getAddress } from 'ethers/address';

import {
  decodeErc20Transfer,
  encodeErc20Transfer,
  parseErc20Units,
} from '../../../shared/erc20';
import {
  readEvmAssetState,
  assertEvmAssetStateCanonical,
  simulateEvmAssetTransfer,
  type EvmAssetRead,
  type EvmAssetState,
  type EvmTransferAsset,
} from '../../../shared/evmAssetState';
import {
  decodeRetainedNftTransfer,
  encodeNftTransferData,
  snapshotNftTransferIntent,
} from '../../../shared/nftTransfer';
import {
  EVM_ASSET_REVIEW_MESSAGE,
  EVM_ASSET_REVIEW_REQUIRED,
} from '../../../utils/evmTransactionContext';

import type { WalletTokenReviewPayload } from '../../../shared/walletTokenReview';
import type {
  CustomJsonRpcProvider,
  IReviewedEvmTokenFees,
} from '@sidhujag/sysweb3-keyring';
import type { Transaction } from 'ethers/transaction';

type Provider = Pick<
  CustomJsonRpcProvider,
  'send' | 'signal' | 'verifyConfiguredChainId'
>;
type Envelope = Parameters<typeof simulateEvmAssetTransfer>[2];
export type WorkerAssetBasis = EvmAssetState;
export type WorkerAsset = WalletTokenReviewPayload;
type BasisOwner = {
  assertCurrent: () => void;
  chainId: string;
  endpoint: string;
  envelope: Envelope;
  from: string;
  provider: Provider;
  status: 'issued' | 'claimed' | 'consumed';
};
const basisOwners = new WeakMap<WorkerAssetBasis, BasisOwner>();
const fail = (): never => {
  throw Object.assign(new Error(EVM_ASSET_REVIEW_MESSAGE), {
    code: EVM_ASSET_REVIEW_REQUIRED,
    transactionNotBroadcast: true,
  });
};
function assetRead(
  provider: Provider,
  assertCurrent: () => void
): EvmAssetRead {
  return async (method, params) => {
    assertCurrent();
    if (provider.signal.aborted) throw provider.signal.reason;
    try {
      const result: unknown = await provider.send(method, [...params]);
      assertCurrent();
      if (provider.signal.aborted) throw provider.signal.reason;
      return result;
    } catch (error) {
      assertCurrent();
      if (provider.signal.aborted) throw provider.signal.reason;
      throw error;
    }
  };
}
async function verifyChain(provider: Provider, assertCurrent: () => void) {
  assertCurrent();
  if (provider.signal.aborted) throw provider.signal.reason;
  try {
    await provider.verifyConfiguredChainId(true);
  } catch {
    assertCurrent();
    if (provider.signal.aborted) throw provider.signal.reason;
    return fail();
  }
  assertCurrent();
}

/** Capture the approved asset once; only this worker can claim its state. */
export async function inspectWorkerAssetState(
  provider: Provider,
  payload: WorkerAsset,
  chainId: number,
  sender: string,
  assertCurrent: () => void
): Promise<WorkerAssetBasis> {
  const from = getAddress(sender);
  const tx = payload.transaction;
  const endpoint = tx.networkUrl;
  const to = getAddress(tx.tokenAddress);
  let asset: EvmTransferAsset;
  let data: string;
  if (payload.type === 'ERC20') {
    const amountUnits = parseErc20Units(payload.transaction.tokenAmountUnits);
    asset = { standard: 'ERC20', contractAddress: to, amountUnits };
    data = encodeErc20Transfer(tx.receiver, amountUnits);
  } else {
    const intent = snapshotNftTransferIntent({
      kind: 'nft-transfer',
      chainId: String(chainId),
      from,
      contractAddress: to,
      recipient: tx.receiver,
      tokenStandard: payload.type === 'ERC721' ? 'ERC-721' : 'ERC-1155',
      tokenId: payload.transaction.tokenId,
      amountUnits:
        payload.type === 'ERC721' ? '1' : payload.transaction.tokenAmount,
    });
    asset = {
      standard: payload.type,
      contractAddress: to,
      amountUnits: intent.amountUnits,
      tokenId: intent.tokenId,
    };
    data = encodeNftTransferData(intent);
  }
  const envelope: Envelope = Object.freeze({
    from,
    to,
    chainId: String(chainId),
    value: '0',
    data,
    gasLimit: parseEvmFeeQuantity(tx.gasLimit).toString(),
    nonce: '0',
    ...(tx.isLegacy
      ? {
          type: 0 as const,
          gasPrice: parseEvmFeeQuantity(tx.gasPrice).toString(),
        }
      : {
          type: 2 as const,
          accessList: [],
          maxFeePerGas: parseEvmFeeQuantity(tx.maxFeePerGas).toString(),
          maxPriorityFeePerGas: parseEvmFeeQuantity(
            tx.maxPriorityFeePerGas
          ).toString(),
        }),
  });
  const read = assetRead(provider, assertCurrent);
  await verifyChain(provider, assertCurrent);
  let basis: EvmAssetState;
  try {
    basis = await readEvmAssetState(read, from, asset);
  } catch {
    assertCurrent();
    if (provider.signal.aborted) throw provider.signal.reason;
    return fail();
  }
  if (basis.balanceUnits < BigInt(basis.asset.amountUnits)) return fail();
  basisOwners.set(basis, {
    provider,
    from: from.toLowerCase(),
    chainId: String(chainId),
    endpoint,
    assertCurrent,
    envelope,
    status: 'issued',
  });
  return basis;
}

export function claimWorkerAssetBasis(
  provider: Provider,
  from: string,
  chainId: string,
  endpoint: string,
  assertCurrent: () => void,
  basis: WorkerAssetBasis
): EvmAssetState {
  const owner = basisOwners.get(basis);
  if (
    !owner ||
    owner.status !== 'issued' ||
    owner.provider !== provider ||
    owner.from !== from.toLowerCase() ||
    owner.chainId !== chainId ||
    owner.endpoint !== endpoint ||
    owner.assertCurrent !== assertCurrent
  )
    return fail();
  assertCurrent();
  if (provider.signal.aborted) throw provider.signal.reason;
  owner.status = 'claimed';
  return basis;
}

/** Verify the actual selected envelope after nonce/reservation admission. */
export async function assertWorkerAssetBasis(
  provider: Provider,
  from: string,
  basis: WorkerAssetBasis,
  assertCurrent: () => void,
  nonce: number,
  mode: 'automatic' | 'manual'
): Promise<void> {
  const owner = basisOwners.get(basis);
  if (
    !owner ||
    owner.status !== 'claimed' ||
    owner.provider !== provider ||
    owner.from !== from.toLowerCase() ||
    owner.assertCurrent !== assertCurrent
  )
    return fail();
  owner.status = 'consumed';
  const read = assetRead(provider, assertCurrent);
  try {
    await simulateEvmAssetTransfer(
      read,
      basis,
      { ...owner.envelope, nonce: String(nonce) },
      mode
    );
    await assertEvmAssetStateCanonical(read, basis);
  } catch {
    assertCurrent();
    if (provider.signal.aborted) throw provider.signal.reason;
    return fail();
  }
  await verifyChain(provider, assertCurrent);
}

// Only for the held SDK token lifecycle: reconstruct the exact intended asset
// from authenticated signed bytes rather than preserving a renderer claim.
export function signedWorkerAsset(
  entry: Readonly<{
    chainId: string;
    from: string;
    hash: string;
    networkUrl: string;
    nonce: number;
    operation: string;
    rawTransaction: string;
  }>,
  tx: Transaction
): WorkerAsset {
  if (
    !tx.isSigned() ||
    tx.serialized !== entry.rawTransaction ||
    tx.hash?.toLowerCase() !== entry.hash.toLowerCase() ||
    tx.from?.toLowerCase() !== entry.from.toLowerCase() ||
    tx.chainId.toString() !== entry.chainId ||
    tx.nonce !== entry.nonce ||
    tx.value !== BigInt(0) ||
    !tx.to
  )
    return fail();
  let fees: IReviewedEvmTokenFees;
  if (tx.type === 0 && tx.gasPrice !== null) {
    fees = {
      gasLimit: tx.gasLimit.toString(),
      isLegacy: true,
      gasPrice: tx.gasPrice.toString(),
    };
  } else if (
    tx.type === 2 &&
    tx.maxFeePerGas !== null &&
    tx.maxPriorityFeePerGas !== null
  ) {
    fees = {
      gasLimit: tx.gasLimit.toString(),
      isLegacy: false,
      maxFeePerGas: tx.maxFeePerGas.toString(),
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString(),
    };
  } else return fail();
  const common = { ...fees, networkUrl: entry.networkUrl };
  if (entry.operation === 'erc20') {
    const { recipient, amountUnits } = decodeErc20Transfer(tx.data);
    return Object.freeze({
      type: 'ERC20',
      transaction: Object.freeze({
        ...common,
        tokenAddress: getAddress(tx.to),
        receiver: getAddress(recipient),
        tokenAmountUnits: amountUnits,
      }),
    });
  }
  const nft = decodeRetainedNftTransfer(
    { ...entry, from: entry.from.toLowerCase() },
    tx
  );
  if (!nft) return fail();
  const transaction = {
    ...common,
    tokenAddress: nft.contractAddress,
    receiver: nft.recipient,
    tokenId: nft.tokenId,
  };
  return nft.tokenStandard === 'ERC-721'
    ? Object.freeze({ type: 'ERC721', transaction: Object.freeze(transaction) })
    : Object.freeze({
        type: 'ERC1155',
        transaction: Object.freeze({
          ...transaction,
          tokenAmount: nft.amountUnits,
        }),
      });
}
