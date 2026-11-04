import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeAddress } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { NativeTransferJournal, nativeTransferJournalKey } from '../src/custody/transferJournal.ts';
import { SigningKey } from 'ethers/crypto';

import { NativeWalletCatalogue, WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection, validPair, type SqlHook } from './storageHelpers.ts';

// Public secp256k1 generator; never a wallet secret.
const PUBLIC_KEY = '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const ADDRESS = computeAddress(PUBLIC_KEY);
const current = () => undefined;
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-catalogue-'));
  const file = path.join(directory, 'wallet.sqlite');
  let owned = nodeConnection(file, hooks);
  let storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, true);
  await storage.keyringStorage.createManyIfAbsent(validPair());
  const identity = { walletFingerprint: await storage.getWalletFingerprint(), address: ADDRESS, publicKey: PUBLIC_KEY };
  return {
    identity,
    get storage() { return storage; },
    async reopen() {
      await storage.close().catch(() => undefined);
      owned = nodeConnection(file);
      storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false);
    },
    async cleanup() { await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}

test('legacy wallet migration is durable, idempotent and exposes no key or fingerprint', async () => {
  const f = await fixture();
  try {
    const before = await f.storage.keyringStorage.get('vault');
    const snapshot = await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
    assert.equal(snapshot.accounts[0]?.address, ADDRESS);
    assert.deepEqual(snapshot.active, { accountId: 'hd:60:0', networkId: 'ethereum' });
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.accounts[0]), true);
    assert.equal('publicKey' in snapshot.accounts[0]!, false);
    assert.equal('walletFingerprint' in snapshot, false);
    const committed = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    assert.equal(JSON.stringify(committed).includes('xprv'), false);
    await f.reopen();
    assert.deepEqual(await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current), snapshot);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), committed);
    assert.equal(await f.storage.keyringStorage.get('vault'), before);
  } finally { await f.cleanup(); }
});

for (const point of ['before-commit', 'lost-ack'] as const) {
  test(`catalogue ${point} requires reopen and preserves the original wallet`, async () => {
    let enabled = false;
    const fail: SqlHook = (kind, sql) => {
      if (enabled && kind === 'exec' && sql === 'COMMIT') { enabled = false; throw Error('simulated interruption'); }
    };
    const f = await fixture(point === 'lost-ack' ? { after: fail } : { before: fail });
    try {
      const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
      enabled = true;
      await assert.rejects(catalogue.reconcile(f.identity, current));
      await assert.rejects(catalogue.reconcile(f.identity, current), /CATALOGUE_REOPEN_REQUIRED/);
      await f.reopen();
      assert.equal(await f.storage.getWalletFingerprint(), f.identity.walletFingerprint);
      const prior = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
      assert.equal(prior === undefined, point === 'before-commit');
      const resumed = await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
      assert.equal(resumed.accounts[0]?.address, ADDRESS);
      if (point === 'lost-ack') assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), prior);
    } finally { await f.cleanup(); }
  });
}

test('corrupt, foreign-wallet and unsupported catalogues never become replacement migrations', async () => {
  const f = await fixture();
  try {
    await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
    const original = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as Record<string, any>;
    const cases = [
      { ...original, version: 3 },
      { ...original, walletFingerprint: 'aa'.repeat(32) },
      { ...original, xprv: 'forbidden field' },
      { ...original, accounts: [{ ...original.accounts[0], address: '0x1111111111111111111111111111111111111111' }] },
      { ...original, accounts: [{ ...original.accounts[0], publicKey: '0x04' }] },
      { ...original, accounts: [...original.accounts, { ...original.accounts[0] }] },
      { ...original, networks: [{ ...original.networks[0], rpcUrl: 'https://untrusted.invalid' }] },
      { ...original, active: { accountId: 'hd:60:1', networkId: 'ethereum' } },
    ];
    for (const value of cases) {
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, value);
      await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current), /CATALOGUE_INVALID/);
      assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), value);
    }
    await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile({ ...f.identity, publicKey: '0x04' }, current), /CATALOGUE_INVALID/);
    await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile({ ...f.identity, address: '0x1111111111111111111111111111111111111111' }, current), /CATALOGUE_INVALID/);
  } finally { await f.cleanup(); }
});

