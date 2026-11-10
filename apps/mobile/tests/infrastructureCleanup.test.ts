import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureInfrastructureCleanupStorage } from '../src/custody/infrastructureCleanup.ts';
import { NATIVE_PUBLIC_SESSION_KEY, type NativePublicSessionRecord } from '../src/custody/publicSession.ts';
import { NativeWalletCatalogue, WALLET_CATALOGUE_KEY, catalogueEvmNetworks, recoveryVerificationRecords, type NativeInfrastructurePending, type NativeAccountRecord } from '../src/custody/walletCatalogue.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import type { KeyringStoragePort, WalletIdentityRead } from '../src/storage/types.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';

const current = () => {};
const sdk = await loadNativeKeyringSdk();
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-infrastructure-cleanup-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage = await SqliteWalletStorage.open(nodeConnection(file, hooks).connection, digest, INSTALLATION, true);
  let ring!: InstanceType<typeof sdk.HostKeyring>;
  const runtime = await createKeyringRuntimeFactory({
    ensureCryptoReady: async () => {}, openStorage: async () => storage,
    loadSdk: async () => ({ ...sdk, HostKeyring: class extends sdk.HostKeyring {
      constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) { super(...args); ring = this; }
    } }), pinCredential: createTestPinCredentialPort(),
    async requestOperationCredential() { throw Error('Detached cleanup must not request credentials'); },
    readEvmRetirement: null, privacyServiceSettings: null, slhExecution: null,
  }).open() as KeyringRuntime;
  await runtime.session.importWallet('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '123456');
  const identity = (await storage.recovery.readIdentity())!;
  const record = recoveryVerificationRecords(await storage.keyringStorage.get(WALLET_CATALOGUE_KEY), identity.walletBindingId);
  const checkpoint = await storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY) as NativePublicSessionRecord;
  const catalogue = new NativeWalletCatalogue(storage.keyringStorage), root = { walletFingerprint: identity.walletBindingId,
    address: identity.root!.address, publicKey: identity.root!.publicKey };
  await catalogue.reconcile(root, current);
  const network = catalogueEvmNetworks(record)[0]!;
  const pending: NativeInfrastructurePending = { chainId: network.chainId, networkId: network.id, registrationHash: network.registrationHash,
    payer: { id: 'hd:60:0', address: root.address, xpub: root.publicKey },
    entry: { attemptId: '0x' + '11'.repeat(32), contractId: 'factory', nonce: 7, payerAddress: root.address, rpcUrl: network.rpcUrl } };
  let readIdentity = async (): Promise<WalletIdentityRead | null> => storage.recovery.readIdentity();
  let raw: KeyringStoragePort = storage.keyringStorage;
  const owner = { identity, checkpoint, records: record };
  const factory = () => captureInfrastructureCleanupStorage(raw, () => readIdentity(), owner);
  const create = factory();
  await catalogue.mutate(record.revision, { kind: 'set-infrastructure-pending', chainId: network.chainId, expectedAttemptId: null, pending }, current);
  const before = await storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
  const after = { ...before, revision: before.revision + 1, infrastructurePending: [] };
  return { runtime, ring, pending, before, after, root, checkpoint, owner, create, factory,
    get storage() { return storage; },
    identity(value: WalletIdentityRead) { readIdentity = async () => value; },
    port(value: KeyringStoragePort) { raw = value; },
    async reopen() { await storage.close().catch(() => {}); storage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, false); },
    async close() { await runtime.storage.close().catch(() => {}); await storage.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); },
  };
}

test('detached infrastructure cleanup keeps the authenticated checkpoint unchanged with the SDK locked', async () => {
  const f = await fixture();
  try {
    await f.runtime.session.lock();
    const cleanup = new NativeWalletCatalogue(f.create(f.before, f.pending, current));
    await cleanup.reconcile(f.root, current);
    await cleanup.mutate(f.before.revision, { kind: 'set-infrastructure-pending', chainId: f.pending.chainId,
      expectedAttemptId: f.pending.entry.attemptId, pending: null }, current);
    assert.deepEqual(cleanup.privateRecords.infrastructurePending, []);
    assert.deepEqual(await f.storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY), f.checkpoint);
    assert.equal(f.ring.isUnlocked(), false);
  } finally { await f.close(); }
});

for (const change of ['label', 'nonce', 'network'] as const) test(`cleanup rejects an additional ${change} catalogue mutation`, async () => {
  const f = await fixture();
  try {
    const labelled = structuredClone(f.after);
    labelled.groups[0]!.accounts.HDAccount[0]!.label = 'Changed label';
    const after = change === 'label' ? labelled : change === 'nonce'
      ? { ...f.after, infrastructurePending: [{ ...f.pending, entry: { ...f.pending.entry, nonce: 8 } }] }
      : { ...f.after, active: { ...f.after.active, networkId: 'not-the-admitted-network' } };
    await assert.rejects(f.create(f.before, f.pending, current).compareAndSet(WALLET_CATALOGUE_KEY, f.before, after, undefined, current));
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), f.before);
  } finally { await f.close(); }
});

