import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import {
  NativeWalletCatalogue, WALLET_CATALOGUE_KEY, replaceRecoveredAccountRecords, catalogueEvmNetworks,
  captureNativeInfrastructurePayerReference, type CatalogueMutation, type NativeInfrastructurePending,
} from '../src/custody/walletCatalogue.ts';
import { createNativeNetwork, getNativeNetwork } from '../src/custody/networkContext.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { createAccountRecordTestFixture } from './accountRecordTestFixture.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';

const current = () => undefined;
const hash = (byte: string) => `0x${byte.repeat(32)}`;
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-infrastructure-catalogue-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage = await SqliteWalletStorage.open(nodeConnection(file, hooks).connection, digest, INSTALLATION, true);
  const sdk = await createAccountRecordTestFixture();
  await storage.keyringStorage.createManyIfAbsent(sdk.pair);
  const identity = { walletFingerprint: await storage.getWalletFingerprint(), ...sdk.identity };
  await storage.keyringStorage.set(WALLET_CATALOGUE_KEY, sdk.record(identity.walletFingerprint));
  let catalogue = new NativeWalletCatalogue(storage.keyringStorage);
  await catalogue.reconcile(identity, current);
  const change = (mutation: CatalogueMutation, guard = current) => mutation.kind === 'remove'
    ? catalogue.mutate(catalogue.privateRecords.revision, mutation, guard,
      (key, expected, value, check) => storage.keyringStorage.compareAndSetMany([{ key, expected, value }], check))
    : catalogue.mutate(catalogue.privateRecords.revision, mutation, guard);
  const payer = await sdk.derive(1, 'Infrastructure payer');
  await change({ kind: 'create', account: payer });
  await change({ kind: 'select', id: 'hd:60:0' });
  const network = getNativeNetwork('ethereum', catalogueEvmNetworks(catalogue.privateRecords));
  const pending: NativeInfrastructurePending = {
    chainId: network.chainId, networkId: network.id, registrationHash: network.registrationHash,
    payer: { id: 'hd:60:1', address: payer.address, xpub: payer.xpub.toLowerCase() },
    entry: { attemptId: hash('11'), contractId: 'factory', nonce: 7, payerAddress: payer.address, rpcUrl: network.rpcUrl },
  };
  return {
    sdk, identity, pending, network, change,
    get storage() { return storage; }, get catalogue() { return catalogue; },
    async reopen() {
      await storage.close().catch(() => undefined);
      storage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, false);
      catalogue = new NativeWalletCatalogue(storage.keyringStorage);
      return catalogue.reconcile(identity, current);
    },
    async cleanup() { await sdk.close(); await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}
const store = (f: Awaited<ReturnType<typeof fixture>>) => f.change({
  kind: 'set-infrastructure-pending', chainId: f.pending.chainId, expectedAttemptId: null, pending: f.pending,
});
const clear = (f: Awaited<ReturnType<typeof fixture>>, expectedAttemptId = f.pending.entry.attemptId) => f.change({
  kind: 'set-infrastructure-pending', chainId: f.pending.chainId, expectedAttemptId, pending: null,
});

async function ledgerPayer(f: Awaited<ReturnType<typeof fixture>>) {
  const derived = await f.sdk.derive(2, 'Ledger fee payer');
  // Public metadata only. Device ownership is verified by the runtime, not this catalogue test.
  const account = { ...derived, id: 0, xprv: '', isLedgerWallet: true, isImported: false, isTrezorWallet: false, isSmartAccount: false };
  await f.change({ kind: 'import-ledger', account });
  return { account, reference: { id: 'ledger:60:0', address: account.address, xpub: `0x${account.xpub.replace(/^0x/, '')}`.toLowerCase() } };
}