for (const phase of ['read', 'commit'] as const) {
  test(`revocation during catalogue ${phase} cannot publish stale context`, async () => {
    let enabled = false;
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const hook: SqlHook = async (kind, sql) => {
      if (enabled && (phase === 'read' ? kind === 'get' && sql.includes('FROM keyring_records WHERE key = ?') : kind === 'exec' && sql === 'COMMIT')) {
        enabled = false; entered(); await held;
      }
    };
    const f = await fixture({ after: hook });
    try {
      const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
      let generation = 0;
      const guard = () => { if (generation !== 0) throw Error('CANCELLED'); };
      enabled = true;
      const pending = catalogue.reconcile(f.identity, guard);
      await reached;
      generation++;
      release();
      await assert.rejects(pending, /CANCELLED/);
      const value = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
      assert.equal(value === undefined, phase === 'read');
      if (phase === 'commit') await assert.rejects(catalogue.reconcile(f.identity, current), /CATALOGUE_REOPEN_REQUIRED/);
      await f.reopen();
      assert.equal((await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current)).accounts[0]?.address, ADDRESS);
    } finally { release(); await f.cleanup(); }
  });
}

test('single-flight admission and atomic independent creators preserve one catalogue', async () => {
  const f = await fixture();
  try {
    const first = new NativeWalletCatalogue(f.storage.keyringStorage);
    const pending = first.reconcile(f.identity, current);
    await assert.rejects(first.reconcile(f.identity, current), /CATALOGUE_BUSY/);
    const second = new NativeWalletCatalogue(f.storage.keyringStorage);
    const [left, right] = await Promise.all([pending, second.reconcile(f.identity, current)]);
    assert.deepEqual(left, right);
    const record = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, async () => undefined), /CATALOGUE_CONTEXT_CHANGED/);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), record);
  } finally { await f.cleanup(); }
});


test('a reentrant current-context callback cannot start a second migration', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let reentered: Promise<unknown> | undefined;
    const result = await catalogue.reconcile(f.identity, () => {
      if (!reentered) {
        reentered = catalogue.reconcile(f.identity, current);
        void reentered.catch(() => undefined);
      }
    });
    await assert.rejects(reentered!, /CATALOGUE_BUSY/);
    assert.equal(result.accounts[0]?.address, ADDRESS);
  } finally { await f.cleanup(); }
});


const derived = (index: number) => {
  const publicKey = SigningKey.computePublicKey('0x' + (index + 2).toString(16).padStart(64, '0'));
  return { address: computeAddress(publicKey), publicKey };
};

test('HD allocation stays monotonic while removed identities can be explicitly restored', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    state = await catalogue.mutate(state.revision, { kind: 'create', index: 1, ...derived(1), label: 'Savings' }, current);
    assert.equal(state.active.accountId, 'hd:60:1');
    await assert.rejects(catalogue.mutate(state.revision, { kind: 'remove', id: 'hd:60:1', journal: null }, current), /CATALOGUE_NOT_REMOVABLE/);
    state = await catalogue.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
    await assert.rejects(catalogue.mutate(state.revision, { kind: 'remove', id: 'hd:60:0', journal: null }, current), /CATALOGUE_NOT_REMOVABLE/);
    state = await catalogue.mutate(state.revision, { kind: 'remove', id: 'hd:60:1', journal: null }, current);
    assert.deepEqual(state.removed, [{ id: 'hd:60:1', index: 1 }]);
    assert.equal(catalogue.nextIndex, 2);
    state = await catalogue.mutate(state.revision, { kind: 'create', index: 2, ...derived(2), label: 'New account' }, current);
    assert.equal(catalogue.nextIndex, 3);
    state = await catalogue.mutate(state.revision, { kind: 'restore', index: 1, ...derived(1), label: 'Restored savings' }, current);
    assert.equal(catalogue.nextIndex, 3);
    assert.equal(state.active.accountId, 'hd:60:1');
    assert.equal(state.accounts.find((a) => a.index === 1)?.address, derived(1).address);
    assert.deepEqual(state.removed, []);
    await f.reopen();
    const fresh = new NativeWalletCatalogue(f.storage.keyringStorage);
    const restored = await fresh.reconcile(f.identity, current, async (index) => derived(index));
    assert.deepEqual(restored, state);
    assert.equal(fresh.nextIndex, 3);
  } finally { await f.cleanup(); }
});

