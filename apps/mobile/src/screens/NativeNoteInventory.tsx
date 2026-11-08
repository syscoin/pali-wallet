import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { IPrivateNoteStatus } from '../../../../source/utils/privacy/privateVaultTypes';
import type { NativeNoteInventory as NoteInventory, NativeSavedNote } from '../custody/noteBackupRuntime';
import { Button, Card, colors, Header, Notice, Row, Screen, styles, Text } from '../ui';
import { NativeNoteReveal } from './NativeNoteReveal';
import { NativePrivateWithdrawal } from './NativePrivateWithdrawal';

type Props = {
  readInventory(assertCurrent: () => void): Promise<NoteInventory>;
  onBack(): void;
  onLock(): void;
};
type State = { phase: 'loading' } | ({ source: Props['readInventory'] } & (
  { phase: 'error' | 'retired' } |
  { phase: 'ready'; inventory: NoteInventory; page: number; selected: number | null; revealing: boolean; withdrawing: boolean }
));
type Owner = { live: boolean; request?: object };
const LOADING = { phase: 'loading' } as const;
const PAGE_SIZE = 20;
const recordedDate = (createdAt: number) => new Date(createdAt).toLocaleDateString();

export function NativeNoteInventory({ readInventory, onBack, onLock }: Props) {
  const life = useRef<Owner>({ live: false });
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
    const routeCurrent = () => owner.live && AppState.currentState === 'active';
    const isCurrent = () => routeCurrent() && owner.request === request;
    const assertCurrent = () => {
      if (!routeCurrent()) throw new Error('CANCELLED');
    };
    try {
      const inventory = await readInventory(assertCurrent);
      if (isCurrent()) setState({ phase: 'ready', source: readInventory, inventory, page: 0, selected: null, revealing: false, withdrawing: false });
    } catch {
      if (isCurrent()) setState({ phase: 'error', source: readInventory });
    } finally {
      if (owner.request === request) owner.request = undefined;
    }
  }, [readInventory]);

  useLayoutEffect(() => {
    const owner: Owner = { live: true };
    life.current = owner;
    const hide = () => {
      if (!owner.live) return;
      owner.live = false;
      setState({ phase: 'retired', source: readInventory });
    };
    const change = AppState.addEventListener('change', (next) => {
      if (next !== 'active') hide();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', hide) : null;
    void load();
    return () => { owner.live = false; change.remove(); blur?.remove(); };
  }, [load, readInventory]);

  const view: State = 'source' in state && state.source === readInventory ? state : LOADING;
  const updateReady = useCallback((changes: { page: number } | { selected: number | null } | { revealing: boolean } | { withdrawing: boolean }) => {
    if (!life.current.live) return;
    setState((current) => current === view && current.phase === 'ready' ? { ...current, ...changes } : current);
  }, [view]);
  const back = useCallback(() => {
    if (view.phase === 'ready' && view.selected !== null) {
      life.current.request = undefined;
      selectedNote.current = undefined;
      setInspection(null);
      updateReady({ selected: null });
      return;
    }
    life.current.live = false;
    onBack();
  }, [onBack, updateReady, view]);
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
  const openWithdrawal = useCallback(async (signal: AbortSignal, assertCurrent: () => void) => {
    const owner = life.current;
    const check = () => {
      if (!owner.live || selectedNote.current !== note || AppState.currentState !== 'active') throw new Error('CANCELLED');
      assertCurrent();
    };
    check();
    if (!note || !inventory?.openWithdrawal) throw new Error('UNAVAILABLE');
    return inventory.openWithdrawal(note, signal, check);
  }, [inventory, note]);
  const closeWithdrawal = useCallback(() => {
    if (!life.current.live || selectedNote.current !== note) return;
    setInspection(null);
    setState(LOADING);
    void load();
  }, [load, note]);
  const checked = inspection?.note === note ? inspection : null;
  const checkNote = async () => {
    const owner = life.current;
    if (!owner.live || owner.request || view.phase !== 'ready' || !note || !view.inventory.checkNote || AppState.currentState !== 'active') return;
    const request = {};
    owner.request = request;
    const assertCurrent = () => {
      if (!owner.live || owner.request !== request || selectedNote.current !== note || AppState.currentState !== 'active') throw new Error('CANCELLED');
    };
    setInspection({ note, phase: 'checking' });
    try {
      const status = await view.inventory.checkNote(note, assertCurrent);
      assertCurrent();
      setInspection({ note, phase: 'ready', status });
    } catch {
      if (owner.live && owner.request === request && selectedNote.current === note) setInspection({ note, phase: 'failed' });
    } finally {
      if (owner.request === request) owner.request = undefined;
    }
  };
  const statusTitle = checked?.status?.phase === 'verified' ? 'Verified in pool history'
    : checked?.status?.phase === 'spent' ? 'Already spent'
    : checked?.status?.phase === 'not-found' ? 'Not found in pool history'
    : checked?.status?.phase === 'waiting' ? 'Pool verification pending'
    : 'Status not checked';
  const page = view.phase === 'ready' ? view.page : 0;
  const start = page * PAGE_SIZE;
  const rows = notes.slice(start, start + PAGE_SIZE);
  const next = start + rows.length < notes.length;
  const lock = () => {
    life.current.live = false;
    setState({ phase: 'retired', source: readInventory });
    onLock();
  };

  if (view.phase === 'ready' && revealing && note) return <NativeNoteReveal key={view.selected} inventory={view.inventory} note={note}
    onBack={() => updateReady({ revealing: false })} onLock={lock} />;
  if (view.phase === 'ready' && withdrawing && note && inventory?.openWithdrawal) return <NativePrivateWithdrawal
    key={view.selected} note={note} open={openWithdrawal} onBack={closeWithdrawal} />;

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <Screen key={note ? 'detail' : 'list'} footer={<Button title="Lock wallet" variant="secondary" onPress={lock} />}>
      <Header title={note ? 'Note details' : 'Saved notes'} onBack={back} />
      {note ? <>
        <Card>
          <Row title={`${note.amount} ETH pool`} subtitle={`Recorded ${recordedDate(note.createdAt)}`} />
          <Row title={statusTitle} subtitle={checked?.status?.blockNumber === undefined
            ? checked?.status ? undefined : 'Pali hasn’t checked this note against its Ethereum pool.'
            : `Observed at block ${checked.status.blockNumber}`} last />
        </Card>
        {note.reconciliation === 'restored-note' && <Notice title="Restored note needs review"
          body="This note came from a backup and still needs to be checked against the pool." tone="amber" />}
        {note.reconciliation === 'withdrawal-history' && <Notice title="Saved withdrawal history"
          body="This note has a saved withdrawal record that needs review. Its outcome hasn’t been checked here." tone="amber" />}
        {inventory?.checkNote && <Button title={checked?.phase === 'checking' ? 'Checking pool…' : checked?.status ? 'Check status again' : 'Check pool status'}
          variant="secondary" disabled={checked?.phase === 'checking'} onPress={() => { void checkNote(); }} />}
        {checked?.phase === 'failed' && <Text accessibilityRole="alert" style={s.error}>Could not check this note. Try again.</Text>}
        {inventory?.openWithdrawal && (checked?.status?.phase === 'verified' || note.reconciliation === 'withdrawal-history') && <Button
          title={note.reconciliation === 'withdrawal-history' ? 'View withdrawal status' : 'Withdraw'}
          disabled={checked?.phase === 'checking'} onPress={() => updateReady({ withdrawing: true })} />}
        <Button title="Back up this note" variant="secondary" disabled={checked?.phase === 'checking'} onPress={() => updateReady({ revealing: true })} />
      </> : <>
        {view.phase === 'loading' && <Text accessibilityLiveRegion="polite" style={styles.muted}>Loading saved notes…</Text>}
        {view.phase === 'error' && <>
          <Text accessibilityRole="alert" style={s.error}>Could not load saved notes.</Text>
          <Button title="Retry" variant="secondary" onPress={() => {
            setState(LOADING);
            void load();
          }} />
        </>}
        {view.phase === 'retired' && <Text style={styles.muted}>Open Saved notes again to continue.</Text>}
        {view.phase === 'ready' && notes.length === 0 && <Notice title="No saved notes"
          body="Private notes you create or import appear here." />}
        {view.phase === 'ready' && rows.length > 0 && <>
          <Text style={styles.muted}>{inventory?.checkNote ? 'Open a note to check its pool status or make a backup.' : 'These notes are saved on this device.'}</Text>
          {notes.length > PAGE_SIZE && <Text accessibilityLiveRegion="polite" style={styles.muted}>
            Notes {start + 1}–{start + rows.length} of {notes.length}
          </Text>}
          <Card>
            {rows.map((row, index) => <Row key={start + index} title={`${row.amount} ETH pool`}
              subtitle={`Note ${start + index + 1} · ${recordedDate(row.createdAt)}`}
              onPress={() => { setInspection(null); updateReady({ selected: start + index }); }} last={index === rows.length - 1} />)}
          </Card>
          {(page > 0 || next) && <View style={s.pages}>
            <View style={s.page}><Button title="Previous" variant="secondary" disabled={page === 0} onPress={() => updateReady({ page: page - 1 })} /></View>
            <View style={s.page}><Button title="Next" variant="secondary" disabled={!next} onPress={() => updateReady({ page: page + 1 })} /></View>
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