test('Ledger infrastructure reservations persist, retain their exact public payer and protect removal', async () => {
  const f = await fixture();
  try {
    const { account, reference } = await ledgerPayer(f);
    f.pending = { ...f.pending, payer: reference, entry: { ...f.pending.entry, payerAddress: reference.address } };
    await store(f); await f.reopen();
    assert.deepEqual(f.catalogue.privateRecords.infrastructurePending, [f.pending]);
    assert.equal(f.catalogue.privateRecords.groups[0]!.accounts.Ledger[0]!.xprv, '');
    await f.change({ kind: 'rename', id: reference.id, label: 'Renamed Ledger fee payer' });
    await f.change({ kind: 'select', id: 'hd:60:0' });
    await assert.rejects(f.change({ kind: 'remove', id: reference.id }));
    const before = f.catalogue.privateRecords;
    const recovered = replaceRecoveredAccountRecords(before, f.identity.walletFingerprint, before.groups);
    assert.deepEqual(recovered.infrastructurePending, [f.pending]);
    assert.equal(recovered.groups[0]!.accounts.Ledger[0]!.address, account.address);
    await clear(f);
    await f.change({ kind: 'remove', id: reference.id });
    assert.equal(f.catalogue.privateRecords.groups[0]!.accounts.Ledger[0], undefined);
  } finally { await f.cleanup(); }
});

test('infrastructure payer capture verifies public identity and does not turn hardware into software', async () => {
  const f = await fixture();
  try {
    const { reference } = await ledgerPayer(f);
    const record = f.catalogue.privateRecords;
    const captured = captureNativeInfrastructurePayerReference(reference, record);
    assert.deepEqual(captured, reference); assert(Object.isFrozen(captured));
    assert.deepEqual(captureNativeInfrastructurePayerReference({ ...reference, xpub: reference.xpub.slice(2) }, record), reference);
    assert.deepEqual(captureNativeInfrastructurePayerReference(f.pending.payer, record), f.pending.payer);
    for (const invalid of [
      { ...reference, id: 'ledger:0:0' }, { ...reference, id: 'ledger:60:1' },
      { ...reference, id: 'hd:60:0' }, { ...reference, id: 'trezor:60:0' },
      { ...reference, address: f.identity.address }, { ...reference, xpub: f.identity.publicKey },
      { ...reference, secret: 'not public metadata' },
    ]) assert.throws(() => captureNativeInfrastructurePayerReference(invalid, record));
    for (const invalid of [
      { id: 1 }, { isLedgerWallet: false }, { isImported: true }, { isTrezorWallet: true },
      { isSmartAccount: true }, { xprv: 'software ciphertext must not enter hardware records' },
    ]) {
      const changed = structuredClone(record);
      Object.assign(changed.groups[0]!.accounts.Ledger[0]!, invalid);
      assert.throws(() => captureNativeInfrastructurePayerReference(reference, changed));
    }
    const missingSoftwareSecret = structuredClone(record);
    missingSoftwareSecret.groups[0]!.accounts.HDAccount[1]!.xprv = '';
    assert.throws(() => captureNativeInfrastructurePayerReference(f.pending.payer, missingSoftwareSecret));
  } finally { await f.cleanup(); }
});

test('infrastructure attempts reopen durably, stay private and survive account labels and recovery replacement', async () => {
  const f = await fixture();
  try {
    const projection = await store(f);
    assert.equal('infrastructurePending' in projection, false);
    assert.deepEqual(f.catalogue.privateRecords.infrastructurePending, [f.pending]);
    await f.reopen();
    assert.deepEqual(f.catalogue.privateRecords.infrastructurePending, [f.pending]);
    await f.change({ kind: 'rename', id: f.pending.payer.id, label: 'Renamed payer' });
    await f.change({ kind: 'save-network', registration: f.network });
    const before = f.catalogue.privateRecords;
    const recovered = replaceRecoveredAccountRecords(before, f.identity.walletFingerprint, before.groups);
    assert.deepEqual(recovered.infrastructurePending, [f.pending]);
    assert.deepEqual(recovered.groups, before.groups);
  } finally { await f.cleanup(); }
});

