import type { DeviceUnlockEnrollmentSnapshot } from '../../../../source/wallet/deviceUnlockEnrollment.ts';
import { inspectNoteDomain, NOTE_DOMAIN_MAX_BYTES } from './noteDomain.ts';
import { ACCOUNT_RECORD_KEY, ACCOUNT_RECORD_LIMITS, encodeAccountRecord, decodeAccountRecord } from './accountRecordKey.ts';
import { EVM_SIGNED_RECORD_LIMITS, inspectEvmSignedBundle } from '../../../../source/wallet/evmSignedRecords.ts';
import {
  decodeStorageValue,
  encodeStorageValue,
  STORAGE_LIMITS,
  validateStorageKey,
} from './json.ts';
import { WalletStorageError } from './types.ts';
import { readWalletIdentity } from './walletIdentity.ts';
import { sameRecoverySnapshot } from './recoverySnapshot.ts';
import type {
  DeviceUnlockVaultPair,
  KeyringStoragePort,
  OpenWalletStorage,
  SqlConnection,
  StorageDigest,
  WalletStoredState,
  WalletIdentityRead,
  RecoveryStorageSnapshot,
  RecoveryWritePlan,
  RecoveryRoot,
  NoteDomainRow,
  SignedRecordDomainRow,
  WalletRemovalResult,
} from './types.ts';

const TABLE = `CREATE TABLE keyring_records (key TEXT PRIMARY KEY NOT NULL CHECK(typeof(key) = 'text' AND length(CAST(key AS BLOB)) BETWEEN 1 AND 256), value TEXT NOT NULL CHECK(typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= CASE WHEN key = '${ACCOUNT_RECORD_KEY}' THEN ${ACCOUNT_RECORD_LIMITS.valueBytes} ELSE 65536 END))`;
const META = `CREATE TABLE wallet_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK(typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= 1024))`;
const NOTES = `CREATE TABLE private_note_records (profile_id TEXT PRIMARY KEY NOT NULL CHECK(typeof(profile_id) = 'text' AND length(profile_id) = 66), wallet_binding TEXT NOT NULL CHECK(typeof(wallet_binding) = 'text' AND length(wallet_binding) = 64), value TEXT NOT NULL CHECK(typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= 16777216))`;
const SIGNED = `CREATE TABLE evm_signed_records (profile_id TEXT PRIMARY KEY NOT NULL CHECK(typeof(profile_id) = 'text' AND length(profile_id) = 66), wallet_binding TEXT NOT NULL CHECK(typeof(wallet_binding) = 'text' AND length(wallet_binding) = 64), value TEXT NOT NULL CHECK(typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= ${EVM_SIGNED_RECORD_LIMITS.bytes}))`;
const boundedValueColumns = (selected = 'value') =>
  `CASE WHEN typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= ? THEN ${selected} ELSE NULL END AS value, typeof(value) AS storage_type, length(CAST(value AS BLOB)) AS storage_bytes`;
const boundedColumns = boundedValueColumns();
// Refuse multiple profiles before any ciphertext crosses the SQL connection.
const boundedNoteColumns = `CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM private_note_records LIMIT 2)) = 1 AND typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= ? THEN value ELSE NULL END AS value, typeof(value) AS storage_type, length(CAST(value AS BLOB)) AS storage_bytes`;
const boundedSignedColumns = `CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM evm_signed_records LIMIT 2)) = 1 AND typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= ? THEN value ELSE NULL END AS value, typeof(value) AS storage_type, length(CAST(value AS BLOB)) AS storage_bytes`;
const boundedRecordColumns = `CASE WHEN typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= CASE WHEN key = '${ACCOUNT_RECORD_KEY}' THEN ? ELSE ? END THEN value ELSE NULL END AS value, typeof(value) AS storage_type, length(CAST(value AS BLOB)) AS storage_bytes`;
const GET = `SELECT ${boundedColumns} FROM keyring_records WHERE key = ?`;
const PAIR = `SELECT 'record' AS source, key, ${boundedColumns} FROM keyring_records WHERE key IN ('vault', 'vault-keys') UNION ALL SELECT 'meta' AS source, key, ${boundedColumns} FROM wallet_metadata WHERE key IN ('backup', 'auth', 'identity')`;
const ENROLLMENT_KEY = 'device-unlock-enrollment';
const ENROLLMENT_BYTES = 256;
// Preserve raw enrollment bytes across native SQLite text bridges.
const ENROLLMENT_HEX = 'hex(CAST(value AS BLOB))';
const boundedMetadataColumns = boundedValueColumns(`CASE WHEN key = '${ENROLLMENT_KEY}' THEN ${ENROLLMENT_HEX} ELSE value END`);
const PAIR_WITH_ENROLLMENT = `${PAIR} UNION ALL SELECT 'meta' AS source, key, ${boundedValueColumns(ENROLLMENT_HEX)} FROM wallet_metadata WHERE key = '${ENROLLMENT_KEY}'`;
const SNAPSHOT = `SELECT 'record' AS source, CASE WHEN typeof(key) = 'text' AND length(CAST(key AS BLOB)) BETWEEN 1 AND 256 THEN key ELSE NULL END AS key, ${boundedRecordColumns}, NULL AS wallet_binding FROM keyring_records UNION ALL SELECT 'meta' AS source, CASE WHEN typeof(key) = 'text' AND length(CAST(key AS BLOB)) BETWEEN 1 AND 256 THEN key ELSE NULL END AS key, ${boundedMetadataColumns}, NULL AS wallet_binding FROM wallet_metadata UNION ALL SELECT 'note' AS source, CASE WHEN typeof(profile_id) = 'text' AND length(profile_id) = 66 THEN profile_id ELSE NULL END AS key, ${boundedNoteColumns}, CASE WHEN typeof(wallet_binding) = 'text' AND length(wallet_binding) = 64 THEN wallet_binding ELSE NULL END AS wallet_binding FROM private_note_records UNION ALL SELECT 'signed' AS source, CASE WHEN typeof(profile_id) = 'text' AND length(profile_id) = 66 THEN profile_id ELSE NULL END AS key, ${boundedSignedColumns}, CASE WHEN typeof(wallet_binding) = 'text' AND length(wallet_binding) = 64 THEN wallet_binding ELSE NULL END AS wallet_binding FROM evm_signed_records ORDER BY source, key LIMIT 72`;

