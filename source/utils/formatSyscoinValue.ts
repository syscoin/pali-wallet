import { BigNumber } from '@ethersproject/bignumber';
import { formatUnits } from '@ethersproject/units';

import {
  numberToIntegerString,
  scientificToIntegerString,
} from './bigNumberString';

/**
 * Format Syscoin/UTXO values from satoshis (8 decimals) to display format
 * Handles precision correctly without using direct division
 * @param value Value in satoshis (as string, number, or BigNumber)
 * @param decimals Number of decimals to display (default 8)
 * @returns Formatted string value
 */
export const formatSyscoinValue = (
  value: string | number | BigNumber,
  decimals = 8
): string => {
  try {
    // Convert to BigNumber if needed
    let bnValue: BigNumber;

    if (BigNumber.isBigNumber(value)) {
      bnValue = value;
    } else if (typeof value === 'string') {
      // Handle hex strings
      if (value.startsWith('0x')) {
        bnValue = BigNumber.from(value);
      } else {
        // Handle scientific notation in decimal strings
        if (value.includes('e') || value.includes('E')) {
          const integerStr = scientificToIntegerString(value);
          bnValue = BigNumber.from(integerStr);
        } else {
          bnValue = BigNumber.from(value);
        }
      }
    } else if (typeof value === 'number') {
      // Convert number to non-scientific integer string first to avoid precision loss
      const integerStr = numberToIntegerString(value);
      bnValue = BigNumber.from(integerStr);
    } else {
      // Fallback
      return '0';
    }

    // Use formatUnits which properly handles the decimal conversion
    // UTXO uses 8 decimals (satoshis)
    return formatUnits(bnValue, decimals);
  } catch (error) {
    console.error('Error formatting Syscoin value:', error);
    return '0';
  }
};

/**
 * Convert display value back to satoshis
 * @param displayValue Value in SYS (as string or number)
 * @returns Value in satoshis as BigNumber
 */
export const toSatoshis = (displayValue: string | number): BigNumber => {
  try {
    // Handle null/undefined
    if (displayValue === null || displayValue === undefined) {
      return BigNumber.from('0');
    }

    const strValue =
      typeof displayValue === 'number'
        ? displayValue.toString()
        : String(displayValue);

    // Handle invalid strings
    if (!strValue || strValue === 'invalid') {
      return BigNumber.from('0');
    }

    // Split on decimal to handle fractional values
    const parts = strValue.split('.');
    const integerPart = parts[0] || '0';
    const decimalPart = parts[1] || '';

    // Pad or truncate decimal part to 8 places
    const paddedDecimal = decimalPart.padEnd(8, '0').substring(0, 8);

    // Combine to get satoshis
    const satoshis = integerPart + paddedDecimal;

    // Remove leading zeros but keep at least one digit
    const trimmed = satoshis.replace(/^0+/, '') || '0';

    return BigNumber.from(trimmed);
  } catch (error) {
    console.error('Error converting to satoshis:', error);
    return BigNumber.from('0');
  }
};

/**
 * Format Gwei values (9 decimals) to display format
 * @param value Value in wei (as string, number, or BigNumber)
 * @returns Formatted string value in Gwei
 */
export const formatGweiValue = (value: string | number | BigNumber): string => {
  try {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return '0';
    }

    // Convert to BigNumber if needed
    let bnValue: BigNumber;

    if (BigNumber.isBigNumber(value)) {
      bnValue = value;
    } else if (typeof value === 'string') {
      // Handle invalid strings
      if (value === 'invalid' || value === '') {
        return '0';
      }
      if (value.includes('e') || value.includes('E')) {
        const integerStr = scientificToIntegerString(value);
        bnValue = BigNumber.from(integerStr);
      } else {
        bnValue = BigNumber.from(value);
      }
    } else if (typeof value === 'number') {
      // Convert number to non-scientific integer string first to avoid precision loss
      const integerStr = numberToIntegerString(value);
      bnValue = BigNumber.from(integerStr);
    } else {
      return '0';
    }

    // Use formatUnits with 9 decimals for Gwei
    return formatUnits(bnValue, 9);
  } catch (error) {
    console.error('Error formatting Gwei value:', error);
    return '0';
  }
};

/**
 * Format a numeric value for display with intelligent decimal handling
 * Shows more decimals for small values, fewer for large values
 * @param value The numeric value to format
 * @param decimals Maximum decimals the token supports
 * @returns Formatted string for display
 */
export const formatDisplayValue = (value: number, decimals: number): string => {
  try {
    // Handle invalid values
    if (isNaN(value) || value === null || value === undefined) {
      return '0';
    }

    // Respect the token's decimal places but add reasonable limits for display
    const maxDisplayDecimals = Math.min(decimals, 8); // Cap at 8 for display

    // For very small values, show more precision
    if (value > 0 && value < 0.0001) {
      return value.toFixed(maxDisplayDecimals);
    } else if (value > 0 && value < 1) {
      // For small values, show up to 6 decimals or token's decimals, whichever is smaller
      return value.toFixed(Math.min(decimals, 6));
    } else {
      // For larger values, show up to 4 decimals or token's decimals, whichever is smaller
      return value.toFixed(Math.min(decimals, 4));
    }
  } catch {
    return '0';
  }
};
