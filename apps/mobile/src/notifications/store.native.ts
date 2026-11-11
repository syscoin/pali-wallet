import { requireNativeModule } from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { activityNotificationScopeKey, decodeActivityNotificationBaseline } from '../../../../source/shared/activityNotifications.ts';
import { requireSqlCipher } from '../storage/sqlCipher.ts';
import { emptyNotificationDocument, NOTIFICATION_LIMITS } from './coordinator.ts';
import { normalizeNotificationScope, notificationFactScope } from './reader.ts';
import type { EnrolledScope, NotificationDocument, NotificationStore, StoredNotification } from './types.ts';

const KEY = 'pali-activity-notification-key-v1';
const OPTIONS: SecureStore.SecureStoreOptions = { keychainService: 'org.pali.mobile.activity-notifications',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, requireAuthentication: false };
const ID = /^pali-alert-[0-9a-f]{32}$/;
const KINDS = new Set(['transaction-pending', 'transaction-confirmed', 'transaction-failed', 'transaction-status-unknown',
  'recovery-started', 'recovery-cancelled', 'recovery-completed', 'recovery-expired', 'guardian-policy-changed']);
type Policy = { prepareNotificationStorage(create: boolean): Promise<{ directory: string; databaseExists: boolean }>;
  protectNotificationStorage(): Promise<void> };
const corrupt = (): never => { throw new Error('Alert storage is unavailable'); };
const parse = (value: string, max: number): any => {
  if (typeof value !== 'string' || value.length > max) return corrupt();
  try { return JSON.parse(value); } catch { return corrupt(); }
};
function decodeScope(value: unknown): EnrolledScope {
  if (!value || typeof value !== 'object') return corrupt();
  const raw = value as EnrolledScope;
  const scope = normalizeNotificationScope(raw.scope);
  if (!ID.test(raw.generation) || !Number.isSafeInteger(raw.enrolledAt) || raw.enrolledAt < 0) return corrupt();
  const baseline = raw.baseline === null ? null : decodeActivityNotificationBaseline(raw.baseline, notificationFactScope(scope));
  if (raw.baseline !== null && !baseline) return corrupt();
  return { scope, generation: raw.generation, enrolledAt: raw.enrolledAt, baseline };
}
function decodeEvent(value: unknown, scopes: EnrolledScope[]): StoredNotification {
  if (!value || typeof value !== 'object') return corrupt();
  const raw = value as StoredNotification;
  const enrolled = scopes.find((entry) => entry.scope.id === raw.scopeId && entry.generation === raw.generation);
  const fact = raw.fact;
  if (!enrolled || !ID.test(raw.id) || typeof raw.attempted !== 'boolean' || !Number.isSafeInteger(raw.createdAt) || raw.createdAt < 0 ||
      !fact || !KINDS.has(fact.kind) || !['pending-intent', 'confirmed-event', 'observed-state'].includes(fact.evidence) ||
      !['incoming', 'outgoing', 'self', 'unknown'].includes(fact.direction) ||
      typeof fact.key !== 'string' || fact.key.length > 4096 || !fact.key.startsWith(activityNotificationScopeKey(notificationFactScope(enrolled.scope)) + ':') ||
      activityNotificationScopeKey(fact.scope) !== activityNotificationScopeKey(notificationFactScope(enrolled.scope)) ||
      [fact.transactionHash, fact.blockHash, fact.operationId].some((hash) => hash !== undefined && (typeof hash !== 'string' || !/^(?:0x)?[0-9a-f]{64}$/.test(hash))) ||
      (fact.blockNumber !== undefined && (!Number.isSafeInteger(fact.blockNumber) || fact.blockNumber < 0))) return corrupt();
  return raw;
}

