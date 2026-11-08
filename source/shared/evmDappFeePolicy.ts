import { assertEvmGasLimit } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
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
