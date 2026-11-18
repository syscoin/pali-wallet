import React from 'react';
import type { CustodyErrorCode } from '../custody/types';
import { useNativeTranslation } from '../platform/localization';
import { colors, Text } from '../ui';

const messages: Partial<Record<CustodyErrorCode, string>> = {
  DEVICE_UNLOCK_UNAVAILABLE: 'mobile.accounts.invalidCredential',
  INVALID_CREDENTIAL: 'mobile.accounts.invalidCredential',
  AUTH_THROTTLED: 'mobile.accounts.throttled',
  PENDING_TRANSFER: 'mobile.accounts.pendingTransfer',
  ACCOUNT_LIMIT: 'mobile.importAccount.limit',
  ACCOUNT_NOT_REMOVABLE: 'mobile.accounts.notRemovable',
  CANCELLED: 'mobile.accounts.contextChanged',
  UNAVAILABLE: 'mobile.walletViews.yourSavedWalletHasBeenPreservedCloseAndReopenPaliToTryAgain',
  CLEANUP_FAILED: 'mobile.walletViews.yourSavedWalletHasBeenPreservedCloseAndReopenPaliToTryAgain',
};

/** Static, typed feedback survives the account screen being revoked/unmounted. */
export function NativeCustodyFeedback({ error }: { error: CustodyErrorCode }) {
  const { t } = useNativeTranslation();
  return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: colors.red, fontSize: 14, lineHeight: 21 }}>
    {t(messages[error] ?? 'mobile.accounts.failed')}
  </Text>;
}
