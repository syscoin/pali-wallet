import { assertSynchronousEvmFeeGuard } from './evmFeeGuard.ts';
import { getEvmTransferCost } from './evmTransferCost.ts';

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const INITIAL_GAS_RESERVE = BigInt(500_000);
const HARDWARE_RESERVE = BigInt(1_000_000_000_000);

/** Existing ordinary EOA MAX policy; Smart Account funding is separate. */
export function nativeEvmMaximumReserve(kind: 'software' | 'hardware'): bigint {
  if (kind === 'software') return BigInt(0);
  if (kind === 'hardware') return HARDWARE_RESERVE;
  throw new RangeError('Invalid native EVM maximum account kind');
}

function assertUnits(value: bigint): void {
  if (typeof value !== 'bigint' || value < BigInt(0) || value > MAX_UINT256)
    throw new RangeError('Invalid native EVM maximum units');
}

/** A nonpositive result means the balance cannot fund a positive MAX transfer. */
export function nativeEvmMaximumValue(
  balanceUnits: bigint,
  gasLimit: bigint,
  feePerGas: bigint,
  reserveUnits: bigint
): bigint {
  assertUnits(balanceUnits);
  assertUnits(gasLimit);
  assertUnits(feePerGas);
  assertUnits(reserveUnits);
  const { maximumFee } = getEvmTransferCost(BigInt(0), gasLimit, feePerGas);
  return balanceUnits - maximumFee - reserveUnits;
}

/**
 * One initial estimate and at most two refinements, using the host's gas buffer.
 * The final value uses the last gas result. After the refinement bound, callers
 * must still validate that exact value with their normal fee-approval engine.
 */
export async function refineNativeEvmMaximum({
  assertCurrent,
  balanceUnits,
  estimateGas,
  feePerGas,
  reserveUnits,
}: {
  assertCurrent(): void;
  balanceUnits: bigint;
  estimateGas(value: bigint): Promise<bigint>;
  feePerGas: bigint;
  reserveUnits: bigint;
}): Promise<Readonly<{ gasLimit: bigint; value: bigint }>> {
  const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
  check();
  const initial = nativeEvmMaximumValue(
    balanceUnits,
    INITIAL_GAS_RESERVE,
    feePerGas,
    reserveUnits
  );
  // Preserve the existing positive estimation probe for insufficient/zero-fee
  // drafts. A nonpositive final value remains an insufficient-balance result.
  let estimateValue =
    feePerGas > BigInt(0) && initial > BigInt(0) ? initial : BigInt(1);
  const estimate = async (value: bigint) => {
    check();
    const gasLimit = await estimateGas(value);
    check();
    nativeEvmMaximumValue(balanceUnits, gasLimit, feePerGas, reserveUnits);
    return gasLimit;
  };
  let gasLimit = await estimate(estimateValue);
  if (feePerGas > BigInt(0)) {
    for (let i = 0; i < 2; i += 1) {
      const refinedValue = nativeEvmMaximumValue(
        balanceUnits,
        gasLimit,
        feePerGas,
        reserveUnits
      );
      if (refinedValue <= BigInt(0) || refinedValue === estimateValue) break;
      estimateValue = refinedValue;
      const refinedGasLimit = await estimate(estimateValue);
      if (refinedGasLimit === gasLimit) break;
      gasLimit = refinedGasLimit;
    }
  }
  check();
  return Object.freeze({
    value: nativeEvmMaximumValue(
      balanceUnits,
      gasLimit,
      feePerGas,
      reserveUnits
    ),
    gasLimit,
  });
}
