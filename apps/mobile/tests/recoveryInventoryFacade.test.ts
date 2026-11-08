import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createTrezorSessions } from '../src/hardware/trezorSessions.ts';
import { createSecurityTestFixture } from './idleComponentFixture.ts';
import { isCustomUtxoNetworkId } from '../src/core/utxoNetworks.ts';
import { exactUtxoResponseFetch } from '../src/core/utxoReadSession.ts';
import { CustodyOperationError, NativeCustodyAuthority } from '../src/custody/authority.ts';
import { readRecoveryInventory } from '../src/custody/recoveryInventory.ts';
import { WALLET_CATALOGUE_KEY, type NativeAccountRecord } from '../src/custody/walletCatalogue.ts';
import { encodeAccountRecord } from '../src/storage/accountRecordKey.ts';
import { createAccountRecordTestFixture } from './accountRecordTestFixture.ts';
import type { CustodyRuntime, CustodyRuntimeFactory, CustodyStoredState } from '../src/custody/types.ts';
import type { KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import type { OpenWalletStorage, RecoveryStorageSnapshot } from '../src/storage/types.ts';
import type { NativeNoteInventory } from '../src/custody/noteBackupRuntime.ts';

const BINDING = 'ab'.repeat(32);
const PRIVATE_ERROR = 'fixture private storage failure that must never enter a DTO';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};
const cancelled = (error: unknown) => error instanceof CustodyOperationError &&
  error.code === 'CANCELLED' && error.message === 'CANCELLED' && !('cause' in error);

function savedSnapshot(record: NativeAccountRecord, root: { address: string; publicKey: string; profileId: string }): RecoveryStorageSnapshot {
  return {
    identity: { walletBindingId: BINDING, pairFingerprint: BINDING, root, verification: 'requires-unlock' },
    state: { presence: 'existing', backup: 'confirmed' }, metadata: [], notes: [], signedRecords: [],
    records: [{ key: WALLET_CATALOGUE_KEY, value: encodeAccountRecord(record) }],
  };
}

