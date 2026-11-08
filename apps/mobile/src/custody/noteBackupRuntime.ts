import type { IPrivacyDepositAttempt } from '../../../../source/utils/privacy/transactionTypes.ts';
import { identifyClassicNote } from '../../../../source/utils/privacy/note.ts';
import type { IPrivacyNoteReader, IPrivateVaultCapacity, IPrivateVaultController } from '../../../../source/utils/privacy/privateVaultTypes.ts';
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
import { WalletStorageError, type OpenWalletStorage } from '../storage/types.ts';

/** Internal file authority. Exported bytes go only to the trusted file adapter. */
export type NativeNoteBackupRuntime = Readonly<Omit<INoteBackupService, 'dispose'>>;
export type NativeNoteCapacityRuntime = Readonly<Pick<IPrivateVaultController, 'getCapacity' | 'setCapacity'>>;
export type NativeSavedNote = Readonly<{
  amount: string;
  createdAt: number;
  reconciliation?: 'restored-note' | 'withdrawal-history';
}>;
export type NativeNoteInventory = Readonly<{
  notes: readonly NativeSavedNote[];
  revealNote(note: NativeSavedNote, password: string, assertCurrent: () => void): Promise<string>;
}>;

type NativeNoteBackupPorts = Readonly<{
  assertAvailable(): void;
  authenticate: IPrivateVaultHost['authenticate'];
  binding(): Promise<Readonly<{ profileId: string; walletBindingId: string }>>;
  notes: NonNullable<OpenWalletStorage['notes']>;
  requireReopen(): void;
  run<T>(operation: () => Promise<T>): Promise<T>;
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
  const createVault = (readNote: IPrivacyNoteReader) => createPrivateVaultController({
    captureSession,
    authenticate: ports.authenticate,
    readNote,
  }, {
    identify: identifyClassicNote,
    generate: () => { throw new Error('privacy_vault_unavailable'); },
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
  const vault = createVault(async () => ({ phase: 'waiting' }));
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
    authorizeDepositReplay(session: IPrivateVaultSession, attempt: IPrivacyDepositAttempt) {
      return vault.authorizeDepositReplay(attempt, session);
    },
    invalidate() { resumeInventory?.(); invalidate?.(); },
    dispose() { resumeInventory?.(); service.dispose(); },
    importNote(session: IPrivateVaultSession, note: string, readNote: IPrivacyNoteReader, assertCurrent: () => void) {
      const selected = ownedSession(session, assertCurrent);
      selected.assertCurrent();
      const importer = createVault(readNote);
      return ports.run(() => withSession(selected, () => importer.importNote(note)));
    },
    async readInventory(session: IPrivateVaultSession): Promise<NativeNoteInventory> {
      session.assertCurrent();
      const { notes } = await withSession(session, vault.getNotes);
      session.assertCurrent();
      const selections = new WeakMap<NativeSavedNote, string>();
      const rows = notes.map((note) => {
        const row = Object.freeze<NativeSavedNote>({
          amount: note.amount,
          createdAt: note.createdAt,
          ...(note.withdrawal || note.restoration === 'withdrawal-pending'
            ? { reconciliation: 'withdrawal-history' }
            : note.restoration === 'review-required'
              ? { reconciliation: 'restored-note' }
              : {}),
        });
        selections.set(row, note.id);
        return row;
      }).sort((left, right) => right.createdAt - left.createdAt);
      return Object.freeze<NativeNoteInventory>({
        notes: Object.freeze(rows),
        async revealNote(note, password, assertCurrent) {
          const id = selections.get(note);
          if (!id || typeof assertCurrent !== 'function') throw new Error('privacy_note_missing');
          const selected = ownedSession(session, assertCurrent);
          const secret = await ports.run(() => withSession(selected, () => vault.revealNote(id, password)));
          selected.assertCurrent();
          return secret;
        },
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
        commitImport: (id, password) => runOwned(id, () => service.commitImport(id, password)),
        readCommitReceipt: (id) => runOwned(id, () => withSession(session, () => service.readCommitReceipt(id))),
        exportEncrypted: (id, password, backupPassword) => runOwned(id,
          () => service.exportEncrypted(id, password, backupPassword), (result) => result.bytes.fill(0)),
        verifyExport: (id, bytes, password) => runOwned(id, () => service.verifyExport(id, bytes, password)),
      });
    },
  };
}
