import {
  decodeStorageValue,
  encodeStorageValue,
  STORAGE_LIMITS,
  validateStorageKey,
} from './json.ts';
import { WalletStorageError } from './types.ts';
import type {
  KeyringStoragePort,
  OpenWalletStorage,
  SqlConnection,
  StorageDigest,
  WalletStoredState,
} from './types.ts';

const TABLE = `CREATE TABLE keyring_records (key TEXT PRIMARY KEY NOT NULL CHECK(typeof(key) = 'text' AND length(CAST(key AS BLOB)) BETWEEN 1 AND 256), value TEXT NOT NULL CHECK(typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= 65536))`;
const META = `CREATE TABLE wallet_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK(typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= 1024))`;
const boundedColumns = `CASE WHEN typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= ? THEN value ELSE NULL END AS value, typeof(value) AS storage_type, length(CAST(value AS BLOB)) AS storage_bytes`;
const GET = `SELECT ${boundedColumns} FROM keyring_records WHERE key = ?`;
const PAIR = `SELECT 'record' AS source, key, ${boundedColumns} FROM keyring_records WHERE key IN ('vault', 'vault-keys') UNION ALL SELECT 'meta' AS source, key, ${boundedColumns} FROM wallet_metadata WHERE key IN ('backup', 'auth')`;
const failure = () => new WalletStorageError('STORAGE_CORRUPT');
const safeError = (error: unknown) =>
  error instanceof WalletStorageError
    ? error
    : new WalletStorageError('STORAGE_UNAVAILABLE');
type StoredRow = {
  value: unknown;
  storage_type: unknown;
  storage_bytes: unknown;
};
type PairRow = StoredRow & { source: string; key: string };
type Pair = { vault?: string; keys?: string; backup?: string; auth?: string };
type AuthRecord = {
  version: 1;
  failures: number;
  lastAttempt: number;
  notBefore: number;
};
const exact = (
  value: unknown,
  keys: string[]
): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function admittedRow(
  row: StoredRow,
  limit = STORAGE_LIMITS.valueBytes
): string {
  if (
    row.storage_type !== 'text' ||
    !Number.isSafeInteger(row.storage_bytes) ||
    (row.storage_bytes as number) < 0 ||
    (row.storage_bytes as number) > limit ||
    typeof row.value !== 'string'
  )
    throw failure();
  // Defense in depth for a malformed bridge/provider result.
  if (
    row.value.length > limit ||
    new TextEncoder().encode(row.value).length !== row.storage_bytes
  )
    throw failure();
  return row.value;
}

function validatePair(pair: Pair): 'empty' | 'existing' {
  if (pair.vault === undefined && pair.keys === undefined) {
    if (pair.backup !== undefined || pair.auth !== undefined) throw failure();
    return 'empty';
  }
  if (pair.vault === undefined || pair.keys === undefined) throw failure();
  const vault = decodeStorageValue(pair.vault);
  const keys = decodeStorageValue(pair.keys);
  if (
    typeof vault !== 'string' ||
    !exact(keys, ['salt']) ||
    typeof keys.salt !== 'string' ||
    !/^[0-9a-f]{32}$/.test(keys.salt)
  )
    throw failure();
  let envelope: unknown;
  try {
    envelope = JSON.parse(vault);
  } catch {
    throw failure();
  }
  // First native release creates only the current authenticated SDK envelope.
  // Legacy CBC/migration metadata is not inferred as a fresh native wallet.
  if (
    !exact(envelope, ['v', 'alg', 'iv', 'ct']) ||
    envelope.v !== 4 ||
    envelope.alg !== 'A256GCM' ||
    typeof envelope.iv !== 'string' ||
    !/^[0-9a-fA-F]{24}$/.test(envelope.iv) ||
    typeof envelope.ct !== 'string' ||
    envelope.ct.length < 32 ||
    envelope.ct.length % 2 ||
    !/^[0-9a-fA-F]+$/.test(envelope.ct)
  )
    throw failure();
  return 'existing';
}

