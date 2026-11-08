import { assertEvmGasLimit } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { getEvmProtocolLimits } from '@sidhujag/sysweb3-network/cjs/evm.js';

export type EvmDappFeeRequest = Readonly<{
  gasPrice?: bigint;
  hasAccessList?: boolean;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  type?: 0 | 2;
}>;
export type EvmDappFeeSelection = Readonly<
  | { gasPrice: bigint; type: 0 }
  | { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; type: 2 }
>;
const maximum = (a: bigint, b: bigint) => (a > b ? a : b);
const uint256 = (value: bigint) => {
  if (
    typeof value !== 'bigint' ||
    value < BigInt(0) ||
    value > (BigInt(1) << BigInt(256)) - BigInt(1)
  )
    throw new Error('Invalid dapp fee quantity');
  return value;
};

/** Preserve valid app prices. Raise insufficient caps before the user reviews them. */
export function selectEvmDappFees(
  request: EvmDappFeeRequest,
  network: Readonly<{
    baseFeePerGas?: bigint;
    gasPrice: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }>
): EvmDappFeeSelection {
  for (const value of [
    network.gasPrice,
    network.maxFeePerGas,
    network.maxPriorityFeePerGas,
    network.baseFeePerGas,
    request.gasPrice,
    request.maxFeePerGas,
    request.maxPriorityFeePerGas,
  ])
    if (value !== undefined) uint256(value);
  if (request.type !== undefined && request.type !== 0 && request.type !== 2)
    throw new Error('Invalid transaction type');
  if (
    request.maxPriorityFeePerGas !== undefined &&
    request.maxFeePerGas !== undefined &&
    request.maxPriorityFeePerGas > request.maxFeePerGas
  )
    throw new Error('Invalid dApp priority fee exceeds fee cap');
  const type =
    request.type ??
    (request.gasPrice !== undefined
      ? 0
      : request.hasAccessList || network.baseFeePerGas !== undefined
      ? 2
      : 0);
  const base = network.baseFeePerGas ?? BigInt(0);
  if (type === 0)
    return Object.freeze({
      type,
      gasPrice:
        request.gasPrice !== undefined && request.gasPrice >= base
          ? request.gasPrice
          : maximum(network.gasPrice, base),
    });
  if (network.baseFeePerGas === undefined)
    throw new Error('EIP-1559 fees are unavailable on this network');
  const priority = request.maxPriorityFeePerGas ?? network.maxPriorityFeePerGas;
  const minimum = maximum(base, priority);
  return Object.freeze({
    type,
    maxPriorityFeePerGas: priority,
    maxFeePerGas:
      request.maxFeePerGas !== undefined && request.maxFeePerGas >= minimum
        ? request.maxFeePerGas
        : maximum(network.maxFeePerGas, minimum),
  });
}

export type EvmDappFeeAdjustment = Readonly<{
  recommended: string;
  requested: string;
}>;
export type EvmDappFeeComparison = Readonly<{
  gasLimit?: EvmDappFeeAdjustment;
  gasPrice?: EvmDappFeeAdjustment;
  maxFeePerGas?: EvmDappFeeAdjustment;
  maxPriorityFeePerGas?: EvmDappFeeAdjustment;
  recommendationOnly: boolean;
}>;

export type EvmDappFeeChoiceFields = Readonly<
  { gasLimit: string } & (
    | { gasPrice: string }
    | { maxFeePerGas: string; maxPriorityFeePerGas: string }
  )
>;

/** A fresh quote may raise requested fields again to satisfy execution bounds. */
export function evmDappFeeChoiceMatches(
  transaction: PreparedEvmTransaction,
  fields: EvmDappFeeChoiceFields
): boolean {
  return (
    transaction.gasLimit === fields.gasLimit &&
    (transaction.type === 0
      ? 'gasPrice' in fields && transaction.gasPrice === fields.gasPrice
      : 'maxFeePerGas' in fields &&
        transaction.maxFeePerGas === fields.maxFeePerGas &&
        transaction.maxPriorityFeePerGas === fields.maxPriorityFeePerGas)
  );
}

/** Compare the app request with the same network sample used for its quote. */
export function compareEvmDappFees(
  request: EvmDappFeeRequest & Readonly<{ gasLimit?: bigint }>,
  selected: EvmDappFeeSelection & Readonly<{ gasLimit: bigint }>,
  estimate: bigint,
  network: Readonly<{
    gasPrice: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }>
): EvmDappFeeComparison {
  const difference = (requested: bigint | undefined, recommended: bigint) => {
    uint256(recommended);
    if (requested === undefined) return undefined;
    uint256(requested);
    return requested < recommended
      ? Object.freeze({
          requested: requested.toString(),
          recommended: recommended.toString(),
        })
      : undefined;
  };
  const gasLimit =
    request.gasLimit !== undefined && request.gasLimit < estimate
      ? difference(request.gasLimit, selected.gasLimit)
      : undefined;
  return Object.freeze({
    gasLimit,
    gasPrice:
      selected.type === 0
        ? difference(request.gasPrice, network.gasPrice)
        : undefined,
    maxFeePerGas:
      selected.type === 2
        ? difference(request.maxFeePerGas, network.maxFeePerGas)
        : undefined,
    maxPriorityFeePerGas:
      selected.type === 2
        ? difference(request.maxPriorityFeePerGas, network.maxPriorityFeePerGas)
        : undefined,
    recommendationOnly:
      (request.gasLimit === undefined || request.gasLimit >= estimate) &&
      (selected.type === 0
        ? request.gasPrice === undefined ||
          selected.gasPrice === request.gasPrice
        : (request.maxFeePerGas === undefined ||
            selected.maxFeePerGas === request.maxFeePerGas) &&
          (request.maxPriorityFeePerGas === undefined ||
            selected.maxPriorityFeePerGas === request.maxPriorityFeePerGas)),
  });
}

/** Initial recommendation only. Final admission checks the exact reviewed limit. */
export function selectEvmDappGasLimit(
  estimate: bigint,
  requested: bigint | undefined,
  chainId: bigint,
  blockGasLimit: bigint
): bigint {
  const exact = (value: bigint) => {
    if (
      typeof value !== 'bigint' ||
      value <= BigInt(0) ||
      value > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new Error('Invalid transaction gas limit');
    assertEvmGasLimit(value, chainId, blockGasLimit);
    return value;
  };
  exact(estimate);
  if (requested !== undefined && exact(requested) >= estimate) return requested;
  const protocol = getEvmProtocolLimits(chainId).maxTransactionGas;
  const ceiling =
    protocol === undefined
      ? blockGasLimit
      : BigInt(protocol) < blockGasLimit
      ? BigInt(protocol)
      : blockGasLimit;
  const recommended = (estimate * BigInt(120) + BigInt(99)) / BigInt(100);
  return exact(recommended < ceiling ? recommended : ceiling);
}
