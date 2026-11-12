import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { idleMinutes } from '../../../../source/shared/idleLockPolicy';
import type { IdleMode, SecurityPreferenceSnapshot } from '../core/securityPreferences';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { securityPreferences } from '../platform/security';
import { useNativeTranslation } from '../platform/localization';
import { IdlePressable, IdleTextInput } from './IdleActivityBoundary';
import { Button, Card, Header, Icon, Notice, Screen, Text, colors, styles } from '../ui';
export type IdlePreferenceSave = (expected: SecurityPreferenceSnapshot, minutes: number, signal: AbortSignal, authentication: NativePrivateAuthenticationScope, assertCurrent: () => void) => Promise<unknown>;
export function AutoLockSettings({ mode, save, onBack, lockUnavailable }: { mode: IdleMode; save: IdlePreferenceSave; onBack(): void; lockUnavailable?: string }) {
  const { t } = useNativeTranslation();
  const state = useSyncExternalStore(securityPreferences.subscribe, securityPreferences.getSnapshot, securityPreferences.getSnapshot);
  const value = state.value, current = value?.[mode === 'custody' ? 'custodyIdleMinutes' : 'watchIdleMinutes'];
  const [draft, setDraft] = useState(() => String(current ?? 0)), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const life = useRef<{ mounted: boolean; generation: number; pending: boolean; cancel?: () => void }>({ mounted: true, generation: 0, pending: false });
  useEffect(() => { const owned = life.current; owned.mounted = true; return () => { owned.mounted = false; owned.generation++; owned.cancel?.(); }; }, []);
  let minutes: number | null = null; try { if (/^(0|[1-9][0-9]{0,2})$/.test(draft)) minutes = idleMinutes(Number(draft)); } catch { /* Invalid draft stays local. */ }
  const change = (text: string) => { setDraft(text); setConfirmed(false); setFeedback(''); };
  const back = () => { life.current.generation++; life.current.cancel?.(); Keyboard.dismiss(); onBack(); };
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; }); return () => listener.remove(); });
  const submit = async () => {
    if (!value || minutes === null || minutes === current || life.current.pending || (minutes === 0 && !confirmed) || (minutes > 0 && lockUnavailable)) return;
    const owned = life.current, generation = owned.generation, proposed = minutes;
    const request = new AbortController(), authentication = createNativePrivateAuthenticationScope();
    owned.cancel = () => { request.abort(); authentication.retire(); };
    owned.pending = true; setBusy(true); setFeedback(''); Keyboard.dismiss();
    const check = () => { if (!owned.mounted || owned.generation !== generation || request.signal.aborted ||
      (AppState.currentState !== 'active' && !(allowsPrivateAuthenticationInterruption(authentication, AppState.currentState)))) throw Error('CANCELLED'); };
    try { check(); await save(value, proposed, request.signal, authentication, check); check(); setFeedback(t('mobile.viewLock.autoSaved')); }
    catch (error) { if (owned.mounted && owned.generation === generation) setFeedback(error instanceof Error && error.message === 'CANCELLED'
      ? t('mobile.viewLock.autoUnchanged') : t('mobile.viewLock.autoFailed')); }
    finally { request.abort(); authentication.retire(); owned.cancel = undefined; owned.pending = false; if (owned.mounted && owned.generation === generation) setBusy(false); }
  };
  return <SafeAreaView edges={['top', 'bottom']} style={styles.screen}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}><Screen gap={16} footer={<>
    <Button title={t(busy ? 'mobile.viewLock.autoSaving' : 'mobile.viewLock.autoSave')} disabled={busy || minutes === null || minutes === current || minutes === 0 && !confirmed || !!lockUnavailable && minutes !== 0} onPress={() => void submit()} />
    <Button title={t('buttons.cancel')} variant="secondary" onPress={back} />
  </>}>
    <Header title={t('mobile.viewLock.autoTitle')} subtitle={t(mode === 'custody' ? 'mobile.viewLock.wallet' : 'mobile.viewLock.watchAccounts')} onBack={back} />
    {lockUnavailable && <Notice title={t('mobile.viewLock.protectionTitle')} body={lockUnavailable} tone="amber" />}
    <Text style={styles.muted}>{t(mode === 'custody' ? 'mobile.viewLock.autoWalletDescription' : 'mobile.viewLock.autoWatchDescription', { value: current === 0 ? t('mobile.viewLock.autoOff') : current == null ? '—' : t('mobile.viewLock.autoMinutes', { count: current }) })}</Text>
    <Card>{[
      { value: 5, label: t('mobile.viewLock.autoMinutes', { count: 5 }) }, { value: 15, label: t('mobile.viewLock.autoMinutes', { count: 15 }) }, { value: 30, label: t('mobile.viewLock.autoMinutes', { count: 30 }) },
      { value: 60, label: t('mobile.viewLock.autoHour') }, { value: 120, label: t('mobile.viewLock.autoHours', { count: 2 }) }, { value: 0, label: t('mobile.viewLock.autoOff') },
    ].map(option => <IdlePressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
      accessibilityState={{ checked: draft === String(option.value), disabled: busy }} aria-checked={draft === String(option.value)}
      disabled={busy} onPress={() => change(String(option.value))}
      style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
        borderBottomWidth: option.value === 0 ? 0 : 1, borderBottomColor: colors.border, opacity: busy ? 0.42 : pressed ? 0.7 : 1 })}>
      <Text style={{ flex: 1 }}>{option.label}</Text>
      {draft === String(option.value) && <Icon name="check" size={20} color={colors.blue} />}
    </IdlePressable>)}</Card>
    <Text>{t('mobile.viewLock.autoCustom')}</Text><IdleTextInput accessibilityLabel={t('mobile.viewLock.autoInput')} value={draft} onChangeText={change} keyboardType="number-pad" maxLength={3} editable={!busy} style={{ borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 12, padding: 16 }} />
    {minutes === null && <Text accessibilityRole="alert">{t('mobile.viewLock.autoInvalid')}</Text>}
    {minutes === 0 && <><Notice title={t('mobile.viewLock.autoOffTitle')} body={t('mobile.viewLock.autoOffBody')} tone="amber" /><Button title={t(confirmed ? 'mobile.viewLock.autoAcknowledged' : 'mobile.viewLock.autoAcknowledge')} variant="secondary" disabled={busy} onPress={() => setConfirmed(true)} /></>}
    <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>{t('mobile.viewLock.autoLifecycle')}</Text>
    {!!feedback && <Text accessibilityLiveRegion="polite">{feedback}</Text>}
  </Screen></KeyboardAvoidingView></SafeAreaView>;
}