/** One private connection and queue; every mutation has an acknowledged commit. */
export class SqliteWalletStorage implements OpenWalletStorage {
  readonly keyringStorage: KeyringStoragePort;
  readonly authGuard: OpenWalletStorage['authGuard'];
  private tail: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private poisoned = false;
  private closed = false;
  private readonly db: SqlConnection;
  private readonly digest: StorageDigest;
  private readonly now: () => number;
  private readonly monotonicMilliseconds: () => number;
  private lastMonotonic: number | null = null;
  private authenticationWindow: { raw: string | undefined; notBefore: number } | null = null;

  private constructor(
    db: SqlConnection,
    digest: StorageDigest,
    now: () => number,
    monotonicMilliseconds: () => number
  ) {
    this.db = db;
    this.digest = digest;
    this.now = now;
    this.monotonicMilliseconds = monotonicMilliseconds;
    this.keyringStorage = Object.freeze({
      get: (key: string) => this.get(key),
      set: (key: string, value: unknown) => this.set(key, value),
      deleteItem: (key: string) => this.deleteItem(key),
      createManyIfAbsent: (items: Record<string, unknown>) =>
        this.createManyIfAbsent(items),
      compareAndSet: (key: string, expected: unknown, value: unknown, removeIfEqual?: Readonly<Record<string, unknown>>) =>
        this.compareAndSet(key, expected, value, removeIfEqual),
    });
    this.authGuard = Object.freeze({
      checkAllowed: () => this.checkAllowed(),
      recordFailure: () => this.recordAuthentication(false),
      recordSuccess: () => this.recordAuthentication(true),
    });
  }

