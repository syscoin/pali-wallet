import { WalletBackHandler as BackHandler } from '../ui/WalletBackHandler';
import { useNativeTranslation } from '../platform/localization';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { IPrivateNoteStatus } from '../../../../source/utils/privacy/privateVaultTypes';
import type { NativeNoteInventory as NoteInventory, NativeNoteArchiveInventory, NativeSavedNote } from '../custody/noteBackupRuntime';
import { createNativePrivateAuthenticationChild, createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { isOperationAuthenticationCancellation } from '../core/operationAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
import { Button, Card, colors, Header, Icon, Notice, Row, Screen, styles, Text } from '../ui';
import { NativeNoteReveal } from './NativeNoteReveal';
import { NativePrivateWithdrawal } from './NativePrivateWithdrawal';

type Props = {
  readInventory(assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<NoteInventory>;
  onBack(): void;
  onLock(): void;
  onExport?(): void;
};
type State = { phase: 'loading' } | ({ source: Props['readInventory'] } & (
  { phase: 'error' | 'retired' } |
  { phase: 'ready'; inventory: NoteInventory; authentication: NativePrivateAuthenticationScope; page: number; selected: number | null; revealing: boolean; withdrawing: boolean; archived: boolean; archiveView?: NativeNoteArchiveInventory }
));
type Owner = { live: boolean; request?: object; work?: Promise<unknown>; authentication: NativePrivateAuthenticationScope; revealing: boolean };
const LOADING = { phase: 'loading' } as const;
const PAGE_SIZE = 20;
const recordedDate = (createdAt: number) => new Date(createdAt).toLocaleDateString();

export function NativeNoteInventory({ readInventory, onBack, onLock, onExport }: Props) {
  const { t } = useNativeTranslation();
  const life = useRef<Owner>({ live: false, authentication: createNativePrivateAuthenticationScope(), revealing: false });
  const [state, setState] = useState<State>(LOADING);
  const [archiveAction, setArchiveAction] = useState<'restore' | 'clear' | null>(null);
  const [archiveAcknowledged, setArchiveAcknowledged] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveResult, setArchiveResult] = useState<{ restored: true } | { removed: number } | null>(null);
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
    const publish = (nextView: State) => {
      if (!isCurrent() || AppState.currentState !== 'active') return;
      setArchiveAction(null); setArchiveAcknowledged(false); setArchiveBusy(false); setArchiveError(null); setArchiveResult(null);
      setState(nextView);
    };
    try {
      const inventory = await readInventory(assertCurrent, owner.authentication);
      publish({ phase: 'ready', source: readInventory, inventory, authentication: owner.authentication, page: 0, selected: null, revealing: false, withdrawing: false, archived: false });
    } catch {
      publish({ phase: 'error', source: readInventory });
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
  const updateReady = useCallback((changes: { page: number } | { selected: number | null } | { revealing: boolean } | { withdrawing: boolean } | { archived: boolean; selected: null; page: 0 }) => {
    if (!life.current.live) return;
    if ('revealing' in changes) life.current.revealing = false;
    setState((current) => current === view && current.phase === 'ready' ? { ...current, ...changes } : current);
  }, [view]);
  const back = useCallback(() => {
    setArchiveAction(null); setArchiveAcknowledged(false); setArchiveError(null);
    if (view.phase === 'ready' && (view.selected !== null || life.current.request && life.current.work)) {
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
    if (view.phase === 'ready' && view.archived) {
      updateReady({ archived: false, selected: null, page: 0 });
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

  const archived = view.phase === 'ready' && view.archived;
  const archive = view.phase === 'ready' ? view.archiveView : undefined;
  const archiveSummary = view.phase === 'ready' ? view.inventory.archiveSummary : undefined;
  const inventory: NoteInventory | undefined = view.phase === 'ready' ? archived ? archive : view.inventory : undefined;
  const notes = inventory?.notes || [];
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

  if (view.phase === 'ready' && revealing && note) return <NativeNoteReveal key={view.selected} inventory={inventory!} note={note}
    authentication={view.authentication} onSecretVisibilityChange={revealVisibility}
    onBack={() => updateReady({ revealing: false })} onLock={lock} />;
  if (view.phase === 'ready' && withdrawing && note && inventory?.openWithdrawal) return <NativePrivateWithdrawal
    key={view.selected} note={note} open={openWithdrawal} onBack={closeWithdrawal} authentication={view.authentication} />;

  const openArchive = async () => {
    const owner = life.current;
    if (view.phase !== 'ready' || !view.inventory.archive || !owner.live || owner.request || AppState.currentState !== 'active') return;
    const request = {}; owner.request = request;
    const authentication = createNativePrivateAuthenticationChild(view.authentication);
    const check = () => {
      if (life.current !== owner || !owner.live || owner.request !== request ||
          (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState))) throw Error('CANCELLED');
    };
    setArchiveBusy(true); setArchiveAction(null); setArchiveAcknowledged(false); setArchiveError(null); setArchiveResult(null);
    try {
      const work = view.inventory.archive.open(check, authentication); owner.work = work;
      const archiveView = await work; check();
      if (AppState.currentState !== 'active') throw Error('CANCELLED');
      setState({ ...view, archived: true, archiveView, selected: null, page: 0 });
    } catch (error) {
      try { check(); if (!isOperationAuthenticationCancellation(error)) setArchiveError('privacy.archive.loadError'); }
      catch { /* A retired view cannot publish an archive. */ }
    } finally {
      authentication.retire();
      if (owner.request === request) { owner.request = undefined; owner.work = undefined; }
      if (life.current === owner && owner.live) setArchiveBusy(false);
    }
  };

  const archiveMutation = async (kind: 'restore' | 'clear') => {
    const owner = life.current;
    if (view.phase !== 'ready' || !archived || !archive || !owner.live || owner.request ||
        archiveAction !== kind || (kind === 'clear' ? !archiveAcknowledged : !note) || AppState.currentState !== 'active') return;
    const request = {};
    const authentication = createNativePrivateAuthenticationChild(view.authentication);
    owner.request = request;
    setArchiveBusy(true); setArchiveError(null); setArchiveResult(null);
    const check = () => {
      if (life.current !== owner || !owner.live || owner.request !== request ||
          (kind === 'restore' && selectedNote.current !== note) ||
          (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(authentication, AppState.currentState))) throw Error('CANCELLED');
    };
    try {
      const work = kind === 'restore' ? archive.restoreNote(note!, check, authentication) : archive.clearArchive(check, authentication);
      owner.work = work;
      const result = await work; check();
      if (AppState.currentState !== 'active') throw Error('CANCELLED');
      if (kind === 'clear') {
        const removed = 'removed' in result ? result.removed : undefined;
        if (typeof removed !== 'number' || !Number.isSafeInteger(removed) || removed < 0 || removed > archive.limit) throw Error('privacy_vault_unavailable');
        setArchiveResult({ removed });
      } else setArchiveResult({ restored: true });
      setArchiveAction(null); setArchiveAcknowledged(false);
      setState({ ...view, inventory: result.inventory, archiveView: result.archive, archived: true, selected: null, page: 0 });
    } catch (error) {
      try {
        check();
        if (!isOperationAuthenticationCancellation(error)) {
          setArchiveError(error instanceof Error && error.message === 'privacy_note_limit' ? 'privacy.archive.activeFull' : 'privacy.archive.actionError');
          // An ambiguous acknowledgement cannot leave an actionable stale archive.
          if (!(error instanceof Error && error.message === 'privacy_note_limit')) setState({ phase: 'error', source: readInventory });
        }
      } catch { /* A retired route cannot publish an outcome. */ }
    } finally {
      authentication.retire();
      if (owner.request === request) { owner.request = undefined; owner.work = undefined; }
      if (life.current === owner && owner.live) setArchiveBusy(false);
    }
  };

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <Screen key={note ? 'detail' : 'list'} footer={<Button title={t('mobile.settings.lock')} icon="lock" variant="secondary" onPress={lock} />}>
      <Header title={note ? t('mobile.noteFlows.inventory.noteDetails') : t(archived ? 'privacy.archive.title' : 'mobile.noteFlows.export.savedNotes')} onBack={back} />
      {archived && <Text style={styles.muted}>{t('privacy.archive.help')}</Text>}
      {note ? <>
        <Card>
          <Row title={t('mobile.noteFlows.inventory.poolAmount', { amount: note.amount })} subtitle={t('mobile.noteFlows.inventory.recorded', { date: recordedDate(note.createdAt) })} />
          {!archived && <Row title={statusTitle} subtitle={checked?.status?.blockNumber === undefined
            ? checked?.status ? undefined : t('mobile.noteFlows.inventory.paliHasntCheckedThisNoteAgainstItsEthereum')
            : t('mobile.noteFlows.inventory.observedBlock', { block: checked.status.blockNumber })} last />}
        </Card>
        {!archived && note.withdrawalPending && (
          <Notice compact tone="amber" title={t('privacy.withdrawal.pendingActivity')} />
        )}
        {!archived && !inventory?.openWithdrawal && note.reconciliation === 'withdrawal-history' && (
          <Notice title={t('mobile.noteFlows.inventory.savedWithdrawalHistory')}
            body={t('mobile.noteFlows.inventory.thisNoteHasASavedWithdrawalRecordThat')} tone="amber" />
        )}
        {!archived && inventory?.checkNote && <Button title={checked?.phase === 'checking' ? t('mobile.noteFlows.import.checkingPool') : checked?.status ? t('mobile.noteFlows.inventory.checkStatusAgain') : t('mobile.noteFlows.inventory.checkPoolStatus')}
          variant="secondary" disabled={checked?.phase === 'checking'} onPress={() => { void checkNote(); }} />}
        {checked?.phase === 'failed' && <Text accessibilityRole="alert" style={s.error}>{t('mobile.noteFlows.inventory.couldNotCheckThisNoteTryAgain')}</Text>}
        {!archived && inventory?.openWithdrawal && (checked?.status?.phase === 'verified' || note.withdrawalPending || note.withdrawalStatusAvailable) && <Button
          title={!note.withdrawalPending && note.withdrawalStatusAvailable && checked?.status?.phase !== 'verified'
            ? t('mobile.noteFlows.inventory.viewWithdrawalStatus') : t('transactions.methodNames.withdraw')}
          disabled={note.withdrawalPending || checked?.phase === 'checking'} onPress={() => { if (!note.withdrawalPending) updateReady({ withdrawing: true }); }} />}
        <Button title={t('mobile.noteFlows.reveal.backUpThisNote')} icon={archived ? 'eye' : undefined} variant="secondary" disabled={archiveBusy || checked?.phase === 'checking'} onPress={() => updateReady({ revealing: true })} />
        {archived && <Button title={t('privacy.archive.restore')} icon="refresh" variant="secondary" disabled={archiveBusy} onPress={() => { setArchiveAction('restore'); setArchiveError(null); }} />}
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
        {view.phase === 'ready' && !archived && view.inventory.archive && <Button title={`${t('privacy.archive.title')}${archiveSummary ? ` (${archiveSummary.noteCount})` : ''}`} icon="archive" variant="secondary" disabled={archiveBusy} onPress={() => { void openArchive(); }} />}
        {view.phase === 'ready' && archived && archive && <>
          <Text style={styles.muted}>{t('privacy.archive.capacity', { count: archive.notes.length, limit: archive.limit })}</Text>
          {onExport && <Button title={t('privacy.bundle.exportTitle')} icon="share" variant="secondary" disabled={archiveBusy || !archive.notes.length} onPress={onExport} />}
          <Button title={t('privacy.archive.clear')} icon="trash" variant="secondary" disabled={archiveBusy || !archive.notes.length} onPress={() => { setArchiveAction('clear'); setArchiveAcknowledged(false); setArchiveError(null); }} />
        </>}
        {view.phase === 'ready' && archived && !notes.length && <Text style={styles.muted}>{t('privacy.archive.empty')}</Text>}
        {view.phase === 'ready' && !archived && notes.length === 0 && <Notice title={t('mobile.noteFlows.inventory.noSavedNotes')}
          body={t('mobile.noteFlows.inventory.privateNotesYouCreateOrImportAppearHere')} />}
        {view.phase === 'ready' && rows.length > 0 && <>
          <Text style={styles.muted}>{!archived && inventory?.checkNote ? t('mobile.noteFlows.inventory.openANoteToCheckItsPoolStatus') : t('mobile.noteFlows.inventory.theseNotesAreSavedOnThisDevice')}</Text>
          {notes.length > PAGE_SIZE && <Text accessibilityLiveRegion="polite" style={styles.muted}>
            {t('mobile.noteFlows.inventory.range', { start: start + 1, end: start + rows.length, total: notes.length })}
          </Text>}
          <Card>
            {rows.map((row, index) => <Row key={start + index} title={t('mobile.noteFlows.inventory.poolAmount', { amount: row.amount })}
              subtitle={t('mobile.noteFlows.inventory.noteDate', { number: start + index + 1, date: recordedDate(row.createdAt) })}
              onPress={archiveBusy ? undefined : () => { setArchiveAction(null); setArchiveAcknowledged(false); setInspection(null); updateReady({ selected: start + index }); }} last={index === rows.length - 1} />)}
          </Card>
          {(page > 0 || next) && <View style={s.pages}>
            <View style={s.page}><Button title={t('mobile.noteFlows.inventory.previous')} variant="secondary" disabled={archiveBusy || page === 0} onPress={() => updateReady({ page: page - 1 })} /></View>
            <View style={s.page}><Button title={t('buttons.next')} variant="secondary" disabled={archiveBusy || !next} onPress={() => updateReady({ page: page + 1 })} /></View>
          </View>}
        </>}
      </>}
      {archiveAction && archived && <Card>
        <Text style={styles.muted}>{t(archiveAction === 'clear' ? 'privacy.archive.warning' : 'privacy.archive.restore')}</Text>
        {archiveAction === 'clear' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: archiveAcknowledged, disabled: archiveBusy }} onPress={archiveBusy ? undefined : () => setArchiveAcknowledged(value => !value)}>
          <Row title={t('privacy.archive.confirmBackup')} right={<View style={[s.checkbox, archiveAcknowledged && s.checkboxChecked]}>{archiveAcknowledged && <Icon name="check" size={18} color={colors.blue} />}</View>} last />
        </Pressable>}
        <Button title={t(archiveAction === 'clear' ? 'privacy.archive.confirmClear' : 'buttons.confirm')} icon={archiveAction === 'clear' ? 'trash' : 'check'} disabled={archiveBusy || (archiveAction === 'clear' && !archiveAcknowledged)}
          onPress={() => { void archiveMutation(archiveAction); }} />
        <Button title={t('buttons.cancel')} icon="close" variant="secondary" disabled={archiveBusy} onPress={() => { setArchiveAction(null); setArchiveAcknowledged(false); }} />
      </Card>}
      {archiveBusy && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('buttons.loading')}</Text>}
      {archiveResult && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('restored' in archiveResult ? 'privacy.archive.restored' : 'privacy.archive.clearResult', 'removed' in archiveResult ? { count: archiveResult.removed } : {})}</Text>}
      {archiveError && <Text accessibilityRole="alert" style={s.error}>{t(archiveError)}</Text>}
    </Screen>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  pages: { flexDirection: 'row', gap: 8 },
  page: { flex: 1 },
  error: { color: colors.red },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: colors.controlBorder, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { borderColor: colors.blue },
});
