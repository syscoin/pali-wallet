import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKeyringRuntimeFactory, type KeyringRuntime, type KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { WalletStorageError } from '../src/storage/types.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { SeedBackupFlow } from '../src/custody/seedBackup.ts';
import { HdKeyExportFlow, type HdKeyExportScope } from '../src/custody/hdKeyExport.ts';
import { keccak256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { HDNodeWallet, Wallet } from 'ethers/wallet';
import { getNativeNetwork, createNativeNetwork, NATIVE_NETWORKS, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import { type NativeAccountRecord, WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { UTXO_NETWORKS } from '../src/core/utxoNetworks.ts';
import { sameRecoverySnapshot } from '../src/storage/recoverySnapshot.ts';
import { NATIVE_CONNECTION_STORAGE_KEY } from '../src/connections/storage.ts';
import type { DappGrant } from '../../../source/shared/dappTypes.ts';
import { createDappMessageApproval } from '../../../source/wallet/dappMessageApproval.ts';
import { readDappMessageRequest, type DappMessageRequest } from '../../../source/shared/dappMessageRequest.ts';
import { recoverPersonalSignature, recoverTypedSignature, SignTypedDataVersion } from '@metamask/eth-sig-util';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Only a public test password 1!';
const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

function memoryDisk(loadSdk?: KeyringRuntimeDependencies['loadSdk'], assertActive?: () => void) {
  const records = new Map<string, unknown>();
  let confirmation: string | undefined;
  let failures = 0;
  let failureWrites = 0;
  let successWrites = 0;
  let failAcknowledgement = false;
  let failCatalogueAcknowledgement = false;
  let failCasAcknowledgement = false;
  let closes = 0;
  let networkCalls = 0;
  let identity: import('../src/storage/types.ts').WalletIdentityRead | null = null;
  const signedBundles = new Map<string,string>();
  let recordHook: ((kind: string, key: string) => Promise<void>) | undefined;
  const originalFetch = globalThis.fetch;
  const fingerprint = () => createHash('sha256')
    .update(JSON.stringify([records.get('vault'), records.get('vault-keys')])).digest('hex');
  const snapshot = (): import('../src/storage/types.ts').RecoveryStorageSnapshot => ({
    identity: identity ?? (records.has('vault') ? {walletBindingId:fingerprint(),pairFingerprint:fingerprint(),root:null,verification:'requires-unlock'} : null),
    state: records.has('vault') ? {presence:'existing',backup:confirmation===fingerprint()?'confirmed':'unconfirmed'} : {presence:'empty',backup:'unconfirmed'},
    records:[...records].map(([key,value])=>({key,value:JSON.stringify(value)})),metadata:[],notes:[],
    signedRecords:[...signedBundles].map(([profileId,value])=>({profileId,value,walletBindingId:identity!.walletBindingId})),
  });
  const plans = new WeakMap<object, { before: ReturnType<typeof snapshot>; after: ReturnType<typeof snapshot> }>();
  const open = async (): Promise<OpenWalletStorage> => { let signedUnavailable=false; return ({
    signedRecords: {
      async read(profileId) { if(signedUnavailable) throw new WalletStorageError('STORAGE_REOPEN_REQUIRED'); await recordHook?.('get','pali-evm-signed-v1:'+profileId); if (!identity?.root || identity.root.profileId !== profileId) throw Error('profile mismatch'); return signedBundles.get(profileId); },
      async compareAndSet(profileId, expected, next, guard) { guard(); if(signedUnavailable) throw new WalletStorageError('STORAGE_REOPEN_REQUIRED'); if (!identity?.root || identity.root.profileId !== profileId) throw Error('profile mismatch'); if (signedBundles.get(profileId) !== expected) return false; signedBundles.set(profileId,next); await recordHook?.('create','pali-evm-signed-v1:'+profileId); if(failAcknowledgement || failCasAcknowledgement){failAcknowledgement=false;failCasAcknowledgement=false;signedUnavailable=true;throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');} return true; },
    },
    recovery: {
      async fingerprintPair(pair) { return createHash('sha256').update(JSON.stringify([pair.vault,pair.keys])).digest('hex'); },
      async prepareCreation(before, pair, root) {
        assert.equal(before.state.presence,'empty'); assert(sameRecoverySnapshot(before,snapshot()));
        const nextRecords = new Map(records); nextRecords.set('vault',pair.vault); nextRecords.set('vault-keys',pair.keys); nextRecords.set(WALLET_CATALOGUE_KEY,pair.accountRecords);
        const binding = createHash('sha256').update(JSON.stringify([pair.vault,pair.keys])).digest('hex');
        const after: ReturnType<typeof snapshot> = { identity:{walletBindingId:binding,pairFingerprint:binding,root:structuredClone(root),verification:'requires-unlock'},
          state:{presence:'existing',backup:'unconfirmed'},records:[...nextRecords].map(([key,value])=>({key,value:JSON.stringify(value)})),metadata:[],notes:[],signedRecords:[] };
        const plan = {}; plans.set(plan,{before:structuredClone(before),after}); return plan as import('../src/storage/types.ts').RecoveryWritePlan;
      },
      plannedSnapshot(plan) { return structuredClone(plans.get(plan)!.after); },
      async commitReplacement(plan, guard) {
        const held=plans.get(plan as object); assert(held); plans.delete(plan as object); guard();
        assert(sameRecoverySnapshot(held.before,snapshot()));
        records.clear(); for(const row of held.after.records)records.set(row.key,JSON.parse(row.value)); identity=structuredClone(held.after.identity);
        await recordHook?.('create',WALLET_CATALOGUE_KEY);
        if(failAcknowledgement){failAcknowledgement=false;signedUnavailable=true;throw Error('simulated lost commit acknowledgment');}
        if(failCatalogueAcknowledgement){failCatalogueAcknowledgement=false;signedUnavailable=true;throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');}
        guard();
      },
      async readIdentity() { if (!records.has('vault')) return null; if (identity && identity.pairFingerprint !== fingerprint()) throw Error('pair changed'); return identity ?? {walletBindingId:fingerprint(),pairFingerprint:fingerprint(),root:null,verification:'requires-unlock'}; },
      async bindIdentity(expected, root, guard) { guard(); assert.equal(expected,fingerprint()); if (identity) assert.deepEqual(identity.root,root); else identity={walletBindingId:expected,pairFingerprint:expected,root,verification:'requires-unlock'}; },
      async readSnapshot() { return snapshot(); },
      async recordFailureForPair(pair) { assert.equal(pair,fingerprint()); failures++; failureWrites++; },
    },
    keyringStorage: {
      async compareAndSet(key, expected, value, removals = {}) {
        if (!records.has(key) || JSON.stringify(records.get(key)) !== JSON.stringify(expected)) return false;
        if (Object.entries(removals).some(([name, before]) => JSON.stringify(records.get(name)) !== JSON.stringify(before))) return false;
        records.set(key, structuredClone(value));
        await recordHook?.('cas', key);
        for (const name of Object.keys(removals)) records.delete(name);
        if (failCasAcknowledgement) { failCasAcknowledgement = false; throw Error('Lost CAS acknowledgement'); }
        return true;
      },
      async compareAndSetMany(changes, guard) {
        guard();
        const matches = () => changes.every(({ key, expected }) =>
          JSON.stringify(records.get(key)) === JSON.stringify(expected));
        if (!matches()) return false;
        for (const { key } of changes) await recordHook?.('cas', key);
        guard();
        if (!matches()) return false;
        for (const { key, value } of changes) {
          if (value === undefined) records.delete(key);
          else records.set(key, structuredClone(value));
        }
        if (failCasAcknowledgement) {
          failCasAcknowledgement = false;
          throw Error('Lost CAS acknowledgement');
        }
        return true;
      },
      async readDeviceUnlockVaultPair() {
        const vault = records.get('vault');
        const keys = records.get('vault-keys');
        if (typeof vault !== 'string' || !keys || typeof keys !== 'object' ||
          Object.keys(keys).length !== 1 || !('salt' in keys) || typeof keys.salt !== 'string') return null;
        return { vault, keys: { salt: keys.salt }, pairFingerprint: fingerprint() };
      },
      async get(key) { const value = records.has(key) ? structuredClone(records.get(key)) : undefined; await recordHook?.('get', key); return value; },
      async set(key, value) { records.set(key, structuredClone(value)); },
      async deleteItem(key) { records.delete(key); },
      async createManyIfAbsent(values) {
        if (Object.keys(values).some((key) => records.has(key))) return false;
        for (const [key, value] of Object.entries(values)) records.set(key, structuredClone(value));
        await recordHook?.('create', Object.keys(values)[0]!);
        if (failAcknowledgement) { failAcknowledgement = false; throw new Error('simulated lost commit acknowledgment'); }
        if (failCatalogueAcknowledgement && Object.hasOwn(values, WALLET_CATALOGUE_KEY)) { failCatalogueAcknowledgement = false; throw new Error('simulated lost catalogue acknowledgment'); }
        return true;
      },
    },
    authGuard: {
      async checkAllowed() { if (failures >= 5) throw new WalletStorageError('AUTH_THROTTLED'); },
      async recordFailure() { failures++; failureWrites++; },
      async recordSuccess() { failures = 0; successWrites++; },
    },
    async readState() {
      if (signedUnavailable) throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');
      const vault = records.has('vault');
      const keys = records.has('vault-keys');
      if (vault !== keys) throw new Error('partial fixture vault');
      return vault
        ? { presence: 'existing', backup: confirmation === fingerprint() ? 'confirmed' : 'unconfirmed' }
        : { presence: 'empty', backup: 'unconfirmed' };
    },
    async getWalletFingerprint() { assert.ok(records.has('vault')); return fingerprint(); },
    async confirmBackup(expected) { assert.equal(expected, fingerprint()); confirmation = expected; },
    async close() { closes++; if(signedUnavailable) throw Error('ambiguous storage'); },
  }); };
  const factory = createKeyringRuntimeFactory({ readEvmRetirement: null, ensureCryptoReady: async () => {
    assert.ok(globalThis.crypto.subtle, 'Node supplies real WebCrypto for this control');
  }, openStorage: open, loadSdk, assertActive });
  return {
    clearFixtureIdentity() { identity = null; }, fixtureIdentity: () => identity,
    records, factory, signedBundles, signedValue: () => [...signedBundles.values()][0],
    onRecord(hook?: (kind: string, key: string) => Promise<void>) { recordHook = hook; },
    get closes() { return closes; },
    loseCasAcknowledgement() { failCasAcknowledgement = true; },
    loseCatalogueAcknowledgement() { failCatalogueAcknowledgement = true; },
    get failures() { return failures; },
    get failureWrites() { return failureWrites; },
    get successWrites() { return successWrites; },
    loseNextAcknowledgement() { failAcknowledgement = true; },
    denyNetwork() {
      globalThis.fetch = async () => { networkCalls++; throw new Error('Network is forbidden in local custody'); };
    },
    restoreNetwork() { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); },
  };
}

test('connection host retains its wallet owner across lock while disclosing only unlocked public accounts', async () => {
  const disk = memoryDisk();
  disk.denyNetwork();
  const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await assert.rejects(runtime.openConnectionHost(), /CANCELLED|NOT_READY/);
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const host = await runtime.openConnectionHost();
    const initial = host.context();
    assert.equal(initial.unlocked, true);
    assert.equal(initial.accounts[0]?.address, ADDRESS);
    assert.equal(initial.accounts[0]?.id, initial.activeAccountId);
    assert.equal(Object.keys(initial.accounts[0]!).sort().join(','), 'address,id,index,label,type,xpub');
    assert.equal(Object.isFrozen(initial.accounts[0]), true);
    assert.equal(Object.isFrozen(initial.network), true);
    const target = getNativeNetwork('syscoin-nevm');
    await runtime.networks!.reserve(target.id, runtime.catalogue.getSnapshot()!.revision).execute(() => undefined);
    assert.equal(host.context().networkId, target.id);
    await runtime.session.lock();
    assert.doesNotThrow(host.assertOwner);
    assert.equal(host.context().unlocked, false);
    assert.equal(host.context().networkId, target.id);
    assert.deepEqual(host.context().accounts, []);
    assert.equal(host.context().activeAccountId, null);
    assert.equal((await runtime.session.unlock(PASSWORD)).authenticated, true);
    assert.doesNotThrow(host.assertOwner);
    assert.equal(host.context().accounts[0]?.address, ADDRESS);
    await runtime.storage.close();
    assert.throws(host.assertOwner, /CANCELLED/);
    assert.throws(host.context, /CANCELLED/);
  } finally {
    await runtime.storage.close().catch(() => undefined);
    disk.restoreNetwork();
  }
});

test('recovery retirement captures the original runtime pair and ordinary close joins the same drain', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const pair = await runtime.backup!.fingerprint(), before = JSON.stringify([...disk.records]);
    const retiring = runtime.storage.retireForRecovery!();
    assert.equal(runtime.storage.retireForRecovery!(), retiring);
    const closing = runtime.storage.close(); assert.equal(runtime.storage.close(), closing);
    await assert.rejects(runtime.session.unlock(PASSWORD), /CANCELLED/);
    assert.equal(await retiring, pair); await closing;
    assert.equal(disk.closes, 1); assert.equal(JSON.stringify([...disk.records]), before);
    assert.equal(await runtime.storage.retireForRecovery!(), pair);
    assert.equal(disk.closes, 1);
  } finally { await runtime.storage.close().catch(() => undefined); disk.restoreNetwork(); }
});

test('an ordinarily closed runtime cannot reopen recovery ownership or read a replacement pair', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const before = JSON.stringify([...disk.records]);
    await runtime.storage.close();
    await assert.rejects(runtime.storage.retireForRecovery!(), { code: 'CLEANUP_FAILED' });
    assert.equal(disk.closes, 1); assert.equal(JSON.stringify([...disk.records]), before);
  } finally { await runtime.storage.close().catch(() => undefined); disk.restoreNetwork(); }
});

test('real published software SDK imports, locks and cold-reopens at production KDF', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  const authority = new NativeCustodyAuthority(disk.factory);
  try {
    await authority.initialize();
    await authority.importPhrase(PHRASE, PASSWORD);
    assert.equal(authority.getSnapshot().phase, 'backup-required');
    assert.equal(authority.getSnapshot().account?.address, ADDRESS);
    const persisted = JSON.stringify([...disk.records]);
    assert.equal(persisted.includes(PHRASE), false);
    assert.equal(persisted.includes(PASSWORD), false);
    assert.deepEqual(disk.records.get('vault-keys') && Object.keys(disk.records.get('vault-keys') as object), ['salt']);
    await authority.dispose();
    const restarted = new NativeCustodyAuthority(disk.factory);
    await restarted.initialize();
    assert.equal(restarted.getSnapshot().phase, 'locked');
    await assert.rejects(restarted.unlock('wrong password'), /INVALID_CREDENTIAL/);
    assert.equal(disk.failures, 1);
    assert.equal(JSON.stringify([...disk.records]), persisted);
    await restarted.unlock(PASSWORD);
    assert.equal(disk.failures, 0);
    assert.equal(restarted.getSnapshot().account?.address, ADDRESS);
    restarted.lock();
    assert.equal(restarted.getSnapshot().account, null);
    await restarted.dispose();
  } finally { disk.restoreNetwork(); }
});

