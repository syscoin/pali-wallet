import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { ACCOUNT_RECORD_KEY } from '../src/storage/accountRecordKey.ts';
import { digest, INSTALLATION, nodeConnection, validPair } from './storageHelpers.ts';

// Exact keyring_records definition emitted by the previous f1316 native build.
const LEGACY_TABLE = `CREATE TABLE keyring_records (key TEXT PRIMARY KEY NOT NULL CHECK(typeof(key) = 'text' AND length(CAST(key AS BLOB)) BETWEEN 1 AND 256), value TEXT NOT NULL CHECK(typeof(value) = 'text' AND length(CAST(value AS BLOB)) <= CASE WHEN key = 'native-wallet-catalogue-v1' THEN 4194304 ELSE 65536 END))`;

for (const mode of ['current', 'legacy', 'rollback', 'lost-commit-ack', 'corrupt', 'unknown-schema'] as const) {
  test(`native schema update: ${mode}`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pali-schema-upgrade-'));
    try {
      const file = path.join(dir, 'wallet.sqlite');
      const initial = nodeConnection(file);
      const storage = await SqliteWalletStorage.open(initial.connection, digest, INSTALLATION, true);
      assert.equal(await storage.keyringStorage.createManyIfAbsent(validPair()), true);
      await storage.keyringStorage.set(ACCOUNT_RECORD_KEY, { synthetic: 'x'.repeat(70000) });
      const fingerprint = await storage.getWalletFingerprint();
      await storage.confirmBackup(fingerprint);
      await storage.close();
      if (mode !== 'current') {
        const legacy = nodeConnection(file);
        legacy.database.exec(`BEGIN IMMEDIATE; ALTER TABLE keyring_records RENAME TO old_records; ${LEGACY_TABLE}; INSERT INTO keyring_records (key, value) SELECT key, value FROM old_records; DROP TABLE old_records; COMMIT`);
        if (mode === 'unknown-schema') legacy.database.exec('ALTER TABLE keyring_records ADD COLUMN extra TEXT');
        if (mode === 'corrupt') legacy.database.prepare("UPDATE keyring_records SET value='invalid' WHERE key='vault'").run();
        await legacy.connection.closeAsync();
      }
      const before = nodeConnection(file);
      const snapshot = ['keyring_records', 'wallet_metadata', 'private_note_records', 'evm_signed_records'].map((table) => before.database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
      const beforeSchema = (before.database.prepare("SELECT sql FROM sqlite_master WHERE name = 'keyring_records'").get() as { sql: string }).sql;
      await before.connection.closeAsync();
      let fired = false;
      const attempt = nodeConnection(file, {
        before(kind, sql) {
          if (mode === 'rollback' && kind === 'exec' && sql.startsWith('INSERT INTO keyring_records (key, value) SELECT')) {
            fired = true; throw new Error('injected copy failure');
          }
        },
        after(kind, sql) {
          if (mode === 'lost-commit-ack' && kind === 'exec' && sql === 'COMMIT') {
            fired = true; throw new Error('injected lost commit acknowledgement');
          }
        },
      });
      if (mode === 'rollback' || mode === 'lost-commit-ack' || mode === 'corrupt' || mode === 'unknown-schema') {
        await assert.rejects(SqliteWalletStorage.open(attempt.connection, digest, INSTALLATION, false));
        if (mode === 'rollback' || mode === 'lost-commit-ack') assert.equal(fired, true);
        await attempt.connection.closeAsync();
        const inspected = nodeConnection(file);
        const row = inspected.database.prepare("SELECT sql FROM sqlite_master WHERE name = 'keyring_records'").get() as { sql: string };
        assert.deepEqual(['keyring_records', 'wallet_metadata', 'private_note_records', 'evm_signed_records'].map((table) => inspected.database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()), snapshot);
        if (mode !== 'lost-commit-ack') assert.equal(row.sql, beforeSchema);
        else assert.notEqual(row.sql, LEGACY_TABLE);
        await inspected.connection.closeAsync();
        if (mode === 'corrupt' || mode === 'unknown-schema') return;
      } else {
        const opened = await SqliteWalletStorage.open(attempt.connection, digest, INSTALLATION, false);
        assert.equal(await opened.getWalletFingerprint(), fingerprint);
        assert.deepEqual(await opened.readState(), { presence: 'existing', backup: 'confirmed' });
        await opened.close();
      }
      const final = nodeConnection(file);
      const reopened = await SqliteWalletStorage.open(final.connection, digest, INSTALLATION, false);
      assert.equal(await reopened.getWalletFingerprint(), fingerprint);
      assert.deepEqual(await reopened.readState(), { presence: 'existing', backup: 'confirmed' });
      assert.deepEqual(['keyring_records', 'wallet_metadata', 'private_note_records', 'evm_signed_records'].map((table) => final.database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()), snapshot);
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
