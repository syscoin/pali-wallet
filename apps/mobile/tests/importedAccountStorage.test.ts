import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SigningKey, keccak256 } from 'ethers/crypto';
import { computeAddress, Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { NativeWalletCatalogue, WALLET_CATALOGUE_KEY, type StoredImportedAccount } from '../src/custody/walletCatalogue.ts';
import { NativeTransferJournal, nativeTransferJournalKey } from '../src/custody/transferJournal.ts';
import { importedKeyIdentity, normalizeImportedKey } from '../src/custody/importedAccounts.ts';
import { importAccountWithRecovery, readImportedRecoverySecret, snapshotImportedRecoveryEntry, type ImportedRecoveryCrypto } from '../../../source/wallet/importedAccountRecovery.ts';
import { parseNativeAccountId } from '../src/custody/accountIdentity.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection, validPair, type SqlHook } from './storageHelpers.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'PUBLIC imported account fixture password';
const KEY = '0x' + '1'.padStart(64, '0');
const ROOT_KEY = '0x' + '99'.padStart(64, '0');
const identity = { address: computeAddress(ROOT_KEY), publicKey: SigningKey.computePublicKey(ROOT_KEY, true).toLowerCase() };
const current = () => undefined;
let cryptoPromise: Promise<Awaited<ReturnType<typeof makeCrypto>>> | undefined;
async function makeCrypto() {
  const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
  const values = new Map<string, unknown>();
  const storage = { async get(k: string) { return values.get(k); }, async set(k: string, v: unknown) { values.set(k, v); },
    async deleteItem(k: string) { values.delete(k); }, async createManyIfAbsent(items: Record<string, unknown>) {
      if (Object.keys(items).some((k) => values.has(k))) return false;
      Object.entries(items).forEach(([k, v]) => values.set(k, v)); return true;
    } };
  const keyring = new sdk.SoftwareKeyring(sdk.createSoftwareKeyringHost(storage));
  const state = { activeAccount: { id: 0, type: sdk.KeyringAccountType.HDAccount },
    activeNetwork: { kind: sdk.INetworkType.Ethereum, chainId: 1, slip44: 60, currency: 'ETH', url: 'https://offline.invalid' },
    accounts: { HDAccount: {}, Imported: {} as Record<number, any>, Ledger: {}, Trezor: {}, SmartAccount: {} } };
  keyring.setVaultStateGetter(() => state);
  await keyring.initializeSession(PHRASE, PASSWORD);
  return { keyring, state };
}
const crypto = async () => (await (cryptoPromise ??= makeCrypto())).keyring;
const seal = (keyring: Awaited<ReturnType<typeof crypto>>, key = KEY) => importAccountWithRecovery(keyring,
  { secret: key, network: { kind: 'ethereum', slip44: 60 } }, current);
const openSecret = async (keyring: ImportedRecoveryCrypto, entry: ReturnType<typeof snapshotImportedRecoveryEntry>, expected = entry.identity, guard = current) =>
  (await readImportedRecoverySecret(keyring, entry, expected, guard)).secret;
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-imported-store-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage = await SqliteWalletStorage.open(nodeConnection(file, hooks).connection, digest, INSTALLATION, true);
  await storage.keyringStorage.createManyIfAbsent(validPair());
  const root = { ...identity, walletFingerprint: await storage.getWalletFingerprint() };
  const stage = await makeCrypto();
  const readImport = async (record: StoredImportedAccount) => {
    const key = await openSecret(stage.keyring, record.recovery, { kind: 'ethereum', slip44: 60, id: record.index, address: record.address, xpub: record.publicKey });
    const actual = importedKeyIdentity(key, record.index);
    return { address: actual.address, publicKey: actual.publicKey };
  };
  const open = async () => {
    const model = new NativeWalletCatalogue(storage.keyringStorage);
    await model.reconcile(root, current, undefined, readImport);
    return model;
  };
  return { root, readImport, open, stage, get storage() { return storage; },
    async reopen() { await storage.close().catch(() => undefined); storage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, false); },
    async close() { await stage.keyring.destroy(); await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); } };
}
async function importMutation(f: Awaited<ReturnType<typeof fixture>>, index = 0, key = KEY) {
  const result = await seal(f.stage.keyring, key);
  assert.equal(result.account.id, index);
  f.stage.state.accounts.Imported[index] = result.account;
  return { kind: 'import' as const, id: `imported:60:${index}`, index,
    address: result.account.address, publicKey: result.account.xpub.toLowerCase(),
    label: `Imported ${index + 1}`, recovery: result.recovery };
}

