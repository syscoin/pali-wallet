import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { sameRecoverySnapshot } from '../src/storage/recoverySnapshot.ts';
import { digest, INSTALLATION, nodeConnection, validPair } from './storageHelpers.ts';
import { readPrivateVaultBundle } from '../../../source/wallet/privateVaultInspection.ts';
import { snapshotPrivateVaultBundle, parsePrivateVaultBundle } from '../../../source/wallet/privateVaultEnvelope.ts';
const PROFILE = `0x${'a'.repeat(64)}`;
const envelope = (domain: string, n: string) => ({ version: 1, domain, recordId: `00000000-0000-4000-8000-00000000000${n}`, profileId: PROFILE, nonce: 'A'.repeat(16), ciphertext: 'A'.repeat(24) });
const bundle = () => ({ format: 'pali-private-note-vault', version: 1, root: envelope('org.syscoin.pali.privacy.notes.v1', '1'), shards: [envelope('org.syscoin.pali.privacy.notes.shard.v2', '2')] });
async function fixture(observe?: (rows: readonly unknown[]) => void) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-note-domain-'));
  const file = path.join(directory, 'wallet.sqlite');
  const connect = () => {
    const owned = nodeConnection(file);
    const read = owned.connection.getAllAsync.bind(owned.connection);
    owned.connection.getAllAsync = async <T>(sql: string, parameters?: readonly (string | number | null)[]) => {
      const rows = await read<T>(sql, parameters);
      if (sql.includes('FROM private_note_records')) observe?.(rows);
      return rows;
    };
    return owned;
  };
  let owned = connect();
  let storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, true);
  await storage.keyringStorage.createManyIfAbsent(validPair()); const binding = await storage.getWalletFingerprint();
  return { file, get storage() { return storage; }, get db() { return owned.database; }, binding,
    insert(value = JSON.stringify(bundle()), profile = PROFILE, wallet = binding) { owned.database.prepare('INSERT INTO private_note_records VALUES (?, ?, ?)').run(profile, wallet, value); },
    async reopen() { await storage.close(); owned = connect(); storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false); },
    async close() { await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); } };
}
test('new storage creates the complete canonical schema directly and reopens without writes', async () => {
  const f = await fixture(); try {
    const before = f.db.prepare('SELECT * FROM keyring_records ORDER BY key').all(), metadata = f.db.prepare('SELECT * FROM wallet_metadata ORDER BY key').all();
    assert.equal(f.db.prepare('PRAGMA user_version').get()!.user_version, 1);
    assert.deepEqual(f.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view','trigger','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name), ['evm_signed_records', 'keyring_records', 'private_note_records', 'wallet_metadata']);
    const snap = await f.storage.recovery.readSnapshot(); await f.reopen();
    assert.deepEqual(f.db.prepare('SELECT * FROM keyring_records ORDER BY key').all(), before);
    assert.deepEqual(f.db.prepare('SELECT * FROM wallet_metadata ORDER BY key').all(), metadata);
    assert.ok(sameRecoverySnapshot(snap, await f.storage.recovery.readSnapshot()));
  } finally { await f.close(); }
});

