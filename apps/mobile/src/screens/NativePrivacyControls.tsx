import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PRIVACY_POOLS } from '../../../../source/utils/privacy/registry';
import { normalizePrivacyServiceOrigin } from '../../../../source/shared/privacyServiceOrigin';
import type { PrivacyPoolId, PrivacySyncStatus } from '../../../../source/utils/privacy/types';
import type { NativePrivacyControls as Controls } from '../privacy/privacyControls';
import type { createNativePrivacyPoolSync } from '../privacy/nativePrivacyPoolSync';
import { useNativeTranslation } from '../platform/localization';
import { Button, Card, colors, Header, Row, Screen, styles, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

type Pool = ReturnType<typeof createNativePrivacyPoolSync>;
type Props = { open(signal: AbortSignal, assertCurrent: () => void): Promise<Controls>; onBack(): void };
type Owner = { live: boolean; lifetime: AbortController; poolLifetime?: AbortController; pool?: Pool; opening?: Promise<Pool>; action: number; busy: boolean; pausing?: boolean };

/** Explicit foreground public-data controls. No polling, secret input or signing capability. */
export function NativePrivacyControls({ open, onBack }: Props) {
  const { t } = useNativeTranslation();
  const owner = useRef<Owner>({ live: false, lifetime: new AbortController(), action: 0, busy: false });
  const [controls, setControls] = useState<{ source: Props['open']; value: Controls }>();
  const [origin, setOrigin] = useState(''); const [savedOrigin, setSavedOrigin] = useState('');
  const [poolId, setPoolId] = useState<PrivacyPoolId>('eth-1');
  const [status, setStatus] = useState<PrivacySyncStatus>({ poolId: 'eth-1', phase: 'idle' });
  const [busy, setBusy] = useState(false); const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  const close = useCallback(() => {
    const current = owner.current; if (!current.live) return;
    current.live = false; current.action++; current.lifetime.abort(); current.poolLifetime?.abort();
    void current.pool?.dispose().catch(() => undefined); Keyboard.dismiss(); onBack();
  }, [onBack]);
  useEffect(() => {
    const current: Owner = { live: true, lifetime: new AbortController(), action: 0, busy: false };
    owner.current = current;
    const check = () => { if (!current.live || current.lifetime.signal.aborted || AppState.currentState !== 'active') throw Error('privacy_cancelled'); };
    void (async () => {
      try { const value = await open(current.lifetime.signal, check); check(); const url = await value.getOrigin(); check();
        setOrigin(url); setSavedOrigin(url); setControls({ source: open, value }); }
      catch { if (current.live) setError('privacy.serviceLoadFailed'); }
    })();
    const change = AppState.addEventListener('change', next => { if (next !== 'active') close(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', close) : undefined;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => { current.live = false; current.action++; current.lifetime.abort(); current.poolLifetime?.abort(); void current.pool?.dispose().catch(() => undefined); change.remove(); blur?.remove(); back.remove(); };
  }, [close, open]);
  const active = controls?.source === open ? controls.value : undefined;
  const resetPool = async (current: Owner) => {
    current.poolLifetime?.abort(); await current.pool?.dispose();
    if (current.opening) { try { await (await current.opening).dispose(); } catch { /* A retired opening publishes no state. */ } }
    current.pool = undefined; current.opening = undefined; current.poolLifetime = undefined;
  };
  const action = async (kind: 'refresh' | 'pause' | 'clear' | 'save', selection = poolId) => {
    const current = owner.current;
    if (!active || !current.live || (current.busy && kind !== 'pause') || (kind === 'pause' && (!current.pool || current.pausing))) return;
    if (kind === 'save') { try { normalizePrivacyServiceOrigin(origin); } catch { setError('privacy.serviceInvalid'); return; } }
    current.busy = true; current.pausing = kind === 'pause'; const revision = ++current.action;
    const check = () => { if (!current.live || current.action !== revision || current.lifetime.signal.aborted || AppState.currentState !== 'active') throw Error('privacy_cancelled'); };
    setBusy(true); setError(null); setSaved(false); Keyboard.dismiss();
    try {
      if (kind === 'save' || kind === 'clear') {
        if (kind === 'save') { const url = await active.changeOrigin(origin, savedOrigin); check(); setSavedOrigin(url); setOrigin(url); setSaved(true); }
        else await active.clearPublicData();
        check(); await resetPool(current); check(); setStatus({ poolId: selection, phase: 'idle' });
      } else if (kind === 'pause') {
        const next = await current.pool!.pause(); check(); setStatus(next);
      } else {
        if (!current.pool) {
          current.poolLifetime = new AbortController();
          const lifetime = current.poolLifetime;
          current.opening = active.openPool(selection, lifetime.signal, () => {
            if (!current.live || lifetime.signal.aborted || current.poolLifetime !== lifetime) throw Error('privacy_cancelled');
          });
          current.pool = await current.opening; check(); current.opening = undefined;
        }
        setRunning(true); const next = await current.pool.refresh(); check(); setStatus(next);
      }
    } catch { if (current.live && current.action === revision) setError(kind === 'save' ? 'privacy.serviceSaveFailed' : 'privacy.error'); }
    finally { if (current.live && current.action === revision) { current.busy = false; current.pausing = false; setBusy(false); setRunning(false); } }
  };
  const selectPool = async (id: PrivacyPoolId) => {
    const current = owner.current; if (current.busy || !current.live) return;
    current.action++; current.busy = true; setBusy(true);
    try { await resetPool(current); if (current.live) { setPoolId(id); setStatus({ poolId: id, phase: 'idle' }); setError(null); } }
    catch { if (current.live) setError('privacy.error'); }
    finally { current.busy = false; if (current.live) setBusy(false); }
  };
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<Button title={t('buttons.save')} disabled={!active || busy || origin === savedOrigin} onPress={() => { void action('save'); }} />}><Header title={t('privacy.serviceSettings')} onBack={close} />
        <Text style={styles.muted}>{t('privacy.serviceHelp')}</Text>
        <IdleTextInput accessibilityLabel={t('privacy.serviceOrigin')} value={origin} onChangeText={setOrigin} editable={!!active && !busy}
          autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={2048} style={s.input} />

        {saved && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('privacy.serviceSaved')}</Text>}
        <Text style={s.title}>{t('privacy.poolData')}</Text>
        <Card>{PRIVACY_POOLS.map(pool => <Row key={pool.id} title={`${pool.amount} ETH`} right={<Text>{pool.id === poolId ? '✓' : ''}</Text>}
          onPress={busy ? undefined : () => { void selectPool(pool.id); }} />)}</Card>
        <Text accessibilityLiveRegion="polite" style={styles.muted}>{t(`privacy.${running ? 'syncing' : status.phase}`)}</Text>
        <Button title={t(status.phase === 'paused' ? 'privacy.resume' : 'privacy.refresh')} icon="refresh" variant="secondary" disabled={!active || busy}
          onPress={() => { void action('refresh'); }} />
        {running && <Button title={t('privacy.pause')} variant="secondary" onPress={() => { void action('pause'); }} />}
        <Button title={t('privacy.clear')} variant="secondary" disabled={!active || busy} onPress={() => { void action('clear'); }} />
        {error && <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 }, input: { color: colors.text, backgroundColor: colors.surface, padding: 16, borderRadius: 16, marginVertical: 12 }, title: { fontSize: 20, fontWeight: '600', marginTop: 24 }, error: { color: colors.red } });
