import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeOperationCredential } from '../custody/types';
import { Button, Card, colors, Icon, styles, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

export type TransactionAuthenticationProps = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  identity: string;
  method: NativeOperationCredential['method'];
  busy: boolean;
  error?: string;
  onConfirm(credential: NativeOperationCredential): void;
  onCancel(): void;
};

/** App consent before the host's real authentication ceremony. No signing authority lives here. */
export function TransactionAuthentication({ identity, method, busy, error, onConfirm, onCancel, title = 'Confirm transaction', description, confirmLabel }: TransactionAuthenticationProps) {
  const binding = useMemo(() => ({ identity, method }), [identity, method]);
  const live = useRef({ binding, active: false, submitted: false, wasBusy: false });
  const [form, setForm] = useState({ binding, password: '', fallback: false, submitted: false, wasBusy: false });
  if (form.binding !== binding) setForm({ binding, password: '', fallback: false, submitted: false, wasBusy: false });
  else if (form.submitted && busy && !form.wasBusy) setForm({ ...form, wasBusy: true });
  else if (form.submitted && !busy && (form.wasBusy || error)) setForm({ ...form, password: '', submitted: false, wasBusy: false });
  const current = form.binding === binding ? form : { binding, password: '', fallback: false, submitted: false, wasBusy: false };
  const passwordMethod = method === 'password' || current.fallback;

  useLayoutEffect(() => {
    const session = { binding, active: true, submitted: false, wasBusy: false };
    live.current = session;
    return () => {
      session.active = false;
      setForm(before => before.binding === binding ? { ...before, password: '' } : before);
    };
  }, [binding]);
  useLayoutEffect(() => {
    const session = live.current;
    if (session.binding !== binding) return;
    if (!busy && (session.wasBusy || error) && session.active) {
      session.submitted = false;
    }
    session.wasBusy = busy;
  }, [busy, binding, error]);

  const cancel = () => {
    const session = live.current;
    if (session.binding !== binding || !session.active) return;
    session.active = false;
    setForm({ binding, password: '', fallback: false, submitted: true, wasBusy: false });
    Keyboard.dismiss();
    onCancel();
  };
  const confirm = () => {
    const session = live.current;
    if (session.binding !== binding || !session.active || session.submitted || busy || passwordMethod && !current.password) return;
    session.submitted = true;
    const credential: NativeOperationCredential = passwordMethod
      ? { method: 'password', password: current.password } : { method: 'biometric' };
    setForm({ binding, password: '', fallback: current.fallback, submitted: true, wasBusy: false });
    Keyboard.dismiss();
    onConfirm(credential);
  };

  return <Modal visible transparent animationType="fade" onRequestClose={cancel}>
    <SafeAreaView style={s.overlay} accessibilityViewIsModal>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
          <Card style={s.card}>
            <View style={s.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Icon name={passwordMethod ? 'lock' : 'fingerprint'} size={26} color={colors.blue} /></View>
            <Text accessibilityRole="header" style={s.title}>{title}</Text>
            <Text style={styles.muted}>{description ?? (passwordMethod ? 'Enter your wallet password to confirm this transaction.' : 'Confirm with your device biometrics to continue.')}</Text>
            {passwordMethod && <View style={s.field}>
              <Text style={s.label}>Wallet password</Text>
              <IdleTextInput accessibilityLabel="Wallet password" value={current.password} secureTextEntry
                editable={!busy && !current.submitted} autoFocus autoCapitalize="none" autoCorrect={false} spellCheck={false}
                autoComplete="off" textContentType="none" importantForAutofill="noExcludeDescendants" maxLength={1024}
                style={s.input} selectionColor={colors.pink} onChangeText={password => {
                  const session = live.current;
                  if (session.binding === binding && session.active && !session.submitted && !busy) setForm({ binding, password, fallback: current.fallback, submitted: false, wasBusy: false });
                }} />
            </View>}
            {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
            <Button title={busy ? 'Confirming…' : confirmLabel ?? (passwordMethod ? 'Confirm transaction' : 'Confirm with biometrics')}
              disabled={busy || current.submitted || passwordMethod && !current.password} onPress={confirm} />
            {!passwordMethod && <Button title="Use password" variant="quiet" disabled={busy || current.submitted} onPress={() => {
              const session = live.current;
              if (session.binding === binding && session.active && !session.submitted && !busy) setForm({ binding, password: '', fallback: true, submitted: false, wasBusy: false });
            }} />}
            <Button title="Cancel" variant="quiet" onPress={cancel} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  card: { alignSelf: 'center', width: '100%', maxWidth: 420, padding: 20, gap: 14 },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 22, lineHeight: 30, fontWeight: '600' },
  field: { gap: 8 }, label: { color: colors.muted, fontSize: 13 },
  input: { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 52, fontSize: 16 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
