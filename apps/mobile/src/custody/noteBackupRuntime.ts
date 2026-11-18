import type { NativePrivateAuthenticationScope } from './privateAuthentication.ts';
import { HOST_WALLET_AUTHENTICATION } from '../../../../source/shared/walletAuthentication.ts';
import { NativeOperationDrain } from './operationDrain.ts';
import type { IPrivacyWithdrawalAttempt, IPrivacyWithdrawalSession } from '../../../../source/utils/privacy/withdrawalTransactionTypes.ts';
import type { IPrivacyWithdrawalHistory, IPrivacyWithdrawalSubmissionApproval } from '../../../../source/utils/privacy/withdrawTypes.ts';
import type { IPrivacyDepositAttempt } from '../../../../source/utils/privacy/transactionTypes.ts';
import { generateClassicNote, identifyClassicNote } from '../../../../source/utils/privacy/note.ts';
import type { IPrivacyNoteReader, IPrivateNoteStatus, IPrivateVaultCapacity, IPrivateVaultController } from '../../../../source/utils/privacy/privateVaultTypes.ts';
import { AsyncMutex } from '../../../../source/utils/asyncMutex.ts';
import {
  createNoteBackupService,
  NoteBackupServiceError,
  type INoteBackupService,
} from '../../../../source/wallet/noteBackupService.ts';
import {
  createPrivateVaultController,
  PRIVATE_VAULT_STORAGE_PREFIX,
  type IPrivateVaultHost,
  type IPrivateVaultSession,
} from '../../../../source/wallet/privateVault.ts';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types.ts';
import { WalletStorageError, type OpenWalletStorage } from '../storage/types.ts';
import type { NativePrivateWithdrawalView } from './privateWithdrawal.ts';
import type { NativeNoteMaintenanceProofs } from './noteMaintenance.ts';
import { UUID } from '../../../../source/wallet/privateVaultInspection.ts';

