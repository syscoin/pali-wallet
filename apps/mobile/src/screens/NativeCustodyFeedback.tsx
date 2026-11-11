import React from 'react';
import type { CustodyErrorCode } from '../custody/types';
import { colors, Text } from '../ui';

/** Static, typed feedback survives the account screen being revoked/unmounted. */
export function NativeCustodyFeedback({ error }: { error: CustodyErrorCode }) {
  const messages: Partial<Record<CustodyErrorCode, string>> = {
    DEVICE_UNLOCK_UNAVAILABLE: 'Device authentication was not completed. Please try again.',
    INVALID_CREDENTIAL: 'Device authentication was not completed. Please try again.',
    AUTH_THROTTLED: 'Authentication is temporarily unavailable. Please try again later.',
    INVALID_INPUT: 'The account change is no longer available. Please try again.',
    PENDING_TRANSFER: 'This account has an unresolved transfer. Check its transaction status before removing it.',
    ACCOUNT_LIMIT: 'Account limit reached. Use an existing account or restore a removed one. If you have 20 active accounts, remove one first.',
    ACCOUNT_NOT_REMOVABLE: 'Select another account before removing this one. Account 1 must remain on this device.',
    CANCELLED: 'Your wallet context changed. Please try again.',
    UNAVAILABLE: 'Pali could not confirm the saved wallet state. Your saved wallet has been preserved. Close and reopen Pali to continue.',
    CLEANUP_FAILED: 'Your saved wallet has been preserved. Close and reopen Pali to continue.',
  };
  return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: colors.red, fontSize: 14, lineHeight: 21 }}>
    {messages[error] ?? 'The account change could not be completed. Your saved wallet has been preserved. Please try again.'}
  </Text>;
}
