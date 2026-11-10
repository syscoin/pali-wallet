import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeSentryKeyManagement } from '../custody/sentryKeyManagement';
import { Button, colors, Header, Screen, styles, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';
import { NoteBackupPasswordField } from './NoteBackupPasswordField';

type Props = {
  manager: Pick<NativeSentryKeyManagement, 'getSettings' | 'saveSettings'>;
  assertCurrent(): void;
  networkLabel: string;
  onBack(): void;
};
type Owner = {
  live: boolean;
  busy: boolean;
  request: number;
  pending?: Promise<unknown>;
  returning?: boolean;
};

export function NativeSentrySettings({
  manager,
  assertCurrent,
  networkLabel,
  onBack,
}: Props) {
  const owner = useRef<Owner>({ live: false, busy: true, request: 0 });
  const [serviceUrl, setServiceUrl] = useState('');
  const [maxFeeSatoshis, setMaxFeeSatoshis] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [closing, setClosing] = useState(false);

  useLayoutEffect(() => {
    const current: Owner = { live: true, busy: true, request: 0 };
    owner.current = current;
    queueMicrotask(() => {
      if (!current.live) return;
      setClosing(false);
      setLoaded(false);
      setBusy(true);
      setPassword('');
      setNotice(undefined);
    });
    const check = () => {
      assertCurrent();
      if (!current.live || AppState.currentState !== 'active')
        throw new Error('CANCELLED');
    };
    current.pending = Promise.resolve()
      .then(() => {
        check();
        return manager.getSettings(check);
      })
      .then((settings) => {
        check();
        setServiceUrl(settings.serviceUrl);
        setMaxFeeSatoshis(settings.maxFeeSatoshis);
        setLoaded(true);
      })
      .catch(() => {
        if (current.live) setNotice('Could not load service settings.');
      })
      .finally(() => {
        current.busy = false;
        if (current.live) setBusy(false);
      });
    const change = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setPassword('');
    });
    return () => {
      current.live = false;
      current.returning = false;
      current.request++;
      change.remove();
    };
  }, [manager, assertCurrent]);

  const back = useCallback(() => {
    const current = owner.current;
    if (!current.live) return;
    current.live = false;
    current.request++;
    current.returning = true;
    setClosing(true);
    setPassword('');
    Keyboard.dismiss();
    void Promise.resolve(current.pending)
      .catch(() => undefined)
      .then(() => {
        if (owner.current === current && current.returning) onBack();
      });
  }, [onBack]);
  useLayoutEffect(() => {
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => hardware.remove();
  }, [back]);
  const save = async () => {
    const current = owner.current;
    if (!current.live || current.busy || !loaded) return;
    current.busy = true;
    const request = ++current.request;
    const entered = password;
    setPassword('');
    setBusy(true);
    setNotice(undefined);
    Keyboard.dismiss();
    const check = () => {
      assertCurrent();
      if (
        !current.live ||
        current.request !== request ||
        AppState.currentState !== 'active'
      )
        throw new Error('CANCELLED');
    };
    try {
      const pending = manager.saveSettings(
        { serviceUrl, maxFeeSatoshis },
        entered,
        check
      );
      current.pending = pending;
      const saved = await pending;
      check();
      setServiceUrl(saved.serviceUrl);
      setMaxFeeSatoshis(saved.maxFeeSatoshis);
      setNotice('Service settings saved.');
    } catch {
      if (current.live && current.request === request)
        setNotice(
          'Could not save settings. Check the service origin, fee limit and wallet password.'
        );
    } finally {
      current.busy = false;
      if (current.live && current.request === request) setBusy(false);
    }
  };

  if (closing)
    return (
      <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
        <Screen>
          <Header title="Service settings" subtitle={networkLabel} />
          <Text>Closing service settings…</Text>
        </Screen>
      </SafeAreaView>
    );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <KeyboardAvoidingView
        style={s.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen
          footer={
            <>
              <Button
                title={
                  busy ? (loaded ? 'Saving…' : 'Loading…') : 'Save settings'
                }
                disabled={
                  busy || !loaded || !serviceUrl || !maxFeeSatoshis || !password
                }
                onPress={() => {
                  void save();
                }}
              />
              <Button title="Cancel" variant="quiet" size="compact" onPress={back} />
            </>
          }
        >
          <Header
            title="Service settings"
            subtitle={networkLabel}
            onBack={back}
          />
          <Text style={styles.muted}>
            Choose the Sentry data service and maximum transaction fee for this
            network.
          </Text>
          <Text>Service origin</Text>
          <IdleTextInput
            accessibilityLabel="Sentry service origin"
            value={serviceUrl}
            onChangeText={setServiceUrl}
            editable={loaded && !busy}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            maxLength={2048}
            style={s.input}
          />
          {loaded && !serviceUrl && (
            <Text style={styles.muted}>
              No service origin is configured for this network.
            </Text>
          )}
          <Text>Maximum fee in satoshis</Text>
          <IdleTextInput
            accessibilityLabel="Maximum Sentry fee in satoshis"
            value={maxFeeSatoshis}
            onChangeText={setMaxFeeSatoshis}
            editable={loaded && !busy}
            keyboardType="number-pad"
            maxLength={8}
            style={s.input}
          />
          <NoteBackupPasswordField
            label="Confirm wallet password"
            value={password}
            onChange={setPassword}
            busy={busy || !loaded}
          />
          {notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  input: {
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
});
