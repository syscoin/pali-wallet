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
        setError('The Trezor request could not be completed. Try again.');
    } finally {
      owner.busy = false;
      if (owner.active && !owner.closing && owner.epoch === epoch) setBusy(false);
    }
  }, []);
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
        setError('The Trezor request is still closing. Try again.');
      }
    });
  }, [controller]);

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
              title={resume ? 'Continue' : 'Open Trezor Suite'}
              disabled={busy || closeFailed || waiting || (!pending && !label.trim())}
              onPress={continueRequest}
            />
          }
        >
          <Header
            title={pending ? 'Continue with Trezor' : 'Connect Trezor'}
            subtitle={snapshot.networkLabel || 'Hardware wallet'}
            onBack={close}
          />
          <Text style={styles.muted}>
            {resume && snapshot.operation !== 'import'
              ? 'Review the request again before continuing.'
              : 'Connect your Trezor in Trezor Suite, then return to Pali to continue.'}
          </Text>
          {feedback ? (
            <Text accessibilityRole="alert" style={s.error}>{feedback}</Text>
          ) : null}
          {!pending && (
            <Card style={s.card}>
              <Text style={s.label}>Account name</Text>
              <IdleTextInput
                accessibilityLabel="Trezor account name"
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
              <Text style={s.label}>{snapshot.accountLabel || 'Trezor account'}</Text>
              <Text selectable style={s.address}>{snapshot.address}</Text>
            </Card>
          )}
          {(waiting || busy) && (
            <View style={s.waiting}>
              <ActivityIndicator color={colors.pink} />
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                {snapshot.phase === 'importing' ? 'Adding account…' : 'Waiting for Trezor…'}
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
  const snapshot = useSyncExternalStore(
    controller.subscribe, controller.getSnapshot, controller.getSnapshot
  );
  if (snapshot.phase !== 'resume') return null;
  return <Button title="Continue Trezor request" variant="secondary" onPress={onResume} />;
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 18 },
  label: { ...styles.muted, marginBottom: 8 },
  input: { ...styles.text, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 14, minHeight: 48 },
  address: { color: colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  error: { color: colors.red },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
});
