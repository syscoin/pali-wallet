import { WalletStorageError } from './types.ts';
interface SqlCipherConnection {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

/** Qualification runs on the same private connection used by every operation. */
export async function requireSqlCipher(
  db: SqlCipherConnection,
  keyHex: string
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(keyHex))
    throw new WalletStorageError('STORAGE_CORRUPT');
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
  await db.execAsync(`PRAGMA key = "x'${keyHex}'"`);
  await db.execAsync('PRAGMA busy_timeout = 2000');
  await db.execAsync('PRAGMA cipher_memory_security = ON');
  await db.execAsync('PRAGMA journal_mode = WAL');
  await db.execAsync('PRAGMA synchronous = FULL');
  await db.execAsync('PRAGMA temp_store = MEMORY');
  const journal = await db.getFirstAsync<{ journal_mode: string }>(
    'PRAGMA journal_mode'
  );
  const sync = await db.getFirstAsync<{ synchronous: number }>(
    'PRAGMA synchronous'
  );
  const memory = await db.getFirstAsync<{ temp_store: number }>(
    'PRAGMA temp_store'
  );
  // The pinned SQLCipher C implementation returns this pragma as text.
  const cipherMemory = await db.getFirstAsync<{
    cipher_memory_security: string;
  }>('PRAGMA cipher_memory_security');
  if (
    journal?.journal_mode !== 'wal' ||
    sync?.synchronous !== 2 ||
    memory?.temp_store !== 2 ||
    cipherMemory?.cipher_memory_security !== '1'
  )
    throw new WalletStorageError('STORAGE_UNAVAILABLE');
}
