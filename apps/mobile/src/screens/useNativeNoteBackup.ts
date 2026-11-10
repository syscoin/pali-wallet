import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { NativeNoteBackupRuntime } from '../custody/noteBackupRuntime';
import type { CustodySnapshot } from '../custody/types';
import type { NativeNoteRestoreStep } from './NativeNoteRestore';
import type { NativeNoteExportStep } from './NativeNoteExport';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

type Guard = () => void;
type Owner = {
  authority: { getSnapshot(): CustodySnapshot; lock(): void };
  openNoteBackup(assertOwner: Guard, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteBackupRuntime>;
  captureNoteFileOwner(assertOwner: Guard): Promise<() => Promise<void>>;
};
type Route = {
  readonly owner: Owner;
  readonly mode: 'restore' | 'export';
  flow?: ReturnType<typeof import('../custody/nativeNoteRestore').createNativeNoteRestore>;
  exporter?: ReturnType<typeof import('../custody/nativeNoteExport').createNativeNoteExport>;
  checkPair?: () => Promise<void>;
  destination: boolean;
  pickerFeedback?: string;
  savedCount?: number;
  saving: boolean;
  handoff: boolean;
  busy: boolean;
  authentication: NativePrivateAuthenticationScope;
};
const invalidated = () => new Error('BACKUP_CANCELLED');
const failure = (cause: unknown) => {
  const code = cause instanceof Error ? cause.message : '';
  if (code === 'BACKUP_OPEN_FAILED') return 'Could not open this backup. Check the password and file.';
  if (code === 'FILE_INVALID' || code === 'BACKUP_INVALID_FORMAT') return 'Choose a valid encrypted Pali backup.';
  if (code === 'FILE_BUSY' || code === 'BACKUP_BUSY') return 'Wait for the current file operation to finish.';
  if (code === 'BACKUP_AUTHENTICATION_FAILED') return 'Could not authorize this restore. Choose the backup to try again.';
  if (code === 'BACKUP_NOTE_LIMIT') return 'This backup exceeds the wallet’s private note capacity.';
  if (code === 'BACKUP_CANCELLED' || code === 'BACKUP_STALE') return 'This restore expired. Choose the backup again.';
  return 'Could not open or restore this backup.';
};

export function useNativeNoteBackup(getOwner: () => Owner | null, enter: (mode: Route['mode']) => void) {
  const route = useRef<Route | null>(null);
  const [step, setStep] = useState<NativeNoteRestoreStep>({ phase: 'select' });
  const [exportStep, setExportStep] = useState<NativeNoteExportStep>({ phase: 'select' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = useCallback(() => {
    const previous = route.current;
    route.current = null;
    previous?.authentication.retire();
    previous?.flow?.cancel();
    previous?.exporter?.cancel();
    setStep({ phase: 'select' }); setExportStep({ phase: 'select' }); setBusy(false); setError('');
  }, []);
  const lock = useCallback(() => {
    // Only the picker ticket or its bounded ciphertext can outlive this lock.
    route.current?.authentication.retire();
    if (!route.current?.handoff) cancel();
  }, [cancel]);
  useLayoutEffect(() => () => { route.current?.authentication.retire(); route.current?.flow?.cancel(); route.current?.exporter?.cancel(); route.current = null; }, []);
  const current = (owned: Route) => route.current === owned && getOwner() === owned.owner;
  const foreground = (owned: Route) => current(owned) && AppState.currentState === 'active' &&
    owned.owner.authority.getSnapshot().phase === 'ready';
  const walletGuard = (owned: Route) => {
    const start = owned.owner.authority.getSnapshot();
    return () => {
      if (!current(owned) || owned.owner.authority.getSnapshot().phase !== 'ready' ||
          (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(owned.authentication, AppState.currentState)) ||
          owned.owner.authority.getSnapshot() !== start) throw invalidated();
    };
  };
  const finish = (owned: Route) => { owned.busy = false; if (current(owned)) setBusy(false); };
  const resume = (expected?: Route) => {
    const owned = route.current;
    if (expected && owned !== expected) return false;
    if (!owned?.handoff || !foreground(owned)) return false;
    // Unlock can finish while the native provider is still reading. Keep
    // the pending operation on its own screen so Back can retire it.
    if (owned.busy) { enter(owned.mode); return true; }
    owned.authentication = createNativePrivateAuthenticationScope();
    owned.handoff = false;
    if (owned.pickerFeedback) {
      if (owned.mode === 'restore') setStep({ phase: 'select' });
      else setExportStep({ phase: 'select' });
      setError(owned.pickerFeedback); owned.pickerFeedback = undefined;
      enter(owned.mode);
      return true;
    }
    if (owned.mode === 'restore' && owned.flow?.hasFile()) { setStep({ phase: 'password' }); enter('restore'); return true; }
    if (owned.mode === 'export' && owned.destination) { setExportStep({ phase: 'passwords' }); enter('export'); return true; }
    cancel();
    return false;
  };
  const begin = (mode: Route['mode'] = 'restore') => {
    const owner = getOwner();
    if (!owner || owner.authority.getSnapshot().phase !== 'ready') return false;
    cancel();
    route.current = { owner, mode, destination: false, saving: false, handoff: false, busy: false, authentication: createNativePrivateAuthenticationScope() };
    return true;
  };
  const choose = async () => {
    const owned = route.current;
    if (!owned || !foreground(owned) || owned.busy) return;
    const assertOwner = () => { if (!current(owned)) throw invalidated(); };
    owned.busy = true; setBusy(true); setError('');
    try {
      const files = await import('../platform/noteBackupPicker');
      if (owned.mode === 'restore' && !owned.flow) {
        const { createNativeNoteRestore } = await import('../custody/nativeNoteRestore');
        owned.flow = createNativeNoteRestore(check => owned.owner.openNoteBackup(check, owned.authentication));
      }
      if (owned.mode === 'export' && !owned.exporter) {
        const { createNativeNoteExport } = await import('../custody/nativeNoteExport');
        owned.exporter = createNativeNoteExport(check => owned.owner.openNoteBackup(check, owned.authentication), { write: files.writeNoteBackupFile, revoke: files.revokeNoteBackupDestination });
      }
      assertOwner();
      owned.checkPair = await owned.owner.captureNoteFileOwner(assertOwner);
      if (!foreground(owned)) throw invalidated();
      // Android leaves the activity for the system picker. Retire custody before
      // that handoff, and keep the same owner for the encrypted file only.
      owned.handoff = true;
      if (files.shouldLockWalletForNotePicker()) owned.owner.authority.lock();
      if (owned.mode === 'restore') await owned.flow!.select(files.pickNoteBackupFile, assertOwner, () => {
        const copy = 'This file selection expired. Choose the backup again.';
        if (foreground(owned)) { setStep({ phase: 'select' }); setError(copy); }
        else if (current(owned) && owned.handoff) owned.pickerFeedback = copy;
      });
      else {
        const token = await files.pickNoteBackupDestination();
        if (token !== null) {
          try {
            assertOwner();
            owned.exporter!.select(token, assertOwner, () => {
              owned.destination = false;
              const copy = 'This folder selection expired. Choose a folder again.';
              if (!foreground(owned)) {
                if (current(owned) && owned.handoff) owned.pickerFeedback = copy;
              } else if (owned.saving) setExportStep({ phase: 'unconfirmed' });
              else if (owned.savedCount !== undefined)
                setExportStep({ phase: 'saved', noteCount: owned.savedCount, canVerify: false });
              else { setExportStep({ phase: 'select' }); setError(copy); }
            });
            owned.destination = true;
          } catch (cause) { void files.revokeNoteBackupDestination(token); throw cause; }
        }
      }
    } catch (cause) {
      if (current(owned)) {
        const code = cause instanceof Error ? cause.message : '';
        const copy = owned.mode === 'export' && code !== 'FILE_BUSY'
          ? 'Could not open that folder. Choose another folder in Files.'
          : failure(cause);
        if (foreground(owned)) { owned.handoff = false; setError(copy); }
        else if (owned.handoff) owned.pickerFeedback = copy;
        else cancel();
      }
    } finally {
      owned.busy = false;
      if (current(owned)) { setBusy(false); resume(owned); }
    }
  };
  const open = async (password: string) => {
    const owned = route.current;
    const flow = owned?.flow;
    if (!owned?.checkPair || !flow || !foreground(owned) || owned.busy) return;
    const assertWallet = walletGuard(owned);
    owned.busy = true; setBusy(true); setError('');
    try {
      try { await owned.checkPair(); }
      catch { flow.cancel(); throw invalidated(); }
      assertWallet();
      const preview = await flow.prepare(password, assertWallet, () => {
        if (foreground(owned)) { setStep({ phase: 'select' }); setError('This review expired. Choose the backup again.'); }
      });
      assertWallet();
      setStep({ phase: 'review', preview });
    } catch (cause) {
      if (foreground(owned)) {
        setStep({ phase: flow.hasFile() ? 'password' : 'select' });
        setError(failure(cause));
      }
    } finally { finish(owned); }
  };
  const restore = async (id: string) => {
    const owned = route.current;
    const flow = owned?.flow;
    if (!owned || !flow || !foreground(owned) || owned.busy) return;
    owned.busy = true; setBusy(true); setError('');
    try {
      const receipt = await flow.restore(id);
      if (foreground(owned)) setStep({ phase: 'restored', receipt });
    } catch (cause) {
      if (foreground(owned)) {
        if (cause instanceof Error && cause.message === 'BACKUP_COMMIT_UNCONFIRMED') {
          cancel();
          setStep({ phase: 'unconfirmed' });
          owned.owner.authority.lock();
        } else {
          const code = cause instanceof Error ? cause.message : '';
          setStep({ phase: 'select' });
          setError(code === 'BACKUP_CANCELLED' || code === 'BACKUP_STALE'
            ? 'Pali could not confirm this restore. Open the backup again to see which notes are already saved.'
            : failure(cause));
        }
      }
    } finally { finish(owned); }
  };
  const persistExport = async (owned: Route, noteCount: number) => {
    try {
      if (!foreground(owned)) throw invalidated();
      owned.saving = true;
      await owned.exporter!.save();
      if (foreground(owned)) {
        owned.savedCount = noteCount;
        setExportStep({ phase: 'saved', noteCount });
      }
    } catch (cause) {
      if (foreground(owned)) {
        owned.destination = false;
        if (cause instanceof Error && cause.message === 'FILE_WRITE_UNCONFIRMED') setExportStep({ phase: 'unconfirmed' });
        else { setExportStep({ phase: 'select' }); setError('Could not save the backup. Choose a folder again.'); }
      }
    } finally { owned.saving = false; finish(owned); }
  };
  const prepareExport = async (owned: Route, backupPassword: string) => {
    const assertWallet = walletGuard(owned);
    await owned.checkPair!();
    assertWallet();
    return owned.exporter!.prepare(backupPassword, assertWallet);
  };
  const saveExport = (backupPassword: string) => {
    const owned = route.current;
    if (!owned?.exporter || !owned.destination || !owned.checkPair || !foreground(owned) || owned.busy) return;
    owned.busy = true; setBusy(true); setError('');
    // The provider task receives only the prepared ciphertext and public count.
    void prepareExport(owned, backupPassword).then(
      ({ noteCount }) => persistExport(owned, noteCount),
      cause => {
        if (foreground(owned)) {
          const code = cause instanceof Error ? cause.message : '';
          if (code === 'BACKUP_AUTHENTICATION_FAILED') setError('Could not authorize this backup.');
          else if (code === 'BACKUP_INVALID_PASSWORD') setError('Use a separate backup password with at least 12 characters.');
          else {
            owned.destination = false;
            setExportStep({ phase: 'select' }); setError('Could not prepare the backup. Choose a folder again.');
            owned.exporter!.cancel();
          }
        }
        finish(owned);
      }
    );
  };
  const showVerify = () => {
    const owned = route.current;
    if (!owned || !foreground(owned) || owned.savedCount === undefined || !owned.destination || owned.busy) return;
    setError(''); setExportStep({ phase: 'verify', noteCount: owned.savedCount });
  };
  const verifyExport = async (password: string) => {
    const owned = route.current;
    if (!owned?.exporter || !foreground(owned) || owned.savedCount === undefined || owned.busy) return;
    owned.busy = true; setBusy(true); setError('');
    try {
      const receipt = await owned.exporter.verify(password);
      if (foreground(owned)) setExportStep({ phase: 'verified', noteCount: receipt.noteCount });
    } catch (cause) {
      if (foreground(owned)) {
        if (cause instanceof Error && cause.message === 'BACKUP_OPEN_FAILED') setError('Could not open the saved backup with that password.');
        else { setExportStep({ phase: 'saved', noteCount: owned.savedCount, canVerify: false }); setError('This file could not be verified.'); }
      }
    } finally { finish(owned); }
  };
  return { begin, cancel, lock, resume, step, exportStep, busy, error, choose, open, restore, saveExport, showVerify, verifyExport };
}