// SDK methods are run only with public synthetic fixtures; no application keys are read.
test('shared SDK AEAD binds the canonical imported copy to profile and public identity', async () => {
  const sdk = await crypto(), wrapped = await seal(sdk), entry = wrapped.recovery;
  assert.equal(await openSecret(sdk, entry), KEY);
  assert.equal(JSON.stringify(entry).includes(KEY), false);
  for (const changed of [
    { ...entry, envelope: { ...entry.envelope, domain: 'wrong' } },
    { ...entry, envelope: { ...entry.envelope, recordId: 'imported:60:6' } },
    { ...entry, envelope: { ...entry.envelope, ciphertext: 'AAAA' + entry.envelope.ciphertext.slice(4) } },
    { ...entry, envelope: { ...entry.envelope, profileId: '0x' + 'b'.repeat(64) } },
  ]) await assert.rejects(openSecret(sdk, changed));
  await assert.rejects(openSecret(sdk, entry, { ...entry.identity, address: identity.address }));
  for (const key of ['0x' + '0'.repeat(64), '0x' + 'f'.repeat(64), 'xprv-secret', PHRASE, '1', '0x1234']) assert.throws(() => normalizeImportedKey(key));
  for (const id of ['hd:60:4096', 'imported:60:-1', 'imported:60:01', 'Imported:60:0']) assert.throws(() => parseNativeAccountId(id));
  let read = false;
  const bad = { ...entry, envelope: { ...entry.envelope } }; Object.defineProperty(bad.envelope, 'ciphertext', { enumerable: true, get() { read = true; return ''; } });
  assert.throws(() => snapshotImportedRecoveryEntry(bad)); assert.equal(read, false);
});

test('single-row imported storage reopens, preserves the SDK pair and hides every private field', async () => {
  const f = await fixture();
  try {
    const model = await f.open(), pair = await f.storage.keyringStorage.get('vault');
    const mutation = await importMutation(f);
    const { id: _id, ...input } = mutation;
    const shown = await model.mutate(0, input, current);
    const publicJson = JSON.stringify(shown);
    for (const forbidden of ['envelope', 'ciphertext', 'profileId', 'nonce', KEY]) assert.equal(publicJson.includes(forbidden), false);
    assert.equal(shown.accounts[1]!.type, 'Imported'); assert.equal(shown.active.accountId, 'imported:60:0');
    const stored = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    assert.equal(JSON.stringify(stored).includes(KEY), false); assert.equal(JSON.stringify(stored).includes('xprv'), false);
    await f.reopen();
    const reopened = await f.open();
    assert.deepEqual(await reopened.reconcile(f.root, current, undefined, f.readImport), shown);
    await reopened.mutate(shown.revision, { kind: 'rename', id: 'hd:60:0', label: 'Renamed HD' }, current);
    const changed = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    assert.deepEqual(changed.importedAccounts, (stored as any).importedAccounts);
    assert.equal(await f.storage.getWalletFingerprint(), f.root.walletFingerprint);
    assert.deepEqual(await f.storage.keyringStorage.get('vault'), pair);
  } finally { await f.close(); }
});

test('old exact v2 records read without rewrites; mixed expanded fields are never defaults', async () => {
  const f = await fixture();
  try {
    await f.open();
    const old = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    delete old.importedAccounts; delete old.nextImportedIndex; delete old.retiredImportedIndices;
    await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, old);
    const model = await f.open(); assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), old);
    await model.mutate(old.revision, { kind: 'rename', id: 'hd:60:0', label: 'Same wallet' }, current);
    const expanded = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    assert.deepEqual(expanded.importedAccounts, []); assert.equal(expanded.nextImportedIndex, 0);
    for (const record of [{ ...old, nextImportedIndex: 0 }, { ...old, importedAccounts: [] }, { ...expanded, retiredImportedIndices: undefined }]) {
      if (record.retiredImportedIndices === undefined) delete record.retiredImportedIndices;
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, record);
      await assert.rejects(f.open()); assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), record);
    }
  } finally { await f.close(); }
});

