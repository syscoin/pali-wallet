import { EthereumTransactions } from '@sidhujag/sysweb3-keyring';
import {
  assertEvmGasLimit,
  parseEvmFeeQuantity,
} from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';

import { evmEstimateRequest } from '../../../shared/evmEstimateRequest';
import {
  EVM_NATIVE_INTRINSIC_GAS,
  getEvmTransferCost,
} from '../../../shared/evmTransferCost';

import type { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';
import type { INetwork } from '@sidhujag/sysweb3-network';

type GasPolicy = ReturnType<EthereumTransactions['getGasOverrides']>;
type GasPolicySource = Pick<EthereumTransactions, 'getGasOverrides'>;
type SdkTransaction = Parameters<EthereumTransactions['getTxGasLimit']>[0];
type NativeEstimate = Pick<SdkTransaction, 'data' | 'from' | 'to' | 'value'>;

const hasGasPolicy = (source: unknown): source is GasPolicySource =>
  typeof source === 'object' &&
  source !== null &&
  'getGasOverrides' in source &&
  typeof source.getGasOverrides === 'function';

// IEthereumTransactions omits this public class accessor in this SDK release.
// Refuse a missing/invalid accessor rather than assuming an empty policy.
export function getSdkGasOverrides(source: unknown): GasPolicy {
  if (!hasGasPolicy(source)) throw new Error('SDK gas policy is unavailable');
  const policy = source.getGasOverrides();
  const pending = policy && typeof policy === 'object' && 'then' in policy;
  if (pending) void Promise.resolve(policy).catch(() => undefined);
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || pending)
    throw new Error('SDK gas policy is unavailable');
  return policy;
}

// Caller owns the existing withReceiptReadProvider lifecycle and deadline.
export async function freshSdkGasEstimate(
  policy: GasPolicy,
  network: INetwork,
  transaction: NativeEstimate,
  provider: CustomJsonRpcProvider,
  assertCurrent: () => void
) {
  const check = () => {
    assertCurrent();
    if (provider.signal.aborted)
      throw new DOMException('Gas estimate aborted', 'AbortError');
  };
  check();
  const refuseSigning = (): never => {
    throw new Error('Read-only gas estimate');
  };
  class Reader extends EthereumTransactions {
    get web3Provider() {
      check();
      return provider;
    }
  }
  const reader = new Reader(
    () => network,
    refuseSigning,
    refuseSigning,
    undefined as never,
    undefined as never,
    undefined,
    null
  );
  reader.setGasOverrides(policy);
  // This SDK type also requires send-only fee fields. The actual estimator
  // accepts the same four fields used by the ordinary native quote path;
  // preserve that payload rather than inventing fees to satisfy its type.
  const gas = await reader.getTxGasLimit(transaction as SdkTransaction);
  check();
  return gas;
}

