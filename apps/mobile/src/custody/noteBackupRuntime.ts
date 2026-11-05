import { identifyClassicNote } from '../../../../source/utils/privacy/note.ts';
import type { IPrivateVaultCapacity, IPrivateVaultController } from '../../../../source/utils/privacy/privateVaultTypes.ts';
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
  const vault = createPrivateVaultController({
    captureSession,
    authenticate: ports.authenticate,
    readNote: async () => { throw new Error('privacy_vault_unavailable'); },
  }, {
    identify: identifyClassicNote,
    generate: () => { throw new Error('privacy_vault_unavailable'); },
    mutex: new AsyncMutex(),
    now: Date.now,
    deadlineNow: monotonicNow,
    randomId,
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
    invalidate: () => invalidate?.(),
    dispose: () => service.dispose(),
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
