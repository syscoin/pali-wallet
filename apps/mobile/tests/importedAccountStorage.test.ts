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
import { encryptImportedKey, decryptImportedKey, importedKeyIdentity, normalizeImportedKey, snapshotImportedEnvelope } from '../src/custody/importedAccounts.ts';
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
  keyring.setVaultStateGetter(() => ({ activeAccount: { id: 0, type: sdk.KeyringAccountType.HDAccount },
    activeNetwork: { kind: sdk.INetworkType.Ethereum, chainId: 1, slip44: 60, currency: 'ETH', url: 'https://offline.invalid' },
    accounts: { HDAccount: {}, Imported: {}, Ledger: {}, Trezor: {}, SmartAccount: {} } }));
  await keyring.initializeSession(PHRASE, PASSWORD);
  return keyring;
}
const crypto = () => cryptoPromise ??= makeCrypto();
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-imported-store-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage = await SqliteWalletStorage.open(nodeConnection(file, hooks).connection, digest, INSTALLATION, true);
  await storage.keyringStorage.createManyIfAbsent(validPair());
  const root = { ...identity, walletFingerprint: await storage.getWalletFingerprint() };
  const readImport = async (record: StoredImportedAccount) => {
    const key = await decryptImportedKey(await crypto(), root.walletFingerprint, { id: record.id, index: record.index, address: record.address, publicKey: record.publicKey }, record.envelope, current);
    const actual = importedKeyIdentity(key, record.index);
    return { address: actual.address, publicKey: actual.publicKey };
  };
  const open = async () => {
    const model = new NativeWalletCatalogue(storage.keyringStorage);
    await model.reconcile(root, current, undefined, readImport);
    return model;
  };
  return { root, readImport, open, get storage() { return storage; },
    async reopen() { await storage.close().catch(() => undefined); storage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, false); },
    async close() { await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); } };
}
async function importMutation(f: Awaited<ReturnType<typeof fixture>>, index = 0, key = KEY) {
  const result = await encryptImportedKey(await crypto(), f.root.walletFingerprint, index, key, current);
  return { kind: 'import' as const, ...result.identity, label: `Imported ${index + 1}`, envelope: result.envelope };
}