for (const change of ['checkpoint', 'identity'] as const) test(`cleanup rejects a changed authenticated ${change}`, async () => {
  const f = await fixture();
  try {
    if (change === 'checkpoint') await f.storage.keyringStorage.set(NATIVE_PUBLIC_SESSION_KEY, { ...f.checkpoint, checkpoint: { ...f.checkpoint.checkpoint, ciphertext: 'AQ==' } });
    else f.identity({ ...f.owner.identity, root: { ...f.owner.identity.root!, profileId: '0x' + '22'.repeat(32) } });
    await assert.rejects(f.create(f.before, f.pending, current).compareAndSet(WALLET_CATALOGUE_KEY, f.before, f.after, undefined, current));
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), f.before);
  } finally { await f.close(); }
});

test('checkpoint replacement between validation and the atomic CAS cannot delete the pending attempt', async () => {
  const f = await fixture();
  try {
    const storage = f.storage.keyringStorage;
    f.port({ ...storage, async compareAndSetMany(changes, guard) {
      await storage.set(NATIVE_PUBLIC_SESSION_KEY, { ...f.checkpoint, checkpoint: { ...f.checkpoint.checkpoint, ciphertext: 'AQ==' } });
      return storage.compareAndSetMany(changes, guard);
    } });
    const cleanup = new NativeWalletCatalogue(f.factory()(f.before, f.pending, current));
    await cleanup.reconcile(f.root, current);
    await assert.rejects(cleanup.mutate(f.before.revision, { kind: 'set-infrastructure-pending', chainId: f.pending.chainId,
      expectedAttemptId: f.pending.entry.attemptId, pending: null }, current));
    assert.deepEqual(await storage.get(WALLET_CATALOGUE_KEY), f.before);
  } finally { await f.close(); }
});

test('revocation before commit rolls back the exact pending removal', async () => {
  let armed = false, active = true;
  const f = await fixture({ after(kind, sql) { if (armed && kind === 'run' && sql.startsWith('UPDATE keyring_records')) { armed = false; active = false; } } });
  try {
    const guard = () => { if (!active) throw Error('Owner retired'); };
    const cleanup = new NativeWalletCatalogue(f.create(f.before, f.pending, guard));
    await cleanup.reconcile(f.root, guard);
    armed = true;
    await assert.rejects(cleanup.mutate(f.before.revision, { kind: 'set-infrastructure-pending', chainId: f.pending.chainId,
      expectedAttemptId: f.pending.entry.attemptId, pending: null }, guard), /Owner retired/);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), f.before);
  } finally { await f.close(); }
});

test('a lost cleanup COMMIT acknowledgement marks the detached catalogue uncertain', async () => {
  let armed = false;
  const f = await fixture({ after(kind, sql) { if (armed && kind === 'exec' && sql === 'COMMIT') { armed = false; throw Error('Lost ACK'); } } });
  try {
    const cleanup = new NativeWalletCatalogue(f.create(f.before, f.pending, current));
    await cleanup.reconcile(f.root, current); armed = true;
    await assert.rejects(cleanup.mutate(f.before.revision, { kind: 'set-infrastructure-pending', chainId: f.pending.chainId,
      expectedAttemptId: f.pending.entry.attemptId, pending: null }, current));
    assert.equal(cleanup.requiresReopen, true);
    await f.reopen();
    assert.deepEqual((await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as typeof f.before).infrastructurePending, []);
    assert.deepEqual(await f.storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY), f.checkpoint);
  } finally { await f.close(); }
});

test('cleanup rejects alternate keys, write APIs, pending substitutions and asynchronous guards', async () => {
  const f = await fixture();
  try {
    const storage = f.create(f.before, f.pending, current);
    await assert.rejects(storage.set(WALLET_CATALOGUE_KEY, f.after));
    await assert.rejects(storage.deleteItem(WALLET_CATALOGUE_KEY));
    await assert.rejects(storage.createManyIfAbsent({ [WALLET_CATALOGUE_KEY]: f.after }));
    await assert.rejects(storage.compareAndSetMany([{ key: WALLET_CATALOGUE_KEY, expected: f.before, value: f.after }], current));
    await assert.rejects(storage.compareAndSet('other-key', f.before, f.after, undefined, current));
    await assert.rejects(storage.compareAndSet(WALLET_CATALOGUE_KEY, f.before, f.after, {}, current));
    assert.throws(() => f.create(f.before, { ...f.pending, entry: { ...f.pending.entry, nonce: 8 } }, current));
    await assert.rejects(f.create(f.before, f.pending, async () => {}).get(WALLET_CATALOGUE_KEY));
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), f.before);
  } finally { await f.close(); }
});