for (const point of ['before-commit', 'lost-ack'] as const) {
  test(`imported catalogue ${point} keeps an atomic old/new row and quarantines ambiguity`, async () => {
    let enabled = false;
    const fail: SqlHook = (kind, sql) => { if (enabled && kind === 'exec' && sql === 'COMMIT') { enabled = false; throw Error('interrupted'); } };
    const f = await fixture(point === 'lost-ack' ? { after: fail } : { before: fail });
    try {
      const model = await f.open(), mutation = await importMutation(f), { id: _id, ...input } = mutation;
      enabled = true; await assert.rejects(model.mutate(0, input, current)); assert.equal(model.requiresReopen, true);
      await assert.rejects(model.mutate(0, input, current), /REOPEN_REQUIRED/);
      await f.reopen(); const reopened = await f.open();
      const state = await reopened.reconcile(f.root, current, undefined, f.readImport);
      assert.equal(state.accounts.length, point === 'lost-ack' ? 2 : 1);
      assert.equal(await f.storage.getWalletFingerprint(), f.root.walletFingerprint);
    } finally { await f.close(); }
  });
}

test('imported identity removal is atomic and the shared SDK can reuse the removed ordinal', async () => {
  const f = await fixture();
  try {
    const model = await f.open(), mutation = await importMutation(f), { id: _id, ...input } = mutation;
    let state = await model.mutate(0, input, current);
    state = await model.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
    state = await model.mutate(state.revision, { kind: 'remove', id: 'imported:60:0', journal: null }, current);
    assert.equal(model.nextImportedIndex, 1);
    delete f.stage.state.accounts.Imported[0];
    const next = await importMutation(f, 0), { id: _nextId, ...nextInput } = next;
    const final = await model.mutate(state.revision, nextInput, current);
    assert.equal(final.active.accountId, 'imported:60:0');
    const stored = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    assert.deepEqual(stored.retiredImportedIndices, []); assert.equal(stored.importedAccounts.length, 1);
    assert.equal(stored.importedAccounts[0].id, 'imported:60:0');
  } finally { await f.close(); }
});

test('HD and Imported zero indices use disjoint journal keys and reject each other’s containers', async () => {
  const f = await fixture();
  try {
    const signer = new Wallet(KEY), scope = { walletFingerprint: f.root.walletFingerprint, address: signer.address, chainId: '1' };
    const hd = new NativeTransferJournal(f.storage.keyringStorage, scope, current);
    const imported = new NativeTransferJournal(f.storage.keyringStorage, scope, current, Date.now, 0, undefined, undefined, 'Imported');
    const raw = await signer.signTransaction({ type: 2, chainId: 1, nonce: 0, to: identity.address, value: 1, gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 });
    await hd.saveSigned(raw); await imported.saveSigned(raw);
    assert.notEqual(nativeTransferJournalKey(0), nativeTransferJournalKey(0, 'Imported'));
    assert.equal((await hd.load())!.hash, keccak256(raw)); assert.equal(Transaction.from((await imported.load())!.rawTransaction).from, signer.address);
    const old = await f.storage.keyringStorage.get(nativeTransferJournalKey(0));
    await f.storage.keyringStorage.set(nativeTransferJournalKey(0, 'Imported'), old);
    await assert.rejects(imported.load(), /CONTEXT_CHANGED/);
    assert.deepEqual(await f.storage.keyringStorage.get(nativeTransferJournalKey(0)), old);
  } finally { await f.close(); }
});

