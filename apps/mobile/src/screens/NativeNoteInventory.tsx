import { useNativeTranslation } from '../platform/localization';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { IPrivateNoteStatus } from '../../../../source/utils/privacy/privateVaultTypes';
import type { NativeNoteInventory as NoteInventory, NativeSavedNote } from '../custody/noteBackupRuntime';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
import { Button, Card, colors, Header, Notice, Row, Screen, styles, Text } from '../ui';
import { NativeNoteReveal } from './NativeNoteReveal';
import { NativePrivateWithdrawal } from './NativePrivateWithdrawal';

type Props = {
  readInventory(assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<NoteInventory>;
  onBack(): void;
  onLock(): void;
};
type State = { phase: 'loading' } | ({ source: Props['readInventory'] } & (
  { phase: 'error' | 'retired' } |
  { phase: 'ready'; inventory: NoteInventory; authentication: NativePrivateAuthenticationScope; page: number; selected: number | null; revealing: boolean; withdrawing: boolean }
));
type Owner = { live: boolean; request?: object; work?: Promise<unknown>; authentication: NativePrivateAuthenticationScope; revealing: boolean };
const LOADING = { phase: 'loading' } as const;
const PAGE_SIZE = 20;
const recordedDate = (createdAt: number) => new Date(createdAt).toLocaleDateString();

export function NativeNoteInventory({ readInventory, onBack, onLock }: Props) {
  const { t } = useNativeTranslation();
  const life = useRef<Owner>({ live: false, authentication: createNativePrivateAuthenticationScope(), revealing: false });
  const [state, setState] = useState<State>(LOADING);
  const selectedNote = useRef<NativeSavedNote | undefined>(undefined);
  const [inspection, setInspection] = useState<{
    note: NativeSavedNote; phase: 'checking' | 'failed' | 'ready'; status?: IPrivateNoteStatus;
  } | null>(null);

  const load = useCallback(async () => {
    const owner = life.current;
    if (!owner.live || owner.request || AppState.currentState !== 'active') return;
    const request = {};
    owner.request = request;
    const routeCurrent = () => life.current === owner && owner.live && (AppState.currentState === 'active' ||
      !owner.revealing && allowsPrivateAuthenticationInterruption(owner.authentication, AppState.currentState));
    const isCurrent = () => routeCurrent() && owner.request === request;
    const assertCurrent = () => {
      if (!routeCurrent()) throw new Error('CANCELLED');
    };
    try {
      const inventory = await readInventory(assertCurrent, owner.authentication);
      if (isCurrent() && AppState.currentState === 'active') setState({ phase: 'ready', source: readInventory, inventory, authentication: owner.authentication, page: 0, selected: null, revealing: false, withdrawing: false });
    } catch {
      if (isCurrent() && AppState.currentState === 'active') setState({ phase: 'error', source: readInventory });
    } finally {
      if (owner.request === request) owner.request = undefined;
    }
  }, [readInventory]);

  useLayoutEffect(() => {
    const owner: Owner = { live: true, authentication: createNativePrivateAuthenticationScope(), revealing: false };
    life.current = owner;
    const hide = () => {
      if (!owner.live) return;
      owner.live = false;
      owner.authentication.retire();
      selectedNote.current = undefined;
      setInspection(null);
      setState({ phase: 'retired', source: readInventory });
    };
    const change = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && (owner.revealing || !allowsPrivateAuthenticationInterruption(owner.authentication, next))) hide();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      if (owner.revealing || !allowsPrivateAuthenticationInterruption(owner.authentication, 'blur')) hide();
    }) : null;
    void load();
    return () => { owner.live = false; owner.authentication.retire(); change.remove(); blur?.remove(); };
  }, [load, readInventory]);

  const view: State = 'source' in state && state.source === readInventory ? state : LOADING;
  const updateReady = useCallback((changes: { page: number } | { selected: number | null } | { revealing: boolean } | { withdrawing: boolean }) => {
    if (!life.current.live) return;
    if ('revealing' in changes) life.current.revealing = false;
    setState((current) => current === view && current.phase === 'ready' ? { ...current, ...changes } : current);
  }, [view]);
  const back = useCallback(() => {
    if (view.phase === 'ready' && view.selected !== null) {
      const owner = life.current, pending = owner.request && owner.work;
      owner.request = undefined;
      owner.work = undefined;
      selectedNote.current = undefined;
      setInspection(null);
      if (pending) {
        owner.authentication.retire();
        const authentication = createNativePrivateAuthenticationScope();
        owner.authentication = authentication;
        setState(LOADING);
        void pending.catch(() => undefined).then(() => {
          if (life.current === owner && owner.live && owner.authentication === authentication) void load();
        });
        return;
      }
      updateReady({ selected: null });
      return;
    }
    life.current.live = false;
    life.current.authentication.retire();
    onBack();
  }, [load, onBack, updateReady, view]);
  const revealing = view.phase === 'ready' && view.revealing;
  const withdrawing = view.phase === 'ready' && view.withdrawing;
  useLayoutEffect(() => {
    if (revealing || withdrawing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back, revealing, withdrawing]);

  const notes = view.phase === 'ready' ? view.inventory.notes : [];
  const inventory = view.phase === 'ready' ? view.inventory : undefined;
  const note = view.phase === 'ready' && view.selected !== null ? notes[view.selected] : undefined;
  useLayoutEffect(() => { selectedNote.current = note; }, [note]);
  const openWithdrawal = useCallback(async (signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthenticationScope) => {
    const owner = life.current;
    const check = () => {
      if (life.current !== owner || !owner.live || selectedNote.current !== note ||
          (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(owner.authentication, AppState.currentState))) throw new Error('CANCELLED');
      assertCurrent();
    };
    check();
    if (!note || !inventory?.openWithdrawal) throw new Error('UNAVAILABLE');
    return inventory.openWithdrawal(note, signal, check, authentication);
  }, [inventory, note]);
  const closeWithdrawal = useCallback(() => {
    if (!life.current.live || selectedNote.current !== note) return;
    life.current.authentication.retire();
    life.current.authentication = createNativePrivateAuthenticationScope();
    setInspection(null);
    selectedNote.current = undefined;
    setState(LOADING);
    void load();
  }, [load, note]);
  const checked = inspection?.note === note ? inspection : null;
  const revealVisibility = useCallback((visible: boolean) => {
    const owner = life.current;
    if (!owner.live || selectedNote.current !== note || visible && AppState.currentState !== 'active') {
      if (visible) throw new Error('CANCELLED');
      return;
    }
    owner.revealing = visible;
  }, [note]);
  const checkNote = async () => {
    const owner = life.current;
    if (!owner.live || owner.request || view.phase !== 'ready' || !note || !view.inventory.checkNote || AppState.currentState !== 'active') return;
    const request = {};
    owner.request = request;
    const assertCurrent = () => {
      if (life.current !== owner || !owner.live || owner.request !== request || selectedNote.current !== note ||
          (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(owner.authentication, AppState.currentState))) throw new Error('CANCELLED');
    };
    setInspection({ note, phase: 'checking' });
    try {
      const work = view.inventory.checkNote(note, assertCurrent);
      owner.work = work;
      const status = await work;
      assertCurrent();
      if (AppState.currentState !== 'active') throw new Error('CANCELLED');
      setInspection({ note, phase: 'ready', status });
    } catch {
      if (owner.live && owner.request === request && selectedNote.current === note && AppState.currentState === 'active') setInspection({ note, phase: 'failed' });
    } finally {
      if (owner.request === request) { owner.request = undefined; owner.work = undefined; }
    }
  };
  const statusTitle = checked?.status?.phase === 'verified' ? t('mobile.noteFlows.import.verifiedInPoolHistory')
    : checked?.status?.phase === 'spent' ? t('mobile.noteFlows.import.alreadySpent')
    : checked?.status?.phase === 'not-found' ? t('mobile.noteFlows.inventory.notFoundInPoolHistory')
    : checked?.status?.phase === 'waiting' ? t('mobile.noteFlows.inventory.poolVerificationPending')
    : t('mobile.noteFlows.inventory.statusNotChecked');
  const page = view.phase === 'ready' ? view.page : 0;
  const start = page * PAGE_SIZE;
  const rows = notes.slice(start, start + PAGE_SIZE);
  const next = start + rows.length < notes.length;
  const lock = () => {
    life.current.live = false;
    life.current.authentication.retire();
    setState({ phase: 'retired', source: readInventory });
    onLock();
  };

  if (view.phase === 'ready' && revealing && note) return <NativeNoteReveal key={view.selected} inventory={view.inventory} note={note}
    authentication={view.authentication} onSecretVisibilityChange={revealVisibility}
    onBack={() => updateReady({ revealing: false })} onLock={lock} />;
  if (view.phase === 'ready' && withdrawing && note && inventory?.openWithdrawal) return <NativePrivateWithdrawal
    key={view.selected} note={note} open={openWithdrawal} onBack={closeWithdrawal} authentication={view.authentication} />;

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <Screen key={note ? 'detail' : 'list'} footer={<Button title={t('mobile.settings.lock')} icon="lock" variant="secondary" onPress={lock} />}>
      <Header title={note ? t('mobile.noteFlows.inventory.noteDetails') : t('mobile.noteFlows.export.savedNotes')} onBack={back} />
      {note ? <>
        <Card>
          <Row title={t('mobile.noteFlows.inventory.poolAmount', { amount: note.amount })} subtitle={t('mobile.noteFlows.inventory.recorded', { date: recordedDate(note.createdAt) })} />
          <Row title={statusTitle} subtitle={checked?.status?.blockNumber === undefined
            ? checked?.status ? undefined : t('mobile.noteFlows.inventory.paliHasntCheckedThisNoteAgainstItsEthereum')
            : t('mobile.noteFlows.inventory.observedBlock', { block: checked.status.blockNumber })} last />
        </Card>
        {note.reconciliation === 'restored-note' && <Notice title={t('mobile.noteFlows.inventory.restoredNoteNeedsReview')}
          body={t('mobile.noteFlows.inventory.thisNoteCameFromABackupAndStill')} tone="amber" />}
        {note.reconciliation === 'withdrawal-history' && <Notice title={t('mobile.noteFlows.inventory.savedWithdrawalHistory')}
          body={t('mobile.noteFlows.inventory.thisNoteHasASavedWithdrawalRecordThat')} tone="amber" />}
        {inventory?.checkNote && <Button title={checked?.phase === 'checking' ? t('mobile.noteFlows.import.checkingPool') : checked?.status ? t('mobile.noteFlows.inventory.checkStatusAgain') : t('mobile.noteFlows.inventory.checkPoolStatus')}
          variant="secondary" disabled={checked?.phase === 'checking'} onPress={() => { void checkNote(); }} />}
        {checked?.phase === 'failed' && <Text accessibilityRole="alert" style={s.error}>{t('mobile.noteFlows.inventory.couldNotCheckThisNoteTryAgain')}</Text>}
        {inventory?.openWithdrawal && (checked?.status?.phase === 'verified' || note.reconciliation === 'withdrawal-history') && <Button
          title={note.reconciliation === 'withdrawal-history' ? t('mobile.noteFlows.inventory.viewWithdrawalStatus') : t('transactions.methodNames.withdraw')}
          disabled={checked?.phase === 'checking'} onPress={() => updateReady({ withdrawing: true })} />}
        <Button title={t('mobile.noteFlows.reveal.backUpThisNote')} variant="secondary" disabled={checked?.phase === 'checking'} onPress={() => updateReady({ revealing: true })} />
      </> : <>
        {view.phase === 'loading' && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('mobile.noteFlows.inventory.loadingSavedNotes')}</Text>}
        {view.phase === 'error' && <>
          <Text accessibilityRole="alert" style={s.error}>{t('mobile.noteFlows.inventory.couldNotLoadSavedNotes')}</Text>
          <Button title={t('receive.retry')} variant="secondary" onPress={() => {
            setState(LOADING);
            void load();
          }} />
        </>}
        {view.phase === 'retired' && <Text style={styles.muted}>{t('mobile.noteFlows.inventory.openSavedNotesAgainToContinue')}</Text>}
        {view.phase === 'ready' && notes.length === 0 && <Notice title={t('mobile.noteFlows.inventory.noSavedNotes')}
          body={t('mobile.noteFlows.inventory.privateNotesYouCreateOrImportAppearHere')} />}
        {view.phase === 'ready' && rows.length > 0 && <>
          <Text style={styles.muted}>{inventory?.checkNote ? t('mobile.noteFlows.inventory.openANoteToCheckItsPoolStatus') : t('mobile.noteFlows.inventory.theseNotesAreSavedOnThisDevice')}</Text>
          {notes.length > PAGE_SIZE && <Text accessibilityLiveRegion="polite" style={styles.muted}>
            {t('mobile.noteFlows.inventory.range', { start: start + 1, end: start + rows.length, total: notes.length })}
          </Text>}
          <Card>
            {rows.map((row, index) => <Row key={start + index} title={t('mobile.noteFlows.inventory.poolAmount', { amount: row.amount })}
              subtitle={t('mobile.noteFlows.inventory.noteDate', { number: start + index + 1, date: recordedDate(row.createdAt) })}
              onPress={() => { setInspection(null); updateReady({ selected: start + index }); }} last={index === rows.length - 1} />)}
          </Card>
          {(page > 0 || next) && <View style={s.pages}>
            <View style={s.page}><Button title={t('mobile.noteFlows.inventory.previous')} variant="secondary" disabled={page === 0} onPress={() => updateReady({ page: page - 1 })} /></View>
            <View style={s.page}><Button title={t('buttons.next')} variant="secondary" disabled={!next} onPress={() => updateReady({ page: page + 1 })} /></View>
          </View>}
        </>}
      </>}
    </Screen>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  pages: { flexDirection: 'row', gap: 8 },
  page: { flex: 1 },
  error: { color: colors.red },
});