/** Validate the displayed maximum before any provider call or signer entry. */
export function captureReviewedNativeEvmTransfer(
  input: Record<string, unknown>,
  isLegacy: boolean,
  maximumReviewedFee: unknown,
  from: string,
  chainId: number,
  policy: GasPolicy
) {
  if (
    !input ||
    input.data !== '0x' ||
    (input.accessList !== undefined && input.accessList !== null) ||
    typeof input.from !== 'string' ||
    input.from.toLowerCase() !== from.toLowerCase() ||
    typeof input.to !== 'string' ||
    !/^0x[\da-f]{40}$/i.test(input.to)
  )
    throw new Error('Invalid reviewed native transfer');
  if (
    (input.chainId !== undefined &&
      input.chainId !== null &&
      parseEvmFeeQuantity(input.chainId) !== BigInt(chainId)) ||
    (input.type !== undefined &&
      input.type !== null &&
      parseEvmFeeQuantity(input.type) !== BigInt(isLegacy ? 0 : 2))
  )
    throw new Error('Invalid reviewed native transfer network or fee type');
  const value = parseEvmFeeQuantity(input.value, 'native amount');
  const gasLimit = assertEvmGasLimit(
    parseEvmFeeQuantity(input.gasLimit, 'native gas limit'),
    BigInt(chainId)
  );
  if (
    value === BigInt(0) ||
    gasLimit < EVM_NATIVE_INTRINSIC_GAS ||
    (policy.minGasLimit && gasLimit < policy.minGasLimit.toBigInt())
  )
    throw new Error('Reviewed native gas limit is no longer sufficient');
  const fees = isLegacy
    ? {
        type: 0 as const,
        gasPrice: parseEvmFeeQuantity(input.gasPrice).toString(),
      }
    : {
        type: 2 as const,
        maxFeePerGas: parseEvmFeeQuantity(input.maxFeePerGas).toString(),
        maxPriorityFeePerGas: parseEvmFeeQuantity(
          input.maxPriorityFeePerGas
        ).toString(),
      };
  const maximumRate = BigInt(
    fees.type === 0 ? fees.gasPrice : fees.maxFeePerGas
  );
  if (
    fees.type === 2 &&
    (maximumRate === BigInt(0) ||
      BigInt(fees.maxPriorityFeePerGas) > maximumRate)
  )
    throw new Error('Invalid reviewed native fee');
  const cost = getEvmTransferCost(value, gasLimit, maximumRate);
  if (cost.maximumFee !== parseEvmFeeQuantity(maximumReviewedFee))
    throw new Error('Reviewed native maximum fee changed');
  const nonce =
    input.nonce === undefined || input.nonce === null
      ? undefined
      : parseEvmFeeQuantity(input.nonce, 'native nonce');
  if (nonce !== undefined && nonce > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Invalid reviewed native nonce');
  return Object.freeze({
    transaction: Object.freeze({
      from,
      to: input.to,
      data: '0x',
      chainId: String(chainId),
      value: value.toString(),
      gasLimit: gasLimit.toString(),
      ...fees,
    }),
    nonce,
    total: cost.total,
  });
}

/** Recheck the approved envelope with bounded, host-owned reads. */
export async function recheckReviewedNativeEvmTransfer(
  review: ReturnType<typeof captureReviewedNativeEvmTransfer>,
  provider: CustomJsonRpcProvider,
  assertCurrent: () => void
) {
  const check = () => {
    assertCurrent();
    if (provider.signal.aborted) throw provider.signal.reason;
  };
  const read = async (method: string, params: unknown[]) => {
    check();
    const result = await provider.send(method, params);
    check();
    return result;
  };
  check();
  await provider.verifyConfiguredChainId();
  const tx = review.transaction;
  const [header, rawBalance, rawNonce] = await Promise.all([
    read('eth_getBlockByNumber', ['latest', false]),
    read('eth_getBalance', [tx.from, 'pending']),
    review.nonce ?? read('eth_getTransactionCount', [tx.from, 'pending']),
  ]);
  const balance = parseEvmFeeQuantity(rawBalance, 'native balance');
  const nonce = parseEvmFeeQuantity(rawNonce, 'native nonce');
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Invalid reviewed native nonce');
  if (balance < review.total)
    throw new Error('Insufficient funds for reviewed native transfer');
  assertEvmGasLimit(
    BigInt(tx.gasLimit),
    BigInt(tx.chainId),
    parseEvmFeeQuantity(header?.gasLimit, 'block gas limit')
  );
  if (
    tx.type === 2 &&
    parseEvmFeeQuantity(header?.baseFeePerGas, 'base fee') >
      BigInt(tx.maxFeePerGas)
  )
    throw new Error(
      'Reviewed native maximum fee is below the current base fee'
    );
  const request = { ...tx, nonce: nonce.toString() };
  const estimate = parseEvmFeeQuantity(
    await read('eth_estimateGas', [evmEstimateRequest(request), 'pending']),
    'native gas estimate'
  );
  if (estimate < EVM_NATIVE_INTRINSIC_GAS || estimate > BigInt(tx.gasLimit))
    throw new Error('Reviewed native gas limit is no longer sufficient');
  check();
  return Object.freeze(request);
}
