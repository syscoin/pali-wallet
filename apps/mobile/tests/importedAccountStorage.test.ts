import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SigningKey } from 'ethers/crypto';
import { computeAddress } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { NativeWalletCatalogue, WALLET_CATALOGUE_KEY, type NativeAccountRecord, type CatalogueRemovalCommit } from '../src/custody/walletCatalogue.ts';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { createNativeSignedRecordView } from '../src/custody/sharedSignedRecords.ts';
import { signedRecordTestSession } from './signedRecordTestSession.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { normalizeImportedKey } from '../src/custody/importedAccounts.ts';
import { importAccountWithRecovery, readImportedRecoverySecret, snapshotImportedRecoveryEntry, type ImportedRecoveryCrypto } from '../../../source/wallet/importedAccountRecovery.ts';
import { createAccountRecordTestFixture } from './accountRecordTestFixture.ts';
import { parseNativeAccountId } from '../src/custody/accountIdentity.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';

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
  const keyring = new sdk.SoftwareKeyring(sdk.createKeyringHost(storage), { captureEvmSubmission: null });
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
  const stage=await createAccountRecordTestFixture();
  await storage.keyringStorage.createManyIfAbsent(stage.pair);
  const root={...stage.identity,walletFingerprint:await storage.getWalletFingerprint()};
  await storage.keyringStorage.set(WALLET_CATALOGUE_KEY,stage.record(root.walletFingerprint));
  const open=async()=>{const model=new NativeWalletCatalogue(storage.keyringStorage);await model.reconcile(root,current);return model;};
  return {root,open,stage,get storage(){return storage;},
    async reopen(){await storage.close().catch(()=>undefined);storage=await SqliteWalletStorage.open(nodeConnection(file).connection,digest,INSTALLATION,false);},
    async close(){await stage.close();await storage.close().catch(()=>undefined);await rm(directory,{recursive:true,force:true});}};
}
const removalCommit = (f: Awaited<ReturnType<typeof fixture>>): CatalogueRemovalCommit =>
  (key, expected, value, guard) => f.storage.keyringStorage.compareAndSetMany(
    [{ key, expected, value }], guard
  );

async function importMutation(f: Awaited<ReturnType<typeof fixture>>, index = 0, key = KEY) {
  f.stage.useRecord(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord);
  const result=await f.stage.imported(key,`Imported ${index+1}`);assert.equal(result.account.id,index);
  f.stage.state.accounts.Imported[index]=result.account;
  return {kind:'import' as const,id:`imported:60:${index}`,account:result.account,recovery:result.recovery};
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
  for (const id of ['hd:60:9007199254740992', 'imported:60:-1', 'imported:60:01', 'Imported:60:0']) assert.throws(() => parseNativeAccountId(id));
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
    assert.equal(JSON.stringify(stored).includes(KEY), false); assert.equal(JSON.stringify(stored).includes('xprv'), true);
    await f.reopen();
    const reopened = await f.open();
    assert.deepEqual(await reopened.reconcile(f.root, current), shown);
    await reopened.mutate(shown.revision, { kind: 'rename', id: 'hd:60:0', label: 'Renamed HD' }, current);
    const changed = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    assert.deepEqual(changed.groups[0].accounts.Imported, (stored as any).groups[0].accounts.Imported);
    assert.equal(await f.storage.getWalletFingerprint(), f.root.walletFingerprint);
    assert.deepEqual(await f.storage.keyringStorage.get('vault'), pair);
  } finally { await f.close(); }
});

