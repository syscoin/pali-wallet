import {
  assertEvmGasLimit,
  bufferedEvmGasLimit,
  parseEvmFeeQuantity,
} from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import {
  snapshotEvmAccessList,
  type EvmAccessList,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { getAddress } from 'ethers/address';

import { assertSynchronousEvmFeeGuard } from './evmFeeGuard.ts';
import {
  EVM_NATIVE_INTRINSIC_GAS,
  getEvmTransferCost,
} from './evmTransferCost.ts';
import type { Transaction } from 'ethers/transaction';

export const EVM_FEE_APPROVAL_LIFETIME_MS = 90_000;
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

export class EvmFeeBalanceError extends Error {
  constructor() {
    super('Insufficient funds for reviewed EVM transfer');
    this.name = 'EvmFeeBalanceError';
  }
}

export type EvmFeeEnvelope = Readonly<
  {
    chainId: string;
    data: string;
    from: string;
    gasLimit: string;
    nonce?: string;
    to: string | null;
    value: string;
  } & (
    | { gasPrice: string; type: 0 }
    | {
        accessList: EvmAccessList;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
        type: 2;
      }
  )
>;

export type EvmFeeApproval = Readonly<{
  expiresAtMonotonicMilliseconds: number;
  maximumFeeUnits: string;
  maximumTotalUnits: string;
  scope: string;
  transaction: EvmFeeEnvelope;
}>;

export type EvmFeeFunding = Readonly<{ kind: 'native' | 'verified-credit' }>;
export type EvmFeeCoverage = Readonly<{ coveredFeeUnits: string }>;
export const NATIVE_EVM_FEE_FUNDING: EvmFeeFunding = Object.freeze({
  kind: 'native',
});
const fundingVerifiers = new WeakMap<
  EvmFeeFunding,
  (approval: EvmFeeApproval, guard: () => void) => Promise<bigint>
>();
const issuedCoverage = new WeakMap<EvmFeeCoverage, EvmFeeApproval>();

/** Host-private funding capability. Callers must bind the verifier to its exact owned operation. */
export function createOwnedEvmFeeFunding(
  verify: (approval: EvmFeeApproval, guard: () => void) => Promise<bigint>
): EvmFeeFunding {
  const funding = Object.freeze({ kind: 'verified-credit' as const });
  fundingVerifiers.set(funding, verify);
  return funding;
}

export function captureNativeEvmFeeCoverage(
  approval: EvmFeeApproval
): EvmFeeCoverage {
  const coverage = Object.freeze({ coveredFeeUnits: '0' });
  issuedCoverage.set(coverage, approval);
  return coverage;
}

export async function resolveEvmFeeFunding(
  funding: EvmFeeFunding,
  approval: EvmFeeApproval,
  guard: () => void
): Promise<EvmFeeCoverage> {
  assertSynchronousEvmFeeGuard(guard);
  if (funding === NATIVE_EVM_FEE_FUNDING)
    return captureNativeEvmFeeCoverage(approval);
  const verify = fundingVerifiers.get(funding);
  if (!verify) throw new Error('EVM fee funding is unavailable');
  const covered = await verify(approval, guard);
  assertSynchronousEvmFeeGuard(guard);
  if (boundedQuantity(covered) > BigInt(approval.maximumFeeUnits))
    throw new Error('Invalid EVM fee coverage');
  const coverage = Object.freeze({ coveredFeeUnits: covered.toString() });
  issuedCoverage.set(coverage, approval);
  return coverage;
}

export function getEvmCoveredFee(
  approval: EvmFeeApproval,
  coverage: EvmFeeCoverage
): bigint {
  if (issuedCoverage.get(coverage) !== approval)
    throw new Error('EVM fee coverage does not match approval');
  return quantity(coverage.coveredFeeUnits);
}

const issuedApprovals = new WeakSet<object>();
const invalid = (message: string): never => {
  throw new Error(message);
};

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    return invalid('Invalid EVM fee approval quantity');
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) return invalid('Invalid EVM fee approval quantity');
  return parsed;
}

function boundedQuantity(value: bigint): bigint {
  if (typeof value !== 'bigint' || value < BigInt(0) || value > MAX_UINT256)
    return invalid('Invalid EVM fee observation');
  return value;
}

