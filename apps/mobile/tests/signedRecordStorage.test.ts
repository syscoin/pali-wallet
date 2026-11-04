import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers/wallet';
import { SigningKey } from 'ethers/crypto';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { sameRecoverySnapshot } from '../src/storage/recoverySnapshot.ts';
import { digest, INSTALLATION, nodeConnection, validPair, type SqlHook } from './storageHelpers.ts';
import { EVM_SIGNED_RECORD_LIMITS, inspectEvmSignedBundle } from '../../../source/wallet/evmSignedRecords.ts';

const PROFILE = `0x${'a'.repeat(64)}`;
const HASH = `0x${'b'.repeat(64)}`;
const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const ROOT = { address: wallet.address, publicKey: SigningKey.computePublicKey(wallet.privateKey, true).toLowerCase(), profileId: PROFILE };
const envelope = (domain: string, recordId: string, bytes = 24) => ({ version: 1, profileId: PROFILE, domain, recordId, nonce: 'A'.repeat(16), ciphertext: 'A'.repeat(bytes) });
// Ciphertext is deliberately synthetic: these controls qualify physical storage,
// while the common codec/SDK tests own AEAD and signed-transaction validation.
function bundle(revision = 0, targetBytes?: number): string {
  const value = { version: 1, profileId: PROFILE, revision,
    root: envelope('org.syscoin.pali.evm.signed.root.v1', 'manifest'), entries: [{ hash: HASH, chainId: '1', from: wallet.address.toLowerCase(), nonce: 0,
      phase: 'signed', createdAt: 0, signer: { id: 0, type: 'HDAccount' }, operation: 'send', metadata: { padding: '' },
      chunks: [envelope('org.syscoin.pali.evm.signed.chunk.v1', `${HASH}/0`)] }] };
  if (targetBytes) {
    const entry = value.entries[0]!;
    while (JSON.stringify(value).length + 66000 < targetBytes) entry.chunks.push(envelope('org.syscoin.pali.evm.signed.chunk.v1', `${HASH}/${entry.chunks.length}`, 65536));
    if (targetBytes - JSON.stringify(value).length > 1000) entry.chunks.push(envelope('org.syscoin.pali.evm.signed.chunk.v1', `${HASH}/${entry.chunks.length}`));
    const last = entry.chunks.at(-1)!;
    const extra = targetBytes - JSON.stringify(value).length;
    last.ciphertext += 'A'.repeat(Math.floor(extra / 4) * 4);
    entry.metadata.padding = 'x'.repeat(targetBytes - JSON.stringify(value).length);
  }
  const raw = JSON.stringify(value); inspectEvmSignedBundle(raw, PROFILE); return raw;
}
function latch() { let release!: () => void, entered!: () => void; return { wait: new Promise<void>((r) => { release = r; }), reached: new Promise<void>((r) => { entered = r; }), release: () => release(), enter: () => entered() }; }
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-signed-storage-')), file = path.join(directory, 'wallet.sqlite');
  let hook: SqlHook | undefined, after: SqlHook | undefined;
  let owned = nodeConnection(file, { before: (...args) => hook?.(...args), after: (...args) => after?.(...args) });
  const observed: { value?: unknown }[] = [];
  const read = owned.connection.getAllAsync.bind(owned.connection);
  owned.connection.getAllAsync = async <T>(sql: string, parameters?: readonly (string | number | null)[]) => {
    const rows = await read<T>(sql, parameters);
    if (sql.includes('FROM evm_signed_records')) observed.push(...rows as { value?: unknown }[]);
    return rows;
  };
  let storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, true);
  await storage.keyringStorage.createManyIfAbsent(validPair());
  const fingerprint = await storage.getWalletFingerprint();
  return { directory, file, fingerprint, observed, get storage() { return storage; }, get db() { return owned.database; },
    setHook(value?: SqlHook) { hook = value; }, setAfter(value?: SqlHook) { after = value; },
    bind: () => storage.recovery.bindIdentity(fingerprint, ROOT, () => undefined),
    async reopen() { await storage.close().catch(() => undefined); owned = nodeConnection(file); storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false); },
    async close() { await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); } };
}