test('a committed wallet with lost acknowledgment is quarantined and reopened intact', async () => {
  const disk = memoryDisk();
  let authority = new NativeCustodyAuthority(disk.factory);
  await authority.initialize();
  disk.loseNextAcknowledgement();
  await assert.rejects(authority.importPhrase(PHRASE, PASSWORD), /UNAVAILABLE/);
  assert.equal(authority.getSnapshot().phase, 'unavailable');
  const committed = JSON.stringify([...disk.records]);
  await assert.rejects(authority.create(PASSWORD), /NOT_READY/);
  await assert.rejects(authority.dispose(), /CLEANUP_FAILED/);
  authority = new NativeCustodyAuthority(disk.factory);
  await authority.initialize();
  await authority.unlock(PASSWORD);
  assert.equal(authority.getSnapshot().account?.address, ADDRESS);
  assert.equal(JSON.stringify([...disk.records]), committed);
  assert.equal(disk.records.has(WALLET_CATALOGUE_KEY), true);
  await authority.dispose();
});

test('native qualification fails before storage or SDK loading', async () => {
  let opened = false;
  let loaded = false;
  const factory = createKeyringRuntimeFactory({ readEvmRetirement: null,
    async ensureCryptoReady() { throw new Error('provider unavailable'); },
    async openStorage() { opened = true; throw new Error('must not open'); },
    async loadSdk() { loaded = true; throw new Error('must not load'); },
  });
  await assert.rejects(factory.open());
  assert.equal(opened, false); assert.equal(loaded, false);
});

test('backup uses fresh SDK authentication and a wallet-bound storage receipt', async () => {
  const disk = memoryDisk();
  const runtime = await disk.factory.open() as KeyringRuntime;
  await runtime.session.importWallet(PHRASE, PASSWORD);
  await assert.rejects(runtime.backup.readPhrase('wrong password'), /INVALID_CREDENTIAL/);
  assert.equal(disk.failures, 1);
  assert.equal((await runtime.session.unlock(PASSWORD)).authenticated, true);
  const words = await runtime.backup.readPhrase(PASSWORD);
  assert.equal(words.join(' '), PHRASE);
  assert.equal(Object.isFrozen(words), true);
  const fingerprint = await runtime.backup.fingerprint();
  await runtime.backup.confirm(fingerprint);
  assert.deepEqual(await runtime.storage.readState(), { presence: 'existing', backup: 'confirmed' });
  await runtime.storage.close();
  await assert.rejects(runtime.session.unlock(PASSWORD), /CANCELLED/);
});

async function controlledSdk() {
  const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
  let entered = () => {};
  let release = Promise.resolve();
  let holding = false;
  let unlockCalls = 0;
  let hydrations = 0;
  class ControlledKeyring extends sdk.SoftwareKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
      super(...options);
      const hydrate = this.createFirstAccount;
      this.createFirstAccount = async (...args) => { hydrations++; return hydrate(...args); };
    }
    async unlock(password: string) {
      unlockCalls++;
      // Start the actual SDK KDF/decryption before yielding to the lifecycle
      // lock. No credential outcome or cryptographic primitive is replaced.
      const result = super.unlock(password);
      if (holding) { entered(); await release; }
      return result;
    }
  }
  return {
    loadSdk: async () => ({ ...sdk, SoftwareKeyring: ControlledKeyring }),
    get hydrations() { return hydrations; },
    get unlockCalls() { return unlockCalls; },
    hold() {
      holding = true;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      let finish!: () => void;
      release = new Promise<void>((resolve) => { finish = resolve; });
      return { started, finish: () => { holding = false; finish(); } };
    },
  };
}

test('lifecycle cancellation still records each explicit wrong-password failure and reaches backoff', async () => {
  const controlled = await controlledSdk();
  const disk = memoryDisk(controlled.loadSdk);
  const runtime = await disk.factory.open();
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    await runtime.session.lock();
    const hydrated = controlled.hydrations, initialUnlocks = controlled.unlockCalls;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const hold = controlled.hold();
      const pending = runtime.session.unlock('wrong password');
      await hold.started;
      await runtime.session.lock();
      hold.finish();
      await assert.rejects(pending, /CANCELLED/);
      assert.equal(disk.failures, attempt);
      assert.equal(disk.failureWrites, attempt);
      assert.equal(disk.successWrites, 0);
      assert.equal(controlled.hydrations, hydrated);
    }
    await assert.rejects(runtime.session.unlock(PASSWORD), /AUTH_THROTTLED/);
    assert.equal(controlled.unlockCalls - initialUnlocks, 5, 'backoff rejects before another SDK KDF');
    await assert.rejects(runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { await runtime.storage.close(); }
});

test('cancelled successful authentication neither clears failures nor hydrates an account', async () => {
  const controlled = await controlledSdk();
  const disk = memoryDisk(controlled.loadSdk);
  const runtime = await disk.factory.open();
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    await runtime.session.lock();
    assert.equal((await runtime.session.unlock('wrong password')).authenticated, false);
    assert.equal(disk.failures, 1);
    const hydrated = controlled.hydrations;
    const hold = controlled.hold();
    const pending = runtime.session.unlock(PASSWORD);
    await hold.started;
    await runtime.session.lock();
    hold.finish();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(disk.failures, 1);
    assert.equal(disk.failureWrites, 1);
    assert.equal(disk.successWrites, 0);
    assert.equal(controlled.hydrations, hydrated);
    await assert.rejects(runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { await runtime.storage.close(); }
});


test('native transfers reuse the unlocked shared SDK session without password checks or network access', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const transfers = runtime.transfers; assert.ok(transfers);
    const transaction = { type: 2 as const, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '123', gasLimit: '21000', data: '0x', maxFeePerGas: '3', maxPriorityFeePerGas: '1' };
    const signed = await transfers.sign(transaction, () => undefined);
    const { Transaction } = await import('ethers/transaction');
    const decoded = Transaction.from(signed.rawTransaction);
    assert.equal(decoded.from, ADDRESS); assert.equal(decoded.hash, signed.hash); assert.equal(decoded.value, 123n);
    const journal = await transfers.journal(() => undefined);
    assert.equal((await journal.saveSigned(signed.rawTransaction)).hash, signed.hash);
    assert.equal((await journal.transition(signed.hash, 'attempted')).phase, 'attempted');
    const writes = { success: disk.successWrites, failure: disk.failureWrites };
    assert.equal((await transfers.sign(transaction, () => undefined)).hash, signed.hash);
    transfers.assertUnlocked(() => undefined);
    assert.deepEqual({ success: disk.successWrites, failure: disk.failureWrites }, writes);
    await runtime.session.lock();
    await assert.rejects(transfers.sign(transaction, () => undefined), /CANCELLED/);
    assert.throws(() => transfers.assertUnlocked(() => undefined), /NOT_READY/);
    assert.equal((await runtime.session.unlock(PASSWORD)).authenticated, true);
    const afterUnlock = disk.successWrites;
    transfers.assertUnlocked(() => undefined);
    await transfers.sign(transaction, () => undefined);
    assert.equal(disk.successWrites, afterUnlock);
    assert.equal((await (await transfers.journal(() => undefined)).load())?.rawTransaction, signed.rawTransaction);
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});


test('an incomplete canonical account record is refused unchanged before account authentication', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  let runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const first = runtime.catalogue.getSnapshot(), record = structuredClone(disk.records.get(WALLET_CATALOGUE_KEY));
    assert.equal(first?.accounts[0]?.address, ADDRESS);
    assert.equal('publicKey' in first!.accounts[0]!, false);
    await runtime.storage.close();
    disk.records.delete(WALLET_CATALOGUE_KEY);
    const incomplete = JSON.stringify([...disk.records]);
    runtime = await disk.factory.open() as KeyringRuntime;
    await assert.rejects(runtime.session.unlock('wrong password'), /OPERATION_FAILED/);
    await assert.rejects(runtime.session.unlock(PASSWORD), /OPERATION_FAILED/);
    assert.equal(disk.failureWrites, 0, 'invalid record admission precedes any password check');
    assert.equal(runtime.catalogue.getSnapshot(), null);
    assert.equal(JSON.stringify([...disk.records]), incomplete);
    await assert.rejects(runtime.session.readSelectedAddress(), /NOT_READY/);
    await runtime.storage.close();
    disk.records.set(WALLET_CATALOGUE_KEY, record);
    const restored = JSON.stringify([...disk.records]);
    runtime = await disk.factory.open() as KeyringRuntime;
    assert.equal((await runtime.session.unlock(PASSWORD)).authenticated, true);
    assert.deepEqual(runtime.catalogue.getSnapshot(), first);
    assert.equal(JSON.stringify([...disk.records]), restored);
    await runtime.session.lock();
    assert.equal(runtime.catalogue.getSnapshot(), null);
    await assert.rejects(runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});

test('catalogue identity corruption retires the authenticated SDK session without rewriting metadata', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  let runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    await runtime.storage.close();
    const record = structuredClone(disk.records.get(WALLET_CATALOGUE_KEY)) as NativeAccountRecord;
    record.groups[0]!.accounts.HDAccount[0]!.address = '0x1111111111111111111111111111111111111111';
    disk.records.set(WALLET_CATALOGUE_KEY, record);
    runtime = await disk.factory.open() as KeyringRuntime;
    await assert.rejects(runtime.session.unlock(PASSWORD), /OPERATION_FAILED/);
    assert.equal(runtime.catalogue.getSnapshot(), null);
    await assert.rejects(runtime.session.readSelectedAddress(), /NOT_READY/);
    assert.deepEqual(disk.records.get(WALLET_CATALOGUE_KEY), record);
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});


test('lost catalogue acknowledgement quarantines authority but close and fresh-runtime recovery still complete', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  let authority = new NativeCustodyAuthority(disk.factory);
  try {
    await authority.initialize();
    disk.loseCatalogueAcknowledgement();
    await assert.rejects(authority.importPhrase(PHRASE, PASSWORD), /UNAVAILABLE/);
    assert.equal(authority.getSnapshot().phase, 'unavailable');
    assert.equal(authority.getSnapshot().account, null);
    assert.equal(disk.records.has(WALLET_CATALOGUE_KEY), true);
    const preserved = JSON.stringify([...disk.records]);
    await assert.rejects(authority.dispose(), /CLEANUP_FAILED/);
    assert.equal(disk.closes, 1, 'quarantined lock does not skip storage.close');
    authority = new NativeCustodyAuthority(disk.factory);
    await authority.initialize();
    assert.equal(authority.getSnapshot().phase, 'locked');
    await authority.unlock(PASSWORD);
    assert.equal(authority.getSnapshot().account?.address, ADDRESS);
    assert.equal(JSON.stringify([...disk.records]), preserved);
    await authority.dispose();
    assert.equal(disk.closes, 2);
  } finally { await authority.dispose().catch(() => undefined); disk.restoreNetwork(); }
});


async function readyAccounts(loadSdk?: KeyringRuntimeDependencies['loadSdk']) {
  const disk = memoryDisk(loadSdk); disk.denyNetwork();
  let runtime!: KeyringRuntime;
  const authority = new NativeCustodyAuthority({ async open() { runtime = await disk.factory.open() as KeyringRuntime; return runtime; } });
  await authority.initialize();
  await authority.importPhrase(PHRASE, PASSWORD);
  await runtime.backup.confirm(await runtime.backup.fingerprint());
  authority.lock(); await authority.unlock(PASSWORD);
  const execute = (request: Parameters<NativeCustodyAuthority['manageAccounts']>[0]) => authority.manageAccounts(request, authority.getSnapshot().revision, authority.getCatalogue()!.revision);
  return { disk, authority, get runtime() { return runtime; }, execute };
}

function approveRuntimeMessage(
  f: Awaited<ReturnType<typeof readyAccounts>>,
  host: Awaited<ReturnType<KeyringRuntime['openConnectionHost']>>,
  request: DappMessageRequest,
  accountId = host.context().activeAccountId!
) {
  const approved = host
    .context()
    .accounts.find((account) => account.id === accountId)!;
  const grant: DappGrant = {
    accountId: approved.index,
    accountType: approved.type as DappGrant['accountType'],
    chain: 'ethereum' as DappGrant['chain'],
    chainId: host.context().network.chainId,
    date: 1,
    host: 'https://approved-message.example',
  };
  const approval = createDappMessageApproval({
    readScope: () => {
      const context = host.context();
      const account = context.accounts.find((value) => value.id === accountId);
      return {
        account: {
          id: approved.index,
          type: approved.type,
          address: account?.address,
          xpub: account?.xpub,
        },
        grant,
        isBitcoinBased: context.network.kind !== 'ethereum',
        network: context.network,
        sessionGeneration: host.sessionGeneration(),
      };
    },
    subscribe: (changed) => f.authority.subscribe(changed),
  });
  return { accountId, networkId: host.context().networkId, request, approval };
}

test('connection message signing uses the published SDK for personal and typed V1/V3/V4 without changing selection', async () => {
  const f = await readyAccounts();
  try {
    const host = await f.runtime.openConnectionHost();
    for (const imported of [false, true]) {
      if (imported) await importTestKey(f);
      const before = f.authority.getCatalogue()!.active.accountId;
      const address = f.authority.getSnapshot().account!.address;
      const payloads = [
        { method: 'personal_sign', data: '0x68656c6c6f' },
        { method: 'personal_sign', data: '0x' + '22'.repeat(20) },
        {
          method: 'eth_signTypedData',
          data: [{ name: 'value', type: 'uint256', value: '7' }],
        },
        ...['eth_signTypedData_v3', 'eth_signTypedData_v4'].map((method) => ({
          method,
          data: {
            types: {
              EIP712Domain: [{ name: 'chainId', type: 'uint256' }],
              Message: [{ name: 'value', type: 'uint256' }],
            },
            primaryType: 'Message',
            domain: { chainId: 1 },
            message: { value: '7' },
          },
        })),
      ];
      for (const { method, data } of payloads) {
        const request = readDappMessageRequest(
          method,
          method === 'personal_sign' ? [data, address] : [address, data],
          address
        )!;
        assert(request);
        const input = approveRuntimeMessage(f, host, request);
        try {
          const signature = await host.signMessage(input);
          const recovered =
            request.method === 'personal_sign'
              ? recoverPersonalSignature({ data: request.message, signature })
              : recoverTypedSignature({
                  data: request.typedData as Parameters<
                    typeof recoverTypedSignature
                  >[0]['data'],
                  signature,
                  version: request.version as SignTypedDataVersion,
                });
          assert.equal(recovered.toLowerCase(), address.toLowerCase());
          assert.equal(f.authority.getCatalogue()!.active.accountId, before);
          assert.equal(f.authority.getSnapshot().phase, 'ready');
        } finally {
          input.approval.dispose();
        }
      }
    }
  } finally {
    await f.authority.dispose();
    f.disk.restoreNetwork();
  }
});

test('message signing requires an explicit account switch and a new approval after that switch', async () => {
  const f = await readyAccounts();
  try {
    const host = await f.runtime.openConnectionHost();
    await f.execute({
      kind: 'create',
      label: 'Other account',
      password: PASSWORD,
    });
    const request = readDappMessageRequest(
      'personal_sign',
      [ADDRESS, 'hello'],
      ADDRESS
    )!;
    const old = approveRuntimeMessage(f, host, request, 'hd:60:0');
    await assert.rejects(host.signMessage(old), /INVALID_INPUT/);
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'hd:60:1');
    const generation = host.sessionGeneration();
    await host.activateMessageAccount('hd:60:0', () => undefined);
    assert(host.sessionGeneration() > generation);
    assert.throws(old.approval.assertCurrent);
    assert.throws(() => host.signMessage(old), { code: 4001 });
    old.approval.dispose();
    const next = approveRuntimeMessage(f, host, request);
    try {
      assert.match(await host.signMessage(next), /^0x[0-9a-f]{130}$/i);
    } finally {
      next.approval.dispose();
    }
  } finally {
    await f.authority.dispose();
    f.disk.restoreNetwork();
  }
});

