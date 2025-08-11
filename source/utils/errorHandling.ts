// Utility functions for handling transaction errors with specific messaging
import { truncate } from 'utils/index';
import { sanitizeSyscoinError } from 'utils/syscoinErrorSanitizer';

/**
 * Error detection utilities for Pali wallet
 *
 * These functions use a hybrid approach:
 * 1. Check standardized error codes first (e.g., 4001 for user rejection)
 * 2. Fall back to message pattern matching for hardware wallets and legacy errors
 *
 * We can't use exact matching everywhere because:
 * - Hardware wallet errors vary by manufacturer, browser API, and locale
 * - Some errors come from third-party libraries we don't control
 * - Error messages may be translated or vary by browser
 *
 * Security note: We limit pattern matching to specific known patterns
 * to avoid false positives that could be exploited. Where possible,
 * we use word boundaries (\b) and limit the scope of matches.
 *
 * Error codes reference:
 * - 4001: User rejected request (EIP-1193)
 * - TRANSACTION_CREATION_FAILED: Syscoin transaction building failed
 * - TRANSACTION_SEND_FAILED: Syscoin transaction broadcast failed
 * - INSUFFICIENT_FUNDS: Not enough balance for transaction + fee
 */

export const isBlacklistError = (error: any): boolean =>
  error?.message?.includes('Transaction blocked:') ||
  error?.message?.includes('Token approval blocked:') ||
  error?.message?.includes('Token transfer blocked:') ||
  error?.message?.includes('Connection blocked:');

export const isUserCancellationError = (error: any): boolean => {
  // Standard EIP-1193 user rejection error (most reliable)
  if (error?.code === 4001) return true;

  const message = error?.message || '';
  const lowerMessage = message.toLowerCase();

  // Check for specific messages used by ethErrors.provider.userRejectedRequest
  if (
    message === 'User rejected the request.' ||
    message === 'User closed popup window'
  ) {
    return true;
  }

  // Hardware wallet specific patterns
  // We need substring matching here because hardware wallet errors vary by:
  // - Device manufacturer (Ledger vs Trezor)
  // - Browser API (WebUSB vs WebHID)
  // - Language/locale
  // But we limit to specific known patterns to avoid false positives
  if (
    // User action patterns
    lowerMessage.includes('user rejected') ||
    lowerMessage.includes('user cancelled') ||
    lowerMessage.includes('user canceled') ||
    lowerMessage.includes('denied by the user') ||
    lowerMessage.includes('action cancelled') ||
    // Single word patterns but only at word boundaries to avoid false matches
    /\bcancelled\b/.test(lowerMessage) ||
    /\bcanceled\b/.test(lowerMessage)
  ) {
    return true;
  }

  // Check error names for hardware wallet cancellations
  const errorName = error?.name || '';
  if (
    errorName === 'TransportError' ||
    errorName === 'NotAllowedError' ||
    errorName === 'AbortError' ||
    errorName === 'UserCancel' ||
    errorName === 'DOMException'
  ) {
    // WebHID cancellation
    return true;
  }

  return false;
};

export const isDeviceLockedError = (error: any): boolean => {
  const message = error?.message || '';
  const lowerMessage = message.toLowerCase();

  // Check for specific locked device messages found in codebase
  return (
    lowerMessage.includes('locked device') ||
    lowerMessage.includes('ledger device locked') ||
    lowerMessage.includes('ledger device is locked') ||
    message === 'Device is locked' ||
    message === 'Please unlock your device'
  );
};

export const isBlindSigningError = (error: any): boolean => {
  const message = error?.message || '';
  const lowerMessage = message.toLowerCase();

  // Check for blind signing messages (maintain original patterns from codebase)
  return (
    lowerMessage.includes('please enable blind signing') ||
    lowerMessage.includes('blind signing') ||
    lowerMessage.includes('enable contract data')
  );
};

/**
 * Detect common EVM insufficient funds errors from providers/libraries
 * Covers patterns like:
 *  - "insufficient funds for gas * price + value"
 *  - "insufficient funds for intrinsic transaction cost"
 *  - Ethers.js Logger error code: INSUFFICIENT_FUNDS
 */
export const isEvmInsufficientFundsError = (error: any): boolean => {
  const message = error?.message || '';
  const lowerMessage = message.toLowerCase();

  if (error?.code === 'INSUFFICIENT_FUNDS') return true;

  return (
    lowerMessage.includes('insufficient funds') ||
    lowerMessage.includes('insufficient funds for gas * price + value') ||
    lowerMessage.includes(
      'insufficient funds for intrinsic transaction cost'
    ) ||
    lowerMessage.includes('base fee exceeds gas limit')
  );
};

