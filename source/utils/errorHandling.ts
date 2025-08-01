// Utility functions for handling transaction errors with specific messaging
import { truncate } from 'utils/index';
import { sanitizeSyscoinError } from 'utils/syscoinErrorSanitizer';

export const isBlacklistError = (error: any): boolean =>
  error?.message?.includes('Transaction blocked:') ||
  error?.message?.includes('Token approval blocked:') ||
  error?.message?.includes('Token transfer blocked:') ||
  error?.message?.includes('Connection blocked:');

export const isUserCancellationError = (error: any): boolean =>
  error?.message?.toLowerCase().includes('user rejected') ||
  error?.message?.toLowerCase().includes('user denied') ||
  error?.message?.toLowerCase().includes('cancelled') ||
  error?.code === 4001;

export const isDeviceLockedError = (error: any): boolean =>
  error?.message?.toLowerCase().includes('device locked') ||
  error?.message?.toLowerCase().includes('unlock');

export const isBlindSigningError = (error: any): boolean =>
  error?.message?.toLowerCase().includes('blind signing') ||
  error?.message?.toLowerCase().includes('enable contract data');

export const isSyscoinLibError = (error: any): boolean =>
  // Check for common Syscoin library errors that have specific handling
  error?.message?.toLowerCase().includes('syscoin') ||
  error?.message?.toLowerCase().includes('utxo') ||
  error?.code === 'SYSCOIN_ERROR' ||
  error?.type === 'SyscoinLibError';

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