// SDK methods are run only with public synthetic fixtures; no application keys are read.
test('installed SDK AEAD binds imported key payload to profile, record, wallet and public identity', async () => {
  const sdk = await crypto();
  const fingerprint = 'a'.repeat(64);
  const wrapped = await encryptImportedKey(sdk, fingerprint, 7, KEY, current);
  assert.equal(await decryptImportedKey(sdk, fingerprint, wrapped.identity, wrapped.envelope, current), KEY);
  assert.equal(JSON.stringify(wrapped.envelope).includes(KEY), false);
  for (const changed of [
    { ...wrapped.envelope, domain: 'wrong' }, { ...wrapped.envelope, recordId: 'imported:60:6' },
    { ...wrapped.envelope, ciphertext: (wrapped.envelope.ciphertext[0] === 'A' ? 'B' : 'A') + wrapped.envelope.ciphertext.slice(1) },
    { ...wrapped.envelope, profileId: '0x' + 'b'.repeat(64) },
  ]) await assert.rejects(decryptImportedKey(sdk, fingerprint, wrapped.identity, changed, current));
  await assert.rejects(decryptImportedKey(sdk, 'b'.repeat(64), wrapped.identity, wrapped.envelope, current));
  await assert.rejects(decryptImportedKey(sdk, fingerprint, { ...wrapped.identity, address: identity.address }, wrapped.envelope, current));
  for (const key of ['0x' + '0'.repeat(64), '0x' + 'f'.repeat(64), 'xprv-secret', PHRASE, '1', '0x1234']) assert.throws(() => normalizeImportedKey(key));
  for (const id of ['hd:60:4096', 'imported:60:-1', 'imported:60:01', 'Imported:60:0']) assert.throws(() => parseNativeAccountId(id));
  let read = false;
  const bad = { ...wrapped.envelope }; Object.defineProperty(bad, 'ciphertext', { enumerable: true, get() { read = true; return ''; } });
  assert.throws(() => snapshotImportedEnvelope(bad, wrapped.identity.id)); assert.equal(read, false);
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

test('incomplete imported-account catalogue shapes are rejected without filling missing defaults', async () => {
  const f = await fixture();
  try {
    await f.open();
    const canonical = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    for (const field of ['importedAccounts', 'nextImportedIndex', 'retiredImportedIndices']) {
      const incomplete = { ...canonical }; delete incomplete[field];
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, incomplete);
      await assert.rejects(f.open());
      assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), incomplete);
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

test('imported identity removal is atomic and reimport cannot reuse its retired ordinal', async () => {
  const f = await fixture();
  try {
    const model = await f.open(), mutation = await importMutation(f), { id: _id, ...input } = mutation;
    let state = await model.mutate(0, input, current);
    state = await model.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
    state = await model.mutate(state.revision, { kind: 'remove', id: 'imported:60:0', journal: null }, current);
    assert.equal(model.nextImportedIndex, 1);
    await assert.rejects(model.mutate(state.revision, input, current), /CONTEXT_CHANGED/);
    const next = await importMutation(f, 1), { id: _nextId, ...nextInput } = next;
    const final = await model.mutate(state.revision, nextInput, current);
    assert.equal(final.active.accountId, 'imported:60:1');
    const stored = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    assert.deepEqual(stored.retiredImportedIndices, [0]); assert.equal(stored.importedAccounts.length, 1);
    assert.equal(stored.importedAccounts[0].id, 'imported:60:1');
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

test('imported helper clears temporary plaintext and does not expose parser or crypto errors', async () => {
  const sdk = await crypto(), fp = 'a'.repeat(64);
  let captured: Uint8Array | undefined;
  const encrypted = await encryptImportedKey({ ...sdk, encryptPrivateRecord: async (request) => {
    captured = request.plaintext; return sdk.encryptPrivateRecord(request);
  }, decryptPrivateRecord: (request) => sdk.decryptPrivateRecord(request) }, fp, 0, KEY, current);
  assert.ok(captured!.every((byte) => byte === 0));
  const malformed = new TextEncoder().encode('this is secret invalid JSON');
  await assert.rejects(decryptImportedKey({ encryptPrivateRecord: (request) => sdk.encryptPrivateRecord(request),
    async decryptPrivateRecord() { return malformed; } }, fp, encrypted.identity, encrypted.envelope, current), /^Error: IMPORTED_KEY_INVALID$/);
  assert.ok(malformed.every((byte) => byte === 0));
  await assert.rejects(encryptImportedKey(sdk, fp, 0, KEY, (() => Promise.resolve()) as any), /IMPORTED_KEY_INVALID/);
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

test('decrypt snapshots identity before awaits and rejects getters or repaired invalid input', async () => {
  const sdk = await crypto(), fp = 'a'.repeat(64), wrapped = await encryptImportedKey(sdk, fp, 3, KEY, current);
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>((r) => { entered = r; }), held = new Promise<void>((r) => { release = r; });
  const port = { encryptPrivateRecord: (p: Parameters<typeof sdk.encryptPrivateRecord>[0]) => sdk.encryptPrivateRecord(p),
    async decryptPrivateRecord(p: Parameters<typeof sdk.decryptPrivateRecord>[0]) { calls++; entered(); await held; return sdk.decryptPrivateRecord(p); } };
  const mutable = { ...wrapped.identity };
  const pending = decryptImportedKey(port, fp, mutable, wrapped.envelope, current);
  await started; mutable.index = 4; mutable.id = 'imported:60:4'; release();
  assert.equal(await pending, KEY);
  const bad = { ...wrapped.identity, index: 4 };
  const failed = decryptImportedKey(port, fp, bad, wrapped.envelope, current);
  bad.index = 3; await assert.rejects(failed); assert.equal(calls, 1);
  let getters = 0;
  const accessor = { ...wrapped.identity }; Object.defineProperty(accessor, 'id', { enumerable: true, get() { getters++; return wrapped.identity.id; } });
  await assert.rejects(decryptImportedKey(port, fp, accessor, wrapped.envelope, current));
  assert.equal(getters, 0); assert.equal(calls, 1);
});