/** Copy the complete execution envelope before asynchronous approval or provider work. */
export function snapshotEvmFeeEnvelope(input: EvmFeeEnvelope): EvmFeeEnvelope {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid('Invalid EVM fee envelope');
  const descriptors: Record<string, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(input);
  const type = descriptors.type?.value;
  const names = [
    'from',
    'to',
    'chainId',
    'value',
    'data',
    'gasLimit',
    'type',
    ...(type === 0
      ? ['gasPrice']
      : ['accessList', 'maxFeePerGas', 'maxPriorityFeePerGas']),
    ...(Object.hasOwn(descriptors, 'nonce') ? ['nonce'] : []),
  ];
  if (
    (type !== 0 && type !== 2) ||
    Reflect.ownKeys(input).length !== names.length
  )
    return invalid('Invalid EVM fee envelope');
  const data: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor?.enumerable || !('value' in descriptor))
      return invalid('Invalid EVM fee envelope');
    data[name] = descriptor.value;
  }
  if (
    typeof data.from !== 'string' ||
    (data.to !== null && typeof data.to !== 'string') ||
    typeof data.data !== 'string' ||
    !/^0x(?:[0-9a-f]{2})*$/.test(data.data)
  )
    return invalid('Invalid EVM fee envelope');
  const from = getAddress(data.from),
    to = typeof data.to === 'string' ? getAddress(data.to) : null;
  if (/^0x0{40}$/i.test(from)) return invalid('Invalid EVM fee envelope');
  const chainId = quantity(data.chainId),
    value = quantity(data.value);
  const gasLimit = assertEvmGasLimit(quantity(data.gasLimit), chainId);
  if (gasLimit < EVM_NATIVE_INTRINSIC_GAS)
    return invalid('Reviewed EVM gas limit is no longer sufficient');
  const nonce = Object.hasOwn(data, 'nonce') ? quantity(data.nonce) : undefined;
  if (nonce !== undefined && nonce > BigInt(Number.MAX_SAFE_INTEGER))
    return invalid('Invalid reviewed EVM nonce');
  const common = {
    from,
    to,
    chainId: chainId.toString(),
    value: value.toString(),
    data: data.data,
    gasLimit: gasLimit.toString(),
    ...(nonce === undefined ? {} : { nonce: nonce.toString() }),
  };
  if (type === 0)
    return Object.freeze({
      ...common,
      type,
      gasPrice: quantity(data.gasPrice).toString(),
    });
  const cap = quantity(data.maxFeePerGas),
    tip = quantity(data.maxPriorityFeePerGas);
  if (cap === BigInt(0) || tip > cap)
    return invalid('Invalid reviewed EVM fee');
  return Object.freeze({
    ...common,
    type,
    accessList: snapshotEvmAccessList(data.accessList),
    maxFeePerGas: cap.toString(),
    maxPriorityFeePerGas: tip.toString(),
  });
}

/** One immutable fee ceiling and execution identity for both wallet hosts. */
export function captureEvmFeeApproval(
  input: EvmFeeEnvelope,
  scope: string,
  expiresAtMonotonicMilliseconds: number
): EvmFeeApproval {
  const transaction = snapshotEvmFeeEnvelope(input);
  if (
    typeof scope !== 'string' ||
    !scope ||
    !Number.isSafeInteger(expiresAtMonotonicMilliseconds) ||
    expiresAtMonotonicMilliseconds < 0
  )
    return invalid('Invalid EVM fee approval');
  const fee = BigInt(
    transaction.type === 0 ? transaction.gasPrice : transaction.maxFeePerGas
  );
  const cost = getEvmTransferCost(
    BigInt(transaction.value),
    BigInt(transaction.gasLimit),
    fee
  );
  const approval = Object.freeze({
    transaction,
    scope,
    maximumFeeUnits: cost.maximumFee.toString(),
    maximumTotalUnits: cost.total.toString(),
    expiresAtMonotonicMilliseconds,
  });
  issuedApprovals.add(approval);
  return approval;
}

export function assertEvmFeeApprovalCurrent(
  approval: EvmFeeApproval,
  now: number
): void {
  if (
    !issuedApprovals.has(approval) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now >= approval.expiresAtMonotonicMilliseconds
  )
    invalid('EVM fee approval expired or unavailable');
}

export function assertEvmFeeRefreshApproved(
  approved: EvmFeeApproval,
  refreshed: EvmFeeApproval,
  now: number
): void {
  assertEvmFeeApprovalCurrent(approved, now);
  assertEvmFeeApprovalCurrent(refreshed, now);
  if (
    approved.scope !== refreshed.scope ||
    JSON.stringify(approved.transaction) !==
      JSON.stringify(refreshed.transaction) ||
    approved.maximumFeeUnits !== refreshed.maximumFeeUnits
  )
    invalid('EVM fee approval changed');
}

