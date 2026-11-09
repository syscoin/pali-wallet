import type { SentryNodeStorage } from './sentryNodeDomain.ts';
import type { DeviceUnlockEnrollmentPort } from '../../../../source/wallet/deviceUnlockEnrollment.ts';
import type { EvmSignedRecordStorage } from '../../../../source/wallet/evmSignedRecords.ts';
import type { UtxoRecordStorage } from '../../../../source/wallet/utxoSignedRecords.ts';
import type { ISentryKeyVaultHost } from '../../../../source/wallet/sentryKeyVault.ts';
import type { SentryNetwork } from '../../../../source/shared/sentryNetworks.ts';

/** Internal storage ports. Never expose these handles or stored values to UI. */
export type StorageErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_CORRUPT'
  | 'STORAGE_REOPEN_REQUIRED'
  | 'STORAGE_CLOSED'
  | 'STORAGE_CHANGED'
  | 'AUTH_THROTTLED'
  | 'STORAGE_KEY_MISSING'
  | 'STORAGE_ORPHAN_KEY';

export class WalletStorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode) {
    super(code);
    this.name = 'WalletStorageError';
    this.code = code;
  }
}

export interface SqlConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    parameters?: readonly (string | number | null)[]
  ): Promise<unknown>;
  getFirstAsync<T>(
    sql: string,
    parameters?: readonly (string | number | null)[]
  ): Promise<T | null>;
  getAllAsync<T>(
    sql: string,
    parameters?: readonly (string | number | null)[]
  ): Promise<T[]>;
  closeAsync(): Promise<void>;
}

/** Internal encrypted pair snapshot for the SDK device-unlock seam. */
export type DeviceUnlockVaultPair = Readonly<{
  vault: string;
  keys: Readonly<{ salt: string }>;
  pairFingerprint: string;
}>;

export interface KeyringStoragePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  deleteItem(key: string): Promise<void>;
  createManyIfAbsent(items: Record<string, unknown>, assertCurrent?: () => void): Promise<boolean>;
  /** Read one bounded snapshot of the current encrypted vault and salt. */
  readDeviceUnlockVaultPair?(): Promise<DeviceUnlockVaultPair | null>;
  /** Atomically replace an exact snapshot. Optional cleanup keys must equal their
   * snapshots (undefined requires absence); matching present rows are deleted.
   * A supplied synchronous owner guard must still pass immediately before COMMIT. */
  compareAndSet(key: string, expected: unknown, value: unknown,
    removeIfEqual?: Readonly<Record<string, unknown>>, assertCurrent?: () => void): Promise<boolean>;
  /** Compare every captured row and commit all replacements in one guarded transaction.
   * Undefined expected/value represents an absent/deleted row. */
  compareAndSetMany(
    changes: readonly Readonly<{ key: string; expected: unknown; value: unknown }>[],
    assertCurrent: () => void
  ): Promise<boolean>;
}

export type WalletStoredState = Readonly<
  | { presence: 'empty'; backup: 'unconfirmed' }
  | { presence: 'existing'; backup: 'unconfirmed' | 'confirmed' }
>;

/** Read metadata only. The root/profile must still be authenticated by the SDK. */
export type WalletIdentityRead = Readonly<{
  walletBindingId: string;
  pairFingerprint: string;
  root: Readonly<{ address: string; publicKey: string; profileId: string }> | null;
  verification: 'requires-unlock';
}>;
/** Opaque encrypted note row. Never expose the stored value to UI. */
export type NoteDomainRow = Readonly<{ profileId: string; walletBindingId: string; value: string }>;
/** Opaque common-codec bundle bytes; no transaction policy lives in this row. */
export type SignedRecordDomainRow = Readonly<{ profileId: string; walletBindingId: string; value: string }>;
/** Private, byte-preserving wallet snapshot. The device enrollment value is opaque SQL hex. */
export type RecoveryStorageSnapshot = Readonly<{
  identity: WalletIdentityRead | null;
  state: WalletStoredState;
  records: readonly Readonly<{ key: string; value: string }>[];
  metadata: readonly Readonly<{ key: string; value: string }>[];
  notes: readonly NoteDomainRow[];
  signedRecords: readonly SignedRecordDomainRow[];
}>;
/** Opaque, storage-owned one-use replacement; never a UI value. */
declare const recoveryWriteBrand: unique symbol;
export type RecoveryWritePlan = Readonly<{ [recoveryWriteBrand]: true }>;
export type RecoveryRoot = NonNullable<WalletIdentityRead['root']>;

