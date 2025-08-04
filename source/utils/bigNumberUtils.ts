import { BigNumber } from '@ethersproject/bignumber';

/**
 * Convert BigNumber or similar objects to string
 * Handles various BigNumber formats including ethers BigNumber, hex objects, etc.
 */
export const convertBigNumberToString = (value: any): string => {
  if (!value) return '';

  // Handle different types of BigNumber values
  if (value._isBigNumber || value._hex) {
    // It's an ethers BigNumber object
    return BigNumber.from(value).toString();
  } else if (typeof value === 'object' && value.hex) {
    // It's an object with hex property
    return BigNumber.from(value.hex).toString();
  } else if (typeof value === 'object' && value.toString) {
    // Try to handle as BigNumber if it has proper methods
    try {
      return BigNumber.from(value).toString();
    } catch {
      // Fallback to basic toString if BigNumber conversion fails
      return value.toString();
    }
  } else if (typeof value === 'string' || typeof value === 'number') {
    return value.toString();
  }

  // Final fallback
  return '0';
};

/**
 * Check if a value is the max uint256 (used for unlimited approvals)
 */
export const isMaxUint256 = (value: string): boolean =>
  value ===
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