test('a message signature completing after lock is discarded and shares the privileged-operation mutex', async () => {
  const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
  const entered = deferredAccount(),
    release = deferredAccount();
  class HeldMessageKeyring extends sdk.SoftwareKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
      super(...args);
      const sign = this.ethereumTransaction.signPersonalMessage;
      this.ethereumTransaction.signPersonalMessage = async (params) => {
        const signature = await sign(params);
        entered.resolve();
        await release.promise;
        return signature;
      };
    }
  }
  const f = await readyAccounts(async () => ({
    ...sdk,
    SoftwareKeyring: HeldMessageKeyring,
  }));
  try {
    const host = await f.runtime.openConnectionHost();
    const request = readDappMessageRequest(
      'personal_sign',
      [ADDRESS, 'hello'],
      ADDRESS
    )!;
    const input = approveRuntimeMessage(f, host, request);
    const signing = host.signMessage(input);
    const rejected = assert.rejects(signing, /CANCELLED/);
    await entered.promise;
    await assert.rejects(host.signMessage(input), /BUSY/);
    f.authority.lock();
    release.resolve();
    await rejected;
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    input.approval.dispose();
  } finally {
    release.resolve();
    await f.authority.dispose();
    f.disk.restoreNetwork();
  }
});

async function grantConnection(host: Awaited<ReturnType<KeyringRuntime['openConnectionHost']>>, accountId: number, suffix: string) {
  const origin = `https://app-${suffix}.example`;
  const port = host.repository.permissions({
    peerPublicKey: suffix.repeat(64), topic: suffix.repeat(64), origin,
  });
  const grant: DappGrant = {
    accountId, accountType: 'HDAccount' as DappGrant['accountType'],
    chain: 'ethereum' as DappGrant['chain'], chainId: 1, date: 1, host: origin,
  };
  const frame = { dapps: { [origin]: grant }, pendingOrigins: [] };
  await port.exclusive(async () => { await port.write(frame); port.publish(frame); });
  return { port, origin };
}

test('account removal and connection retirement share one repository and survive ID reuse', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    const host = await f.runtime.openConnectionHost();
    assert.equal((await f.runtime.openConnectionHost()).repository, host.repository);
    const target = await grantConnection(host, 1, 'a');
    const retained = await grantConnection(host, 0, 'b');
    await host.repository.transport.setItem('test-protocol-key', { secret: 'fixture-secret' });
    await f.execute({ kind: 'remove', id: 'hd:60:1', password: PASSWORD });
    assert.deepEqual(target.port.read().dapps, {});
    assert.ok(retained.port.read().dapps[retained.origin]);
    assert.deepEqual(await host.repository.transport.getItem('test-protocol-key'), { secret: 'fixture-secret' });
    await f.execute({ kind: 'create', label: 'Reused', password: PASSWORD });
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'hd:60:1');
    assert.deepEqual(target.port.read().dapps, {});
    await f.authority.dispose();
    const reopened = await f.disk.factory.open() as KeyringRuntime;
    try {
      await reopened.session.unlock(PASSWORD);
      const restored = await reopened.openConnectionHost();
      assert.equal(restored.repository.bindings().length, 1);
      assert.deepEqual(await restored.repository.transport.getItem('test-protocol-key'), { secret: 'fixture-secret' });
      assert.equal(restored.context().activeAccountId, 'hd:60:1');
    } finally { await reopened.storage.close(); }
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const fault of ['cancel', 'lost-ack'] as const) {
  test(`account removal ${fault} cannot persist only one side of permission retirement`, async () => {
    const f = await readyAccounts();
    try {
      await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
      await f.execute({ kind: 'select', id: 'hd:60:0' });
      const host = await f.runtime.openConnectionHost();
      await grantConnection(host, 1, 'a');
      const before = structuredClone(f.disk.records.get(NATIVE_CONNECTION_STORAGE_KEY));
      if (fault === 'cancel') f.disk.onRecord(async (kind, key) => {
        if (kind === 'cas' && key === WALLET_CATALOGUE_KEY) {
          f.disk.onRecord();
          f.authority.lock();
        }
      });
      else f.disk.loseCasAcknowledgement();
      await assert.rejects(f.execute({ kind: 'remove', id: 'hd:60:1', password: PASSWORD }));
      const catalogue = f.disk.records.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
      const connection = f.disk.records.get(NATIVE_CONNECTION_STORAGE_KEY) as { sessions: readonly unknown[] };
      assert.equal(Boolean(catalogue.groups[0]!.accounts.HDAccount[1]), fault === 'cancel');
      if (fault === 'cancel') assert.deepEqual(connection, before);
      else assert.equal(connection.sessions.length, 0);
      await f.authority.dispose().catch(() => undefined);
      const reopened = await f.disk.factory.open() as KeyringRuntime;
      try {
        await reopened.session.unlock(PASSWORD);
        const restored = await reopened.openConnectionHost();
        assert.equal(restored.repository.bindings().length, fault === 'cancel' ? 1 : 0);
      } finally { await reopened.storage.close(); }
    } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
  });
}