test('infrastructure compare mutations admit only the same immutable attempt and monotonically add its hash', async () => {
  const f = await fixture();
  try {
    await store(f);
    await assert.rejects(store(f));
    const acknowledged = { ...f.pending, entry: { ...f.pending.entry, transactionHash: hash('22') } };
    const update = (pending: NativeInfrastructurePending, expectedAttemptId = f.pending.entry.attemptId) => f.change({
      kind: 'set-infrastructure-pending', chainId: f.pending.chainId, expectedAttemptId, pending,
    });
    for (const pending of [
      { ...f.pending, entry: { ...f.pending.entry, nonce: 8 } },
      { ...f.pending, entry: { ...f.pending.entry, attemptId: hash('33') } },
      { ...f.pending, entry: { ...f.pending.entry, contractId: 'ecdsaValidator' as const } },
      { ...f.pending, entry: { ...f.pending.entry, rpcUrl: 'https://alias.example' } },
      { ...f.pending, payer: { ...f.pending.payer, xpub: f.identity.publicKey } },
    ]) await assert.rejects(update(pending));
    await assert.rejects(update(acknowledged, hash('44')));
    await update(acknowledged); await update(acknowledged);
    await assert.rejects(update(f.pending));
    await assert.rejects(update({ ...acknowledged, entry: { ...acknowledged.entry, transactionHash: hash('55') } }));
    await f.reopen(); assert.deepEqual(f.catalogue.privateRecords.infrastructurePending, [acknowledged]);
    await assert.rejects(clear(f, hash('44')));
    await clear(f);
    const next = { ...f.pending, entry: { ...f.pending.entry, attemptId: hash('66'), nonce: 8 } };
    await f.change({ kind: 'set-infrastructure-pending', chainId: next.chainId, expectedAttemptId: null, pending: next });
    await assert.rejects(clear(f));
    assert.deepEqual(f.catalogue.privateRecords.infrastructurePending, [next]);
  } finally { await f.cleanup(); }
});

test('canonical infrastructure rows reject omitted ownership, unknown contracts and duplicate chain aliases', async () => {
  const f = await fixture();
  try {
    const base = f.catalogue.privateRecords;
    const missing = (field: string) => { const entry = { ...f.pending.entry }; Reflect.deleteProperty(entry, field); return { ...f.pending, entry }; };
    const rows: unknown[] = [
      ...['attemptId', 'nonce', 'payerAddress', 'rpcUrl'].map(missing),
      { ...f.pending, networkId: 'not-registered' },
      { ...f.pending, chainId: '01' },
      { ...f.pending, chainId: '2' },
      { ...f.pending, registrationHash: hash('77') },
      { ...f.pending, payer: { ...f.pending.payer, id: 'ledger:60:1' } },
      { ...f.pending, payer: { ...f.pending.payer, id: 'smart:60:1' } },
      { ...f.pending, entry: { ...f.pending.entry, contractId: 'unknown-contract' } },
      { ...f.pending, entry: { ...f.pending.entry, nonce: -1 } },
      { ...f.pending, entry: { ...f.pending.entry, nonce: Number.MAX_SAFE_INTEGER + 1 } },
      { ...f.pending, entry: { ...f.pending.entry, transactionHash: 'invalid' } },
      { ...f.pending, entry: { ...f.pending.entry, payerAddress: f.identity.address } },
      { ...f.pending, entry: { ...f.pending.entry, extra: 'unrecognized' } },
      { ...f.pending, entry: { ...f.pending.entry, rpcUrl: 'https://alias.example' } },
      { ...f.pending, extra: true },
    ];
    for (const row of rows) {
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, { ...base, infrastructurePending: [row] });
      await assert.rejects(f.reopen());
    }
    await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, { ...base, infrastructurePending: [structuredClone(f.pending), structuredClone({ ...f.pending, entry: { ...f.pending.entry, attemptId: hash('88') } })] });
    await assert.rejects(f.reopen());
    await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, { ...base, infrastructurePending: Array.from({ length: base.networks.length + 1 }, () => structuredClone(f.pending)) });
    await assert.rejects(f.reopen());
  } finally { await f.cleanup(); }
});

