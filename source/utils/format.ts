import currency from 'currency.js';
import format from 'date-fns/format';

import { ONE_MILLION } from './constants';

/**
 * Add `...` to shorten a string. Keeps chars at the beginning and end
 */
export const ellipsis = (str: any, start = 7, end = 4): string => {
  if (typeof str !== 'string') return str;

  return `${str.substring(0, start)}...${str.substring(
    str.length - end,
    str.length
  )}`.toLowerCase();
};

export const formatWithDecimals = (value: number | string, precision = 2) => {
  const valueInNumber = Number(value);

  const decimals = valueInNumber.toString().split('.')[1];

  const decimalsLength = decimals && decimals.length;

  const factor = Math.pow(10, precision);

  return decimalsLength > 2
    ? Math.floor(valueInNumber * factor) / factor
    : valueInNumber.toFixed(2);
};

export const capitalizeFirstLetter = (string: string) =>
  string.charAt(0).toUpperCase() + string.slice(1);

const getYesterday = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);

  return date;
};

export const formatDate = (timestamp: string) => {
  const formatStyle = 'M-d-yyyy';
  const formatedDate = format(new Date(timestamp), formatStyle);

  const today = new Date();
  const yesterday = getYesterday();

  if (formatedDate === format(today, formatStyle)) return 'Today';
  if (formatedDate === format(yesterday, formatStyle)) return 'Yesterday';

  return formatedDate;
};

export const formatNumber = (num: number, min = 4, max = 4, maxSig = 4) =>
  num.toLocaleString(navigator.language, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    maximumSignificantDigits: maxSig,
  });

export const formatMillionNumber = (num: number) =>
  Intl.NumberFormat('en', {
    notation: 'compact',
    minimumFractionDigits: 0,
  }).format(num);

export const formatCurrency = (number: string, precision: number) => {
  if (Number(number) < 1e-6) {
    number = Number(number).toFixed(precision);
  }

  return currency(number, {
    separator: ',',
    symbol: '',
    precision,
  }).format();
};

export const formatBalanceDecimals = (
  number: number | string,
  hasSymbol: boolean
) => {
  const symbol = number.toString().split(' ')[3];
  const numberStr: string = hasSymbol
    ? number.toString().split(' ')[1]
    : number.toString();

  const [integerPart, decimalPart] = numberStr.split('.');

  const integerDigits: string = integerPart.slice(0, 10);

  const decimalDigits: string = decimalPart
    ? decimalPart.slice(0, 10 - integerDigits.length)
    : '';

  const formattedNumber: string =
    decimalDigits.length > 0
      ? `${integerDigits}.${decimalDigits}`
      : integerDigits;

  return hasSymbol ? `${formattedNumber} ${symbol}` : formattedNumber;
};

/**
 * Format a full precision balance for display
 * @param balance The full precision balance string
 * @param decimals Number of decimals to show (default 4)
 * @returns Formatted balance string
 */
export const formatFullPrecisionBalance = (
  balance: string | number,
  decimals = 4
): string => {
  const numBalance =
    typeof balance === 'string' ? parseFloat(balance) : balance;

  // Handle special cases
  if (numBalance === 0 || isNaN(numBalance)) {
    return '0';
  }

  // For very small balances, show with < prefix like MetaMask
  const threshold = Math.pow(10, -decimals);
  if (numBalance > 0 && numBalance < threshold) {
    return `< ${threshold.toFixed(decimals)}`;
  }

  // For large balances, use millions formatting
  if (numBalance >= ONE_MILLION) {
    return formatMillionNumber(numBalance);
  }

  // For normal balances, show up to 6 decimals but remove trailing zeros
  const maxDecimals = Math.min(decimals + 2, 6); // Show up to 6 decimals like MetaMask
  let formatted = numBalance.toFixed(maxDecimals);

  // Remove trailing zeros after decimal point
  formatted = formatted.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');

  // If still too long, truncate to requested decimals
  if (formatted.includes('.')) {
    const parts = formatted.split('.');
    if (parts[1] && parts[1].length > decimals) {
      formatted = numBalance.toFixed(decimals).replace(/\.?0+$/, '');
    }
  }

  return formatted;
};

/**
 * Format transaction amounts preserving full precision when needed
 * @param amount The amount to format
 * @param showFullPrecision Whether to show full precision for small amounts
 * @returns Formatted amount string
 */
export const formatTransactionAmount = (
  amount: string | number,
  showFullPrecision = true
): string => {
  const strAmount = String(amount);

  // If it's already a string with many decimals and we want full precision, return as is
  if (showFullPrecision && typeof amount === 'string' && amount.includes('.')) {
    const decimals = amount.split('.')[1];
    if (decimals && decimals.length > 6) {
      // Remove trailing zeros but keep significant digits
      return strAmount.replace(/(\.\d*?[1-9])0+$/, '$1');
    }
  }

  // Otherwise use standard formatting
  return formatFullPrecisionBalance(amount, 18);
};

/**
 * Truncate the `input` if length is greater than `size`
 *
 * Default `size` is 30
 */
export const truncate = (input: string, size = 30, dots = true) => {
  if (input.length < size) return input;

  return `${input.slice(0, size)} ${dots ? '...' : ''}`;
};

/**
 * remove double spaces, numbers and symbols
 *
 * transform in lowerCase
 */
export const formatSeedPhrase = (seed: string) => {
  const withoutDoubleSpacesRegex = /\s{2,}/g;
  const onlyLettersAndSpacesRegex = /[^a-zA-Z\s]/g;

  const onlyLettersAndSpacesSeed = seed.replace(onlyLettersAndSpacesRegex, ' ');
  const lowerCaseTransform = onlyLettersAndSpacesSeed.toLowerCase();
  const seedWithoutDoubleSpaces = lowerCaseTransform.replace(
    withoutDoubleSpacesRegex,
    ' '
  );

  const formattedSeed = seedWithoutDoubleSpaces.trim();
  const seedLength = formattedSeed.split(' ').length;

  if (seedLength === 12) {
    return formattedSeed;
  } else {
    return { seedLength, seedLengthError: true };
  }
};

/**
 * Converts from `someInputText` to `Some Input Text`
 */
export const camelCaseToText = (input: string) => {
  input = capitalizeFirstLetter(input);
  // this regex splits the string without removing the delimiters
  return input.split(/(?=[A-Z])/).join(' ');
};

export function parseJsonRecursively(jsonString: string) {
  try {
    const parsed = JSON.parse(jsonString);

    if (typeof parsed === 'object' && parsed !== null) {
      Object.keys(parsed).forEach((key) => {
        if (typeof parsed[key] === 'string') {
          parsed[key] = parseJsonRecursively(parsed[key]);
        }
      });
    }

    return parsed;
  } catch (error) {
    // if not a valid JSON, return the param
    return jsonString;
  }
}
export const areStringsPresent = (
  strToCheck: string,
  stringsArray: string[]
): boolean =>
  // Check if any string from stringsArray is present in strToCheck
  stringsArray.some((subString) => strToCheck.includes(subString));

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy text:', err);
    return false;
  }
};
