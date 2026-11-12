import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { reloadAppAsync } from 'expo';
import { canResetNativeWalletStorage, resetNativeWalletStorage } from '../storage/native';
import { authorizePublicView, isNativeCredentialPromptActive } from '../platform/credential';
import { isOperationAuthenticationCancellation } from '../core/operationAuthentication';
import { WalletStorageError } from '../storage/types';
import { useNativeTranslation } from '../platform/localization';
import { Button, colors, Header, Icon, Notice, Screen, Text } from '../ui';

type Props = {
  onBack(): void;
  captureOwner(): () => void;
  onAvailability(available: boolean): void;
  onResetOwner(signal: AbortSignal, active: boolean): void;
};
type Owner = { live: boolean; request: AbortController | null; assertCurrent(): void };

/** Explicit recovery of an absent database, never a reset option for a present wallet. */
export function OrphanedStorageRecovery(props: Props) {
  const { t } = useNativeTranslation();
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; }, [props]);
  const owner = useRef<Owner | null>(null);
  const [available, setAvailable] = useState(false);
  type Step = 'intro' | 'confirm' | 'working' | 'reset' | 'reopen';
  const [step, setStep] = useState<Step>('intro');
  const phase = useRef(step);
  const setPhase = useCallback((value: Step) => { phase.current = value; setStep(value); }, []);
  const [error, setError] = useState(false);

  useEffect(() => {
    const check = latest.current.captureOwner();
    const life: Owner = { live: true, request: null, assertCurrent: check }; owner.current = life;
    void canResetNativeWalletStorage().then(value => {
      if (!life.live || owner.current !== life) return;
      try { check(); } catch { return; }
      setAvailable(value); latest.current.onAvailability(value);
    }).catch(() => undefined);
    const cancel = () => life.request?.abort();
    const change = AppState.addEventListener('change', state => {
      if (state !== 'active' && !(life.request && isNativeCredentialPromptActive(life.request.signal))) cancel();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      if (!(life.request && isNativeCredentialPromptActive(life.request.signal))) cancel();
    }) : null;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (life.request) { cancel(); return true; }
      if (phase.current === 'confirm') { setPhase('intro'); return true; }
      return false;
    });
    return () => {
      life.live = false; cancel();
      if (owner.current === life) owner.current = null;
      change.remove(); blur?.remove(); back.remove();
    };
  }, [setPhase]);

  const restart = async () => {
    const life = owner.current;
    if (!life?.live || !['reset', 'reopen'].includes(phase.current)) return;
    try {
      life.assertCurrent();
      await reloadAppAsync('Pali orphaned setup reset');
    }
    catch { /* The completion screen also explains how to restart manually. */ }
  };
  const reset = async () => {
    const life = owner.current;
    if (!life?.live || life.request || phase.current !== 'confirm' || AppState.currentState !== 'active') return;
    const request = new AbortController(); life.request = request;
    latest.current.onResetOwner(request.signal, true);
    const parentCheck = life.assertCurrent;
    const check = () => {
      if (!life.live || owner.current !== life || life.request !== request || request.signal.aborted ||
          (AppState.currentState !== 'active' && !isNativeCredentialPromptActive(request.signal))) throw Error('CANCELLED');
      parentCheck();
    };
    setError(false); setPhase('working');
    try {
      check();
      await resetNativeWalletStorage({ signal: request.signal, assertCurrent: check, async authorize() {
        await authorizePublicView(request.signal, check);
      } });
      check(); setPhase('reset');
      // Reset completes and releases its native lease before requesting a fresh JS runtime.
      await restart();
    } catch (cause) {
      if (life.live && owner.current === life) {
        if (cause instanceof WalletStorageError && cause.code === 'STORAGE_REOPEN_REQUIRED') {
          setPhase('reopen'); setError(false);
        } else {
          setPhase('intro'); setError(!request.signal.aborted && !isOperationAuthenticationCancellation(cause));
        }
      }
    } finally {
      latest.current.onResetOwner(request.signal, false);
      request.abort(); if (life.request === request) life.request = null;
    }
  };

  if (!available) return null;
  const finished = step === 'reset' || step === 'reopen';
  const confirmed = step === 'confirm' || step === 'working';
  const heading = step === 'reset' ? 'mobile.storageRecovery.complete'
    : step === 'reopen' ? 'mobile.storageRecovery.reopenRequired'
    : confirmed ? 'mobile.storageRecovery.confirmTitle' : 'mobile.storageRecovery.title';
  const body = finished ? 'mobile.storageRecovery.restart'
    : confirmed ? 'mobile.storageRecovery.confirmBody' : 'mobile.storageRecovery.body';
  const back = step === 'intro' ? () => { if (phase.current === 'intro') latest.current.onBack(); }
    : step === 'confirm' ? () => { if (phase.current === 'confirm') setPhase('intro'); } : undefined;
  const footer = finished
    ? <Button title={t('buttons.continue')} icon="arrow-right" onPress={() => { void restart(); }} />
    : <>
      <Button title={t(step === 'working' ? 'mobile.storageRecovery.working' : 'mobile.storageRecovery.action')}
        variant={step === 'intro' ? 'primary' : 'danger'} disabled={step === 'working'}
        onPress={() => {
          if (phase.current !== step) return;
          if (step === 'intro') setPhase('confirm'); else void reset();
        }} />
      {step === 'confirm' && <Button title={t('buttons.cancel')} variant="secondary" onPress={() => {
        if (phase.current === 'confirm') setPhase('intro');
      }} />}
    </>;
  return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <Screen footer={footer} gap={20} scrollResetKey={step}>
      <Header title={t('mobile.walletViews.setUpYourWallet')} onBack={back} />
      <View style={s.intro}>
        <View style={s.symbol} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon name={step === 'reset' ? 'check' : 'shield-warning'} size={36}
            color={confirmed || step === 'reopen' ? colors.amber : colors.blue} />
        </View>
        <Text accessibilityRole="header" style={s.title}>{t(heading)}</Text>
        <Text style={s.body}>{t(body)}</Text>
        {error && <Notice title={t('mobile.storageRecovery.failed')} tone="amber" />}
      </View>
    </Screen>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  intro: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 20 },
  symbol: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { color: colors.text, fontSize: 28, lineHeight: 36, fontWeight: '600', letterSpacing: -0.5, textAlign: 'center', maxWidth: 340 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 25, textAlign: 'center', maxWidth: 340 },
});
