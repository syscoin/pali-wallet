import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { keccak256 } from 'ethers/crypto';
import { Wallet } from 'ethers/wallet';
import { inspectRecoveryInventory, readRecoveryInventory } from '../src/custody/recoveryInventory.ts';
import { WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { importedKeyIdentity } from '../src/custody/importedAccounts.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { ACTIVITY_STORAGE_KEY } from '../src/activity/historyStore.ts';
import { NATIVE_TOKEN_REGISTRY_KEY } from '../src/portfolio/tokenRegistry.ts';
import { encodeStorageValue } from '../src/storage/json.ts';
import { encodeAccountRecord } from '../src/storage/accountRecordKey.ts';
import { createAccountRecordTestFixture } from './accountRecordTestFixture.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection, validPair } from './storageHelpers.ts';
import { openNativeConnectionRepository, NATIVE_CONNECTION_STORAGE_KEY } from '../src/connections/storage.ts';

// Setup uses actual SDK-encrypted account records. Inventory itself only reads public counts.
const KEY = `0x${'1'.padStart(64, '0')}`;
const wallet = new Wallet(KEY);
async function fixture(empty = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-recovery-inventory-'));
  const file = path.join(directory, 'wallet.sqlite');
  const sql: string[] = [];
  let owned = nodeConnection(file, { before(_kind, statement) { sql.push(statement); } });
  let storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, true);
  const keys = await createAccountRecordTestFixture();
  const root = keys.identity, profileId = keys.staged.profileId;
  let fingerprint = '';
  if (!empty) {
    await storage.keyringStorage.createManyIfAbsent(keys.pair);
    fingerprint = await storage.getWalletFingerprint();
    await storage.keyringStorage.set(WALLET_CATALOGUE_KEY, keys.record(fingerprint));
    await storage.recovery.bindIdentity(fingerprint, { ...root, profileId }, () => undefined);
  }
  return { fingerprint, sql, keys, root, profileId, get storage() { return storage; }, get database() { return owned.database; },
    put(key: string, value: unknown) { owned.database.prepare('INSERT OR REPLACE INTO keyring_records VALUES (?, ?)').run(key, key === WALLET_CATALOGUE_KEY ? encodeAccountRecord(value) : encodeStorageValue(value)); },
    meta(key: string, value: unknown) { owned.database.prepare('INSERT OR REPLACE INTO wallet_metadata VALUES (?, ?)').run(key, encodeStorageValue(value)); },
    value(key: string) { return JSON.parse((owned.database.prepare('SELECT value FROM keyring_records WHERE key = ?').get(key) as { value: string }).value); },
    bytes() { return JSON.stringify({ records: owned.database.prepare('SELECT * FROM keyring_records ORDER BY key').all(), metadata: owned.database.prepare('SELECT * FROM wallet_metadata ORDER BY key').all(), signed: owned.database.prepare('SELECT * FROM evm_signed_records ORDER BY profile_id').all() }); },
    async putSigned(value: string) { await storage.recovery.bindIdentity(fingerprint, { ...root, profileId }, () => undefined); await storage.signedRecords.compareAndSet(profileId, undefined, value, () => undefined); },
    async reopen() { await storage.close(); owned = nodeConnection(file, { before(_kind, statement) { sql.push(statement); } }); storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false); },
    async close() { await keys.close(); await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); } };
}
async function signed(chainId = 1, signer = wallet) {
  return signer.signTransaction({ type: 2, chainId, nonce: 0, to: '0x1111111111111111111111111111111111111111',
    value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
}
// Synthetic ciphertext exercises public structural inventory only. Recovery tests
// separately require real SDK authentication before any replacement is authorized.
function signedBundle(address: string, profileId: string) {
  const envelope = (domain: string, recordId: string) => ({ version: 1, profileId, domain, recordId, nonce: 'A'.repeat(16), ciphertext: 'A'.repeat(24) });
  return JSON.stringify({ version: 1, profileId, revision: 0,
    root: envelope('org.syscoin.pali.evm.signed.root.v1', 'manifest'),
    entries: ['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet'].map((network, index) => {
      const hash = `0x${String(index + 1).repeat(64)}`;
      return { hash, chainId: getNativeNetwork(network).chainId, from: address.toLowerCase(), nonce: 0,
        phase: 'signed', createdAt: 1, signer: { id: 0, type: 'HDAccount' }, operation: 'send',
        chunks: [envelope('org.syscoin.pali.evm.signed.chunk.v1', `${hash}/0`)] };
    }) });
}
function assertReadsOnly(statements: string[]) {
  assert.equal(statements.some((sql) => /^(INSERT|UPDATE|DELETE|BEGIN|COMMIT|CREATE|ALTER|DROP)/i.test(sql)), false, statements.join('\n'));
}

test('unverified inventory is read-only, byte preserving and never claims phrase or root verification', async () => {
  const f = await fixture();
  try {
    const before = f.bytes(); f.sql.length = 0;
    assert.deepEqual(await f.storage.recovery.readIdentity(), { walletBindingId: f.fingerprint, pairFingerprint: f.fingerprint, root: { ...f.root, profileId: f.profileId }, verification: 'requires-unlock' });
    const inventory = await readRecoveryInventory(f.storage);
    assert.equal(inventory.status, 'needs-matching-phrase-verification');
    assert.equal(inventory.counts?.hdAccounts, 1);
    assert.equal(inventory.counts?.importedKeys, 0);
    assert.equal(inventory.backup, 'unconfirmed');
    const publicText = JSON.stringify(inventory);
    const account = f.value(WALLET_CATALOGUE_KEY).groups[0].accounts.HDAccount[0];
    for (const secret of [f.root.address, f.root.publicKey, f.fingerprint, account.label, account.xprv, 'ciphertext', 'vault-keys']) {
      assert.equal(typeof secret, 'string'); assert(secret.length > 0);
      assert.equal(publicText.includes(secret), false);
    }
    assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    await f.reopen(); assert.equal(f.bytes(), before);
  } finally { await f.close(); }
});

test('connection records are recovery-bound without exposing transport secrets in inventory', async () => {
  const f = await fixture();
  try {
    const repository = await openNativeConnectionRepository({ storage: f.storage.keyringStorage, walletBindingId: f.fingerprint, assertOwner() {} });
    await repository.transport.setItem('protocol-secret', { key: 'test-only-secret-value' });
    await repository.dispose();
    const before = f.bytes(); f.sql.length = 0;
    const inventory = await readRecoveryInventory(f.storage);
    assert.equal(inventory.status, 'needs-matching-phrase-verification');
    assert.equal(JSON.stringify(inventory).includes('test-only-secret-value'), false);
    assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    const foreign = f.value(NATIVE_CONNECTION_STORAGE_KEY);
    foreign.walletBindingId = 'b'.repeat(64);
    f.put(NATIVE_CONNECTION_STORAGE_KEY, foreign);
    const rejected = f.bytes();
    assert.equal((await readRecoveryInventory(f.storage)).reason, 'invalid-record');
    assert.equal(f.bytes(), rejected);
  } finally { await f.close(); }
});

test('known empty is distinct from missing catalogue, corrupt records and unavailable storage', async () => {
  const f = await fixture(true);
  try {
    assert.equal((await readRecoveryInventory(f.storage)).status, 'empty');
    await f.storage.keyringStorage.createManyIfAbsent(validPair());
    assert.equal((await readRecoveryInventory(f.storage)).reason, 'missing-catalogue');
    f.put('future-private-domain', { privateKey: 'must not escape' });
    const before = f.bytes(), result = await readRecoveryInventory(f.storage);
    assert.equal(result.reason, 'unsupported-record'); assert.equal(result.counts, null); assert.equal(f.bytes(), before);
    await f.storage.close();
    assert.equal((await readRecoveryInventory(f.storage)).reason, 'storage-unavailable');
  } finally { await f.close(); }
});

test('optional stable identity stays separate from pair digest and backup/auth retain pair semantics', async () => {
  const f = await fixture();
  try {
    const originalBinding = f.fingerprint;
    const replacement = validPair(2);
    const changedPair = await f.storage.recovery.fingerprintPair!({ vault: replacement.vault, keys: replacement['vault-keys'] });
    for (const [key, value] of Object.entries(replacement)) f.put(key, value);
    assert.notEqual(changedPair, originalBinding);
    f.meta('identity', { version: 1, walletBindingId: originalBinding, pairFingerprint: changedPair, root: { ...f.root, profileId: f.profileId } });
    await f.storage.confirmBackup(changedPair);
    await f.storage.authGuard.recordFailure();
    const before = f.bytes(); f.sql.length = 0;
    assert.deepEqual(await f.storage.recovery.readIdentity(), { walletBindingId: originalBinding, pairFingerprint: changedPair, root: { ...f.root, profileId: f.profileId }, verification: 'requires-unlock' });
    assert.equal(await f.storage.getWalletFingerprint(), changedPair);
    assert.equal((await readRecoveryInventory(f.storage)).status, 'needs-matching-phrase-verification');
    assert.equal((await f.storage.readState()).backup, 'confirmed');
    assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    await f.reopen(); assert.equal((await f.storage.recovery.readIdentity())?.walletBindingId, originalBinding);
    await assert.rejects(f.storage.confirmBackup(originalBinding), { code: 'STORAGE_CHANGED' });
  } finally { await f.close(); }
});

test('optional identity is strict, pair bound and never substitutes its declared root for catalogue validation', async () => {
  const f = await fixture();
  try {
    const valid = { version: 1, walletBindingId: f.fingerprint, pairFingerprint: f.fingerprint, root: { ...f.root, profileId: f.profileId } };
    for (const bad of [null, [], { ...valid, extra: true }, { ...valid, version: 2 }, { ...valid, pairFingerprint: 'b'.repeat(64) },
      { ...valid, root: { ...f.root, profileId: 'bad' } }, { ...valid, root: { ...f.root, profileId: f.profileId, address: '0x1111111111111111111111111111111111111111' } }]) {
      f.meta('identity', bad); const before = f.bytes(); f.sql.length = 0;
      await assert.rejects(f.storage.recovery.readIdentity(), { code: 'STORAGE_CORRUPT' });
      assert.equal((await readRecoveryInventory(f.storage)).status, 'unavailable');
      assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    }
    const other = importedKeyIdentity(`0x${'2'.padStart(64, '0')}`, 0);
    f.meta('identity', { ...valid, root: { address: other.address, publicKey: other.publicKey, profileId: f.profileId } });
    assert.equal((await readRecoveryInventory(f.storage)).reason, 'invalid-record');
  } finally { await f.close(); }
});

test('inventory counts the shared signed bundle, imported envelopes, tokens and opaque history without decrypting', async () => {
  const f = await fixture();
  try {
    const secret = `0x${'2'.padStart(64, '0')}`;
    const added = await f.keys.imported(secret, 'Private account name');
    const imported = importedKeyIdentity(secret, added.account.id);
    const catalogue = f.value(WALLET_CATALOGUE_KEY);
    catalogue.groups[0].accounts.Imported[added.account.id] = added.account;
    catalogue.recovery.push(added.recovery);
    f.put(WALLET_CATALOGUE_KEY, catalogue);
    await f.putSigned(signedBundle(f.root.address, f.profileId));
    const network = getNativeNetwork('ethereum');
    f.put(NATIVE_TOKEN_REGISTRY_KEY, { version: 1, walletFingerprint: f.fingerprint, revision: 4, entries: [{
      accountId: imported.id, address: imported.address, network: 'ethereum', chainId: '1', registrationHash: network.registrationHash,
      metadata: { contractAddress: '0x1111111111111111111111111111111111111111', name: 'Test token', symbol: 'T', decimals: 255 } }] });
    f.put(ACTIVITY_STORAGE_KEY, { version: 1, walletFingerprint: f.fingerprint, revision: 7, truncated: false, archived: [],
      cached: [{ sourceId: `0x${'b'.repeat(64)}`, scopeKey: `0x${'c'.repeat(64)}`, candidates: [{ hash: `0x${'d'.repeat(64)}`, blockNumber: '1', timestamp: null, tokenHint: true }] }],
      views: [{ sourceId: `0x${'e'.repeat(64)}`, view: { filter: 'all', showZero: false, anchor: null, offset: 0 } }] });
    const before = f.bytes(); f.sql.length = 0;
    const result = await readRecoveryInventory(f.storage);
    assert.equal(result.status, 'needs-matching-phrase-verification');
    assert.deepEqual(result.counts, { hdAccounts: 1, importedKeys: 1,
      retainedSignedTransactions: 3, tokenEntries: 1, historySummaries: 0, cachedTransactions: 1, activityPreferences: 1 });
    assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    assert.equal(JSON.stringify(result).includes(imported.address), false);
    assert.equal(JSON.stringify(result).includes('Private account name'), false);
  } finally { await f.close(); }
});

test('all 64 records are captured, unknown domains fail closed and the 65th is never truncated away', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 61; index++) f.put(`unknown-private-${index}`, { retained: index });
    const before = f.bytes(); f.sql.length = 0;
    const snapshot = await f.storage.recovery.readSnapshot();
    assert.equal(snapshot.records.length, 64);
    assert.equal(snapshot.records.some((row) => row.key === 'unknown-private-60'), true);
    assert.equal((await readRecoveryInventory(f.storage)).reason, 'unsupported-record');
    assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    f.put('future-extra-row', {});
    await assert.rejects(f.storage.recovery.readSnapshot(), { code: 'STORAGE_CORRUPT' });
    assert.equal((await readRecoveryInventory(f.storage)).status, 'unavailable');
  } finally { await f.close(); }
});

