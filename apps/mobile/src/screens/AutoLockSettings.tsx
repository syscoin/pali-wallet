import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { idleMinutes, weakensIdlePolicy } from '../../../../source/shared/idleLockPolicy';
import type { IdleMode, SecurityPreferenceSnapshot } from '../core/securityPreferences';
import { securityPreferences } from '../platform/security';
import { IdleTextInput } from './IdleActivityBoundary';
import { Button, Header, Notice, Screen, Text, colors, styles } from '../ui';
export type IdlePreferenceSave = (expected: SecurityPreferenceSnapshot, minutes: number, password: string, assertCurrent: () => void) => Promise<unknown>;
export function AutoLockSettings({ mode, save, onBack }: { mode: IdleMode; save: IdlePreferenceSave; onBack(): void }) {
  const state = useSyncExternalStore(securityPreferences.subscribe, securityPreferences.getSnapshot, securityPreferences.getSnapshot);
  const value = state.value, current = value?.[mode === 'custody' ? 'custodyIdleMinutes' : 'watchIdleMinutes'];
  const [draft, setDraft] = useState(() => String(current ?? 5)), [password, setPassword] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [passwordScope, setPasswordScope] = useState({ mode, current });
  if (passwordScope.mode !== mode || passwordScope.current !== current) { setPasswordScope({ mode, current }); setPassword(''); }
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const life = useRef({ mounted: true, generation: 0, pending: false });
  useEffect(() => { const owned = life.current; owned.mounted = true; return () => { owned.mounted = false; owned.generation++; }; }, []);
  let minutes: number | null = null; try { if (/^(0|[1-9][0-9]{0,2})$/.test(draft)) minutes = idleMinutes(Number(draft)); } catch { /* Invalid draft stays local. */ }
  const weakening = current !== undefined && minutes !== null && weakensIdlePolicy(current, minutes);
  const change = (text: string) => { setPassword(''); setDraft(text); setConfirmed(false); setFeedback(''); };
  const back = () => { life.current.generation++; Keyboard.dismiss(); setPassword(''); onBack(); };
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; }); return () => listener.remove(); });
  const submit = async () => {
    if (!value || minutes === null || minutes === current || life.current.pending || (minutes === 0 && !confirmed) || mode === 'custody' && weakening && !password) return;
    const owned = life.current, generation = owned.generation, proposed = minutes, entered = password;
    owned.pending = true; setBusy(true); setPassword(''); setFeedback(''); Keyboard.dismiss();
    const check = () => { if (!owned.mounted || owned.generation !== generation || AppState.currentState !== 'active') throw Error('CANCELLED'); };
    try { check(); await save(value, proposed, entered, check); check(); setFeedback('Auto-lock setting saved.'); }
    catch { if (owned.mounted && owned.generation === generation) setFeedback('The setting could not be verified. Reopen security settings before saving again.'); }
    finally { owned.pending = false; if (owned.mounted && owned.generation === generation) setBusy(false); }
  };
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Screen>
    <Header title="Auto-lock" subtitle={mode === 'custody' ? 'Native wallet' : 'Watch accounts'} onBack={back} />
    <Text style={styles.muted}>{mode === 'custody' ? 'Lock wallet' : 'Hide watch accounts'} after foreground inactivity. Current: {current === 0 ? 'Off while open' : `${current ?? '—'} minutes`}.</Text>
    <Notice title="Background locking stays on" body="Pali still locks or hides this session when you leave the app or it loses focus. This setting never enables automatic unlock." />
    <View style={presetStyles.group}>{[5, 15, 30, 60, 120, 0].map(n => {
      const selected = draft === String(n);
      return <Button key={n} title={n === 0 ? 'Off while open' : `${n} minutes`}
        variant={selected ? 'primary' : 'secondary'}
        style={[presetStyles.button, selected && presetStyles.selected]}
        disabled={busy} onPress={() => change(String(n))} />;
    })}</View>
    <Text>Custom minutes (5–120, or 0 for Off)</Text><IdleTextInput accessibilityLabel="Auto-lock minutes" value={draft} onChangeText={change} keyboardType="number-pad" maxLength={3} editable={!busy} style={{ borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 12, padding: 16 }} />
    {minutes === null && <Text accessibilityRole="alert">Enter 0 or a whole number from 5 to 120.</Text>}
    {minutes === 0 && <><Notice title="Off while the app is open" body="This session can remain visible indefinitely without interaction. Background locking and password confirmations still apply." tone="amber" /><Button title={confirmed ? 'Off consequence acknowledged' : 'I understand the Off setting'} variant="secondary" disabled={busy} onPress={() => setConfirmed(true)} /></>}
    {mode === 'custody' && weakening && <><Text>Confirm your wallet password to lengthen or disable foreground auto-lock.</Text><IdleTextInput accessibilityLabel="Confirm auto-lock password" secureTextEntry autoCapitalize="none" autoComplete="off" textContentType="none" autoCorrect={false} spellCheck={false} importantForAutofill="noExcludeDescendants" value={password} onChangeText={setPassword} editable={!busy} maxLength={1024} style={{ borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 12, padding: 16 }} /></>}
    <Button title={busy ? 'Saving auto-lock…' : 'Save auto-lock'} disabled={busy || minutes === null || minutes === current || minutes === 0 && !confirmed || mode === 'custody' && weakening && !password} onPress={() => void submit()} />
    <Button title="Cancel" variant="secondary" onPress={back} />
    {!!feedback && <Text accessibilityLiveRegion="polite">{feedback}</Text>}
  </Screen></KeyboardAvoidingView>;
}

const presetStyles = StyleSheet.create({
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { flexBasis: '45%', flexGrow: 1, borderWidth: 1 },
  selected: { borderColor: colors.pink },
});
