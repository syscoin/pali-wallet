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
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  NativeLedgerConnectionView,
  NativeLedgerView,
} from '../custody/ledgerAccounts';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

export function NativeLedger({
  controller,
  onBack,
  onFinished,
}: {
  controller: NativeLedgerView;
  onBack(): void;
  onFinished(): void;
}) {
  const { t } = useNativeTranslation();
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller]
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const lifetime = useRef({ active: true, busy: false });
  const callbacks = useRef({ onBack, onFinished });
  useLayoutEffect(() => {
    callbacks.current = { onBack, onFinished };
  }, [onBack, onFinished]);
  const [label, setLabel] = useState('Ledger');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => {
    lifetime.current.active = false;
    void controller.close().catch(() => undefined);
    callbacks.current.onBack();
  }, [controller]);

  useLayoutEffect(() => {
    const owner = { active: true, busy: false };
    lifetime.current = owner;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => {
      owner.active = false;
      back.remove();
      void controller.close().catch(() => undefined);
    };
  }, [controller, close]);

  const run = async (operation: () => Promise<void>, imported = false) => {
    const owner = lifetime.current;
    if (!owner.active || owner.busy) return;
    owner.busy = true;
    setBusy(true);
    setError('');
    try {
      await operation();
      if (owner.active && imported) callbacks.current.onFinished();
    } catch {
      if (owner.active)
        setError(t('mobile.recoveryDevices.ledger.theLedgerRequestCouldNotBeCompleted'));
    } finally {
      owner.busy = false;
      if (owner.active) setBusy(false);
    }
  };
  const importingAccount = controller.purpose === 'import';
  const connecting = snapshot.phase === 'connecting';
  const importing = snapshot.phase === 'importing';
  const connected =
    (snapshot.phase === 'connected' || importing) && !!snapshot.address;
  const canScan = !busy && !connecting && !importing;
  const feedback = snapshot.error || error;
  const retryLabel =
    snapshot.failure === 'disconnected'
      ? t('mobile.recoveryDevices.ledger.reconnectLedger')
      : snapshot.phase === 'error'
      ? t('mobile.connections.tryAgain')
      : t('mobile.recoveryDevices.ledger.findLedger');
  let actionLabel = t('privacy.deposit.done');
  if (importingAccount)
    actionLabel = importing ? t('mobile.recoveryDevices.ledger.addingAccount') : t('mobile.recoveryDevices.ledger.addLedgerAccount');
  let description =
    t('mobile.recoveryDevices.ledger.unlockYourLedgerAndTurnOnBluetooth');
  if (connected)
    description = importingAccount
      ? t('mobile.recoveryDevices.ledger.reviewTheAddressAndChooseAName')
      : t('mobile.recoveryDevices.ledger.yourLedgerIsConnectedReturnToReview');

  return (
    <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.safeArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen
          footer={
            connected ? (
              <Button
                title={actionLabel}
                disabled={
                  busy || importing || (importingAccount && !label.trim())
                }
                onPress={() => {
                  void run(
                    () =>
                      controller.purpose === 'import'
                        ? controller.importAccount(label.trim())
                        : controller.finishConnection(),
                    true
                  );
                }}
              />
            ) : snapshot.phase !== 'scanning' ? (
              <>
                {snapshot.failure === 'permission' &&
                  (Platform.OS === 'ios' || Platform.OS === 'android') &&
                  typeof Linking.openSettings === 'function' && (
                    <Button
                      title={t('mobile.recoveryDevices.ledger.openSettings')}
                      disabled={busy}
                      onPress={() => void run(() => Linking.openSettings())}
                    />
                  )}
                {snapshot.failure !== 'unsupported' && (
                  <Button
                    title={retryLabel}
                    variant={
                      snapshot.failure === 'permission'
                        ? 'secondary'
                        : 'primary'
                    }
                    disabled={!canScan}
                    onPress={() => void run(() => controller.start())}
                  />
                )}
              </>
            ) : undefined
          }
        >
          <Header
            title={t('mobile.accounts.connectLedger')}
            subtitle={snapshot.networkLabel || t('mobile.recoveryDevices.ledger.hardwareWallet')}
            onBack={close}
          />
          <Text style={s.description}>{description}</Text>
          {feedback ? (
            <Text accessibilityRole="alert" style={s.error}>
              {feedback}
            </Text>
          ) : null}
          {connected ? (
            <Card style={s.card}>
              <Text style={s.heading}>{snapshot.selectedName || 'Ledger'}</Text>
              <Text style={s.label}>{t('mobile.recoveryDevices.ledger.address')}</Text>
              <Text
                selectable
                accessibilityLabel={t('mobile.recoveryDevices.ledger.ledgerAddress')}
                style={s.address}
              >
                {snapshot.address}
              </Text>
              {importingAccount && (
                <>
                  <Text style={s.label}>{t('mobile.accounts.accountName')}</Text>
                  <IdleTextInput
                    accessibilityLabel={t('mobile.recoveryDevices.ledger.ledgerAccountName')}
                    value={label}
                    onChangeText={setLabel}
                    editable={!busy && !importing}
                    maxLength={64}
                    autoCorrect={false}
                    autoCapitalize="words"
                    style={s.input}
                  />
                </>
              )}
            </Card>
          ) : (
            <>
              {(connecting || snapshot.phase === 'scanning') && (
                <View style={s.status}>
                  <ActivityIndicator color={colors.pink} />
                  <Text accessibilityLiveRegion="polite" style={s.statusText}>
                    {connecting
                      ? t('mobile.recoveryDevices.ledger.confirmTheConnectionOnYourLedger')
                      : t('mobile.recoveryDevices.ledger.lookingForYourLedger')}
                  </Text>
                </View>
              )}
              {snapshot.devices.map((device) => (
                <Button
                  key={device.id}
                  title={`${device.name} · ${device.model}`}
                  variant="secondary"
                  size="compact"
                  disabled={busy || connecting || importing}
                  onPress={() => {
                    void run(() => controller.select(device.id));
                  }}
                />
              ))}
            </>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The send screen stays mounted underneath this account-bound connection flow. */
export function NativeLedgerConnectionModal({
  controller,
  onClose,
  onFinished,
}: {
  controller: NativeLedgerConnectionView;
  onClose(): void;
  onFinished(): void;
}) {
  const close = () => {
    void controller.close().catch(() => undefined);
    onClose();
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <NativeLedger
        controller={controller}
        onBack={onClose}
        onFinished={onFinished}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  description: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  card: { gap: 12, padding: 16 },
  heading: { fontSize: 20, fontWeight: '600' },
  label: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  address: {
    fontSize: 14,
    lineHeight: 22,
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    color: colors.text,
    fontSize: 16,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusText: { flex: 1 },
  error: { color: colors.red, lineHeight: 22 },
});