test('incomplete imported-account catalogue shapes are rejected without filling missing defaults', async () => {
  const f = await fixture();
  try {
    await f.open();
    const canonical = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    for (const field of ['groups', 'recovery', 'active']) {
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
      const state = await reopened.reconcile(f.root, current);
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
    state = await model.mutate(state.revision, { kind: 'remove', id: 'imported:60:0' }, current, removalCommit(f));
    assert.deepEqual(Object.keys(model.privateRecords.groups[0]!.accounts.Imported),[]);
    delete f.stage.state.accounts.Imported[0];
    const next = await importMutation(f, 0), { id: _nextId, ...nextInput } = next;
    const final = await model.mutate(state.revision, nextInput, current);
    assert.equal(final.active.accountId, 'imported:60:0');
    const stored = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    assert(!Object.hasOwn(stored,'retiredImportedIndices')); assert.equal(Object.keys(stored.groups[0].accounts.Imported).length,1);
    assert.equal(stored.groups[0].accounts.Imported[0].id,0);
  } finally { await f.close(); }
});

test('SDK gap reuse keeps imported zero before a retained imported one across storage reopen', async () => {
  const f = await fixture();
  try {
    const model = await f.open();
    const first = await importMutation(f, 0), { id: _firstId, ...firstInput } = first;
    let state = await model.mutate(0, firstInput, current);
    const secondKey = '0x' + '2'.padStart(64, '0');
    const second = await importMutation(f, 1, secondKey), { id: _secondId, ...secondInput } = second;
    state = await model.mutate(state.revision, secondInput, current);
    const before = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    const retained = before.groups[0]!.accounts.Imported[1];
    state = await model.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
    state = await model.mutate(state.revision, { kind: 'remove', id: 'imported:60:0' }, current, removalCommit(f));
    delete f.stage.state.accounts.Imported[0];
    const replacementKey = '0x' + '3'.padStart(64, '0');
    const replacement = await importMutation(f, 0, replacementKey), { id: _replacementId, ...replacementInput } = replacement;
    state = await model.mutate(state.revision, replacementInput, current);
    const stored = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    assert.deepEqual(Object.values(stored.groups[0]!.accounts.Imported).map(account=>account.id),[0,1]);
    assert.deepEqual(stored.groups[0]!.accounts.Imported[1],retained);
    assert(!Object.hasOwn(stored,'nextImportedIndex')); assert(!Object.hasOwn(stored,'retiredImportedIndices'));
    await f.reopen();
    const reopened = await f.open();
    assert.deepEqual(await reopened.reconcile(f.root, current), state);
    assert.equal(await openSecret(f.stage.keyring, stored.recovery.find(entry=>entry.identity.id===0)!), replacementKey);
    assert.equal(await openSecret(f.stage.keyring, stored.recovery.find(entry=>entry.identity.id===1)!), secondKey);
  } finally { await f.close(); }
});

test('HD and Imported aliases share one sender-owned pending record with immutable signer attribution', async () => {
  const f = await fixture();
  try {
    const session = signedRecordTestSession(current);
    await f.storage.recovery.bindIdentity(f.root.walletFingerprint, { ...f.stage.identity, profileId: await session.keyring.getPrivateRecordProfileId() }, current);
    const records = new EvmSignedRecords(f.storage.signedRecords, () => 1);
    const signer = new Wallet(KEY), network = getNativeNetwork('ethereum');
    const hd = createNativeSignedRecordView(records, session, f.root.walletFingerprint, { index: 0, type: 'HDAccount', address: signer.address }, network);
    const imported = createNativeSignedRecordView(records, session, f.root.walletFingerprint, { index: 0, type: 'Imported', address: signer.address }, network);
    const raw = await signer.signTransaction({ type: 2, chainId: 1, nonce: 0, to: identity.address, value: 1, gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 });
    const signed = await hd.saveSigned(raw);
    await assert.rejects(imported.saveSigned(raw), {
      code: 'EVM_SIGNED_RECORD_NONCE_CONFLICT',
      recoveryHash: signed.hash,
      transactionNotBroadcast: true,
    });
    const values = await records.listSender(session, '1', signer.address);
    assert.equal(values.length, 1, 'a competing ordinary send cannot create a second alias record');
    assert.deepEqual(values[0]!.signer, { id: 0, type: 'HDAccount' });
    assert.equal((await imported.load())!.rawTransaction, raw);
    assert.equal((await hd.load())!.hash, signed.hash);
    await imported.transition(signed.hash, 'submitted');
    assert.equal((await hd.load())!.phase, 'submitted');
    assert.deepEqual((await records.readExact(session, '1', signer.address, signed.hash))!.signer, { id: 0, type: 'HDAccount' });
    const next = await signer.signTransaction({ type: 2, chainId: 1, nonce: 1, to: identity.address, value: 2, gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 });
    const nextSigned = await imported.saveSigned(next);
    const both = await records.listSender(session, '1', signer.address.toLowerCase());
    assert.equal(both.length, 2); assert.equal(new Set(both.map((row) => row.hash)).size, 2);
    assert.deepEqual(both.find((row) => row.hash === nextSigned.hash)!.signer, { id: 0, type: 'Imported' });
    const otherChain = createNativeSignedRecordView(records, session, f.root.walletFingerprint, { index: 0, type: 'Imported', address: signer.address }, getNativeNetwork('base'));
    assert.equal(await otherChain.load(), null);
    const encoded = await f.storage.signedRecords.read(await session.keyring.getPrivateRecordProfileId());
    await f.reopen();
    const retained = new EvmSignedRecords(f.storage.signedRecords);
    assert.equal(await retained.validate(session), 2);
    assert.equal(await f.storage.signedRecords.read(await session.keyring.getPrivateRecordProfileId()), encoded);
    assert.equal((await retained.readExact(session, '1', signer.address, signed.hash))!.rawTransaction, raw);
    assert.equal((await retained.readExact(session, '1', signer.address, nextSigned.hash))!.rawTransaction, next);
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

test('complete account maps retain imported recovery above the former twenty-account UI limit',async()=>{
 const f=await fixture();try{
  const model=await f.open();let state=await model.reconcile(f.root,current);
  const {id:_id,...input}=await importMutation(f);state=await model.mutate(state.revision,input,current);
  for(let index=1;index<=20;index++)state=await model.mutate(state.revision,{kind:'create',account:await f.stage.derive(index)},current);
  const {id:_other,...second}=await importMutation(f,1,'0x'+'2'.padStart(64,'0'));state=await model.mutate(state.revision,second,current);
  assert.equal(state.accounts.length,23);
  const original=await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
  for(const change of ['identity','missing-recovery','missing-key'] as const){
   const corrupted=structuredClone(original);
   if(change==='identity')corrupted.groups[0]!.accounts.Imported[0]!.address=f.root.address;
   if(change==='missing-recovery')(corrupted as any).recovery=[];
   if(change==='missing-key')corrupted.groups[0]!.accounts.Imported[0]!.xprv='';
   await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY,corrupted);await assert.rejects(f.open());
   assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY),corrupted);
  }
 }finally{await f.close();}
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

test('obsolete counter fields are rejected without changing canonical SDK slot reuse',async()=>{
 const f=await fixture();try{
  const original=await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
  const unsupported={...original,nextImportedIndex:4096,retiredImportedIndices:[0]};
  await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY,unsupported);await assert.rejects(f.open());
  assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY),unsupported);
  await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY,original);
  const model=await f.open(),{id:_id,...input}=await importMutation(f);
  const result=await model.mutate(original.revision,input,current);assert.equal(result.active.accountId,'imported:60:0');
  assert(!Object.hasOwn(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as object,'nextImportedIndex'));
 }finally{await f.close();}
});
