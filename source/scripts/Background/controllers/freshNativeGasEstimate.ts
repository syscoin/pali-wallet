import { parseEvmFeeQuantity } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';

import {
  availableEvmNativeBalance,
  type EvmNativeReservations,
} from '../../../shared/evmAutoNonce';
import { evmEstimateRequest } from '../../../shared/evmEstimateRequest';
import {
  assertEvmFeeApprovalCurrent,
  assertEvmFeeEstimateApproved,
  assertSynchronousEvmFeeGuard,
  bufferEvmFeeEstimate,
  captureEvmFeeApproval,
  EVM_FEE_APPROVAL_LIFETIME_MS,
} from '../../../shared/evmFeeApproval';
import { BigNumber } from '../../../utils/ethersV6Compat';

import type {
  CustomJsonRpcProvider,
  EthereumTransactions,
} from '@sidhujag/sysweb3-keyring';
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
    assertSynchronousEvmFeeGuard(assertCurrent);
    if (provider.signal.aborted)
      throw new DOMException('Gas estimate aborted', 'AbortError');
  };
  check();
  const estimate = await provider.estimateGas(transaction);
  check();
  const gas = bufferEvmFeeEstimate(
    parseEvmFeeQuantity(estimate),
    BigInt(network.chainId),
    undefined,
    policy.minGasLimit?.toBigInt()
  );
  // Keep the SDK BigNumber result expected by the extension renderer.
  return BigNumber.from(gas);
}

/** Validate the displayed maximum before any provider call or signer entry. */
export function captureReviewedNativeEvmTransfer(
  input: Record<string, unknown>,
  isLegacy: boolean,
  maximumReviewedFee: unknown,
  from: string,
  chainId: number,
  policy: GasPolicy,
  scope: string,
  now = Math.floor(performance.now())
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
  const gasLimit = parseEvmFeeQuantity(input.gasLimit, 'native gas limit');
  if (
    value === BigInt(0) ||
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
  const nonce =
    input.nonce === undefined || input.nonce === null
      ? undefined
      : parseEvmFeeQuantity(input.nonce, 'native nonce');
  if (nonce !== undefined && nonce > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Invalid reviewed native nonce');
  const approval = captureEvmFeeApproval(
    {
      from,
      to: input.to,
      data: '0x',
      chainId: String(chainId),
      value: value.toString(),
      gasLimit: gasLimit.toString(),
      ...fees,
      ...(nonce === undefined ? {} : { nonce: nonce.toString() }),
    },
    scope,
    now + EVM_FEE_APPROVAL_LIFETIME_MS
  );
  assertEvmFeeApprovalCurrent(approval, now);
  if (
    BigInt(approval.maximumFeeUnits) !== parseEvmFeeQuantity(maximumReviewedFee)
  )
    throw new Error('Reviewed native maximum fee changed');
  return Object.freeze({
    approval,
    transaction: approval.transaction,
    nonce,
    total: BigInt(approval.maximumTotalUnits),
  });
}

/** Recheck the approved envelope with bounded, host-owned reads. */
export async function recheckReviewedNativeEvmTransfer(
  review: ReturnType<typeof captureReviewedNativeEvmTransfer>,
  provider: CustomJsonRpcProvider,
  assertCurrent: () => void,
  noncePlan: Readonly<{
    balanceState: 'latest' | 'pending';
    canonicalBlock: Readonly<{ hash: string; number: string }>;
    nativeReservations: EvmNativeReservations;
    state: 'latest' | 'pending';
  }>
) {
  const check = () => {
    assertSynchronousEvmFeeGuard(assertCurrent);
    assertEvmFeeApprovalCurrent(review.approval, Math.floor(performance.now()));
    if (provider.signal.aborted) throw provider.signal.reason;
  };
  const read = async (method: string, params: unknown[]) => {
    check();
    const result = await provider.send(method, params);
    check();
    return result;
  };
  check();
  const nonce = review.nonce;
  if (nonce === undefined) throw new Error('Missing reviewed native nonce');
  await provider.verifyConfiguredChainId();
  const tx = review.transaction;
  const { state, balanceState, nativeReservations, canonicalBlock } = noncePlan;
  const [header, rawCanonical, rawPending] = await Promise.all([
    read('eth_getBlockByNumber', ['latest', false]),
    read('eth_getBalance', [tx.from, canonicalBlock.number]),
    read('eth_getBalance', [tx.from, 'pending']),
  ]);
  const balance = availableEvmNativeBalance(
    {
      canonical: parseEvmFeeQuantity(rawCanonical, 'canonical balance'),
      pending: parseEvmFeeQuantity(rawPending, 'pending balance'),
    },
    nativeReservations,
    balanceState
  );
  const observation = {
    balance,
    sampledBlockGasLimit: parseEvmFeeQuantity(
      header?.gasLimit,
      'block gas limit'
    ),
    ...(tx.type === 2
      ? {
          baseFeePerGas: parseEvmFeeQuantity(header?.baseFeePerGas, 'base fee'),
        }
      : {}),
  };
  assertEvmFeeEstimateApproved(
    review.approval,
    { ...observation, estimatedGas: BigInt(tx.gasLimit) },
    Math.floor(performance.now())
  );
  const request = { ...tx, nonce: nonce.toString() };
  const estimate = parseEvmFeeQuantity(
    await read('eth_estimateGas', [evmEstimateRequest(request), state]),
    'native gas estimate'
  );
  assertEvmFeeEstimateApproved(
    review.approval,
    { ...observation, estimatedGas: estimate },
    Math.floor(performance.now())
  );
  const canonical = await read('eth_getBlockByNumber', [
    canonicalBlock.number,
    false,
  ]);
  if (canonical?.hash?.toLowerCase() !== canonicalBlock.hash)
    throw new Error('Canonical balance changed');
  check();
  return Object.freeze(request);
}
