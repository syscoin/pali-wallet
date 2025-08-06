/**
 * Helper function to safely convert fee values to numbers and format them with fixed decimals
 * Prevents parseUnits errors from floating point precision issues
 * @param value The value to format
 * @param decimals Number of decimal places (default 9 for Gwei)
 * @returns Formatted string with fixed decimals
 */
export const safeToFixed = (value: any, decimals = 9): string => {
  // Validate decimals parameter
  if (decimals < 0 || decimals > 100) {
    decimals = 9; // Fallback to default
  }

  const numValue = Number(value);

  // Handle special cases
  if (isNaN(numValue)) {
    return decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0';
  }

  if (!isFinite(numValue)) {
    return decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0';
  }

  return numValue.toFixed(decimals);
};