const NOTE_ROWS = `SELECT 'note' AS source, CASE WHEN typeof(profile_id) = 'text' AND length(profile_id) = 66 THEN profile_id ELSE NULL END AS key, ${boundedNoteColumns}, CASE WHEN typeof(wallet_binding) = 'text' AND length(wallet_binding) = 64 THEN wallet_binding ELSE NULL END AS wallet_binding FROM private_note_records ORDER BY profile_id LIMIT 2`;
const SIGNED_ROWS = `SELECT 'signed' AS source, CASE WHEN typeof(profile_id) = 'text' AND length(profile_id) = 66 THEN profile_id ELSE NULL END AS key, ${boundedSignedColumns}, CASE WHEN typeof(wallet_binding) = 'text' AND length(wallet_binding) = 64 THEN wallet_binding ELSE NULL END AS wallet_binding FROM evm_signed_records ORDER BY profile_id LIMIT 2`;
const recordBytes = (key: string) => key === ACCOUNT_RECORD_KEY ? ACCOUNT_RECORD_LIMITS.valueBytes : STORAGE_LIMITS.valueBytes;
const encodeRecord = (key: string, value: unknown) => key === ACCOUNT_RECORD_KEY ? encodeAccountRecord(value) : encodeStorageValue(value);
const decodeRecord = (key: string, value: unknown) => key === ACCOUNT_RECORD_KEY ? decodeAccountRecord(value) : decodeStorageValue(value);
const failure = () => new WalletStorageError('STORAGE_CORRUPT');
const safeError = (error: unknown) =>
  error instanceof WalletStorageError
    ? error
    : new WalletStorageError('STORAGE_UNAVAILABLE');
const storageGuard = (assertCurrent: () => void) => () => {
  const result: unknown = assertCurrent();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
    throw new WalletStorageError('STORAGE_CHANGED');
  }
};
type StoredRow = {
  value: unknown;
  storage_type: unknown;
  storage_bytes: unknown;
};
type PairRow = StoredRow & {
  source: string;
  key: string;
  wallet_binding?: unknown;
};
type Pair = { vault?: string; keys?: string; backup?: string; auth?: string; identity?: string; enrollment?: StoredRow };
const isEnrollmentId = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 32 && /^[0-9a-f]{32}$/.test(value);
type EnrollmentScope = Omit<DeviceUnlockEnrollmentSnapshot, 'enrollmentId'>;
const encodeEnrollment = (scope: EnrollmentScope, id: string) =>
  JSON.stringify(['pali.native.device-unlock.v1', scope.installationId, scope.walletBindingId, scope.pairFingerprint, id]);
const encodeEnrollmentHex = (value: string) =>
  Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
function decodeEnrollmentId(rawHex: string, scope: EnrollmentScope): string | null {
  const bytes = (rawHex.match(/../g) ?? []).map((pair) => parseInt(pair, 16));
  // The canonical record contains printable ASCII only. Do not normalize text.
  if (bytes.some((byte) => byte < 0x20 || byte > 0x7e)) return null;
  const raw = String.fromCharCode(...bytes);
  try {
    const parsed: unknown = JSON.parse(raw);
    const id: unknown = Array.isArray(parsed) ? parsed[4] : undefined;
    return isEnrollmentId(id) && raw === encodeEnrollment(scope, id) ? id : null;
  } catch { return null; }
}
const sameEnrollmentScope = (a: DeviceUnlockEnrollmentSnapshot, b: DeviceUnlockEnrollmentSnapshot) =>
  a.installationId === b.installationId && a.walletBindingId === b.walletBindingId && a.pairFingerprint === b.pairFingerprint;
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
  limit = STORAGE_LIMITS.valueBytes,
  encoding: 'text' | 'hex' = 'text'
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
  if (encoding === 'hex') {
    if (row.value.length !== (row.storage_bytes as number) * 2 || /[^0-9A-F]/.test(row.value)) throw failure();
  } else if (
    row.value.length > limit ||
    new TextEncoder().encode(row.value).length !== row.storage_bytes
  )
    throw failure();
  return row.value;
}