test('stale catalogue revision and independent CAS writers cannot overwrite committed account changes', async () => {
  const f = await fixture();
  try {
    const first = new NativeWalletCatalogue(f.storage.keyringStorage);
    const second = new NativeWalletCatalogue(f.storage.keyringStorage);
    const initial = await first.reconcile(f.identity, current);
    await second.reconcile(f.identity, current);
    const next = await first.mutate(initial.revision, { kind: 'create', index: 1, ...derived(1), label: 'Savings' }, current);
    await assert.rejects(first.mutate(initial.revision, { kind: 'rename', id: 'hd:60:0', label: 'Stale' }, current), /CATALOGUE_CONTEXT_CHANGED/);
    await assert.rejects(second.mutate(initial.revision, { kind: 'rename', id: 'hd:60:0', label: 'Racing' }, current), /CATALOGUE_CONTEXT_CHANGED/);
    assert.deepEqual(await second.reconcile(f.identity, current, async (index) => derived(index)), next);
  } finally { await f.cleanup(); }
});

test('every restored catalogue account is checked against freshly derived SDK identity', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    await catalogue.reconcile(f.identity, current);
    await catalogue.mutate(0, { kind: 'create', index: 1, ...derived(1), label: 'Savings' }, current);
    const committed = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current, async () => derived(2)), /CATALOGUE_INVALID/);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), committed);
  } finally { await f.cleanup(); }
});


test('indeterminate CAS outcome quarantines a catalogue until a fresh instance reconciles', async () => {
  const f = await fixture();
  try {
    const port = { ...f.storage.keyringStorage, async compareAndSet(...args: Parameters<typeof f.storage.keyringStorage.compareAndSet>) {
      await f.storage.keyringStorage.compareAndSet(...args);
      return undefined as unknown as boolean;
    } };
    const catalogue = new NativeWalletCatalogue(port);
    const state = await catalogue.reconcile(f.identity, current);
    await assert.rejects(catalogue.mutate(state.revision, { kind: 'rename', id: 'hd:60:0', label: 'Renamed' }, current), /CATALOGUE_INVALID/);
    assert.equal(catalogue.requiresReopen, true);
    await assert.rejects(catalogue.reconcile(f.identity, current), /CATALOGUE_REOPEN_REQUIRED/);
    assert.equal((await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current)).accounts[0]?.label, 'Renamed');
  } finally { await f.cleanup(); }
});

test('terminal-only removal keeps storage bounded through more than 64 HD account lifecycles', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    for (let index = 1; index <= 70; index++) {
      state = await catalogue.mutate(state.revision, { kind: 'create', index, ...derived(index), label: `Account ${index + 1}` }, current);
      const signer = new Wallet('0x' + (index + 2).toString(16).padStart(64, '0'));
      const journal = new NativeTransferJournal(f.storage.keyringStorage, { walletFingerprint: f.identity.walletFingerprint, address: signer.address, chainId: '1' }, current, () => 1, index);
      const signed = await journal.saveSigned(await signer.signTransaction({ type: 2, chainId: 1, nonce: 0, to: ADDRESS, value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }));
      state = await catalogue.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
      await assert.rejects(catalogue.mutate(state.revision, { kind: 'remove', id: `hd:60:${index}`, journal: signed }, current), /PENDING_TRANSFER/);
      await journal.transition(signed.hash, 'attempted');
      await journal.transition(signed.hash, 'confirmed');
      state = await catalogue.mutate(state.revision, { kind: 'remove', id: `hd:60:${index}`, journal: await journal.removalSnapshot() }, current);
      assert.equal(await f.storage.keyringStorage.get(nativeTransferJournalKey(index)), undefined);
    }
    assert.equal(state.accounts.length, 1);
    assert.equal(state.removed.length, 70);
    assert.equal(catalogue.nextIndex, 71);
    // A real cold reopen still admits all tombstones and can recover an early address.
    await f.reopen();
    const reopened = new NativeWalletCatalogue(f.storage.keyringStorage);
    state = await reopened.reconcile(f.identity, current, async (index) => derived(index));
    state = await reopened.mutate(state.revision, { kind: 'restore', index: 1, ...derived(1), label: 'Restored' }, current);
    assert.equal(state.accounts.find((account) => account.index === 1)?.address, derived(1).address);
    assert.equal(reopened.nextIndex, 71);
  } finally { await f.cleanup(); }
});

