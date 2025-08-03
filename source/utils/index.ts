export * from './account';
export * from './format';
export * from './formatTransactionValue';
export * from './getHost';
export * from './isNft';
export * from './logger';
export * from './network';
export * from './notifications';
export * from './formatTransactionValue';
export * from './transactions';
export * from './removeScientificNotation';
export * from './bigNumberUtils';
export * from './verifyZerosInValueAndFormat';
export * from './cleanErrorStack';
export * from './validateTransactionDataValue';
export * from './validatePrivateKey';
export * from './constants';
export * from './types';
export * from './storageAPI';
export * from './strings';
export * from './tokens';
export * from './navigationState';

/**
 * Safely extracts an error message from various error types
 * @param error - The error object, string, or unknown type
 * @param fallback - Fallback message if error message cannot be extracted
 * @returns The extracted error message or fallback
 */
export const extractErrorMessage = (
  error: unknown,
  fallback = 'An error occurred'
): string => {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return (error as Error).message;
  }

  return fallback;
};