test('malformed known domains and noncatalogued identities fail closed without changing bytes', async () => {
  const f = await fixture();
  try {
    for (const [key, value] of [
      [NATIVE_TOKEN_REGISTRY_KEY, { version: 9 }], [ACTIVITY_STORAGE_KEY, { version: 1 }],
      ['native-evm-transfer-v1', { version: 1, privateKey: 'do not expose' }],
      ['native-evm-transfer-v1:hd:60:1', { version: 1 }],
      ['native-evm-transfer-v1:hd:60:00', { version: 1 }],
    ] as const) {
      f.put(key, value); const before = f.bytes(); f.sql.length = 0;
      const result = await readRecoveryInventory(f.storage);
      assert.equal(result.status, 'unavailable'); assert.equal(result.counts, null);
      assert.equal(JSON.stringify(result).includes('do not expose'), false);
      assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
      f.database.prepare('DELETE FROM keyring_records WHERE key = ?').run(key);
    }
  } finally { await f.close(); }
});

test('incomplete account records and unsupported journal shapes are rejected without rewriting', async () => {
  const f = await fixture();
  try {
    const catalogue = f.value(WALLET_CATALOGUE_KEY); catalogue.version = 1;
    delete catalogue.groups; delete catalogue.recovery;
    catalogue.networks = [{ id: 'ethereum', kind: 'evm', chainId: '1', slip44: 60, rpcUrl: 'https://ethereum-rpc.publicnode.com', symbol: 'ETH', decimals: 18 }];
    f.put(WALLET_CATALOGUE_KEY, catalogue);
    const rawTransaction = await signed();
    f.put('native-evm-transfer-v1', { version: 1, scope: { walletFingerprint: f.fingerprint, address: wallet.address, chainId: '1' },
      phase: 'attempted', rawTransaction, hash: keccak256(rawTransaction), nonce: 0, createdAt: 1 });
    const before = f.bytes(); f.sql.length = 0;
    assert.equal((await readRecoveryInventory(f.storage)).status, 'unavailable');
    assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    assert.equal(f.value(WALLET_CATALOGUE_KEY).version, 1);
    assert.equal(f.value('native-evm-transfer-v1').version, 1);
  } finally { await f.close(); }
});

