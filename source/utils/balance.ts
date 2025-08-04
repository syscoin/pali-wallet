/**
 * Utility functions for safe balance comparisons
 * Handles both string and number types consistently
 */

/**
 * Check if a balance is zero or invalid
 * @param balance - Balance value as string, number, or undefined
 * @returns true if balance is 0, NaN, null, or undefined
 */
export const isZeroBalance = (
  balance: string | number | undefined | null
): boolean => {
  if (balance === undefined || balance === null) return true;
  const numBalance =
    typeof balance === 'string' ? parseFloat(balance) : balance;
  return numBalance === 0 || isNaN(numBalance);
};

/**
 * Check if a balance is positive (greater than 0)
 * @param balance - Balance value as string, number, or undefined
 * @returns true if balance is a positive number
 */
export const hasPositiveBalance = (
  balance: string | number | undefined | null
): boolean => {
  if (balance === undefined || balance === null) return false;
  const numBalance =
    typeof balance === 'string' ? parseFloat(balance) : balance;
  return !isNaN(numBalance) && numBalance > 0;
};

/**
 * Compare two balance values for equality
 * @param a - First balance value
 * @param b - Second balance value
 * @returns true if balances are different
 */
export const areBalancesDifferent = (
  a: string | number,
  b: string | number
): boolean => {
  const numA = typeof a === 'string' ? parseFloat(a) : a;
  const numB = typeof b === 'string' ? parseFloat(b) : b;

  // Handle NaN cases
  if (isNaN(numA) && isNaN(numB)) return false;
  if (isNaN(numA) || isNaN(numB)) return true;

  return numA !== numB;
};

/**
 * Convert balance to number safely
 * @param balance - Balance value as string, number, or undefined
 * @param defaultValue - Default value if conversion fails (default: 0)
 * @returns Numeric balance value
 */
export const toNumericBalance = (
  balance: string | number | undefined | null,
  defaultValue: number = 0
): number => {
  if (balance === undefined || balance === null) return defaultValue;
  const numBalance =
    typeof balance === 'string' ? parseFloat(balance) : balance;
  return isNaN(numBalance) ? defaultValue : numBalance;
};
