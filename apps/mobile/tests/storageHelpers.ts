import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type { SqlConnection } from '../src/storage/types.ts';
export const INSTALLATION = 'a1'.repeat(16);
export const validPair = (index = 1) => ({
  vault: JSON.stringify({
    v: 4,
    alg: 'A256GCM',
    iv: 'a1'.repeat(12),
    ct: index.toString(16).padStart(32, '0'),
  }),
  'vault-keys': { salt: index.toString(16).padStart(32, '0') },
});
export const digest = async (bytes: Uint8Array) =>
  new Uint8Array(createHash('sha256').update(bytes).digest());
export type SqlHook = (
  kind: 'exec' | 'run' | 'get' | 'all',
  sql: string
) => void | Promise<void>;

/** Plain SQLite is strictly a Node test fixture, never a native fallback. */
export function nodeConnection(
  file: string,
  hooks: { before?: SqlHook; after?: SqlHook } = {},
  timeoutMs = 2000
) {
  const database = new DatabaseSync(file);
  database.exec(
    `PRAGMA busy_timeout = ${Math.trunc(
      timeoutMs
    )}; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL`
  );
  const connection: SqlConnection = {
    async execAsync(sql) {
      await hooks.before?.('exec', sql);
      database.exec(sql);
      await hooks.after?.('exec', sql);
    },
    async runAsync(sql, params = []) {
      await hooks.before?.('run', sql);
      const result = database.prepare(sql).run(...params);
      await hooks.after?.('run', sql);
      return result;
    },
    async getFirstAsync<T>(
      sql: string,
      params: readonly (string | number | null)[] = []
    ) {
      await hooks.before?.('get', sql);
      const result = database.prepare(sql).get(...params) as T | undefined;
      await hooks.after?.('get', sql);
      return result ?? null;
    },
    async getAllAsync<T>(
      sql: string,
      params: readonly (string | number | null)[] = []
    ) {
      await hooks.before?.('all', sql);
      const result = database.prepare(sql).all(...params) as T[];
      await hooks.after?.('all', sql);
      return result;
    },
    async closeAsync() {
      database.close();
    },
  };
  return { database, connection };
}
