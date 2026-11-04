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

export interface KeyringStoragePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  deleteItem(key: string): Promise<void>;
  createManyIfAbsent(items: Record<string, unknown>): Promise<boolean>;
  /** Atomically replace an exact snapshot. Optional cleanup keys must equal their
   * snapshots (undefined requires absence); matching present rows are deleted. */
  compareAndSet(key: string, expected: unknown, value: unknown,
    removeIfEqual?: Readonly<Record<string, unknown>>): Promise<boolean>;
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
/** Private, byte-preserving host snapshot; never a screen or public account DTO. */
export type RecoveryStorageSnapshot = Readonly<{
  identity: WalletIdentityRead | null;
  state: WalletStoredState;
  records: readonly Readonly<{ key: string; value: string }>[];
  metadata: readonly Readonly<{ key: string; value: string }>[];
}>;

export interface OpenWalletStorage {
  readonly keyringStorage: KeyringStoragePort;
  readonly authGuard: Readonly<{
    checkAllowed(): Promise<void>;
    recordFailure(): Promise<void>;
    recordSuccess(): Promise<void>;
  }>;
  /** Optional on synthetic hosts. Native storage provides read-only inventory ports. */
  readonly recovery?: Readonly<{
    readIdentity(): Promise<WalletIdentityRead | null>;
    readSnapshot(): Promise<RecoveryStorageSnapshot>;
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
