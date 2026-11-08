import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { SigningKey } from 'ethers/crypto';
import { Wallet } from 'ethers/wallet';
import {
  PRIVATE_VAULT_DOMAIN,
  PRIVATE_VAULT_FORMAT,
  PRIVATE_VAULT_SHARD_DOMAIN,
} from '../../../source/wallet/privateVaultEnvelope.ts';
import { openNativeConnectionRepository, NATIVE_CONNECTION_STORAGE_KEY } from '../src/connections/storage.ts';
import { ACCOUNT_RECORD_KEY } from '../src/storage/accountRecordKey.ts';
import { openWalletStorage, type NativeStoragePorts } from '../src/storage/coordinator.ts';
import { WalletStorageError } from '../src/storage/types.ts';
import { digest, INSTALLATION, nodeConnection, validPair, type SqlHook } from './storageHelpers.ts';

const PROFILE = `0x${'a'.repeat(64)}`;
const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const ROOT = { address: wallet.address, publicKey: SigningKey.computePublicKey(wallet.privateKey, true), profileId: PROFILE };
const HASH = `0x${'b'.repeat(64)}`;
const current = () => undefined;
const envelope = (domain: string, recordId: string) => ({
  version: 1, profileId: PROFILE, domain, recordId, nonce: 'A'.repeat(16), ciphertext: 'A'.repeat(24),
});
// Structurally valid ciphertext fixtures. These tests exercise SQLite ownership
// and crash recovery, independently of the SDK's AEAD validation.
const NOTES = JSON.stringify({
  format: PRIVATE_VAULT_FORMAT,
  version: 1,
  root: envelope(PRIVATE_VAULT_DOMAIN, '11111111-1111-4111-8111-111111111111'),
  shards: [envelope(PRIVATE_VAULT_SHARD_DOMAIN, '22222222-2222-4222-8222-222222222222')],
});
const SIGNED = JSON.stringify({
  version: 1, profileId: PROFILE, revision: 0,
  root: envelope('org.syscoin.pali.evm.signed.root.v1', 'manifest'),
  entries: [{ hash: HASH, chainId: '1', from: wallet.address.toLowerCase(), nonce: 0,
    phase: 'attempted', createdAt: 1, signer: { id: 0, type: 'HDAccount' }, operation: 'send',
    chunks: [envelope('org.syscoin.pali.evm.signed.chunk.v1', `${HASH}/0`)],
  }],
});
const EMPTY = {
  identity: null,
  state: { presence: 'empty', backup: 'unconfirmed' },
  records: [], metadata: [{ key: 'installation', value: INSTALLATION }],
  notes: [], signedRecords: [],
};

