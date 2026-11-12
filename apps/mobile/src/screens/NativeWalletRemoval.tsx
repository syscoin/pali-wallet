import { useNativeTranslation } from '../platform/localization';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WalletRemovalError, type NativeWalletRemoval as Removal, type WalletRemovalTicket } from '../custody/walletRemoval';
import { Button, colors, Header, Icon, Notice, Screen, styles, Text } from '../ui';
import { createNativePrivateAuthenticationScope, createNativePrivateAuthenticationChild, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { isOperationAuthenticationCancellation } from '../core/operationAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

export type RemovalScreenOutcome = 'removed' | 'unchanged' | 'unconfirmed';
type Props = {
  backupConfirmed: boolean;
  removal: Pick<Removal, 'authorize' | 'cancel'>;
  isCurrent(): boolean;
  confirm(ticket: WalletRemovalTicket, assertCurrent: () => void): Promise<RemovalScreenOutcome>;
  onBack(): void;
  onContinue(outcome: 'removed' | 'unchanged'): Promise<void>;
};
type Step = { phase: 'intro'; error?: string } | { phase: 'authorizing' } |
  { phase: 'review'; attempt: Attempt } | { phase: 'working'; cancelling?: true } |
  { phase: 'outcome'; outcome: RemovalScreenOutcome } | { phase: 'blocked' };
type Attempt = { cancelled: boolean; confirming: boolean; lifetime: AbortController; authentication: NativePrivateAuthenticationScope;
  ticket?: WalletRemovalTicket; timer?: ReturnType<typeof setTimeout> };
type Owner = { live: boolean; authentication: NativePrivateAuthenticationScope; attempt?: Attempt; finishing: boolean };
const CONFIRM_MS = 30_000;
const failure = (cause: unknown, t: ReturnType<typeof useNativeTranslation>['t']) => {
  const code = cause instanceof WalletRemovalError ? cause.code : undefined;
  if (code === 'INVALID_CREDENTIAL') return t('mobile.recoveryDevices.walletRemoval.deviceAuthenticationWasNotCompleted');
  if (code === 'AUTH_THROTTLED') return t('mobile.recoveryDevices.walletRemoval.tooManyUnsuccessfulAuthorizationAttemptsWaitBefore');
  return t('mobile.recoveryDevices.walletRemoval.couldNotAuthorizeWalletRemovalTryAgain');
};

function discardTicket(attempt: Attempt) {
  if (attempt.timer !== undefined) clearTimeout(attempt.timer);
  attempt.timer = undefined;
  attempt.ticket = undefined;
}

export function NativeWalletRemovalScreen({ removal, isCurrent, confirm, onBack, onContinue, backupConfirmed }: Props) {
  const { t } = useNativeTranslation();
  const life = useRef<Owner | undefined>(undefined);
  const [step, setStep] = useState<Step>({ phase: 'intro' });
  const [finishing, setFinishing] = useState(false);

  const cancel = useCallback((owner: Owner) => {
    const attempt = owner.attempt;
    if (attempt) {
      attempt.cancelled = true;
      attempt.lifetime.abort();
      attempt.authentication.retire();
      discardTicket(attempt);
      if (!attempt.confirming) owner.attempt = undefined;
    }
    removal.cancel();
  }, [removal]);

  useLayoutEffect(() => {
    const owner: Owner = { live: true, authentication: createNativePrivateAuthenticationScope(), finishing: false };
    life.current = owner;
    const hide = () => {
      if (life.current !== owner || !owner.live) return;
      cancel(owner);
      setStep((current) => current.phase === 'working' ? { phase: 'working', cancelling: true }
        : current.phase === 'outcome' || current.phase === 'blocked' ? current : { phase: 'intro' });
    };
    const change = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && !allowsPrivateAuthenticationInterruption(owner.authentication, state)) hide();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      if (!allowsPrivateAuthenticationInterruption(owner.authentication, 'blur')) hide();
    }) : null;
    return () => { owner.live = false; cancel(owner); owner.authentication.retire(); change.remove(); blur?.remove(); };
  }, [cancel]);

  const back = useCallback(() => {
    if (step.phase === 'outcome' || step.phase === 'blocked') return;
    const owner = life.current;
    if (!owner?.live) return;
    const confirming = owner.attempt?.confirming;
    cancel(owner);
    if (confirming) setStep({ phase: 'working', cancelling: true });
    else onBack();
  }, [cancel, onBack, step.phase]);
  useLayoutEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]);

  const authorize = async () => {
    const owner = life.current;
    if (!owner?.live || owner.attempt || AppState.currentState !== 'active' || !isCurrent()) return;
    const attempt: Attempt = { cancelled: false, confirming: false, lifetime: new AbortController(),
      authentication: createNativePrivateAuthenticationChild(owner.authentication) };
    owner.attempt = attempt;
    setStep({ phase: 'authorizing' });
    const current = () => life.current === owner && owner.live && owner.attempt === attempt && !attempt.cancelled && !attempt.lifetime.signal.aborted && isCurrent();
    const check = () => { if (!current()) throw new Error('CANCELLED'); };
    try {
      const ticket = await removal.authorize(attempt.lifetime.signal, attempt.authentication, check);
      check();
      if (AppState.currentState !== 'active') throw new Error('CANCELLED');
      attempt.ticket = ticket;
      attempt.timer = setTimeout(() => {
        if (!current() || attempt.confirming) return;
        cancel(owner);
        setStep({ phase: 'intro', error: t('mobile.recoveryDevices.walletRemoval.confirmationExpiredAuthorizeAgainToContinue') });
      }, CONFIRM_MS);
      setStep({ phase: 'review', attempt });
    } catch (cause) {
      if (!current()) return;
      attempt.lifetime.abort();
      attempt.authentication.retire();
      owner.attempt = undefined;
      setStep({ phase: 'intro', ...(isOperationAuthenticationCancellation(cause) ? {} : { error: failure(cause, t) }) });
    }
  };

  const remove = async (reviewed: Attempt) => {
    const owner = life.current;
    if (!owner?.live) return;
    const attempt = owner.attempt, ticket = attempt?.ticket;
    if (!attempt || attempt !== reviewed || !ticket || attempt.cancelled || attempt.confirming || AppState.currentState !== 'active' || !isCurrent()) return;
    discardTicket(attempt);
    attempt.confirming = true;
    setStep({ phase: 'working' });
    const check = () => {
      if (!owner.live || owner.attempt !== attempt || attempt.cancelled || !isCurrent()) throw new Error('CANCELLED');
    };
    let outcome: RemovalScreenOutcome;
    try { outcome = await confirm(ticket, check); } catch { outcome = 'unconfirmed'; }
    if (owner.live && owner.attempt === attempt) {
      attempt.lifetime.abort();
      attempt.authentication.retire();
      owner.attempt = undefined;
      setStep({ phase: 'outcome', outcome });
    }
  };

  const finish = async (outcome: 'removed' | 'unchanged') => {
    const owner = life.current;
    if (!owner?.live || owner.finishing || AppState.currentState !== 'active') return;
    owner.finishing = true;
    setFinishing(true);
    try { await onContinue(outcome); }
    catch { if (owner.live) setStep({ phase: 'blocked' }); }
    finally { owner.finishing = false; if (owner.live) setFinishing(false); }
  };

  const title = step.phase === 'outcome' ? step.outcome === 'removed' ? t('mobile.recoveryDevices.walletRemoval.walletRemoved') : step.outcome === 'unchanged' ? t('mobile.recoveryDevices.walletRemoval.walletKept') : t('mobile.recoveryDevices.walletRemoval.removalCouldNotBeConfirmed')
    : step.phase === 'blocked' ? t('mobile.recoveryDevices.walletRemoval.walletStorageUnavailable') : t('mobile.recoveryDevices.walletRemoval.removeWallet');
  const footer = step.phase === 'intro' ? <>
    <Button title={t('buttons.continue')} onPress={() => void authorize()} />
    <Button title={t('buttons.cancel')} variant="secondary" onPress={back} />
  </> : step.phase === 'review' ? <>
    {!backupConfirmed && <Notice title={t('mobile.recoveryDevices.walletRemoval.backupNotVerified')} body={t('mobile.recoveryDevices.walletRemoval.thisWalletHasNotBeenVerifiedAs')} tone="red" />}
    <Button title={t('mobile.recoveryDevices.walletRemoval.removeWallet')} variant="danger" onPress={() => void remove(step.attempt)} />
    <Button title={t('buttons.cancel')} variant="secondary" onPress={back} />
  </> : step.phase === 'authorizing' ? <Button title={t('buttons.cancel')} variant="secondary" onPress={back} />
    : step.phase === 'working' && !step.cancelling ? <Button title={t('mobile.recoveryDevices.walletRemoval.cancelRemoval')} variant="secondary" onPress={back} />
    : step.phase === 'outcome' && step.outcome !== 'unconfirmed' ? <Button title={step.outcome === 'removed' ? t('buttons.continue') : t('mobile.recoveryDevices.walletRemoval.returnToWallet')} disabled={finishing} onPress={() => {
      if (step.outcome !== 'unconfirmed') void finish(step.outcome);
    }} /> : undefined;
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <View style={s.fill}>
      <Screen gap={16} footer={footer}>
        <Header title={title} onBack={step.phase === 'outcome' || step.phase === 'blocked' ? undefined : back} />
        {step.phase === 'intro' && <>
          <Text>{t('mobile.recoveryDevices.walletRemoval.removingThisWalletDeletesItsAccountsSentry')}</Text>
          <Notice title={t('mobile.recoveryDevices.walletRemoval.checkYourBackups')} body={t('mobile.recoveryDevices.walletRemoval.yourRecoveryPhraseRestoresDerivedAccountsImported')} tone="amber" />
          <Text style={styles.muted}>{t('mobile.recoveryDevices.walletRemoval.transfersAlreadySentCanStillCompleteWatch')}</Text>
          {step.error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{step.error}</Text>}
        </>}
        {step.phase === 'authorizing' && <>
          <Text accessibilityLiveRegion="polite">{t('mobile.recoveryDevices.walletRemoval.authorizingWalletRemoval')}</Text>
        </>}
        {step.phase === 'review' && <>
          <View style={s.reviewHero}>
            <View style={s.trash} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Icon name="trash" size={32} color={colors.pink} /></View>
            <Text style={s.question}>{t('mobile.recoveryDevices.walletRemoval.removeWalletFromThisPhone')}</Text>
            <Text style={s.reviewCopy}>{t('mobile.recoveryDevices.walletRemoval.youWillNeedYourRecoveryPhraseAnd')}</Text>
          </View>
        </>}
        {step.phase === 'working' && <>
          <Text accessibilityLiveRegion="polite">{step.cancelling ? t('mobile.recoveryDevices.walletRemoval.checkingWhetherRemovalCompleted') : t('mobile.recoveryDevices.walletRemoval.removingWalletAndCheckingStorage')}</Text>
        </>}
        {step.phase === 'outcome' && <>
          {step.outcome === 'removed' && <Text accessibilityLiveRegion="polite">{t('mobile.recoveryDevices.walletRemoval.paliVerifiedThatTheLocalWalletRecords')}</Text>}
          {step.outcome === 'unchanged' && <Text accessibilityLiveRegion="polite">{t('mobile.recoveryDevices.walletRemoval.removalDidNotCompleteYourWalletRecords')}</Text>}
          {step.outcome === 'unconfirmed' && <Text accessibilityRole="alert">{t('mobile.recoveryDevices.walletRemoval.paliCouldNotVerifyWhetherRemovalCompleted')}</Text>}
        </>}
        {step.phase === 'blocked' && <Text accessibilityRole="alert">{t('mobile.recoveryDevices.walletRemoval.closeAndReopenPaliToCheckThis')}</Text>}
      </Screen>
    </View>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  reviewHero: { alignItems: 'center', paddingVertical: 24, gap: 20 },
  trash: { width: 72, height: 72, borderRadius: 22, backgroundColor: '#301f2c', borderWidth: 1, borderColor: '#784153', alignItems: 'center', justifyContent: 'center' },
  question: { color: colors.text, fontSize: 24, lineHeight: 33, fontWeight: '600', textAlign: 'center' },
  reviewCopy: { color: colors.muted, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  error: { color: colors.red },
});
