import { SqliteWalletStorage } from './sqlite.ts';
import { WalletStorageError } from './types.ts';
import { observeStorageOpen } from './openStages.ts';
import type { StorageOpenObserver } from './openStages.ts';
import type {
  OpenWalletStorage,
  SqlConnection,
  StorageDigest,
} from './types.ts';

export const WALLET_DATABASE_NAME = 'wallet.sqlite';
export const WALLET_KEY_NAME = 'database-key-v1';
export const WALLET_KEY_SERVICE = 'org.syscoin.pali.native-wallet.v1';

export type StorageLease = Readonly<{
  token: string;
  directory: string;
  databaseExists: boolean;
}>;
export interface StoragePolicy {
  acquire(): Promise<StorageLease>;
  inspect(token: string): Promise<{ databaseExists: boolean }>;
  createDatabase(token: string): Promise<void>;
  protect(token: string): Promise<void>;
  release(token: string): Promise<void>;
}
export interface NativeStoragePorts {
  policy: StoragePolicy;
  keyStore: {
    get(): Promise<string | null>;
    set(value: string): Promise<void>;
  };
  /** Must qualify SQLCipher and file policy before returning; no plain fallback. */
  openDatabase(
    directory: string,
    keyHex: string,
    token: string
  ): Promise<SqlConnection>;
  randomBytes(length: number): Uint8Array;
  digest: StorageDigest;
  /** Wall time is retained only in the existing metadata format. */
  now?: () => number;
  /** Trusted elapsed clock, independent of user-adjustable wall time. */
  monotonicMilliseconds?: () => number;
  /** Optional value-free qualification checkpoints; never a storage policy. */
  observeOpen?: StorageOpenObserver;
}
type KeyRecord = {
  version: 1;
  status: 'provisioning' | 'ready';
  installationId: string;
  key: string;
};
const corrupt = () => new WalletStorageError('STORAGE_CORRUPT');
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function decodeKey(raw: string): KeyRecord {
  if (raw.length > 256) throw corrupt();
  let value: KeyRecord;
  try {
    value = JSON.parse(raw) as KeyRecord;
  } catch {
    throw corrupt();
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'installationId,key,status,version' ||
    value.version !== 1 ||
    !['provisioning', 'ready'].includes(value.status) ||
    typeof value.installationId !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.installationId) ||
    typeof value.key !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.key)
  )
    throw corrupt();
  return value;
}

/** Crash-resumable provisioning. No failure path deletes a key or database. */
export async function openWalletStorage(
  ports: NativeStoragePorts
): Promise<OpenWalletStorage> {
  let lease: StorageLease;
  try {
    observeStorageOpen(ports.observeOpen, 'policy-acquire');
    lease = await ports.policy.acquire();
  } catch {
    throw new WalletStorageError('STORAGE_UNAVAILABLE');
  }
  let connection: SqlConnection | undefined;
  let storage: SqliteWalletStorage | undefined;
  try {
    observeStorageOpen(ports.observeOpen, 'key-read');
    let raw = await ports.keyStore.get();
    let record: KeyRecord;
    if (raw === null) {
      if (lease.databaseExists)
        throw new WalletStorageError('STORAGE_KEY_MISSING');
      observeStorageOpen(ports.observeOpen, 'key-generate');
      const key = ports.randomBytes(32);
      const installation = ports.randomBytes(16);
      try {
        if (
          !(key instanceof Uint8Array) ||
          key.length !== 32 ||
          !(installation instanceof Uint8Array) ||
          installation.length !== 16
        )
          throw corrupt();
        record = {
          version: 1,
          status: 'provisioning',
          installationId: hex(installation),
          key: hex(key),
        };
      } finally {
        if (key instanceof Uint8Array) key.fill(0);
        if (installation instanceof Uint8Array) installation.fill(0);
      }
      raw = JSON.stringify(record);
      observeStorageOpen(ports.observeOpen, 'key-write-provisioning');
      await ports.keyStore.set(raw);
      observeStorageOpen(ports.observeOpen, 'key-readback-provisioning');
      if ((await ports.keyStore.get()) !== raw) throw corrupt();
    } else record = decodeKey(raw);
    observeStorageOpen(ports.observeOpen, 'policy-inspect');
    const current = await ports.policy.inspect(lease.token);
    if (record.status === 'ready' && !current.databaseExists)
      throw new WalletStorageError('STORAGE_ORPHAN_KEY');
    if (!current.databaseExists) {
      observeStorageOpen(ports.observeOpen, 'policy-create-database');
      await ports.policy.createDatabase(lease.token);
    }
    observeStorageOpen(ports.observeOpen, 'database-open');
    connection = await ports.openDatabase(
      lease.directory,
      record.key,
      lease.token
    );
    observeStorageOpen(ports.observeOpen, 'schema-open');
    storage = await SqliteWalletStorage.open(
      connection,
      ports.digest,
      record.installationId,
      record.status === 'provisioning',
      ports.now,
      ports.monotonicMilliseconds
    );
    if (record.status === 'provisioning') {
      // An uncommitted bootstrap has never been exposed to an SDK authority.
      // Finding wallet records here is ambiguous and must not be auto-repaired.
      observeStorageOpen(ports.observeOpen, 'provisioning-state');
      if ((await storage.readState()).presence !== 'empty') throw corrupt();
      const ready = JSON.stringify({ ...record, status: 'ready' });
      observeStorageOpen(ports.observeOpen, 'key-write-ready');
      await ports.keyStore.set(ready);
      observeStorageOpen(ports.observeOpen, 'key-readback-ready');
      if ((await ports.keyStore.get()) !== ready) throw corrupt();
    }
    observeStorageOpen(ports.observeOpen, 'policy-protect-final');
    await ports.policy.protect(lease.token);
    observeStorageOpen(ports.observeOpen, 'ready');
    const owned = storage;
    let closing: Promise<void> | null = null;
    return Object.freeze({
      keyringStorage: owned.keyringStorage,
      notes: owned.notes,
      signedRecords: owned.signedRecords,
      authGuard: owned.authGuard,
      recovery: owned.recovery,
      readState: () => owned.readState(),
      getWalletFingerprint: () => owned.getWalletFingerprint(),
      confirmBackup: (fingerprint: string) => owned.confirmBackup(fingerprint),
      close: () => {
        if (!closing)
          closing = (async () => {
            await owned.close();
            await ports.policy.protect(lease.token);
            await ports.policy.release(lease.token);
          })();
        return closing;
      },
    });
  } catch (error) {
    // A failed close keeps the process lease quarantined until process restart.
    let closed =
      !connection &&
      !(
        error instanceof WalletStorageError &&
        error.code === 'STORAGE_REOPEN_REQUIRED'
      );
    try {
      if (storage) {
        await storage.close();
        closed = true;
      } else if (connection) {
        await connection.closeAsync();
        closed = true;
      }
    } catch {
      closed = false;
    }
    if (closed) await ports.policy.release(lease.token).catch(() => undefined);
    throw error instanceof WalletStorageError
      ? error
      : new WalletStorageError('STORAGE_UNAVAILABLE');
  }
}