test('shared imported reader clears malformed plaintext and rejects asynchronous guards', async () => {
  const sdk = await crypto(), wrapped = await seal(sdk);
  const malformed = new TextEncoder().encode('this is secret invalid JSON');
  const port = { getPrivateRecordProfileId: () => sdk.getPrivateRecordProfileId(),
    encryptPrivateRecord: (p: Parameters<typeof sdk.encryptPrivateRecord>[0]) => sdk.encryptPrivateRecord(p),
    async decryptPrivateRecord() { return malformed; } };
  await assert.rejects(openSecret(port, wrapped.recovery), /^Error: IMPORTED_RECOVERY_INVALID$/);
  assert.ok(malformed.every((byte) => byte === 0));
  await assert.rejects(importAccountWithRecovery(sdk, { secret: KEY, network: { kind: 'ethereum', slip44: 60 } }, (() => Promise.resolve()) as any), /IMPORTED_RECOVERY_INVALID/);
});

test('combined native capacity and malformed imported records never discard existing entries', async () => {
  const f = await fixture();
  try {
    const model = await f.open(); let state = await model.reconcile(f.root, current);
    const imported = await importMutation(f), { id: _id, ...input } = imported;
    state = await model.mutate(state.revision, input, current);
    for (let index = 1; index < 19; index++) {
      const key = '0x' + (index + 100).toString(16).padStart(64, '0');
      state = await model.mutate(state.revision, { kind: 'create', index, address: computeAddress(key),
        publicKey: SigningKey.computePublicKey(key, true), label: `HD ${index}` }, current);
    }
    assert.equal(state.accounts.length, 20);
    const second = await importMutation(f, 1, '0x' + '2'.padStart(64, '0')), { id: _id2, ...secondInput } = second;
    const saved = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    await assert.rejects(model.mutate(state.revision, secondInput, current), /CATALOGUE_LIMIT/);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), saved);
    const original = saved as any;
    for (const corrupted of [
      { ...original, importedAccounts: [{ ...original.importedAccounts[0], type: 'HDAccount' }] },
      { ...original, importedAccounts: [{ ...original.importedAccounts[0], id: 'hd:60:0' }] },
      { ...original, importedAccounts: [{ ...original.importedAccounts[0], address: f.root.address }] },
      { ...original, nextImportedIndex: 0 },
      { ...original, importedAccounts: [] },
    ]) {
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, corrupted);
      await assert.rejects(f.open());
      assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), corrupted);
    }
  } finally { await f.close(); }
});

test('shared reader snapshots identity before awaits and rejects accessors', async () => {
  const sdk = await crypto(), wrapped = await seal(sdk), entry = wrapped.recovery;
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>((r) => { entered = r; }), held = new Promise<void>((r) => { release = r; });
  const port = { getPrivateRecordProfileId: () => sdk.getPrivateRecordProfileId(),
    encryptPrivateRecord: (p: Parameters<typeof sdk.encryptPrivateRecord>[0]) => sdk.encryptPrivateRecord(p),
    async decryptPrivateRecord(p: Parameters<typeof sdk.decryptPrivateRecord>[0]) { calls++; entered(); await held; return sdk.decryptPrivateRecord(p); } };
  const mutable = { ...entry.identity };
  const pending = openSecret(port, entry, mutable);
  await started; mutable.id = 4; release();
  assert.equal(await pending, KEY);
  const bad = { ...entry.identity, id: 4 };
  const failed = openSecret(port, entry, bad);
  bad.id = 0; await assert.rejects(failed); assert.equal(calls, 1);
  let getters = 0;
  const accessor = { ...entry.identity }; Object.defineProperty(accessor, 'id', { enumerable: true, get() { getters++; return entry.identity.id; } });
  await assert.rejects(openSecret(port, entry, accessor));
  assert.equal(getters, 0); assert.equal(calls, 1);
});

test('an exhausted historical import counter still admits the SDK returned free slot', async () => {
  const f = await fixture();
  try {
    await f.open();
    const record = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    record.nextImportedIndex = 4096;
    record.retiredImportedIndices = Array.from({ length: 4096 }, (_, i) => i);
    await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, record);
    const model = await f.open();
    const { id: _id, ...input } = await importMutation(f);
    const result = await model.mutate(record.revision, input, current);
    assert.equal(result.active.accountId, 'imported:60:0');
    const saved = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    assert.equal(saved.nextImportedIndex, 4096);
    assert.equal(saved.retiredImportedIndices.length, 4095);
    assert.equal(saved.retiredImportedIndices.includes(0), false);
  } finally { await f.close(); }
});