for (const shape of ['missing-note-table', 'different-version'] as const) for (const initialize of [false, true]) {
  test(`noncanonical ${shape} is refused unchanged with initialize=${initialize}`, async () => {
    const f = await fixture(); let connection: ReturnType<typeof nodeConnection> | undefined;
    try {
      if (shape === 'missing-note-table') f.db.exec('DROP TABLE private_note_records');
      else f.db.exec('PRAGMA user_version = 2');
      const schema = f.db.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const before = f.db.prepare('SELECT * FROM keyring_records ORDER BY key').all(), metadata = f.db.prepare('SELECT * FROM wallet_metadata ORDER BY key').all();
      await f.storage.close(); const writes: string[] = [];
      connection = nodeConnection(f.file, { before(kind, sql) { if (kind === 'run' || kind === 'exec') writes.push(sql); } });
      await assert.rejects(SqliteWalletStorage.open(connection.connection, digest, INSTALLATION, initialize), { code: 'STORAGE_CORRUPT' });
      assert.deepEqual(writes, []);
      assert.deepEqual(connection.database.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(), schema);
      assert.deepEqual(connection.database.prepare('SELECT * FROM keyring_records ORDER BY key').all(), before);
      assert.deepEqual(connection.database.prepare('SELECT * FROM wallet_metadata ORDER BY key').all(), metadata);
      assert.equal(connection.database.prepare('PRAGMA user_version').get()!.user_version, shape === 'missing-note-table' ? 1 : 2);
    } finally { await connection?.connection.closeAsync(); await f.close(); }
  });
}
test('domain is read-only; absent, present and malformed remain distinct and reads preserve bytes', async () => {
  const f = await fixture(); try {
    assert.deepEqual(Object.keys(f.storage.notes), ['read']); assert.deepEqual(await f.storage.notes.read(), []);
    const before = await f.storage.recovery.readSnapshot(); f.insert(); const bytes = f.db.prepare('SELECT * FROM private_note_records').all();
    const after = await f.storage.recovery.readSnapshot(); assert.equal(after.notes.length, 1); assert.equal(sameRecoverySnapshot(before, after), false);
    await f.reopen(); assert.deepEqual(f.db.prepare('SELECT * FROM private_note_records').all(), bytes);
    f.db.prepare('UPDATE private_note_records SET value = ?').run('{}');
    await assert.rejects(f.storage.notes.read(), { code: 'STORAGE_CORRUPT' }); assert.equal(f.db.prepare('SELECT value FROM private_note_records').get()!.value, '{}');
  } finally { await f.close(); }
});
for (const fault of ['foreign-wallet', 'second-profile', 'unknown-domain', 'oversize', 'wrong-type'] as const) test(`domain refuses ${fault} without dropping data`, async () => {
  const f = await fixture(); try {
    if (fault === 'foreign-wallet') f.insert(JSON.stringify(bundle()), PROFILE, 'b'.repeat(64));
    if (fault === 'second-profile') { f.insert(); f.insert(JSON.stringify(bundle()), `0x${'b'.repeat(64)}`); }
    if (fault === 'unknown-domain') { const b = bundle(); b.root.domain = 'future.notes'; f.insert(JSON.stringify(b)); }
    if (fault === 'oversize' || fault === 'wrong-type') {
      f.db.exec('PRAGMA ignore_check_constraints = ON'); f.db.prepare('INSERT INTO private_note_records VALUES (?, ?, ?)').run(PROFILE, f.binding,
        fault === 'oversize' ? ' '.repeat(16 * 1024 * 1024 + 1) : new Uint8Array([1, 2]));
    }
    await assert.rejects(f.storage.recovery.readSnapshot(), { code: 'STORAGE_CORRUPT' }); assert.ok(f.db.prepare('SELECT COUNT(*) AS n FROM private_note_records').get()!.n);
  } finally { await f.close(); }
});
test('generic64KiB limit remains while structural parser bounds all note work', async () => {
  const f = await fixture(); try {
    assert.throws(() => f.storage.keyringStorage.set('too-big', 'x'.repeat(65536)), { code: 'STORAGE_CORRUPT' });
    assert.equal(parsePrivateVaultBundle(JSON.stringify(bundle())).root.profileId, PROFILE);
    for (const raw of ['[]', '{', JSON.stringify({ ...bundle(), extra: true }), JSON.stringify({ ...bundle(), shards: Array(513).fill(bundle().shards[0]) }), '['.repeat(20) + '0' + ']'.repeat(20)]) assert.throws(() => parsePrivateVaultBundle(raw));
  } finally { await f.close(); }
});


