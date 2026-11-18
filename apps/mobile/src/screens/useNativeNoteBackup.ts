import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useNativeTranslation } from '../platform/localization';
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
type ExportOutcome = Extract<NativeNoteExportStep, { phase: 'saved' | 'verified' | 'unconfirmed' }>;
type RestoreOutcome = Extract<NativeNoteRestoreStep, { phase: 'restored' | 'unconfirmed' }>;
type BackupAccount = NonNullable<CustodySnapshot['account']>;
type BackupOutcome = { owner: Owner; account: BackupAccount } & (
  | { mode: 'export'; outcome: ExportOutcome }
  | { mode: 'restore'; outcome: RestoreOutcome }
);
type Route = {
  readonly owner: Owner;
  readonly mode: 'restore' | 'export';
  flow?: ReturnType<typeof import('../custody/nativeNoteRestore').createNativeNoteRestore>;
  exporter?: ReturnType<typeof import('../custody/nativeNoteExport').createNativeNoteExport>;
  checkPair?: () => Promise<void>;
  destination: boolean;
  pickerFeedbackKey?: string;
  outcomeAccount?: BackupAccount;
  exportOutcome?: ExportOutcome;
  restoreOutcome?: RestoreOutcome;
  saving: boolean;
  handoff: boolean;
  busy: boolean;
  authentication: NativePrivateAuthenticationScope;
};
const invalidated = () => new Error('BACKUP_CANCELLED');
const failureKey = (cause: unknown) => {
  const code = cause instanceof Error ? cause.message : '';
  if (code === 'BACKUP_OPEN_FAILED') return 'privacy.bundle.fileInvalid';
  if (code === 'FILE_INVALID' || code === 'BACKUP_INVALID_FORMAT') return 'mobile.noteFlows.restore.invalidBackupFile';
  if (code === 'FILE_BUSY' || code === 'BACKUP_BUSY') return 'privacy.bundle.busy';
  if (code === 'BACKUP_AUTHENTICATION_FAILED') return 'mobile.sentryViews.couldNotAuthorizeThisRequestTryAgain';
  if (code === 'BACKUP_NOTE_LIMIT') return 'privacy.bundle.capacity';
  if (code === 'BACKUP_CANCELLED' || code === 'BACKUP_STALE') return 'privacy.bundle.expired';
  return 'privacy.bundle.failed';
};

