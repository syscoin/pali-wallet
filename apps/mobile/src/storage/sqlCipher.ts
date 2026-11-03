import { WalletStorageError } from './types.ts';
import { observeStorageOpen } from './openStages.ts';
import type { StorageOpenObserver } from './openStages.ts';
interface SqlCipherConnection {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

/** Qualification runs on the same private connection used by every operation. */
export async function requireSqlCipher(
  db: SqlCipherConnection,
  keyHex: string,
  observeOpen?: StorageOpenObserver
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(keyHex))
    throw new WalletStorageError('STORAGE_CORRUPT');
  observeStorageOpen(observeOpen, 'sqlcipher-version');
  const cipher = await db.getFirstAsync<{ cipher_version: string }>(
    'PRAGMA cipher_version'
  );
  if (
    !cipher ||
    typeof cipher.cipher_version !== 'string' ||
    !cipher.cipher_version.trim()
  )
    throw new WalletStorageError('STORAGE_UNAVAILABLE');
  // Validated fixed-size hex only. Never log this statement or the database key.
  observeStorageOpen(observeOpen, 'sqlcipher-key');
  await db.execAsync(`PRAGMA key = "x'${keyHex}'"`);
  observeStorageOpen(observeOpen, 'sqlcipher-busy-timeout');
  await db.execAsync('PRAGMA busy_timeout = 2000');
  observeStorageOpen(observeOpen, 'sqlcipher-memory-security');
  await db.execAsync('PRAGMA cipher_memory_security = ON');
  observeStorageOpen(observeOpen, 'sqlcipher-wal');
  await db.execAsync('PRAGMA journal_mode = WAL');
  observeStorageOpen(observeOpen, 'sqlcipher-synchronous-full');
  await db.execAsync('PRAGMA synchronous = FULL');
  observeStorageOpen(observeOpen, 'sqlcipher-temp-memory');
  await db.execAsync('PRAGMA temp_store = MEMORY');
  observeStorageOpen(observeOpen, 'sqlcipher-journal-readback');
  const journal = await db.getFirstAsync<{ journal_mode: string }>(
    'PRAGMA journal_mode'
  );
  observeStorageOpen(observeOpen, 'sqlcipher-synchronous-readback');
  const sync = await db.getFirstAsync<{ synchronous: number }>(
    'PRAGMA synchronous'
  );
  observeStorageOpen(observeOpen, 'sqlcipher-temp-readback');
  const memory = await db.getFirstAsync<{ temp_store: number }>(
    'PRAGMA temp_store'
  );
  // The pinned SQLCipher C implementation returns this pragma as text.
  observeStorageOpen(observeOpen, 'sqlcipher-memory-readback');
  const cipherMemory = await db.getFirstAsync<{
    cipher_memory_security: string;
  }>('PRAGMA cipher_memory_security');
  // Preserve the query order, then identify the exact failed invariant.
  observeStorageOpen(observeOpen, 'sqlcipher-journal-readback');
  if (journal?.journal_mode !== 'wal')
    throw new WalletStorageError('STORAGE_UNAVAILABLE');
  observeStorageOpen(observeOpen, 'sqlcipher-synchronous-readback');
  if (sync?.synchronous !== 2)
    throw new WalletStorageError('STORAGE_UNAVAILABLE');
  observeStorageOpen(observeOpen, 'sqlcipher-temp-readback');
  if (memory?.temp_store !== 2)
    throw new WalletStorageError('STORAGE_UNAVAILABLE');
  observeStorageOpen(observeOpen, 'sqlcipher-memory-readback');
  if (cipherMemory?.cipher_memory_security !== '1')
    throw new WalletStorageError('STORAGE_UNAVAILABLE');
}