function validatePair(pair: Pair): 'empty' | 'existing' {
  if (pair.vault === undefined && pair.keys === undefined) {
    if (pair.backup !== undefined || pair.auth !== undefined || pair.identity !== undefined) throw failure();
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
  // Only the shared SDK authenticated envelope is admitted for native custody.
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
  readonly deviceUnlockEnrollment: NonNullable<OpenWalletStorage['deviceUnlockEnrollment']>;
  readonly authGuard: OpenWalletStorage['authGuard'];
  readonly notes: NonNullable<OpenWalletStorage['notes']>;
  readonly signedRecords: OpenWalletStorage['signedRecords'];
  readonly recovery: NonNullable<OpenWalletStorage['recovery']>;
  readonly removal: NonNullable<OpenWalletStorage['removal']>;
  private tail: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private poisoned = false;
  private closed = false;
  private retired = false;
  private readonly db: SqlConnection;
  private readonly digest: StorageDigest;
  private readonly now: () => number;
  private readonly monotonicMilliseconds: () => number;
  private readonly installationId: string;
  private lastMonotonic: number | null = null;
  private authenticationWindow: { raw: string | undefined; notBefore: number } | null = null;
  private writeGeneration = {};
  private readonly recoverySnapshots = new WeakMap<RecoveryStorageSnapshot, object>();
  private enrollmentRevision = {};
  private readonly enrollmentReads = new WeakMap<DeviceUnlockEnrollmentSnapshot, { rawHex: string | undefined; revision: object }>();
  private readonly recoveryWrites = new WeakMap<
    RecoveryWritePlan,
    {
      before: RecoveryStorageSnapshot;
      after: RecoveryStorageSnapshot;
      creation?: true;
    }
  >();

  private constructor(
    db: SqlConnection,
    digest: StorageDigest,
    now: () => number,
    monotonicMilliseconds: () => number,
    installationId: string
  ) {
    this.db = db;
    this.digest = digest;
    this.now = now;
    this.monotonicMilliseconds = monotonicMilliseconds;
    this.installationId = installationId;
    this.keyringStorage = Object.freeze<KeyringStoragePort>({
      get: (key: string) => this.get(key),
      set: (key: string, value: unknown) => this.set(key, value),
      deleteItem: (key: string) => this.deleteItem(key),
      createManyIfAbsent: (items, assertCurrent) =>
        this.createManyIfAbsent(items, assertCurrent),
      readDeviceUnlockVaultPair: () => this.readDeviceUnlockVaultPair(),
      compareAndSet: (key, expected, value, removeIfEqual, assertCurrent) =>
        this.compareAndSet(key, expected, value, removeIfEqual, assertCurrent),
    });
    this.deviceUnlockEnrollment = Object.freeze<NonNullable<OpenWalletStorage['deviceUnlockEnrollment']>>({
      read: () => this.readDeviceUnlockEnrollment(),
      compareAndSet: (expected, enrollmentId, assertCurrent) => this.compareAndSetDeviceUnlockEnrollment(expected, enrollmentId, assertCurrent),
    });
    this.notes = Object.freeze({
      read: () => this.queued(() => this.readNotes()),
      compareAndSet: (profileId: string, walletBindingId: string, expected: string | undefined, next: string, assertCurrent: () => void) =>
        this.compareAndSetNotes(profileId, walletBindingId, expected, next, assertCurrent),
    });
    this.signedRecords = Object.freeze({
      read: (profileId: string) => this.queued(async () => {
        const identity = await this.identityForProfile(profileId);
        const rows = await this.readSignedRows();
        this.inspectSignedRows(rows, identity);
        return rows[0]?.value;
      }),
      compareAndSet: (profileId: string, expected: string | undefined, next: string, assertCurrent: () => void) =>
        this.compareAndSetSigned(profileId, expected, next, assertCurrent),
    });
    this.authGuard = Object.freeze({
      checkAllowed: () => this.checkAllowed(),
      recordFailure: () => this.recordAuthentication(false),
      recordSuccess: () => this.recordAuthentication(true),
    });
    this.removal = Object.freeze({
      commit: (snapshot, assertCurrent) => this.commitRemoval(snapshot, assertCurrent),
    });
    this.recovery = Object.freeze({
      readIdentity: () => this.readIdentity(),
      readSnapshot: () => this.readSnapshot(),
      fingerprintPair: (
        candidate: Readonly<{ vault: unknown; keys: unknown }>
      ) => {
        const captured = encodeStorageValue(candidate);
        return this.queued(() => {
          const value = decodeStorageValue(captured);
          if (!exact(value, ['vault', 'keys'])) throw failure();
          return this.fingerprint({
            vault: encodeStorageValue(value.vault),
            keys: encodeStorageValue(value.keys),
          });
        });
      },
      prepareCreation: (
        snapshot: RecoveryStorageSnapshot,
        candidate: Readonly<{
          vault: unknown;
          keys: unknown;
          accountRecords: unknown;
        }>,
        root: RecoveryRoot
      ) => this.prepareCreation(snapshot, candidate, root),
      bindIdentity: (expectedPairFingerprint: string, root: RecoveryRoot, assertCurrent: () => void) => this.bindIdentity(expectedPairFingerprint, root, assertCurrent),
      prepareReplacement: (
        snapshot: RecoveryStorageSnapshot,
        pair: Readonly<{
          vault: unknown;
          keys: unknown;
          accountRecords?: unknown;
        }>,
        root: RecoveryRoot
      ) => this.prepareReplacement(snapshot, pair, root),
      plannedSnapshot: (plan: RecoveryWritePlan) => { const value = this.recoveryWrites.get(plan); if (!value) throw new WalletStorageError('STORAGE_CHANGED'); return value.after; },
      commitReplacement: (plan: unknown, guard: () => void) => this.commitReplacement(plan, guard),
      recordFailureForPair: (fingerprint: string) => this.recordAuthentication(false, fingerprint),
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
    const storage = new SqliteWalletStorage(db, digest, now, monotonicMilliseconds, installationId);
    try {
      const tables = await db.getAllAsync<{ name: string; sql: string }>(
        "SELECT CASE WHEN length(name) <= 64 THEN name ELSE NULL END AS name, CASE WHEN length(CAST(sql AS BLOB)) <= 1024 THEN sql ELSE NULL END AS sql FROM sqlite_master WHERE type IN ('table', 'view', 'trigger', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 5"
      );
      const version = await db.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version'
      );
      if (initialize && tables.length === 0 && version?.user_version === 0) {
        await storage.transaction(async () => {
          await db.execAsync(TABLE);
          await db.execAsync(META);
          await db.execAsync(NOTES);
          await db.execAsync(SIGNED);
          await db.runAsync(
            'INSERT INTO wallet_metadata (key, value) VALUES (?, ?)',
            ['installation', installationId]
          );
          await db.execAsync('PRAGMA user_version = 1');
        });
      } else if (version?.user_version !== 1 || tables.length !== 4 || tables[0]?.name !== 'evm_signed_records' || tables[0].sql !== SIGNED ||
        tables[1]?.name !== 'keyring_records' || tables[1].sql !== TABLE || tables[2]?.name !== 'private_note_records' || tables[2].sql !== NOTES ||
        tables[3]?.name !== 'wallet_metadata' || tables[3].sql !== META) throw failure();
      const installation = await db.getFirstAsync<{ value: unknown }>(
        "SELECT CASE WHEN typeof(value) = 'text' AND length(CAST(value AS BLOB)) = 32 THEN value ELSE NULL END AS value FROM wallet_metadata WHERE key = 'installation'"
      );
      if (installation?.value !== installationId) throw failure();
      const metadata = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM wallet_metadata WHERE key NOT IN ('installation', 'backup', 'auth', 'identity', '${ENROLLMENT_KEY}')`
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
      // Reject malformed or orphaned note rows before handing an owner to a runtime.
      await storage.notes.read();
      const signed = await storage.readSignedRows();
      if (signed.length) {
        const pair = await storage.pair();
        if (validatePair(pair) !== 'existing') throw failure();
        const identity = readWalletIdentity(await storage.fingerprint(pair), pair.identity);
        storage.inspectSignedRows(signed, identity);
      }
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
      if (this.retired) throw new WalletStorageError('STORAGE_CLOSED');
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

  private async transaction<T>(operation: () => Promise<T>, beforeCommit?: () => void): Promise<T> {
    let commitStarted = false;
    try {
      await this.db.execAsync('BEGIN IMMEDIATE');
      const result = await operation();
      // The awaited operation permits queued cancellation/expiry to run. Check
      // again in the same turn that dispatches COMMIT, before it can be durable.
      beforeCommit?.();
      commitStarted = true;
      await this.db.execAsync('COMMIT');
      this.writeGeneration = {};
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

  private async guardedMutation(
    operation: (check?: () => void) => Promise<boolean>,
    assertCurrent?: () => void
  ): Promise<boolean> {
    if (assertCurrent === undefined) return this.transaction(() => operation());
    const rejected = new WalletStorageError('STORAGE_CHANGED');
    const assertOwner = storageGuard(assertCurrent);
    const check = () => {
      try { assertOwner(); } catch { throw rejected; }
    };
    try { return await this.transaction(() => operation(check), check); }
    catch (error) {
      // This exact rejection occurs only before COMMIT. A failed ROLLBACK
      // poisons the storage owner and must still be reported as uncertain.
      if (error === rejected && !this.poisoned) return false;
      throw error;
    }
  }

  private get(key: string): Promise<unknown> {
    validateStorageKey(key);
    return this.queued(async () => {
      const row = await this.db.getFirstAsync<StoredRow>(GET, [
        recordBytes(key),
        key,
      ]);
      return row === null ? undefined : decodeRecord(key, admittedRow(row, recordBytes(key)));
    });
  }

  private set(key: string, value: unknown): Promise<void> {
    validateStorageKey(key);
    const raw = encodeRecord(key, value);
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

  private createManyIfAbsent(items: Record<string, unknown>, assertCurrent?: () => void): Promise<boolean> {
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
      return [key, encodeRecord(key, descriptor.value)] as const;
    });
    return this.queued(() =>
      this.guardedMutation(async (check) => {
        check?.();
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
      }, assertCurrent)
    );
  }

  private compareAndSet(key: string, expected: unknown, value: unknown,
    removeIfEqual: Readonly<Record<string, unknown>> = {}, assertCurrent?: () => void): Promise<boolean> {
    validateStorageKey(key);
    const before = encodeRecord(key, expected);
    const after = encodeRecord(key, value);
    if (!removeIfEqual || typeof removeIfEqual !== 'object' || Array.isArray(removeIfEqual) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(removeIfEqual))) throw failure();
    const names = Reflect.ownKeys(removeIfEqual);
    if (names.length > STORAGE_LIMITS.batchKeys) throw failure();
    const removals = names.map((name) => {
      if (typeof name !== 'string' || name === key) throw failure();
      validateStorageKey(name);
      const descriptor = Object.getOwnPropertyDescriptor(removeIfEqual, name);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw failure();
      return [name, descriptor.value === undefined ? undefined : encodeRecord(name, descriptor.value)] as const;
    });
    return this.queued(() => this.guardedMutation(async (check) => {
      check?.();
      const row = await this.db.getFirstAsync<StoredRow>(GET, [recordBytes(key), key]);
      if (row === null || admittedRow(row, recordBytes(key)) !== before) return false;
      for (const [name, snapshot] of removals) {
        const candidate = await this.db.getFirstAsync<StoredRow>(GET, [recordBytes(name), name]);
        if (snapshot === undefined ? candidate !== null : candidate === null || admittedRow(candidate, recordBytes(name)) !== snapshot) return false;
      }
      await this.db.runAsync('UPDATE keyring_records SET value = ? WHERE key = ?', [after, key]);
      for (const [name, snapshot] of removals) {
        if (snapshot !== undefined) await this.db.runAsync('DELETE FROM keyring_records WHERE key = ?', [name]);
      }
      return true;
    }, assertCurrent));
  }

  private async pair(includeEnrollment = false): Promise<Pair> {
    const rows = await this.db.getAllAsync<PairRow>(
      includeEnrollment ? PAIR_WITH_ENROLLMENT : PAIR,
      includeEnrollment ? [STORAGE_LIMITS.valueBytes, 1024, ENROLLMENT_BYTES] : [STORAGE_LIMITS.valueBytes, 1024]
    );
    if (rows.length > (includeEnrollment ? 6 : 5)) throw failure();
    const result: Pair = {};
    for (const row of rows) {
      if (includeEnrollment && row.source === 'meta' && row.key === ENROLLMENT_KEY) {
        if (result.enrollment) throw failure();
        result.enrollment = row;
        continue;
      }
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
      else if (row.source === 'meta' && row.key === 'identity') result.identity = raw;
      else throw failure();
    }
    if (result.identity !== undefined) readWalletIdentity(await this.fingerprint(result), result.identity);
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

  private readDeviceUnlockVaultPair(): Promise<DeviceUnlockVaultPair | null> {
    return this.queued(async () => {
      const pair = await this.pair();
      if (pair.vault === undefined && pair.keys === undefined) {
        validatePair(pair);
        return null;
      }
      const pairFingerprint = await this.fingerprint(pair);
      // The fingerprint path validates both serialized records. Decode those
      // same bytes for the SDK instead of reading either storage key again.
      return Object.freeze({
        vault: decodeStorageValue(pair.vault) as string,
        keys: Object.freeze(decodeStorageValue(pair.keys) as { salt: string }),
        pairFingerprint,
      });
    });
  }

  private async captureEnrollment(): Promise<{
    snapshot: DeviceUnlockEnrollmentSnapshot;
    rawHex: string | undefined | null;
  } | null> {
    const pair = await this.pair(true);
    if (pair.vault === undefined && pair.keys === undefined) {
      validatePair(pair);
      return null;
    }
    const pairFingerprint = await this.fingerprint(pair);
    const { walletBindingId } = readWalletIdentity(pairFingerprint, pair.identity);
    const scope = { installationId: this.installationId, walletBindingId, pairFingerprint };
    let rawHex: string | undefined | null;
    if (pair.enrollment) {
      try { rawHex = admittedRow(pair.enrollment, ENROLLMENT_BYTES, 'hex'); }
      catch { rawHex = null; }
    }
    const enrollmentId = typeof rawHex === 'string' ? decodeEnrollmentId(rawHex, scope) : null;
    return { snapshot: Object.freeze({ ...scope, enrollmentId }), rawHex };
  }

  private readDeviceUnlockEnrollment(): Promise<DeviceUnlockEnrollmentSnapshot | null> {
    return this.queued(async () => {
      const current = await this.captureEnrollment();
      // Only a byte-admitted row or exact absence can authorize a replacement.
      if (current && current.rawHex !== null)
        this.enrollmentReads.set(current.snapshot, { rawHex: current.rawHex, revision: this.enrollmentRevision });
      return current?.snapshot ?? null;
    });
  }

  private compareAndSetDeviceUnlockEnrollment(
    expected: DeviceUnlockEnrollmentSnapshot,
    enrollmentId: string | null,
    assertCurrent: () => void
  ): Promise<boolean> {
    const prior = this.enrollmentReads.get(expected);
    this.enrollmentReads.delete(expected);
    if (!prior || (enrollmentId !== null && !isEnrollmentId(enrollmentId)) || typeof assertCurrent !== 'function')
      return Promise.reject(new WalletStorageError('STORAGE_CHANGED'));
    const assertOwner = storageGuard(assertCurrent);
    const check = () => {
      if (this.closing) throw new WalletStorageError('STORAGE_CLOSED');
      assertOwner();
      if (this.closing) throw new WalletStorageError('STORAGE_CLOSED');
    };
    const next = enrollmentId === null ? undefined : encodeEnrollment(expected, enrollmentId);
    const nextHex = next === undefined ? undefined : encodeEnrollmentHex(next);
    return this.queued(async () => {
      check();
      if (prior.revision !== this.enrollmentRevision || nextHex === prior.rawHex) return false;
      const committed = await this.transaction(async () => {
        const current = await this.captureEnrollment();
        check();
        if (!current || !sameEnrollmentScope(current.snapshot, expected) || current.rawHex !== prior.rawHex) return false;
        if (next === undefined) await this.db.runAsync('DELETE FROM wallet_metadata WHERE key = ?', [ENROLLMENT_KEY]);
        else await this.db.runAsync(
          'INSERT INTO wallet_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [ENROLLMENT_KEY, next]
        );
        return true;
      }, check).catch((error) => this.requireReopenIfPoisoned(error));
      if (!committed) return false;
      this.enrollmentRevision = {};
      // A lost owner after COMMIT must reconcile before retiring any protected alias.
      try {
        check();
        const current = await this.captureEnrollment();
        if (!current || !sameEnrollmentScope(current.snapshot, expected) || current.rawHex !== nextHex) throw failure();
        check();
      } catch (error) { this.poisoned = true; this.requireReopenIfPoisoned(error); }
      return true;
    });
  }

  private async storedState(pair: Pair): Promise<WalletStoredState> {
    if (validatePair(pair) === 'empty')
      return Object.freeze({ presence: 'empty', backup: 'unconfirmed' });
    if (pair.identity !== undefined) readWalletIdentity(await this.fingerprint(pair), pair.identity);
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
  }

  readState(): Promise<WalletStoredState> {
    return this.queued(async () => this.storedState(await this.pair()));
  }

  private readIdentity(): Promise<WalletIdentityRead | null> {
    return this.queued(async () => {
      const pair = await this.pair();
      return validatePair(pair) === 'empty' ? null : readWalletIdentity(await this.fingerprint(pair), pair.identity);
    });
  }

  private bindIdentity(
    expectedPairFingerprint: string,
    root: RecoveryRoot,
    assertCurrent: () => void
  ): Promise<void> {
    if (typeof assertCurrent !== 'function' || typeof expectedPairFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(expectedPairFingerprint))
      return Promise.reject(new WalletStorageError('STORAGE_CHANGED'));
    const check = storageGuard(assertCurrent);
    // Use the existing identity decoder to admit a detached canonical root.
    const checkedRoot = readWalletIdentity(expectedPairFingerprint, encodeStorageValue({ version: 1,
      walletBindingId: expectedPairFingerprint, pairFingerprint: expectedPairFingerprint, root })).root!;
    return this.queued(async () => {
      let expectedRaw: string | undefined;
      await this.transaction(async () => {
        check();
        const pair = await this.pair();
        check();
        if (
          validatePair(pair) !== 'existing' ||
          (await this.fingerprint(pair)) !== expectedPairFingerprint
        )
          throw new WalletStorageError('STORAGE_CHANGED');
        check();
        const identity = readWalletIdentity(
          expectedPairFingerprint,
          pair.identity
        );
        if (identity.root && JSON.stringify(identity.root) !== JSON.stringify(checkedRoot))
          throw new WalletStorageError('STORAGE_CHANGED');
        expectedRaw = encodeStorageValue({ version: 1, walletBindingId: identity.walletBindingId,
          pairFingerprint: expectedPairFingerprint, root: checkedRoot });
        if (pair.identity !== expectedRaw) await this.db.runAsync(
          'INSERT INTO wallet_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['identity', expectedRaw]);
        check();
      }, check).catch((error) => this.requireReopenIfPoisoned(error));
      check();
      try {
        const after = await this.pair();
        if (
          after.identity !== expectedRaw ||
          (await this.fingerprint(after)) !== expectedPairFingerprint
        )
          throw failure();
      } catch (error) {
        this.poisoned = true;
        this.requireReopenIfPoisoned(error);
      }
      check();
    });
  }

  private requireReopenIfPoisoned(error: unknown): never {
    if (this.poisoned) throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');
    throw error;
  }

  private async identityForProfile(profileId: string): Promise<WalletIdentityRead> {
    const pair = await this.pair();
    if (validatePair(pair) !== 'existing') throw new WalletStorageError('STORAGE_CHANGED');
    const identity = readWalletIdentity(await this.fingerprint(pair), pair.identity);
    if (!identity.root || identity.root.profileId !== profileId) throw new WalletStorageError('STORAGE_CHANGED');
    return identity;
  }

  private async readSignedRows(): Promise<readonly SignedRecordDomainRow[]> {
    const rows = await this.db.getAllAsync<PairRow>(SIGNED_ROWS, [EVM_SIGNED_RECORD_LIMITS.bytes]);
    if (rows.length > 1) throw failure();
    return Object.freeze(rows.map((row) => {
      if (typeof row.key !== 'string' || typeof row.wallet_binding !== 'string') throw failure();
      return Object.freeze({ profileId: row.key, walletBindingId: row.wallet_binding,
        value: admittedRow(row, EVM_SIGNED_RECORD_LIMITS.bytes) });
    }));
  }

  private inspectSignedRows(rows: readonly SignedRecordDomainRow[], identity: WalletIdentityRead | null): void {
    if (rows.length > 1) throw failure();
    for (const row of rows) {
      if (!identity?.root || row.profileId !== identity.root.profileId || row.walletBindingId !== identity.walletBindingId) throw failure();
      try { inspectEvmSignedBundle(row.value, row.profileId); } catch { throw failure(); }
    }
  }

  private compareAndSetSigned(profileId: string, expected: string | undefined, next: string, assertCurrent: () => void): Promise<boolean> {
    if (typeof assertCurrent !== 'function') return Promise.reject(new WalletStorageError('STORAGE_CHANGED'));
    const check = storageGuard(assertCurrent);
    check();
    try {
      if (expected !== undefined) inspectEvmSignedBundle(expected, profileId);
      inspectEvmSignedBundle(next, profileId);
    } catch { return Promise.reject(failure()); }
    return this.queued(async () => {
      let binding: string | undefined;
      const committed = await this.transaction(async () => {
        check();
        const identity = await this.identityForProfile(profileId); check();
        binding = identity.walletBindingId;
        const before = await this.readSignedRows(); check();
        this.inspectSignedRows(before, identity);
        if (before[0]?.value !== expected) return false;
        await this.db.runAsync('INSERT INTO evm_signed_records (profile_id, wallet_binding, value) VALUES (?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET wallet_binding = excluded.wallet_binding, value = excluded.value', [profileId, binding, next]);
        check();
        return true;
      }, check).catch((error) => this.requireReopenIfPoisoned(error));
      if (!committed) return false;
      check();
      try {
        const identity = await this.identityForProfile(profileId);
        const after = await this.readSignedRows();
        this.inspectSignedRows(after, identity);
        if (identity.walletBindingId !== binding || after[0]?.value !== next) throw failure();
      } catch (error) { this.poisoned = true; this.requireReopenIfPoisoned(error); }
      check();
      return true;
    });
  }

  private async readNoteRows(): Promise<readonly NoteDomainRow[]> {
    const rows = await this.db.getAllAsync<PairRow>(NOTE_ROWS, [NOTE_DOMAIN_MAX_BYTES]);
    if (rows.length > 1) throw failure();
    return Object.freeze(rows.map((row) => {
      if (typeof row.key !== 'string' || typeof row.wallet_binding !== 'string') throw failure();
      return Object.freeze({ profileId: row.key, walletBindingId: row.wallet_binding, value: admittedRow(row, NOTE_DOMAIN_MAX_BYTES) });
    }));
  }

  private async readNotes(): Promise<readonly NoteDomainRow[]> {
    const notes = await this.readNoteRows();
    if (notes.length) {
      const pair = await this.pair();
      if (validatePair(pair) !== 'existing') throw failure();
      const identity = readWalletIdentity(await this.fingerprint(pair), pair.identity);
      inspectNoteDomain(notes, identity.walletBindingId, identity.root?.profileId);
    }
    return notes;
  }

  private async compareAndSetNotes(
    profileId: string,
    walletBindingId: string,
    expected: string | undefined,
    next: string,
    assertCurrent: () => void
  ): Promise<boolean> {
    if (typeof assertCurrent !== 'function' || typeof profileId !== 'string' || typeof walletBindingId !== 'string')
      throw new WalletStorageError('STORAGE_CHANGED');
    const check = storageGuard(assertCurrent);
    check();
    if (expected !== undefined && (typeof expected !== 'string' || expected.length > NOTE_DOMAIN_MAX_BYTES)) throw failure();
    inspectNoteDomain([{ profileId, walletBindingId, value: next }], walletBindingId, profileId);
    return this.queued(async () => {
      check();
      const committed = await this.transaction(async () => {
        check();
        const identity = await this.identityForProfile(profileId);
        check();
        if (identity.walletBindingId !== walletBindingId) throw new WalletStorageError('STORAGE_CHANGED');
        const rows = await this.readNoteRows();
        check();
        inspectNoteDomain(rows, walletBindingId, profileId);
        if (rows[0]?.value !== expected) return false;
        await this.db.runAsync(
          'INSERT INTO private_note_records (profile_id, wallet_binding, value) VALUES (?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET value = excluded.value',
          [profileId, walletBindingId, next]
        );
        return true;
      }, check).catch((error) => this.requireReopenIfPoisoned(error));
      if (committed) {
        try {
          const identity = await this.identityForProfile(profileId);
          const row = (await this.readNoteRows())[0];
          if (identity.walletBindingId !== walletBindingId || row?.profileId !== profileId ||
              row.walletBindingId !== walletBindingId || row.value !== next) throw failure();
        } catch (error) { this.poisoned = true; this.requireReopenIfPoisoned(error); }
      }
      check();
      return committed;
    });
  }

  /** One bounded SELECT gives a coherent SQLite snapshot without a write transaction. */
  private async captureSnapshot(): Promise<RecoveryStorageSnapshot> {
      const rows = await this.db.getAllAsync<PairRow>(SNAPSHOT, [ACCOUNT_RECORD_LIMITS.valueBytes, STORAGE_LIMITS.valueBytes, 1024, NOTE_DOMAIN_MAX_BYTES, EVM_SIGNED_RECORD_LIMITS.bytes]);
      if (rows.length > STORAGE_LIMITS.records + 7) throw failure();
      const records: { key: string; value: string }[] = [], metadata: { key: string; value: string }[] = [];
      const seen = new Set<string>(), pair: Pair = {};
      const notes: NoteDomainRow[] = [];
      const signedRecords: SignedRecordDomainRow[] = [];
      for (const row of rows) {
        if (!['record', 'meta', 'note', 'signed'].includes(row.source)) throw failure();
        validateStorageKey(row.key);
        const id = `${row.source}:${row.key}`;
        if (seen.has(id)) throw failure();
        seen.add(id);
        const enrollment = row.source === 'meta' && row.key === ENROLLMENT_KEY;
        const value = admittedRow(row, row.source === 'meta' ? 1024 : row.source === 'note' ? NOTE_DOMAIN_MAX_BYTES : row.source === 'signed' ? EVM_SIGNED_RECORD_LIMITS.bytes : recordBytes(row.key), enrollment ? 'hex' : 'text');
        if (row.source === 'note' || row.source === 'signed') {
          if (typeof row.wallet_binding !== 'string') throw failure();
          (row.source === 'note' ? notes : signedRecords).push(Object.freeze({ profileId: row.key, walletBindingId: row.wallet_binding, value })); continue;
        }
        // Include the schema-bounded enrollment bytes in the exact seal without parsing them.
        if (row.source === 'meta' && !['installation', 'backup', 'auth', 'identity', ENROLLMENT_KEY].includes(row.key)) throw failure();
        (row.source === 'record' ? records : metadata).push(Object.freeze({ key: row.key, value }));
        if (row.source === 'record' && row.key === 'vault') pair.vault = value;
        if (row.source === 'record' && row.key === 'vault-keys') pair.keys = value;
        if (row.source === 'meta' && row.key === 'backup') pair.backup = value;
        if (row.source === 'meta' && row.key === 'auth') pair.auth = value;
        if (row.source === 'meta' && row.key === 'identity') pair.identity = value;
      }
      if (records.length > STORAGE_LIMITS.records || metadata.length > 5 ||
          !metadata.some((row) => row.key === 'installation' && row.value === this.installationId)) throw failure();
      const state = await this.storedState(pair);
      const identity = state.presence === 'empty' ? null : readWalletIdentity(await this.fingerprint(pair), pair.identity);
      if (notes.length && !identity) throw failure();
      if (identity) inspectNoteDomain(notes, identity.walletBindingId, identity.root?.profileId);
      this.inspectSignedRows(signedRecords, identity);
      return Object.freeze({ identity, state, records: Object.freeze(records), metadata: Object.freeze(metadata), notes: Object.freeze(notes), signedRecords: Object.freeze(signedRecords) });
  }

  private readSnapshot(): Promise<RecoveryStorageSnapshot> {
    return this.queued(async () => {
      const snapshot = await this.captureSnapshot();
      this.recoverySnapshots.set(snapshot, this.writeGeneration);
      return snapshot;
    });
  }

  private async verifyRemovalScope(): Promise<void> {
    const snapshot = await this.captureSnapshot();
    if (snapshot.state.presence !== 'empty' || snapshot.metadata.length !== 1 ||
        snapshot.records.length || snapshot.notes.length || snapshot.signedRecords.length) throw failure();
  }

  private commitRemoval(before: RecoveryStorageSnapshot, guard: () => void): Promise<WalletRemovalResult> {
    const generation = this.recoverySnapshots.get(before);
    if (!generation || before.state.presence !== 'existing' || typeof guard !== 'function')
      return Promise.reject(new WalletStorageError('STORAGE_CHANGED'));
    this.recoverySnapshots.delete(before);
    const assertOwner = storageGuard(guard);
    const check = () => {
      if (this.closing) throw new WalletStorageError('STORAGE_CLOSED');
      assertOwner();
      if (this.closing) throw new WalletStorageError('STORAGE_CLOSED');
    };
    return this.queued(async () => {
      if (this.writeGeneration !== generation) throw new WalletStorageError('STORAGE_CHANGED');
      try {
        await this.transaction(async () => {
          check();
          const current = await this.captureSnapshot();
          check();
          if (!sameRecoverySnapshot(current, before)) throw new WalletStorageError('STORAGE_CHANGED');
          // Scrub cells in the new page images. Existing encrypted pages in WAL
          // or elsewhere are outside the logical removal acknowledgement.
          await this.db.execAsync('PRAGMA secure_delete = ON');
          const secureDelete = await this.db.getFirstAsync<{ secure_delete: number }>('PRAGMA secure_delete');
          if (secureDelete?.secure_delete !== 1) throw failure();
          for (const sql of [
            'DELETE FROM evm_signed_records',
            'DELETE FROM private_note_records',
            'DELETE FROM keyring_records',
            "DELETE FROM wallet_metadata WHERE key <> 'installation'",
          ]) {
            check();
            await this.db.runAsync(sql);
          }
          check();
          await this.verifyRemovalScope();
        }, check);
      } catch (error) {
        if (!this.poisoned) throw error;
        return Object.freeze({ status: 'reopen-required' });
      }

      // Do not run ordinary operations on this owner again, including writes
      // already queued while COMMIT was in flight.
      this.retired = true;
      try {
        await this.verifyRemovalScope();
      } catch {
        this.poisoned = true;
        return Object.freeze({ status: 'reopen-required' });
      }
      return Object.freeze({ status: 'wallet-records-removed' });
    });
  }

  private prepareReplacement(
    before: RecoveryStorageSnapshot,
    candidate: Readonly<{
      vault: unknown;
      keys: unknown;
      accountRecords?: unknown;
    }>,
    root: RecoveryRoot
  ): Promise<RecoveryWritePlan> {
    if (!this.recoverySnapshots.has(before)) return Promise.reject(new WalletStorageError('STORAGE_CHANGED'));
    this.recoverySnapshots.delete(before);
    const capturedCandidate = {
      vault: decodeStorageValue(encodeStorageValue(candidate.vault)),
      keys: decodeStorageValue(encodeStorageValue(candidate.keys)),
      accountRecords:
        candidate.accountRecords === undefined
          ? undefined
          : decodeAccountRecord(encodeAccountRecord(candidate.accountRecords)),
    };
    const capturedRoot = decodeStorageValue(
      encodeStorageValue(root)
    ) as RecoveryRoot;
    return this.queued(async () => {
      if (!before.identity || before.state.presence !== 'existing')
        throw failure();
      const pair: Pair = {
        vault: encodeStorageValue(capturedCandidate.vault),
        keys: encodeStorageValue(capturedCandidate.keys),
      };
      const accounts =
        capturedCandidate.accountRecords === undefined
          ? undefined
          : encodeAccountRecord(capturedCandidate.accountRecords);
      if (
        accounts !== undefined &&
        !before.records.some((row) => row.key === ACCOUNT_RECORD_KEY)
      )
        throw failure();
      const fingerprint = await this.fingerprint(pair);
      const identity = encodeStorageValue({
        version: 1,
        walletBindingId: before.identity.walletBindingId,
        pairFingerprint: fingerprint,
        root: capturedRoot,
      });
      const checkedIdentity = readWalletIdentity(fingerprint, identity);
      const auth = encodeStorageValue({ version: 1, failures: 0, lastAttempt: this.timestamp(), notBefore: 0 });
      const metadata = new Map(
        before.metadata.map((row) => [row.key, row.value])
      );
      metadata.delete(ENROLLMENT_KEY);
      metadata.set('identity', identity);
      metadata.set('auth', auth);
      if (before.state.backup === 'confirmed') metadata.set('backup', encodeStorageValue({ version: 1, fingerprint }));
      this.inspectSignedRows(before.signedRecords, checkedIdentity);
      const after: RecoveryStorageSnapshot = Object.freeze({
        identity: checkedIdentity,
        state: before.state,
        notes: before.notes,
        signedRecords: before.signedRecords,
        records: Object.freeze(
          before.records.map((row) =>
            Object.freeze({
              key: row.key,
              value:
                row.key === 'vault'
                  ? pair.vault!
                  : row.key === 'vault-keys'
                  ? pair.keys!
                  : row.key === ACCOUNT_RECORD_KEY && accounts !== undefined
                  ? accounts
                  : row.value,
            })
          )
        ),
        metadata: Object.freeze(
          [...metadata]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, value]) => Object.freeze({ key, value }))
        ),
      });
      const plan = Object.freeze({}) as RecoveryWritePlan;
      this.recoveryWrites.set(plan, { before, after });
      return plan;
    });
  }

  private prepareCreation(
    before: RecoveryStorageSnapshot,
    candidate: Readonly<{
      vault: unknown;
      keys: unknown;
      accountRecords: unknown;
    }>,
    root: RecoveryRoot
  ): Promise<RecoveryWritePlan> {
    if (!this.recoverySnapshots.has(before)) return Promise.reject(new WalletStorageError('STORAGE_CHANGED'));
    this.recoverySnapshots.delete(before);
    const capturedCandidate = {
      vault: decodeStorageValue(encodeStorageValue(candidate.vault)),
      keys: decodeStorageValue(encodeStorageValue(candidate.keys)),
      accountRecords:
        candidate.accountRecords === undefined
          ? undefined
          : decodeAccountRecord(encodeAccountRecord(candidate.accountRecords)),
    };
    const capturedRoot = decodeStorageValue(
      encodeStorageValue(root)
    ) as RecoveryRoot;
    return this.queued(async () => {
      if (
        before.identity ||
        before.state.presence !== 'empty' ||
        before.notes.length ||
        before.signedRecords.length ||
        before.metadata.some((row) => row.key !== 'installation' && row.key !== ENROLLMENT_KEY) ||
        before.records.some((row) => row.key !== 'utf8Error')
      )
        throw failure();
      for (const row of before.records) {
        const value = decodeStorageValue(row.value);
        if (
          !exact(value, ['hasUtf8Error']) ||
          typeof value.hasUtf8Error !== 'boolean'
        )
          throw failure();
      }
      const pair: Pair = {
        vault: encodeStorageValue(capturedCandidate.vault),
        keys: encodeStorageValue(capturedCandidate.keys),
      };
      const fingerprint = await this.fingerprint(pair);
      const accounts = encodeAccountRecord(capturedCandidate.accountRecords);
      const record = decodeAccountRecord(accounts) as {
        walletFingerprint?: unknown;
      };
      if (!record || record.walletFingerprint !== fingerprint) throw failure();
      const identity = encodeStorageValue({
        version: 1,
        walletBindingId: fingerprint,
        pairFingerprint: fingerprint,
        root: capturedRoot,
      });
      const checkedIdentity = readWalletIdentity(fingerprint, identity);
      const records = [
        ...before.records,
        { key: 'vault', value: pair.vault! },
        { key: 'vault-keys', value: pair.keys! },
        { key: ACCOUNT_RECORD_KEY, value: accounts },
      ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const metadata = [
        ...before.metadata.filter((row) => row.key !== ENROLLMENT_KEY),
        { key: 'identity', value: identity },
        {
          key: 'auth',
          value: encodeStorageValue({ version: 1, failures: 0, lastAttempt: this.timestamp(), notBefore: 0 }),
        },
      ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const after: RecoveryStorageSnapshot = Object.freeze({
        identity: checkedIdentity,
        state: Object.freeze({ presence: 'existing', backup: 'unconfirmed' }),
        records: Object.freeze(records.map((row) => Object.freeze(row))),
        metadata: Object.freeze(metadata.map((row) => Object.freeze(row))),
        notes: before.notes,
        signedRecords: before.signedRecords,
      });
      const plan = Object.freeze({}) as RecoveryWritePlan;
      this.recoveryWrites.set(plan, { before, after, creation: true });
      return plan;
    });
  }

  private commitReplacement(input: unknown, guard: () => void): Promise<void> {
    const plan = input as RecoveryWritePlan;
    const value = plan && typeof plan === 'object' ? this.recoveryWrites.get(plan) : undefined;
    if (!value || typeof guard !== 'function') return Promise.reject(new WalletStorageError('STORAGE_CHANGED'));
    this.recoveryWrites.delete(plan);
    const check = () => {
      const result: unknown = guard();
      if (result !== undefined) {
        if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
        throw new WalletStorageError('STORAGE_CHANGED');
      }
    };
    return this.queued(() =>
      this.transaction(async () => {
        check();
        const current = await this.captureSnapshot();
        check();
      if (!sameRecoverySnapshot(current, value.before)) throw new WalletStorageError('STORAGE_CHANGED');
        for (const row of value.after.records.filter(
          (row) =>
            row.key === 'vault' ||
            row.key === 'vault-keys' ||
            row.key === ACCOUNT_RECORD_KEY
        )) {
          if (value.creation)
            await this.db.runAsync(
              'INSERT INTO keyring_records (key, value) VALUES (?, ?)',
              [row.key, row.value]
            );
          else
        await this.db.runAsync('UPDATE keyring_records SET value = ? WHERE key = ?', [row.value, row.key]);
          check();
        }
      for (const row of value.after.metadata.filter((row) => ['identity', 'auth', 'backup'].includes(row.key))) {
        await this.db.runAsync('INSERT INTO wallet_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [row.key, row.value]); check();
      }
        if (current.metadata.some((row) => row.key === ENROLLMENT_KEY)) {
          await this.db.runAsync('DELETE FROM wallet_metadata WHERE key = ?', [ENROLLMENT_KEY]);
          if (await this.db.getFirstAsync('SELECT 1 FROM wallet_metadata WHERE key = ?', [ENROLLMENT_KEY])) throw failure();
          this.enrollmentRevision = {};
        }
        check();
      }, check)
    ).then(() => {
      this.authenticationWindow = null;
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

  private recordAuthentication(
    success: boolean,
    expectedFingerprint?: string
  ): Promise<void> {
    return this.queued(async () => {
      const committed = await this.transaction(async () => {
        const pair = await this.pair();
        if (validatePair(pair) !== 'existing') throw failure();
        if (
          expectedFingerprint !== undefined &&
          expectedFingerprint !== (await this.fingerprint(pair))
        )
          throw new WalletStorageError('STORAGE_CHANGED');
        const previous = this.authenticationRecord(pair.auth);
        this.requireAuthenticationAllowed(pair.auth, previous);
        const now = this.timestamp();
        const failures = success ? 0 : Math.min(64, previous.failures + 1);
        const delay =
          failures < 5
            ? 0
            : Math.min(300000, 30000 * 2 ** Math.min(4, failures - 5));
        const record: AuthRecord = { version: 1, failures, lastAttempt: now, notBefore: delay ? now + delay : 0 };
        const raw = encodeStorageValue(record);
        await this.db.runAsync(
          'INSERT INTO wallet_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ['auth', raw]
        );
        return { raw, record };
      }).catch((error) => this.requireReopenIfPoisoned(error));
      // Every acknowledged outcome is fresh, even if a saturated counter and
      // repeated wall timestamp serialize identically to the previous record.
      this.authenticationWindow = null;
      this.authenticationNotBefore(
        committed.raw,
        committed.record,
        this.monotonicTimestamp()
      );
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