/** Logical removal of wallet-scoped SQLite rows only. */
export type WalletRemovalResult = Readonly<{
  status: 'wallet-records-removed' | 'reopen-required';
}>;

/** Construct only from the authenticated profile and selected Syscoin owner. */
export type SentryStorageScope = Readonly<{
  network: SentryNetwork;
  pairFingerprint: string;
  profileId: string;
  vaultId: string;
  walletBindingId: string;
}>;

export interface OpenWalletStorage {
  readonly keyringStorage: KeyringStoragePort;
  readonly signedRecords: EvmSignedRecordStorage;
  readonly utxoSignedRecords?: UtxoRecordStorage;
  readonly sentryNodes?: Readonly<{ bind(scope: SentryStorageScope, assertCurrent: () => void): SentryNodeStorage }>;
  readonly sentryKeys?: Readonly<{
    bind(
      scope: SentryStorageScope,
      assertCurrent: () => void
    ): Pick<ISentryKeyVaultHost, 'read' | 'write'>;
  }>;
  readonly deviceUnlockEnrollment?: DeviceUnlockEnrollmentPort;
  /** Private note domain, sharing this owner’s SQL queue and lease. */
  readonly notes?: Readonly<{
    read(): Promise<readonly NoteDomainRow[]>;
    /** Caller binds the SDK-authenticated profile and current wallet identity. */
    compareAndSet(
      profileId: string,
      walletBindingId: string,
      expected: string | undefined,
      next: string,
      assertCurrent: () => void
    ): Promise<boolean>;
  }>;
  readonly authGuard: Readonly<{
    checkAllowed(): Promise<void>;
    recordFailure(): Promise<void>;
    recordSuccess(): Promise<void>;
  }>;
  readonly removal?: Readonly<{
    /** Trusted host only, after fresh authentication and explicit confirmation.
     * The one-use snapshot must come from this owner after authentication.
     * The synchronous guard binds the exact retired custody generation. */
    commit(snapshot: RecoveryStorageSnapshot, assertCurrent: () => void): Promise<WalletRemovalResult>;
  }>;
  /** Private recovery host ports. Optional capabilities make older synthetic hosts fail closed. */
  readonly recovery?: Readonly<{
    /** Exact existing pair fingerprint without writing staged creation data. */
    fingerprintPair?(
      candidate: Readonly<{ vault: unknown; keys: unknown }>
    ): Promise<string>;
    /** Initial installation of pair, full records and root as one transaction. */
    prepareCreation?(
      snapshot: RecoveryStorageSnapshot,
      candidate: Readonly<{
        vault: unknown;
        keys: unknown;
        accountRecords: unknown;
      }>,
      root: RecoveryRoot
    ): Promise<RecoveryWritePlan>;
    readIdentity(): Promise<WalletIdentityRead | null>;
    readSnapshot(): Promise<RecoveryStorageSnapshot>;
    /** Called only after the SDK authenticates the root/profile for this exact pair. */
    bindIdentity(expectedPairFingerprint: string, root: RecoveryRoot, assertCurrent: () => void): Promise<void>;
    prepareReplacement?(snapshot: RecoveryStorageSnapshot, pair: Readonly<{ vault: unknown; keys: unknown;
        accountRecords?: unknown;
      }>, root: RecoveryRoot): Promise<RecoveryWritePlan>;
    plannedSnapshot?(plan: RecoveryWritePlan): RecoveryStorageSnapshot;
    commitReplacement?(plan: unknown, assertCurrent: () => void): Promise<void>;
    /** Known credential failure still counts after UI cancellation, but never for another pair. */
    recordFailureForPair?(pairFingerprint: string): Promise<void>;
  }>;
  readState(): Promise<WalletStoredState>;
  /** Digest of the current encrypted pair, not the stable data binding. */
  getWalletFingerprint(): Promise<string>;
  /** Caller must first verify a fresh, epoch-bound recovery-phrase challenge. */
  confirmBackup(expectedFingerprint: string): Promise<void>;
  close(): Promise<void>;
}

/** Qualified native SHA-256; output must be a detached 32-byte value. */
export type StorageDigest = (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;
