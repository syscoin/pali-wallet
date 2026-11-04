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
}

export type WalletStoredState = Readonly<
  | { presence: 'empty'; backup: 'unconfirmed' }
  | { presence: 'existing'; backup: 'unconfirmed' | 'confirmed' }
>;

export interface OpenWalletStorage {
  readonly keyringStorage: KeyringStoragePort;
  readonly authGuard: Readonly<{
    checkAllowed(): Promise<void>;
    recordFailure(): Promise<void>;
    recordSuccess(): Promise<void>;
  }>;
  readState(): Promise<WalletStoredState>;
  getWalletFingerprint(): Promise<string>;
  /** Caller must first verify a fresh, epoch-bound recovery-phrase challenge. */
  confirmBackup(expectedFingerprint: string): Promise<void>;
  close(): Promise<void>;
}

/** Qualified native SHA-256; output must be a detached 32-byte value. */
export type StorageDigest = (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;
