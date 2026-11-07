import { Interface } from 'ethers/abi';
import { getAddress } from 'ethers/address';

import {
  decodeErc20Transfer,
  encodeErc20Transfer,
  parseErc20Units,
} from '../../../shared/erc20';
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

// The caller supplies a worker-owned, previously validated payload and
// fresh read provider. No renderer-supplied block, nonce, or "proof" is used.
type Provider = Pick<
  CustomJsonRpcProvider,
  'send' | 'signal' | 'verifyConfiguredChainId'
>;
export type WorkerAssetBasis = Readonly<{
  hash: string;
  nonce: number;
  number: string;
}>;
type BasisOwner = {
  assertCurrent: () => void;
  chainId: string;
  contract: string;
  endpoint: string;
  from: string;
  provider: Provider;
  status: 'issued' | 'claimed' | 'consumed';
};
const basisOwners = new WeakMap<WorkerAssetBasis, BasisOwner>();
export type WorkerAsset = WalletTokenReviewPayload;
const abi = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address,uint256) view returns (uint256)',
]);
const fail = (): never => {
  throw Object.assign(new Error(EVM_ASSET_REVIEW_MESSAGE), {
    code: EVM_ASSET_REVIEW_REQUIRED,
    transactionNotBroadcast: true,
  });
};
const unavailable = fail;
function quantity(v: unknown): bigint {
  if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v))
    return fail();
  return BigInt(v);
}
function hash(v: unknown): string {
  if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/i.test(v)) return fail();
  return v.toLowerCase();
}
function word(v: unknown): bigint {
  if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/i.test(v)) return fail();
  return BigInt(v);
}
function sampled(v: unknown): { hash: string; number: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  const x = v as Record<string, unknown>;
  const n = quantity(x.number);
  return { number: `0x${n.toString(16)}`, hash: hash(x.hash) };
}
function checkedNonce(v: unknown): number {
  const n = quantity(v);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
  return Number(n);
}

export async function inspectWorkerAssetState(
  provider: Provider,
  payload: WorkerAsset,
  chainId: number,
  sender: string,
  assertCurrent: () => void
): Promise<WorkerAssetBasis> {
  const check = () => {
    assertCurrent();
    if (provider.signal.aborted) throw provider.signal.reason;
  };
  const read = async (method: string, params: unknown[]) => {
    check();
    try {
      const out: unknown = await provider.send(method, params);
      check();
      return out;
    } catch {
      check();
      return unavailable();
    }
  };
  check();
  try {
    await provider.verifyConfiguredChainId(true);
  } catch {
    check();
    return unavailable();
  }
  check();
  const block = sampled(await read('eth_getBlockByNumber', ['latest', false]));
  const from = getAddress(sender);
  const to = getAddress(payload.transaction.tokenAddress);
  // Both are pinned to the same block. Observe both rejections before
  // continuing, including when one request outlives cancellation.
  const [code, rawNonce] = await Promise.all([
    read('eth_getCode', [to, block.number]),
    read('eth_getTransactionCount', [from, block.number]),
  ]);
  if (
    typeof code !== 'string' ||
    code.length > 65538 ||
    !/^0x(?:[0-9a-f]{2})+$/i.test(code)
  )
    return fail();
  let ownershipCall: string;
  let required: bigint;
  let data: string;
  if (payload.type === 'ERC20') {
    required = BigInt(parseErc20Units(payload.transaction.tokenAmountUnits));
    if (!required) return fail();
    ownershipCall = abi.encodeFunctionData('balanceOf(address)', [from]);
    data = encodeErc20Transfer(
      payload.transaction.receiver,
      required.toString()
    );
  } else {
    const intent = snapshotNftTransferIntent({
      kind: 'nft-transfer',
      chainId: String(chainId),
      from,
      contractAddress: to,
      recipient: payload.transaction.receiver,
      tokenStandard: payload.type === 'ERC721' ? 'ERC-721' : 'ERC-1155',
      tokenId: payload.transaction.tokenId,
      amountUnits:
        payload.type === 'ERC721' ? '1' : payload.transaction.tokenAmount,
    });
    required = BigInt(intent.amountUnits);
    ownershipCall =
      payload.type === 'ERC721'
        ? abi.encodeFunctionData('ownerOf', [intent.tokenId])
        : abi.encodeFunctionData('balanceOf(address,uint256)', [
            from,
            intent.tokenId,
          ]);
    data = encodeNftTransferData(intent);
  }
  const nonce = checkedNonce(rawNonce);
  const tx = payload.transaction;
  const asHex = (value: unknown) =>
    `0x${BigInt(parseErc20Units(value)).toString(16)}`;
  const gas = asHex(tx.gasLimit);
  const fees = tx.isLegacy
    ? { type: '0x0', gasPrice: asHex(tx.gasPrice) }
    : {
        type: '0x2',
        maxFeePerGas: asHex(tx.maxFeePerGas),
        maxPriorityFeePerGas: asHex(tx.maxPriorityFeePerGas),
      };
  const [ownership, simulation] = await Promise.all([
    read('eth_call', [{ to, data: ownershipCall }, block.number]),
    read('eth_call', [
      {
        from,
        to,
        value: '0x0',
        data,
        gas,
        nonce: `0x${nonce.toString(16)}`,
        ...fees,
      },
      block.number,
    ]),
  ]);
  if (payload.type === 'ERC721') {
    const owner = word(ownership);
    if (
      owner > (BigInt(1) << BigInt(160)) - BigInt(1) ||
      owner !== BigInt(from)
    )
      return fail();
  } else if (word(ownership) < required) return fail();
  if (payload.type === 'ERC20') {
    if (simulation !== '0x' && word(simulation) !== BigInt(1)) return fail();
  } else if (simulation !== '0x') return fail();
  const basis = Object.freeze({ ...block, nonce });
  basisOwners.set(basis, {
    provider,
    from: from.toLowerCase(),
    chainId: String(chainId),
    endpoint: payload.transaction.networkUrl,
    contract: to.toLowerCase(),
    assertCurrent,
    status: 'issued',
  });
  return basis;
}