/** Execute the real factory, authority and inventory parser; replace only native/SDK ports. */
async function fixture(existing = true, noteInventory?: NativeNoteInventory) {
  const keys = await createAccountRecordTestFixture();
  const record = keys.record(BINDING), root = { ...keys.identity, profileId: keys.staged.profileId };
  record.groups[0]!.accounts.HDAccount[0]!.label = 'Private account label';
  await keys.close();
  const snapshot = () => savedSnapshot(record, root);
  const security = createSecurityTestFixture(); await security.securityPreferences.load();
  security.custodyIdle.begin({}, () => undefined);
  const counts = { opens: 0, snapshotReads: 0, stateReads: 0, closes: 0, retirements: 0, writes: 0 };
  const stored: CustodyStoredState = existing
    ? { presence: 'existing', backup: 'confirmed' } : { presence: 'empty', backup: 'unconfirmed' };
  let snapshotRead = async () => snapshot();
  const storage = {
    keyringStorage: { set() { counts.writes++; assert.fail('inventory must not write'); } },
    recovery: {
      async readSnapshot() { counts.snapshotReads++; return snapshotRead(); },
    },
    async readState() { counts.stateReads++; return stored; },
    async close() { counts.closes++; },
  } as unknown as OpenWalletStorage;
  const runtime: CustodyRuntime & { trezor: { subscribe(): () => void } } = {
    trezor: { subscribe: () => () => undefined },
    storage: {
      readState: () => storage.readState(), close: () => storage.close(),
      async retireForRecovery() { counts.retirements++; return BINDING; },
    },
    session: {
      async lock() {}, async unlock() { return { authenticated: true }; },
      async readSelectedAddress() { return root.address; },
      async createWallet() { assert.fail('unexpected create'); },
      async importWallet() { assert.fail('unexpected import'); },
    },
  };
  if (noteInventory) Object.assign(runtime, {
    catalogue: { getSnapshot: () => ({}) },
    async readNoteInventory(assertCurrent: () => void) { assertCurrent(); return noteInventory; },
  });
  class PassiveController { readonly view = {}; dispose() {} }
  const dependencies: Record<string, unknown> = {
    './security': security,
    './deviceUnlockCredential.native': {
      createNativeDeviceUnlockCapability() {
        return { credentials: {}, prompt: { cancel() {} } };
      },
    },
    './walletConnectRuntime': {
      prepareWalletConnectRuntime() { assert.fail('inventory must not prepare WalletConnect'); },
    },
    '../../../../source/utils/security/blacklistService': {
      blacklistService: {
        checkUrl() { assert.fail('inventory must not check sites'); },
        checkAddress() { assert.fail('inventory must not check addresses'); },
      },
    },
    '../connections/controller.ts': { NativeConnectionsController: PassiveController },
    '../hardware/trezorTransport.native': {
      createNativeTrezorSessions: (options: { randomBytes(length: number): Uint8Array }) => createTrezorSessions({
        ...options,
        loadClient: async () => assert.fail('unexpected Trezor SDK load in native factory fixture'),
        openURL: async () => assert.fail('unexpected Trezor handoff in native factory fixture'),
      }),
    },
    '../crypto/sentryPublicKey.native': {
      createNativeSentryPublicKeyDeriver: () => () => assert.fail('unexpected Sentry derivation in native factory fixture'),
    },
    '../custody/ledgerAccounts.ts': { NativeLedgerAccounts: PassiveController },
    '../custody/authority.ts': { NativeCustodyAuthority, CustodyOperationError },
    '../custody/utxoActivity.ts': { createNativeUtxoActivity: () => ({}) },
    '../core/utxoActivity.ts': { createUtxoActivityReader: () => ({}) },
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
    '../custody/walletRemoval.ts': { NativeWalletRemoval: PassiveController },
    '../custody/seedBackup.ts': { SeedBackupFlow: PassiveController },
    '../custody/hdKeyExport.ts': { HdKeyExportFlow: PassiveController },
    '../custody/transfers.ts': { NativeTransfers: PassiveController },
    '../custody/evmTransferReadRpc.ts': { EvmTransferReadRpc: class { constructor() { assert.fail('inventory must not observe transactions'); } } },
    '../portfolio/nativeTokens.ts': { NativeTokens: PassiveController },
    '../activity/nativeActivity.ts': { NativeActivity: PassiveController },
    '../activity/explorerReader.ts': { ActivityExplorerReader: PassiveController },
    '../activity/receiptReader.ts': { ActivityReceiptReader: PassiveController },
    '../portfolio/erc20ReadRpc.ts': { createErc20Reader: () => ({}) },
    '../portfolio/ownedTokenReader.ts': { createOwnedTokenReader: () => () => assert.fail('inventory must not discover tokens') },
    '../portfolio/nftOwnershipReadRpc.ts': { createNftOwnershipReader: () => () => assert.fail('inventory must not check collectibles') },
    '../core/utxoBalanceReader.ts': { createUtxoBalanceReader: () => assert.fail('inventory must not read UTXO balances') },
    '../core/utxoNetworks.ts': { isCustomUtxoNetworkId },
    '../core/utxoReadSession.ts': { exactUtxoResponseFetch },
    '../platformRpc.ts': { createBalanceReader: () => ({}) },
    './http': { walletFetch() { assert.fail('inventory must not fetch'); } },
    '../storage/native': { async openNativeWalletStorage() { counts.opens++; return storage; } },
    './cryptoBootstrap': { async ensureNativeCryptoReady() { return {}; } },
  };
  const module = { exports: {} as typeof import('../src/platform/nativeFactory.native.ts') };
  const source = ts.transpileModule(readFileSync(new NodeURL('../src/platform/nativeFactory.native.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, { module, exports: module.exports, process: { env: {} }, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected import ${name}`);
    return dependencies[name];
  } });
  return { factory: module.exports, counts, root, snapshot,
    setSnapshotRead(read: () => Promise<RecoveryStorageSnapshot>) { snapshotRead = read; } };
}

test('the native factory delivers guarded withdrawal and status routes to the inventory screen', async () => {
  const note = Object.freeze({ amount: '1', createdAt: 1, reconciliation: 'withdrawal-history' as const });
  let openings = 0, disposals = 0, screenCurrent = true;
  let holdOpen: Promise<void> | undefined;
  let holdDispose: Promise<void> | undefined;
  const model = Object.freeze({ async dispose() { disposals++; await holdDispose; } }) as unknown as Awaited<ReturnType<NonNullable<NativeNoteInventory['openWithdrawal']>>>;
  let checkModel: (() => void) | undefined;
  const signal = new AbortController().signal;
  const inventory: NativeNoteInventory = {
    notes: [note],
    async openWithdrawal(selected, ownerSignal, assertCurrent) {
      openings++;
      assert.equal(selected, note); assert.equal(ownerSignal, signal);
      assertCurrent(); checkModel = assertCurrent;
      await holdOpen;
      return model;
    },
    async revealNote() { assert.fail('withdrawal route must not reveal the note'); },
  };
  const f = await fixture(true, inventory), controllers = f.factory.createNativeWalletControllers();
  try {
    await controllers.authority.initialize(); await controllers.authority.unlock('fixture password');
    const view = await controllers.readNoteInventory(() => undefined);
    assert.equal(typeof view.openWithdrawal, 'function');
    assert.equal(view.notes[0], note);
    const assertScreen = () => { if (!screenCurrent) throw new Error('screen retired'); };
    assert.equal(await view.openWithdrawal!(view.notes[0]!, signal, assertScreen), model);
    assert.equal(openings, 1);
    screenCurrent = false;
    assert.throws(() => checkModel!(), /screen retired/);
    screenCurrent = true;
    const opening = deferred<void>(); holdOpen = opening.promise;
    const closing = deferred<void>(); holdDispose = closing.promise;
    const lateView = view.openWithdrawal!(note, signal, assertScreen);
    let lateSettled = false;
    void lateView.catch(() => { lateSettled = true; });
    screenCurrent = false; opening.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disposals, 1);
    assert.equal(lateSettled, false);
    closing.resolve();
    await assert.rejects(lateView, /screen retired/);
    screenCurrent = true; holdOpen = undefined; holdDispose = undefined;
    controllers.authority.lock();
    assert.throws(() => checkModel!(), cancelled);
    await assert.rejects(view.openWithdrawal!(note, signal, assertScreen), cancelled);
    await controllers.authority.unlock('fixture password');
    await assert.rejects(view.openWithdrawal!(note, signal, assertScreen), cancelled);
    assert.equal(openings, 2);
  } finally { await controllers.authority.dispose(); }
});