function pause() {
  let enter!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => { enter = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { reached, release, async hold() { enter(); await wait; } };
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-wallet-removal-'));
  const file = path.join(directory, 'wallet.sqlite');
  let exists = false, held = false, key: string | null = null;
  let before: SqlHook | undefined, after: SqlHook | undefined;
  let skipDelete = false;
  const statements: string[] = [];
  const ports: NativeStoragePorts = {
    digest,
    randomBytes: (size) => new Uint8Array(size).fill(0xa1),
    policy: {
      async acquire() {
        assert.equal(held, false);
        held = true;
        return { token: 'fixture-lease', directory, databaseExists: exists };
      },
      async inspect() { assert.equal(held, true); return { databaseExists: exists }; },
      async createDatabase() { await writeFile(file, '', { flag: 'wx' }); exists = true; },
      async protect() { assert.equal(held, true); },
      async release() { assert.equal(held, true); held = false; },
    },
    keyStore: { async get() { return key; }, async set(next) { key = next; } },
    async openDatabase() {
      const { connection } = nodeConnection(file, {
        async before(kind, sql) { statements.push(sql); await before?.(kind, sql); },
        after: (...args) => after?.(...args),
      });
      const run = connection.runAsync;
      connection.runAsync = (sql, parameters) =>
        skipDelete && sql === 'DELETE FROM evm_signed_records' ? Promise.resolve() : run(sql, parameters);
      return connection;
    },
  };
  let storage = await openWalletStorage(ports);
  await storage.keyringStorage.createManyIfAbsent(validPair());
  await storage.keyringStorage.set(ACCOUNT_RECORD_KEY, { accounts: ['fixture imported key record'] });
  await storage.keyringStorage.set('native-token-registry-v1', { tokens: ['fixture'] });
  await storage.keyringStorage.set('native-activity-v1', { activity: ['fixture'] });
  const pair = await storage.getWalletFingerprint();
  await storage.recovery!.bindIdentity(pair, ROOT, current);
  const connections = await openNativeConnectionRepository({ storage: storage.keyringStorage, walletBindingId: pair, assertOwner: current });
  await connections.transport.setItem('test-protocol-keychain', { key: 'test-only-session-secret' });
  await connections.dispose();
  await storage.confirmBackup(pair);
  await storage.authGuard.recordFailure();
  await storage.notes!.compareAndSet(PROFILE, pair, undefined, NOTES, current);
  await storage.signedRecords.compareAndSet(PROFILE, undefined, SIGNED, current);
  return {
    file, statements, ports,
    get storage() { return storage; }, get key() { return key; }, get held() { return held; },
    before(hook?: SqlHook) { before = hook; }, after(hook?: SqlHook) { after = hook; },
    skipSignedDelete() { skipDelete = true; },
    async reopen() { await storage.close(); before = after = undefined; storage = await openWalletStorage(ports); },
    async dispose() { try { await storage.close(); } finally { await rm(directory, { recursive: true, force: true }); } },
  };
}

test('explicit removal verifies the complete wallet seal and retires the writer, retaining the installation key', async () => {
  const f = await fixture();
  try {
    const installationKey = f.key;
    const before = await f.storage.recovery!.readSnapshot();
    assert.deepEqual(before.metadata.map(({ key }) => key), ['auth', 'backup', 'identity', 'installation']);
    assert.equal(before.notes[0]?.value, NOTES);
    assert.equal(before.signedRecords[0]?.value, SIGNED);
    assert.equal(before.records.length, 6);
    assert.equal(before.records.some(({ key }) => key === NATIVE_CONNECTION_STORAGE_KEY), true);

    const old = f.storage;
    const committed = pause();
    f.after((kind, sql) => { if (kind === 'exec' && sql === 'COMMIT') return committed.hold(); });
    let authorized = true;
    const result = old.removal!.commit(before, () => {
      if (!authorized) throw new WalletStorageError('STORAGE_CHANGED');
    });
    try {
      await committed.reached;
      authorized = false; // Already dispatched, so the durable fact still needs readback.
      const lateWrite = assert.rejects(old.keyringStorage.set('vault', validPair(2).vault), { code: 'STORAGE_CLOSED' });
      await assert.rejects(openWalletStorage(f.ports), { code: 'STORAGE_UNAVAILABLE' });
      committed.release();
      assert.deepEqual(await result, { status: 'wallet-records-removed' });
      await lateWrite;
    } finally { committed.release(); }
    await assert.rejects(old.readState(), { code: 'STORAGE_CLOSED' });
    assert.equal(f.held, true);
    await f.reopen();
    assert.equal(f.key, installationKey);
    assert.deepEqual(await f.storage.recovery!.readSnapshot(), EMPTY);
    assert.equal(await f.storage.keyringStorage.createManyIfAbsent(validPair(2)), true);
  } finally { await f.dispose(); }
});

test('removal rejects forged, stale, reused, and foreign snapshots and a non-synchronous guard', async () => {
  const f = await fixture();
  try {
    const before = await f.storage.recovery!.readSnapshot();
    const changed = { code: 'STORAGE_CHANGED' };
    await assert.rejects(f.storage.removal!.commit({ ...before }, current), changed);
    await f.storage.keyringStorage.set('native-activity-v1', { activity: [] });
    await f.storage.keyringStorage.set('native-activity-v1', { activity: ['fixture'] });
    const sameBytes = await f.storage.recovery!.readSnapshot();
    assert.deepEqual(sameBytes, before);
    const start = f.statements.length;
    await assert.rejects(f.storage.removal!.commit(before, current), changed);
    await assert.rejects(f.storage.removal!.commit(sameBytes, async () => undefined), changed);
    await assert.rejects(f.storage.removal!.commit(sameBytes, current), changed);
    const foreign = await f.storage.recovery!.readSnapshot();
    await f.reopen();
    await assert.rejects(f.storage.removal!.commit(foreign, current), changed);
    assert.deepEqual(await f.storage.recovery!.readSnapshot(), before);
    assert.equal(f.statements.slice(start).some((sql) => sql.startsWith('DELETE FROM')), false);
  } finally { await f.dispose(); }
});

test('the write transaction rejects an exact signed-record byte change even when the owner generation has not moved', async () => {
  const f = await fixture();
  try {
    const before = await f.storage.recovery!.readSnapshot();
    const changed = JSON.stringify({ ...JSON.parse(SIGNED), revision: 1 });
    // A second SQLite connection is a fault control outside the native lease.
    const external = nodeConnection(f.file).connection;
    try { await external.runAsync('UPDATE evm_signed_records SET value = ?', [changed]); }
    finally { await external.closeAsync(); }

    const start = f.statements.length;
    await assert.rejects(f.storage.removal!.commit(before, current), { code: 'STORAGE_CHANGED' });
    assert.equal(f.statements.slice(start).some((sql) => sql.startsWith('DELETE FROM')), false);
    const after = await f.storage.recovery!.readSnapshot();
    assert.deepEqual(after, { ...before, signedRecords: [{ ...before.signedRecords[0], value: changed }] });
  } finally { await f.dispose(); }
});

for (const stop of ['guard', 'owner-close'] as const) {
  test(`removal rolls back every wallet row when ${stop} retires before COMMIT`, async () => {
    const f = await fixture();
    const gate = pause();
    try {
      const before = await f.storage.recovery!.readSnapshot();
      f.after((kind, sql) => { if (kind === 'run' && sql === 'DELETE FROM evm_signed_records') return gate.hold(); });
      let authorized = true;
      const pending = assert.rejects(f.storage.removal!.commit(before, () => {
        if (!authorized) throw new WalletStorageError('STORAGE_CHANGED');
      }), { code: stop === 'guard' ? 'STORAGE_CHANGED' : 'STORAGE_CLOSED' });
      await gate.reached;
      const closed = stop === 'owner-close' ? f.storage.close() : undefined;
      authorized = false;
      gate.release();
      await pending;
      await closed;
      await f.reopen();
      assert.deepEqual(await f.storage.recovery!.readSnapshot(), before);
    } finally { gate.release(); await f.dispose(); }
  });
}

test('a false successful DELETE cannot commit a partially empty wallet', async () => {
  const f = await fixture();
  try {
    const before = await f.storage.recovery!.readSnapshot();
    f.skipSignedDelete();
    await assert.rejects(f.storage.removal!.commit(before, current), { code: 'STORAGE_CORRUPT' });
    await f.reopen();
    assert.deepEqual(await f.storage.recovery!.readSnapshot(), before);
  } finally { await f.dispose(); }
});

for (const fault of ['before-commit', 'after-commit', 'post-commit-read'] as const) {
  test(`removal reports reopen-required and never retries after ${fault} failure`, async () => {
    const f = await fixture();
    try {
      const before = await f.storage.recovery!.readSnapshot();
      const start = f.statements.length;
      let committed = false;
      f.before((kind, sql) => {
        if (kind === 'exec' && sql === 'COMMIT' && fault === 'before-commit') throw Error('Lost COMMIT dispatch');
        if (kind === 'all' && committed && fault === 'post-commit-read') throw Error('Lost readback');
      });
      f.after((kind, sql) => {
        if (kind === 'exec' && sql === 'COMMIT') {
          committed = true;
          if (fault === 'after-commit') throw Error('Lost COMMIT acknowledgement');
        }
      });
      assert.deepEqual(await f.storage.removal!.commit(before, current), { status: 'reopen-required' });
      await assert.rejects(f.storage.readState(), { code: 'STORAGE_REOPEN_REQUIRED' });
      await assert.rejects(f.storage.keyringStorage.set('native-activity-v1', {}), { code: 'STORAGE_REOPEN_REQUIRED' });
      await assert.rejects(f.storage.removal!.commit(before, current), { code: 'STORAGE_CHANGED' });
      assert.equal(f.statements.slice(start).filter((sql) => sql === 'COMMIT').length, 1);
      await f.reopen();
      assert.deepEqual(await f.storage.recovery!.readSnapshot(), fault === 'before-commit' ? before : EMPTY);
    } finally { await f.dispose(); }
  });
}

for (const boundary of ['first-delete', 'commit'] as const) {
  test(`real SQLite recovers the exact wallet scope after process death at ${boundary}`, async () => {
    const f = await fixture();
    try {
      const before = await f.storage.recovery!.readSnapshot();
      await f.storage.close();
      const child = spawnSync(process.execPath, [
        '--import', './scripts/register-shared-test-dependencies.mjs', '--input-type=module', '--eval', `
          import { SqliteWalletStorage } from './src/storage/sqlite.ts';
          import { digest, INSTALLATION, nodeConnection } from './tests/storageHelpers.ts';
          const [file, boundary] = process.argv.slice(1);
          const owned = nodeConnection(file, { after(kind, sql) {
            if ((boundary === 'first-delete' && kind === 'run' && sql === 'DELETE FROM evm_signed_records') ||
                (boundary === 'commit' && kind === 'exec' && sql === 'COMMIT')) process.kill(process.pid, 'SIGKILL');
          } });
          const storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false);
          await storage.removal.commit(await storage.recovery.readSnapshot(), () => undefined);
        `, f.file, boundary,
      ], { cwd: fileURLToPath(new URL('../', import.meta.url)), timeout: 5_000, encoding: 'utf8' });
      assert.equal(child.signal, 'SIGKILL', child.error?.message ?? child.stderr);
      await f.reopen();
      assert.deepEqual(await f.storage.recovery!.readSnapshot(), boundary === 'commit' ? EMPTY : before);
    } finally { await f.dispose(); }
  });
}
