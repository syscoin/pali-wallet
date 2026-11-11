import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { idleMinutes } from '../../../../source/shared/idleLockPolicy';
import type { IdleMode, SecurityPreferenceSnapshot } from '../core/securityPreferences';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { securityPreferences } from '../platform/security';
import { IdlePressable, IdleTextInput } from './IdleActivityBoundary';
import { Button, Card, Header, Icon, Notice, Screen, Text, colors, styles } from '../ui';
export type IdlePreferenceSave = (expected: SecurityPreferenceSnapshot, minutes: number, signal: AbortSignal, authentication: NativePrivateAuthenticationScope, assertCurrent: () => void) => Promise<unknown>;
export function AutoLockSettings({ mode, save, onBack }: { mode: IdleMode; save: IdlePreferenceSave; onBack(): void }) {
  const state = useSyncExternalStore(securityPreferences.subscribe, securityPreferences.getSnapshot, securityPreferences.getSnapshot);
  const value = state.value, current = value?.[mode === 'custody' ? 'custodyIdleMinutes' : 'watchIdleMinutes'];
  const [draft, setDraft] = useState(() => String(current ?? 5)), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const life = useRef<{ mounted: boolean; generation: number; pending: boolean; cancel?: () => void }>({ mounted: true, generation: 0, pending: false });
  useEffect(() => { const owned = life.current; owned.mounted = true; return () => { owned.mounted = false; owned.generation++; owned.cancel?.(); }; }, []);
  let minutes: number | null = null; try { if (/^(0|[1-9][0-9]{0,2})$/.test(draft)) minutes = idleMinutes(Number(draft)); } catch { /* Invalid draft stays local. */ }
  const change = (text: string) => { setDraft(text); setConfirmed(false); setFeedback(''); };
  const back = () => { life.current.generation++; life.current.cancel?.(); Keyboard.dismiss(); onBack(); };
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; }); return () => listener.remove(); });
  const submit = async () => {
    if (!value || minutes === null || minutes === current || life.current.pending || (minutes === 0 && !confirmed)) return;
    const owned = life.current, generation = owned.generation, proposed = minutes;
    const request = new AbortController(), authentication = createNativePrivateAuthenticationScope();
    owned.cancel = () => { request.abort(); authentication.retire(); };
    owned.pending = true; setBusy(true); setFeedback(''); Keyboard.dismiss();
    const check = () => { if (!owned.mounted || owned.generation !== generation || request.signal.aborted ||
      (AppState.currentState !== 'active' && !(AppState.currentState === 'inactive' && authentication.isAuthenticating()))) throw Error('CANCELLED'); };
    try { check(); await save(value, proposed, request.signal, authentication, check); check(); setFeedback('Auto-lock setting saved.'); }
    catch (error) { if (owned.mounted && owned.generation === generation) setFeedback(error instanceof Error && error.message === 'CANCELLED'
      ? 'Auto-lock was not changed.' : 'The setting could not be verified. Reopen security settings before saving again.'); }
    finally { request.abort(); authentication.retire(); owned.cancel = undefined; owned.pending = false; if (owned.mounted && owned.generation === generation) setBusy(false); }
  };
  return <SafeAreaView edges={['top', 'bottom']} style={styles.screen}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}><Screen gap={16} footer={<>
    <Button title={busy ? 'Saving auto-lock…' : 'Save auto-lock'} disabled={busy || minutes === null || minutes === current || minutes === 0 && !confirmed} onPress={() => void submit()} />
    <Button title="Cancel" variant="secondary" onPress={back} />
  </>}>
    <Header title="Auto-lock" subtitle={mode === 'custody' ? 'Native wallet' : 'Watch accounts'} onBack={back} />
    <Text style={styles.muted}>{mode === 'custody' ? 'Lock wallet' : 'Hide watch accounts'} after foreground inactivity. Current: {current === 0 ? 'Off while open' : `${current ?? '—'} minutes`}.</Text>
    <Card>{[
      { value: 5, label: '5 minutes' }, { value: 15, label: '15 minutes' }, { value: 30, label: '30 minutes' },
      { value: 60, label: '1 hour' }, { value: 120, label: '2 hours' }, { value: 0, label: 'Off while open' },
    ].map(option => <IdlePressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
      accessibilityState={{ checked: draft === String(option.value), disabled: busy }} aria-checked={draft === String(option.value)}
      disabled={busy} onPress={() => change(String(option.value))}
      style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
        borderBottomWidth: option.value === 0 ? 0 : 1, borderBottomColor: colors.border, opacity: busy ? 0.42 : pressed ? 0.7 : 1 })}>
      <Text style={{ flex: 1 }}>{option.label}</Text>
      {draft === String(option.value) && <Icon name="check" size={20} color={colors.blue} />}
    </IdlePressable>)}</Card>
    <Text>Custom minutes (5–120, or 0 for Off)</Text><IdleTextInput accessibilityLabel="Auto-lock minutes" value={draft} onChangeText={change} keyboardType="number-pad" maxLength={3} editable={!busy} style={{ borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 12, padding: 16 }} />
    {minutes === null && <Text accessibilityRole="alert">Enter 0 or a whole number from 5 to 120.</Text>}
    {minutes === 0 && <><Notice title="Off while the app is open" body="This session can remain visible indefinitely without interaction. Background locking and PIN confirmations still apply." tone="amber" /><Button title={confirmed ? 'Off consequence acknowledged' : 'I understand the Off setting'} variant="secondary" disabled={busy} onPress={() => setConfirmed(true)} /></>}
    <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>Pali still locks or hides this session when you leave the app or it loses focus. This setting never enables automatic unlock.</Text>
    {!!feedback && <Text accessibilityLiveRegion="polite">{feedback}</Text>}
  </Screen></KeyboardAvoidingView></SafeAreaView>;
}
