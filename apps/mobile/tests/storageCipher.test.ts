import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { requireSqlCipher } from '../src/storage/sqlCipher.ts';
import type { SqlConnection } from '../src/storage/types.ts';
import { nodeConnection } from './storageHelpers.ts';
import { createStorageQualificationDiagnostic } from '../qualification/storage-diagnostics.ts';

test('a real plain SQLite build is rejected before a database key is submitted', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-no-plain-sqlite-'));
  const statements: string[] = [];
  const owned = nodeConnection(path.join(directory, 'wallet.sqlite'), {
    before: (_kind, sql) => {
      statements.push(sql);
    },
  });
  const diagnostic = createStorageQualificationDiagnostic();
  try {
    await assert.rejects(
      requireSqlCipher(owned.connection, 'ab'.repeat(32), diagnostic.observe),
      (error) => {
        diagnostic.capture(error);
        return error instanceof Error && error.message === 'STORAGE_UNAVAILABLE';
      }
    );
    assert.deepEqual(statements, ['PRAGMA cipher_version']);
    assert.deepEqual(diagnostic.report(), {
      stage: 'sqlcipher-version',
      code: 'STORAGE_UNAVAILABLE',
    });
  } finally {
    await owned.connection.closeAsync();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SQLCipher qualification checks actual connection settings, including textual memory-security result', async () => {
  for (const bad of ['', 'journal', 'sync', 'temp', 'cipherMemory']) {
    const statements: string[] = [];
    const readbacks: string[] = [];
    const diagnostic = createStorageQualificationDiagnostic();
    const connection: SqlConnection = {
      async execAsync(sql) {
        statements.push(sql);
      },
      async runAsync() {},
      async getAllAsync() {
        return [];
      },
      async getFirstAsync<T>(sql: string) {
        readbacks.push(sql);
        const result: Record<string, unknown> =
          sql === 'PRAGMA cipher_version'
            ? { cipher_version: '4.10.0' }
            : sql === 'PRAGMA journal_mode'
            ? { journal_mode: bad === 'journal' ? 'delete' : 'wal' }
            : sql === 'PRAGMA synchronous'
            ? { synchronous: bad === 'sync' ? 1 : 2 }
            : sql === 'PRAGMA temp_store'
            ? { temp_store: bad === 'temp' ? 1 : 2 }
            : { cipher_memory_security: bad === 'cipherMemory' ? '0' : '1' };
        return result as T;
      },
      async closeAsync() {},
    };
    if (bad) {
      await assert.rejects(
        requireSqlCipher(connection, 'ab'.repeat(32), diagnostic.observe),
        (error) => {
          diagnostic.capture(error);
          return error instanceof Error && error.message === 'STORAGE_UNAVAILABLE';
        }
      );
      const expectedStages = {
        journal: 'sqlcipher-journal-readback',
        sync: 'sqlcipher-synchronous-readback',
        temp: 'sqlcipher-temp-readback',
        cipherMemory: 'sqlcipher-memory-readback',
      };
      assert.equal(diagnostic.report().stage, expectedStages[bad as keyof typeof expectedStages]);
    } else await requireSqlCipher(connection, 'ab'.repeat(32), diagnostic.observe);
    assert.deepEqual(readbacks, [
      'PRAGMA cipher_version',
      'PRAGMA journal_mode',
      'PRAGMA synchronous',
      'PRAGMA temp_store',
      'PRAGMA cipher_memory_security',
    ]);
    assert.equal(statements[0], `PRAGMA key = "x'${'ab'.repeat(32)}'"`);
    assert.ok(
      statements.indexOf('PRAGMA busy_timeout = 2000') <
        statements.indexOf('PRAGMA journal_mode = WAL')
    );
  }
});