test('the native inventory facade preserves absence of an unsupported withdrawal capability', async () => {
  const f = await fixture(true, { notes: [], async revealNote() { assert.fail('unexpected reveal'); } });
  const controllers = f.factory.createNativeWalletControllers();
  try {
    await controllers.authority.initialize(); await controllers.authority.unlock('fixture password');
    assert.equal((await controllers.readNoteInventory(() => undefined)).openWithdrawal, undefined);
  } finally { await controllers.authority.dispose(); }
});

test('locked inventory facade reads the original handle, returns only public counts and never opens or retires another owner', async () => {
  const f = await fixture(), controllers = f.factory.createNativeWalletControllers();
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
    for (const secret of [BINDING, f.root.address, f.root.publicKey, 'Private account label', 'records', 'ciphertext'])
      assert.equal(JSON.stringify(inventory).includes(secret), false);
    assert.equal(f.counts.snapshotReads, i);
    assert.equal(f.counts.opens, 1);
    assert.equal(controllers.authority.getSnapshot(), state);
  }
  assert.equal(f.counts.retirements, 0); assert.equal(f.counts.closes, 0); assert.equal(f.counts.writes, 0);
  await controllers.authority.dispose();
});

test('facade rejects empty, ready and disposed owners before reading inventory', async () => {
  const empty = await fixture(false), emptyControllers = empty.factory.createNativeWalletControllers();
  await emptyControllers.authority.initialize();
  await assert.rejects(emptyControllers.readRecoveryInventory(), cancelled);
  assert.equal(empty.counts.snapshotReads, 0);
  await emptyControllers.authority.dispose();
  const f = await fixture(), controllers = f.factory.createNativeWalletControllers();
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
    const f = await fixture(), controllers = f.factory.createNativeWalletControllers();
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
    gate.resolve(f.snapshot());
    await assert.rejects(reading, cancelled);
    assert.equal(f.counts.opens, 1); assert.equal(f.counts.snapshotReads, 1);
    if (change === 'lock' || change === 'unlock-relock') {
      assert.equal(controllers.authority.getSnapshot().phase, 'locked');
      f.setSnapshotRead(async () => f.snapshot());
      assert.equal((await controllers.readRecoveryInventory()).counts?.hdAccounts, 1);
    } else await assert.rejects(controllers.readRecoveryInventory(), cancelled);
    await controllers.authority.dispose();
  });
}

test('inventory read failures retain unavailable and never expose storage errors or manufacture empty counts', async () => {
  const f = await fixture(), controllers = f.factory.createNativeWalletControllers();
  await controllers.authority.initialize();
  f.setSnapshotRead(async () => { throw Error(PRIVATE_ERROR); });
  const inventory = await controllers.readRecoveryInventory();
  assert.deepEqual(inventory, { status: 'unavailable', reason: 'storage-unavailable', backup: 'unknown', counts: null, privateNotes: 'not-supported' });
  assert.equal(JSON.stringify(inventory).includes(PRIVATE_ERROR), false);
  assert.equal(f.counts.snapshotReads, 1); assert.equal(f.counts.opens, 1); assert.equal(f.counts.retirements, 0);
  await controllers.authority.dispose();
});

test('standalone custody factory does not expose inventory or acquire an additional handle', async () => {
  const f = await fixture(), authority = f.factory.createNativeCustodyAuthority();
  assert.equal('readRecoveryInventory' in authority, false);
  await authority.initialize();
  assert.equal(f.counts.opens, 1); assert.equal(f.counts.snapshotReads, 0);
  await authority.dispose();
});