export const isSyscoinLibError = (error: any): boolean =>
  // Check for structured Syscoin library errors
  error?.code === 'SYSCOIN_ERROR' ||
  error?.type === 'SyscoinLibError' ||
  // Check for specific error codes from syscoinjs-lib
  [
    'INSUFFICIENT_FUNDS',
    'SUBTRACT_FEE_FAILED',
    'TRANSACTION_CREATION_FAILED',
    'TRANSACTION_SEND_FAILED',
    'INVALID_INPUTS',
    'INVALID_ADDRESS',
    'NETWORK_ERROR',
  ].includes(error?.code);

/**
 * Handle transaction errors with specific messaging for all known error types
 * @param error - The error object
 * @param alert - Alert utility functions
 * @param t - Translation function
 * @param activeAccount - Account info for device-specific checks
 * @param activeNetwork - Network info for currency display in Syscoin errors
 * @param basicTxValues - Transaction values for fee-based error logic
 * @param sanitizeErrorMessage - Optional function to sanitize Syscoin errors
 * @returns true if error was handled specifically, false if generic handling needed
 */
export const handleTransactionError = (
  error: any,
  alert: any,
  t: any,
  activeAccount?: any,
  activeNetwork?: any,
  basicTxValues?: any,
  sanitizeErrorMessage?: (errorInput: any) => string
): boolean => {
  // Handle structured errors from syscoinjs-lib first
  if (isSyscoinLibError(error) && activeNetwork) {
    const sanitizedError = sanitizeSyscoinError(error);

    switch (sanitizedError.code) {
      case 'INSUFFICIENT_FUNDS':
        alert.error(
          t('send.insufficientFundsDetails', {
            shortfall: sanitizedError.shortfall?.toFixed(8) || '0',
            currency: activeNetwork.currency.toUpperCase(),
          })
        );
        return true;

      case 'SUBTRACT_FEE_FAILED':
        alert.error(
          t('send.subtractFeeFailedDetails', {
            fee: sanitizedError.fee?.toFixed(8) || '0',
            remainingFee: sanitizedError.remainingFee?.toFixed(8) || '0',
            currency: activeNetwork.currency.toUpperCase(),
          })
        );
        return true;

      case 'INVALID_FEE_RATE':
        alert.error(t('send.invalidFeeRate'));
        return true;

      case 'INVALID_AMOUNT':
        alert.error(t('send.invalidAmount'));
        return true;

      case 'INVALID_ASSET_ALLOCATION':
        alert.error(
          t('send.invalidAssetAllocation', {
            guid: sanitizedError.details || 'Unknown',
          })
        );
        return true;

      case 'TRANSACTION_SEND_FAILED':
        // Parse error message to extract meaningful part - sanitized message is already safe
        let errorMsg = sanitizedError.message || '';
        try {
          // Check if the sanitized message contains JSON error details
          const detailsMatch = errorMsg.match(/Details:\s*({.*})/);
          if (detailsMatch) {
            const errorDetails = JSON.parse(detailsMatch[1]);
            if (errorDetails.error && sanitizeErrorMessage) {
              // Re-sanitize the extracted error in case it contains unsafe content
              errorMsg = `Transaction failed: ${sanitizeErrorMessage(
                errorDetails.error
              )}`;
            }
          }
        } catch (e) {
          // If parsing fails, use the sanitized message
        }

        alert.error(
          t('send.transactionSendFailed', {
            message: errorMsg,
          })
        );
        return true;

      default:
        if (basicTxValues && basicTxValues.fee > 0.00001) {
          alert.error(
            `${truncate(sanitizedError.message || '', 166)} ${t(
              'send.reduceFee'
            )}`
          );
        } else {
          // Bypass i18n interpolation to prevent additional encoding
          const confirmErrorMessage = `Transaction creation failed (${sanitizedError.code}): ${sanitizedError.message}`;
          alert.error(confirmErrorMessage);
        }
        return true;
    }
  }

  // Handle blacklist errors with specific messages
  if (isBlacklistError(error)) {
    alert.error(error.message);
    return true;
  }

  // Handle user cancellation gracefully
  if (isUserCancellationError(error)) {
    alert.info(t('transactions.transactionCancelled'));
    return true;
  }

  // Handle device locked
  if (isDeviceLockedError(error)) {
    alert.warning(t('settings.lockedDevice'));
    return true;
  }

  // Handle EVM insufficient funds errors (gas/value)
  if (isEvmInsufficientFundsError(error)) {
    // Show a concise message that clearly points to gas fees requirement
    alert.error(t('send.insufficientFundsForGas'));
    return true;
  }

  // Handle Ledger blind signing requirement (device-specific check)
  if (activeAccount?.isLedgerWallet && isBlindSigningError(error)) {
    alert.warning(t('settings.ledgerBlindSigning'));
    return true;
  }

  // Handle Syscoin library errors with sanitized messages
  if (isSyscoinLibError(error) && sanitizeErrorMessage) {
    const sanitizedMessage = sanitizeErrorMessage(error);
    alert.error(sanitizedMessage);
    return true;
  }

  return false; // Generic error should be handled by caller
};