/** Internal file authority. Exported bytes go only to the trusted file adapter. */
export type NativeNoteBackupRuntime = Readonly<Omit<INoteBackupService, 'dispose' | 'exportEncrypted' | 'commitImport'> & {
  exportEncrypted(id: string, backupPassword: string): ReturnType<INoteBackupService['exportEncrypted']>;
  commitImport(id: string): ReturnType<INoteBackupService['commitImport']>;
}>;
export type NativeNoteMaintenanceRuntime = Readonly<{
  dispose(): Promise<void>;
  getNotes(assertCurrent: () => void): ReturnType<IPrivateVaultController['getNotes']>;
  clearCompletedNotes(ids: readonly string[], assertCurrent: () => void,
    onProgress: (progress: Readonly<{ checked: number; total: number }>) => void,
    onReload: (inventory: Awaited<ReturnType<IPrivateVaultController['getNotes']>>) => void): ReturnType<IPrivateVaultController['clearCompletedNotes']>;
  recoverFailedWithdrawal(id: string, assertCurrent: () => void,
    onReload: (inventory: Awaited<ReturnType<IPrivateVaultController['getNotes']>>) => void): Promise<void>;
}>;
export type NativeNoteCapacityRuntime = Readonly<Pick<IPrivateVaultController, 'getCapacity' | 'setCapacity'>>;
export type NativeSavedNote = Readonly<{
  amount: string;
  archivedAt?: number;
  createdAt: number;
  reconciliation?: 'restored-note' | 'withdrawal-history';
  withdrawalPending?: true;
  withdrawalStatusAvailable?: true;
}>;
export type NativeNoteInventory = Readonly<{
  archiveSummary?: NonNullable<Awaited<ReturnType<IPrivateVaultController['getNotes']>>['archiveSummary']>;
  archive?: Readonly<{
    open(assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteArchiveInventory>;
  }>;
  notes: readonly NativeSavedNote[];
  checkNote?(note: NativeSavedNote, assertCurrent: () => void): Promise<IPrivateNoteStatus>;
  openWithdrawal?(note: NativeSavedNote, signal: AbortSignal, assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativePrivateWithdrawalView>;
  revealNote(note: NativeSavedNote, assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<string>;
}>;
export type NativeNoteArchiveInventory = Readonly<{
  bundleLimitBytes: number;
  clearArchive(assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteArchiveMutation & { removed: number }>;
  limit: number;
  notes: readonly NativeSavedNote[];
  restoreNote(note: NativeSavedNote, assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteArchiveMutation>;
  revealNote(note: NativeSavedNote, assertCurrent: () => void, authentication: NativePrivateAuthenticationScope): Promise<string>;
  storedBytes: number;
}>;
export type NativeNoteArchiveMutation = Readonly<{
  inventory: NativeNoteInventory;
  archive: NativeNoteArchiveInventory;
}>;

type NativeNoteBackupPorts = Readonly<{
  assertAvailable(): void;
  authenticate: IPrivateVaultHost['authenticate'];
  binding(): Promise<Readonly<{ profileId: string; walletBindingId: string }>>;
  withdrawalScope(): Readonly<{ context: IPrivacyWithdrawalSession['context']; lifetime: string }> | null;
  notes: NonNullable<OpenWalletStorage['notes']>;
  requireReopen(): void;
  run<T>(operation: () => Promise<T>, preserveCancellation?: boolean): Promise<T>;
}>;
type NativeNoteAcknowledgement = Readonly<{
  session: IPrivateVaultSession;
  retain(): void;
  settle(): void;
}>;

export function createNativeNoteBackupRuntime(ports: NativeNoteBackupPorts) {
  let capture: IPrivateVaultSession | undefined;
  let invalidate: (() => void) | undefined;
  let resumeInventory: (() => void) | undefined;
  const crypto = globalThis.crypto;
  const monotonicNow = () => performance.now();
  const randomId = () => crypto.randomUUID();
  const captureSession = () => {
    if (!capture) throw new NoteBackupServiceError('BACKUP_UNAVAILABLE');
    return capture;
  };
  const withSession = <T>(session: IPrivateVaultSession, action: () => T): T => {
    if (capture) throw new NoteBackupServiceError('BACKUP_BUSY');
    capture = session;
    try { return action(); } finally { capture = undefined; }
  };
  const ownedSession = (session: IPrivateVaultSession, assertCurrent: () => void): IPrivateVaultSession => Object.freeze({
    ...session,
    assertCurrent() {
      session.assertCurrent();
      const result: unknown = assertCurrent();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw new Error('privacy_vault_session_changed');
      }
      session.assertCurrent();
    },
  });
  const withStorage = async <T>(action: () => Promise<T>): Promise<T> => {
    try { return await action(); }
    catch (error) {
      if (error instanceof WalletStorageError && error.code === 'STORAGE_REOPEN_REQUIRED') ports.requireReopen();
      throw error;
    }
  };
  const bindKey = async (key: string) => {
    const scope = await ports.binding();
    if (key !== PRIVATE_VAULT_STORAGE_PREFIX + scope.profileId)
      throw new Error('privacy_vault_session_changed');
    return scope;
  };
  const mutex = new AsyncMutex();
  const createVault = (readNote: IPrivacyNoteReader, maintenance: NativeNoteMaintenanceProofs | null) => createPrivateVaultController({
    captureSession,
    authenticate: ports.authenticate,
    readNote,
    ...(maintenance === null ? {} : maintenance),
  }, {
    identify: identifyClassicNote,
    generate: generateClassicNote,
    mutex,
    now: Date.now,
    deadlineNow: monotonicNow,
    randomId,
    yieldInventory: () => new Promise<void>((resolve) => {
      const timer = setTimeout(resume, 0);
      function resume() {
        if (resumeInventory !== resume) return;
        resumeInventory = undefined;
        clearTimeout(timer);
        resolve();
      }
      resumeInventory = resume;
    }),
    storage: {
      getItem: (key) => withStorage(async () => {
        const scope = await bindKey(key);
        const [row] = await ports.notes.read();
        if (row && (row.profileId !== scope.profileId || row.walletBindingId !== scope.walletBindingId))
          throw new Error('privacy_vault_session_changed');
        return row?.value;
      }),
      compareAndSet: (key, expected, next, assertCurrent) => withStorage(async () => {
        assertCurrent();
        const scope = await bindKey(key);
        assertCurrent();
        return ports.notes.compareAndSet(scope.profileId, scope.walletBindingId, expected, next, assertCurrent);
      }),
    },
  });
  // Inventory and encrypted backups read local records without network work.
  const vault = createVault(async () => ({ phase: 'waiting' }), null);
  const service = createNoteBackupService({
    captureSession,
    crypto,
    monotonicNow,
    randomId,
    scheduleExpiry(expire, delay) {
      const timer = setTimeout(expire, delay);
      return () => clearTimeout(timer);
    },
    subscribeInvalidation(callback) {
      invalidate = callback;
      return () => { invalidate = undefined; };
    },
    vault,
  });
  return {
    reveal(session: IPrivateVaultSession, id: string) {
      return withSession(session, () => vault.revealNote(id, HOST_WALLET_AUTHENTICATION));
    },
    restoreArchivedNote(session: IPrivateVaultSession, id: string) {
      return withSession(session, () => vault.restoreArchivedNote(id, HOST_WALLET_AUTHENTICATION));
    },
    clearArchive(session: IPrivateVaultSession) {
      return withSession(session, () => vault.clearArchive(HOST_WALLET_AUTHENTICATION));
    },
    openDeposit(session: IPrivateVaultSession, acknowledgement: NativeNoteAcknowledgement, readNote: IPrivacyNoteReader) {
      const operational = createVault(readNote, null);
      return Object.freeze({
        prepareNote: (poolId: Parameters<typeof operational.prepareDepositNote>[0], noteId?: string) =>
          ports.run(() => operational.prepareDepositNote(poolId, noteId, session)),
        withCommitment: <T>(noteId: string, use: (commitment: string) => T) =>
          ports.run(() => operational.withDepositCommitment(noteId, session, use)),
        reserve: (attempt: IPrivacyDepositAttempt, onFence: (guard: () => void) => void) =>
          ports.run(() => operational.reserveDepositAttempt(attempt, session, guard => { acknowledgement.retain(); onFence(guard); })),
        recordBroadcast: (attempt: IPrivacyDepositAttempt, hash: string) =>
          operational.recordDepositBroadcast(attempt, hash, acknowledgement.session).finally(acknowledgement.settle),
        recordNotBroadcast: (attempt: IPrivacyDepositAttempt) =>
          operational.clearUnbroadcastDepositAttempt(attempt, acknowledgement.session).finally(acknowledgement.settle),
        readStatus: (noteId: string) => ports.run(() => operational.readNoteStatus(noteId, session)),
      });
    },
    openWithdrawal(session: IPrivateVaultSession, acknowledgement: NativeNoteAcknowledgement, readNote: IPrivacyNoteReader) {
      const operational = createVault(readNote, null);
      const scope = ports.withdrawalScope();
      if (!scope) throw new Error('privacy_withdrawal_context_changed');
      return Object.freeze({
        withNote: <T>(noteId: string, use: (note: string, poolId: PrivacyPoolId, history: Readonly<IPrivacyWithdrawalHistory>) => Promise<T>) =>
          ports.run(() => operational.withWithdrawalNote(noteId, session, use)),
        getAttempt: (noteId: string) => ports.run(() => operational.getWithdrawalAttempt(noteId, session)),
        reserve: (attempt: IPrivacyWithdrawalAttempt, onFence: (guard: () => void) => void, approval: IPrivacyWithdrawalSubmissionApproval) =>
          ports.run(() => operational.reserveWithdrawalAttempt(attempt, session, scope.lifetime, identity => { acknowledgement.retain(); onFence(identity.assertRestoreCurrent); }, approval)),
        consumeUnsigned: (attempt: IPrivacyWithdrawalAttempt, approval: IPrivacyWithdrawalSubmissionApproval) =>
          operational.consumeUnsignedWithdrawal(attempt, acknowledgement.session, scope.lifetime, approval),
        recordSubmission: (attempt: IPrivacyWithdrawalAttempt, response: Parameters<typeof operational.recordWithdrawalSubmission>[1]) =>
          operational.recordWithdrawalSubmission(attempt, response, acknowledgement.session).finally(acknowledgement.settle),
        recordNotBroadcast: (attempt: IPrivacyWithdrawalAttempt) =>
          operational.clearUnbroadcastWithdrawalAttempt(attempt, acknowledgement.session).finally(acknowledgement.settle),
        recordJobStatus: (noteId: string, attemptHash: string, acknowledgement: Parameters<typeof operational.recordWithdrawalJobStatus>[2]) =>
          ports.run(() => operational.recordWithdrawalJobStatus(noteId, attemptHash, acknowledgement, session)),
        readStatus: (noteId: string) => ports.run(() => operational.readNoteStatus(noteId, session)),
      });
    },
    authorizeDepositReplay(session: IPrivateVaultSession, attempt: IPrivacyDepositAttempt, readNote: IPrivacyNoteReader) {
      return createVault(readNote, null).authorizeDepositReplay(attempt, session);
    },
    authorizeWithdrawalReplay(session: IPrivateVaultSession, attempt: Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }>, readNote: IPrivacyNoteReader) {
      return createVault(readNote, null).authorizeWithdrawalReplay(attempt, session);
    },
    invalidate() { resumeInventory?.(); invalidate?.(); },
    dispose() { resumeInventory?.(); service.dispose(); },
    importNote(session: IPrivateVaultSession, note: string, readNote: IPrivacyNoteReader, assertCurrent: () => void) {
      const selected = ownedSession(session, assertCurrent);
      selected.assertCurrent();
      const importer = createVault(readNote, null);
      return ports.run(() => withSession(selected, () => importer.importNote(note)));
    },
    readNoteStatus(session: IPrivateVaultSession, noteId: string, readNote: IPrivacyNoteReader) {
      return ports.run(() => createVault(readNote, null).readNoteStatus(noteId, session));
    },
    async readInventory(session: IPrivateVaultSession, readStatus: ((id: string, poolId: PrivacyPoolId, guard: () => void) => Promise<IPrivateNoteStatus>) | null,
      openWithdrawal: ((id: string, poolId: PrivacyPoolId, signal: AbortSignal, guard: () => void, authentication: NativePrivateAuthenticationScope) => Promise<NativePrivateWithdrawalView>) | null,
      reveal: (id: string, guard: () => void, authentication: NativePrivateAuthenticationScope) => Promise<string>,
      openArchive: (guard: () => void, authentication: NativePrivateAuthenticationScope) => Promise<NativeNoteArchiveInventory>,
      parentSession = session,
      readPendingWithdrawals?: (guard: () => void) => Promise<ReadonlySet<string>>): Promise<NativeNoteInventory> {
      session.assertCurrent(); parentSession.assertCurrent();
      const scope = ports.withdrawalScope();
      const { notes, archiveSummary } = await withSession(session, () => scope
        ? vault.reconcileUnsignedWithdrawals(scope.context, scope.lifetime, session, true)
        : vault.getNotes(true));
      const pendingWithdrawals = await readPendingWithdrawals?.(session.assertCurrent);
      session.assertCurrent(); parentSession.assertCurrent();
      const selections = new WeakMap<NativeSavedNote, { id: string; poolId: PrivacyPoolId }>();
      const rows = notes.map((note) => {
        const row = Object.freeze<NativeSavedNote>({
          amount: note.amount,
          createdAt: note.createdAt,
          ...(pendingWithdrawals?.has(note.id) ? { withdrawalPending: true } : {}),
          ...(openWithdrawal && (note.withdrawal?.mode === 'relayed' || note.restoration === 'withdrawal-pending')
            ? { withdrawalStatusAvailable: true }
            : {}),
          ...(note.withdrawal || note.restoration === 'withdrawal-pending'
            ? { reconciliation: 'withdrawal-history' }
            : note.restoration === 'review-required'
              ? { reconciliation: 'restored-note' }
              : {}),
        });
        selections.set(row, { id: note.id, poolId: note.poolId });
        return row;
      }).sort((left, right) => right.createdAt - left.createdAt);
      return Object.freeze<NativeNoteInventory>({
        ...(archiveSummary ? { archiveSummary: Object.freeze({ ...archiveSummary }) } : {}),
        archive: Object.freeze({ async open(guard, authentication) {
          const owner = ownedSession(parentSession, guard); owner.assertCurrent();
          const result = await openArchive(owner.assertCurrent, authentication);
          owner.assertCurrent(); return result;
        } }),
        notes: Object.freeze(rows),
        ...(readStatus ? { async checkNote(note: NativeSavedNote, assertCurrent: () => void) {
          const selected = selections.get(note);
          if (!selected) throw new Error('privacy_note_missing');
          const owner = ownedSession(parentSession, assertCurrent);
          owner.assertCurrent();
          const status = await readStatus(selected.id, selected.poolId, owner.assertCurrent);
          owner.assertCurrent();
          return Object.freeze({ ...status });
        } } : {}),
        ...(openWithdrawal ? { async openWithdrawal(note: NativeSavedNote, signal: AbortSignal, assertCurrent: () => void, scope: NativePrivateAuthenticationScope) {
          const selected = selections.get(note);
          if (!selected) throw new Error('privacy_note_missing');
          const owner = ownedSession(parentSession, assertCurrent);
          owner.assertCurrent();
          return openWithdrawal(selected.id, selected.poolId, signal, owner.assertCurrent, scope);
        } } : {}),
        async revealNote(note, assertCurrent, authentication) {
          const id = selections.get(note)?.id;
          if (!id || typeof assertCurrent !== 'function') throw new Error('privacy_note_missing');
          const selected = ownedSession(parentSession, assertCurrent);
          const secret = await reveal(id, selected.assertCurrent, authentication);
          selected.assertCurrent();
          return secret;
        },
      });
    },
    async readArchive(session: IPrivateVaultSession,
      reveal: (id: string, guard: () => void, authentication: NativePrivateAuthenticationScope) => Promise<string>,
      restore: (id: string, guard: () => void, authentication: NativePrivateAuthenticationScope) => Promise<NativeNoteArchiveMutation>,
      clearArchive: (guard: () => void, authentication: NativePrivateAuthenticationScope) => Promise<NativeNoteArchiveMutation & { removed: number }>,
      parentSession = session): Promise<NativeNoteArchiveInventory> {
      session.assertCurrent(); parentSession.assertCurrent();
      const archived = await withSession(session, vault.getArchivedNotes);
      session.assertCurrent(); parentSession.assertCurrent();
      const selections = new WeakMap<NativeSavedNote, string>();
      const rows = archived.notes.map(note => {
        const row = Object.freeze<NativeSavedNote>({ amount: note.amount, createdAt: note.createdAt, archivedAt: note.archivedAt });
        selections.set(row, note.id); return row;
      }).sort((left, right) => right.archivedAt! - left.archivedAt!);
      return Object.freeze<NativeNoteArchiveInventory>({
        notes: Object.freeze(rows), limit: archived.limit,
        storedBytes: archived.storedBytes, bundleLimitBytes: archived.bundleLimitBytes,
        async revealNote(note, guard, authentication) {
          const id = selections.get(note);
          if (!id) throw new Error('privacy_note_missing');
          const owner = ownedSession(parentSession, guard); owner.assertCurrent();
          const secret = await reveal(id, owner.assertCurrent, authentication);
          owner.assertCurrent(); return secret;
        },
        async restoreNote(note, guard, authentication) {
          const id = selections.get(note);
          if (!id) throw new Error('privacy_note_missing');
          const owner = ownedSession(parentSession, guard); owner.assertCurrent();
          const result = await restore(id, owner.assertCurrent, authentication);
          owner.assertCurrent(); return result;
        },
        async clearArchive(guard, authentication) {
          const owner = ownedSession(parentSession, guard); owner.assertCurrent();
          const result = await clearArchive(owner.assertCurrent, authentication);
          owner.assertCurrent(); return result;
        },
      });
    },
    bindMaintenance(session: IPrivateVaultSession, proofs: NativeNoteMaintenanceProofs): NativeNoteMaintenanceRuntime {
      session.assertCurrent();
      if (typeof proofs?.prepareCompletionProof !== 'function' || typeof proofs?.prepareWithdrawalRecovery !== 'function')
        throw new Error('privacy_vault_unavailable');
      const operational = createVault(async () => ({ phase: 'waiting' }), Object.freeze({
        prepareCompletionProof: proofs.prepareCompletionProof.bind(proofs),
        prepareWithdrawalRecovery: proofs.prepareWithdrawalRecovery.bind(proofs),
      }));
      let closed = false;
      const drain = new NativeOperationDrain();
      const run = async <T>(assertCurrent: () => void, operation: (owner: IPrivateVaultSession) => Promise<T>, preserveCancellation = false) => {
        const owner = ownedSession(session, () => {
          if (closed) throw Error('privacy_vault_session_changed');
          return assertCurrent();
        });
        owner.assertCurrent(); const finish = drain.begin();
        try {
          const result = await ports.run(() => operation(owner), preserveCancellation);
          owner.assertCurrent(); return result;
        } finally { finish(); }
      };
      const runWithReload = <T>(guard: () => void,
        onReload: (inventory: Awaited<ReturnType<IPrivateVaultController['getNotes']>>) => void,
        operation: (owner: IPrivateVaultSession) => Promise<T>) => {
        if (typeof onReload !== 'function') throw Error('privacy_vault_unavailable');
        const deadline = monotonicNow() + 60_000;
        return run(guard, async actionOwner => {
          const owner = ownedSession(actionOwner, () => { if (monotonicNow() >= deadline) throw Error('privacy_vault_session_changed'); });
          // Authorize before mutations; a refused prompt must not be retried by the final reload.
          owner.assertCurrent(); await withSession(owner, operational.getNotes); owner.assertCurrent();
          let failed = false;
          try { owner.assertCurrent(); return await operation(owner); }
          catch (error) { failed = true; throw error; }
          finally {
            // Reload after success or an ambiguous acknowledgement, inside this authorization only.
            try {
              owner.assertCurrent();
              const inventory = await withSession(owner, operational.getNotes);
              owner.assertCurrent(); onReload(inventory); owner.assertCurrent();
            } catch (error) { if (!failed) throw error; }
          }
        }, true);
      };
      return Object.freeze({
        dispose: () => drain.close(() => { closed = true; }, []),
        getNotes: (guard) => run(guard, owner => withSession(owner, operational.getNotes)),
        clearCompletedNotes: (ids, guard, onProgress, onReload) => {
          if (!Array.isArray(ids) || ids.length !== 1 ||
              typeof ids[0] !== 'string' || !UUID.test(ids[0]) ||
              typeof onProgress !== 'function' || typeof onReload !== 'function') throw Error('privacy_vault_unavailable');
          const id = ids[0];
          return runWithReload(guard, onReload, async owner => {
            owner.assertCurrent();
            // One explicitly selected note cannot be starved by earlier unresolved proofs.
            const value = await withSession(owner, () => operational.clearCompletedNotes([id]));
            owner.assertCurrent();
            const resultIds = [...value.removed, ...value.unresolved];
            if (resultIds.length !== 1 || resultIds[0] !== id) throw Error('privacy_vault_unavailable');
            onProgress(Object.freeze({ checked: 1, total: 1 }));
            owner.assertCurrent();
            return value;
          });
        },
        recoverFailedWithdrawal: (id, guard, onReload) => runWithReload(guard, onReload,
          owner => withSession(owner, () => operational.recoverFailedWithdrawal(id, HOST_WALLET_AUTHENTICATION))),
      });
    },
    bindCapacity(session: IPrivateVaultSession): NativeNoteCapacityRuntime {
      const run = async (action: () => Promise<IPrivateVaultCapacity>) => {
        session.assertCurrent();
        const result = await ports.run(() => withSession(session, action));
        session.assertCurrent();
        return Object.freeze(result);
      };
      return Object.freeze<NativeNoteCapacityRuntime>({
        getCapacity: () => run(vault.getCapacity),
        setCapacity: (capacity) => run(() => vault.setCapacity(capacity)),
      });
    },
    bind(session: IPrivateVaultSession): NativeNoteBackupRuntime {
      let ownedId: string | undefined;
      const assertLive = (id?: string) => {
        try { session.assertCurrent(); }
        catch {
          if (id !== undefined) service.cancel(id);
          throw new NoteBackupServiceError('BACKUP_CANCELLED');
        }
      };
      const runOwned = async <T>(id: string, operation: () => Promise<T>, discard?: (result: T) => void): Promise<T> => {
        if (ownedId === undefined || id !== ownedId) throw new NoteBackupServiceError('BACKUP_STALE');
        assertLive(id);
        const result = await ports.run(operation);
        try { assertLive(id); }
        catch (error) { discard?.(result); throw error; }
        return result;
      };
      return Object.freeze<NativeNoteBackupRuntime>({
        begin() {
          ports.assertAvailable();
          assertLive();
          ownedId = withSession(session, service.begin);
          return ownedId;
        },
        cancel(id) { if (ownedId !== undefined && id === ownedId) service.cancel(id); },
        prepareImport: (id, bytes, password) => runOwned(id, () => service.prepareImport(id, bytes, password)),
        commitImport: (id) => runOwned(id, () => service.commitImport(id, HOST_WALLET_AUTHENTICATION)),
        readCommitReceipt: (id) => runOwned(id, () => withSession(session, () => service.readCommitReceipt(id))),
        exportEncrypted: (id, backupPassword) => runOwned(id,
          () => service.exportEncrypted(id, HOST_WALLET_AUTHENTICATION, backupPassword), (result) => result.bytes.fill(0)),
        verifyExport: (id, bytes, password) => runOwned(id, () => service.verifyExport(id, bytes, password)),
      });
    },
  };
}