/** A basis is worker-issued for one provider, account, chain, contract and session. */
export function claimWorkerAssetBasis(
  provider: Provider,
  from: string,
  chainId: string,
  endpoint: string,
  contract: string,
  assertCurrent: () => void,
  basis: WorkerAssetBasis
): number {
  const owner = basisOwners.get(basis);
  if (
    !owner ||
    owner.status !== 'issued' ||
    owner.provider !== provider ||
    owner.from !== from.toLowerCase() ||
    owner.chainId !== chainId ||
    owner.endpoint !== endpoint ||
    owner.contract !== contract.toLowerCase() ||
    owner.assertCurrent !== assertCurrent
  )
    return fail();
  assertCurrent();
  if (provider.signal.aborted) throw provider.signal.reason;
  owner.status = 'claimed';
  return basis.nonce;
}

// Invoke again *after* planner admission, including under the held journal lock.
export async function assertWorkerAssetBasis(
  provider: Provider,
  from: string,
  basis: WorkerAssetBasis,
  assertCurrent: () => void
): Promise<void> {
  const owner = basisOwners.get(basis);
  if (
    !owner ||
    owner.status === 'consumed' ||
    owner.provider !== provider ||
    owner.from !== from.toLowerCase() ||
    owner.assertCurrent !== assertCurrent
  )
    return fail();
  // Claim before asynchronous reads, including for standalone helper calls.
  owner.status = 'consumed';
  const check = () => {
    assertCurrent();
    if (provider.signal.aborted) throw provider.signal.reason;
  };
  check();
  const read = async (method: string, params: unknown[]) => {
    check();
    try {
      const out: unknown = await provider.send(method, params);
      check();
      return out;
    } catch {
      check();
      return unavailable();
    }
  };
  const canonical = sampled(
    await read('eth_getBlockByNumber', [basis.number, false])
  );
  if (canonical.number !== basis.number || canonical.hash !== basis.hash)
    return fail();
  const latest = checkedNonce(
    await read('eth_getTransactionCount', [from, 'latest'])
  );
  if (latest !== basis.nonce) return fail();
  try {
    await provider.verifyConfiguredChainId(true);
  } catch {
    check();
    return unavailable();
  }
  check();
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
