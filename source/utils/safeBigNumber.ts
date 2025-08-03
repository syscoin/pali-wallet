import { BigNumber } from '@ethersproject/bignumber';

/**
 * Safely convert a value to BigNumber with validation
 * @param value The value to convert
 * @param fallback The fallback value if conversion fails
 * @param context Optional context for error messages
 * @returns BigNumber or throws error if no fallback provided
 */
export const safeBigNumber = (
  value: any,
  fallback?: BigNumber | string | number,
  context?: string
): BigNumber => {
  try {
    // Handle null/undefined
    if (value === null || value === undefined) {
      if (fallback !== undefined) {
        return BigNumber.from(fallback);
      }
      throw new Error(
        `${context ? `${context}: ` : ''}Value is null or undefined`
      );
    }

    // If already a BigNumber, return it
    if (BigNumber.isBigNumber(value)) {
      return value;
    }

    // Handle hex values
    if (typeof value === 'string' && value.startsWith('0x')) {
      // Validate hex string
      if (!/^0x[0-9a-fA-F]*$/.test(value)) {
        throw new Error(`Invalid hex string: ${value}`);
      }
      return BigNumber.from(value);
    }

    // Handle number strings
    if (typeof value === 'string') {
      // Remove any whitespace
      const trimmed = value.trim();

      // Check for empty string
      if (trimmed === '') {
        if (fallback !== undefined) {
          return BigNumber.from(fallback);
        }
        throw new Error(`${context ? `${context}: ` : ''}Empty string value`);
      }

      // Validate number format
      if (!/^-?\d*\.?\d*$/.test(trimmed)) {
        throw new Error(`Invalid number format: ${trimmed}`);
      }

      // Handle decimal values by converting to wei
      if (trimmed.includes('.')) {
        const parts = trimmed.split('.');
        if (parts.length !== 2) {
          throw new Error(`Invalid decimal format: ${trimmed}`);
        }
        // For now, just try to convert - BigNumber will handle the validation
      }

      return BigNumber.from(trimmed);
    }

    // Handle numbers
    if (typeof value === 'number') {
      // Check for special values
      if (!isFinite(value)) {
        throw new Error(`Invalid number: ${value} (not finite)`);
      }

      // Check for decimals - BigNumber doesn't handle them well
      if (value % 1 !== 0) {
        // Convert to string first to preserve precision
        return BigNumber.from(Math.floor(value));
      }

      return BigNumber.from(value);
    }

    // Handle objects with hex property
    if (typeof value === 'object' && value.hex) {
      return safeBigNumber(value.hex, fallback, context);
    }

    // Handle objects with _hex property (ethers BigNumber-like)
    if (typeof value === 'object' && value._hex) {
      return safeBigNumber(value._hex, fallback, context);
    }

    // Try generic conversion as last resort
    return BigNumber.from(value);
  } catch (error: any) {
    if (fallback !== undefined) {
      console.warn(
        `${
          context ? `${context}: ` : ''
        }Failed to convert to BigNumber, using fallback:`,
        error.message
      );
      return BigNumber.from(fallback);
    }

    throw new Error(
      `${context ? `${context}: ` : ''}Failed to convert to BigNumber: ${
        error.message
      }`
    );
  }
};

/**
 * Check if a value can be safely converted to BigNumber
 * @param value The value to check
 * @returns boolean indicating if conversion is safe
 */
export const canConvertToBigNumber = (value: any): boolean => {
  try {
    safeBigNumber(value);
    return true;
  } catch {
    return false;
  }
};
