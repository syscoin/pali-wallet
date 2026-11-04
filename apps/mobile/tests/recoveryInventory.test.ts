import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SigningKey, keccak256 } from 'ethers/crypto';
import { Wallet } from 'ethers/wallet';
import { inspectRecoveryInventory, readRecoveryInventory } from '../src/custody/recoveryInventory.ts';
import { NativeWalletCatalogue, WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { nativeTransferJournalKey } from '../src/custody/transferJournal.ts';
import { importedKeyIdentity, IMPORTED_EVM_DOMAIN } from '../src/custody/importedAccounts.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { ACTIVITY_STORAGE_KEY } from '../src/activity/historyStore.ts';
import { NATIVE_TOKEN_REGISTRY_KEY } from '../src/portfolio/tokenRegistry.ts';
import { encodeStorageValue } from '../src/storage/json.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection, validPair } from './storageHelpers.ts';

// Public deterministic fixtures. Inventory does not initialize an SDK or decrypt keys.
const KEY = `0x${'1'.padStart(64, '0')}`;
const wallet = new Wallet(KEY);
const root = { address: wallet.address, publicKey: SigningKey.computePublicKey(KEY, true).toLowerCase() };
const profileId = `0x${'a'.repeat(64)}`;
async function fixture(empty = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-recovery-inventory-'));
  const file = path.join(directory, 'wallet.sqlite');
  const sql: string[] = [];
  let owned = nodeConnection(file, { before(_kind, statement) { sql.push(statement); } });
  let storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, true);
  let fingerprint = '';
  if (!empty) {
    await storage.keyringStorage.createManyIfAbsent(validPair());
    fingerprint = await storage.getWalletFingerprint();
    await new NativeWalletCatalogue(storage.keyringStorage).reconcile({ walletFingerprint: fingerprint, ...root }, () => undefined);
  }
  return { fingerprint, sql, get storage() { return storage; }, get database() { return owned.database; },
    put(key: string, value: unknown) { owned.database.prepare('INSERT OR REPLACE INTO keyring_records VALUES (?, ?)').run(key, encodeStorageValue(value)); },
    meta(key: string, value: unknown) { owned.database.prepare('INSERT OR REPLACE INTO wallet_metadata VALUES (?, ?)').run(key, encodeStorageValue(value)); },
    value(key: string) { return JSON.parse((owned.database.prepare('SELECT value FROM keyring_records WHERE key = ?').get(key) as { value: string }).value); },
    bytes() { return JSON.stringify({ records: owned.database.prepare('SELECT * FROM keyring_records ORDER BY key').all(), metadata: owned.database.prepare('SELECT * FROM wallet_metadata ORDER BY key').all() }); },
    async reopen() { await storage.close(); owned = nodeConnection(file, { before(_kind, statement) { sql.push(statement); } }); storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false); },
    async close() { await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); } };
}
async function signed(chainId = 1, signer = wallet) {
  return signer.signTransaction({ type: 2, chainId, nonce: 0, to: '0x1111111111111111111111111111111111111111',
    value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
}
async function journal(fingerprint: string, index = 0, phase = 'signed', type: 'HDAccount' | 'Imported' = 'HDAccount') {
  const id = `${type === 'HDAccount' ? 'hd' : 'imported'}:60:${index}`;
  return { version: 1, revision: 0, walletFingerprint: fingerprint,
    account: { id, index, type, slip44: 60, address: wallet.address },
    entries: await Promise.all(['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet'].map(async (network) => {
      const registration = getNativeNetwork(network), rawTransaction = await signed(Number(registration.chainId));
      return { registration, phase, rawTransaction, hash: keccak256(rawTransaction), nonce: 0, createdAt: 1 };
    })) };
}
function assertReadsOnly(statements: string[]) {
  assert.equal(statements.some((sql) => /^(INSERT|UPDATE|DELETE|BEGIN|COMMIT|CREATE|ALTER|DROP)/i.test(sql)), false, statements.join('\n'));
}

test('unverified inventory is read-only, byte preserving and never claims phrase or root verification', async () => {
  const f = await fixture();
  try {
    const before = f.bytes(); f.sql.length = 0;
    assert.deepEqual(await f.storage.recovery.readIdentity(), { walletBindingId: f.fingerprint, pairFingerprint: f.fingerprint, root: null, verification: 'requires-unlock' });
    const inventory = await readRecoveryInventory(f.storage);
    assert.equal(inventory.status, 'needs-matching-phrase-verification');
    assert.equal(inventory.counts?.hdAccounts, 1);
    assert.equal(inventory.counts?.importedKeys, 0);
    assert.equal(inventory.backup, 'unconfirmed');
    const publicText = JSON.stringify(inventory);
    for (const secret of [root.address, root.publicKey, f.fingerprint, 'Account 1', 'ciphertext', 'vault-keys']) assert.equal(publicText.includes(secret), false);
    assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    await f.reopen(); assert.equal(f.bytes(), before);
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
    for (const [key, value] of Object.entries(validPair(2))) f.put(key, value);
    const changedPair = await f.storage.getWalletFingerprint();
    assert.notEqual(changedPair, originalBinding);
    f.meta('identity', { version: 1, walletBindingId: originalBinding, pairFingerprint: changedPair, root: { ...root, profileId } });
    await f.storage.confirmBackup(changedPair);
    await f.storage.authGuard.recordFailure();
    const before = f.bytes(); f.sql.length = 0;
    assert.deepEqual(await f.storage.recovery.readIdentity(), { walletBindingId: originalBinding, pairFingerprint: changedPair, root: { ...root, profileId }, verification: 'requires-unlock' });
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
    const valid = { version: 1, walletBindingId: f.fingerprint, pairFingerprint: f.fingerprint, root: { ...root, profileId } };
    for (const bad of [null, [], { ...valid, extra: true }, { ...valid, version: 2 }, { ...valid, pairFingerprint: 'b'.repeat(64) },
      { ...valid, root: { ...root, profileId: 'bad' } }, { ...valid, root: { ...root, profileId, address: '0x1111111111111111111111111111111111111111' } }]) {
      f.meta('identity', bad); const before = f.bytes(); f.sql.length = 0;
      await assert.rejects(f.storage.recovery.readIdentity(), { code: 'STORAGE_CORRUPT' });
      assert.equal((await readRecoveryInventory(f.storage)).status, 'unavailable');
      assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    }
    const other = importedKeyIdentity(`0x${'2'.padStart(64, '0')}`, 0);
    f.meta('identity', { ...valid, root: { address: other.address, publicKey: other.publicKey, profileId } });
    assert.equal((await readRecoveryInventory(f.storage)).reason, 'invalid-record');
  } finally { await f.close(); }
});

test('inventory counts all chain journals, imported envelopes, tokens and opaque historical views without decrypting', async () => {
  const f = await fixture();
  try {
    const imported = importedKeyIdentity(`0x${'2'.padStart(64, '0')}`, 0);
    const catalogue = f.value(WALLET_CATALOGUE_KEY);
    catalogue.nextImportedIndex = 1;
    catalogue.importedAccounts = [{ ...imported, type: 'Imported', slip44: 60, label: 'Private account name',
      envelope: { version: 1, domain: IMPORTED_EVM_DOMAIN, recordId: imported.id, profileId, nonce: 'A'.repeat(16), ciphertext: 'A'.repeat(24) } }];
    f.put(WALLET_CATALOGUE_KEY, catalogue);
    f.put(nativeTransferJournalKey(0), await journal(f.fingerprint));
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
    assert.deepEqual(result.counts, { hdAccounts: 1, importedKeys: 1, retiredHdAccounts: 0, retiredImportedAccounts: 0,
      journalRecords: 1, pendingTransactions: 3, terminalTransactions: 0, tokenEntries: 1, historySummaries: 0, cachedTransactions: 1, activityPreferences: 1 });
    assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    assert.equal(JSON.stringify(result).includes(imported.address), false);
    assert.equal(JSON.stringify(result).includes('Private account name'), false);
  } finally { await f.close(); }
});

test('all 64 records are inspected, including retired-account journals, and the 65th is never truncated away', async () => {
  const f = await fixture();
  try {
    const catalogue = f.value(WALLET_CATALOGUE_KEY);
    catalogue.nextIndex = 62; catalogue.retiredIndices = Array.from({ length: 61 }, (_, i) => i + 1); f.put(WALLET_CATALOGUE_KEY, catalogue);
    const data = await journal(f.fingerprint, 1, 'confirmed');
    for (let index = 1; index <= 61; index++) f.put(nativeTransferJournalKey(index), { ...data, account: { ...data.account, id: `hd:60:${index}`, index } });
    const before = f.bytes(); f.sql.length = 0;
    assert.equal((await f.storage.recovery.readSnapshot()).records.length, 64);
    const result = await readRecoveryInventory(f.storage);
    assert.equal(result.counts?.journalRecords, 61); assert.equal(result.counts?.terminalTransactions, 183);
    assert.equal(result.counts?.retiredHdAccounts, 61); assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    const last = f.value(nativeTransferJournalKey(61));
    f.put(nativeTransferJournalKey(61), { ...last, entries: [{ ...last.entries[0], phase: 'not-a-phase' }] });
    assert.equal((await readRecoveryInventory(f.storage)).reason, 'invalid-record', 'the last row must also be parsed');
    f.put(nativeTransferJournalKey(61), last);
    f.put('future-extra-row', {});
    assert.equal((await readRecoveryInventory(f.storage)).status, 'unavailable');
  } finally { await f.close(); }
});

test('malformed known domains and noncatalogued identities fail closed without changing bytes', async () => {
  const f = await fixture();
  try {
    for (const [key, value] of [
      [NATIVE_TOKEN_REGISTRY_KEY, { version: 9 }], [ACTIVITY_STORAGE_KEY, { version: 1 }],
      [nativeTransferJournalKey(0), { version: 2, privateKey: 'do not expose' }],
      [nativeTransferJournalKey(1), await journal(f.fingerprint, 1)],
      ['native-evm-transfer-v1:hd:60:00', await journal(f.fingerprint)],
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

test('incomplete development catalogue and journal shapes are rejected without rewriting', async () => {
  const f = await fixture();
  try {
    const catalogue = f.value(WALLET_CATALOGUE_KEY); catalogue.version = 1;
    delete catalogue.importedAccounts; delete catalogue.nextImportedIndex; delete catalogue.retiredImportedIndices;
    catalogue.networks = [{ id: 'ethereum', kind: 'evm', chainId: '1', slip44: 60, rpcUrl: 'https://ethereum-rpc.publicnode.com', symbol: 'ETH', decimals: 18 }];
    f.put(WALLET_CATALOGUE_KEY, catalogue);
    const rawTransaction = await signed();
    f.put(nativeTransferJournalKey(0), { version: 1, scope: { walletFingerprint: f.fingerprint, address: wallet.address, chainId: '1' },
      phase: 'attempted', rawTransaction, hash: keccak256(rawTransaction), nonce: 0, createdAt: 1 });
    const before = f.bytes(); f.sql.length = 0;
    assert.equal((await readRecoveryInventory(f.storage)).status, 'unavailable');
    assert.equal(f.bytes(), before); assertReadsOnly(f.sql);
    assert.equal(f.value(WALLET_CATALOGUE_KEY).version, 1);
    assert.equal(f.value(nativeTransferJournalKey(0)).version, 1);
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

test('the exact SDK2 UTF8 diagnostic is retained but arbitrary diagnostic payloads refuse inventory', async () => {
  const f = await fixture();
  try {
    for (const hasUtf8Error of [false, true]) {
      f.put('utf8Error', { hasUtf8Error }); const before = f.bytes();
      assert.equal((await readRecoveryInventory(f.storage)).status, 'needs-matching-phrase-verification');
      assert.equal(f.bytes(), before);
    }
    for (const value of [false, { hasUtf8Error: 'false' }, { hasUtf8Error: false, extra: true }, {}]) {
      f.put('utf8Error', value); const before = f.bytes();
      assert.equal((await readRecoveryInventory(f.storage)).reason, 'invalid-record');
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