test('real SDK HD accounts reuse deleted indices and preserve full records across reopen', async () => {
  const f = await readyAccounts();
  try {
    assert.equal(f.authority.supportsAccountManagement(), true);
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const second = f.authority.getCatalogue()!.accounts.find((a) => a.index === 1)!;
    assert.equal(second.address, '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0');
    assert.equal(f.authority.getSnapshot().account?.address, second.address);
    await f.execute({ kind: 'rename', id: second.id, label: 'Long term' });
    assert.equal(f.authority.getCatalogue()!.accounts.find((a) => a.index === 1)!.label, 'Long term');
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: second.id, password: PASSWORD });
    assert.equal(f.authority.getCatalogue()!.accounts.some(account => account.id === second.id), false);
    await f.execute({ kind: 'create', label: 'New account', password: PASSWORD });
    assert.equal(f.authority.getCatalogue()!.accounts.at(-1)!.index, 1);
    assert.equal(f.authority.getSnapshot().account?.address, second.address);
    assert.equal('removed' in f.authority.getCatalogue()!, false);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: second.id, password: PASSWORD });
    await f.execute({ kind: 'create', label: 'Recreated savings', password: PASSWORD });
    assert.equal(f.authority.getSnapshot().account?.address, second.address);
    const signed = await f.runtime.transfers!.sign({ type: 2, accessList: [], from: second.address,
      to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined);
    const { Transaction } = await import('ethers/transaction');
    assert.equal(Transaction.from(signed.rawTransaction).from, second.address);
    const persisted = JSON.stringify([...f.disk.records]);
    assert.equal(persisted.includes(PHRASE), false); assert.equal(persisted.includes(PASSWORD), false);
    const catalogue = f.authority.getCatalogue();
    await f.authority.dispose();
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.deepEqual(reopened.getCatalogue(), catalogue);
    assert.equal(reopened.getSnapshot().account?.address, second.address);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('sender-owned records preserve first and additional accounts across selection', async () => {
  const f = await readyAccounts();
  const tx = (from: string) => ({ type: 2 as const, accessList: [], from,
    to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' });
  try {
    const first = await f.runtime.transfers!.sign(tx(ADDRESS), () => undefined);
    let journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(first.rawTransaction); await journal.transition(first.hash, 'attempted');
    assert.equal(JSON.parse(f.disk.signedValue()!).entries.length, 1);
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const secondAddress = f.authority.getSnapshot().account!.address;
    journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal(await journal.load(), null);
    const second = await f.runtime.transfers!.sign(tx(secondAddress), () => undefined);
    journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(second.rawTransaction); await journal.transition(second.hash, 'attempted');
    assert.equal(JSON.parse(f.disk.signedValue()!).entries.length, 2);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal((await journal.load())!.rawTransaction, first.rawTransaction);
    await assert.rejects(f.execute({ kind: 'remove', id: 'hd:60:1', password: PASSWORD }), /PENDING_TRANSFER/);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getCatalogue()!.accounts.length, 2);
    await f.execute({ kind: 'select', id: 'hd:60:1' });
    journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal((await journal.load())!.rawTransaction, second.rawTransaction);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('reentrant lock during account admission cannot publish ready or commit a new account', async () => {
  const f = await readyAccounts();
  try {
    let revoked = false;
    const unsubscribe = f.authority.subscribe((state) => {
      if (!revoked && state.phase === 'authenticating') { revoked = true; f.authority.lock(); }
    });
    await assert.rejects(f.execute({ kind: 'create', label: 'Cancelled', password: PASSWORD }), /CANCELLED/);
    unsubscribe();
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getCatalogue()!.accounts.length, 1);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


const deferredAccount = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
async function raceSdk() {
  const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
  let gate: { phase: string; entered: ReturnType<typeof deferredAccount>; released: ReturnType<typeof deferredAccount> } | undefined;
  let signingHook: (() => void) | undefined;
  let exportResult: string | undefined;
  let exportError = false;
  let exports = 0;
  let imports = 0;
  let unlocks = 0;
  let hydrations = 0;
  let allocations = 0;
  let allocationPatch: Record<string, unknown> | undefined;
  const hold = async (phase: string) => {
    if (gate?.phase !== phase) return;
    const current = gate; current.entered.resolve(); await current.released.promise;
  };
  class RaceKeyring extends sdk.SoftwareKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
      super(...options);
      const allocate = this.addNewAccount.bind(this);
      this.addNewAccount = async (...args) => {
        allocations++; await hold('create-before');
        const result = await allocate(...args); await hold('create-after');
        return allocationPatch ? { ...result, ...allocationPatch } : result;
      };
      const hydrate = this.createFirstAccount.bind(this);
      this.createFirstAccount = async (...args) => { hydrations++; const result = hydrate(...args); await hold('hydration'); return result; };
      const sign = this.signPreparedEvmTransaction.bind(this);
      this.signPreparedEvmTransaction = (...args) => { signingHook?.(); return sign(...args); };
      const importKey = this.importAccount.bind(this);
      this.importAccount = async (...args) => {
        imports++; await hold('import-before'); const result = await importKey(...args); await hold('import-after'); return result;
      };
      const encrypt = this.encryptPrivateRecord.bind(this), decrypt = this.decryptPrivateRecord.bind(this);
      this.encryptPrivateRecord = async (...args) => { const result = await encrypt(...args); await hold('encrypt-after'); return result; };
      this.decryptPrivateRecord = async (...args) => { const result = await decrypt(...args); await hold('decrypt-after'); return result; };
      const exportKey = this.getPrivateKeyByAccountId.bind(this);
      this.getPrivateKeyByAccountId = async (...args) => {
        exports++;
        assert.equal(args[1], sdk.KeyringAccountType.HDAccount);
        await hold('export-before');
        if (exportError) throw new Error('synthetic SDK error containing secret material');
        const result = exportResult ?? await exportKey(...args);
        await hold('export-after');
        return result;
      };
    }
    async unlock(password: string) { unlocks++; const result = super.unlock(password); await hold('password'); return result; }
  }
  return {
    loadSdk: async () => ({ ...sdk, SoftwareKeyring: RaceKeyring }),
    onSign(hook?: () => void) { signingHook = hook; },
    get exports() { return exports; },
    get imports() { return imports; },
    get unlocks() { return unlocks; },
    get hydrations() { return hydrations; },
    get allocations() { return allocations; },
    setAllocationPatch(value?: Record<string, unknown>) { allocationPatch = value; },
    setExportResult(value?: string) { exportResult = value; },
    failExport() { exportError = true; },
    hold(phase: string) {
      const current = { phase, entered: deferredAccount(), released: deferredAccount() }; gate = current;
      return { entered: current.entered.promise, release() { gate = undefined; current.released.resolve(); } };
    },
  };
}
type TransferTestNetwork = 'ethereum' | 'syscoin-nevm-testnet' | 'zksys-testnet';
function localTransferRpc(networkId: TransferTestNetwork = 'ethereum', selected: NativeNetworkRegistration = getNativeNetwork(networkId)) {
  const broadcasts: string[] = [];
  const requests: { method: string; params: any[] }[] = [];
  let baseFee = 1n, priorityFee = 1n;
  let estimateGas = (_transaction: Record<string, unknown>) => 21000n;
  let included = false;
  let reading: { method: string; entered: ReturnType<typeof deferredAccount>; released: ReturnType<typeof deferredAccount> } | undefined;
  let gate: { entered: ReturnType<typeof deferredAccount>; released: ReturnType<typeof deferredAccount> } | undefined;
  const rpc = new NativeTransferRpc({ networkId, registration: selected, fetch: async (url, init) => {
    assert.equal(url, selected.rpcUrl);
    const body = JSON.parse(String(init.body));
    requests.push(structuredClone({ method: body.method, params: body.params }));
    if (reading && reading.method === body.method) { const current = reading; current.entered.resolve(); await current.released.promise; }
    let result: unknown;
    if (body.method === 'eth_chainId') result = `0x${BigInt(selected.chainId).toString(16)}`;
    else if (body.method === 'eth_getBalance') result = '0x10000000000000000';
    else if (body.method === 'eth_getTransactionCount') result = included ? '0x1' : '0x0';
    else if (body.method === 'eth_gasPrice') result = `0x${(baseFee + priorityFee).toString(16)}`;
    else if (body.method === 'eth_feeHistory') result = { oldestBlock: '0x64', baseFeePerGas: [`0x${baseFee.toString(16)}`, `0x${baseFee.toString(16)}`] };
    else if (body.method === 'eth_maxPriorityFeePerGas') result = `0x${priorityFee.toString(16)}`;
    else if (body.method === 'eth_estimateGas') result = `0x${estimateGas(body.params[0]).toString(16)}`;
    else if (body.method === 'eth_getTransactionReceipt') {
      const tx = included && broadcasts[0] ? Transaction.from(broadcasts[0]) : null;
      result = tx ? { transactionHash: tx.hash, from: tx.from, to: tx.to, status: '0x1', blockNumber: '0x59', blockHash: '0x' + '2'.repeat(64) } : null;
    }
    else if (body.method === 'eth_getBlockByNumber') result = {
      number: body.params[0] === 'finalized' ? (networkId === 'zksys-testnet' ? '0x64' : '0x20') : body.params[0] === 'latest' ? '0x64' : body.params[0],
      hash: '0x' + '2'.repeat(64), baseFeePerGas: `0x${baseFee.toString(16)}`, gasLimit: '0x1c9c380',
    };
    else if (body.method === 'eth_sendRawTransaction') {
      broadcasts.push(body.params[0]);
      if (gate) { const current = gate; current.entered.resolve(); await current.released.promise; }
      result = keccak256(body.params[0]);
    } else throw Error('Unexpected fixture RPC');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
  } });
  return { rpc, broadcasts, requests, include() { included = true; },
    setFees(fees: { baseFee?: bigint; priorityFee?: bigint; estimateGas?: (transaction: Record<string, unknown>) => bigint }) {
      baseFee = fees.baseFee ?? baseFee;
      priorityFee = fees.priorityFee ?? priorityFee;
      estimateGas = fees.estimateGas ?? estimateGas;
    }, holdRead(method: string) {
    const current = { method, entered: deferredAccount(), released: deferredAccount() }; reading = current;
    return { entered: current.entered.promise, release() { reading = undefined; current.released.resolve(); } };
  }, holdBroadcast() {
    const current = { entered: deferredAccount(), released: deferredAccount() }; gate = current;
    return { entered: current.entered.promise, release() { gate = undefined; current.released.resolve(); } };
  } };
}
async function prepareAccountTransfer(transfers: NativeTransfers) {
  await transfers.prepare('0x1111111111111111111111111111111111111111', '0.001');
  return transfers.getSnapshot().review!.id;
}

test('activity reset retires saved handles and clears only the selected account and chain', async () => {
  const f = await readyAccounts();
  const sign = (chainId: string) => f.runtime.transfers!.sign({ type: 2, accessList: [], from: ADDRESS, to: ADDRESS,
    chainId, nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined);
  try {
    const ethereum = await sign('1');
    const first = await f.runtime.transfers!.journal(() => undefined);
    await first.saveSigned(ethereum.rawTransaction);
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    const base = await sign('8453');
    await (await f.runtime.transfers!.journal(() => undefined)).saveSigned(base.rawTransaction);
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    const stale = await f.runtime.transfers!.journal(() => undefined);
    let invalidations = 0;
    await f.runtime.resetActivity(() => undefined, () => { invalidations++; });
    assert.equal(invalidations, 1);
    await assert.rejects(stale.load(), /CANCELLED|CONTEXT_CHANGED/);
    assert.equal(await (await f.runtime.transfers!.journal(() => undefined)).load(), null);
    assert.equal(await f.runtime.session.readSelectedAddress(), ADDRESS);
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    assert.equal((await (await f.runtime.transfers!.journal(() => undefined)).load())!.hash, base.hash);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('activity reset inside signing revokes the result without locking the current owner', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  let reset: Promise<void> | undefined;
  try {
    sdk.onSign(() => { reset = f.runtime.resetActivity(() => undefined, () => undefined); });
    await assert.rejects(f.runtime.transfers!.sign({ type: 2, accessList: [], from: ADDRESS, to: ADDRESS,
      chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined), /CANCELLED/);
    assert(reset);
    await reset;
    assert.equal(await f.runtime.session.readSelectedAddress(), ADDRESS);
    assert.equal(await (await f.runtime.transfers!.journal(() => undefined)).load(), null);
    sdk.onSign(() => { throw Error('current signing failed'); });
    await assert.rejects(f.runtime.transfers!.sign({ type: 2, accessList: [], from: ADDRESS, to: ADDRESS,
      chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined), /OPERATION_FAILED/);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    await assert.rejects(f.runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { sdk.onSign(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('locking an in-flight activity reset preserves its stored records', async () => {
  const f = await readyAccounts();
  const entered = deferredAccount(), release = deferredAccount();
  try {
    const signed = await f.runtime.transfers!.sign({ type: 2, accessList: [], from: ADDRESS, to: ADDRESS,
      chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined);
    await (await f.runtime.transfers!.journal(() => undefined)).saveSigned(signed.rawTransaction);
    const before = f.disk.signedValue();
    f.disk.onRecord(async (kind, key) => {
      if (kind === 'get' && key.startsWith('pali-evm-signed-v1:')) { entered.resolve(); await release.promise; }
    });
    const reset = f.runtime.resetActivity(() => undefined, () => undefined);
    const rejected = assert.rejects(reset, /CANCELLED|CONTEXT_CHANGED/);
    await entered.promise;
    f.authority.lock();
    release.resolve();
    await rejected;
    assert.equal(f.disk.signedValue(), before);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
  } finally { release.resolve(); f.disk.onRecord(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('activity reset drains an interrupted broadcast before clearing local tracking', async () => {
  const f = await readyAccounts(), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  const held = network.holdBroadcast();
  try {
    const confirm = transfers.confirm(await prepareAccountTransfer(transfers));
    const cancelled = assert.rejects(confirm, /CANCELLED/);
    await held.entered;
    const reset = f.runtime.resetActivity(() => undefined, () => transfers.cancelForActivityReset());
    assert.throws(() => f.runtime.transfers!.assertUnlocked(() => undefined), /BUSY/);
    held.release();
    await Promise.all([cancelled, reset]);
    assert.equal(await f.runtime.session.readSelectedAddress(), ADDRESS);
    assert.equal(transfers.getSnapshot().review, null);
    assert.equal(await (await f.runtime.transfers!.journal(() => undefined)).load(), null);
    assert.equal(network.broadcasts.length, 1);
  } finally { held.release(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const networkId of ['ethereum', 'zksys-testnet'] as const) {
test(`${networkId} normal confirmation and exact-byte retry perform no extra authentication or hydration`, async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc(networkId);
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    const before = { unlocks: sdk.unlocks, hydrations: sdk.hydrations, success: f.disk.successWrites, failure: f.disk.failureWrites };
    await transfers.confirm(await prepareAccountTransfer(transfers));
    await transfers.recover(true);
    const retry = transfers.getSnapshot().review!;
    assert.equal(retry.retry, true);
    await transfers.confirm(retry.id);
    assert.deepEqual({ unlocks: sdk.unlocks, hydrations: sdk.hydrations, success: f.disk.successWrites, failure: f.disk.failureWrites }, before);
    assert.equal(network.broadcasts.length, 2);
    assert.equal(network.broadcasts[0], network.broadcasts[1]);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test(`${networkId} synchronous selection reentrancy from SDK signing is denied before authority publication`, async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc(networkId);
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    let attempted: Promise<void> | undefined;
    const revision = f.authority.getSnapshot().revision;
    sdk.onSign(() => { attempted = f.execute({ kind: 'select', id: 'hd:60:0' }); void attempted.catch(() => undefined); });
    await transfers.confirm(await prepareAccountTransfer(transfers));
    await assert.rejects(attempted!, /BUSY/);
    assert.equal(f.authority.getSnapshot().revision, revision);
    assert.equal(Transaction.from(network.broadcasts[0]!).from, f.authority.getSnapshot().account!.address);
  } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const phase of ['journal-read', 'journal-write', 'broadcast'] as const) {
  test(`${networkId} A-B-A account selection invalidates held ${phase} and preserves its original journal`, async () => {
    const f = await readyAccounts(), network = localTransferRpc(networkId);
    const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
    const entered = deferredAccount(), release = deferredAccount();
    let broadcastHold: ReturnType<typeof network.holdBroadcast> | undefined;
    try {
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
      await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
      await f.execute({ kind: 'select', id: 'hd:60:0' });
      const oldRevision = f.authority.getSnapshot().revision;
      let pending: Promise<void>;
      if (phase === 'journal-read') {
        f.disk.onRecord(async (kind, key) => { if (kind === 'get' && key.startsWith('pali-evm-signed-v1:')) { f.disk.onRecord(); entered.resolve(); await release.promise; } });
        pending = transfers.prepare('0x1111111111111111111111111111111111111111', '0.001');
      } else {
        const id = await prepareAccountTransfer(transfers);
        if (phase === 'journal-write') f.disk.onRecord(async (kind, key) => { if (kind === 'create' && key.startsWith('pali-evm-signed-v1:')) { f.disk.onRecord(); entered.resolve(); await release.promise; } });
        else { broadcastHold = network.holdBroadcast(); void broadcastHold.entered.then(entered.resolve); }
        pending = transfers.confirm(id);
      }
      void pending.catch(() => undefined);
      await entered.promise;
      await f.execute({ kind: 'select', id: 'hd:60:1' });
      assert.equal(f.disk.records.has('native-evm-transfer-v1:hd:60:1'), false);
      await f.execute({ kind: 'select', id: 'hd:60:0' });
      assert.ok(f.authority.getSnapshot().revision > oldRevision);
      release.resolve(); broadcastHold?.release();
      await assert.rejects(pending, /CANCELLED/);
      assert.equal(f.authority.getSnapshot().phase, 'ready');
      const old = await (await f.runtime.transfers!.journal(() => undefined)).load();
      assert.equal(old?.phase, phase === 'journal-read' ? undefined : 'signed');
      if (old) assert.equal(Transaction.from(old.rawTransaction).from, ADDRESS);
      assert.equal(network.broadcasts.length, phase === 'broadcast' ? 1 : 0);
      assert.equal(transfers.getSnapshot().review, null);
    } finally { release.resolve(); broadcastHold?.release(); f.disk.onRecord(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
  });
}

}

test('account selection waits for active backup authentication and invalidates a completed old challenge', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  const backup = new SeedBackupFlow(f.authority, () => f.runtime.backup);
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const hold = sdk.hold('password');
    const pending = backup.begin(PASSWORD);
    await hold.entered;
    await assert.rejects(f.execute({ kind: 'select', id: 'hd:60:0' }), /BUSY/);
    hold.release(); const challenge = await pending;
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await assert.rejects(backup.confirm(challenge.id, challenge.positions.map((position) => challenge.words[position]!)), /BACKUP_EXPIRED/);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally { backup.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('lost mutation acknowledgement quarantines authority and reopens the exact committed account change', async () => {
  const f = await readyAccounts();
  try {
    f.disk.loseCasAcknowledgement();
    await assert.rejects(f.execute({ kind: 'rename', id: 'hd:60:0', label: 'Committed once' }), /UNAVAILABLE/);
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    assert.equal(f.authority.getSnapshot().account, null);
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    assert.equal(f.disk.closes, 1);
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getCatalogue()!.accounts[0]!.label, 'Committed once');
    assert.equal(reopened.getCatalogue()!.revision, 1);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('async host guards never authorize account mutation, journal access or a signature', async () => {
  const f = await readyAccounts();
  const asynchronousGuard = async () => { throw Error('Asynchronous guard rejection is observed'); };
  try {
    const before = JSON.stringify(f.disk.records.get(WALLET_CATALOGUE_KEY));
    const reservation = f.runtime.accounts!.reserve({ kind: 'create', label: 'Must not commit', password: PASSWORD }, f.authority.getCatalogue()!.revision);
    await assert.rejects(reservation.execute(asynchronousGuard), /CANCELLED/);
    assert.equal(JSON.stringify(f.disk.records.get(WALLET_CATALOGUE_KEY)), before);
    await f.runtime.session.unlock(PASSWORD);
    await assert.rejects(f.runtime.transfers!.journal(asynchronousGuard), /CANCELLED/);
    assert.throws(() => f.runtime.transfers!.assertUnlocked(asynchronousGuard), /CANCELLED/);
    await assert.rejects(f.runtime.transfers!.sign({ type: 2, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, asynchronousGuard), /CANCELLED/);
    assert.equal(JSON.stringify(f.disk.records.get(WALLET_CATALOGUE_KEY)), before);
    assert.equal(f.disk.records.has('native-evm-transfer-v1'), false);
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('known ineligible account requests preserve the ready authority and its revision', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const before = f.authority.getSnapshot(), catalogue = f.authority.getCatalogue();
    const persisted = JSON.stringify([...f.disk.records]);
    const credentials = [f.disk.failureWrites, f.disk.successWrites];
    const requests = [
      { kind: 'remove' as const, id: 'hd:60:0', password: PASSWORD },
      { kind: 'remove' as const, id: 'hd:60:1', password: PASSWORD },
      { kind: 'remove' as const, id: 'hd:60:99', password: PASSWORD },
      { kind: 'select' as const, id: 'hd:60:99' },
      { kind: 'rename' as const, id: 'hd:60:99', label: 'Missing' },
      { kind: 'select' as const, id: 'hd:60:9007199254740992' },
    ];
    let publications = 0;
    const stop = f.authority.subscribe(() => { publications++; });
    for (const request of requests) {
      await assert.rejects(f.execute(request), /ACCOUNT_NOT_REMOVABLE|INVALID_INPUT/);
      assert.equal(f.authority.getSnapshot(), before);
      assert.equal(f.authority.getCatalogue(), catalogue);
      assert.equal(JSON.stringify([...f.disk.records]), persisted);
      assert.deepEqual([f.disk.failureWrites, f.disk.successWrites], credentials);
    }
    stop(); assert.equal(publications, 0);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('runtime supports more than twenty complete SDK accounts and reuses the first vacant slot', async () => {
  const f = await readyAccounts();
  try {
    for (let index = 1; index <= 21; index++)
      await f.execute({ kind: 'create', label: `Account ${index + 1}`, password: PASSWORD });
    assert.equal(f.authority.getCatalogue()!.accounts.length, 22);
    const before = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY)) as NativeAccountRecord;
    const retained = before.groups[0]!.accounts.HDAccount[21]!;
    assert.ok(retained.xprv);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'hd:60:1', password: PASSWORD });
    await f.execute({ kind: 'create', label: 'Reused gap', password: PASSWORD });
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'hd:60:1');
    assert.equal(f.authority.getCatalogue()!.accounts.length, 22);
    const saved = f.disk.records.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    assert.deepEqual(saved.groups[0]!.accounts.HDAccount[21], retained);
    assert.equal('nextIndex' in saved, false);
    const wire = JSON.stringify([...f.disk.records]);
    f.authority.lock(); await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getCatalogue()!.accounts.length, 22);
    assert.equal(JSON.stringify([...f.disk.records]), wire);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('all EVM contexts preserve SDK HD addresses and all valid EVM registrations use prepared signing', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const address = f.authority.getSnapshot().account!.address;
    const select = (id: string) => f.authority.selectNetwork(id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    for (const network of NATIVE_NETWORKS) {
      await select(network.id);
      assert.equal(f.authority.getSnapshot().account!.network, network.id);
      assert.equal(f.authority.getSnapshot().account!.address, address);
      const signed = await f.runtime.transfers!.sign({ type: 2, accessList: [], from: address, to: ADDRESS, chainId: network.chainId, nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined);
      assert.equal(Transaction.from(signed.rawTransaction).chainId, BigInt(network.chainId));
    }
    await select('syscoin-nevm');
    await f.execute({ kind: 'create', label: 'New on NEVM context', password: PASSWORD });
    const derived = f.authority.getSnapshot().account!.address;
    assert.equal(f.authority.getCatalogue()!.active.networkId, 'syscoin-nevm');
    await select('ethereum');
    assert.equal(f.authority.getSnapshot().account!.address, derived);
    await select('rollux');
    await f.authority.dispose();
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getSnapshot().account!.network, 'rollux');
    assert.equal(reopened.getSnapshot().account!.address, derived);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('installed SDK retains same-address same-nonce Ethereum, NEVM and zkSYS journal siblings across restart', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Cross-chain', password: PASSWORD });
    const account = f.authority.getSnapshot().account!.address;
    const transaction = (chainId: string) => ({ type: 2 as const, accessList: [], from: account, to: ADDRESS, chainId,
      nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' });
    const signedByNetwork = new Map<TransferTestNetwork, { rawTransaction: string; hash: string }>();
    for (const networkId of ['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet'] as const) {
      await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
      const chainId = getNativeNetwork(networkId).chainId;
      const wrongChainId = networkId === 'ethereum' ? '57057' : '1';
      await assert.rejects(f.runtime.transfers!.sign(transaction(wrongChainId), () => undefined), /INVALID_INPUT/);
      const signed = await f.runtime.transfers!.sign(transaction(chainId), () => undefined);
      const parsed = Transaction.from(signed.rawTransaction);
      assert.equal(parsed.chainId, BigInt(chainId)); assert.equal(parsed.from, account); assert.equal(parsed.nonce, 0);
      const journal = await f.runtime.transfers!.journal(() => undefined);
      await journal.saveSigned(signed.rawTransaction); await journal.transition(signed.hash, 'attempted');
      signedByNetwork.set(networkId, signed);
    }
    assert.equal(new Set([...signedByNetwork.values()].map((entry) => entry.hash)).size, 3);
    const stored = JSON.parse(f.disk.signedValue()!);
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.entries.map((entry: any) => [entry.chainId, entry.nonce]), [['1', 0], ['5700', 0], ['57057', 0]]);
    await f.authority.dispose();
    let runtime!: KeyringRuntime;
    const reopened = new NativeCustodyAuthority({ async open() { runtime = await f.disk.factory.open() as KeyringRuntime; return runtime; } });
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getSnapshot().account?.network, 'zksys-testnet');
    for (const networkId of ['zksys-testnet', 'syscoin-nevm-testnet', 'ethereum'] as const) {
      await reopened.selectNetwork(networkId, reopened.getSnapshot().revision, reopened.getCatalogue()!.revision);
      assert.equal((await (await runtime.transfers!.journal(() => undefined)).load())!.rawTransaction, signedByNetwork.get(networkId)!.rawTransaction);
    }
    await reopened.manageAccounts({ kind: 'select', id: 'hd:60:0' }, reopened.getSnapshot().revision, reopened.getCatalogue()!.revision);
    await assert.rejects(reopened.manageAccounts({ kind: 'remove', id: 'hd:60:1', password: PASSWORD }, reopened.getSnapshot().revision, reopened.getCatalogue()!.revision), /PENDING_TRANSFER/);
    assert.deepEqual(JSON.parse(f.disk.signedValue()!), stored);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const networkId of ['syscoin-nevm-testnet', 'zksys-testnet'] as const) {
test(`${networkId} native controller retries exact installed-SDK bytes before its ordinary receipt confirmation`, async () => {
  const f = await readyAccounts(), network = localTransferRpc(networkId);
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    const review = await prepareAccountTransfer(transfers);
    assert.equal(transfers.getSnapshot().review!.context.chainId, getNativeNetwork(networkId).chainId);
    assert.equal(transfers.getSnapshot().review!.context.symbol, 'TSYS');
    await transfers.confirm(review);
    assert.equal(network.broadcasts.length, 1);
    assert.equal(Transaction.from(network.broadcasts[0]!).chainId, BigInt(getNativeNetwork(networkId).chainId));
    await transfers.recover(true);
    assert.equal(transfers.getSnapshot().review!.retry, true);
    await transfers.confirm(transfers.getSnapshot().review!.id);
    assert.equal(network.broadcasts.length, 2);
    assert.equal(network.broadcasts[1], network.broadcasts[0]);
    network.include();
    await transfers.recover();
    assert.equal(transfers.getSnapshot().phase, 'confirmed');
    assert.equal(transfers.getSnapshot().context!.chainId, getNativeNetwork(networkId).chainId);
    assert.equal((await (await f.runtime.transfers!.journal(() => undefined)).load())!.phase, 'confirmed');
  } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test(`${networkId} A-B-A cancels a pending quote without adopting its late context`, async () => {
  const f = await readyAccounts(), network = localTransferRpc(networkId);
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  const hold = network.holdRead('eth_gasPrice');
  try {
    const select = (id: string) => f.authority.selectNetwork(id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    await select(networkId);
    const preparing = transfers.prepare(ADDRESS, '0.001'); void preparing.catch(() => undefined);
    await hold.entered;
    await select('ethereum'); await select(networkId);
    hold.release();
    await assert.rejects(preparing, /CANCELLED/);
    assert.equal(transfers.getSnapshot().review, null);
    assert.equal(network.broadcasts.length, 0);
    assert.equal(await (await f.runtime.transfers!.journal(() => undefined)).load(), null);
  } finally { hold.release(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test(`${networkId} synchronous network reentrancy cannot retarget the current shared SDK signature`, async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc(networkId);
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    let attempted: Promise<void> | undefined;
    const revision = f.authority.getSnapshot().revision;
    sdk.onSign(() => {
      attempted = f.authority.selectNetwork('ethereum', revision, f.authority.getCatalogue()!.revision);
      void attempted.catch(() => undefined);
    });
    await transfers.confirm(await prepareAccountTransfer(transfers));
    await assert.rejects(attempted!, /BUSY/);
    assert.equal(f.authority.getSnapshot().revision, revision);
    assert.equal(Transaction.from(network.broadcasts[0]!).chainId, BigInt(getNativeNetwork(networkId).chainId));
  } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const phase of ['journal-write', 'broadcast'] as const) {
  test(`${networkId} A-B-A during ${phase} preserves the original exact-byte recovery record`, async () => {
    const f = await readyAccounts(), network = localTransferRpc(networkId);
    const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
    const entered = deferredAccount(), release = deferredAccount();
    let broadcastHold: ReturnType<typeof network.holdBroadcast> | undefined;
    try {
      const select = (id: string) => f.authority.selectNetwork(id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
      await select(networkId);
      const review = await prepareAccountTransfer(transfers);
      if (phase === 'journal-write') f.disk.onRecord(async (kind, key) => {
        if (kind === 'create' && key.startsWith('pali-evm-signed-v1:')) { entered.resolve(); await release.promise; }
      });
      else broadcastHold = network.holdBroadcast();
      const signing = transfers.confirm(review); void signing.catch(() => undefined);
      await (broadcastHold?.entered ?? entered.promise);
      await select('ethereum'); await select(networkId);
      release.resolve(); broadcastHold?.release();
      await assert.rejects(signing, /CANCELLED/);
      f.disk.onRecord();
      const entry = await (await f.runtime.transfers!.journal(() => undefined)).load();
      assert.equal(Transaction.from(entry!.rawTransaction).chainId, BigInt(getNativeNetwork(networkId).chainId));
      assert.equal(entry!.phase, 'signed');
      await transfers.recover(true);
      assert.equal(transfers.getSnapshot().review!.retry, true);
      assert.equal(transfers.getSnapshot().hash, entry!.hash);
      assert.equal(transfers.getSnapshot().review!.context.chainId, getNativeNetwork(networkId).chainId);
    } finally { release.resolve(); broadcastHold?.release(); f.disk.onRecord(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
  });
}

}

for (const expensiveAfterReview of [false, true]) {
  test(`zkSYS confirmation ${expensiveAfterReview ? 'expires when approved fees need more gas' : 'keeps approved fees when the suggested tip changes'}`, async () => {
    const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc('zksys-testnet');
    const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
    let signatures = 0;
    sdk.onSign(() => { signatures++; });
    let currentBase = 10n;
    const gasFor = (transaction: Record<string, unknown>) => {
      const cap = BigInt(String(transaction.maxFeePerGas));
      const price = currentBase + BigInt(String(transaction.maxPriorityFeePerGas));
      return (price > cap ? cap : price) < 10n ? 30000n : 21000n;
    };
    network.setFees({ baseFee: currentBase, priorityFee: 0n, estimateGas: gasFor });
    try {
      await f.authority.selectNetwork('zksys-testnet', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
      const id = await prepareAccountTransfer(transfers);
      const approved = transfers.getSnapshot().review!;
      assert.equal(approved.priorityFeePerGas, '0');
      assert.equal(approved.maximumFeePerGas, '25');
      assert.equal(approved.gasLimit, '25200');
      currentBase = expensiveAfterReview ? 1n : 10n;
      network.setFees({ baseFee: currentBase, priorityFee: 9n });
      if (expensiveAfterReview) {
        await assert.rejects(transfers.confirm(id), /EXPIRED/);
        assert.equal(network.broadcasts.length, 0);
        assert.equal(await (await f.runtime.transfers!.journal(() => undefined)).load(), null);
      } else {
        await transfers.confirm(id);
        assert.equal(network.broadcasts.length, 1);
        const signed = Transaction.from(network.broadcasts[0]!);
        assert.equal(signed.chainId, 57057n);
        assert.equal(signed.maxFeePerGas, 25n);
        assert.equal(signed.maxPriorityFeePerGas, 0n);
        assert.equal(signed.gasLimit, 25200n);
      }
      assert.equal(signatures, expensiveAfterReview ? 0 : 1);
      const estimates = network.requests.filter((request) => request.method === 'eth_estimateGas');
      assert.equal(estimates.length, 2);
      for (const request of estimates) {
        assert.equal(request.params[1], 'pending');
        assert.deepEqual(request.params[0], {
          type: '0x2', accessList: [], chainId: '0xdee1', from: ADDRESS,
          to: '0x1111111111111111111111111111111111111111',
          nonce: '0x0', value: '0x38d7ea4c68000', data: '0x',
          maxFeePerGas: '0x19', maxPriorityFeePerGas: '0x0',
        });
      }
      if (expensiveAfterReview) {
        // Re-estimating a newly suggested envelope would understate the old envelope's need.
        assert.equal(gasFor({ maxFeePerGas: '0xb', maxPriorityFeePerGas: '0x9' }), 21000n);
        assert.equal(gasFor(estimates[1]!.params[0]), 30000n);
      }
    } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
  });
}

test('network selection rejects unknown identity and active SDK work before changing authority', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    const before = f.authority.getSnapshot();
    await assert.rejects(f.execute({ kind: 'select-network', id: 'base' } as any), /INVALID_INPUT/);
    assert.equal(f.authority.getSnapshot(), before);
    await assert.rejects(f.authority.selectNetwork('unknown', before.revision, f.authority.getCatalogue()!.revision), /INVALID_INPUT/);
    assert.equal(f.authority.getSnapshot(), before);
    const hold = sdk.hold('password');
    const pending = f.runtime.backup.readPhrase(PASSWORD);
    await hold.entered;
    await assert.rejects(f.authority.selectNetwork('base', before.revision, f.authority.getCatalogue()!.revision), /BUSY/);
    assert.equal(f.authority.getSnapshot(), before);
    hold.release(); await pending;
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('lost network-context CAS acknowledgement quarantines and cold reopens its committed selection', async () => {
  const f = await readyAccounts();
  try {
    f.disk.loseCasAcknowledgement();
    await assert.rejects(f.authority.selectNetwork('arbitrum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision), /UNAVAILABLE/);
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getSnapshot().account!.network, 'arbitrum');
    assert.equal(reopened.getSnapshot().account!.address, ADDRESS);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('network A-B-A cancels held Ethereum journal work without touching its pending identity', async () => {
  const f = await readyAccounts(), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  const entered = deferredAccount(), release = deferredAccount();
  try {
    const review = await prepareAccountTransfer(transfers);
    f.disk.onRecord(async (kind, key) => { if (kind === 'create' && key.startsWith('pali-evm-signed-v1:')) { f.disk.onRecord(); entered.resolve(); await release.promise; } });
    const pending = transfers.confirm(review); void pending.catch(() => undefined);
    await entered.promise;
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    assert.equal(f.authority.getSnapshot().account?.network, 'base');
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    release.resolve(); await assert.rejects(pending, /CANCELLED/);
    const entry = await (await f.runtime.transfers!.journal(() => undefined)).load();
    assert.equal(entry!.phase, 'signed');
    assert.equal(Transaction.from(entry!.rawTransaction).from, ADDRESS);
    assert.equal(network.broadcasts.length, 0);
  } finally { release.resolve(); f.disk.onRecord(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('account removal checks every chain and keeps all sender-owned signed bytes', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const address = f.authority.getSnapshot().account!.address;
    const sign = async (chainId: string) => f.runtime.transfers!.sign({ type: 2, accessList: [], from: address, to: ADDRESS, chainId, nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined);
    const first = await sign('1'); let journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(first.rawTransaction); await journal.transition(first.hash,'nonce-consumed');
    await f.authority.selectNetwork('syscoin-nevm',f.authority.getSnapshot().revision,f.authority.getCatalogue()!.revision);
    const other = await sign('57'); journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(other.rawTransaction); await journal.transition(other.hash,'attempted');
    await f.execute({ kind:'select',id:'hd:60:0' });
    await assert.rejects(f.execute({kind:'remove',id:'hd:60:1',password:PASSWORD}),/PENDING_TRANSFER/);
    await f.authority.unlock(PASSWORD); await f.execute({kind:'select',id:'hd:60:1'});
    journal=await f.runtime.transfers!.journal(()=>undefined); await journal.transition(other.hash,'confirmed');
    const retained=f.disk.signedValue(); await f.execute({kind:'select',id:'hd:60:0'});
    await f.execute({kind:'remove',id:'hd:60:1',password:PASSWORD});
    assert.equal(f.disk.signedValue(),retained); assert.equal(JSON.parse(retained!).entries.length,2);
    await f.execute({kind:'create',label:'Recreated',password:PASSWORD});
    assert.equal(f.authority.getSnapshot().account!.address,address);
    assert.equal((await (await f.runtime.transfers!.journal(()=>undefined)).load())!.rawTransaction,other.rawTransaction);
    await f.authority.selectNetwork('ethereum',f.authority.getSnapshot().revision,f.authority.getCatalogue()!.revision);
    assert.equal((await (await f.runtime.transfers!.journal(()=>undefined)).load())!.rawTransaction,first.rawTransaction);
  } finally { await f.authority.dispose().catch(()=>undefined); f.disk.restoreNetwork(); }
});

test('ambiguous signed-record acknowledgement quarantines authority and reopening preserves bytes', async () => {
  const f = await readyAccounts(), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    const review = await prepareAccountTransfer(transfers);
    f.disk.loseCasAcknowledgement();
    await assert.rejects(transfers.confirm(review));
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    assert.equal(network.broadcasts.length, 0);
    const value = JSON.parse(f.disk.signedValue()!);
    assert.equal(value.entries[0].phase, 'signed');
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    assert.equal(f.disk.closes, 1);
    let runtime!: KeyringRuntime;
    const reopened = new NativeCustodyAuthority({ async open() { runtime = await f.disk.factory.open() as KeyringRuntime; return runtime; } });
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    const saved = await (await runtime.transfers!.journal(() => undefined)).load();
    assert.equal(saved!.hash, value.entries[0].hash);
    assert.equal(saved!.phase, 'signed');
    await reopened.dispose();
  } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('an ambiguous journal acknowledgement after background lock cannot be unlocked without reopening', async () => {
  const f = await readyAccounts(), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  const entered = deferredAccount(), release = deferredAccount();
  try {
    const review = await prepareAccountTransfer(transfers);
    f.disk.onRecord(async (kind, key) => { if (kind === 'create' && key.startsWith('pali-evm-signed-v1:')) { f.disk.onRecord(); entered.resolve(); await release.promise; } });
    f.disk.loseNextAcknowledgement();
    const pending = transfers.confirm(review); void pending.catch(() => undefined);
    await entered.promise;
    f.authority.lock(); release.resolve();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    await assert.rejects(f.authority.unlock(PASSWORD), /NOT_READY/);
    assert.equal(network.broadcasts.length, 0);
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    let runtime!: KeyringRuntime;
    const reopened = new NativeCustodyAuthority({ async open() { runtime = await f.disk.factory.open() as KeyringRuntime; return runtime; } });
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal((await (await runtime.transfers!.journal(() => undefined)).load())!.phase, 'signed');
    await reopened.dispose();
  } finally { release.resolve(); f.disk.onRecord(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('fresh runtime validates the complete retained container before publishing ready', async () => {
  const f = await readyAccounts();
  try {
    const tx = { type: 2 as const, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' };
    const signed = await f.runtime.transfers!.sign(tx, () => undefined);
    await (await f.runtime.transfers!.journal(() => undefined)).saveSigned(signed.rawTransaction);
    const row = JSON.parse(f.disk.signedValue()!);
    row.entries[0].from = '0x' + '99'.repeat(20);
    f.disk.signedBundles.set(row.profileId, JSON.stringify(row));
    await f.authority.dispose();
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize();
    await assert.rejects(reopened.unlock(PASSWORD), /OPERATION_FAILED/);
    assert.equal(reopened.getSnapshot().phase, 'locked');
    assert.equal(reopened.getSnapshot().account, null);
    assert.deepEqual(JSON.parse(f.disk.signedValue()!), row);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('journal quarantine rejects every later secret operation on the same runtime', async () => {
  const f = await readyAccounts();
  try {
    const exportScope = selectedKeyScope(f);
    const tx = { type: 2 as const, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' };
    const signed = await f.runtime.transfers!.sign(tx, () => undefined);
    const journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(signed.rawTransaction);
    f.disk.loseCasAcknowledgement();
    await assert.rejects(journal.transition(signed.hash, 'attempted'), /REOPEN_REQUIRED/);
    const records = JSON.stringify([...f.disk.records]);
    const credentials = f.disk.successWrites;
    const operations = [
      () => f.runtime.session.unlock(PASSWORD),
      () => f.runtime.session.createWallet(PASSWORD),
      () => f.runtime.session.importWallet(PHRASE, PASSWORD),
      () => f.runtime.backup.readPhrase(PASSWORD),
      () => f.runtime.backup.confirm('1'.repeat(64)),
      () => f.runtime.keyExport!.readSelected(exportScope, PASSWORD, () => undefined),
      () => f.runtime.transfers!.sign(tx, () => undefined),
      () => Promise.resolve().then(() => f.runtime.transfers!.assertUnlocked(() => undefined)),
    ];
    for (const operation of operations) await assert.rejects(operation(), /CLEANUP_FAILED|CANCELLED/);
    assert.equal(f.disk.successWrites, credentials);
    assert.equal(JSON.stringify([...f.disk.records]), records);
    f.authority.lock();
    await assert.rejects(f.authority.unlock(PASSWORD), /UNAVAILABLE/);
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('journal ambiguity retires an already-running secret operation before it returns recovery words', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    const signed = await f.runtime.transfers!.sign({ type: 2, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined);
    const journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(signed.rawTransaction);
    const hold = sdk.hold('password');
    const secret = f.runtime.backup.readPhrase(PASSWORD); void secret.catch(() => undefined);
    await hold.entered;
    f.disk.loseCasAcknowledgement();
    await assert.rejects(journal.transition(signed.hash, 'attempted'), /REOPEN_REQUIRED/);
    hold.release();
    await assert.rejects(secret, /CLEANUP_FAILED/);
    await assert.rejects(f.runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('native token capability uses authenticated account/network, preserves restore data and never authenticates/signs', async () => {
  const f = await readyAccounts();
  const token = { contractAddress: '0x1111111111111111111111111111111111111111', decimals: 255, name: 'Untrusted token', symbol: 'TOKEN' };
  try {
    const credentials = f.disk.successWrites;
    const initial = await f.runtime.tokens!.load(() => undefined);
    await f.runtime.tokens!.add(initial.revision, token, () => undefined);
    assert.equal(f.disk.successWrites, credentials);
    const stored = JSON.stringify(f.disk.records.get('native-token-registry-v1'));
    assert(!stored.includes(PASSWORD)); assert(!stored.includes(PHRASE)); assert(!stored.includes('units'));
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, []);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, [token]);
    const catalogue = f.authority.getCatalogue()!;
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, catalogue.revision);
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, []);
    const base = f.authority.getCatalogue()!;
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, base.revision);
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, [token]);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('token storage admission blocks account switching and lost commit acknowledgement quarantines runtime', async () => {
  const f = await readyAccounts();
  const token = { contractAddress: '0x1111111111111111111111111111111111111111', decimals: 18, name: 'Token', symbol: 'TOKEN' };
  try {
    await f.runtime.tokens!.load(() => undefined);
    let release!: () => void; let entered!: () => void;
    const holding = new Promise<void>((resolve) => { release = resolve; });
    const pending = new Promise<void>((resolve) => { entered = resolve; });
    f.disk.onRecord(async (kind, key) => { if (kind === 'get' && key === 'native-token-registry-v1') { entered(); await holding; } });
    const reading = f.runtime.tokens!.load(() => undefined); await pending;
    await assert.rejects(f.execute({ kind: 'create', label: 'Blocked', password: PASSWORD }), /BUSY/);
    release(); await reading; f.disk.onRecord();
    f.disk.loseNextAcknowledgement(); await assert.rejects(f.runtime.tokens!.add(0, token, () => undefined), /CLEANUP_FAILED/);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    assert.equal(f.runtime.accounts!.getSnapshot(), null);
    assert.equal(f.runtime.networks!.getSelectedId(), null);
    const records = JSON.stringify([...f.disk.records]);
    await assert.rejects(f.runtime.backup.readPhrase(PASSWORD), /CLEANUP_FAILED|CANCELLED/);
    assert.equal(JSON.stringify([...f.disk.records]), records);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

function selectedKeyScope(f: Awaited<ReturnType<typeof readyAccounts>>): HdKeyExportScope {
  const c = f.authority.getCatalogue()!, a = c.accounts.find((a) => a.id === c.active.accountId)!;
  return Object.freeze({ authorityRevision: f.authority.getSnapshot().revision, catalogueRevision: c.revision,
    accountId: a.id, index: a.index, address: a.address, networkId: c.active.networkId,
    registrationHash: getNativeNetwork(c.active.networkId).registrationHash });
}

test('HD key reveal uses real SDK across registered networks and recreated nonzero indices', async () => {
  const f = await readyAccounts(), flow = new HdKeyExportFlow(f.authority, () => f.runtime.keyExport);
  try {
    const key0 = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/0").privateKey;
    for (const n of NATIVE_NETWORKS) {
      if (n.id !== f.authority.getCatalogue()!.active.networkId)
        await f.authority.selectNetwork(n.id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
      const before = JSON.stringify([...f.disk.records]), shown = await flow.begin(PASSWORD);
      assert.equal(shown.privateKey, key0); assert.equal(shown.address, ADDRESS); assert.equal(shown.accountId, 'hd:60:0');
      assert.equal(Object.isFrozen(shown), true); assert.equal(flow.isCurrent(shown.id), true);
      assert.equal(JSON.stringify([...f.disk.records]), before);
      assert.equal(JSON.stringify(f.authority.getSnapshot()).includes(key0), false);
      flow.cancel(); assert.equal(flow.isCurrent(shown.id), false);
    }
    await f.execute({ kind: 'create', label: 'Second', password: PASSWORD });
    const shown = await flow.begin(PASSWORD), key1 = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/1");
    assert.equal(shown.privateKey, key1.privateKey); assert.equal(shown.address, key1.address);
    await f.execute({ kind: 'select', id: 'hd:60:0' }); assert.equal(flow.isCurrent(shown.id), false);
    await f.execute({ kind: 'remove', id: 'hd:60:1', password: PASSWORD });
    await f.execute({ kind: 'create', label: 'Recreated second', password: PASSWORD });
    assert.equal((await flow.begin(PASSWORD)).privateKey, key1.privateKey);
  } finally { flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('UTXO HD reveal returns the selected SDK account key and clears on network changes', async () => {
  const f = await readyAccounts(), flow = new HdKeyExportFlow(f.authority, () => f.runtime.keyExport);
  try {
    let previous: string | undefined;
    for (const network of UTXO_NETWORKS) {
      await f.authority.selectNetwork(network.id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
      if (previous) assert.equal(flow.isCurrent(previous), false);
      const before = JSON.stringify([...f.disk.records]);
      const shown = await flow.begin(PASSWORD);
      assert(shown.privateKey.startsWith(network.testnet ? 'vprv' : 'zprv'));
      assert.equal(shown.accountId, `hd:${network.slip44}:0`);
      assert.equal(shown.address, f.authority.getSnapshot().account?.address);
      assert.equal(flow.isCurrent(shown.id), true);
      assert.equal(JSON.stringify([...f.disk.records]), before);
      assert(!JSON.stringify(f.authority.getSnapshot()).includes(shown.privateKey));
      previous = shown.id;
    }
    f.authority.lock();
    assert.equal(flow.isCurrent(previous!), false);
  } finally { flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('UTXO HD reveal rejects a valid extended key for a different account', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  const flow = new HdKeyExportFlow(f.authority, () => f.runtime.keyExport);
  try {
    const network = UTXO_NETWORKS[0]!;
    await f.authority.selectNetwork(network.id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    await f.execute({ kind: 'create', label: 'Another account', password: PASSWORD });
    const shown = await flow.begin(PASSWORD);
    assert.equal(shown.accountId, `hd:${network.slip44}:1`);
    await f.execute({ kind: 'select', id: `hd:${network.slip44}:0` });
    assert.equal(flow.isCurrent(shown.id), false);
    sdk.setExportResult(shown.privateKey);
    await assert.rejects(flow.begin(PASSWORD), /^Error: KEY_EXPORT_UNAVAILABLE$/);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
  } finally { flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key export rejects forged scopes, accessors and asynchronous guards', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    const scope = selectedKeyScope(f); let reads = 0;
    const accessor = { ...scope }; Object.defineProperty(accessor, 'index', { enumerable: true, get() { reads++; return 0; } });
    for (const input of [accessor, { ...scope, accountType: 'Imported' }, { ...scope, index: [0] },
      { ...scope, authorityRevision: -1 }])
      await assert.rejects(f.runtime.keyExport!.readSelected(input as HdKeyExportScope, PASSWORD, () => undefined), /INVALID_INPUT/);
    assert.equal(reads, 0); assert.equal(sdk.exports, 0);
    for (const input of [{ ...scope, registrationHash: '0x' + '1'.repeat(64) }, { ...scope, index: 1, accountId: 'hd:60:1' }, { ...scope, catalogueRevision: scope.catalogueRevision + 1 }]) {
      await assert.rejects(f.runtime.keyExport!.readSelected(input, PASSWORD, () => undefined), /CANCELLED/);
      f.authority.lock(); await f.authority.unlock(PASSWORD);
    }
    await assert.rejects(f.runtime.keyExport!.readSelected(selectedKeyScope(f), PASSWORD, (() => Promise.resolve()) as any), /CANCELLED/);
    assert.equal(sdk.exports, 0);
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key export rejects malformed, zero, out-of-range and wrong-address keys', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), flow = new HdKeyExportFlow(f.authority, () => f.runtime.keyExport);
  try {
    const wrongKey = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/1").privateKey;
    for (const key of ['secret', '0x' + '0'.repeat(64), '0x' + 'f'.repeat(64),
      '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141', wrongKey]) {
      sdk.setExportResult(key);
      await assert.rejects(flow.begin(PASSWORD), (error: Error) => {
        assert.equal(error.message, 'KEY_EXPORT_UNAVAILABLE'); assert.equal(JSON.stringify(error).includes(key), false); return true;
      });
      assert.equal(f.authority.getSnapshot().phase, 'locked'); await f.authority.unlock(PASSWORD);
    }
    sdk.failExport(); const before = f.disk.failureWrites;
    await assert.rejects(flow.begin(PASSWORD), /^Error: KEY_EXPORT_UNAVAILABLE$/);
    assert.equal(f.disk.failureWrites, before);
  } finally { flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key reveal shares unlock throttle and counts wrong authentication after cancellation', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), flow = new HdKeyExportFlow(f.authority, () => f.runtime.keyExport);
  const hold = sdk.hold('password');
  try {
    const pending = flow.begin('wrong password'); void pending.catch(() => undefined);
    await hold.entered; f.authority.lock(); hold.release(); await assert.rejects(pending, /CANCELLED/);
    assert.equal(f.disk.failureWrites, 1); assert.equal(f.disk.failures, 1); assert.equal(sdk.exports, 0);
    for (let attempt = 0; attempt < 4; attempt++) await assert.rejects(f.authority.unlock('wrong password'), /INVALID_CREDENTIAL/);
    assert.equal(f.disk.failures, 5); await assert.rejects(f.authority.unlock(PASSWORD), /AUTH_THROTTLED/);
    assert.equal(f.disk.failureWrites, 5); await assert.rejects(flow.begin(PASSWORD), /KEY_EXPORT_UNAVAILABLE/);
    assert.equal(sdk.exports, 0);
  } finally { hold.release(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

for (const phase of ['password', 'record-read', 'export-before', 'export-after']) {
  test(`HD key reveal revokes at ${phase} and serializes other privileged operations`, async () => {
    const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), flow = new HdKeyExportFlow(f.authority, () => f.runtime.keyExport);
    const entered = deferredAccount(), released = deferredAccount();
    const hold = phase === 'record-read' ? {
      entered: entered.promise,
      release() { f.disk.onRecord(); released.resolve(); },
    } : sdk.hold(phase);
    if (phase === 'record-read') f.disk.onRecord(async (kind, key) => {
      if (kind === 'get' && key === WALLET_CATALOGUE_KEY) { entered.resolve(); await released.promise; }
    });
    try {
      const pending = flow.begin(PASSWORD); void pending.catch(() => undefined); await hold.entered;
      await assert.rejects(flow.begin(PASSWORD), /BUSY/);
      await assert.rejects(f.runtime.backup.readPhrase(PASSWORD), /BUSY/);
      assert.throws(() => f.runtime.transfers!.assertUnlocked(() => undefined), /BUSY/);
      await assert.rejects(f.runtime.transfers!.sign({ type: 2, accessList: [], from: ADDRESS,
        to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1',
        gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined), /BUSY/);
      await assert.rejects(f.execute({ kind: 'create', label: 'Must not start', password: PASSWORD }), /BUSY/);
      f.authority.lock(); await assert.rejects(f.authority.unlock(PASSWORD), /OPERATION_FAILED|BUSY/);
      hold.release(); await assert.rejects(pending, /CANCELLED/);
      assert.equal(f.authority.getSnapshot().account, null); await f.authority.unlock(PASSWORD);
      const shown = await flow.begin(PASSWORD); assert.equal(shown.address, ADDRESS);
      assert.equal(sdk.exports, phase.startsWith('export') ? 2 : 1);
    } finally { hold.release(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
  });
}

test('HD key presentation expires on network/account A-B-A, reentrant clear and disposal', async () => {
  const f = await readyAccounts(), flow = new HdKeyExportFlow(f.authority, () => f.runtime.keyExport), attempts: Promise<unknown>[] = [];
  const unsubscribe = flow.onClear(() => attempts.push(flow.begin(PASSWORD).catch((error: Error) => error.message)));
  try {
    const first = await flow.begin(PASSWORD); assert.deepEqual(await Promise.all(attempts), ['BUSY']); unsubscribe();
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    assert.equal(flow.isCurrent(first.id), false);
    await f.execute({ kind: 'create', label: 'Second', password: PASSWORD }); const second = await flow.begin(PASSWORD);
    await f.execute({ kind: 'select', id: 'hd:60:0' }); await f.execute({ kind: 'select', id: 'hd:60:1' }); assert.equal(flow.isCurrent(second.id), false);
    const last = await flow.begin(PASSWORD); flow.dispose(); assert.equal(flow.isCurrent(last.id), false);
    await assert.rejects(flow.begin(PASSWORD), /KEY_EXPORT_EXPIRED/);
  } finally { unsubscribe(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key runtime refuses unconfirmed backup without mutating stored records', async () => {
  const disk = memoryDisk(); disk.denyNetwork(); const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD); const c = runtime.catalogue.getSnapshot()!, before = JSON.stringify([...disk.records]);
    await assert.rejects(runtime.keyExport!.readSelected({ authorityRevision: 0, catalogueRevision: c.revision,
      accountId: 'hd:60:0', index: 0, address: ADDRESS, networkId: 'ethereum', registrationHash: getNativeNetwork('ethereum').registrationHash }, PASSWORD, () => undefined), /NOT_READY/);
    assert.equal(JSON.stringify([...disk.records]), before);
    assert.deepEqual(await runtime.storage.readState(), { presence: 'existing', backup: 'unconfirmed' });
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});

test('HD key flow rejects a completed runtime result after authority A-B-A before publication', async () => {
  const f = await readyAccounts(); const entered = deferredAccount(), release = deferredAccount();
  const port = { async readSelected(...args: Parameters<NonNullable<KeyringRuntime['keyExport']>['readSelected']>) {
    const key = await f.runtime.keyExport!.readSelected(...args); entered.resolve(); await release.promise; return key;
  } };
  const flow = new HdKeyExportFlow(f.authority, () => port);
  try {
    const pending = flow.begin(PASSWORD); void pending.catch(() => undefined); await entered.promise;
    f.authority.lock(); await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getSnapshot().account!.address, ADDRESS);
    release.resolve(); await assert.rejects(pending, /CANCELLED/);
    assert.equal(f.authority.getSnapshot().phase, 'ready', 'an obsolete export cannot lock the newly authenticated context');
  } finally { release.resolve(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key flow disposal retires an in-flight read and reentrant clear cannot authenticate', async () => {
  const f = await readyAccounts(), sdkEntered = deferredAccount(), release = deferredAccount();
  let reads = 0;
  const port = { async readSelected(...args: Parameters<NonNullable<KeyringRuntime['keyExport']>['readSelected']>) {
    reads++; const key = await f.runtime.keyExport!.readSelected(...args); sdkEntered.resolve(); await release.promise; return key;
  } };
  const flow = new HdKeyExportFlow(f.authority, () => port), attempts: Promise<unknown>[] = [];
  const off = flow.onClear(() => attempts.push(flow.begin(PASSWORD).catch((error: Error) => error.message)));
  try {
    const pending = flow.begin(PASSWORD); void pending.catch(() => undefined); await sdkEntered.promise;
    flow.dispose(); release.resolve(); await assert.rejects(pending, /CANCELLED/);
    assert.equal(reads, 1); assert.equal(f.authority.getSnapshot().phase, 'ready', 'disposed flow cannot lock a live context after its runtime read drained');
    assert.ok((await Promise.all(attempts)).every((result) => result === 'BUSY' || result === 'KEY_EXPORT_EXPIRED'));
  } finally { release.resolve(); off(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('obsolete export failure cannot revoke a replacement flow started by a clear observer', async () => {
  const f = await readyAccounts(), entered = deferredAccount(), release = deferredAccount();
  const replacement = { readSelected: (...args: Parameters<NonNullable<KeyringRuntime['keyExport']>['readSelected']>) => f.runtime.keyExport!.readSelected(...args) };
  let currentPort = { async readSelected(...args: Parameters<NonNullable<KeyringRuntime['keyExport']>['readSelected']>): Promise<string> {
    await f.runtime.keyExport!.readSelected(...args); entered.resolve(); await release.promise;
    throw new Error(PASSWORD);
  } };
  const old = new HdKeyExportFlow(f.authority, () => currentPort), next = new HdKeyExportFlow(f.authority, () => currentPort);
  let replacementRead: Promise<Awaited<ReturnType<HdKeyExportFlow['begin']>>> | undefined;
  let off = () => {};
  try {
    const pending = old.begin(PASSWORD); void pending.catch(() => undefined); await entered.promise;
    off = old.onClear(() => { off(); currentPort = replacement; replacementRead = next.begin(PASSWORD); });
    release.resolve(); await assert.rejects(pending, /^Error: KEY_EXPORT_UNAVAILABLE$/);
    const shown = await replacementRead!;
    assert.equal(shown.address, ADDRESS); assert.equal(next.isCurrent(shown.id), true);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally { release.resolve(); off(); old.dispose(); next.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key flow is unavailable before backup, while locked, and on the web host', async () => {
  const disk = memoryDisk(); disk.denyNetwork(); let runtime!: KeyringRuntime, portReads = 0;
  const authority = new NativeCustodyAuthority({ async open() { runtime = await disk.factory.open() as KeyringRuntime; return runtime; } });
  const flow = new HdKeyExportFlow(authority, () => { portReads++; return runtime.keyExport; });
  try {
    await authority.initialize(); await authority.importPhrase(PHRASE, PASSWORD);
    assert.equal(authority.getSnapshot().phase, 'backup-required');
    await assert.rejects(flow.begin(PASSWORD), /KEY_EXPORT_UNAVAILABLE/);
    assert.equal(authority.getSnapshot().phase, 'backup-required'); assert.equal(portReads, 0);
    authority.lock(); await assert.rejects(flow.begin(PASSWORD), /KEY_EXPORT_UNAVAILABLE/);
    assert.equal(authority.getSnapshot().phase, 'locked'); assert.equal(portReads, 0);
    const web = await import('../src/platform/nativeFactory.web.ts');
    assert.throws(() => web.createNativeWalletControllers(), /unavailable on web/);
    assert.throws(() => web.createNativeCustodyAuthority(), /unavailable on web/);
  } finally { flow.dispose(); await authority.dispose(); disk.restoreNetwork(); }
});

const IMPORTED_TEST_KEY = '0x' + '1'.padStart(64, '0');
const importedAddress = (key = IMPORTED_TEST_KEY) => new Wallet(key).address;
async function importTestKey(f: Awaited<ReturnType<typeof readyAccounts>>, key = IMPORTED_TEST_KEY, label = 'Imported test') {
  await f.authority.importAccount({ privateKey: key, expectedAddress: importedAddress(key), label }, PASSWORD,
    f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
}

test('installed SDK imported accounts persist AEAD, cold-reopen and sign/export at a nonzero host ordinal', async () => {
  const f = await readyAccounts();
  try {
    const pair = JSON.stringify([f.disk.records.get('vault'), f.disk.records.get('vault-keys')]);
    await importTestKey(f);
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'imported:60:0');
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'imported:60:0', password: PASSWORD });
    await importTestKey(f, '0x' + '2'.padStart(64, '0'), 'Reused slot');
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'imported:60:0');
    await importTestKey(f);
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'imported:60:1');
    assert.equal(f.authority.getSnapshot().account!.address, importedAddress());
    assert.equal(JSON.stringify([f.disk.records.get('vault'), f.disk.records.get('vault-keys')]), pair);
    const saved = JSON.stringify([...f.disk.records]);
    assert.equal(saved.includes(IMPORTED_TEST_KEY), false); assert.equal(saved.includes('xprv'), true, 'full private SDK records retain encrypted xprv');
    assert.equal(saved.includes('ciphertext'), true);
    assert.equal(JSON.stringify(f.authority.getCatalogue()).includes('ciphertext'), false);
    for (const network of ['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet'] as const) {
      await f.authority.selectNetwork(network, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
      const tx = { type: 2 as const, accessList: [], from: importedAddress(), to: ADDRESS, chainId: getNativeNetwork(network).chainId,
        nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' };
      const signed = await f.runtime.transfers!.sign(tx, () => undefined);
      assert.equal(Transaction.from(signed.rawTransaction).from, importedAddress());
      await (await f.runtime.transfers!.journal(() => undefined)).saveSigned(signed.rawTransaction);
    }
    const flow = new HdKeyExportFlow(f.authority, () => f.runtime.keyExport);
    assert.equal((await flow.begin(PASSWORD)).privateKey, IMPORTED_TEST_KEY); flow.dispose();
    await f.authority.dispose();
    let reopenedRuntime!: KeyringRuntime;
    const reopened = new NativeCustodyAuthority({ async open() { reopenedRuntime = await f.disk.factory.open() as KeyringRuntime; return reopenedRuntime; } });
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getSnapshot().account!.address, importedAddress());
    const recovery = await (await reopenedRuntime.transfers!.journal(() => undefined)).load();
    assert.equal(recovery!.phase, 'signed'); assert.equal(Transaction.from(recovery!.rawTransaction).chainId, 57057n);
    assert.equal(reopened.getSnapshot().backup, 'confirmed');
    await reopened.dispose();
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('SDK imported gap reuse retains the higher account through cold reopen, export and signing', async () => {
  const f = await readyAccounts();
  let reopened: NativeCustodyAuthority | undefined;
  try {
    const secondKey = '0x' + '2'.padStart(64, '0'), replacementKey = '0x' + '3'.padStart(64, '0');
    await importTestKey(f);
    await importTestKey(f, secondKey, 'Retained one');
    const before = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY)) as NativeAccountRecord;
    const retained = before.groups[0]!.accounts.Imported[1], retainedRecovery = before.recovery.find(entry => entry.identity.id === 1);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'imported:60:0', password: PASSWORD });
    await importTestKey(f, replacementKey, 'Reused zero');
    const stored = f.disk.records.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    assert.deepEqual(Object.keys(stored.groups[0]!.accounts.Imported), ['0', '1']);
    assert.deepEqual(stored.groups[0]!.accounts.Imported[1], retained);
    assert.deepEqual(stored.recovery.find(entry => entry.identity.id === 1), retainedRecovery);
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'imported:60:0');
    await f.authority.dispose();
    let runtime!: KeyringRuntime;
    reopened = new NativeCustodyAuthority({ async open() { runtime = await f.disk.factory.open() as KeyringRuntime; return runtime; } });
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    for (const [id, key] of [['imported:60:0', replacementKey], ['imported:60:1', secondKey]] as const) {
      await reopened.manageAccounts({ kind: 'select', id }, reopened.getSnapshot().revision, reopened.getCatalogue()!.revision);
      assert.equal(reopened.getSnapshot().account!.address, importedAddress(key));
      const flow: HdKeyExportFlow = new HdKeyExportFlow(reopened, () => runtime.keyExport);
      try { assert.equal((await flow.begin(PASSWORD)).privateKey, key); } finally { flow.dispose(); }
      const signed = await runtime.transfers!.sign({ type: 2, accessList: [], from: importedAddress(key), to: ADDRESS,
        chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined);
      assert.equal(Transaction.from(signed.rawTransaction).from, importedAddress(key));
    }
    assert.deepEqual((f.disk.records.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord).groups[0]!.accounts.Imported[1], retained);
  } finally { await reopened?.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('imported admission rejects duplicates and malformed private form inputs without changing authority', async () => {
  const f = await readyAccounts();
  try {
    const hdKey = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/0").privateKey;
    const before = f.authority.getSnapshot().revision;
    await assert.rejects(importTestKey(f, hdKey), /DUPLICATE_ACCOUNT/);
    assert.equal(f.authority.getSnapshot().revision, before);
    await importTestKey(f);
    const stored = JSON.stringify([...f.disk.records]);
    await assert.rejects(importTestKey(f, IMPORTED_TEST_KEY.toUpperCase().replace('0X', '0x')), /DUPLICATE_ACCOUNT/);
    assert.equal(JSON.stringify([...f.disk.records]), stored);
    let reads = 0;
    const getter = { privateKey: IMPORTED_TEST_KEY, expectedAddress: importedAddress(), label: 'Bad' };
    Object.defineProperty(getter, 'privateKey', { enumerable: true, get() { reads++; return IMPORTED_TEST_KEY; } });
    for (const request of [getter, { ...getter, privateKey: PHRASE }, { ...getter, privateKey: '0x' + '0'.repeat(64) },
      { ...getter, expectedAddress: ADDRESS }, { ...getter, accountType: 'HDAccount' }]) {
      await assert.rejects(f.authority.importAccount(request, PASSWORD, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision), /INVALID_INPUT/);
    }
    assert.equal(reads, 4, 'only test spreads read the accessor; the runtime snapshot never does');
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(JSON.stringify([...f.disk.records]), stored);
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

for (const phase of ['password', 'import-after', 'encrypt-after']) {
  test(`imported admission serializes privileged work and cancels at ${phase}`, async () => {
    const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), hold = sdk.hold(phase);
    try {
      const before = JSON.stringify([...f.disk.records]);
      const pending = importTestKey(f); void pending.catch(() => undefined); await hold.entered;
      const otherKey = '0x' + '2'.padStart(64, '0');
      await assert.rejects(f.authority.importAccount({ privateKey: otherKey, expectedAddress: importedAddress(otherKey), label: 'Other' },
        PASSWORD, f.authority.getSnapshot().revision, 0), /BUSY/);
      await assert.rejects(f.runtime.backup.readPhrase(PASSWORD), /BUSY/);
      assert.throws(() => f.runtime.transfers!.assertUnlocked(() => undefined), /BUSY/);
      await assert.rejects(f.authority.manageAccounts({ kind: 'select', id: 'hd:60:0' }, f.authority.getSnapshot().revision, 0), /BUSY/);
      f.authority.lock(); hold.release(); await assert.rejects(pending, /CANCELLED/);
      assert.equal(JSON.stringify([...f.disk.records]), before);
      await f.authority.unlock(PASSWORD); assert.equal(f.authority.getCatalogue()!.accounts.length, 1);
    } finally { hold.release(); await f.authority.dispose(); f.disk.restoreNetwork(); }
  });
}

test('imported credential rejection shares persistent throttle after lifecycle cancellation', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), hold = sdk.hold('password');
  try {
    const pending = f.authority.importAccount({ privateKey: IMPORTED_TEST_KEY, label: 'Import', expectedAddress: importedAddress() },
      'wrong', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision); void pending.catch(() => undefined);
    await hold.entered; f.authority.lock(); hold.release(); await assert.rejects(pending, /CANCELLED/);
    assert.equal(f.disk.failureWrites, 1); assert.equal(sdk.imports, 0);
    for (let i = 0; i < 4; i++) await assert.rejects(f.authority.unlock('wrong'), /INVALID_CREDENTIAL/);
    await assert.rejects(f.authority.unlock(PASSWORD), /AUTH_THROTTLED/); assert.equal(f.disk.failureWrites, 5);
  } finally { hold.release(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('full imported account restoration performs one unlock and stops at a revoked record read', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    await importTestKey(f); await importTestKey(f, '0x' + '2'.padStart(64, '0'));
    f.authority.lock(); const before = sdk.unlocks;
    await f.authority.unlock(PASSWORD); assert.equal(sdk.unlocks - before, 1);
    assert.equal(sdk.exports, 0, 'complete encrypted SDK maps avoid per-account key exports');
    const importedBefore = sdk.imports;
    f.authority.lock(); const entered = deferredAccount(), release = deferredAccount();
    f.disk.onRecord(async (kind, key) => {
      if (kind === 'get' && key === WALLET_CATALOGUE_KEY) { entered.resolve(); await release.promise; }
    });
    const pending = f.authority.unlock(PASSWORD); void pending.catch(() => undefined); await entered.promise;
    f.authority.lock(); f.disk.onRecord(); release.resolve(); await assert.rejects(pending, /CANCELLED/);
    assert.equal(sdk.imports, importedBefore, 'restore never reimports saved scalars');
    assert.equal(f.authority.getSnapshot().account, null); assert.equal(f.runtime.catalogue.getSnapshot(), null);
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('lost imported commit acknowledgement preserves the key and requires a fresh runtime', async () => {
  const f = await readyAccounts();
  try {
    f.disk.loseCasAcknowledgement(); await assert.rejects(importTestKey(f), /UNAVAILABLE/);
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    await assert.rejects(f.authority.unlock(PASSWORD), /NOT_READY/);
    const row = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY)) as any;
    assert.equal(Object.keys(row.groups[0].accounts.Imported).length, 1); assert.equal(JSON.stringify(row).includes(IMPORTED_TEST_KEY), false);
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getSnapshot().account!.address, importedAddress());
    assert.equal(reopened.getCatalogue()!.active.accountId, 'imported:60:0');
    assert.deepEqual(f.disk.records.get(WALLET_CATALOGUE_KEY), row); await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('invalid imported recovery identity prevents partial unlock and preserves every saved record', async () => {
  const f = await readyAccounts();
  try {
    await importTestKey(f); f.authority.lock();
    const original = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY)) as any;
    for (const field of ['profileId', 'recordId', 'domain']) {
      const row = structuredClone(original), e = row.recovery[0].envelope;
      e[field] = 'wrong';
      f.disk.records.set(WALLET_CATALOGUE_KEY, row); const before = JSON.stringify([...f.disk.records]);
      await assert.rejects(f.authority.unlock(PASSWORD), /OPERATION_FAILED/);
      assert.equal(f.authority.getSnapshot().account, null); assert.equal(f.authority.getCatalogue(), null);
      assert.equal(JSON.stringify([...f.disk.records]), before);
    }
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('imported removal checks every chain, archives terminal rows, and never consumes an HD journal', async () => {
  const f = await readyAccounts();
  try {
    const rawFor = async (address: string, chainId: string) => f.runtime.transfers!.sign({ type: 2, accessList: [], from: address,
      to: ADDRESS, chainId, nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, () => undefined);
    const hd = await rawFor(ADDRESS, '1'); await (await f.runtime.transfers!.journal(() => undefined)).saveSigned(hd.rawTransaction);
    const hdHash = hd.hash;
    await importTestKey(f);
    const first = await rawFor(importedAddress(), '1'); let journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(first.rawTransaction); await journal.transition(first.hash, 'nonce-consumed');
    await f.authority.selectNetwork('syscoin-nevm-testnet', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    const second = await rawFor(importedAddress(), '5700'); journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(second.rawTransaction);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await assert.rejects(f.execute({ kind: 'remove', id: 'imported:60:0', password: PASSWORD }), /PENDING_TRANSFER/);
    await f.authority.unlock(PASSWORD); await f.execute({ kind: 'select', id: 'imported:60:0' });
    journal = await f.runtime.transfers!.journal(() => undefined); await journal.transition(second.hash, 'nonce-consumed');
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'imported:60:0', password: PASSWORD });
    assert.equal(f.disk.records.has('native-evm-transfer-v1:imported:60:0'), false);
    await f.authority.selectNetwork('ethereum',f.authority.getSnapshot().revision,f.authority.getCatalogue()!.revision);
    assert.equal((await (await f.runtime.transfers!.journal(() => undefined)).load())!.hash, hdHash);
    assert.equal(f.disk.signedValue()!.includes(first.hash), true, 'removed-account signed bytes stay retained');
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('explicit same-chain RPC edits preserve tokens, exact-byte retries and cold unlock', async () => {
  const f = await readyAccounts(), originalRpc = localTransferRpc();
  const first = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: originalRpc.rpc });
  let retry: NativeTransfers | undefined;
  try {
    const token = { contractAddress: '0x3333333333333333333333333333333333333333', name: 'Token', symbol: 'TOK', decimals: 6 };
    await f.runtime.tokens!.add(0, token, () => undefined);
    const review = await prepareAccountTransfer(first);
    await first.confirm(review);
    const original = originalRpc.broadcasts[0]!;
    const registration = createNativeNetwork({ ...getNativeNetwork('ethereum'), name: 'My Ethereum provider', rpcUrl: 'https://changed.example/rpc' });
    await f.authority.manageNetwork({ kind: 'save-network', registration }, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    assert.equal((await f.runtime.tokens!.load(() => undefined)).items[0]!.contractAddress, token.contractAddress);
    assert.equal((await (await f.runtime.transfers!.journal(() => undefined)).load())!.rawTransaction, original);
    const nextRpc = localTransferRpc('ethereum', registration);
    retry = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: nextRpc.rpc });
    await retry.recover(true);
    const retryReview = retry.getSnapshot().review!;
    assert.equal(retryReview.context.rpcUrl, registration.rpcUrl);
    assert.equal(retryReview.retry, true);
    await retry.confirm(retryReview.id);
    assert.deepEqual(nextRpc.broadcasts, [original]);
    f.authority.lock(); await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal((await (await f.runtime.transfers!.journal(() => undefined)).load())!.rawTransaction, original);
  } finally { first.dispose(); retry?.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('shared SDK signing snapshots the approved envelope before queued work', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    const transaction = { type: 2 as const, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '123', gasLimit: '21000', data: '0x', maxFeePerGas: '3', maxPriorityFeePerGas: '1' };
    const before = [sdk.unlocks, sdk.hydrations, f.disk.successWrites, f.disk.failureWrites];
    const signing = f.runtime.transfers!.sign(transaction, () => undefined);
    transaction.to = '0x2222222222222222222222222222222222222222';
    transaction.value = '999'; transaction.nonce = '8';
    const decoded = Transaction.from((await signing).rawTransaction);
    assert.equal(decoded.to, '0x1111111111111111111111111111111111111111');
    assert.equal(decoded.value, 123n); assert.equal(decoded.nonce, 0);
    assert.deepEqual([sdk.unlocks, sdk.hydrations, f.disk.successWrites, f.disk.failureWrites], before);
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

for (const boundary of ['queued', 'sdk-guard'] as const) {
  test(`lock at the ${boundary} boundary cannot return an approved signature from the old SDK session`, async () => {
    const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
    let signatures = 0;
    try {
      const before = [sdk.unlocks, sdk.hydrations];
      sdk.onSign(() => { signatures++; if (boundary === 'sdk-guard') f.authority.lock(); });
      const signing = f.runtime.transfers!.sign({ type: 2, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '123', gasLimit: '21000', data: '0x', maxFeePerGas: '3', maxPriorityFeePerGas: '1' }, () => undefined);
      if (boundary === 'queued') f.authority.lock();
      await assert.rejects(signing, /CANCELLED/);
      assert.equal(signatures, boundary === 'queued' ? 0 : 1);
      assert.equal(f.authority.getSnapshot().phase, 'locked');
      await assert.rejects(f.runtime.session.readSelectedAddress(), /NOT_READY/);
      assert.equal(f.disk.records.has('native-evm-transfer-v1'), false);
      assert.deepEqual([sdk.unlocks, sdk.hydrations], before);
    } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
  });
}

test('unlocking again cannot revive an old review or sign it for a newly selected account', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  let signatures = 0; sdk.onSign(() => { signatures++; });
  try {
    const firstReview = await prepareAccountTransfer(transfers);
    f.authority.lock(); await f.authority.unlock(PASSWORD);
    await assert.rejects(transfers.confirm(firstReview), /EXPIRED/);
    const secondReview = await prepareAccountTransfer(transfers);
    await f.execute({ kind: 'create', label: 'Selected account', password: PASSWORD });
    await assert.rejects(transfers.confirm(secondReview), /EXPIRED/);
    assert.equal(signatures, 0); assert.equal(network.broadcasts.length, 0);
    const selected = f.authority.getSnapshot().account!.address;
    const before = [sdk.unlocks, sdk.hydrations];
    await transfers.confirm(await prepareAccountTransfer(transfers));
    assert.equal(Transaction.from(network.broadcasts[0]!).from, selected);
    assert.deepEqual([sdk.unlocks, sdk.hydrations], before);
  } finally { transfers.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});


test('idle policy reauthentication uses the real shared throttle and counts rejection after idle expiry', async () => {
  const controlled = await controlledSdk(); let active = true;
  const disk = memoryDisk(controlled.loadSdk, () => { if (!active) throw Error('CANCELLED'); }); disk.denyNetwork();
  const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const hold = controlled.hold(), pending = runtime.security!.reauthenticateIdlePolicy('wrong password', () => undefined);
    await hold.started; active = false; hold.finish();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(disk.failureWrites, 1); assert.equal(disk.failures, 1);
    active = true; await runtime.session.unlock(PASSWORD);
    await runtime.security!.reauthenticateIdlePolicy(PASSWORD, () => undefined);
    assert.equal(disk.failures, 0);
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});

test('creation and import reject weak passwords before the SDK creates a seed vault', async () => {
  const disk = memoryDisk();
  const runtime = await disk.factory.open();
  try {
    for (const password of ['only twelve lowercase letters', 'Abcdefghijk1', 'Abcdefghijk!', 'Abcdefghij1!' + 'é'.repeat(507)]) {
      await assert.rejects(runtime.session.createWallet(password), { code: 'INVALID_INPUT' });
      await assert.rejects(runtime.session.importWallet(PHRASE, password), { code: 'INVALID_INPUT' });
      assert.equal(disk.records.has('vault'), false);
      assert.equal(disk.records.has('vault-keys'), false);
    }
  } finally { await runtime.storage.close(); }
});


test('delete-nonlatest then add uses the same SDK allocator as extension and preserves imported records', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    await f.execute({ kind: 'create', label: 'First extra', password: PASSWORD });
    const first = f.authority.getCatalogue()!.accounts.find((account) => account.id === 'hd:60:1')!;
    await f.execute({ kind: 'create', label: 'Retained extra', password: PASSWORD });
    const retained = f.authority.getCatalogue()!.accounts.find((account) => account.id === 'hd:60:2')!;
    await importTestKey(f);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'imported:60:0', password: PASSWORD });
    await importTestKey(f, '0x' + '2'.padStart(64, '0'), 'Retained imported');
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'hd:60:1', password: PASSWORD });
    const before = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY)) as NativeAccountRecord;
    await f.execute({ kind: 'create', label: 'Gap replacement', password: PASSWORD });
    const snapshot = f.authority.getCatalogue()!;
    assert.equal(sdk.allocations, 3);
    assert.equal(snapshot.active.accountId, 'hd:60:1');
    assert.equal(snapshot.accounts.find((account) => account.id === first.id)?.address, first.address);
    assert.deepEqual(snapshot.accounts.find((account) => account.id === retained.id), retained);
    assert.equal('removed' in snapshot, false);
    const after = f.disk.records.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    assert.deepEqual(after.groups[0]!.accounts.Imported, before.groups[0]!.accounts.Imported);
    assert.deepEqual(after.recovery, before.recovery);
    for (const key of ['nextIndex', 'importedAccounts', 'retiredImportedIndices', 'nextImportedIndex'])
      assert.equal(key in after, false, key);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const phase of ['create-before', 'create-after']) test(`lock during SDK allocation at ${phase} discards the returned account`, async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), hold = sdk.hold(phase);
  try {
    const before = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY));
    const pending = f.execute({ kind: 'create', label: 'Cancelled', password: PASSWORD }); void pending.catch(() => undefined);
    await hold.entered; f.authority.lock(); hold.release();
    await assert.rejects(pending, /CANCELLED/);
    assert.deepEqual(f.disk.records.get(WALLET_CATALOGUE_KEY), before);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getCatalogue()!.accounts.length, 1);
  } finally { hold.release(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const id of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) test(`invalid SDK-allocated id ${id} cannot replace an account or alter its catalogue`, async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    sdk.setAllocationPatch({ id });
    const before = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY));
    await assert.rejects(f.execute({ kind: 'create', label: 'Rejected', password: PASSWORD }), /CANCELLED/);
    assert.deepEqual(f.disk.records.get(WALLET_CATALOGUE_KEY), before);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('review expiry during shared signed-record persistence retains exact bytes and prevents dispatch', async () => {
  const f = await readyAccounts(), network = localTransferRpc();
  let now = 100;
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc, now: () => now });
  try {
    const review = await prepareAccountTransfer(transfers);
    f.disk.onRecord(async (kind, key) => {
      if (kind === 'create' && key.startsWith('pali-evm-signed-v1:')) now += 100_000;
    });
    await assert.rejects(transfers.confirm(review), /EXPIRED/);
    assert.equal(network.broadcasts.length, 0);
    f.disk.onRecord();
    const saved = await (await f.runtime.transfers!.journal(() => undefined)).load();
    assert.equal(saved!.phase, 'signed');
    assert.equal(Transaction.from(saved!.rawTransaction).hash, saved!.hash);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    await transfers.recover(true);
    const retry = transfers.getSnapshot().review!;
    assert.equal(retry.retry, true);
    await transfers.confirm(retry.id);
    assert.deepEqual(network.broadcasts, [saved!.rawTransaction]);
  } finally { f.disk.onRecord(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('ordinary unlock refuses an unsupported native record domain without deleting it', async () => {
  const f=await readyAccounts();
  try {
    f.authority.lock();
    const value={unreleased:true,opaque:'preserve these bytes'};
    f.disk.records.set('native-evm-transfer-v1',value);
    await assert.rejects(f.authority.unlock(PASSWORD),/OPERATION_FAILED/);
    assert.equal(f.authority.getSnapshot().phase,'locked');
    assert.equal(f.authority.getSnapshot().account,null);
    assert.deepEqual(f.disk.records.get('native-evm-transfer-v1'),value);
  } finally { await f.authority.dispose().catch(()=>undefined);f.disk.restoreNetwork(); }
});


test('unsupported rows are refused before initial native identity binding can write metadata', async () => {
  const disk=memoryDisk();disk.denyNetwork();
  const first=new NativeCustodyAuthority(disk.factory);
  await first.initialize();await first.importPhrase(PHRASE,PASSWORD);await first.dispose();
  disk.clearFixtureIdentity();disk.records.set('native-evm-transfer-v1',{opaque:'unreleased record'});
  const before=JSON.stringify([...disk.records]);
  const reopened=new NativeCustodyAuthority(disk.factory);
  try {
    await reopened.initialize();await assert.rejects(reopened.unlock(PASSWORD),/OPERATION_FAILED/);
    assert.equal(reopened.getSnapshot().phase,'locked');
    assert.equal(disk.fixtureIdentity(),null);
    assert.equal(JSON.stringify([...disk.records]),before);
  } finally {await reopened.dispose();disk.restoreNetwork();}
});

test('two real submissions remain in local Activity after offline cold reopen', async () => {
  const f=await readyAccounts(),network=localTransferRpc();
  const transfers=new NativeTransfers(f.authority,()=>f.runtime.transfers,{rpc:network.rpc});
  let reopened: NativeCustodyAuthority | undefined;
  try {
    await transfers.confirm(await prepareAccountTransfer(transfers));
    network.include();await transfers.recover();
    assert.equal(transfers.getSnapshot().phase,'confirmed');
    await transfers.confirm(await prepareAccountTransfer(transfers));
    assert.equal(network.broadcasts.length,2);
    assert.deepEqual(network.broadcasts.map(raw=>Transaction.from(raw).nonce),[0,1]);
    const hashes=network.broadcasts.map(raw=>Transaction.from(raw).hash);
    const before=await f.runtime.activity!.load(()=>undefined);
    assert.deepEqual(before.locals.map(row=>row.hash),hashes);
    transfers.dispose();await f.authority.dispose();
    let current!:KeyringRuntime;
    reopened=new NativeCustodyAuthority({async open(){current=await f.disk.factory.open() as KeyringRuntime;return current;}});
    await reopened.initialize();await reopened.unlock(PASSWORD);
    const after=await current.activity!.load(()=>undefined);
    assert.deepEqual(after.locals,before.locals);
    assert.equal(after.locals.length,2);
    assert(!JSON.stringify(after).includes(network.broadcasts[0]!));
  } finally {transfers.dispose();await reopened?.dispose();await f.authority.dispose().catch(()=>undefined);f.disk.restoreNetwork();}
});