test('infrastructure reservations are independent across explicitly registered chains', async () => {
  const f = await fixture();
  try {
    await store(f);
    const network = catalogueEvmNetworks(f.catalogue.privateRecords).find(network => network.chainId !== f.pending.chainId)!;
    const second: NativeInfrastructurePending = { ...f.pending, chainId: network.chainId, networkId: network.id, registrationHash: network.registrationHash,
      entry: { ...f.pending.entry, attemptId: hash('22'), rpcUrl: network.rpcUrl } };
    await f.change({ kind: 'set-infrastructure-pending', chainId: second.chainId, expectedAttemptId: null, pending: second });
    await clear(f); await f.reopen();
    assert.deepEqual(f.catalogue.privateRecords.infrastructurePending, [second]);
  } finally { await f.cleanup(); }
});

test('unresolved infrastructure retains its payer and exact network registration until compare clear', async () => {
  const f = await fixture();
  try {
    await store(f);
    await assert.rejects(f.change({ kind: 'remove', id: f.pending.payer.id }), /CATALOGUE_NOT_REMOVABLE/);
    await assert.rejects(f.change({ kind: 'save-network', registration: createNativeNetwork({ ...f.network, rpcUrl: 'https://alias.example' }) }));
    await assert.rejects(f.change({ kind: 'save-network', registration: createNativeNetwork({ ...f.network, name: 'Renamed network' }) }));
    const other = catalogueEvmNetworks(f.catalogue.privateRecords).find(network => network.chainId !== f.pending.chainId)!;
    await f.change({ kind: 'select-network', id: other.id });
    await assert.rejects(f.change({ kind: 'remove-network', id: f.network.id }));
    await clear(f);
    await f.change({ kind: 'remove', id: f.pending.payer.id });
    await f.change({ kind: 'remove-network', id: f.network.id });
    await f.reopen(); assert.deepEqual(f.catalogue.privateRecords.infrastructurePending, []);
  } finally { await f.cleanup(); }
});

for (const action of ['reserve', 'clear'] as const) for (const lostAck of [false, true]) test(`infrastructure ${action} ${lostAck ? 'lost acknowledgement' : 'revoked owner'} preserves guarded SQL semantics`, async () => {
  let enabled = false, live = true;
  const f = await fixture({ after(kind, sql) {
    if (!enabled) return;
    if (lostAck && kind === 'exec' && sql === 'COMMIT') { enabled = false; throw Error('lost acknowledgement'); }
    if (!lostAck && kind === 'run' && sql.startsWith('UPDATE keyring_records')) { enabled = false; live = false; }
  } });
  try {
    if (action === 'clear') await store(f);
    enabled = true;
    await assert.rejects(f.change({ kind: 'set-infrastructure-pending', chainId: f.pending.chainId,
      expectedAttemptId: action === 'clear' ? f.pending.entry.attemptId : null, pending: action === 'clear' ? null : f.pending },
      () => { if (!live) throw Error('owner revoked'); }));
    await f.reopen();
    assert.equal(f.catalogue.privateRecords.infrastructurePending?.length ?? 0, action === 'clear' ? (lostAck ? 0 : 1) : (lostAck ? 1 : 0));
  } finally { await f.cleanup(); }
});

test('infrastructure pending survives Activity Reset and is removed only with the wallet catalogue', async () => {
  const f = await fixture();
  try {
    await store(f);
    const profileId = await f.sdk.keyring.getPrivateRecordProfileId();
    await f.storage.recovery.bindIdentity(f.identity.walletFingerprint, { address: f.identity.address, publicKey: f.identity.publicKey, profileId }, current);
    const records = new EvmSignedRecords(f.storage.signedRecords);
    const session = records.captureSession({ keyring: f.sdk.keyring, assertCurrent: current });
    await records.clearScope(session, { profileId, chainId: f.pending.chainId, from: f.pending.payer.address });
    await f.reopen(); assert.deepEqual(f.catalogue.privateRecords.infrastructurePending, [f.pending]);
    await f.storage.removal.commit(await f.storage.recovery.readSnapshot(), current);
    await assert.rejects(f.reopen());
    assert.equal(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), undefined);
  } finally { await f.cleanup(); }
});