test('shared envelope snapshot accepts plain cross-realm data and rejects accessors/custom prototypes before SDK calls', async () => {
  const value = bundle();
  const other = runInNewContext(`(${JSON.stringify(value)})`);
  assert.deepEqual(snapshotPrivateVaultBundle(other), snapshotPrivateVaultBundle(value));
  let touched = 0;
  const blocked = () => { touched++; throw new Error('private sentinel'); };
  const session = { generation: 1, assertCurrent() {}, keyring: { getPrivateRecordProfileId: blocked, encryptPrivateRecord: blocked, decryptPrivateRecord: blocked } } as unknown as Parameters<typeof readPrivateVaultBundle>[1];
  const accessor = { ...value }; Object.defineProperty(accessor, 'root', { enumerable: true, get: blocked });
  const custom = Object.assign(Object.create({ hidden: true }), value);
  const hostile = new Proxy(value, { getOwnPropertyDescriptor: blocked });
  for (const input of [accessor, custom, hostile]) await assert.rejects(readPrivateVaultBundle(input, session), { message: 'privacy_vault_corrupt' });
  assert.equal(touched, 1, 'only the deliberately throwing proxy trap runs; no accessor or SDK method runs');
});


for (const phase of ['before-create', 'after-commit'] as const) test(`canonical creation ${phase} leaves either an empty database or the complete schema`, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-note-create-'));
  const file = path.join(directory, 'wallet.sqlite'); let fault = false;
  const connection = nodeConnection(file, {
    before(kind, sql) { if (phase === 'before-create' && kind === 'exec' && sql.startsWith('CREATE TABLE private_note_records')) { fault = true; throw new Error('synthetic creation failure'); } },
    after(kind, sql) { if (phase === 'after-commit' && kind === 'exec' && sql === 'COMMIT') { fault = true; throw new Error('synthetic creation lost acknowledgement'); } },
  });
  try {
    await assert.rejects(SqliteWalletStorage.open(connection.connection, digest, INSTALLATION, true)); assert.equal(fault, true);
    assert.equal(connection.database.prepare('PRAGMA user_version').get()!.user_version, phase === 'before-create' ? 0 : 1);
    assert.equal(connection.database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get()!.count, phase === 'before-create' ? 0 : 4);
  } finally { await connection.connection.closeAsync(); }
  const reopened = nodeConnection(file);
  try {
    const storage = await SqliteWalletStorage.open(reopened.connection, digest, INSTALLATION, phase === 'before-create');
    assert.deepEqual(await storage.readState(), { presence: 'empty', backup: 'unconfirmed' });
    assert.equal(reopened.database.prepare('PRAGMA user_version').get()!.user_version, 1);
    await storage.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});


for (const method of ['notes', 'snapshot'] as const) test(`multiple note rows transfer zero ciphertext bytes through ${method} connection results`, async () => {
  const returned: unknown[][] = [];
  const f = await fixture((rows) => returned.push([...rows]));
  try {
    for (const digit of ['a', 'b', 'c']) f.insert('x'.repeat(1024 * 1024), `0x${digit.repeat(64)}`);
    const before = f.db.prepare('SELECT * FROM private_note_records ORDER BY profile_id').all(); returned.length = 0;
    await assert.rejects(method === 'notes' ? f.storage.notes.read() : f.storage.recovery.readSnapshot(), { code: 'STORAGE_CORRUPT' });
    assert.equal(returned.length, 1, 'one actual SQLite SELECT reaches the connection boundary');
    const rows = returned[0]! as { source: string; value: unknown }[];
    assert.equal(rows.filter((row) => row.source === 'note').length, method === 'notes' ? 2 : 3);
    const bytes = rows.reduce((total, row) => total + (row.source === 'note' && typeof row.value === 'string' ? Buffer.byteLength(row.value, 'utf8') : 0), 0);
    assert.equal(bytes, 0, 'SQL must reject cardinality before returning any note ciphertext');
    assert.deepEqual(f.db.prepare('SELECT * FROM private_note_records ORDER BY profile_id').all(), before);
  } finally { await f.close(); }
});

test('single valid note row still returns its exact bytes through both connection reads', async () => {
  const returned: unknown[][] = [];
  const f = await fixture((rows) => returned.push([...rows]));
  try {
    const value = JSON.stringify(bundle()); f.insert(value); returned.length = 0;
    assert.equal((await f.storage.notes.read())[0]!.value, value);
    assert.equal((await f.storage.recovery.readSnapshot()).notes[0]!.value, value);
    assert.equal(returned.length, 2);
    for (const rows of returned) assert.deepEqual((rows as { source: string; value: unknown }[]).filter((row) => row.source === 'note').map((row) => row.value), [value]);
  } finally { await f.close(); }
});