test('a journal appearing after the absence check prevents account removal atomically', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    state = await catalogue.mutate(state.revision, { kind: 'create', index: 1, ...derived(1), label: 'Savings' }, current);
    state = await catalogue.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
    const stored = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    await f.storage.keyringStorage.set(nativeTransferJournalKey(1), { phase: 'unexpected pending journal' });
    await assert.rejects(catalogue.mutate(state.revision, { kind: 'remove', id: 'hd:60:1', journal: null }, current), /CATALOGUE_CONTEXT_CHANGED/);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), stored);
    assert.deepEqual(await f.storage.keyringStorage.get(nativeTransferJournalKey(1)), { phase: 'unexpected pending journal' });
  } finally { await f.cleanup(); }
});


test('active-account and monotonic highwater limits fail explicitly without truncating restore history', async () => {
  const f = await fixture();
  try {
    let catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    for (let index = 1; index < 20; index++) state = await catalogue.mutate(state.revision, { kind: 'create', index, ...derived(index), label: `Account ${index + 1}` }, current);
    await assert.rejects(catalogue.mutate(state.revision, { kind: 'create', index: 20, ...derived(20), label: 'Too many' }, current), /CATALOGUE_LIMIT/);
    assert.equal(state.accounts.length, 20);
    const record = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as Record<string, any>;
    const root = record.accounts.find((account: { index: number }) => account.index === 0);
    await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, { ...record, accounts: [root], active: { accountId: 'hd:60:0', networkId: 'ethereum' }, nextIndex: 4096, retiredIndices: Array.from({ length: 4095 }, (_, i) => i + 1) });
    catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    state = await catalogue.reconcile(f.identity, current);
    assert.equal(state.removed.length, 4095);
    await assert.rejects(catalogue.mutate(state.revision, { kind: 'create', index: 4096, ...derived(4096), label: 'Past highwater' }, current), /CATALOGUE_LIMIT/);
    state = await catalogue.mutate(state.revision, { kind: 'restore', index: 4095, ...derived(4095), label: 'Final index' }, current);
    assert.equal(catalogue.nextIndex, 4096);
    assert.equal(state.accounts[1]!.index, 4095);
    assert.equal(state.removed.length, 4094);
  } finally { await f.cleanup(); }
});


function legacyV1(record: Record<string, any>): Record<string, any> {
  return { ...record, version: 1, networks: [{ id: 'ethereum', kind: 'evm', chainId: '1', slip44: 60,
    rpcUrl: 'https://ethereum-rpc.publicnode.com', symbol: 'ETH', decimals: 18 }], active: { ...record.active, networkId: 'ethereum' } };
}

test('committed v1 migrates once after authenticated identities match, preserving accounts and journal bytes', async () => {
  const f = await fixture();
  try {
    const original = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await original.reconcile(f.identity, current);
    state = await original.mutate(state.revision, { kind: 'create', index: 1, ...derived(1), label: 'Retired' }, current);
    state = await original.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
    state = await original.mutate(state.revision, { kind: 'remove', id: 'hd:60:1', journal: null }, current);
    state = await original.mutate(state.revision, { kind: 'create', index: 2, ...derived(2), label: 'Savings' }, current);
    const old = legacyV1(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as Record<string, any>);
    await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, old);
    const journal = { recovery: 'unchanged existing journal' };
    await f.storage.keyringStorage.set('native-evm-transfer-v1', journal);
    await f.reopen();
    const migrated = await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current, async (index) => derived(index));
    assert.deepEqual(migrated.accounts, state.accounts);
    assert.deepEqual(migrated.removed, state.removed);
    assert.deepEqual(migrated.active, state.active);
    assert.equal(migrated.networks.length, 7);
    assert.equal(migrated.revision, state.revision + 1);
    assert.deepEqual(await f.storage.keyringStorage.get('native-evm-transfer-v1'), journal);
    assert.equal((await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any).version, 2);
    await f.reopen();
    assert.deepEqual(await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current, async (index) => derived(index)), migrated);
  } finally { await f.cleanup(); }
});