test('one SELECT captures a coherent snapshot and callers cannot mutate its records', async () => {
  const f = await fixture();
  try {
    f.sql.length = 0;
    const snapshot = await f.storage.recovery.readSnapshot();
    assert.equal(f.sql.filter((sql) => sql.startsWith("SELECT 'record'")).length, 1);
    assert.equal(Object.isFrozen(snapshot.records), true); assert.equal(Object.isFrozen(snapshot.records[0]), true);
    assert.throws(() => { (snapshot.records[0] as { value: string }).value = 'changed'; });
    assert.equal(inspectRecoveryInventory(snapshot).counts?.hdAccounts, 1);
    assertReadsOnly(f.sql);
  } finally { await f.close(); }
});

test('the exact SDK UTF8 diagnostic is retained but arbitrary diagnostic payloads refuse inventory', async () => {
  const f = await fixture();
  try {
    for (const hasUtf8Error of [false, true]) {
      f.put('utf8Error', { hasUtf8Error }); const before = f.bytes();
      assert.equal((await readRecoveryInventory(f.storage)).status, 'needs-matching-phrase-verification');
      assert.equal(f.bytes(), before);
    }
    for (const value of [false, { hasUtf8Error: 'false' }, { hasUtf8Error: false, extra: true }, {}]) {
      f.put('utf8Error', value); const before = f.bytes();
      const inventory = await readRecoveryInventory(f.storage);
      assert.equal(inventory.status, 'unavailable');
      assert.equal(inventory.reason, 'unsupported-record');
      assert.equal(inventory.counts, null);
      assert.equal(f.bytes(), before);
    }
  } finally { await f.close(); }
});

test('malformed rows, metadata, oversize and installation changes never produce eligible inventory', async () => {
  for (const mutation of ['unknown-metadata', 'oversize-record', 'oversize-key', 'installation'] as const) {
    const f = await fixture();
    try {
      if (mutation === 'unknown-metadata') f.meta('future-meta', {});
      if (mutation === 'installation') f.database.prepare('UPDATE wallet_metadata SET value = ? WHERE key = ?').run('b'.repeat(32), 'installation');
      if (mutation.startsWith('oversize')) {
        f.database.exec('PRAGMA ignore_check_constraints = ON');
        f.database.prepare('INSERT INTO keyring_records VALUES (?, ?)').run(mutation === 'oversize-key' ? 'k'.repeat(257) : 'extra', mutation === 'oversize-record' ? 'x'.repeat(65537) : '{}');
      }
      const before = f.bytes(); f.sql.length = 0;
      assert.equal((await readRecoveryInventory(f.storage)).status, 'unavailable');
      assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    } finally { await f.close(); }
  }
});
