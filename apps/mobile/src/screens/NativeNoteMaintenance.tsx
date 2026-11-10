import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { IPrivateNoteView } from '../../../../source/utils/privacy/privateVaultTypes';
import type { NativeNoteMaintenanceRuntime } from '../custody/noteBackupRuntime';
import { useNativeTranslation } from '../platform/localization';
import { Button, Card, colors, Header, Row, Screen, styles, Text } from '../ui';
import { PinField } from './PinEntry';

type Props = {
  open(signal: AbortSignal, assertCurrent: () => void): Promise<NativeNoteMaintenanceRuntime>;
  onBack(): void;
};
type Owner = { live: boolean; abort: AbortController; busy: boolean; request?: object };

/** Only the real bound vault adapter can enter this screen. Opening performs no note-specific RPC. */
export function NativeNoteMaintenance({ open, onBack }: Props) {
  const { t } = useNativeTranslation();
  const owner = useRef<Owner>({ live: false, abort: new AbortController(), busy: false });
  const [runtime, setRuntime] = useState<{ source: Props['open']; value: NativeNoteMaintenanceRuntime }>();
  const [notes, setNotes] = useState<readonly IPrivateNoteView[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ removed: number; unresolved: number } | null>(null);
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null);
  const close = useCallback(() => {
    const current = owner.current;
    if (!current.live) return;
    current.live = false; current.abort.abort(); setPassword(''); Keyboard.dismiss(); onBack();
  }, [onBack]);
  useEffect(() => {
    const current: Owner = { live: true, abort: new AbortController(), busy: true };
    owner.current = current;
    const check = () => {
      if (!current.live || current.abort.signal.aborted || AppState.currentState !== 'active') throw Error('CANCELLED');
    };
    void (async () => {
      try {
        const value = await open(current.abort.signal, check); check();
        const inventory = await value.getNotes(check); check();
        setNotes(inventory.notes); setRuntime({ source: open, value }); setReady(true);
      } catch { if (current.live) setError('privacy.capacity.loadError'); }
      finally { current.busy = false; }
    })();
    const change = AppState.addEventListener('change', next => { if (next !== 'active') close(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', close) : undefined;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => { current.live = false; current.abort.abort(); change.remove(); blur?.remove(); back.remove(); };
  }, [close, open]);
  const activeRuntime = runtime?.source === open ? runtime.value : undefined;
  const act = async (kind: 'clear' | 'recover') => {
    const current = owner.current;
    const note = notes.find(value => value.id === selected);
    if (!activeRuntime || !ready || !current.live || current.busy ||
        (kind === 'clear' ? !confirmClear : !note?.withdrawal?.canCheckRecovery || !password)) return;
    current.busy = true; setBusy(true); setError(null); setResult(null);
    const request = {}; current.request = request;
    const check = () => {
      if (!current.live || current.abort.signal.aborted || current.request !== request || AppState.currentState !== 'active') throw Error('CANCELLED');
    };
    const entered = password; setPassword(''); Keyboard.dismiss();
    try {
      if (kind === 'recover') {
        await activeRuntime.recoverFailedWithdrawal(note!.id, entered, check); check(); setSelected(null);
      } else {
        let removed = 0, unresolved = 0;
        setProgress({ checked: 0, total: notes.length });
        for (const candidate of notes) {
          check();
          const value = await activeRuntime.clearCompletedNote(candidate.id, check); check();
          const ids = [...value.removed, ...value.unresolved];
          if (ids.length !== 1 || ids[0] !== candidate.id) throw Error('Invalid maintenance result');
          removed += value.removed.length; unresolved += value.unresolved.length;
          setProgress({ checked: removed + unresolved, total: notes.length });
        }
        setResult({ removed, unresolved }); setConfirmClear(false);
      }
    } catch { if (current.live) setError(kind === 'clear' ? 'privacy.capacity.clearError' : 'privacy.recovery.failed'); }
    finally {
      // A committed write can lose its acknowledgement. Always reload, never replay the operation.
      try { check(); const inventory = await activeRuntime.getNotes(check); check(); setNotes(inventory.notes); }
      catch { if (current.live) { setReady(false); setNotes([]); setError('privacy.capacity.clearError'); } }
      current.busy = false;
      if (current.live) { setBusy(false); setProgress(null); }
    }
  };
  const shownReady = ready && !!activeRuntime;
  const recovering = activeRuntime && notes.find(note => note.id === selected && note.withdrawal?.canCheckRecovery);
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<Button title={t('buttons.close')} variant="secondary" onPress={close} />}>
        <Header title={t('privacy.yourNotes')} onBack={close} />
        {!shownReady && !error && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('buttons.loading')}</Text>}
        {shownReady && <Text style={styles.muted}>{t('privacy.yourNotes')} · {notes.length}</Text>}
        {shownReady && !recovering && <>
          {notes.some(note => note.withdrawal?.canCheckRecovery) && <Card>
            {notes.filter(note => note.withdrawal?.canCheckRecovery).map(note => <Row key={note.id}
              title={`${note.amount} ETH`} subtitle={t('privacy.recovery.action')}
              onPress={busy ? undefined : () => { setSelected(note.id); setPassword(''); setError(null); setConfirmClear(false); }} />)}
          </Card>}
          {notes.length > 0 && (!confirmClear ? <Button title={t('privacy.capacity.clear')} variant="secondary" disabled={busy}
            onPress={() => { setConfirmClear(true); setError(null); }} /> : <>
            <Text style={styles.muted}>{t('privacy.capacity.clearHelp')}</Text>
            <Button title={t('privacy.capacity.confirmClear')} disabled={busy} onPress={() => { void act('clear'); }} />
            <Button title={t('buttons.cancel')} variant="secondary" disabled={busy} onPress={() => setConfirmClear(false)} />
          </>)}
        </>}
        {recovering && <>
          <Text style={styles.muted}>{t('privacy.recovery.help')}</Text><Text style={styles.muted}>{t('privacy.recovery.disclosure')}</Text>
          <PinField label="Wallet PIN" value={password} onChange={setPassword} busy={busy} />
          <Button title={t('privacy.recovery.confirm')} disabled={busy || !password} onPress={() => { void act('recover'); }} />
          <Button title={t('buttons.cancel')} variant="secondary" disabled={busy} onPress={() => { setSelected(null); setPassword(''); setError(null); }} />
        </>}
        {progress && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('privacy.capacity.clearProgress', progress)}</Text>}
        {result && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('privacy.capacity.clearResult', result)}</Text>}
        {error && <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>}
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 }, error: { color: colors.red } });