/** A lower market quote cannot invalidate the exact already reviewed Speed Up. */
export function assertEvmSpeedUpFeeRefreshApproved(
  approved: EvmFeeApproval,
  refreshed: EvmFeeApproval,
  now: number
): void {
  assertEvmFeeApprovalCurrent(approved, now);
  assertEvmFeeApprovalCurrent(refreshed, now);
  if (approved.scope !== refreshed.scope)
    return invalid('EVM fee approval changed');

  const reviewed = approved.transaction;
  const current = refreshed.transaction;
  let unchangedExecution: EvmFeeEnvelope;
  if (
    reviewed.type === 0 &&
    current.type === 0 &&
    BigInt(current.gasPrice) <= BigInt(reviewed.gasPrice)
  ) {
    unchangedExecution = { ...current, gasPrice: reviewed.gasPrice };
  } else if (
    reviewed.type === 2 &&
    current.type === 2 &&
    BigInt(current.maxFeePerGas) <= BigInt(reviewed.maxFeePerGas) &&
    BigInt(current.maxPriorityFeePerGas) <=
      BigInt(reviewed.maxPriorityFeePerGas)
  ) {
    unchangedExecution = {
      ...current,
      maxFeePerGas: reviewed.maxFeePerGas,
      maxPriorityFeePerGas: reviewed.maxPriorityFeePerGas,
    };
  } else return invalid('EVM fee approval changed');
  if (JSON.stringify(unchangedExecution) !== JSON.stringify(reviewed))
    invalid('EVM fee approval changed');
}

/** Successful RPC estimates use the SDK buffer; failures never produce a quote. */
export function bufferEvmFeeEstimate(
  estimate: bigint,
  chainId: bigint,
  sampledBlockGasLimit?: bigint,
  minimumGasLimit = EVM_NATIVE_INTRINSIC_GAS
): bigint {
  if (boundedQuantity(estimate) < EVM_NATIVE_INTRINSIC_GAS)
    return invalid('Invalid EVM gas estimate');
  return assertEvmGasLimit(
    bufferedEvmGasLimit(estimate, boundedQuantity(minimumGasLimit)),
    chainId,
    sampledBlockGasLimit
  );
}

/** Compare the raw pending estimate with the approved limit. Quote padding is
 * applied only when preparing the initial envelope, never to this observation. */
export function assertEvmFeeEstimateApproved(
  approval: EvmFeeApproval,
  observed: Readonly<{
    balance: bigint;
    baseFeePerGas?: bigint;
    estimatedGas: bigint;
    sampledBlockGasLimit: bigint;
  }>,
  now: number,
  coverage: EvmFeeCoverage
): void {
  assertEvmFeeApprovalCurrent(approval, now);
  const coveredFee = getEvmCoveredFee(approval, coverage);
  const transaction = approval.transaction;
  const gasLimit = BigInt(transaction.gasLimit);
  assertEvmGasLimit(
    gasLimit,
    BigInt(transaction.chainId),
    boundedQuantity(observed.sampledBlockGasLimit)
  );
  if (
    boundedQuantity(observed.estimatedGas) < EVM_NATIVE_INTRINSIC_GAS ||
    observed.estimatedGas > gasLimit
  )
    invalid('Reviewed EVM gas limit is no longer sufficient');
  if (
    boundedQuantity(observed.balance) <
    BigInt(approval.maximumTotalUnits) - coveredFee
  )
    throw new EvmFeeBalanceError();
  if (
    transaction.type === 2 &&
    (observed.baseFeePerGas === undefined ||
      boundedQuantity(observed.baseFeePerGas) >
        BigInt(transaction.maxFeePerGas))
  )
    invalid('Reviewed EVM maximum fee is below the current base fee');
}

/** Initial and exact replay admission share live fee, gas and nonce checks. */
export function assertEvmSpeedUpExecutable(
  transaction: Pick<
    Transaction,
    'chainId' | 'nonce' | 'type' | 'gasLimit' | 'gasPrice' | 'maxFeePerGas'
  >,
  latestNonce: unknown,
  latestBlock: unknown
): void {
  if (
    !latestBlock ||
    typeof latestBlock !== 'object' ||
    Array.isArray(latestBlock)
  )
    return invalid('Missing current EVM block');
  const block = latestBlock as { baseFeePerGas?: unknown; gasLimit?: unknown };
  const baseFee =
    block.baseFeePerGas === null || block.baseFeePerGas === undefined
      ? null
      : parseEvmFeeQuantity(block.baseFeePerGas);
  const rate =
    transaction.type === 2 ? transaction.maxFeePerGas : transaction.gasPrice;
  if (
    (transaction.type !== 0 &&
      transaction.type !== 1 &&
      transaction.type !== 2) ||
    rate === null ||
    parseEvmFeeQuantity(latestNonce) > BigInt(transaction.nonce) ||
    (transaction.type === 2 && baseFee === null) ||
    (baseFee !== null && baseFee > rate)
  )
    return invalid('The signed Speed Up is no longer executable');
  assertEvmGasLimit(
    transaction.gasLimit,
    transaction.chainId,
    parseEvmFeeQuantity(block.gasLimit)
  );
}