export function useNativeNoteBackup(getOwner: () => Owner | null, enter: (mode: Route['mode']) => void) {
  const { t } = useNativeTranslation();
  const route = useRef<Route | null>(null);
  const interruptedBackup = useRef<BackupOutcome | null>(null);
  const [step, setStep] = useState<NativeNoteRestoreStep>({ phase: 'select' });
  const [exportStep, setExportStep] = useState<NativeNoteExportStep>({ phase: 'select' });
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const cancel = useCallback(() => {
    const previous = route.current;
    route.current = null;
    interruptedBackup.current = null;
    previous?.authentication.retire();
    previous?.flow?.cancel();
    previous?.exporter?.cancel();
    setStep({ phase: 'select' }); setExportStep({ phase: 'select' }); setBusy(false); setErrorKey('');
  }, []);
  const leaveRestore = () => {
    // The submit handler marks the route busy before the review can render it.
    if (step.phase === 'review' && route.current?.busy) return false;
    cancel();
    return true;
  };
  const leaveExport = () => {
    // The provider can already have created the file before the next render.
    if (route.current?.saving) return false;
    cancel();
    return true;
  };
  const lock = useCallback((preserveOutcome = false) => {
    const owned = route.current;
    owned?.authentication.retire();
    if (owned?.handoff) return;
    // A dispatched write can outlive its route. Retain only the outcome
    // for that wallet and account while revoking all file capabilities.
    let interrupted = interruptedBackup.current;
    if (owned?.outcomeAccount) {
      const identity = { owner: owned.owner, account: owned.outcomeAccount };
      if (owned.mode === 'restore' && owned.restoreOutcome) {
        interrupted = { ...identity, mode: 'restore', outcome: owned.restoreOutcome };
      } else if (owned.mode === 'export') {
        const outcome: ExportOutcome | undefined = owned.saving ? { phase: 'unconfirmed' } : owned.exportOutcome;
        if (outcome) interrupted = { ...identity, mode: 'export', outcome: outcome.phase === 'saved' ? { ...outcome, canVerify: false } : outcome };
      }
    }
    cancel();
    if (preserveOutcome) interruptedBackup.current = interrupted;
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
    const interrupted = interruptedBackup.current;
    if (interrupted) {
      if (AppState.currentState !== 'active') return false;
      const owner = getOwner();
      if (owner !== interrupted.owner) {
        interruptedBackup.current = null;
        return false;
      }
      const snapshot = owner.authority.getSnapshot();
      if (snapshot.phase !== 'ready') return false;
      if (snapshot.account?.address !== interrupted.account.address || snapshot.account.network !== interrupted.account.network) {
        interruptedBackup.current = null;
        return false;
      }
      if (interrupted.mode === 'restore') setStep(interrupted.outcome);
      else setExportStep(interrupted.outcome);
      enter(interrupted.mode);
      return true;
    }
    if (!owned?.handoff || !foreground(owned)) return false;
    // Unlock can finish while the native provider is still reading. Keep
    // the pending operation on its own screen so Back can retire it.
    if (owned.busy) { enter(owned.mode); return true; }
    owned.authentication = createNativePrivateAuthenticationScope();
    owned.handoff = false;
    if (owned.pickerFeedbackKey !== undefined) {
      owned.checkPair = undefined;
      if (owned.mode === 'restore') setStep({ phase: 'select' });
      else setExportStep({ phase: 'select' });
      setErrorKey(owned.pickerFeedbackKey); owned.pickerFeedbackKey = undefined;
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
    owned.busy = true; setBusy(true); setErrorKey('');
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
      if (owned.mode === 'restore') {
        const selected = await owned.flow!.select(files.pickNoteBackupFile, assertOwner, () => {
          const key = 'mobile.sentryViews.requestExpired';
          if (foreground(owned)) { setStep({ phase: 'select' }); setErrorKey(key); }
          else if (current(owned) && owned.handoff) owned.pickerFeedbackKey = key;
        });
        if (!selected) owned.pickerFeedbackKey = '';
      } else {
        const token = await files.pickNoteBackupDestination();
        if (token !== null) {
          try {
            assertOwner();
            owned.exporter!.select(token, assertOwner, () => {
              owned.destination = false;
              const key = 'mobile.sentryViews.requestExpired';
              if (!foreground(owned)) {
                if (current(owned) && owned.handoff) owned.pickerFeedbackKey = key;
              } else if (owned.saving) {
                // The write reports its outcome after the destination is revoked.
                return;
              } else if (owned.exportOutcome?.phase === 'saved')
                setExportStep({ ...owned.exportOutcome, canVerify: false });
              else { setExportStep({ phase: 'select' }); setErrorKey(key); }
            });
            owned.destination = true;
          } catch (cause) { void files.revokeNoteBackupDestination(token); throw cause; }
        } else owned.pickerFeedbackKey = '';
      }
    } catch (cause) {
      if (current(owned)) {
        const code = cause instanceof Error ? cause.message : '';
        const key = owned.mode === 'export' && code !== 'FILE_BUSY'
          ? 'privacy.bundle.failed'
          : failureKey(cause);
        if (foreground(owned)) { owned.handoff = false; setErrorKey(key); }
        else if (owned.handoff) owned.pickerFeedbackKey = key;
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
    owned.busy = true; setBusy(true); setErrorKey('');
    try {
      try { await owned.checkPair(); }
      catch { flow.cancel(); throw invalidated(); }
      assertWallet();
      const preview = await flow.prepare(password, assertWallet, () => {
        if (foreground(owned)) { setStep({ phase: 'select' }); setErrorKey('privacy.bundle.expired'); }
      });
      assertWallet();
      setStep({ phase: 'review', preview });
    } catch (cause) {
      if (foreground(owned)) {
        setStep({ phase: flow.hasFile() ? 'password' : 'select' });
        setErrorKey(failureKey(cause));
      }
    } finally { finish(owned); }
  };
  const restore = async (id: string) => {
    const owned = route.current;
    const flow = owned?.flow;
    if (!owned || !flow || !foreground(owned) || owned.busy || owned.restoreOutcome ||
        step.phase !== 'review' || step.preview.id !== id) return;
    owned.outcomeAccount = owned.owner.authority.getSnapshot().account ?? undefined;
    owned.restoreOutcome = { phase: 'unconfirmed' };
    owned.busy = true; setBusy(true); setErrorKey('');
    try {
      const receipt = await flow.restore(id);
      if (foreground(owned)) {
        owned.restoreOutcome = { phase: 'restored', added: receipt.added };
        setStep(owned.restoreOutcome);
      }
    } catch (cause) {
      if (foreground(owned)) {
        if (cause instanceof Error && cause.message === 'BACKUP_COMMIT_UNCONFIRMED') {
          const outcome = { phase: 'unconfirmed' } as const;
          cancel();
          if (owned.outcomeAccount) interruptedBackup.current = { owner: owned.owner, account: owned.outcomeAccount, mode: 'restore', outcome };
          setStep(outcome);
          owned.owner.authority.lock();
        } else {
          owned.restoreOutcome = undefined;
          const code = cause instanceof Error ? cause.message : '';
          setStep({ phase: 'select' });
          setErrorKey(code === 'BACKUP_CANCELLED' || code === 'BACKUP_STALE'
            ? 'mobile.noteFlows.import.couldNotConfirmTheImportCheckSavedNotes'
            : failureKey(cause));
        }
      }
    } finally { finish(owned); }
  };
  const persistExport = async (owned: Route, noteCount: number) => {
    try {
      if (!foreground(owned)) throw invalidated();
      owned.outcomeAccount = owned.owner.authority.getSnapshot().account ?? undefined;
      owned.saving = true;
      setExportStep({ phase: 'writing' });
      await owned.exporter!.save();
      if (foreground(owned)) {
        owned.exportOutcome = { phase: 'saved', noteCount };
        setExportStep(owned.exportOutcome);
      }
    } catch (cause) {
      if (foreground(owned)) {
        owned.destination = false;
        if (cause instanceof Error && cause.message === 'FILE_WRITE_UNCONFIRMED') {
          owned.exportOutcome = { phase: 'unconfirmed' };
          setExportStep(owned.exportOutcome);
        } else { setExportStep({ phase: 'select' }); setErrorKey('privacy.bundle.failed'); }
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
    owned.busy = true; setBusy(true); setErrorKey('');
    // The provider task receives only the prepared ciphertext and public count.
    void prepareExport(owned, backupPassword).then(
      ({ noteCount }) => persistExport(owned, noteCount),
      cause => {
        if (foreground(owned)) {
          const code = cause instanceof Error ? cause.message : '';
          if (code === 'BACKUP_AUTHENTICATION_FAILED') setErrorKey('mobile.sentryViews.couldNotAuthorizeThisRequestTryAgain');
          else if (code === 'BACKUP_INVALID_PASSWORD') setErrorKey('mobile.noteFlows.export.useASeparateBackupPasswordWithAtLeast');
          else {
            owned.destination = false;
            setExportStep({ phase: 'select' }); setErrorKey('privacy.bundle.failed');
            owned.exporter!.cancel();
          }
        }
        finish(owned);
      }
    );
  };
  const showVerify = () => {
    const owned = route.current;
    if (!owned || !foreground(owned) || owned.exportOutcome?.phase !== 'saved' || !owned.destination || owned.busy) return;
    setErrorKey(''); setExportStep({ phase: 'verify', noteCount: owned.exportOutcome.noteCount });
  };
  const verifyExport = async (password: string) => {
    const owned = route.current;
    const saved = owned?.exportOutcome;
    if (!owned?.exporter || !foreground(owned) || saved?.phase !== 'saved' || owned.busy) return;
    owned.busy = true; setBusy(true); setErrorKey('');
    try {
      const receipt = await owned.exporter.verify(password);
      if (foreground(owned)) {
        owned.exportOutcome = { phase: 'verified', noteCount: receipt.noteCount };
        setExportStep(owned.exportOutcome);
      }
    } catch (cause) {
      if (foreground(owned)) {
        if (cause instanceof Error && cause.message === 'BACKUP_OPEN_FAILED') setErrorKey('privacy.bundle.fileInvalid');
        else { setExportStep({ ...saved, canVerify: false }); setErrorKey('mobile.noteFlows.export.savedFileVerificationUnavailable'); }
      }
    } finally { finish(owned); }
  };
  return { begin, cancel, leaveRestore, leaveExport, lock, resume, step, exportStep, busy, error: errorKey ? t(errorKey) : '', choose, open, restore, saveExport, showVerify, verifyExport };
}