for (const phase of ['before-commit', 'lost-ack'] as const) {
  test(`v1 migration ${phase} reopens one complete version without overwriting account history`, async () => {
    let enabled = false;
    const fail: SqlHook = (kind, sql) => { if (enabled && kind === 'exec' && sql === 'COMMIT') { enabled = false; throw Error('migration interrupted'); } };
    const f = await fixture(phase === 'lost-ack' ? { after: fail } : { before: fail });
    try {
      await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
      const prior = legacyV1(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as Record<string, any>);
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, prior);
      const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
      enabled = true;
      await assert.rejects(catalogue.reconcile(f.identity, current));
      assert.equal(catalogue.requiresReopen, true);
      await f.reopen();
      assert.equal((await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any).version, phase === 'lost-ack' ? 2 : 1);
      const recovered = await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
      assert.equal(recovered.revision, prior.revision + 1);
      assert.equal(recovered.accounts[0]!.address, ADDRESS);
    } finally { await f.cleanup(); }
  });
}

test('v1 endpoint mismatch and v2 registration tampering are never replacement migrations', async () => {
  const f = await fixture();
  try {
    await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
    const original = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as Record<string, any>;
    const old = legacyV1(original); old.networks[0]!.rpcUrl = 'https://wrong.invalid';
    for (const corrupted of [old, { ...original, networks: original.networks.map((network: any) => ({ ...network, registrationHash: '0x' + '1'.repeat(64) })) }]) {
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, corrupted);
      const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
      await assert.rejects(catalogue.reconcile(f.identity, current), /CATALOGUE_INVALID/);
      assert.equal(catalogue.requiresReopen, false);
      assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), corrupted);
    }
  } finally { await f.cleanup(); }
});

test('network selection preserves HD identity and counters while stale writers cannot replace it', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    const start = await catalogue.reconcile(f.identity, current);
    const next = await catalogue.mutate(start.revision, { kind: 'select-network', id: 'rollux' }, current);
    assert.deepEqual(next.accounts, start.accounts);
    assert.deepEqual(next.removed, start.removed);
    assert.equal(catalogue.nextIndex, 1);
    assert.equal(next.active.networkId, 'rollux');
    await assert.rejects(catalogue.mutate(start.revision, { kind: 'select-network', id: 'base' }, current), /CATALOGUE_CONTEXT_CHANGED/);
    await f.reopen();
    assert.equal((await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current)).active.networkId, 'rollux');
  } finally { await f.cleanup(); }
});


test('revocation during v1 identity verification cannot commit a migration', async () => {
  const f = await fixture();
  try {
    const original = new NativeWalletCatalogue(f.storage.keyringStorage);
    const first = await original.reconcile(f.identity, current);
    await original.mutate(first.revision, { kind: 'create', index: 1, ...derived(1), label: 'Savings' }, current);
    const old = legacyV1(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as Record<string, any>);
    await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, old);
    let entered!: () => void, release!: () => void, valid = true;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    const pending = catalogue.reconcile(f.identity, () => { if (!valid) throw Error('CANCELLED'); }, async (index) => { entered(); await held; return derived(index); });
    await started; valid = false; release();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(catalogue.requiresReopen, false);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), old);
  } finally { await f.cleanup(); }
});


test('a new pending chain after terminal-container validation prevents account cleanup', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    state = await catalogue.mutate(state.revision, { kind: 'create', index: 1, ...derived(1), label: 'Savings' }, current);
    state = await catalogue.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
    const signer = new Wallet('0x' + '3'.padStart(64, '0'));
    const scope = { walletFingerprint: f.identity.walletFingerprint, address: signer.address, chainId: '1' };
    const ethereum = new NativeTransferJournal(f.storage.keyringStorage, scope, current, () => 1, 1);
    const first = await ethereum.saveSigned(await signer.signTransaction({ type: 2, chainId: 1, nonce: 0, to: ADDRESS, value: 1, gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 }));
    await ethereum.transition(first.hash, 'nonce-consumed');
    const terminal = await ethereum.removalSnapshot();
    const base = new NativeTransferJournal(f.storage.keyringStorage, { ...scope, chainId: '8453' }, current, () => 1, 1);
    await base.saveSigned(await signer.signTransaction({ type: 2, chainId: 8453, nonce: 0, to: ADDRESS, value: 1, gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 }));
    await assert.rejects(catalogue.mutate(state.revision, { kind: 'remove', id: 'hd:60:1', journal: terminal }, current), /CATALOGUE_CONTEXT_CHANGED/);
    assert.equal((await base.load())!.phase, 'signed');
    assert.equal((await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any).accounts.length, 2);
  } finally { await f.cleanup(); }
});
