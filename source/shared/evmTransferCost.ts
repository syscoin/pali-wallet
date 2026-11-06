const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
export const EVM_NATIVE_INTRINSIC_GAS = BigInt(21_000);

/** The reviewed cap and amount stay in atomic units through signing. */
export function getEvmTransferCost(
  value: bigint,
  gasLimit: bigint,
  feePerGas: bigint
) {
  if (value < BigInt(0) || gasLimit <= BigInt(0) || feePerGas < BigInt(0))
    throw new RangeError('Invalid EVM transfer cost');
  const maximumFee = gasLimit * feePerGas;
  const total = value + maximumFee;
  if (total > MAX_UINT256) throw new RangeError('Invalid EVM transfer cost');
  return { maximumFee, total };
}
