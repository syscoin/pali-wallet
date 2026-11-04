import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CustodyOperationError, NativeCustodyAuthority } from '../src/custody/authority.ts';
import { readRecoveryInventory } from '../src/custody/recoveryInventory.ts';
import { NATIVE_NETWORKS } from '../src/custody/networkContext.ts';
import { WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import type { CustodyRuntime, CustodyRuntimeFactory, CustodyStoredState } from '../src/custody/types.ts';
import type { KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import type { OpenWalletStorage, RecoveryStorageSnapshot } from '../src/storage/types.ts';

const ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const PUBLIC_KEY = '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const BINDING = 'ab'.repeat(32);
const PRIVATE_ERROR = 'fixture private storage failure that must never enter a DTO';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};
const cancelled = (error: unknown) => error instanceof CustodyOperationError &&
  error.code === 'CANCELLED' && error.message === 'CANCELLED' && !('cause' in error);

function savedSnapshot(): RecoveryStorageSnapshot {
  return {
    identity: { walletBindingId: BINDING, pairFingerprint: BINDING, root: null, verification: 'requires-unlock' },
    state: { presence: 'existing', backup: 'confirmed' }, metadata: [],
    records: [{ key: WALLET_CATALOGUE_KEY, value: JSON.stringify({
      version: 2, revision: 0, walletFingerprint: BINDING, nextIndex: 1, retiredIndices: [],
      nextImportedIndex: 0, retiredImportedIndices: [], importedAccounts: [],
      accounts: [{ id: 'hd:60:0', type: 'HDAccount', index: 0, slip44: 60,
        address: ADDRESS, publicKey: PUBLIC_KEY, label: 'Private account label' }],
      networks: NATIVE_NETWORKS, active: { accountId: 'hd:60:0', networkId: 'ethereum' },
    }) }],
  };
}

/** Execute the real factory, authority and inventory parser; replace only native/SDK ports. */
function fixture(existing = true) {
  const counts = { opens: 0, snapshotReads: 0, stateReads: 0, closes: 0, retirements: 0, writes: 0 };
  const stored: CustodyStoredState = existing
    ? { presence: 'existing', backup: 'confirmed' } : { presence: 'empty', backup: 'unconfirmed' };
  let snapshotRead = async () => savedSnapshot();
  const storage = {
    keyringStorage: { set() { counts.writes++; assert.fail('inventory must not write'); } },
    recovery: {
      async readSnapshot() { counts.snapshotReads++; return snapshotRead(); },
    },
    async readState() { counts.stateReads++; return stored; },
    async close() { counts.closes++; },
  } as unknown as OpenWalletStorage;
  const runtime: CustodyRuntime = {
    storage: {
      readState: () => storage.readState(), close: () => storage.close(),
      async retireForRecovery() { counts.retirements++; return BINDING; },
    },
    session: {
      async lock() {}, async unlock() { return { authenticated: true }; },
      async readEthereumAddress() { return ADDRESS; },
      async createWallet() { assert.fail('unexpected create'); },
      async importWallet() { assert.fail('unexpected import'); },
    },
  };
  class PassiveController { readonly view = {}; dispose() {} }
  const dependencies: Record<string, unknown> = {
    '../custody/authority.ts': { NativeCustodyAuthority, CustodyOperationError },
    '../custody/keyringRuntime.ts': {
      createKeyringRuntimeFactory: (options: KeyringRuntimeDependencies): CustodyRuntimeFactory => ({
        async open() {
          await options.ensureCryptoReady();
          assert.equal(await options.openStorage(), storage);
          return runtime;
        },
      }),
    },
    '../custody/recoveryInventory.ts': { readRecoveryInventory },
    '../custody/recovery.ts': { NativeRecoveryCoordinator: PassiveController },
    '../custody/seedBackup.ts': { SeedBackupFlow: PassiveController },
    '../custody/hdKeyExport.ts': { HdKeyExportFlow: PassiveController },
    '../custody/transfers.ts': { NativeTransfers: PassiveController },
    '../portfolio/nativeTokens.ts': { NativeTokens: PassiveController },
    '../activity/nativeActivity.ts': { NativeActivity: PassiveController },
    '../activity/explorerReader.ts': { ActivityExplorerReader: PassiveController },
    '../activity/receiptReader.ts': { ActivityReceiptReader: PassiveController },
    '../portfolio/erc20ReadRpc.ts': { createErc20Reader: () => ({}) },
    '../platformRpc.ts': { createBalanceReader: () => ({}) },
    './http': { walletFetch() { assert.fail('inventory must not fetch'); } },
    '../storage/native': { async openNativeWalletStorage() { counts.opens++; return storage; } },
    './cryptoBootstrap': { async ensureNativeCryptoReady() { return {}; } },
  };
  const module = { exports: {} as typeof import('../src/platform/nativeFactory.native.ts') };
  const source = ts.transpileModule(readFileSync(new NodeURL('../src/platform/nativeFactory.native.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, { module, exports: module.exports, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected import ${name}`);
    return dependencies[name];
  } });
  return { factory: module.exports, counts,
    setSnapshotRead(read: () => Promise<RecoveryStorageSnapshot>) { snapshotRead = read; } };
}

test('locked inventory facade reads the original handle, returns only public counts and never opens or retires another owner', async () => {
  const f = fixture(), controllers = f.factory.createNativeWalletControllers();
  await assert.rejects(controllers.readRecoveryInventory(), cancelled);
  assert.equal(f.counts.opens, 0);
  await controllers.authority.initialize();
  assert.equal(f.counts.opens, 1);
  const state = controllers.authority.getSnapshot();
  for (let i = 1; i <= 2; i++) {
    const inventory = await controllers.readRecoveryInventory();
    assert.equal(inventory.status, 'needs-matching-phrase-verification');
    assert.equal(inventory.counts?.hdAccounts, 1);
    assert.equal(inventory.counts?.importedKeys, 0);
    assert.equal(inventory.backup, 'confirmed');
    assert.equal(Object.isFrozen(inventory), true);
    assert.equal(Object.isFrozen(inventory.counts), true);
    for (const secret of [BINDING, ADDRESS, PUBLIC_KEY, 'Private account label', 'records', 'ciphertext'])
      assert.equal(JSON.stringify(inventory).includes(secret), false);
    assert.equal(f.counts.snapshotReads, i);
    assert.equal(f.counts.opens, 1);
    assert.equal(controllers.authority.getSnapshot(), state);
  }
  assert.equal(f.counts.retirements, 0); assert.equal(f.counts.closes, 0); assert.equal(f.counts.writes, 0);
  await controllers.authority.dispose();
});

test('facade rejects empty, ready and disposed owners before reading inventory', async () => {
  const empty = fixture(false), emptyControllers = empty.factory.createNativeWalletControllers();
  await emptyControllers.authority.initialize();
  await assert.rejects(emptyControllers.readRecoveryInventory(), cancelled);
  assert.equal(empty.counts.snapshotReads, 0);
  await emptyControllers.authority.dispose();
  const f = fixture(), controllers = f.factory.createNativeWalletControllers();
  await controllers.authority.initialize();
  await controllers.authority.unlock('fixture password');
  assert.equal(controllers.authority.getSnapshot().phase, 'ready');
  await assert.rejects(controllers.readRecoveryInventory(), cancelled);
  await controllers.authority.dispose();
  await assert.rejects(controllers.readRecoveryInventory(), cancelled);
  assert.equal(f.counts.snapshotReads, 0); assert.equal(f.counts.opens, 1);
});

for (const change of ['lock', 'unlock-relock', 'dispose', 'recovery-retirement'] as const) {
  test(`pending inventory is discarded after ${change}, even when the phase returns to locked`, async () => {
    const f = fixture(), controllers = f.factory.createNativeWalletControllers();
    await controllers.authority.initialize();
    const gate = deferred<RecoveryStorageSnapshot>();
    f.setSnapshotRead(() => gate.promise);
    const reading = controllers.readRecoveryInventory();
    assert.equal(f.counts.snapshotReads, 1);
    if (change === 'lock') controllers.authority.lock();
    else if (change === 'unlock-relock') {
      await controllers.authority.unlock('fixture password');
      controllers.authority.lock();
    } else if (change === 'dispose') await controllers.authority.dispose();
    else await controllers.authority.retireForRecovery();
    gate.resolve(savedSnapshot());
    await assert.rejects(reading, cancelled);
    assert.equal(f.counts.opens, 1); assert.equal(f.counts.snapshotReads, 1);
    if (change === 'lock' || change === 'unlock-relock') {
      assert.equal(controllers.authority.getSnapshot().phase, 'locked');
      f.setSnapshotRead(async () => savedSnapshot());
      assert.equal((await controllers.readRecoveryInventory()).counts?.hdAccounts, 1);
    } else await assert.rejects(controllers.readRecoveryInventory(), cancelled);
    await controllers.authority.dispose();
  });
}

test('inventory read failures retain unavailable and never expose storage errors or manufacture empty counts', async () => {
  const f = fixture(), controllers = f.factory.createNativeWalletControllers();
  await controllers.authority.initialize();
  f.setSnapshotRead(async () => { throw Error(PRIVATE_ERROR); });
  const inventory = await controllers.readRecoveryInventory();
  assert.deepEqual(inventory, { status: 'unavailable', reason: 'storage-unavailable', backup: 'unknown', counts: null, privateNotes: 'not-supported' });
  assert.equal(JSON.stringify(inventory).includes(PRIVATE_ERROR), false);
  assert.equal(f.counts.snapshotReads, 1); assert.equal(f.counts.opens, 1); assert.equal(f.counts.retirements, 0);
  await controllers.authority.dispose();
});

test('standalone custody factory does not expose inventory or acquire an additional handle', async () => {
  const f = fixture(), authority = f.factory.createNativeCustodyAuthority();
  assert.equal('readRecoveryInventory' in authority, false);
  await authority.initialize();
  assert.equal(f.counts.opens, 1); assert.equal(f.counts.snapshotReads, 0);
  await authority.dispose();
});
