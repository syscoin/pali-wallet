import Decimal from 'bignumber.js';

/**
 * The editor stores GWEI as numbers; review and submission encode them with
 * toFixed(9). Admit only integer-wei values that survive that exact encoding.
 * This is a representation check, not a network fee-price policy.
 */
export const getCustomFeeGwei = (
  value: unknown,
  allowZero = false
): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const input = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input)) return null;
  const number = Number(input);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0))
    return null;
  // Reject underflow to zero even beyond the decimal library's exponent range.
  if (number === 0 && /[1-9]/.test(input.split(/[eE]/)[0])) return null;

  // At 1e21 and above toFixed emits an exponent, which parseUnits rejects.
  const encoded = number.toFixed(9);
  if (/[eE]/.test(encoded)) return null;
  const exact = new Decimal(input);
  if (exact.decimalPlaces() > 9 || !exact.eq(number) || !exact.eq(encoded))
    return null;
  return number;
};

/** Price presets round once to the nearest wei, without binary multiplication. */
export const getFeePresetGwei = (value: number, priority: number): string => {
  if (!Number.isFinite(value)) return String(value);
  return new Decimal(value)
    .times(priority === 0 ? 8 : priority === 2 ? 12 : 10)
    .dividedBy(10)
    .decimalPlaces(9, Decimal.ROUND_HALF_UP)
    .toFixed();
};