test('authenticated identity binding preserves wallet, backup and throttle bytes and refuses a different root', async () => {
  const f = await fixture(); try {
    await f.storage.confirmBackup(f.fingerprint);
    const before = await f.storage.recovery.readSnapshot();
    await assert.rejects(f.storage.signedRecords.read(PROFILE), { code: 'STORAGE_CHANGED' });
    await assert.rejects(f.storage.recovery.bindIdentity('f'.repeat(64), ROOT, () => undefined), { code: 'STORAGE_CHANGED' });
    await f.bind(); await f.bind();
    const after = await f.storage.recovery.readSnapshot();
    assert.deepEqual(after.records, before.records);
    assert.deepEqual(after.metadata.filter((r) => r.key !== 'identity'), before.metadata);
    assert.equal(after.identity?.walletBindingId, f.fingerprint);
    assert.deepEqual(after.identity?.root, ROOT);
    await assert.rejects(f.storage.recovery.bindIdentity(f.fingerprint, { ...ROOT, profileId: `0x${'c'.repeat(64)}` }, () => undefined), { code: 'STORAGE_CHANGED' });
    assert.deepEqual(await f.storage.recovery.readSnapshot(), after);
  } finally { await f.close(); }
});

test('profile-bound exact-byte CAS persists acknowledged records, rejects stale expectations and retains the normal64KiB bound', async () => {
  const f = await fixture(); try {
    await f.bind(); const first = bundle(), next = bundle(1);
    assert.equal(await f.storage.signedRecords.read(PROFILE), undefined);
    assert.equal(await f.storage.signedRecords.compareAndSet(PROFILE, undefined, first, () => undefined), true);
    assert.equal(await f.storage.signedRecords.compareAndSet(PROFILE, undefined, next, () => undefined), false);
    assert.equal(await f.storage.signedRecords.read(PROFILE), first);
    assert.equal(await f.storage.signedRecords.compareAndSet(PROFILE, first, next, () => undefined), true);
    const snapshot = await f.storage.recovery.readSnapshot();
    assert.deepEqual(snapshot.signedRecords, [{ profileId: PROFILE, walletBindingId: f.fingerprint, value: next }]);
    await assert.rejects(f.storage.signedRecords.read(`0x${'c'.repeat(64)}`), { code: 'STORAGE_CHANGED' });
    assert.throws(() => f.storage.keyringStorage.set('too-big', 'x'.repeat(65536)), { code: 'STORAGE_CORRUPT' });
    await f.reopen(); assert.equal(await f.storage.signedRecords.read(PROFILE), next);
  } finally { await f.close(); }
});

test('recovery snapshots preserve signed bytes and reject a concurrent bundle replacement', async () => {
  const f = await fixture(); try {
    await f.bind(); const raw = bundle(); await f.storage.signedRecords.compareAndSet(PROFILE, undefined, raw, () => undefined);
    const before = await f.storage.recovery.readSnapshot();
    const plan = await f.storage.recovery.prepareReplacement!(before, { vault: validPair(2).vault, keys: validPair(2)['vault-keys'] }, ROOT);
    assert.equal(f.storage.recovery.plannedSnapshot!(plan).signedRecords[0]?.value, raw);
    await f.storage.signedRecords.compareAndSet(PROFILE, raw, bundle(1), () => undefined);
    await assert.rejects(f.storage.recovery.commitReplacement!(plan, () => undefined), { code: 'STORAGE_CHANGED' });
    assert.equal(await f.storage.keyringStorage.get('vault'), validPair().vault);
    const current = await f.storage.recovery.readSnapshot();
    assert.equal(sameRecoverySnapshot(before, current), false);
    const accepted = await f.storage.recovery.prepareReplacement!(current, { vault: validPair(2).vault, keys: validPair(2)['vault-keys'] }, ROOT);
    await f.storage.recovery.commitReplacement!(accepted, () => undefined);
    assert.equal(await f.storage.signedRecords.read(PROFILE), bundle(1));
    assert.equal((await f.storage.recovery.readSnapshot()).identity?.walletBindingId, f.fingerprint);
  } finally { await f.close(); }
});

