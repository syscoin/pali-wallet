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
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeLedgerView } from '../custody/ledgerAccounts';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

export function NativeLedger({
  controller,
  onBack,
  onImported,
}: {
  controller: NativeLedgerView;
  onBack(): void;
  onImported(): void;
}) {
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
  const callbacks = useRef({ onBack, onImported });
  useLayoutEffect(() => {
    callbacks.current = { onBack, onImported };
  }, [onBack, onImported]);
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
      if (owner.active && imported) callbacks.current.onImported();
    } catch {
      if (owner.active)
        setError('The Ledger request could not be completed. Try again.');
    } finally {
      owner.busy = false;
      if (owner.active) setBusy(false);
    }
  };
  const connecting = snapshot.phase === 'connecting';
  const importing = snapshot.phase === 'importing';
  const connected =
    (snapshot.phase === 'connected' || importing) && !!snapshot.address;
  const canScan = !busy && !connecting && !importing;
  const feedback = snapshot.error || error;

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
                title={importing ? 'Adding account…' : 'Add Ledger account'}
                disabled={busy || importing || !label.trim()}
                onPress={() => {
                  void run(() => controller.importAccount(label.trim()), true);
                }}
              />
            ) : undefined
          }
        >
          <Header
            title="Connect Ledger"
            subtitle={snapshot.networkLabel || 'Hardware wallet'}
            onBack={close}
          />
          <Text style={s.description}>
            {connected
              ? 'Review the address and choose a name for this account.'
              : 'Unlock your Ledger and turn on Bluetooth. Keep it nearby while connecting.'}
          </Text>
          {feedback ? (
            <Text accessibilityRole="alert" style={s.error}>
              {feedback}
            </Text>
          ) : null}
          {connected ? (
            <Card style={s.card}>
              <Text style={s.heading}>{snapshot.selectedName || 'Ledger'}</Text>
              <Text style={s.label}>Address</Text>
              <Text
                selectable
                accessibilityLabel="Ledger address"
                style={s.address}
              >
                {snapshot.address}
              </Text>
              <Text style={s.label}>Account name</Text>
              <IdleTextInput
                accessibilityLabel="Ledger account name"
                value={label}
                onChangeText={setLabel}
                editable={!busy && !importing}
                maxLength={64}
                autoCorrect={false}
                autoCapitalize="words"
                style={s.input}
              />
            </Card>
          ) : (
            <>
              {(connecting || snapshot.phase === 'scanning') && (
                <View style={s.status}>
                  <ActivityIndicator color={colors.pink} />
                  <Text accessibilityLiveRegion="polite" style={s.statusText}>
                    {connecting
                      ? 'Confirm the connection on your Ledger…'
                      : 'Looking for your Ledger…'}
                  </Text>
                </View>
              )}
              {snapshot.devices.map((device) => (
                <Button
                  key={device.id}
                  title={`${device.name} · ${device.model}`}
                  variant="secondary"
                  disabled={busy || connecting || importing}
                  onPress={() => {
                    void run(() => controller.select(device.id));
                  }}
                />
              ))}
              {snapshot.phase !== 'scanning' && (
                <Button
                  title="Find Ledger"
                  disabled={!canScan}
                  onPress={() => {
                    void run(() => controller.start());
                  }}
                />
              )}
            </>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  description: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  card: { gap: 12, padding: 18 },
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
