import { BigNumber } from '@ethersproject/bignumber';

import {
  numberToIntegerString,
  scientificToIntegerString,
} from './bigNumberString';

/**
 * Safely convert a value to BigNumber with validation
 *
 * Note: Decimal values (both number and string) are truncated towards zero
 * since BigNumber doesn't support decimals. If you need decimal precision,
 * use parseUnits() with the appropriate decimal places instead.
 *
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

      // Validate number format (including scientific notation)
      // Allow: integers, decimals, scientific notation (e.g., 1e18, 1.5e-10)
      if (
        !/^-?\d*\.?\d*([eE][+-]?\d+)?$/.test(trimmed) ||
        trimmed === '.' ||
        trimmed === '-.' ||
        trimmed === 'e' ||
        trimmed === 'E'
      ) {
        throw new Error(`Invalid number format: ${trimmed}`);
      }

      // Handle scientific notation by converting to plain integer string
      if (trimmed.includes('e') || trimmed.includes('E')) {
        const integerStr = scientificToIntegerString(trimmed);
        return BigNumber.from(integerStr);
      }

      // Handle decimal values - BigNumber doesn't support decimals
      if (trimmed.includes('.')) {
        const parts = trimmed.split('.');
        if (parts.length !== 2) {
          throw new Error(`Invalid decimal format: ${trimmed}`);
        }

        // BigNumber doesn't handle decimals, so we need to handle them
        // For consistency with number handling, we'll truncate towards zero
        // If you need decimal precision, use parseUnits with appropriate decimals
        let integerPart = parts[0];

        // Handle cases like '.5' or '-.5'
        if (!integerPart || integerPart === '' || integerPart === '-') {
          integerPart = '0';
        }

        // Validate the integer part is a valid number
        if (!/^-?\d+$/.test(integerPart) && integerPart !== '0') {
          throw new Error(`Invalid decimal format: ${trimmed}`);
        }

        return BigNumber.from(integerPart);
      }

      return BigNumber.from(trimmed);
    }

    // Handle numbers
    if (typeof value === 'number') {
      // Convert to non-scientific integer string, truncating decimals
      const integerStr = numberToIntegerString(value);
      return BigNumber.from(integerStr);
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

    // Preserve the original error message to keep behavior aligned with existing tests
    throw new Error(`${context ? `${context}: ` : ''}${error.message}`);
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