/** Separate encrypted public metadata database. Never opens the spending database. */
export function createNativeNotificationStore(): NotificationStore {
  let tail: Promise<unknown> = Promise.resolve();
  const queue = <T>(work: () => Promise<T>): Promise<T> => { const next = tail.then(work, work); tail = next.catch(() => undefined); return next; };
  async function open(create: boolean): Promise<SQLiteDatabase | null> {
    if (!(await SecureStore.isAvailableAsync())) return corrupt();
    const policy = requireNativeModule<Policy>('PaliWalletStorage');
    let location = await policy.prepareNotificationStorage(false);
    let key = await SecureStore.getItemAsync(KEY, OPTIONS);
    if (key === null) {
      if (location.databaseExists) return corrupt();
      if (!create) return null;
      key = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      await SecureStore.setItemAsync(KEY, key, OPTIONS);
    }
    if (!/^[0-9a-f]{64}$/.test(key)) return corrupt();
    if (!location.databaseExists && !create) return null;
    if (!location.databaseExists) location = await policy.prepareNotificationStorage(true);
    const db = await openDatabaseAsync('activity-notifications.sqlite', { useNewConnection: true }, location.directory);
    try {
      await requireSqlCipher(db, key);
      if (!location.databaseExists) await db.execAsync('BEGIN IMMEDIATE; CREATE TABLE notification_scopes (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); CREATE TABLE notification_events (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); CREATE TABLE notification_metadata (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, cursor INTEGER NOT NULL); INSERT INTO notification_metadata(id, version, cursor) VALUES(1, 1, 0); COMMIT;');
      await policy.protectNotificationStorage();
      return db;
    } catch (error) { await db.closeAsync(); throw error; }
  }
  return {
    initialize: () => queue(async () => { const db = await open(true); await db?.closeAsync(); }),
    transact: <T>(action: (document: NotificationDocument) => Promise<T> | T, assertCurrent: () => void) => queue(async () => {
      assertCurrent();
      const db = await open(false);
      if (!db) return action(emptyNotificationDocument());
      let began = false;
      try {
        await db.execAsync('BEGIN IMMEDIATE'); began = true;
        const [scopeRows, eventRows, metadata] = await Promise.all([
          db.getAllAsync<{ id: string; value: string }>('SELECT id, value FROM notification_scopes LIMIT 65'),
          db.getAllAsync<{ id: string; value: string }>('SELECT id, value FROM notification_events LIMIT 129'),
          db.getFirstAsync<{ version: number; cursor: number }>('SELECT version, cursor FROM notification_metadata WHERE id = 1'),
        ]);
        if (scopeRows.length > NOTIFICATION_LIMITS.scopes || eventRows.length > NOTIFICATION_LIMITS.events || metadata?.version !== 1 || !Number.isSafeInteger(metadata.cursor) || metadata.cursor < 0) return corrupt();
        const scopes = scopeRows.map((row) => { const value = decodeScope(parse(row.value, 250000)); if (value.scope.id !== row.id) return corrupt(); return value; });
        const events = eventRows.map((row) => { const value = decodeEvent(parse(row.value, 12000), scopes); if (value.id !== row.id) return corrupt(); return value; });
        const document = { scopes, events, cursor: metadata.cursor };
        const result = await action(document);
        if (document.scopes.length > NOTIFICATION_LIMITS.scopes || document.events.length > NOTIFICATION_LIMITS.events) return corrupt();
        for (const row of scopeRows) if (!document.scopes.some((entry) => entry.scope.id === row.id)) await db.runAsync('DELETE FROM notification_scopes WHERE id = ?', row.id);
        for (const row of eventRows) if (!document.events.some((entry) => entry.id === row.id)) await db.runAsync('DELETE FROM notification_events WHERE id = ?', row.id);
        for (const entry of document.scopes) {
          if (entry.baseline) entry.baseline = { ...entry.baseline, transactions: entry.baseline.transactions.slice(0, 128), deliveredKeys: entry.baseline.deliveredKeys.slice(-256) };
          const value = JSON.stringify(entry); if (value.length > 250000) return corrupt();
          await db.runAsync('INSERT OR REPLACE INTO notification_scopes(id, value) VALUES (?, ?)', entry.scope.id, value);
        }
        for (const entry of document.events) await db.runAsync('INSERT OR REPLACE INTO notification_events(id, value) VALUES (?, ?)', entry.id, JSON.stringify(entry));
        await db.runAsync('UPDATE notification_metadata SET cursor = ? WHERE id = 1', document.cursor);
        assertCurrent();
        await db.execAsync('COMMIT'); began = false;
        await requireNativeModule<Policy>('PaliWalletStorage').protectNotificationStorage();
        return result;
      } finally {
        if (began) await db.execAsync('ROLLBACK');
        await db.closeAsync();
      }
    }),
  };
}