for (const fault of ['commit-ack', 'readback'] as const) test(`${fault} loss retains exact signed bytes and quarantines writes until reopen`, async () => {
  const f = await fixture(); try {
    await f.bind(); const raw = bundle(); let written = false;
    f.setAfter((kind, sql) => {
      if (kind === 'run' && sql.startsWith('INSERT INTO evm_signed_records')) written = true;
      if (written && ((fault === 'commit-ack' && kind === 'exec' && sql === 'COMMIT') || (fault === 'readback' && kind === 'all' && sql.includes('FROM evm_signed_records')))) {
        written = false; throw new Error('synthetic acknowledgement loss');
      }
    });
    await assert.rejects(f.storage.signedRecords.compareAndSet(PROFILE, undefined, raw, () => undefined), { code: 'STORAGE_REOPEN_REQUIRED' });
    assert.equal(f.db.prepare('SELECT value FROM evm_signed_records').get()!.value, raw);
    await assert.rejects(f.storage.signedRecords.read(PROFILE), { code: 'STORAGE_REOPEN_REQUIRED' });
    f.setAfter(); await f.reopen(); assert.equal(await f.storage.signedRecords.read(PROFILE), raw);
  } finally { await f.close(); }
});

test('guard revocation before commit rolls back and close drains an already admitted commit', async () => {
  const f = await fixture(); try {
    await f.bind(); const raw = bundle(), hold = latch(); let current = true;
    f.setHook(async (kind, sql) => { if (kind === 'run' && sql.startsWith('INSERT INTO evm_signed_records')) { hold.enter(); await hold.wait; } });
    const pending = f.storage.signedRecords.compareAndSet(PROFILE, undefined, raw, () => { if (!current) throw new Error('revoked'); });
    void pending.catch(() => undefined); await hold.reached; current = false; hold.release(); await assert.rejects(pending);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM evm_signed_records').get()!.n, 0);
    const drain = latch(); f.setHook(async (kind, sql) => { if (kind === 'run' && sql.startsWith('INSERT INTO evm_signed_records')) { drain.enter(); await drain.wait; } });
    const write = f.storage.signedRecords.compareAndSet(PROFILE, undefined, raw, () => undefined); await drain.reached;
    const close = f.storage.close(); await assert.rejects(f.storage.signedRecords.read(PROFILE), { code: 'STORAGE_CLOSED' });
    drain.release(); assert.equal(await write, true); await close; f.setHook(); await f.reopen();
    assert.equal(await f.storage.signedRecords.read(PROFILE), raw);
  } finally { await f.close(); }
});

test('post-commit cancellation retains bytes and recovery rollback leaves the whole snapshot intact', async () => {
  const f = await fixture(); try {
    await f.bind(); const raw = bundle(); let current = true, writing = false;
    f.setAfter((kind, sql) => {
      if (kind === 'run' && sql.startsWith('INSERT INTO evm_signed_records')) writing = true;
      if (writing && kind === 'exec' && sql === 'COMMIT') current = false;
    });
    await assert.rejects(f.storage.signedRecords.compareAndSet(PROFILE, undefined, raw, () => { if (!current) throw Error('revoked'); }));
    f.setAfter(); assert.equal(await f.storage.signedRecords.read(PROFILE), raw);
    const before = await f.storage.recovery.readSnapshot();
    const plan = await f.storage.recovery.prepareReplacement!(before, { vault: validPair(2).vault, keys: validPair(2)['vault-keys'] }, ROOT);
    f.setHook((kind, sql) => { if (kind === 'run' && sql.startsWith('INSERT INTO wallet_metadata')) throw Error('rollback after pair update'); });
    await assert.rejects(f.storage.recovery.commitReplacement!(plan, () => undefined)); f.setHook();
    assert.ok(sameRecoverySnapshot(before, await f.storage.recovery.readSnapshot()));
    assert.equal(await f.storage.signedRecords.read(PROFILE), raw);
  } finally { await f.close(); }
});