  static async open(
    db: SqlConnection,
    digest: StorageDigest,
    installationId: string,
    initialize: boolean,
    now: () => number = Date.now,
    monotonicMilliseconds: () => number = () => performance.now()
  ): Promise<SqliteWalletStorage> {
    if (!/^[0-9a-f]{32}$/.test(installationId) || typeof digest !== 'function')
      throw failure();
    const storage = new SqliteWalletStorage(db, digest, now, monotonicMilliseconds);
    try {
      const tables = await db.getAllAsync<{ name: string; sql: string }>(
        "SELECT CASE WHEN length(name) <= 64 THEN name ELSE NULL END AS name, CASE WHEN length(CAST(sql AS BLOB)) <= 1024 THEN sql ELSE NULL END AS sql FROM sqlite_master WHERE type IN ('table', 'view', 'trigger', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 3"
      );
      const version = await db.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version'
      );
      if (initialize && tables.length === 0 && version?.user_version === 0) {
        await storage.transaction(async () => {
          await db.execAsync(TABLE);
          await db.execAsync(META);
          await db.runAsync(
            'INSERT INTO wallet_metadata (key, value) VALUES (?, ?)',
            ['installation', installationId]
          );
          await db.execAsync('PRAGMA user_version = 1');
        });
      } else if (
        tables.length !== 2 ||
        version?.user_version !== 1 ||
        tables[0]?.name !== 'keyring_records' ||
        tables[0].sql !== TABLE ||
        tables[1]?.name !== 'wallet_metadata' ||
        tables[1].sql !== META
      )
        throw failure();
      const installation = await db.getFirstAsync<{ value: unknown }>(
        "SELECT CASE WHEN typeof(value) = 'text' AND length(CAST(value AS BLOB)) = 32 THEN value ELSE NULL END AS value FROM wallet_metadata WHERE key = 'installation'"
      );
      if (installation?.value !== installationId) throw failure();
      const metadata = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM wallet_metadata WHERE key NOT IN ('installation', 'backup', 'auth')"
      );
      const count = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM keyring_records'
      );
      if (
        metadata?.count !== 0 ||
        !Number.isSafeInteger(count?.count) ||
        count!.count > STORAGE_LIMITS.records
      )
        throw failure();
      const health = await db.getFirstAsync<{ quick_check: string }>(
        'PRAGMA quick_check(1)'
      );
      if (health?.quick_check !== 'ok') throw failure();
      await storage.readState();
      return storage;
    } catch (error) {
      throw safeError(error);
    }
  }

  private queued<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing || this.closed)
      return Promise.reject(new WalletStorageError('STORAGE_CLOSED'));
    const pending = this.tail.then(async () => {
      if (this.poisoned)
        throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');
      try {
        return await operation();
      } catch (error) {
        throw safeError(error);
      }
    });
    this.tail = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    let commitStarted = false;
    try {
      await this.db.execAsync('BEGIN IMMEDIATE');
      const result = await operation();
      commitStarted = true;
      await this.db.execAsync('COMMIT');
      return result;
    } catch (error) {
      // An acknowledgement can be lost after COMMIT actually succeeded.
      // Never infer failure or undo custody by deleting records.
      if (commitStarted) this.poisoned = true;
      try {
        await this.db.execAsync('ROLLBACK');
      } catch {
        this.poisoned = true;
      }
      throw safeError(error);
    }
  }

  private get(key: string): Promise<unknown> {
    validateStorageKey(key);
    return this.queued(async () => {
      const row = await this.db.getFirstAsync<StoredRow>(GET, [
        STORAGE_LIMITS.valueBytes,
        key,
      ]);
      return row === null ? undefined : decodeStorageValue(admittedRow(row));
    });
  }

  private set(key: string, value: unknown): Promise<void> {
    validateStorageKey(key);
    const raw = encodeStorageValue(value);
    return this.queued(() =>
      this.transaction(async () => {
        const exists = await this.db.getFirstAsync<{ present: number }>(
          'SELECT 1 AS present FROM keyring_records WHERE key = ?',
          [key]
        );
        const count = await this.db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM keyring_records'
        );
        if (
          !exists &&
          (!Number.isSafeInteger(count?.count) ||
            count!.count >= STORAGE_LIMITS.records)
        )
          throw failure();
        await this.db.runAsync(
          'INSERT INTO keyring_records (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [key, raw]
        );
      })
    );
  }

  private deleteItem(key: string): Promise<void> {
    validateStorageKey(key);
    return this.queued(() =>
      this.transaction(async () => {
        await this.db.runAsync('DELETE FROM keyring_records WHERE key = ?', [
          key,
        ]);
      })
    );
  }

  private createManyIfAbsent(items: Record<string, unknown>): Promise<boolean> {
    if (
      !items ||
      typeof items !== 'object' ||
      Array.isArray(items) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(items))
    )
      throw failure();
    const keys = Reflect.ownKeys(items);
    if (keys.length > STORAGE_LIMITS.batchKeys) throw failure();
    const entries = keys.map((key) => {
      validateStorageKey(key);
      const descriptor = Object.getOwnPropertyDescriptor(items, key);
      if (
        !descriptor ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        !descriptor.enumerable
      )
        throw failure();
      return [key, encodeStorageValue(descriptor.value)] as const;
    });
    return this.queued(() =>
      this.transaction(async () => {
        for (const [key] of entries) {
          if (
            await this.db.getFirstAsync(
              'SELECT 1 AS present FROM keyring_records WHERE key = ?',
              [key]
            )
          )
            return false;
        }
        const count = await this.db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM keyring_records'
        );
        if (
          !Number.isSafeInteger(count?.count) ||
          count!.count + entries.length > STORAGE_LIMITS.records
        )
          throw failure();
        for (const entry of entries)
          await this.db.runAsync(
            'INSERT INTO keyring_records (key, value) VALUES (?, ?)',
            entry
          );
        return true;
      })
    );
  }

  private compareAndSet(key: string, expected: unknown, value: unknown,
    removeIfEqual: Readonly<Record<string, unknown>> = {}): Promise<boolean> {
    validateStorageKey(key);
    const before = encodeStorageValue(expected);
    const after = encodeStorageValue(value);
    if (!removeIfEqual || typeof removeIfEqual !== 'object' || Array.isArray(removeIfEqual) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(removeIfEqual))) throw failure();
    const names = Reflect.ownKeys(removeIfEqual);
    if (names.length > STORAGE_LIMITS.batchKeys) throw failure();
    const removals = names.map((name) => {
      if (typeof name !== 'string' || name === key) throw failure();
      validateStorageKey(name);
      const descriptor = Object.getOwnPropertyDescriptor(removeIfEqual, name);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw failure();
      return [name, descriptor.value === undefined ? undefined : encodeStorageValue(descriptor.value)] as const;
    });
    return this.queued(() => this.transaction(async () => {
      const row = await this.db.getFirstAsync<StoredRow>(GET, [STORAGE_LIMITS.valueBytes, key]);
      if (row === null || admittedRow(row) !== before) return false;
      for (const [name, snapshot] of removals) {
        const candidate = await this.db.getFirstAsync<StoredRow>(GET, [STORAGE_LIMITS.valueBytes, name]);
        if (snapshot === undefined ? candidate !== null : candidate === null || admittedRow(candidate) !== snapshot) return false;
      }
      await this.db.runAsync('UPDATE keyring_records SET value = ? WHERE key = ?', [after, key]);
      for (const [name, snapshot] of removals) {
        if (snapshot !== undefined) await this.db.runAsync('DELETE FROM keyring_records WHERE key = ?', [name]);
      }
      return true;
    }));
  }

  private async pair(): Promise<Pair> {
    const rows = await this.db.getAllAsync<PairRow>(PAIR, [
      STORAGE_LIMITS.valueBytes,
      1024,
    ]);
    if (rows.length > 4) throw failure();
    const result: Pair = {};
    for (const row of rows) {
      const raw = admittedRow(
        row,
        row.source === 'meta' ? 1024 : STORAGE_LIMITS.valueBytes
      );
      if (row.source === 'record' && row.key === 'vault') result.vault = raw;
      else if (row.source === 'record' && row.key === 'vault-keys')
        result.keys = raw;
      else if (row.source === 'meta' && row.key === 'backup')
        result.backup = raw;
      else if (row.source === 'meta' && row.key === 'auth') result.auth = raw;
      else throw failure();
    }
    return result;
  }

  private async fingerprint(pair: Pair): Promise<string> {
    if (validatePair(pair) !== 'existing') throw failure();
    const bytes = new TextEncoder().encode(
      JSON.stringify(['pali.native.wallet-backup.v1', pair.vault, pair.keys])
    );
    try {
      const hash = await this.digest(bytes);
      if (!(hash instanceof Uint8Array) || hash.length !== 32) throw failure();
      return Array.from(hash, (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
    } finally {
      bytes.fill(0);
    }
  }

  readState(): Promise<WalletStoredState> {
    return this.queued(async () => {
      const pair = await this.pair();
      if (validatePair(pair) === 'empty')
        return Object.freeze({ presence: 'empty', backup: 'unconfirmed' });
      const auth = this.authenticationRecord(pair.auth);
      this.authenticationNotBefore(pair.auth, auth, this.monotonicTimestamp());
      if (pair.backup === undefined)
        return Object.freeze({ presence: 'existing', backup: 'unconfirmed' });
      const backup = decodeStorageValue(pair.backup);
      if (
        !exact(backup, ['version', 'fingerprint']) ||
        backup.version !== 1 ||
        backup.fingerprint !== (await this.fingerprint(pair))
      )
        throw failure();
      return Object.freeze({ presence: 'existing', backup: 'confirmed' });
    });
  }

  getWalletFingerprint(): Promise<string> {
    return this.queued(async () => this.fingerprint(await this.pair()));
  }

  private authenticationRecord(raw: string | undefined): AuthRecord {
    if (raw === undefined)
      return { version: 1, failures: 0, lastAttempt: 0, notBefore: 0 };
    const value = decodeStorageValue(raw);
    if (
      !exact(value, ['version', 'failures', 'lastAttempt', 'notBefore']) ||
      value.version !== 1 ||
      !Number.isSafeInteger(value.failures) ||
      (value.failures as number) < 0 ||
      (value.failures as number) > 64 ||
      !Number.isSafeInteger(value.lastAttempt) ||
      (value.lastAttempt as number) < 0 ||
      (value.lastAttempt as number) > Number.MAX_SAFE_INTEGER - 300000 ||
      !Number.isSafeInteger(value.notBefore) ||
      (value.notBefore as number) < 0
    )
      throw failure();
    const record = value as AuthRecord;
    const delay =
      record.failures < 5
        ? 0
        : Math.min(300000, 30000 * 2 ** Math.min(4, record.failures - 5));
    if (record.notBefore !== (delay ? record.lastAttempt + delay : 0))
      throw failure();
    return record;
  }

  private timestamp(): number {
    const now = this.now();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now > Number.MAX_SAFE_INTEGER - 300000
    )
      throw failure();
    return now;
  }

  private monotonicTimestamp(): number {
    try {
      const value = this.monotonicMilliseconds();
      if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - 300000 ||
          (this.lastMonotonic !== null && value < this.lastMonotonic)) throw failure();
      this.lastMonotonic = value;
      return value;
    } catch {
      // A clock failure must not let this connection reuse an expired window.
      this.poisoned = true;
      throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');
    }
  }

  private authenticationNotBefore(raw: string | undefined, record: AuthRecord, monotonic: number): number {
    if (!this.authenticationWindow || this.authenticationWindow.raw !== raw) {
      const delay = record.notBefore ? record.notBefore - record.lastAttempt : 0;
      // No trustworthy offline elapsed clock exists here. Every reopened
      // connection waits the complete persisted delay, capped at five minutes.
      this.authenticationWindow = { raw, notBefore: delay ? monotonic + delay : 0 };
    }
    return this.authenticationWindow.notBefore;
  }

  private requireAuthenticationAllowed(raw: string | undefined, record: AuthRecord): void {
    const monotonic = this.monotonicTimestamp();
    if (monotonic < this.authenticationNotBefore(raw, record, monotonic))
      throw new WalletStorageError('AUTH_THROTTLED');
  }

  private checkAllowed(): Promise<void> {
    return this.queued(async () => {
      const pair = await this.pair();
      if (validatePair(pair) !== 'existing') throw failure();
      this.requireAuthenticationAllowed(pair.auth, this.authenticationRecord(pair.auth));
    });
  }

  private recordAuthentication(success: boolean): Promise<void> {
    return this.queued(async () => {
      const committed = await this.transaction(async () => {
        const pair = await this.pair();
        if (validatePair(pair) !== 'existing') throw failure();
        const previous = this.authenticationRecord(pair.auth);
        this.requireAuthenticationAllowed(pair.auth, previous);
        const now = this.timestamp();
        const failures = success ? 0 : Math.min(64, previous.failures + 1);
        const delay = failures < 5 ? 0 : Math.min(300000, 30000 * 2 ** Math.min(4, failures - 5));
        const record: AuthRecord = { version: 1, failures, lastAttempt: now, notBefore: delay ? now + delay : 0 };
        const raw = encodeStorageValue(record);
        await this.db.runAsync(
          'INSERT INTO wallet_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ['auth', raw]
        );
        return { raw, record };
      });
      // Every acknowledged outcome is fresh, even if a saturated counter and
      // repeated wall timestamp serialize identically to the previous record.
      this.authenticationWindow = null;
      this.authenticationNotBefore(committed.raw, committed.record, this.monotonicTimestamp());
    });
  }

  confirmBackup(expectedFingerprint: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(expectedFingerprint))
      return Promise.reject(failure());
    return this.queued(async () => {
      const before = await this.pair();
      if ((await this.fingerprint(before)) !== expectedFingerprint)
        throw new WalletStorageError('STORAGE_CHANGED');
      if (before.backup !== undefined) {
        const existing = decodeStorageValue(before.backup);
        if (
          !exact(existing, ['version', 'fingerprint']) ||
          existing.version !== 1 ||
          existing.fingerprint !== expectedFingerprint
        )
          throw failure();
      }
      const backup = encodeStorageValue({
        version: 1,
        fingerprint: expectedFingerprint,
      });
      await this.transaction(async () => {
        const current = await this.pair();
        if (current.vault !== before.vault || current.keys !== before.keys)
          throw new WalletStorageError('STORAGE_CHANGED');
        await this.db.runAsync(
          'INSERT INTO wallet_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ['backup', backup]
        );
      });
    });
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.tail.then(async () => {
        try {
          await this.db.closeAsync();
        } catch {
          throw new WalletStorageError('STORAGE_UNAVAILABLE');
        } finally {
          this.closed = true;
        }
      });
    }
    return this.closing;
  }
}
