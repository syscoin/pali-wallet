import { formatUnits, parseUnits } from 'ethers/utils';
import { isNativeBalanceAvailable } from '../../../../source/utils/nativeBalance.ts';
import type { PublicBalance } from './types.ts';

const MAX_UINT256 = (1n << 256n) - 1n;

export function assertBaseUnits(units: string): bigint {
  if (typeof units !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(units)) {
    throw new Error('Invalid integer amount');
  }
  const value = BigInt(units);
  if (value > MAX_UINT256) throw new Error('Amount is too large');
  return value;
}

/** No floating point enters transaction arithmetic. Scientific notation is rejected. */
export function parseDecimalAmount(
  value: string,
  decimals: number,
  allowZero = false
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error('Invalid asset precision');
  if (
    typeof value !== 'string' ||
    value.length > 100 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
  ) {
    throw new Error('Enter an amount using numbers and a decimal point');
  }
  const fraction = value.split('.')[1] || '';
  if (fraction.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places`);
  const units = parseUnits(value, decimals);
  if (units > MAX_UINT256) throw new Error('Amount is too large');
  if (!allowZero && units === 0n)
    throw new Error('Amount must be greater than zero');
  return units;
}

export function formatBaseUnits(units: string, decimals: number): string {
  assertBaseUnits(units);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error('Invalid asset precision');
  return formatUnits(units, decimals);
}

/** Keeps the extension's known-zero / unavailable distinction. */
export function loadedBalance(units: string, updatedAt: number): PublicBalance {
  assertBaseUnits(units);
  if (
    !isNativeBalanceAvailable(units) ||
    !Number.isFinite(updatedAt) ||
    updatedAt < 0
  ) {
    throw new Error('Invalid balance observation');
  }
  return Object.freeze({ status: 'available', units, updatedAt });
}
