/**
 * Detects if an error was caused by user cancellation of hardware wallet connection
 * @param error - The error object to check
 * @returns true if the error indicates user cancellation
 */
export const isUserCancellationError = (error: any): boolean => {
  const errorMessage = (error?.message || '').toLowerCase();
  const errorName = error?.name || '';

  // Common patterns for user cancellation across different hardware wallets and browsers
  return (
    errorMessage.includes('user cancelled') ||
    errorMessage.includes('user canceled') ||
    errorMessage.includes('not allowed') ||
    errorMessage.includes('action cancelled by user') ||
    errorMessage.includes('cancelled') ||
    errorMessage.includes('canceled') ||
    errorMessage.includes('permission denied') ||
    errorMessage.includes('user rejected') ||
    errorMessage.includes('denied by the user') ||
    errorMessage.includes('transport') ||
    errorMessage.includes('failure_actioncancelled') ||
    errorName === 'NotAllowedError' ||
    errorName === 'AbortError' ||
    errorName === 'UserCancel' ||
    errorName === 'TransportError' ||
    errorName === 'DOMException' // WebHID cancellation
  );
};

/**
 * Detects if an error indicates the hardware wallet device is locked
 * @param error - The error object to check
 * @returns true if the error indicates a locked device
 */
export const isDeviceLockedError = (error: any): boolean => {
  const errorMessage = (error?.message || '').toLowerCase();
  return errorMessage.includes('locked device');
};

/**
 * Detects if an error indicates blind signing is required for Ledger
 * @param error - The error object to check
 * @returns true if the error indicates blind signing is needed
 */
export const isBlindSigningError = (error: any): boolean => {
  const errorMessage = (error?.message || '').toLowerCase();
  return (
    errorMessage.includes('please enable blind signing') ||
    errorMessage.includes('blind signing')
  );
};
