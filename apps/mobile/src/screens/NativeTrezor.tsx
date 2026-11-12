import { useNativeTranslation } from '../platform/localization';
import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  NativeTrezorResumeIntent,
  NativeTrezorView,
} from '../custody/trezorAccounts';
import { Button, Card, colors, Header, Screen, styles, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

/** Suite handoffs keep only a public draft; unlock never resumes signing. */
export function NativeTrezor({
  controller,
  onBack,
  onImported,
  onResumeSend,
}: {
  controller: NativeTrezorView;
  onBack(): void;
  onImported(): void;
  onResumeSend(intent: NativeTrezorResumeIntent): void | Promise<void>;
}) {
  const { t } = useNativeTranslation();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [label, setLabel] = useState('Trezor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closeFailed, setCloseFailed] = useState(false);
  const lifetime = useRef({ active: true, busy: false, closing: false, epoch: 0 });
  const callbacks = useRef({ onBack, onImported, onResumeSend });
  useLayoutEffect(() => {
    callbacks.current = { onBack, onImported, onResumeSend };
  }, [onBack, onImported, onResumeSend]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    const owner = lifetime.current;
    if (!owner.active || owner.busy || owner.closing) return;
    owner.busy = true;
    const epoch = owner.epoch;
    setBusy(true);
    setError('');
    Keyboard.dismiss();
    try {
      await operation();
    } catch {
      if (owner.active && !owner.closing && owner.epoch === epoch)
        setError(t('mobile.recoveryDevices.trezor.theTrezorRequestCouldNotBeCompleted'));
    } finally {
      owner.busy = false;
      if (owner.active && !owner.closing && owner.epoch === epoch) setBusy(false);
    }
  }, [t]);
  const close = useCallback(() => {
    const owner = lifetime.current;
    if (!owner.active || owner.closing) return;
    owner.closing = true;
    owner.epoch++;
    setCloseFailed(false);
    setBusy(true);
    Keyboard.dismiss();
    void controller.cancel().then(() => {
      if (owner.active) callbacks.current.onBack();
    }, () => {
      if (owner.active) {
        owner.closing = false;
        setCloseFailed(true);
        setBusy(false);
        setError(t('mobile.recoveryDevices.trezor.theTrezorRequestIsStillClosingTry'));
      }
    });
  }, [controller, t]);

  useLayoutEffect(() => {
    const owner = { active: true, busy: false, closing: false, epoch: 0 };
    lifetime.current = owner;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => {
      owner.active = false;
      back.remove();
      // Ordinary background locking unmounts this view. Only explicit Back
      // cancels the public handoff; the runtime retires the old session.
    };
  }, [close]);

  const pending = snapshot.operation !== null;
  const waiting = snapshot.phase === 'opening' || snapshot.phase === 'waiting';
  const resume = snapshot.phase === 'resume';
  const feedback = snapshot.error || error;
  const continueRequest = () => {
    void run(async () => {
      const owner = lifetime.current;
      const epoch = owner.epoch;
      if (!pending) {
        await controller.startImport(label.trim());
        if (owner.active && !owner.closing && owner.epoch === epoch) callbacks.current.onImported();
      } else if (snapshot.operation === 'import') {
        await controller.resumeImport();
        if (owner.active && !owner.closing && owner.epoch === epoch) callbacks.current.onImported();
      } else {
        const intent = await controller.resumeSend();
        if (owner.active && !owner.closing && owner.epoch === epoch) await callbacks.current.onResumeSend(intent);
      }
    });
  };

  return (
    <SafeAreaView style={s.fill} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen
          footer={
            <Button
              title={resume ? t('buttons.continue') : t('mobile.recoveryDevices.trezor.openTrezorSuite')}
              disabled={busy || closeFailed || waiting || (!pending && !label.trim())}
              onPress={continueRequest}
            />
          }
        >
          <Header
            title={pending ? t('mobile.recoveryDevices.trezor.continueWithTrezor') : t('mobile.accounts.connectTrezor')}
            subtitle={snapshot.networkLabel || t('mobile.recoveryDevices.ledger.hardwareWallet')}
            onBack={close}
          />
          <Text style={styles.muted}>
            {resume && snapshot.operation !== 'import'
              ? t('mobile.recoveryDevices.trezor.reviewTheRequestAgainBeforeContinuing')
              : t('mobile.recoveryDevices.trezor.connectYourTrezorInTrezorSuiteThen')}
          </Text>
          {feedback ? (
            <Text accessibilityRole="alert" style={s.error}>{feedback}</Text>
          ) : null}
          {!pending && (
            <Card style={s.card}>
              <Text style={s.label}>{t('mobile.accounts.accountName')}</Text>
              <IdleTextInput
                accessibilityLabel={t('mobile.recoveryDevices.trezor.trezorAccountName')}
                value={label}
                onChangeText={setLabel}
                editable={!busy}
                maxLength={64}
                autoCorrect={false}
                autoCapitalize="words"
                style={s.input}
              />
            </Card>
          )}
          {snapshot.address && (
            <Card style={s.card}>
              <Text style={s.label}>{snapshot.accountLabel || t('mobile.recoveryDevices.trezor.trezorAccount')}</Text>
              <Text selectable style={s.address}>{snapshot.address}</Text>
            </Card>
          )}
          {snapshot.signer && (
            <Card style={s.card}>
              <Text style={s.label}>{t('mobile.recoveryDevices.trezor.expectedSigner')}</Text>
              {snapshot.signer.total > 1 && (
                <Text accessibilityLiveRegion="polite" style={s.label}>
                  {t('mobile.recoveryDevices.trezor.signerProgress', { step: snapshot.signer.step, total: snapshot.signer.total })}
                </Text>
              )}
              <Text style={s.label}>{snapshot.signer.label}</Text>
              <Text selectable style={s.address}>
                {snapshot.signer.address}
              </Text>
            </Card>
          )}
          {(waiting || busy) && (
            <View style={s.waiting}>
              <ActivityIndicator color={colors.pink} />
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                {snapshot.phase === 'importing' ? t('mobile.recoveryDevices.ledger.addingAccount') : t('mobile.recoveryDevices.trezor.waitingForTrezor')}
              </Text>
            </View>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function NativeTrezorResumeNotice({ controller, onResume }: {
  controller: NativeTrezorView;
  onResume(): void;
}) {
  const { t } = useNativeTranslation();
  const snapshot = useSyncExternalStore(
    controller.subscribe, controller.getSnapshot, controller.getSnapshot
  );
  if (snapshot.phase !== 'resume') return null;
  return <Button title={t('mobile.recoveryDevices.trezor.continueTrezorRequest')} variant="secondary" size="compact" onPress={onResume} />;
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 16 },
  label: { ...styles.muted, marginBottom: 8 },
  input: { ...styles.text, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 14, minHeight: 48 },
  address: { color: colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  error: { color: colors.red },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
});
