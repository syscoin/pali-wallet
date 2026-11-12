import type { RecoveryErrorCode, RecoveryOutcome } from '../custody/recoveryFlow';

type Translate = (key: string) => string;

export function recoveryErrorText(code: RecoveryErrorCode | 'INVALID_WORD_COUNT', t: Translate): string {
  switch (code) {
    case 'SAVED_WALLET_UNVERIFIED': return t('mobile.recoveryDevices.recovery.yourSavedWalletCouldNotBeVerified');
    case 'WRONG_PHRASE': return t('mobile.recoveryCopy.wrongPhrase');
    case 'AUTH_THROTTLED': return t('mobile.sendAssetViews.evm.tooManyUnsuccessfulAuthorizationAttemptsWaitAFewMinutesBefore');
    case 'INVALID_INPUT': return t('mobile.walletViews.checkYourRecoveryPhrase');
    case 'INVALID_WORD_COUNT': return t('mobile.recoveryCopy.wordCount');
    case 'REOPEN_REQUIRED': return t('mobile.walletViews.theWalletCouldNotBeReopenedCloseAndReopenPaliToUnlock');
  }
}

export function recoveryOutcomeText(outcome: RecoveryOutcome, t: Translate): string {
  if (outcome.kind === 'success') return t('mobile.recoveryCopy.restored');
  if (outcome.kind === 'uncertain') return t('mobile.recoveryCopy.uncertain');
  if (outcome.kind === 'cancelled') return t('mobile.recoveryCopy.cancelled');
  if (outcome.kind === 'expired') return t('mobile.recoveryCopy.expired');
  return outcome.code === 'STATE_CHANGED' || outcome.code === 'INVALID_SAVED_DATA'
    ? recoveryErrorText('SAVED_WALLET_UNVERIFIED', t) : t('mobile.recoveryCopy.unavailable');
}