test('actual SQLite admits the16MiB common boundary and refuses a larger value before write', async () => {
  const f = await fixture(); try {
    await f.bind(); const raw = bundle(0, EVM_SIGNED_RECORD_LIMITS.bytes);
    assert.equal(Buffer.byteLength(raw), EVM_SIGNED_RECORD_LIMITS.bytes);
    const start = performance.now(); await f.storage.signedRecords.compareAndSet(PROFILE, undefined, raw, () => undefined); const written = performance.now();
    assert.equal(await f.storage.signedRecords.read(PROFILE), raw); const read = performance.now();
    await assert.rejects(f.storage.signedRecords.compareAndSet(PROFILE, raw, `${raw} `, () => undefined), { code: 'STORAGE_CORRUPT' });
    const evidence = { bytes: Buffer.byteLength(raw), writeMilliseconds: written - start, readMilliseconds: read - written, sqlite: process.versions.sqlite };
    console.info('Signed-record SQLite benchmark', evidence);
  } finally { await f.close(); }
});

test('noncanonical schema or foreign signed profile is refused without rewrite', async () => {
  const f = await fixture(); try {
    await f.bind(); const raw = bundle(); await f.storage.signedRecords.compareAndSet(PROFILE, undefined, raw, () => undefined);
    f.db.prepare('UPDATE evm_signed_records SET wallet_binding = ?').run('f'.repeat(64));
    const rows = f.db.prepare('SELECT * FROM evm_signed_records').all();
    await assert.rejects(f.storage.recovery.readSnapshot(), { code: 'STORAGE_CORRUPT' });
    assert.deepEqual(f.db.prepare('SELECT * FROM evm_signed_records').all(), rows);
    f.db.prepare('DELETE FROM evm_signed_records').run(); f.db.exec('DROP TABLE evm_signed_records');
    await f.storage.close();
    const reopened = nodeConnection(f.file); try {
      await assert.rejects(SqliteWalletStorage.open(reopened.connection, digest, INSTALLATION, true), { code: 'STORAGE_CORRUPT' });
      assert.equal(reopened.database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'evm_signed_records'").get()!.n, 0);
    } finally { await reopened.connection.closeAsync(); }
  } finally { await f.close(); }
});

for (const fault of ['oversize', 'second-profile'] as const) test(`${fault} is rejected by SQL before bundle bytes cross the bridge`, async () => {
  const f = await fixture(); try {
    await f.bind(); const raw = bundle();
    if (fault === 'second-profile') {
      f.db.prepare('INSERT INTO evm_signed_records VALUES (?, ?, ?)').run(PROFILE, f.fingerprint, raw);
      f.db.prepare('INSERT INTO evm_signed_records VALUES (?, ?, ?)').run(`0x${'c'.repeat(64)}`, f.fingerprint, raw);
    } else {
      f.db.exec('PRAGMA ignore_check_constraints = ON');
      f.db.prepare('INSERT INTO evm_signed_records VALUES (?, ?, ?)').run(PROFILE, f.fingerprint, ' '.repeat(EVM_SIGNED_RECORD_LIMITS.bytes + 1));
    }
    f.observed.length = 0;
    await assert.rejects(f.storage.signedRecords.read(PROFILE), { code: 'STORAGE_CORRUPT' });
    assert.ok(f.observed.length > 0);
    assert.ok(f.observed.every((row) => row.value === null));
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM evm_signed_records').get()!.n, fault === 'second-profile' ? 2 : 1);
  } finally { await f.close(); }
});
