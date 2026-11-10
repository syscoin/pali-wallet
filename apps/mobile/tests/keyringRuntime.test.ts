import { testHdKeyExportRuntime } from './fixtures/hdKeyExport.ts';
import { NATIVE_PUBLIC_SESSION_KEY } from '../src/custody/publicSession.ts';
import { createTestPrivateAuthentication } from './fixtures/privateAuthentication.ts';
import { nonSuiteSigningHandoff } from './nonSuiteSigningHandoff.ts';
import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import type { NativePinRecord } from '../src/custody/pinVault.ts';
import { signingFixtureHost } from './unsupportedDappPorts.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKeyringRuntimeFactory, KeyringRuntimeError, type KeyringRuntime, type KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { NativeSmartCreationAllocation } from '../src/smartAccount/preparation.ts';
import { deriveDefaultSmartAccount } from '../../../source/utils/smartAccount/bootstrap.ts';
import { paliSmartAccountFactoryInterface } from '../../../source/utils/smartAccount/contracts.ts';
import { PALI_ACCOUNT_PROXY_CREATION_CODE, PALI_CANONICAL_FACTORY_ADDRESS, PALI_INFRASTRUCTURE_METADATA_BY_ID } from '../../../source/utils/smartAccount/deploymentMetadata.ts';
import { NativePortfolioController } from '../src/portfolio/nativePortfolio.ts';
import { AbiCoder, Interface } from 'ethers/abi';
import { getCreate2Address } from 'ethers/address';
import { NativeConnectionsController } from '../src/connections/controller.ts';
import type { WalletConnectTransportEvent, WalletConnectSession, WalletConnectResponse } from '../src/connections/walletConnect.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { WalletStorageError } from '../src/storage/types.ts';
import { NativeTransfers, type NativeTransferRuntime } from '../src/custody/transfers.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { SeedBackupFlow } from '../src/custody/seedBackup.ts';
import { OperationAuthentication, type OperationAuthenticationPrompt } from '../src/core/operationAuthentication.ts';
import { HdKeyExportFlow, type HdKeyExportScope } from '../src/custody/hdKeyExport.ts';
import { keccak256 } from 'ethers/crypto';
import { concat, getBytes } from 'ethers/utils';
import { approveHardwareDappRequest, hardwareDappRpc } from './hardwareDappTestSupport.ts';
import { Transaction } from 'ethers/transaction';
import { HDNodeWallet, Wallet } from 'ethers/wallet';
import { getNativeNetwork, createNativeNetwork, NATIVE_NETWORKS, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import { type NativeAccountRecord, WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { UTXO_NETWORKS } from '../src/core/utxoNetworks.ts';
import { sameRecoverySnapshot } from '../src/storage/recoverySnapshot.ts';
import { NATIVE_CONNECTION_STORAGE_KEY } from '../src/connections/storage.ts';
import type { DappGrant } from '../../../source/shared/dappTypes.ts';
import { createDappSigningApproval } from '../../../source/wallet/dappSigningApproval.ts';
import { readDappMessageRequest, type DappMessageRequest } from '../../../source/shared/dappMessageRequest.ts';
import { encrypt, recoverPersonalSignature, recoverTypedSignature, signTypedData, SignTypedDataVersion } from '@metamask/eth-sig-util';

const softwarePsbtHandoff = { id: 'software-fixture', expiresAt: Number.MAX_SAFE_INTEGER, beforeSuiteOpen() { throw Error('Unexpected hardware handoff'); }, beforeSignature() { throw Error('Unexpected hardware signature'); }, isSuspended: () => false };
// Custody revokes synchronously; quarantine is published after cleanup drains.
async function expectUnavailable(authority: NativeCustodyAuthority, action: () => Promise<unknown>): Promise<void> {
  let resolve!: () => void, reject!: (error: Error) => void;
  const unavailable = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
  void unavailable.catch(() => undefined);
  const unsubscribe = authority.subscribe(snapshot => { if (snapshot.phase === 'unavailable') resolve(); });
  const timer = setTimeout(() => reject(Error('Custody did not publish quarantine')), 2000);
  try {
    await action();
    if (authority.getSnapshot().phase === 'unavailable') resolve();
    await unavailable;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = '123456';
async function signTestTransfer(
  runtime: NativeTransferRuntime,
  transaction: Parameters<NativeTransferRuntime['sign']>[0],
  authority: Omit<Parameters<NativeTransferRuntime['sign']>[1], 'authorization'>,
  intent?: Parameters<NativeTransferRuntime['sign']>[2],
  replacement?: Parameters<NativeTransferRuntime['sign']>[3]
) {
  const check = () => { if (authority.signal.aborted) throw Error('CANCELLED'); return authority.assertCurrent(); };
  const reviewed = structuredClone(transaction);
  const authorization = await runtime.authorizeOperation({ method: 'pin', pin: PASSWORD }, reviewed, check);
  try { return await runtime.sign(reviewed, { ...authority, authorization }, intent, replacement); }
  finally { runtime.releaseOperationAuthorization(authorization); }
}
const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

function memoryDisk(loadSdk?: KeyringRuntimeDependencies['loadSdk'], assertActive?: () => void, connectionFetch?: KeyringRuntimeDependencies['connectionFetch'], trezorSessions?: KeyringRuntimeDependencies['trezorSessions'], utxoFetch?: typeof fetch, prepareSmartAccount?: KeyringRuntimeDependencies['prepareSmartAccount'], requestCredential?: KeyringRuntimeDependencies['requestOperationCredential']) {
  let pin: NativePinRecord | null = null;
  let obsoletePin: NativePinRecord | null = null;
  const pinAttempts = new WeakMap<object, { record: string; failures: number }>();
  const storedPins = createTestPinCredentialPort();
  let afterPinRead: () => Promise<void> = async () => {};
  const pinCredential = { ...storedPins, async read(record: NativePinRecord, check: () => void) { const value = await storedPins.read(record, check); await afterPinRead(); return value; } };
  const records = new Map<string, unknown>();
  let confirmation: string | undefined;
  let failures = 0;
  let failureWrites = 0;
  let successWrites = 0;
  let failAcknowledgement = false;
  let failCatalogueAcknowledgement = false;
  let failCasAcknowledgement = false;
  let failPinCommit = false;
  let closes = 0;
  let networkCalls = 0;
  let identity: import('../src/storage/types.ts').WalletIdentityRead | null = null;
  const signedBundles = new Map<string,string>();
  let recordHook: ((kind: string, key: string) => Promise<void>) | undefined;
  let identityHook: (() => Promise<void>) | undefined;
  let utxoSigned: string | undefined;
  const utxoPort: NonNullable<OpenWalletStorage['utxoSignedRecords']> = {
    async read() { return utxoSigned; },
    async compareAndSet(_profile, expected, next, guard) { guard(); if (utxoSigned !== expected) return false; utxoSigned = next; return true; },
  };
  const originalFetch = globalThis.fetch;
  const fingerprint = () => createHash('sha256')
    .update(JSON.stringify([records.get('vault'), records.get('vault-keys')])).digest('hex');
  const snapshot = (): import('../src/storage/types.ts').RecoveryStorageSnapshot => ({
    identity: identity ?? (records.has('vault') ? {walletBindingId:fingerprint(),pairFingerprint:fingerprint(),root:null,verification:'requires-unlock'} : null),
    state: records.has('vault') ? {presence:'existing',backup:confirmation===fingerprint()?'confirmed':'unconfirmed'} : {presence:'empty',backup:'unconfirmed'},
    records:[...records].map(([key,value])=>({key,value:JSON.stringify(value)})),metadata:pin ? [{key:'local-pin-v1',value:JSON.stringify(pin)}] : [],notes:[],
    signedRecords:[...signedBundles].map(([profileId,value])=>({profileId,value,walletBindingId:identity!.walletBindingId})),
  });
  const plans = new WeakMap<object, { before: ReturnType<typeof snapshot>; after: ReturnType<typeof snapshot> }>();
  const open = async (): Promise<OpenWalletStorage> => { let signedUnavailable=false; return ({
    pin: {
      installationId: 'a1'.repeat(16),
      async read() { return pin; },
      async beginAttempt(record, check) {
        check(); assert.deepEqual(record, pin); if (failures >= 5) throw new WalletStorageError('AUTH_THROTTLED');
        failures++; failureWrites++; const token = {}; pinAttempts.set(token, { record: JSON.stringify(record), failures }); return token;
      },
      async completeAttempt(token, check) {
        check(); const held = pinAttempts.get(token); pinAttempts.delete(token);
        assert(held); assert.equal(held.record, JSON.stringify(pin)); assert.equal(held.failures, failures);
        failures = 0; successWrites++;
      },
      async prepareReplacement(expected, next, check) { check(); assert.deepEqual(expected, pin); assert.equal(obsoletePin, null); obsoletePin = next; },
      async replace(expected, next, check) { check(); if (failPinCommit) throw new WalletStorageError('STORAGE_CHANGED'); assert.deepEqual(expected, pin); obsoletePin = pin; pin = next; },
      async settleCredentialRemoval(remove) { if (obsoletePin) { await remove(obsoletePin); obsoletePin = null; } },
    },
    utxoSignedRecords: utxoPort,
    signedRecords: {
      async read(profileId) { if(signedUnavailable) throw new WalletStorageError('STORAGE_REOPEN_REQUIRED'); await recordHook?.('get','pali-evm-signed-v1:'+profileId); if (!identity?.root || identity.root.profileId !== profileId) throw Error('profile mismatch'); return signedBundles.get(profileId); },
      async compareAndSet(profileId, expected, next, guard) { guard(); if(signedUnavailable) throw new WalletStorageError('STORAGE_REOPEN_REQUIRED'); if (!identity?.root || identity.root.profileId !== profileId) throw Error('profile mismatch'); if (signedBundles.get(profileId) !== expected) return false; signedBundles.set(profileId,next); await recordHook?.('create','pali-evm-signed-v1:'+profileId); if(failAcknowledgement || failCasAcknowledgement){failAcknowledgement=false;failCasAcknowledgement=false;signedUnavailable=true;throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');} return true; },
    },
    recovery: {
      async fingerprintPair(pair) { return createHash('sha256').update(JSON.stringify([pair.vault,pair.keys])).digest('hex'); },
      async prepareCreation(before, pair, root) {
        assert.equal(before.state.presence,'empty'); assert(sameRecoverySnapshot(before,snapshot()));
        const nextRecords = new Map(records); nextRecords.set('vault',pair.vault); nextRecords.set('vault-keys',pair.keys); nextRecords.set(WALLET_CATALOGUE_KEY,pair.accountRecords);
        nextRecords.set(NATIVE_PUBLIC_SESSION_KEY, pair.publicSession);
        const binding = createHash('sha256').update(JSON.stringify([pair.vault,pair.keys])).digest('hex');
        const after: ReturnType<typeof snapshot> = { identity:{walletBindingId:binding,pairFingerprint:binding,root:structuredClone(root),verification:'requires-unlock'},
          state:{presence:'existing',backup:'unconfirmed'},records:[...nextRecords].map(([key,value])=>({key,value:JSON.stringify(value)})),metadata:[{key:'local-pin-v1',value:JSON.stringify(pair.pin)}],notes:[],signedRecords:[] };
        const plan = {}; plans.set(plan,{before:structuredClone(before),after}); return plan as import('../src/storage/types.ts').RecoveryWritePlan;
      },
      plannedSnapshot(plan) { return structuredClone(plans.get(plan)!.after); },
      async commitReplacement(plan, guard) {
        const held=plans.get(plan as object); assert(held); plans.delete(plan as object); guard();
        assert(sameRecoverySnapshot(held.before,snapshot()));
        records.clear(); for(const row of held.after.records)records.set(row.key,JSON.parse(row.value)); identity=structuredClone(held.after.identity);
        pin = JSON.parse(held.after.metadata.find(row => row.key === 'local-pin-v1')!.value);
        await recordHook?.('create',WALLET_CATALOGUE_KEY);
        if(failAcknowledgement){failAcknowledgement=false;signedUnavailable=true;throw Error('simulated lost commit acknowledgment');}
        if(failCatalogueAcknowledgement){failCatalogueAcknowledgement=false;signedUnavailable=true;throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');}
        guard();
      },
      async readIdentity() { await identityHook?.(); if (!records.has('vault')) return null; if (identity && identity.pairFingerprint !== fingerprint()) throw Error('pair changed'); return identity ?? {walletBindingId:fingerprint(),pairFingerprint:fingerprint(),root:null,verification:'requires-unlock'}; },
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
  const factory = createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: requestCredential ?? (async (_request, _signal, check, verify) => {
    const result = await verify({ method: 'pin', pin: PASSWORD }, check);
    if (!result.accepted) throw Error(result.reason);
  }), privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null, ensureCryptoReady: async () => {
    assert.ok(globalThis.crypto.subtle, 'Node supplies real WebCrypto for this control');
  }, openStorage: open, loadSdk, assertActive, connectionFetch, trezorSessions, utxoFetch, prepareSmartAccount });
  return {
    holdPinRead() {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
      afterPinRead = async () => { entered(); await pending; };
      return { started, finish() { afterPinRead = async () => {}; release(); } };
    },
    clearFixtureIdentity() { identity = null; }, fixtureIdentity: () => identity,
    records, factory, signedBundles, utxoPort, signedValue: () => [...signedBundles.values()][0],
    onRecord(hook?: (kind: string, key: string) => Promise<void>) { recordHook = hook; },
    onIdentity(hook?: () => Promise<void>) { identityHook = hook; },
    get closes() { return closes; },
    loseCasAcknowledgement() { failCasAcknowledgement = true; },
    failPinCommit() { failPinCommit = true; },
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

test('selection receipt binds the first SDK-created UTXO group before commit and stays exact across later selections', async () => {
  const f = await readyAccounts();
  try {
    const before = f.authority.getCatalogue()!, revision = f.authority.getSnapshot().revision;
    assert.equal((f.disk.records.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord).groups.some(group => group.key === '57'), false);
    const receipt = await f.authority.selectNetwork('syscoin', revision, before.revision, () => {});
    receipt.assertCurrent();
    assert.equal(receipt.sourceContextRevision, revision); assert.equal(receipt.sourceCatalogueRevision, before.revision);
    assert.equal(receipt.target.kind, 'utxo');
    assert.equal(receipt.target.kind === 'utxo' && receipt.target.genesisHash, UTXO_NETWORKS.find(network => network.id === 'syscoin')!.genesisHash);
    assert.deepEqual(receipt.selection, { accountId: 'hd:57:0', networkId: 'syscoin', address: f.authority.getSnapshot().account!.address });
    const saved = f.disk.records.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
    assert.equal(saved.groups.filter(group => group.key === '57').length, 1);
    assert.equal(saved.groups.find(group => group.key === '57')!.accounts.HDAccount[0]!.address, receipt.selection.address);
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    assert.throws(receipt.assertCurrent);
    const reused = await f.authority.selectNetwork('syscoin', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    reused.assertCurrent(); assert.deepEqual(reused.selection, receipt.selection);
    assert.equal((f.disk.records.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord).groups.filter(group => group.key === '57').length, 1);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});
test('selection receipt cannot escape a lock during first-group admission', async () => {
  const f = await readyAccounts(), entered = Promise.withResolvers<void>(), held = Promise.withResolvers<void>();
  let first = true;
  try {
    const before = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY));
    f.disk.onIdentity(async () => { if (first) { first = false; entered.resolve(); await held.promise; } });
    const selecting = f.authority.selectNetwork('syscoin', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    await entered.promise; f.authority.lock(); held.resolve();
    await assert.rejects(selecting, /CANCELLED|OPERATION_FAILED/);
    assert.notEqual(f.authority.getSnapshot().phase, 'ready');
    assert.deepEqual(f.disk.records.get(WALLET_CATALOGUE_KEY), before);
  } finally { held.resolve(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});
test('selection receipt completes the real first-use dapp mode capability without adopting post-state', async () => {
  const f = await readyAccounts();
  try {
    const [{ createNativeNetworkView }, { createNativeDappControlHost }, { normalizeDappModeRequest }] = await Promise.all([
      import('../src/custody/networkView.ts'), import('../src/custody/dappControl.ts'), import('../../../source/shared/dappChainScope.ts'),
    ]);
    const ownerHost = await f.runtime.openConnectionHost(), before = f.authority.getSnapshot(), account = ownerHost.context().accounts[0]!;
    const controls = createNativeDappControlHost({
      networks: createNativeNetworkView(f.authority, { utxoSendAvailable: true, fetch: async () => { throw Error('Mode selection must not fetch peer-provided endpoints'); } }),
      context() {
        const state = f.authority.getSnapshot(), catalogue = f.runtime.catalogue.getControlSnapshot();
        if (state.phase !== 'ready' || !catalogue) return null;
        return { revision: state.revision, catalogueRevision: catalogue.revision, activeAccountId: catalogue.active.accountId, networkId: catalogue.active.networkId, networkLabel: catalogue.active.networkId, accounts: catalogue.accounts };
      },
      utxoNetworks() { const catalogue = f.runtime.catalogue.getSnapshot(); if (!catalogue) throw Error('CANCELLED'); return catalogue.utxoNetworks; },
      previewNetworkSelection: (id, revision) => f.runtime.catalogue.previewNetworkSelection(id, revision),
      async fetch() { throw Error('Mode selection must not fetch peer-provided endpoints'); },
      async prepareWatchAsset() { throw Error('Mode selection must not open asset authority'); },
    });
    const prepared = await controls.prepare(normalizeDappModeRequest('sys_changeUTXOEVM', [{ chainId: 57 }]), { accountId: account.id, address: account.address, networkId: 'ethereum' }, new AbortController().signal, ownerHost.assertOwner);
    assert.equal(f.authority.getSnapshot().revision, before.revision);
    let committed = 0;
    const result = await prepared.commit(ownerHost.assertOwner, () => { committed++; }); result.assertCurrent();
    assert.equal(committed, 1);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'hd:57:0');
    assert.equal(f.authority.getCatalogue()!.active.networkId, 'syscoin');
    prepared.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});
for (const fault of ['wrong-group', 'missing-receipt'] as const) test(`selection receipt refuses ${fault} from an otherwise real first-use mutation`, async () => {
  const f = await readyAccounts();
  try {
    const reserve = f.runtime.networks!.reserve;
    f.runtime.networks!.reserve = (id, revision) => {
      const admitted = reserve(id, revision);
      return { cancel: admitted.cancel, async execute(check) {
        const proof = await admitted.execute(check); assert(proof);
        return fault === 'missing-receipt' ? null : { ...proof, selection: { ...proof.selection, accountId: 'hd:60:0', address: ADDRESS } };
      } };
    };
    await assert.rejects(f.authority.selectNetwork('syscoin', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {}), /OPERATION_FAILED/);
    assert.notEqual(f.authority.getSnapshot().phase, 'ready');
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

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

test('connection UTXO public reads use the real SDK and reject a retired owner after held Blockbook discovery', async () => {
  const { getUtxoNetwork } = await import('../src/core/utxoNetworks.ts');
  const [{ getNetworkConfig }, { utils }] = await Promise.all([import('@sidhujag/sysweb3-network'), import('syscoinjs-lib')]);
  const network = getUtxoNetwork('bitcoin'), requests: string[] = [];
  let hold: (() => Promise<void>) | undefined;
  const disk = memoryDisk(undefined, undefined, undefined, undefined, async (input, init) => {
    const url = String(input); requests.push(url);
    assert.equal(init?.method, 'GET'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
    assert.match(url, /^https:\/\//);
    assert(url.startsWith(network.endpoint + '/api/v2/xpub/'));
    assert(url.endsWith('?tokens=used&details=tokens'));
    await hold?.();
    const response = Response.json({ tokens: [] }); Object.defineProperty(response, 'url', { value: url }); return response;
  });
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    await owner.selectNetwork('bitcoin', owner.getSnapshot().revision, owner.getCatalogue()!.revision, () => {});
    const host = await runtime.openConnectionHost(), account = host.context().accounts.find(value => value.id === host.context().activeAccountId)!;
    assert(account.xpub);
    const scope = { accountId: account.id, xpub: account.xpub }, signal = new AbortController().signal;
    const config = getNetworkConfig(0, 'btc');
    const hd = new utils.HDSigner(PHRASE, null, false, config.networks, 0, config.types.zPubType, 84);
    hd.createAccountAtIndex(account.index, 84);
    assert.equal(await runtime.readConnectionUtxoPublic('getChangeAddress', scope, true, signal, () => undefined), hd.createAddress(0, true, 84));
    for (const change of [false, true]) {
      assert.equal(await runtime.readConnectionUtxoPublic('getCurrentAddressPubkey', scope, change, signal, () => undefined), hd.Signer.accounts.get(account.index).getPublicKey(0, change));
      assert.equal(await runtime.readConnectionUtxoPublic('getBip32Path', scope, change, signal, () => undefined), `m/84'/0'/0'/${change ? 1 : 0}/0`);
    }
    assert.equal(requests.length, 5);
    const before = requests.length;
    await assert.rejects(runtime.readConnectionUtxoPublic('getBip32Path', { ...scope, accountId: 'hd:0:999' }, false, signal, () => undefined));
    assert.equal(requests.length, before, 'a different account cannot disclose its xpub');
    let current = true;
    hold = async () => { entered.resolve(); await release.promise; };
    const work = runtime.readConnectionUtxoPublic('getCurrentAddressPubkey', scope, false, signal, () => { if (!current) throw Error('retired request owner'); });
    const refused = assert.rejects(work);
    await entered.promise; current = false; release.resolve(); await refused;
    assert.equal(requests.length, before + 1);
  } finally { release.resolve(); await owner.dispose(); disk.restoreNetwork(); }
});

test('connection external PSBT runtime captures the selected account and aborts held prevout reads before a facade exists', async () => {
  const { getUtxoNetwork } = await import('../src/core/utxoNetworks.ts');
  const [{ utils }, { PsbtUtils }] = await Promise.all([
    import('syscoinjs-lib'), import('@sidhujag/sysweb3-keyring/cjs/utils/psbt.js'),
  ]);
  const network = getUtxoNetwork('bitcoin'), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let previous: ReturnType<typeof utils.bitcoinjs.Transaction.fromHex>, held = false;
  let readSignal: AbortSignal | undefined, calls = 0;
  const sdk = await loadNativeKeyringSdk();
  let observed!: InstanceType<typeof sdk.HostKeyring>, accountXpub = '', accountAddress = '';
  class ObservedKeyring extends sdk.HostKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) { super(...args); observed = this; }
  }
  const disk = memoryDisk(async () => ({ ...sdk, HostKeyring: ObservedKeyring }), undefined, undefined, undefined, async (input, init) => {
    calls++; const url = String(input);
    assert.equal(observed.isUnlocked(), false, 'PSBT prevout and derivation reads must finish before signing key release');
    assert.equal(init?.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    if (url === `${network.endpoint}/api/v2/xpub/${accountXpub}?tokens=used&details=tokens`) {
      const response = Response.json({ tokens: [{ name: accountAddress, path: "m/84'/0'/0'/0/0" }] });
      Object.defineProperty(response, 'url', { value: url }); return response;
    }
    assert.equal(url, `${network.endpoint}/api/v2/tx/${previous.getId()}`);
    if (held) { readSignal = init.signal!; entered.resolve(); await release.promise; }
    const response = Response.json({ hex: previous.toHex() }); Object.defineProperty(response, 'url', { value: url }); return response;
  });
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  try {
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    await owner.selectNetwork('bitcoin', owner.getSnapshot().revision, owner.getCatalogue()!.revision, () => {});
    const selected = (await runtime.openConnectionHost()).context();
    const account = selected.accounts.find(value => value.id === selected.activeAccountId)!;
    accountXpub = account.xpub!; accountAddress = account.address;
    previous = new utils.bitcoinjs.Transaction(); previous.addInput(Buffer.alloc(32, 17), 0);
    const script = utils.bitcoinjs.address.toOutputScript(account.address, network.addressNetwork);
    previous.addOutput(script, BigInt(10000));
    const psbt = new utils.bitcoinjs.Psbt({ network: network.addressNetwork });
    psbt.addInput({ hash: previous.getId(), index: 0, witnessUtxo: { script, value: BigInt(10000) } });
    psbt.addUnknownKeyValToInput(0, { key: Buffer.from('address'), value: Buffer.from(account.address) });
    psbt.addOutput({ script, value: BigInt(9000) });
    const request = { method: 'sys_sign' as const, origin: 'https://original.example', psbt: PsbtUtils.toPali(psbt) };
    const review = await runtime.prepareConnectionPsbt(request, new AbortController().signal, () => undefined, softwarePsbtHandoff);
    assert.equal(review.review.origin, request.origin); assert.equal(review.review.feeSatoshis, '1000');
    const signed = await review.approve();
    assert('psbt' in signed, 'the actual software SDK signs only after its owned credential request');
    await owner.selectNetwork('ethereum', owner.getSnapshot().revision, owner.getCatalogue()!.revision, () => {});
    assert.throws(review.assertCurrent); await assert.rejects(review.approve()); review.dispose();
    const before = calls;
    await assert.rejects(runtime.prepareConnectionPsbt(request, new AbortController().signal, () => undefined, softwarePsbtHandoff), /NOT_READY/);
    assert.equal(calls, before);
    await owner.selectNetwork('bitcoin', owner.getSnapshot().revision, owner.getCatalogue()!.revision, () => {});
    held = true; const lifetime = new AbortController();
    const opening = runtime.prepareConnectionPsbt(request, lifetime.signal, () => undefined, softwarePsbtHandoff);
    const rejected = assert.rejects(opening); await entered.promise; lifetime.abort();
    await rejected; assert.equal(readSignal?.aborted, true);
    release.resolve();
  } finally { release.resolve(); await owner.dispose(); disk.restoreNetwork(); }
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
    await assert.rejects(restarted.unlock('000000'), /INVALID_CREDENTIAL/);
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
  const factory = createKeyringRuntimeFactory({ pinCredential: null, requestOperationCredential: null, privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null,
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
  await assert.rejects(runtime.backup.readPhrase('000000'), /INVALID_CREDENTIAL/);
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
  const sdk = await loadNativeKeyringSdk();
  let unlockCalls = 0;
  let hydrations = 0;
  class ControlledKeyring extends sdk.HostKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...options);
      const hydrate = this.createFirstAccount;
      this.createFirstAccount = async (...args) => { hydrations++; return hydrate(...args); };
    }
    async withSecretOperation<T>(credential: import('@sidhujag/sysweb3-keyring/cjs/software.js').SecretOperationCredentialPort,
      options: import('@sidhujag/sysweb3-keyring/cjs/software.js').SecretOperationOptions, work: (secret: string) => T | Promise<T>): Promise<T> {
      return super.withSecretOperation(credential, options, async secret => {
        unlockCalls++;
        return work(secret);
      });
    }
  }
  return {
    loadSdk: async () => ({ ...sdk, HostKeyring: ControlledKeyring }),
    get hydrations() { return hydrations; },
    get unlockCalls() { return unlockCalls; },

  };
}

test('lifecycle cancellation still records each explicit wrong-PIN failure and reaches backoff', async () => {
  const controlled = await controlledSdk();
  const disk = memoryDisk(controlled.loadSdk);
  const runtime = await disk.factory.open();
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    await runtime.session.lock();
    const before = { failures: disk.failureWrites, successes: disk.successWrites };
    const hydrated = controlled.hydrations, initialUnlocks = controlled.unlockCalls;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const hold = disk.holdPinRead();
      const pending = runtime.session.unlock('000000');
      await hold.started;
      await runtime.session.lock();
      hold.finish();
      await assert.rejects(pending, /CANCELLED/);
      assert.equal(disk.failures, attempt);
      assert.equal(disk.failureWrites, before.failures + attempt);
      assert.equal(disk.successWrites, before.successes);
      assert.equal(controlled.hydrations, hydrated);
    }
    await assert.rejects(runtime.session.unlock(PASSWORD), /AUTH_THROTTLED/);
    assert.equal(controlled.unlockCalls - initialUnlocks, 0, 'backoff rejects before any SDK KDF');
    await assert.rejects(runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { await runtime.storage.close(); }
});

test('cancelled successful authentication neither clears failures nor hydrates an account', { timeout: 10000 }, async () => {
  const controlled = await controlledSdk();
  const disk = memoryDisk(controlled.loadSdk);
  const runtime = await disk.factory.open();
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    await runtime.session.lock();
    const before = { failures: disk.failureWrites, successes: disk.successWrites };
    assert.equal((await runtime.session.unlock('000000')).authenticated, false);
    assert.equal(disk.failures, 1);
    const hydrated = controlled.hydrations;
    // Public unlock never enters an SDK secret operation. Interrupt the actual
    // protected PIN read instead of waiting for a signing-root decryption.
    const hold = disk.holdPinRead();
    const pending = runtime.session.unlock(PASSWORD);
    await hold.started;
    await runtime.session.lock();
    hold.finish();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(disk.failures, 2);
    assert.equal(disk.failureWrites, before.failures + 2);
    assert.equal(disk.successWrites, before.successes);
    assert.equal(controlled.hydrations, hydrated);
    assert.equal(controlled.unlockCalls, 0);
    await assert.rejects(runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { await runtime.storage.close(); }
});


test('native transfers require fresh one-use PIN authorization and preserve shared SDK envelopes', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const transfers = runtime.transfers; assert.ok(transfers);
    const transaction = { type: 2 as const, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '123', gasLimit: '21000', data: '0x', maxFeePerGas: '3', maxPriorityFeePerGas: '1' };
    const signed = await signTestTransfer(transfers, transaction, { assertCurrent: () => undefined, signal: new AbortController().signal });
    const { Transaction } = await import('ethers/transaction');
    const decoded = Transaction.from(signed.rawTransaction);
    assert.equal(decoded.from, ADDRESS); assert.equal(decoded.hash, signed.hash); assert.equal(decoded.value, 123n);
    const journal = await transfers.journal(() => undefined);
    assert.equal((await journal.saveSigned(signed.rawTransaction)).hash, signed.hash);
    assert.equal((await journal.transition(signed.hash, 'attempted')).phase, 'attempted');
    const writes = { success: disk.successWrites, failure: disk.failureWrites };
    assert.equal((await signTestTransfer(transfers, transaction, { assertCurrent: () => undefined, signal: new AbortController().signal })).hash, signed.hash);
    transfers.assertUnlocked(() => undefined);
    assert.deepEqual({ success: disk.successWrites, failure: disk.failureWrites }, { success: writes.success + 1, failure: writes.failure + 1 });
    await runtime.session.lock();
    await assert.rejects(signTestTransfer(transfers, transaction, { assertCurrent: () => undefined, signal: new AbortController().signal }), /CANCELLED/);
    assert.throws(() => transfers.assertUnlocked(() => undefined), /NOT_READY/);
    assert.equal((await runtime.session.unlock(PASSWORD)).authenticated, true);
    const afterUnlock = disk.successWrites;
    transfers.assertUnlocked(() => undefined);
    await signTestTransfer(transfers, transaction, { assertCurrent: () => undefined, signal: new AbortController().signal });
    assert.equal(disk.successWrites, afterUnlock + 1);
    assert.equal((await (await transfers.journal(() => undefined)).load())?.rawTransaction, signed.rawTransaction);
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});


test('an incomplete canonical account record is refused unchanged before account authentication', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  let runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const first = runtime.catalogue.getSnapshot(), record = structuredClone(disk.records.get(WALLET_CATALOGUE_KEY));
    const initialChecks = disk.failureWrites;
    assert.equal(first?.accounts[0]?.address, ADDRESS);
    assert.equal('publicKey' in first!.accounts[0]!, false);
    await runtime.storage.close();
    disk.records.delete(WALLET_CATALOGUE_KEY);
    const incomplete = JSON.stringify([...disk.records]);
    runtime = await disk.factory.open() as KeyringRuntime;
    await assert.rejects(runtime.session.unlock('000000'), /NOT_READY/);
    await assert.rejects(runtime.session.unlock(PASSWORD), /NOT_READY/);
    assert.equal(disk.failureWrites, initialChecks, 'invalid record admission precedes any additional PIN check');
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


async function readyAccounts(loadSdk?: KeyringRuntimeDependencies['loadSdk'], connectionFetch?: KeyringRuntimeDependencies['connectionFetch'], requestCredential?: KeyringRuntimeDependencies['requestOperationCredential']) {
  const disk = memoryDisk(loadSdk, undefined, connectionFetch, undefined, undefined, undefined, requestCredential); disk.denyNetwork();
  let runtime!: KeyringRuntime;
  const authority = new NativeCustodyAuthority({ async open() { runtime = await disk.factory.open() as KeyringRuntime; return runtime; } });
  await authority.initialize();
  await authority.importPhrase(PHRASE, PASSWORD);
  await runtime.backup.confirm(await runtime.backup.fingerprint());
  authority.lock(); await authority.unlock(PASSWORD);
  const execute = (request: Parameters<NativeCustodyAuthority['manageAccounts']>[0]) => authority.manageAccounts(request, authority.getSnapshot().revision, authority.getCatalogue()!.revision);
  return { disk, authority, get runtime() { return runtime; }, execute };
}

async function readySmartCreationAuthority(beforeAddress: () => Promise<void> = async () => undefined) {
  const sdk = await loadNativeKeyringSdk(), keyrings: InstanceType<typeof sdk.HostKeyring>[] = [];
  class ObservedKeyring extends sdk.HostKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) { super(...args); keyrings.push(this); }
  }
  const coder = AbiCoder.defaultAbiCoder(), module = 'tuple(address module,bytes data)';
  const prepare: NonNullable<KeyringRuntimeDependencies['prepareSmartAccount']> = (network, accountIndex, managementAddress, _signal, assertCurrent) =>
    deriveDefaultSmartAccount({ accountIndex, chainId: Number(network.chainId), managementAddress, assertCurrent,
      assertInfrastructureSupported: async () => undefined,
      provider: {
        getNetwork: async () => ({ chainId: BigInt(network.chainId) }), verifyConfiguredChainId: async () => undefined,
        async call(transaction) {
          assertCurrent();
          assert(keyrings.every(ring => !ring.isUnlocked()), 'Smart address RPC must not hold signing keys');
          const parsed = paliSmartAccountFactoryInterface.parseTransaction({ data: String(transaction.data) }); assert(parsed);
          if (parsed.name === 'getInitData') return paliSmartAccountFactoryInterface.encodeFunctionResult(parsed.fragment,
            [coder.encode([`${module}[]`, `${module}[]`, module, `${module}[]`], [[[parsed.args[0], parsed.args[1]]], [], ['0x' + '00'.repeat(20), '0x'], []])]);
          assert.equal(parsed.name, 'getAddress'); await beforeAddress(); assertCurrent();
          const initializer = new Interface(['function initializeAccount(bytes initCode)']).encodeFunctionData('initializeAccount', [parsed.args[1]]);
          const creation = concat([PALI_ACCOUNT_PROXY_CREATION_CODE, coder.encode(['address', 'bytes'], [PALI_INFRASTRUCTURE_METADATA_BY_ID.accountImplementation.address, initializer])]);
          return paliSmartAccountFactoryInterface.encodeFunctionResult(parsed.fragment, [getCreate2Address(PALI_CANONICAL_FACTORY_ADDRESS, parsed.args[0], keccak256(creation))]);
        },
      } });
  const disk = memoryDisk(async () => ({ ...sdk, HostKeyring: ObservedKeyring }), undefined, undefined, undefined, undefined, prepare); disk.denyNetwork();
  let runtime!: KeyringRuntime;
  const authority = new NativeCustodyAuthority({ async open() { runtime = await disk.factory.open() as KeyringRuntime; return runtime; } });
  await authority.initialize(); await authority.importPhrase(PHRASE, PASSWORD);
  await runtime.backup.confirm(await runtime.backup.fingerprint()); await authority.refreshAuthenticatedMetadata();
  return { authority, disk, get runtime() { return runtime; },
    request: { networkId: 'ethereum', label: 'Owned dapp creation', target: { id: 'ecdsa' as const, config: undefined }, externalOwnersAcknowledged: false },
    async close() { await authority.dispose(); disk.restoreNetwork(); } };
}

test('account broker keeps one verified request through wrong PIN and successful creation', async () => {
  const broker = new OperationAuthentication();
  let prompt: OperationAuthenticationPrompt | null = null;
  const currentPrompt = (): OperationAuthenticationPrompt | null => prompt;
  const detach = broker.attach(value => { prompt = value; });
  const f = await readyAccounts(undefined, undefined, broker.request);
  const until = async (ready: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!ready()) {
      if (Date.now() >= deadline) throw Error('Credential prompt did not settle');
      await new Promise(resolve => setImmediate(resolve));
    }
  };
  try {
    const before = f.authority.getCatalogue();
    const creating = f.execute({ kind: 'create', label: 'Savings' });
    await until(() => currentPrompt() !== null);
    const first = currentPrompt(); assert(first);
    assert.equal(first.request.purpose, 'account-change');
    first.confirm({ method: 'pin', pin: '000000' });
    await until(() => currentPrompt()?.busy === false);
    const retry = currentPrompt(); assert(retry);
    assert.equal(retry.request.id, first.request.id);
    assert.match(retry.error ?? '', /PIN not accepted/);
    const accounts = f.runtime.accounts; assert(accounts);
    assert.equal(accounts.getSnapshot(), before);
    assert.equal(f.disk.failures, 1);
    retry.confirm({ method: 'pin', pin: PASSWORD });
    await creating;
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.authority.getCatalogue()!.accounts.length, before!.accounts.length + 1);
    assert.equal(prompt, null);
  } finally { detach(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('account broker Back cancels a held credential prompt without mutation or wallet lock', async () => {
  const broker = new OperationAuthentication(), prompts: OperationAuthenticationPrompt[] = [];
  let receive: ((prompt: OperationAuthenticationPrompt) => void) | undefined;
  const detach = broker.attach(prompt => { if (!prompt) return; if (receive) { const next = receive; receive = undefined; next(prompt); } else prompts.push(prompt); });
  const nextPrompt = () => prompts.length ? Promise.resolve(prompts.shift()!) : new Promise<OperationAuthenticationPrompt>(resolve => { receive = resolve; });
  const f = await readyAccounts(undefined, undefined, broker.request);
  try {
    const before = f.authority.getCatalogue();
    const pending = f.execute({ kind: 'create', label: 'Cancelled' });
    await nextPrompt();
    f.authority.cancelAccountOperation();
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.authority.getCatalogue(), before);
    const retry = f.execute({ kind: 'create', label: 'Fresh' });
    (await nextPrompt()).confirm({ method: 'pin', pin: PASSWORD });
    await retry;
    assert.equal(f.authority.getCatalogue()!.accounts.length, before!.accounts.length + 1);
  } finally { detach(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('account broker rejects password-bearing legacy requests before credential acquisition', async () => {
  let prompts = 0;
  const f = await readyAccounts(undefined, undefined, async (_request, _signal, check, verify) => {
    prompts++; check(); const result = await verify({ method: 'pin', pin: PASSWORD }, check);
    if (!result.accepted) throw Error(result.reason);
  });
  try {
    const before = f.authority.getCatalogue();
    await assert.rejects(f.execute({ kind: 'create', label: 'Legacy', password: PASSWORD } as never), { code: 'INVALID_INPUT' });
    assert.equal(prompts, 0); assert.equal(f.authority.getCatalogue(), before);
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('PIN change refusal preserves the real runtime and permits a corrected current PIN', async () => {
  const f = await readyAccounts();
  try {
    const before = f.authority.getCatalogue();
    await assert.rejects(f.authority.changePin('000000', '654321', () => undefined), { code: 'INVALID_CREDENTIAL' });
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.authority.getCatalogue(), before);
    await f.authority.changePin(PASSWORD, '654321', () => undefined);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    f.authority.lock(); await f.authority.unlock('654321');
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('PIN change storage failure cannot leave a ready facade over a locked runtime', async () => {
  const f = await readyAccounts();
  try {
    f.disk.failPinCommit();
    await assert.rejects(f.authority.changePin(PASSWORD, '654321', () => undefined));
    assert.notEqual(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.authority.getCatalogue(), null);
    assert.equal(f.runtime.accounts!.getSnapshot(), null);
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('owned Smart creation authority publishes the actual private selection before returning its allocation', async () => {
  const f = await readySmartCreationAuthority(), lifetime = new AbortController();
  const portfolio = new NativePortfolioController(f.authority, { async readBalance() { throw Error('No balance read is needed'); } });
  const disconnect = portfolio.connect(); let committed: NativeSmartCreationAllocation | undefined, published = false;
  const before = f.authority.getSnapshot();
  const unsubscribe = f.authority.subscribe(snapshot => {
    if (snapshot.account?.address === committed?.account.address) {
      published = true; assert.equal(snapshot.phase, 'ready'); assert.equal(f.authority.getCatalogue()!.active.accountId, committed!.account.id);
    }
  });
  try {
    const allocation = await f.authority.allocateConnectionSmartAccount(f.request, lifetime.signal, () => undefined, receipt => {
      committed = receipt; assert.equal(f.authority.getSnapshot().account!.address, before.account!.address);
    });
    assert.equal(allocation, committed); assert(published); assert(f.authority.getSnapshot().revision > before.revision);
    assert.equal(f.authority.getSnapshot().account!.address, allocation.account.address);
    assert.equal(f.authority.getCatalogue()!.active.accountId, allocation.account.id);
    assert.equal(await f.runtime.session.readSelectedAddress(), allocation.account.address);
    const host = await f.runtime.openConnectionHost();
    assert.equal(host.context().activeAccountId, allocation.account.id); assert.equal(f.runtime.canSignSmartAccount(), true);
    assert.equal(portfolio.getActiveAccount()!.address, allocation.account.address);
    allocation.assertCurrent();
  } finally { unsubscribe(); disconnect(); await f.close(); }
});

test('owned Smart creation authority refuses a stale request before its held private allocation commits', async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await readySmartCreationAuthority(async () => { entered.resolve(); await release.promise; });
  let current = true;
  try {
    const allocating = f.authority.allocateConnectionSmartAccount(f.request, new AbortController().signal, () => { if (!current) throw Error('Retired request'); }, () => assert.fail('Stale allocation committed'));
    const rejected = assert.rejects(allocating); await entered.promise; current = false; release.resolve(); await rejected;
    assert.notEqual(f.authority.getSnapshot().phase, 'ready'); assert.equal(f.authority.getSnapshot().account, null);
    await f.authority.unlock(PASSWORD); assert.equal(f.authority.getCatalogue()!.accounts.filter(account => account.type === 'SmartAccount').length, 0);
  } finally { release.resolve(); await f.close(); }
});

for (const stop of ['abort-at-commit', 'lock-during-adoption'] as const) test(`owned Smart creation authority retains saved allocation and fails closed on ${stop}`, async () => {
  const f = await readySmartCreationAuthority(), lifetime = new AbortController();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let committed: NativeSmartCreationAllocation | undefined;
  const original = f.runtime.session.readSelectedAddress.bind(f.runtime.session);
  if (stop === 'lock-during-adoption') f.runtime.session.readSelectedAddress = async () => { entered.resolve(); await release.promise; return original(); };
  try {
    const allocating = f.authority.allocateConnectionSmartAccount(f.request, lifetime.signal, () => undefined, receipt => {
      committed = receipt; if (stop === 'abort-at-commit') lifetime.abort();
    });
    const rejected = assert.rejects(allocating);
    if (stop === 'lock-during-adoption') { await entered.promise; f.authority.lock(); release.resolve(); }
    await rejected; assert(committed); assert.notEqual(f.authority.getSnapshot().phase, 'ready'); assert.equal(f.authority.getSnapshot().account, null);
    f.runtime.session.readSelectedAddress = original;
    await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getSnapshot().account!.address, committed.account.address);
    assert.equal(f.authority.getCatalogue()!.active.accountId, committed.account.id);
  } finally { release.resolve(); f.runtime.session.readSelectedAddress = original; await f.close(); }
});

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
  const approval = createDappSigningApproval({
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
  return { handoff: nonSuiteSigningHandoff, accountId, networkId: host.context().networkId, request, approval };
}

test('connection encryption captures the actual software SDK and preserves plaintext without an owner fallback', async () => {
  const f = await readyAccounts();
  try {
    for (const imported of [false, true]) {
      if (imported) await importTestKey(f);
      const host = await f.runtime.openConnectionHost();
      const address = f.authority.getSnapshot().account!.address;
      const input = approveRuntimeMessage(f, host, { method: 'personal_sign', message: 'Public approval fixture', address });
      const primitive = host.encryptionSdk(input);
      const publicKey = await primitive.getEncryptedPubKey();
      assert.equal(Buffer.from(publicKey, 'base64').length, 32);
      for (const plaintext of ['', ' \t\n ', 'Public Unicode: ☃ 👋']) {
        const ciphertext = '0x' + Buffer.from(JSON.stringify(encrypt({ publicKey, data: plaintext, version: 'x25519-xsalsa20-poly1305' }))).toString('hex');
        if (plaintext === '') await assert.rejects(async () => primitive.decryptMessage([ciphertext, address]), /Decryption failed/);
        else assert.equal(await primitive.decryptMessage([ciphertext, address]), plaintext);
        await assert.rejects(async () => primitive.decryptMessage([ciphertext, '0x' + '22'.repeat(20)]), /wrong receiver/);
      }
      input.approval.dispose();
      await assert.rejects(async () => primitive.getEncryptedPubKey());
    }
    const host = await f.runtime.openConnectionHost();
    const input = approveRuntimeMessage(f, host, { method: 'personal_sign', message: 'Public approval fixture', address: f.authority.getSnapshot().account!.address });
    const primitive = host.encryptionSdk(input);
    f.authority.lock();
    await assert.rejects(async () => primitive.getEncryptedPubKey());
    input.approval.dispose();
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('explicit broker cancellation preserves the real public wallet without authorizing a message', async () => {
  const broker = new OperationAuthentication();
  const prompts: OperationAuthenticationPrompt[] = [];
  let receive: ((prompt: OperationAuthenticationPrompt) => void) | undefined;
  const detach = broker.attach(value => {
    if (!value) return;
    if (receive) { const deliver = receive; receive = undefined; deliver(value); }
    else prompts.push(value);
  });
  const nextPrompt = () => prompts.length ? Promise.resolve(prompts.shift()!) : new Promise<OperationAuthenticationPrompt>(resolve => { receive = resolve; });
  const f = await readyAccounts(undefined, undefined, broker.request);
  try {
    const host = await f.runtime.openConnectionHost(), before = f.authority.getSnapshot();
    const input = approveRuntimeMessage(f, host, { method: 'personal_sign', message: 'No signature on cancellation', address: before.account!.address });
    try {
      const cancelled = host.signMessage(input);
      const prompt = await Promise.race([nextPrompt(), cancelled.then(() => { throw Error('Missing credential request'); })]);
      prompt.cancel();
      await assert.rejects(cancelled, /CANCELLED/);
      assert.equal(f.authority.getSnapshot(), before);
      assert.equal(await f.runtime.session.readSelectedAddress(), before.account!.address);
      const next = host.signMessage(input);
      const retry = await Promise.race([nextPrompt(), next.then(() => { throw Error('Missing credential request'); })]);
      retry.confirm({ method: 'pin', pin: PASSWORD });
      assert.match(await next, /^0x[0-9a-f]+$/i);
      assert.equal(f.authority.getSnapshot(), before);
    } finally { input.approval.dispose(); }
  } finally { detach(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

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
          const signature = await host.signMessage({ ...input, handoff: nonSuiteSigningHandoff });
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
    await f.authority.selectConnectionAccount('hd:60:0', f.authority.getSnapshot().revision, () => undefined);
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
  const sdk = await loadNativeKeyringSdk();
  const entered = deferredAccount(),
    release = deferredAccount();
  class HeldMessageKeyring extends sdk.HostKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...args);
      const sign = this.ethereumTransaction.signPersonalMessage;
      this.ethereumTransaction.signPersonalMessage = async (params, authority) => {
        const signature = await sign(params, authority);
        entered.resolve();
        await release.promise;
        return signature;
      };
    }
  }
  const f = await readyAccounts(async () => ({
    ...sdk,
    HostKeyring: HeldMessageKeyring,
  }));
  try {
    const host = await f.runtime.openConnectionHost();
    const request = readDappMessageRequest(
      'personal_sign',
      [ADDRESS, 'hello'],
      ADDRESS
    )!;
    const input = approveRuntimeMessage(f, host, request);
    const signing = host.signMessage({ ...input, handoff: nonSuiteSigningHandoff });
    const rejected = assert.rejects(signing, /CANCELLED/);
    await entered.promise;
    await assert.rejects(host.signMessage({ ...input, handoff: nonSuiteSigningHandoff }), /BUSY/);
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
    await f.execute({ kind: 'create', label: 'Savings',});
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    const host = await f.runtime.openConnectionHost();
    assert.equal((await f.runtime.openConnectionHost()).repository, host.repository);
    const target = await grantConnection(host, 1, 'a');
    const retained = await grantConnection(host, 0, 'b');
    await host.repository.transport.setItem('test-protocol-key', { secret: 'fixture-secret' });
    await f.execute({ kind: 'remove', id: 'hd:60:1',});
    assert.deepEqual(target.port.read().dapps, {});
    assert.ok(retained.port.read().dapps[retained.origin]);
    assert.deepEqual(await host.repository.transport.getItem('test-protocol-key'), { secret: 'fixture-secret' });
    await f.execute({ kind: 'create', label: 'Reused',});
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
      await f.execute({ kind: 'create', label: 'Savings',});
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
      await assert.rejects(f.execute({ kind: 'remove', id: 'hd:60:1',}));
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
    await f.execute({ kind: 'create', label: 'Savings',});
    const second = f.authority.getCatalogue()!.accounts.find((a) => a.index === 1)!;
    assert.equal(second.address, '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0');
    assert.equal(f.authority.getSnapshot().account?.address, second.address);
    await f.execute({ kind: 'rename', id: second.id, label: 'Long term' });
    assert.equal(f.authority.getCatalogue()!.accounts.find((a) => a.index === 1)!.label, 'Long term');
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: second.id,});
    assert.equal(f.authority.getCatalogue()!.accounts.some(account => account.id === second.id), false);
    await f.execute({ kind: 'create', label: 'New account',});
    assert.equal(f.authority.getCatalogue()!.accounts.at(-1)!.index, 1);
    assert.equal(f.authority.getSnapshot().account?.address, second.address);
    assert.equal('removed' in f.authority.getCatalogue()!, false);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: second.id,});
    await f.execute({ kind: 'create', label: 'Recreated savings',});
    assert.equal(f.authority.getSnapshot().account?.address, second.address);
    const signed = await signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: second.address,
      to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal });
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
    const first = await signTestTransfer(f.runtime.transfers!, tx(ADDRESS), { assertCurrent: () => undefined, signal: new AbortController().signal });
    let journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(first.rawTransaction); await journal.transition(first.hash, 'attempted');
    assert.equal(JSON.parse(f.disk.signedValue()!).entries.length, 1);
    await f.execute({ kind: 'create', label: 'Savings',});
    const secondAddress = f.authority.getSnapshot().account!.address;
    journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal(await journal.load(), null);
    const second = await signTestTransfer(f.runtime.transfers!, tx(secondAddress), { assertCurrent: () => undefined, signal: new AbortController().signal });
    journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(second.rawTransaction); await journal.transition(second.hash, 'attempted');
    assert.equal(JSON.parse(f.disk.signedValue()!).entries.length, 2);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal((await journal.load())!.rawTransaction, first.rawTransaction);
    await assert.rejects(f.execute({ kind: 'remove', id: 'hd:60:1',}), /PENDING_TRANSFER/);
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
    await assert.rejects(f.execute({ kind: 'create', label: 'Cancelled',}), /CANCELLED/);
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
  const sdk = await loadNativeKeyringSdk();
  let gate: { phase: string; entered: ReturnType<typeof deferredAccount>; released: ReturnType<typeof deferredAccount> } | undefined;
  let signingHook: (() => void) | undefined;
  let exportResult: string | undefined;
  let exportError: Error | undefined;
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
  class RaceKeyring extends sdk.HostKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.HostKeyring>) {
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
        if (exportError) throw exportError;
        const result = exportResult ?? await exportKey(...args);
        await hold('export-after');
        return result;
      };
    }
    async withSecretOperation<T>(credential: import('@sidhujag/sysweb3-keyring/cjs/software.js').SecretOperationCredentialPort,
      options: import('@sidhujag/sysweb3-keyring/cjs/software.js').SecretOperationOptions, work: (secret: string) => T | Promise<T>): Promise<T> {
      return super.withSecretOperation(credential, options, async secret => { unlocks++; await hold('password'); return work(secret); });
    }
  }
  return {
    loadSdk: async () => ({ ...sdk, HostKeyring: RaceKeyring }),
    onSign(hook?: () => void) { signingHook = hook; },
    get exports() { return exports; },
    get imports() { return imports; },
    get unlocks() { return unlocks; },
    get hydrations() { return hydrations; },
    get allocations() { return allocations; },
    setAllocationPatch(value?: Record<string, unknown>) { allocationPatch = value; },
    setExportResult(value?: string) { exportResult = value; },
    failExport() { exportError = new Error('synthetic SDK error containing secret material'); },
    setExportError(error: Error) { exportError = error; },
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
  const sign = (chainId: string) => signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: ADDRESS, to: ADDRESS,
    chainId, nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal });
  try {
    const ethereum = await sign('1');
    const first = await f.runtime.transfers!.journal(() => undefined);
    await first.saveSigned(ethereum.rawTransaction);
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    const base = await sign('8453');
    await (await f.runtime.transfers!.journal(() => undefined)).saveSigned(base.rawTransaction);
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    const stale = await f.runtime.transfers!.journal(() => undefined);
    let invalidations = 0;
    await f.runtime.resetActivity(() => undefined, () => { invalidations++; });
    assert.equal(invalidations, 1);
    await assert.rejects(stale.load(), /CANCELLED|CONTEXT_CHANGED/);
    assert.equal(await (await f.runtime.transfers!.journal(() => undefined)).load(), null);
    assert.equal(await f.runtime.session.readSelectedAddress(), ADDRESS);
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    assert.equal((await (await f.runtime.transfers!.journal(() => undefined)).load())!.hash, base.hash);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('activity reset inside signing revokes the result without locking the current owner', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  let reset: Promise<void> | undefined;
  try {
    sdk.onSign(() => { reset = f.runtime.resetActivity(() => undefined, () => undefined); });
    await assert.rejects(signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: ADDRESS, to: ADDRESS,
      chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal }), /CANCELLED/);
    assert(reset);
    await reset;
    assert.equal(await f.runtime.session.readSelectedAddress(), ADDRESS);
    assert.equal(await (await f.runtime.transfers!.journal(() => undefined)).load(), null);
    sdk.onSign(() => { throw Error('current signing failed'); });
    await assert.rejects(signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: ADDRESS, to: ADDRESS,
      chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal }), /OPERATION_FAILED/);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    await assert.rejects(f.runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { sdk.onSign(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('locking an in-flight activity reset preserves its stored records', async () => {
  const f = await readyAccounts();
  const entered = deferredAccount(), release = deferredAccount();
  try {
    const signed = await signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: ADDRESS, to: ADDRESS,
      chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal });
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
    const confirm = transfers.confirm(await prepareAccountTransfer(transfers), { method: 'pin', pin: PASSWORD });
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
test(`${networkId} normal confirmation and exact-byte retry each authenticate without rehydrating accounts`, async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc(networkId);
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    const before = { unlocks: sdk.unlocks, hydrations: sdk.hydrations, success: f.disk.successWrites, failure: f.disk.failureWrites };
    await transfers.confirm(await prepareAccountTransfer(transfers), { method: 'pin', pin: PASSWORD });
    assert.deepEqual({ unlocks: sdk.unlocks, hydrations: sdk.hydrations, success: f.disk.successWrites, failure: f.disk.failureWrites },
      { ...before, unlocks: before.unlocks + 1, success: before.success + 1, failure: before.failure + 1 });
    await transfers.recover(true);
    const retry = transfers.getSnapshot().review!;
    assert.equal(retry.retry, true);
    await transfers.confirm(retry.id, { method: 'pin', pin: PASSWORD });
    assert.deepEqual({ unlocks: sdk.unlocks, hydrations: sdk.hydrations, success: f.disk.successWrites, failure: f.disk.failureWrites },
      { ...before, unlocks: before.unlocks + 1, success: before.success + 2, failure: before.failure + 2 });
    assert.equal(network.broadcasts.length, 2);
    assert.equal(network.broadcasts[0], network.broadcasts[1]);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test(`${networkId} synchronous selection reentrancy from SDK signing is denied before authority publication`, async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc(networkId);
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    await f.execute({ kind: 'create', label: 'Savings',});
    let attempted: Promise<void> | undefined;
    const revision = f.authority.getSnapshot().revision;
    sdk.onSign(() => { attempted = f.execute({ kind: 'select', id: 'hd:60:0' }); void attempted.catch(() => undefined); });
    await transfers.confirm(await prepareAccountTransfer(transfers), { method: 'pin', pin: PASSWORD });
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
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
      await f.execute({ kind: 'create', label: 'Savings',});
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
        pending = transfers.confirm(id, { method: 'pin', pin: PASSWORD });
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

test('account selection waits for active backup authentication and invalidates an old phrase acknowledgement', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  const backup = new SeedBackupFlow(f.authority, () => f.runtime.backup);
  try {
    await f.execute({ kind: 'create', label: 'Savings',});
    const hold = sdk.hold('password');
    const pending = backup.begin(PASSWORD);
    await hold.entered;
    await assert.rejects(f.execute({ kind: 'select', id: 'hd:60:0' }), /BUSY/);
    hold.release(); const challenge = await pending;
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await assert.rejects(backup.confirm(challenge.id, challenge.words), /BACKUP_EXPIRED/);
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
    const reservation = f.runtime.accounts!.reserve({ kind: 'create', label: 'Must not commit',}, f.authority.getCatalogue()!.revision);
    await assert.rejects(reservation.execute(asynchronousGuard), /CANCELLED/);
    assert.equal(JSON.stringify(f.disk.records.get(WALLET_CATALOGUE_KEY)), before);
    await f.runtime.session.unlock(PASSWORD);
    await assert.rejects(f.runtime.transfers!.journal(asynchronousGuard), /CANCELLED/);
    assert.throws(() => f.runtime.transfers!.assertUnlocked(asynchronousGuard), /CANCELLED/);
    await assert.rejects(signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: asynchronousGuard, signal: new AbortController().signal }), /CANCELLED/);
    assert.equal(JSON.stringify(f.disk.records.get(WALLET_CATALOGUE_KEY)), before);
    assert.equal(f.disk.records.has('native-evm-transfer-v1'), false);
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('known ineligible account requests preserve the ready authority and its revision', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Savings',});
    const before = f.authority.getSnapshot(), catalogue = f.authority.getCatalogue();
    const persisted = JSON.stringify([...f.disk.records]);
    const credentials = [f.disk.failureWrites, f.disk.successWrites];
    const requests = [
      { kind: 'remove' as const, id: 'hd:60:0',},
      { kind: 'remove' as const, id: 'hd:60:1',},
      { kind: 'remove' as const, id: 'hd:60:99',},
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
      await f.execute({ kind: 'create', label: `Account ${index + 1}`,});
    assert.equal(f.authority.getCatalogue()!.accounts.length, 22);
    const before = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY)) as NativeAccountRecord;
    const retained = before.groups[0]!.accounts.HDAccount[21]!;
    assert.ok(retained.xprv);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'hd:60:1',});
    await f.execute({ kind: 'create', label: 'Reused gap',});
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
    await f.execute({ kind: 'create', label: 'Savings',});
    const address = f.authority.getSnapshot().account!.address;
    const select = (id: string) => f.authority.selectNetwork(id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    for (const network of NATIVE_NETWORKS) {
      await select(network.id);
      assert.equal(f.authority.getSnapshot().account!.network, network.id);
      assert.equal(f.authority.getSnapshot().account!.address, address);
      const signed = await signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: address, to: ADDRESS, chainId: network.chainId, nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal });
      assert.equal(Transaction.from(signed.rawTransaction).chainId, BigInt(network.chainId));
    }
    await select('syscoin-nevm');
    await f.execute({ kind: 'create', label: 'New on NEVM context',});
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
    await f.execute({ kind: 'create', label: 'Cross-chain',});
    const account = f.authority.getSnapshot().account!.address;
    const transaction = (chainId: string) => ({ type: 2 as const, accessList: [], from: account, to: ADDRESS, chainId,
      nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' });
    const signedByNetwork = new Map<TransferTestNetwork, { rawTransaction: string; hash: string }>();
    for (const networkId of ['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet'] as const) {
      await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
      const chainId = getNativeNetwork(networkId).chainId;
      const wrongChainId = networkId === 'ethereum' ? '57057' : '1';
      await assert.rejects(signTestTransfer(f.runtime.transfers!, transaction(wrongChainId), { assertCurrent: () => undefined, signal: new AbortController().signal }), /INVALID_INPUT/);
      const signed = await signTestTransfer(f.runtime.transfers!, transaction(chainId), { assertCurrent: () => undefined, signal: new AbortController().signal });
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
      await reopened.selectNetwork(networkId, reopened.getSnapshot().revision, reopened.getCatalogue()!.revision, () => {});
      assert.equal((await (await runtime.transfers!.journal(() => undefined)).load())!.rawTransaction, signedByNetwork.get(networkId)!.rawTransaction);
    }
    await reopened.manageAccounts({ kind: 'select', id: 'hd:60:0' }, reopened.getSnapshot().revision, reopened.getCatalogue()!.revision);
    await assert.rejects(reopened.manageAccounts({ kind: 'remove', id: 'hd:60:1',}, reopened.getSnapshot().revision, reopened.getCatalogue()!.revision), /PENDING_TRANSFER/);
    assert.deepEqual(JSON.parse(f.disk.signedValue()!), stored);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const networkId of ['syscoin-nevm-testnet', 'zksys-testnet'] as const) {
test(`${networkId} native controller retries exact installed-SDK bytes before its ordinary receipt confirmation`, async () => {
  const f = await readyAccounts(), network = localTransferRpc(networkId);
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    const review = await prepareAccountTransfer(transfers);
    assert.equal(transfers.getSnapshot().review!.context.chainId, getNativeNetwork(networkId).chainId);
    assert.equal(transfers.getSnapshot().review!.context.symbol, 'TSYS');
    await transfers.confirm(review, { method: 'pin', pin: PASSWORD });
    assert.equal(network.broadcasts.length, 1);
    assert.equal(Transaction.from(network.broadcasts[0]!).chainId, BigInt(getNativeNetwork(networkId).chainId));
    await transfers.recover(true);
    assert.equal(transfers.getSnapshot().review!.retry, true);
    await transfers.confirm(transfers.getSnapshot().review!.id, { method: 'pin', pin: PASSWORD });
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
    const select = (id: string) => f.authority.selectNetwork(id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
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
    await f.authority.selectNetwork(networkId, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    let attempted: ReturnType<NativeCustodyAuthority['selectNetwork']> | undefined;
    const revision = f.authority.getSnapshot().revision;
    sdk.onSign(() => {
      attempted = f.authority.selectNetwork('ethereum', revision, f.authority.getCatalogue()!.revision, () => {});
      void attempted.catch(() => undefined);
    });
    await transfers.confirm(await prepareAccountTransfer(transfers), { method: 'pin', pin: PASSWORD });
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
      const select = (id: string) => f.authority.selectNetwork(id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
      await select(networkId);
      const review = await prepareAccountTransfer(transfers);
      if (phase === 'journal-write') f.disk.onRecord(async (kind, key) => {
        if (kind === 'create' && key.startsWith('pali-evm-signed-v1:')) { entered.resolve(); await release.promise; }
      });
      else broadcastHold = network.holdBroadcast();
      const signing = transfers.confirm(review, { method: 'pin', pin: PASSWORD }); void signing.catch(() => undefined);
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
      await f.authority.selectNetwork('zksys-testnet', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
      const id = await prepareAccountTransfer(transfers);
      const approved = transfers.getSnapshot().review!;
      assert.equal(approved.priorityFeePerGas, '0');
      assert.equal(approved.maximumFeePerGas, '25');
      assert.equal(approved.gasLimit, '25200');
      currentBase = expensiveAfterReview ? 1n : 10n;
      network.setFees({ baseFee: currentBase, priorityFee: 9n });
      if (expensiveAfterReview) {
        await assert.rejects(transfers.confirm(id, { method: 'pin', pin: PASSWORD }), /EXPIRED/);
        assert.equal(network.broadcasts.length, 0);
        assert.equal(await (await f.runtime.transfers!.journal(() => undefined)).load(), null);
      } else {
        await transfers.confirm(id, { method: 'pin', pin: PASSWORD });
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
    await assert.rejects(f.authority.selectNetwork('unknown', before.revision, f.authority.getCatalogue()!.revision, () => {}), /INVALID_INPUT/);
    assert.equal(f.authority.getSnapshot(), before);
    const hold = sdk.hold('password');
    const pending = f.runtime.backup.readPhrase(PASSWORD);
    await hold.entered;
    await assert.rejects(f.authority.selectNetwork('base', before.revision, f.authority.getCatalogue()!.revision, () => {}), /BUSY/);
    assert.equal(f.authority.getSnapshot(), before);
    hold.release(); await pending;
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('lost network-context CAS acknowledgement quarantines and cold reopens its committed selection', async () => {
  const f = await readyAccounts();
  try {
    f.disk.loseCasAcknowledgement();
    await assert.rejects(f.authority.selectNetwork('arbitrum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {}), /UNAVAILABLE/);
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
    const pending = transfers.confirm(review, { method: 'pin', pin: PASSWORD }); void pending.catch(() => undefined);
    await entered.promise;
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    assert.equal(f.authority.getSnapshot().account?.network, 'base');
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
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
    await f.execute({ kind: 'create', label: 'Savings',});
    const address = f.authority.getSnapshot().account!.address;
    const sign = async (chainId: string) => signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: address, to: ADDRESS, chainId, nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal });
    const first = await sign('1'); let journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(first.rawTransaction); await journal.transition(first.hash,'nonce-consumed');
    await f.authority.selectNetwork('syscoin-nevm',f.authority.getSnapshot().revision,f.authority.getCatalogue()!.revision, () => {});
    const other = await sign('57'); journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(other.rawTransaction); await journal.transition(other.hash,'attempted');
    await f.execute({ kind:'select',id:'hd:60:0' });
    await assert.rejects(f.execute({kind:'remove',id:'hd:60:1',}),/PENDING_TRANSFER/);
    await f.authority.unlock(PASSWORD); await f.execute({kind:'select',id:'hd:60:1'});
    journal=await f.runtime.transfers!.journal(()=>undefined); await journal.transition(other.hash,'confirmed');
    const retained=f.disk.signedValue(); await f.execute({kind:'select',id:'hd:60:0'});
    await f.execute({kind:'remove',id:'hd:60:1',});
    assert.equal(f.disk.signedValue(),retained); assert.equal(JSON.parse(retained!).entries.length,2);
    await f.execute({kind:'create',label:'Recreated',});
    assert.equal(f.authority.getSnapshot().account!.address,address);
    assert.equal((await (await f.runtime.transfers!.journal(()=>undefined)).load())!.rawTransaction,other.rawTransaction);
    await f.authority.selectNetwork('ethereum',f.authority.getSnapshot().revision,f.authority.getCatalogue()!.revision, () => {});
    assert.equal((await (await f.runtime.transfers!.journal(()=>undefined)).load())!.rawTransaction,first.rawTransaction);
  } finally { await f.authority.dispose().catch(()=>undefined); f.disk.restoreNetwork(); }
});

test('ambiguous signed-record acknowledgement quarantines authority and reopening preserves bytes', async () => {
  const f = await readyAccounts(), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    const review = await prepareAccountTransfer(transfers);
    f.disk.loseCasAcknowledgement();
    await expectUnavailable(f.authority, () => assert.rejects(transfers.confirm(review, { method: 'pin', pin: PASSWORD })));
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    await assert.rejects(f.authority.unlock(PASSWORD), /NOT_READY/);
    await assert.rejects(f.runtime.backup.readPhrase(PASSWORD), /CLEANUP_FAILED/);
    assert.equal(network.broadcasts.length, 0);
    const retained = f.disk.signedValue()!;
    const value = JSON.parse(retained);
    assert.equal(value.entries[0].phase, 'signed');
    assert.equal(f.disk.signedValue(), retained);
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    assert.equal(f.disk.closes, 1);
    let runtime!: KeyringRuntime;
    const reopened = new NativeCustodyAuthority({ async open() { runtime = await f.disk.factory.open() as KeyringRuntime; return runtime; } });
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    const saved = await (await runtime.transfers!.journal(() => undefined)).load();
    assert.equal(saved!.hash, value.entries[0].hash);
    assert.equal(f.disk.signedValue(), retained);
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
    const pending = transfers.confirm(review, { method: 'pin', pin: PASSWORD }); void pending.catch(() => undefined);
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
    const signed = await signTestTransfer(f.runtime.transfers!, tx, { assertCurrent: () => undefined, signal: new AbortController().signal });
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
    const signed = await signTestTransfer(f.runtime.transfers!, tx, { assertCurrent: () => undefined, signal: new AbortController().signal });
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
      () => readTestSelectedKey(f.runtime, exportScope, () => undefined),
      () => signTestTransfer(f.runtime.transfers!, tx, { assertCurrent: () => undefined, signal: new AbortController().signal }),
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
    const signed = await signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal });
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
    await f.execute({ kind: 'create', label: 'Savings',});
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, []);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, [token]);
    const catalogue = f.authority.getCatalogue()!;
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, catalogue.revision, () => {});
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, []);
    const base = f.authority.getCatalogue()!;
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, base.revision, () => {});
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
    await assert.rejects(f.execute({ kind: 'create', label: 'Blocked',}), /BUSY/);
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
function readTestSelectedKey(runtime: KeyringRuntime, scope: HdKeyExportScope, check: () => void) {
  return runtime.keyExport!.readSelected(scope, new AbortController().signal, check, createTestPrivateAuthentication(() => undefined));
}
async function eventually(predicate: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert(predicate(), 'expected asynchronous fixture state');
}
function credentialPrompt() {
  const broker = new OperationAuthentication();
  let current: OperationAuthenticationPrompt | null = null;
  const detach = broker.attach(prompt => { current = prompt; });
  return { broker, detach, get current() { return current; } };
}

test('HD key reveal uses real SDK across registered networks and recreated nonzero indices', async () => {
  const f = await readyAccounts(), flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!));
  try {
    const key0 = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/0").privateKey;
    for (const n of NATIVE_NETWORKS) {
      if (n.id !== f.authority.getCatalogue()!.active.networkId)
        await f.authority.selectNetwork(n.id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
      const before = JSON.stringify([...f.disk.records]), shown = await flow.begin();
      assert.equal(shown.privateKey, key0); assert.equal(shown.address, ADDRESS); assert.equal(shown.accountId, 'hd:60:0');
      assert.equal(Object.isFrozen(shown), true); assert.equal(flow.isCurrent(shown.id), true);
      assert.equal(JSON.stringify([...f.disk.records]), before);
      assert.equal(JSON.stringify(f.authority.getSnapshot()).includes(key0), false);
      flow.cancel(); assert.equal(flow.isCurrent(shown.id), false);
    }
    await f.execute({ kind: 'create', label: 'Second',});
    const shown = await flow.begin(), key1 = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/1");
    assert.equal(shown.privateKey, key1.privateKey); assert.equal(shown.address, key1.address);
    await f.execute({ kind: 'select', id: 'hd:60:0' }); assert.equal(flow.isCurrent(shown.id), false);
    await f.execute({ kind: 'remove', id: 'hd:60:1',});
    await f.execute({ kind: 'create', label: 'Recreated second',});
    assert.equal((await flow.begin()).privateKey, key1.privateKey);
  } finally { flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('UTXO HD reveal returns the selected SDK account key and clears on network changes', async () => {
  const f = await readyAccounts(), flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!));
  try {
    let previous: string | undefined;
    for (const network of UTXO_NETWORKS) {
      await f.authority.selectNetwork(network.id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
      if (previous) assert.equal(flow.isCurrent(previous), false);
      const before = JSON.stringify([...f.disk.records]);
      const shown = await flow.begin();
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
  const flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!));
  try {
    const network = UTXO_NETWORKS[0]!;
    await f.authority.selectNetwork(network.id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    await f.execute({ kind: 'create', label: 'Another account',});
    const shown = await flow.begin();
    assert.equal(shown.accountId, `hd:${network.slip44}:1`);
    await f.execute({ kind: 'select', id: `hd:${network.slip44}:0` });
    assert.equal(flow.isCurrent(shown.id), false);
    sdk.setExportResult(shown.privateKey);
    await assert.rejects(flow.begin(), /^Error: KEY_EXPORT_UNAVAILABLE$/);
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
      await assert.rejects(readTestSelectedKey(f.runtime, input as HdKeyExportScope, () => undefined), /INVALID_INPUT/);
    assert.equal(reads, 0); assert.equal(sdk.exports, 0);
    for (const input of [{ ...scope, registrationHash: '0x' + '1'.repeat(64) }, { ...scope, index: 1, accountId: 'hd:60:1' }, { ...scope, catalogueRevision: scope.catalogueRevision + 1 }]) {
      await assert.rejects(readTestSelectedKey(f.runtime, input, () => undefined), /CANCELLED/);
      f.authority.lock(); await f.authority.unlock(PASSWORD);
    }
    await assert.rejects(readTestSelectedKey(f.runtime, selectedKeyScope(f), (() => Promise.resolve()) as any), /CANCELLED/);
    assert.equal(sdk.exports, 0);
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key export rejects malformed, zero, out-of-range and wrong-address keys', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!));
  try {
    const wrongKey = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/1").privateKey;
    for (const key of ['secret', '0x' + '0'.repeat(64), '0x' + 'f'.repeat(64),
      '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141', wrongKey]) {
      sdk.setExportResult(key);
      await assert.rejects(flow.begin(), (error: Error) => {
        assert.equal(error.message, 'KEY_EXPORT_UNAVAILABLE'); assert.equal(JSON.stringify(error).includes(key), false); return true;
      });
      assert.equal(f.authority.getSnapshot().phase, 'locked'); await f.authority.unlock(PASSWORD);
    }
    sdk.failExport(); const before = { failure: f.disk.failureWrites, success: f.disk.successWrites };
    await assert.rejects(flow.begin(), /^Error: KEY_EXPORT_UNAVAILABLE$/);
    assert.equal(f.disk.failureWrites, before.failure + 1);
    assert.equal(f.disk.successWrites, before.success + 1, 'valid PIN was verified before the SDK export failed');
    assert.equal(f.authority.getSnapshot().phase, 'locked', 'an untrusted SDK export failure still retires custody');
  } finally { flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('reveal refusals keep the real public SDK session and allow a fresh PIN attempt', async () => {
  const prompt = credentialPrompt(), f = await readyAccounts(undefined, undefined, prompt.broker.request);
  const backup = new SeedBackupFlow(f.authority, () => f.runtime.backup);
  const keys = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!));
  try {
    const state = f.authority.getSnapshot(), catalogue = f.authority.getCatalogue();
    await assert.rejects(backup.begin('000000'), /INVALID_CREDENTIAL/);
    const pending = keys.begin();
    await eventually(() => !!prompt.current && !prompt.current.busy);
    prompt.current!.confirm({ method: 'pin', pin: '000000' });
    await eventually(() => !!prompt.current?.error && !prompt.current.busy);
    assert.equal(f.authority.getSnapshot(), state);
    assert.equal(f.authority.getCatalogue(), catalogue);
    assert.equal(await f.runtime.session.readSelectedAddress(), state.account!.address);
    prompt.current!.confirm({ method: 'pin', pin: PASSWORD });
    assert.match((await pending).privateKey, /^0x[0-9a-f]{64}$/);
    const shown = await backup.begin(PASSWORD);
    assert.equal(shown.words.join(' '), PHRASE);
    backup.cancel();
  } finally { prompt.detach(); backup.dispose(); keys.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key reveal shares unlock throttle and counts wrong authentication after cancellation', async () => {
  const sdk = await raceSdk(), prompt = credentialPrompt(), f = await readyAccounts(sdk.loadSdk, undefined, prompt.broker.request), flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!));
  const hold = f.disk.holdPinRead(), before = f.disk.failureWrites;
  try {
    const pending = flow.begin(); void pending.catch(() => undefined);
    await eventually(() => !!prompt.current && !prompt.current.busy);
    prompt.current!.confirm({ method: 'pin', pin: '000000' });
    await hold.started; f.authority.lock(); hold.finish(); await assert.rejects(pending, /CANCELLED/);
    await eventually(() => f.disk.failureWrites === before + 1);
    assert.equal(f.disk.failureWrites, before + 1); assert.equal(f.disk.failures, 1); assert.equal(sdk.exports, 0);
    for (let attempt = 0; attempt < 4; attempt++) await assert.rejects(f.authority.unlock('000000'), /INVALID_CREDENTIAL/);
    assert.equal(f.disk.failures, 5); await assert.rejects(f.authority.unlock(PASSWORD), /AUTH_THROTTLED/);
    assert.equal(f.disk.failureWrites, before + 5); await assert.rejects(flow.begin(), /KEY_EXPORT_UNAVAILABLE/);
    assert.equal(sdk.exports, 0);
  } finally { hold.finish(); prompt.detach(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

for (const phase of ['password', 'credential-read', 'export-before', 'export-after']) {
  test(`HD key reveal revokes at ${phase} and serializes other privileged operations`, async () => {
    const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!));
    const credential = phase === 'credential-read' ? f.disk.holdPinRead() : null;
    const hold = credential ? { entered: credential.started, release: credential.finish } : sdk.hold(phase);
    try {
      const pending = flow.begin(); void pending.catch(() => undefined); await hold.entered;
      await assert.rejects(flow.begin(), /BUSY/);
      await assert.rejects(f.runtime.backup.readPhrase(PASSWORD), /BUSY/);
      assert.throws(() => f.runtime.transfers!.assertUnlocked(() => undefined), /BUSY/);
      await assert.rejects(signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: ADDRESS,
        to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1',
        gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal }), /BUSY/);
      await assert.rejects(f.execute({ kind: 'create', label: 'Must not start',}), /BUSY/);
      f.authority.lock(); await assert.rejects(f.authority.unlock(PASSWORD), /OPERATION_FAILED|BUSY/);
      hold.release(); await assert.rejects(pending, /CANCELLED/);
      assert.equal(f.authority.getSnapshot().account, null); await f.authority.unlock(PASSWORD);
      const shown = await flow.begin(); assert.equal(shown.address, ADDRESS);
      assert.equal(sdk.exports, phase.startsWith('export') ? 2 : 1);
    } finally { hold.release(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
  });
}

test('HD key presentation expires on network/account A-B-A, reentrant clear and disposal', async () => {
  const f = await readyAccounts(), flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!)), attempts: Promise<unknown>[] = [];
  const unsubscribe = flow.onClear(() => attempts.push(flow.begin().catch((error: Error) => error.message)));
  try {
    const first = await flow.begin(); assert.deepEqual(await Promise.all(attempts), ['BUSY']); unsubscribe();
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    assert.equal(flow.isCurrent(first.id), false);
    await f.execute({ kind: 'create', label: 'Second',}); const second = await flow.begin();
    await f.execute({ kind: 'select', id: 'hd:60:0' }); await f.execute({ kind: 'select', id: 'hd:60:1' }); assert.equal(flow.isCurrent(second.id), false);
    const last = await flow.begin(); flow.dispose(); assert.equal(flow.isCurrent(last.id), false);
    await assert.rejects(flow.begin(), /KEY_EXPORT_EXPIRED/);
  } finally { unsubscribe(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key runtime refuses unconfirmed backup without mutating stored records', async () => {
  const disk = memoryDisk(); disk.denyNetwork(); const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD); const c = runtime.catalogue.getSnapshot()!, before = JSON.stringify([...disk.records]);
    await assert.rejects(readTestSelectedKey(runtime, { authorityRevision: 0, catalogueRevision: c.revision,
      accountId: 'hd:60:0', index: 0, address: ADDRESS, networkId: 'ethereum', registrationHash: getNativeNetwork('ethereum').registrationHash }, () => undefined), /NOT_READY/);
    assert.equal(JSON.stringify([...disk.records]), before);
    assert.deepEqual(await runtime.storage.readState(), { presence: 'existing', backup: 'unconfirmed' });
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});

for (const code of ['INVALID_CREDENTIAL', 'AUTH_THROTTLED', 'DEVICE_UNLOCK_UNAVAILABLE'] as const)
  test(`HD key export reflects runtime retirement for an unbranded ${code} SDK failure`, async () => {
    const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
    const flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!));
    try {
      sdk.setExportError(new KeyringRuntimeError(code));
      await assert.rejects(flow.begin(), /KEY_EXPORT_UNAVAILABLE/);
      assert.equal(f.runtime.catalogue.getSnapshot(), null);
      assert.equal(f.authority.getSnapshot().phase, 'locked');
    } finally { flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
  });

test('HD key flow rejects a completed runtime result after authority A-B-A before publication', async () => {
  const f = await readyAccounts(); const entered = deferredAccount(), release = deferredAccount();
  const port = { isAuthenticationRefusal: f.runtime.keyExport!.isAuthenticationRefusal, async readSelected(...args: Parameters<NonNullable<KeyringRuntime['keyExport']>['readSelected']>) {
    const key = await f.runtime.keyExport!.readSelected(...args); entered.resolve(); await release.promise; return key;
  } };
  const flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(port));
  try {
    const pending = flow.begin(); void pending.catch(() => undefined); await entered.promise;
    f.authority.lock(); await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getSnapshot().account!.address, ADDRESS);
    release.resolve(); await assert.rejects(pending, /CANCELLED/);
    assert.equal(f.authority.getSnapshot().phase, 'ready', 'an obsolete export cannot lock the newly authenticated context');
  } finally { release.resolve(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key flow disposal retires an in-flight read and reentrant clear cannot authenticate', async () => {
  const f = await readyAccounts(), sdkEntered = deferredAccount(), release = deferredAccount();
  let reads = 0;
  const port = { isAuthenticationRefusal: f.runtime.keyExport!.isAuthenticationRefusal, async readSelected(...args: Parameters<NonNullable<KeyringRuntime['keyExport']>['readSelected']>) {
    reads++; const key = await f.runtime.keyExport!.readSelected(...args); sdkEntered.resolve(); await release.promise; return key;
  } };
  const flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(port)), attempts: Promise<unknown>[] = [];
  const off = flow.onClear(() => attempts.push(flow.begin().catch((error: Error) => error.message)));
  try {
    const pending = flow.begin(); void pending.catch(() => undefined); await sdkEntered.promise;
    flow.dispose(); release.resolve(); await assert.rejects(pending, /CANCELLED/);
    assert.equal(reads, 1); assert.equal(f.authority.getSnapshot().phase, 'ready', 'disposed flow cannot lock a live context after its runtime read drained');
    assert.ok((await Promise.all(attempts)).every((result) => result === 'BUSY' || result === 'KEY_EXPORT_EXPIRED'));
  } finally { release.resolve(); off(); flow.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('obsolete export failure cannot revoke a replacement flow started by a clear observer', async () => {
  const f = await readyAccounts(), entered = deferredAccount(), release = deferredAccount();
  const replacement = { isAuthenticationRefusal: f.runtime.keyExport!.isAuthenticationRefusal, readSelected: (...args: Parameters<NonNullable<KeyringRuntime['keyExport']>['readSelected']>) => f.runtime.keyExport!.readSelected(...args) };
  let currentPort = { isAuthenticationRefusal: f.runtime.keyExport!.isAuthenticationRefusal, async readSelected(...args: Parameters<NonNullable<KeyringRuntime['keyExport']>['readSelected']>): Promise<string> {
    await f.runtime.keyExport!.readSelected(...args); entered.resolve(); await release.promise;
    throw new Error(PASSWORD);
  } };
  const old = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(currentPort)), next = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(currentPort));
  let replacementRead: Promise<Awaited<ReturnType<HdKeyExportFlow['begin']>>> | undefined;
  let off = () => {};
  try {
    const pending = old.begin(); void pending.catch(() => undefined); await entered.promise;
    off = old.onClear(() => { off(); currentPort = replacement; replacementRead = next.begin(); });
    release.resolve(); await assert.rejects(pending, /^Error: KEY_EXPORT_UNAVAILABLE$/);
    const shown = await replacementRead!;
    assert.equal(shown.address, ADDRESS); assert.equal(next.isCurrent(shown.id), true);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally { release.resolve(); off(); old.dispose(); next.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('HD key flow is unavailable before backup, while locked, and on the web host', async () => {
  const disk = memoryDisk(); disk.denyNetwork(); let runtime!: KeyringRuntime, portReads = 0;
  const authority = new NativeCustodyAuthority({ async open() { runtime = await disk.factory.open() as KeyringRuntime; return runtime; } });
  const flow = new HdKeyExportFlow(authority, () => { portReads++; return runtime.keyExport && testHdKeyExportRuntime(runtime.keyExport); });
  try {
    await authority.initialize(); await authority.importPhrase(PHRASE, PASSWORD);
    assert.equal(authority.getSnapshot().phase, 'backup-required');
    await assert.rejects(flow.begin(), /KEY_EXPORT_UNAVAILABLE/);
    assert.equal(authority.getSnapshot().phase, 'backup-required'); assert.equal(portReads, 0);
    authority.lock(); await assert.rejects(flow.begin(), /KEY_EXPORT_UNAVAILABLE/);
    assert.equal(authority.getSnapshot().phase, 'locked'); assert.equal(portReads, 0);
    const web = await import('../src/platform/nativeFactory.web.ts');
    assert.throws(() => web.createNativeWalletControllers(), /unavailable on web/);
    assert.throws(() => web.createNativeCustodyAuthority(), /unavailable on web/);
  } finally { flow.dispose(); await authority.dispose(); disk.restoreNetwork(); }
});

const IMPORTED_TEST_KEY = '0x' + '1'.padStart(64, '0');
const importedAddress = (key = IMPORTED_TEST_KEY) => new Wallet(key).address;
async function importTestKey(f: Awaited<ReturnType<typeof readyAccounts>>, key = IMPORTED_TEST_KEY, label = 'Imported test') {
  await f.authority.importAccount({ privateKey: key, expectedAddress: importedAddress(key), label }, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
}

test('installed SDK imported accounts persist AEAD, cold-reopen and sign/export at a nonzero host ordinal', async () => {
  const f = await readyAccounts();
  try {
    const pair = JSON.stringify([f.disk.records.get('vault'), f.disk.records.get('vault-keys')]);
    await importTestKey(f);
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'imported:60:0');
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'imported:60:0',});
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
      await f.authority.selectNetwork(network, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
      const tx = { type: 2 as const, accessList: [], from: importedAddress(), to: ADDRESS, chainId: getNativeNetwork(network).chainId,
        nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' };
      const signed = await signTestTransfer(f.runtime.transfers!, tx, { assertCurrent: () => undefined, signal: new AbortController().signal });
      assert.equal(Transaction.from(signed.rawTransaction).from, importedAddress());
      await (await f.runtime.transfers!.journal(() => undefined)).saveSigned(signed.rawTransaction);
    }
    const flow = new HdKeyExportFlow(f.authority, () => testHdKeyExportRuntime(f.runtime.keyExport!));
    assert.equal((await flow.begin()).privateKey, IMPORTED_TEST_KEY); flow.dispose();
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
    await f.execute({ kind: 'remove', id: 'imported:60:0',});
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
      const flow: HdKeyExportFlow = new HdKeyExportFlow(reopened, () => runtime.keyExport && testHdKeyExportRuntime(runtime.keyExport));
      try { assert.equal((await flow.begin()).privateKey, key); } finally { flow.dispose(); }
      const signed = await signTestTransfer(runtime.transfers!, { type: 2, accessList: [], from: importedAddress(key), to: ADDRESS,
        chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal });
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
      await assert.rejects(f.authority.importAccount(request, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined)), /INVALID_INPUT/);
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
      await assert.rejects(f.authority.importAccount({ privateKey: otherKey, expectedAddress: importedAddress(otherKey), label: 'Other' }, f.authority.getSnapshot().revision, 0, new AbortController().signal, createTestPrivateAuthentication(() => undefined)), /BUSY/);
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
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), hold = f.disk.holdPinRead();
  const before = f.disk.failureWrites;
  try {
    const pending = f.authority.importAccount({ privateKey: IMPORTED_TEST_KEY, label: 'Import', expectedAddress: importedAddress() }, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined)); void pending.catch(() => undefined);
    await Promise.race([hold.started, pending]); f.authority.lock(); hold.finish(); await assert.rejects(pending, /CANCELLED/);
    assert.equal(f.disk.failureWrites, before + 1); assert.equal(sdk.imports, 0);
    for (let i = 0; i < 4; i++) await assert.rejects(f.authority.unlock('000000'), /INVALID_CREDENTIAL/);
    await assert.rejects(f.authority.unlock(PASSWORD), /AUTH_THROTTLED/); assert.equal(f.disk.failureWrites, before + 5);
  } finally { hold.finish(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});

test('imported account public restore decrypts no signing keys and stops at a revoked PIN read', { timeout: 10000 }, async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    await importTestKey(f); await importTestKey(f, '0x' + '2'.padStart(64, '0'));
    f.authority.lock(); const before = sdk.unlocks;
    await f.authority.unlock(PASSWORD); assert.equal(sdk.unlocks - before, 0);
    assert.equal(sdk.exports, 0, 'complete encrypted SDK maps avoid per-account key exports');
    const importedBefore = sdk.imports;
    f.authority.lock(); const held = f.disk.holdPinRead();
    const pending = f.authority.unlock(PASSWORD); void pending.catch(() => undefined); await held.started;
    f.authority.lock(); held.finish(); await assert.rejects(pending, /CANCELLED/);
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
    const rawFor = async (address: string, chainId: string) => signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: address,
      to: ADDRESS, chainId, nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal });
    const hd = await rawFor(ADDRESS, '1'); await (await f.runtime.transfers!.journal(() => undefined)).saveSigned(hd.rawTransaction);
    const hdHash = hd.hash;
    await importTestKey(f);
    const first = await rawFor(importedAddress(), '1'); let journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(first.rawTransaction); await journal.transition(first.hash, 'nonce-consumed');
    await f.authority.selectNetwork('syscoin-nevm-testnet', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => {});
    const second = await rawFor(importedAddress(), '5700'); journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(second.rawTransaction);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await assert.rejects(f.execute({ kind: 'remove', id: 'imported:60:0',}), /PENDING_TRANSFER/);
    await f.authority.unlock(PASSWORD); await f.execute({ kind: 'select', id: 'imported:60:0' });
    journal = await f.runtime.transfers!.journal(() => undefined); await journal.transition(second.hash, 'nonce-consumed');
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'imported:60:0',});
    assert.equal(f.disk.records.has('native-evm-transfer-v1:imported:60:0'), false);
    await f.authority.selectNetwork('ethereum',f.authority.getSnapshot().revision,f.authority.getCatalogue()!.revision, () => {});
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
    await first.confirm(review, { method: 'pin', pin: PASSWORD });
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
    await retry.confirm(retryReview.id, { method: 'pin', pin: PASSWORD });
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
    const signing = signTestTransfer(f.runtime.transfers!, transaction, { assertCurrent: () => undefined, signal: new AbortController().signal });
    transaction.to = '0x2222222222222222222222222222222222222222';
    transaction.value = '999'; transaction.nonce = '8';
    const decoded = Transaction.from((await signing).rawTransaction);
    assert.equal(decoded.to, '0x1111111111111111111111111111111111111111');
    assert.equal(decoded.value, 123n); assert.equal(decoded.nonce, 0);
    assert.deepEqual([sdk.unlocks, sdk.hydrations, f.disk.successWrites, f.disk.failureWrites],
      [before[0]! + 1, before[1], before[2]! + 1, before[3]! + 1]);
  } finally { await f.authority.dispose(); f.disk.restoreNetwork(); }
});

for (const boundary of ['queued', 'sdk-guard'] as const) {
  test(`lock at the ${boundary} boundary cannot return an approved signature from the old SDK session`, async () => {
    const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
    let signatures = 0;
    try {
      const before = [sdk.unlocks, sdk.hydrations];
      sdk.onSign(() => { signatures++; if (boundary === 'sdk-guard') f.authority.lock(); });
      const signing = signTestTransfer(f.runtime.transfers!, { type: 2, accessList: [], from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '123', gasLimit: '21000', data: '0x', maxFeePerGas: '3', maxPriorityFeePerGas: '1' }, { assertCurrent: () => undefined, signal: new AbortController().signal });
      if (boundary === 'queued') f.authority.lock();
      await assert.rejects(signing, /CANCELLED/);
      assert.equal(signatures, boundary === 'queued' ? 0 : 1);
      assert.equal(f.authority.getSnapshot().phase, 'locked');
      await assert.rejects(f.runtime.session.readSelectedAddress(), /NOT_READY/);
      assert.equal(f.disk.records.has('native-evm-transfer-v1'), false);
      assert.deepEqual([sdk.unlocks, sdk.hydrations], [before[0]! + (boundary === 'sdk-guard' ? 1 : 0), before[1]]);
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
    await assert.rejects(transfers.confirm(firstReview, { method: 'pin', pin: PASSWORD }), /EXPIRED/);
    const secondReview = await prepareAccountTransfer(transfers);
    await f.execute({ kind: 'create', label: 'Selected account',});
    await assert.rejects(transfers.confirm(secondReview, { method: 'pin', pin: PASSWORD }), /EXPIRED/);
    assert.equal(signatures, 0); assert.equal(network.broadcasts.length, 0);
    const selected = f.authority.getSnapshot().account!.address;
    const before = [sdk.unlocks, sdk.hydrations];
    await transfers.confirm(await prepareAccountTransfer(transfers), { method: 'pin', pin: PASSWORD });
    assert.equal(Transaction.from(network.broadcasts[0]!).from, selected);
    assert.deepEqual([sdk.unlocks, sdk.hydrations], [before[0]! + 1, before[1]]);
  } finally { transfers.dispose(); await f.authority.dispose(); f.disk.restoreNetwork(); }
});


test('idle policy reauthentication uses the real shared throttle and counts rejection after idle expiry', async () => {
  const controlled = await controlledSdk(); let active = true;
  const disk = memoryDisk(controlled.loadSdk, () => { if (!active) throw Error('CANCELLED'); }); disk.denyNetwork();
  const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const before = disk.failureWrites;
    const hold = disk.holdPinRead(), pending = runtime.security!.reauthenticateIdlePolicy('000000', () => undefined);
    await Promise.race([hold.started, pending.then(() => { throw Error('PIN check completed before credential read'); })]); active = false; hold.finish();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(disk.failureWrites, before + 1); assert.equal(disk.failures, 1);
    active = true; await runtime.session.unlock(PASSWORD);
    await runtime.security!.reauthenticateIdlePolicy(PASSWORD, () => undefined);
    assert.equal(disk.failures, 0);
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});

test('creation and import reject malformed PINs before the SDK creates a seed vault', async () => {
  const disk = memoryDisk();
  const runtime = await disk.factory.open();
  try {
    for (const password of ['12345', '1234567', '12a456', '١٢٣٤٥٦']) {
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
    await f.execute({ kind: 'create', label: 'First extra',});
    const first = f.authority.getCatalogue()!.accounts.find((account) => account.id === 'hd:60:1')!;
    await f.execute({ kind: 'create', label: 'Retained extra',});
    const retained = f.authority.getCatalogue()!.accounts.find((account) => account.id === 'hd:60:2')!;
    await importTestKey(f);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'imported:60:0',});
    await importTestKey(f, '0x' + '2'.padStart(64, '0'), 'Retained imported');
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: 'hd:60:1',});
    const before = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY)) as NativeAccountRecord;
    await f.execute({ kind: 'create', label: 'Gap replacement',});
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
    const pending = f.execute({ kind: 'create', label: 'Cancelled',}); void pending.catch(() => undefined);
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
    await assert.rejects(f.execute({ kind: 'create', label: 'Rejected',}), /CANCELLED/);
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
    await assert.rejects(transfers.confirm(review, { method: 'pin', pin: PASSWORD }), /EXPIRED/);
    assert.equal(network.broadcasts.length, 0);
    f.disk.onRecord();
    const saved = await (await f.runtime.transfers!.journal(() => undefined)).load();
    assert.equal(saved!.phase, 'signed');
    assert.equal(Transaction.from(saved!.rawTransaction).hash, saved!.hash);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    await transfers.recover(true);
    const retry = transfers.getSnapshot().review!;
    assert.equal(retry.retry, true);
    await transfers.confirm(retry.id, { method: 'pin', pin: PASSWORD });
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
    await transfers.confirm(await prepareAccountTransfer(transfers), { method: 'pin', pin: PASSWORD });
    network.include();await transfers.recover();
    assert.equal(transfers.getSnapshot().phase,'confirmed');
    await transfers.confirm(await prepareAccountTransfer(transfers), { method: 'pin', pin: PASSWORD });
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


test('connection transactions use real SDK signing and durable shared submission for calls, creation and nonce queueing', async () => {
  const { inspectEvmSignedBundle } = await import('../../../source/wallet/evmSignedRecords.ts');
  const { evmSubmissionFailure } = await import('@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js');
  const submitted: string[] = [];
  const reported: string[] = [];
  let loseResponse = false, pendingNonce = '0x0';
  let assertBundleAdmission: ((hash: string) => Promise<void>) | undefined;
  let f!: Awaited<ReturnType<typeof readyAccounts>>;
  const fetch: NonNullable<KeyringRuntimeDependencies['connectionFetch']> = async (_url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body));
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getTransactionCount') result = params[1] === 'pending' ? pendingNonce : '0x0';
    else if (method === 'eth_getBalance') result = '0x10000000000000000';
    else if (method === 'eth_getBlockByNumber') result = { number: params[0] === 'latest' ? '0x10' : params[0], hash: `0x${'aa'.repeat(32)}`, gasLimit: '0x1c9c380', baseFeePerGas: '0x1' };
    else if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') result = '0x2';
    else if (method === 'eth_estimateGas') result = '0x10000';
    else if (method === 'eth_getTransactionByHash') {
      const raw = submitted.find(value => keccak256(value) === params[0]);
      const tx = raw && Transaction.from(raw);
      result = tx ? { hash: tx.hash, from: tx.from, nonce: `0x${tx.nonce.toString(16)}`, blockHash: null, blockNumber: null, transactionIndex: null } : null;
    } else if (method === 'eth_sendRawTransaction') {
      const raw = params[0] as string, hash = keccak256(raw);
      await assertBundleAdmission?.(hash);
      assert.equal(reported.at(-1), hash, 'controller learns irreversible dispatch before POST');
      const identity = f.disk.fixtureIdentity()!;
      assert(identity.root);
      assert.equal(inspectEvmSignedBundle(f.disk.signedValue()!, identity.root.profileId).transactions, submitted.length + 1);
      assert.equal(f.disk.signedValue()!.includes(raw), false, 'the shared journal encrypts raw transaction bytes');
      submitted.push(raw);
      if (loseResponse) throw new Error('lost response after POST');
      result = hash;
    } else throw new Error(`Unexpected method ${method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  };
  f = await readyAccounts(undefined, fetch);
  try {
    const host = await f.runtime.openConnectionHost();
    const submit = async (transaction: object, submission: import('../../../source/shared/evmDappReview.ts').EvmDappSubmission = { kind: 'transaction' }) => {
      const message = readDappMessageRequest('personal_sign', ['0x6162', ADDRESS], ADDRESS)!;
      const { request: _message, ...scope } = approveRuntimeMessage(f, host, message);
      try {
        const review = await host.prepareTransaction({ ...scope, transaction }, () => undefined);
        assert(!('operation' in review));
        const hash = await review.submit(() => undefined, value => { reported.push(value); }, submission);
        await assert.rejects(review.submit(() => undefined, () => undefined, { kind: 'transaction' }), /REVIEW_REQUIRED/);
        return hash;
      } finally { scope.approval.dispose(); }
    };
    await submit({ from: ADDRESS, to: `0x${'22'.repeat(20)}`, data: '0x6000' });
    await submit({ from: ADDRESS, to: null, data: '0x60006000', accessList: [{ address: `0x${'33'.repeat(20)}`, storageKeys: [`0x${'44'.repeat(32)}`] }] });
    assert.deepEqual(submitted.map(raw => Transaction.from(raw).nonce), [0, 1], 'shared acknowledgement advances the automatic nonce despite a lagging RPC');
    assert.equal(Transaction.from(submitted[1]!).to, null);
    assert.equal(Transaction.from(submitted[1]!).accessList?.[0]?.storageKeys[0], `0x${'44'.repeat(32)}`);
    const message = readDappMessageRequest('personal_sign', ['0x6162', ADDRESS], ADDRESS)!;
    const { request: _message, ...scope } = approveRuntimeMessage(f, host, message);
    const revoked = await host.prepareTransaction({ ...scope, transaction: { from: ADDRESS, to: `0x${'55'.repeat(20)}`, data: '0x6000' } }, () => undefined);
    assert(!('operation' in revoked));
    f.authority.lock();
    await assert.rejects(revoked.submit(() => undefined, () => assert.fail('Revoked review cannot dispatch'), { kind: 'transaction' }));
    assert.equal(submitted.length, 2);
    scope.approval.dispose();
    await f.authority.unlock(PASSWORD);
    const origin = 'https://app.example', bundleId = host.calls.generateWalletBundleId(), reservationId = 'reservation', submissionId = 'submission';
    await host.calls.reserveSendCallsBundle(origin, bundleId, { atomic: false, smartAccount: false, chainId: 1 }, reservationId, ADDRESS);
    await host.calls.recordSendCallsBundle(origin, bundleId, { atomic: false, smartAccount: false, chainId: 1,
      reservationId, submissionId, submissionStarted: true, txHashes: [] });
    assertBundleAdmission = async (hash) => {
      const bundle = await host.calls.getStoredSendCallsBundle(origin, bundleId);
      assert.deepEqual(bundle?.txHashes, [hash], 'the normal keyring path associates the canonical hash before POST');
      assert.equal(bundle?.stoppedTransactionHash, undefined, 'wire admission does not retire live consent');
    };
    await submit({ from: ADDRESS, to: `0x${'55'.repeat(20)}`, data: '0x6000' }, { kind: 'eoa-calls',
      attempt: { origin, bundleId, reservationId, submissionId, failed: false } });
    assertBundleAdmission = undefined;
    loseResponse = true; pendingNonce = '0x6';
    await assert.rejects(submit({ from: ADDRESS, to: `0x${'55'.repeat(20)}`, nonce: '0x4', data: '0x6000' }), error => {
      const failure = evmSubmissionFailure(error);
      assert.equal(failure?.transactionNotBroadcast, false);
      assert.equal(failure?.signedTransactionHash, keccak256(submitted[3]!));
      return true;
    });
    assert.deepEqual(submitted.map(raw => Transaction.from(raw).nonce), [0, 1, 2, 4]);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


for (const outcome of ['sign', 'reject', 'transaction-sign', 'transaction-reject', 'lock'] as const) test(`connection account selection publishes real authority context before ${outcome}`, async () => {
  const submitted: string[] = [];
  const connectionFetch: NonNullable<KeyringRuntimeDependencies['connectionFetch']> = async (_url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body));
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getTransactionCount') result = '0x0';
    else if (method === 'eth_getBalance') result = '0x10000000000000000';
    else if (method === 'eth_getBlockByNumber') result = { number: params[0] === 'latest' ? '0x10' : params[0], hash: `0x${'aa'.repeat(32)}`, gasLimit: '0x1c9c380', baseFeePerGas: '0x1' };
    else if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') result = '0x2';
    else if (method === 'eth_estimateGas') result = '0x10000';
    else if (method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt') result = null;
    else if (method === 'eth_sendRawTransaction') { submitted.push(params[0]); result = keccak256(params[0]); }
    else throw Error(`Unexpected method ${method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  };
  const f = await readyAccounts(undefined, connectionFetch);
  const transaction = outcome.startsWith('transaction');
  let controller: NativeConnectionsController | undefined;
  let unsubscribe: () => void = () => undefined;
  try {
    await f.execute({ kind: 'create', label: 'Other account',});
    const previous = f.authority.getSnapshot().account!.address;
    assert.notEqual(previous, ADDRESS);
    const host = await f.runtime.openConnectionHost();
    const { origin } = await grantConnection(host, 0, 'e');
    const session: WalletConnectSession = {
      binding: { origin, peerPublicKey: 'e'.repeat(64), topic: 'e'.repeat(64) },
      metadata: { name: 'Authorized app', description: '', url: origin, icons: [] },
      expiry: Math.floor(Date.now() / 1000) + 3600,
      namespaces: { eip155: { accounts: [`eip155:1:${ADDRESS}`], chains: ['eip155:1'], methods: ['personal_sign', 'eth_sendTransaction'], events: [] } },
    };
    let event!: (value: WalletConnectTransportEvent) => void;
    const responses: WalletConnectResponse[] = [];
    controller = new NativeConnectionsController({
      async openExternalUrl() { throw Error('Website returns are outside this fixture'); },
      source: f.authority,
      activateAccount: (id, revision, guard) => f.authority.selectConnectionAccount(id, revision, guard),
      openHost: async () => signingFixtureHost(host),
      preparePlatform: async () => undefined,
      projectId: 'public-authority-fixture',
      metadata: { name: 'Pali', description: '', url: 'https://paliwallet.com', icons: [] },
      checkSite: async () => ({ isBlacklisted: false }),
      checkAddress: async () => ({ isBlacklisted: false, severity: 'low' }),
      async openTransport(options) {
        event = options.onEvent;
        return {
          async updatePreparedAccount() { throw Error('Smart creation is outside this fixture'); },
          async pending() { return null; },
          async sessions() { return [session]; },
          async pair() { throw Error('Unexpected pair'); },
          async approve() { throw Error('Unexpected approval'); },
          async reject() {}, async disconnect() {}, async close() {},
          async emit(_binding, _chain, _value, guard) { guard(); },
          async respond(_binding, _id, value, guard, onDispatch) { guard(); onDispatch(); responses.push(value); },
        };
      },
    });
    for (let i = 0; i < 20 && !controller.view.getSnapshot().sessions.length; i++) await new Promise<void>(resolve => setImmediate(resolve));
    event({ type: 'request', request: { freshness: 'fresh', id: 42, expiresAt: Date.now() + 60000, session, chainId: 'eip155:1', method: transaction ? 'eth_sendTransaction' : 'personal_sign', params: transaction ? [{ from: ADDRESS, to: `0x${'22'.repeat(20)}`, value: '0x1' }] : ['Hello', ADDRESS], verification: { validation: 'VALID', isScam: false } } });
    for (let i = 0; i < 20 && controller.view.getSnapshot().signingReview?.busy !== false; i++) await new Promise<void>(resolve => setImmediate(resolve));
    const review = controller.view.getSnapshot().signingReview;
    assert(review?.needsAccountSwitch);
    const published: string[] = [];
    unsubscribe = f.authority.subscribe(snapshot => {
      if (snapshot.account) published.push(snapshot.account.address);
      if (outcome === 'lock' && snapshot.phase === 'authenticating') f.authority.lock();
    });
    const switching = controller.view.activateRequestAccount(review.id, review.revision);
    if (outcome === 'lock') {
      await assert.rejects(switching);
      assert.equal(controller.view.getSnapshot().signingReview, null);
      assert.equal(f.authority.getSnapshot().account, null);
      assert.equal(f.authority.getSnapshot().phase, 'locked');
      unsubscribe();
      await f.authority.unlock(PASSWORD);
      assert.equal(f.authority.getSnapshot().account!.address, previous);
      assert.equal(responses.some(response => 'result' in response), false);
      return;
    }
    await switching;
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.authority.getSnapshot().account!.address, ADDRESS);
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'hd:60:0');
    assert.equal(host.context().activeAccountId, 'hd:60:0');
    assert.equal(published.at(-1), ADDRESS);
    const switched = controller.view.getSnapshot().signingReview;
    assert(switched && !switched.needsAccountSwitch);
    if (outcome === 'sign' || outcome === 'transaction-sign') {
      await controller.view.approveRequest(switched.id, switched.revision, false);
      const reply = responses.find(response => 'result' in response);
      assert(reply && 'result' in reply);
      if (transaction) {
        assert.equal(reply.result, keccak256(submitted[0]!));
        assert.equal(Transaction.from(submitted[0]!).from, ADDRESS);
      } else assert.equal(recoverPersonalSignature({ data: '0x48656c6c6f', signature: String(reply.result) }).toLowerCase(), ADDRESS.toLowerCase());
    } else await controller.view.rejectRequest(switched.id);
    assert.equal(controller.view.getSnapshot().signingReview, null);
    assert.equal(f.authority.getSnapshot().account!.address, ADDRESS);
    assert.equal(f.authority.getCatalogue()!.active.accountId, 'hd:60:0');
  } finally {
    unsubscribe();
    await controller?.dispose();
    await f.authority.dispose();
    f.disk.restoreNetwork();
  }
});

function trezorFixtureSessions() {
  type Sessions = NonNullable<KeyringRuntimeDependencies['trezorSessions']>;
  let generation = 0;
  let state: ReturnType<Sessions['getSnapshot']> = null;
  const listeners = new Set<() => void>();
  const paths: string[] = [];
  let beforeAddress: (() => Promise<void>) | undefined;
  let beforeRetirement: (() => Promise<void>) | undefined;
  let beforeCancellation: (() => Promise<void>) | undefined;
  let beforeSignature: (() => Promise<void>) | undefined;
  let signatures = 0, cancellations = 0, finishes = 0;
  let inAddress = false;
  const publish = () => { for (const listener of listeners) listener(); };
  const sessions: Sessions = {
    advanceSessionGeneration: () => ++generation,
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    receiveCallback: () => false,
    async cancel() { cancellations++; state = null; publish(); await beforeCancellation?.(); },
    async dispose() { state = null; publish(); },
    start(request) {
      assert.equal(request.sessionGeneration, generation);
      request.assertCurrent();
      const job = {} as NonNullable<typeof state>['job'];
      state = { job, owner: request.owner, workflow: request.workflow, phase: 'active', expiresAt: request.expiresAt, completedSteps: 0 };
      publish();
      return open(request.assertCurrent, job);
    },
    resume(request) {
      assert.equal(request.accepted, true);
      assert.equal(request.sessionGeneration, generation);
      assert.equal(request.job, state?.job);
      request.assertCurrent();
      return open(request.assertCurrent, request.job);
    },
  };
  function open(check: () => void, job: NonNullable<typeof state>['job']) {
    let live = true;
    const host = new Proxy<Record<string, unknown>>({
      async init(guard: () => void) { check(); guard(); },
      async dispose() { live = false; },
    }, {
      get(target, method: string) {
        if (method === 'then') return undefined;
        if (method in target) return target[method as keyof typeof target];
        return async (guard: () => void, request: { path: string; transaction?: Record<string, unknown>; message?: string; data?: Parameters<typeof signTypedData>[0]['data']; metamask_v4_compat?: boolean }) => {
          check(); guard(); assert(live);
          const path = request.path;
          paths.push(path);
          if (method === 'getAccountInfo') {
            const [{ getNetworkConfig }, { utils }] = await Promise.all([import('@sidhujag/sysweb3-network'), import('syscoinjs-lib')]);
            const [, , slip, index] = path.split('/');
            const slip44 = Number(slip!.replace("'", ''));
            const currency = slip44 === 57 ? 'sys' : 'btc';
            const config = getNetworkConfig(slip44, currency);
            const hd = new utils.HDSigner('test test test test test test test test test test test junk', null, slip44 === 1,
              config.networks, slip44, config.types.zPubType, 84);
            hd.createAccountAtIndex(Number(index!.replace("'", '')), 84);
            return { success: true, payload: { descriptor: hd.getAccountXpub(), balance: '0', empty: true, history: { total: 0, unconfirmed: 0 } } };
          }
          const wallet = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, path);
          if (method === 'ethereumGetAddress') {
            inAddress = true;
            await beforeAddress?.();
            inAddress = false;
            if (state?.job === job && state.phase === 'locked') { state = { ...state, phase: 'response-ready' }; publish(); }
            check(); guard();
            return { success: true, payload: { address: wallet.address } };
          }
          if (method === 'ethereumGetPublicKey')
            return { success: true, payload: { publicKey: wallet.publicKey.slice(2) } };
          if (method === 'ethereumSignMessage') {
            signatures++; await beforeSignature?.();
            return { success: true, payload: { address: wallet.address, signature: (await wallet.signMessage(getBytes('0x' + request.message!))).slice(2) } };
          }
          if (method === 'ethereumSignTypedData') {
            signatures++; await beforeSignature?.();
            return { success: true, payload: { address: wallet.address, signature: signTypedData({ privateKey: Buffer.from(wallet.privateKey.slice(2), 'hex'),
              data: request.data as import('@metamask/eth-sig-util').TypedMessage<import('@metamask/eth-sig-util').MessageTypes>, version: request.metamask_v4_compat ? SignTypedDataVersion.V4 : SignTypedDataVersion.V3 }) } };
          }
          if (method === 'ethereumSignTransaction') {
            signatures++; await beforeSignature?.();
            const tx = request.transaction!;
            const parsed = Transaction.from({ ...tx, type: tx.gasPrice === undefined ? 2 : 0 });
            const signature = wallet.signingKey.sign(parsed.unsignedHash);
            return { success: true, payload: { r: signature.r, s: signature.s, v: signature.v.toString(16) } };
          }
          throw new Error(`Unexpected Trezor method ${method}`);
        };
      },
    }) as unknown as import('@sidhujag/sysweb3-keyring/cjs/trezor/host-types.js').TrezorHost;
    return { job, host,
      async retire(retireSdk: () => Promise<void>) {
        live = false;
        if (state?.job === job) { state = { ...state, phase: inAddress ? 'locked' : 'response-ready' }; publish(); }
        await beforeRetirement?.();
        await retireSdk();
      },
      async finish() { check(); finishes++; state = null; live = false; publish(); },
      async cancel() { await sessions.cancel(job); },
    };
  }
  return { sessions, paths, signatures: () => signatures, cancellations: () => cancellations, finishes: () => finishes,
    holdSignature(hook: () => Promise<void>) { beforeSignature = hook; }, holdAddress(hook: () => Promise<void>) { beforeAddress = hook; },
    holdRetirement(hook: () => Promise<void>) { beforeRetirement = hook; },
    holdCancellation(hook: () => Promise<void>) { beforeCancellation = hook; } };
}

test('Trezor runtime uses shared allocation, preserves records on unlock and signs the exact reviewed envelope', async () => {
  const fixture = trezorFixtureSessions();
  const disk = memoryDisk(undefined, undefined, undefined, fixture.sessions);
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  try {
    const idle = runtime.trezor.getSnapshot();
    assert.equal(runtime.trezor.getSnapshot(), idle);
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    await runtime.trezor.startImport('Trezor one');
    await owner.manageAccounts({ kind: 'import-trezor', label: 'Trezor one' }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    assert.equal(owner.getCatalogue()!.active.accountId, 'trezor:60:0');
    await runtime.trezor.startImport('Trezor two');
    await owner.manageAccounts({ kind: 'import-trezor', label: 'Trezor two' }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    assert.equal(owner.getCatalogue()!.active.accountId, 'trezor:60:1');
    assert(fixture.paths.includes("m/44'/60'/0'/0/1"));
    const saved = owner.getCatalogue()!.accounts.find(account => account.id === 'trezor:60:1')!;
    assert(saved.address); assert(!JSON.stringify(saved).includes('xprv'));
    owner.lock(); await owner.unlock(PASSWORD);
    assert.equal(owner.getCatalogue()!.active.accountId, saved.id);
    const prepared = { type: 2 as const, accessList: [], from: saved.address, to: '0x' + '22'.repeat(20), chainId: '1',
      nonce: '9', value: '123', gasLimit: '25200', data: '0x', maxFeePerGas: '3', maxPriorityFeePerGas: '1' };
    const signed = await signTestTransfer(runtime.transfers!, prepared, { signal: new AbortController().signal, assertCurrent() {} });
    const parsed = Transaction.from(signed.rawTransaction);
    assert.equal(parsed.from, saved.address); assert.equal(parsed.nonce, 9); assert.equal(parsed.value, 123n);
    assert.equal(parsed.hash, signed.hash);
    assert.equal(runtime.trezor.getSnapshot(), runtime.trezor.getSnapshot());
    let broadcasts = 0;
    const rpc = new NativeTransferRpc({ networkId: 'ethereum', fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body));
      const result = await (async () => {
        switch (request.method) {
          case 'eth_chainId': return '0x1';
          case 'eth_getTransactionCount': return '0x0';
          case 'eth_getBalance': return '0x10000000000000000';
          case 'eth_gasPrice': return '0x2';
          case 'eth_feeHistory': return { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
          case 'eth_maxPriorityFeePerGas': return '0x1';
          case 'eth_estimateGas': return '0x5208';
          case 'eth_getTransactionByHash': case 'eth_getTransactionReceipt': return null;
          case 'eth_getBlockByNumber': return { number: '0x20', hash: '0x' + 'ab'.repeat(32), baseFeePerGas: '0x1', gasLimit: '0x1c9c380' };
          case 'eth_sendRawTransaction': {
            broadcasts++;
            const raw = request.params[0];
            const saved = await (await runtime.transfers!.journal(() => undefined)).load(keccak256(raw));
            assert(saved?.rawTransaction === raw);
            return keccak256(raw);
          }
          default: throw new Error('Unexpected test RPC ' + request.method);
        }
      })();
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
    } });
    const transfers = new NativeTransfers(owner, () => runtime.transfers, { rpc });
    try {
      await transfers.prepare('0x' + '22'.repeat(20), '0.001', '7');
      await transfers.confirm(transfers.getSnapshot().review!.id, { method: 'pin', pin: PASSWORD });
      assert.equal(transfers.getSnapshot().phase, 'pending');
      assert.equal(broadcasts, 1);
    } finally { transfers.dispose(); }
  } finally { await owner.dispose(); await fixture.sessions.dispose(); }
});

test('Trezor dapp host adopts only its owned SDK transfer and preserves signed bytes after a lost reply', async () => {
  const fixture = trezorFixtureSessions(), rpc = hardwareDappRpc();
  const disk = memoryDisk(undefined, undefined, rpc.fetch, fixture.sessions);
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  try {
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    await runtime.trezor.startImport('Trezor dapp');
    await owner.manageAccounts({ kind: 'import-trezor', label: 'Trezor dapp' }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    const host = await runtime.openConnectionHost(), account = host.context().accounts.find(value => value.id === host.context().activeAccountId)!;
    assert.equal(account.type, 'Trezor');
    const typed = { types: { EIP712Domain: [{ name: 'chainId', type: 'uint256' }], Message: [{ name: 'text', type: 'string' }] },
      primaryType: 'Message', domain: { chainId: 1 }, message: { text: 'Public Trezor dapp fixture' } };
    for (const method of ['personal_sign', 'eth_signTypedData_v3', 'eth_signTypedData_v4'] as const) {
      const request = readDappMessageRequest(method, method === 'personal_sign' ? ['0x6162', account.address] : [account.address, typed], account.address)!;
      const input = approveHardwareDappRequest(owner, host, request);
      try { assert.match(await host.signMessage({ ...input, handoff: nonSuiteSigningHandoff }), /^0x[0-9a-f]{130}$/i); }
      finally { input.approval.dispose(); }
      assert.equal(fixture.sessions.getSnapshot(), null, 'successful request finishes its exact device job');
      assert.equal(runtime.trezor.getSnapshot().phase, 'idle');
    }
    assert.equal(fixture.signatures(), 3);
    const request = readDappMessageRequest('personal_sign', ['0x6162', account.address], account.address)!;
    const input = approveHardwareDappRequest(owner, host, request);
    try {
      const review = await host.prepareTransaction({ handoff: nonSuiteSigningHandoff, ...input, transaction: { from: account.address,
        to: '0x' + '22'.repeat(20), data: '0x6000' } }, () => undefined);
      assert(!('operation' in review));
      assert.equal(fixture.signatures(), 3, 'review creates no device signature');
      rpc.onAdmission(async (hash, raw) => {
        const saved = await (await runtime.transfers!.journal(() => undefined)).load(hash);
        assert.equal(saved?.rawTransaction, raw, 'adopted SDK owner writes exact bytes before POST');
      });
      rpc.loseReply();
      await assert.rejects(review.submit(() => undefined, hash => { rpc.reports.push(hash); }, { kind: 'transaction' }));
      assert.equal(fixture.signatures(), 4); assert.equal(rpc.rawTransactions.length, 1);
      const raw = rpc.rawTransactions[0]!, transaction = Transaction.from(raw);
      assert.equal(transaction.from, account.address); assert.equal(transaction.chainId, 1n);
      assert.equal(transaction.data, '0x6000');
      assert.equal((await (await runtime.transfers!.journal(() => undefined)).load(keccak256(raw)))?.rawTransaction, raw);
      await assert.rejects(review.submit(() => undefined, () => assert.fail('cannot repeat retired review'), { kind: 'transaction' }), /REVIEW_REQUIRED/);
      assert.equal(fixture.signatures(), 4); assert.equal(rpc.rawTransactions.length, 1);
      assert.equal(fixture.sessions.getSnapshot(), null);
    } finally { input.approval.dispose(); }
  } finally { await owner.dispose(); await fixture.sessions.dispose(); disk.restoreNetwork(); }
});

test('retired Trezor dapp request drains its exact job without offering ordinary transfer resume', async () => {
  const fixture = trezorFixtureSessions(), rpc = hardwareDappRpc();
  const disk = memoryDisk(undefined, undefined, rpc.fetch, fixture.sessions);
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const cancelEntered = Promise.withResolvers<void>(), cancelRelease = Promise.withResolvers<void>();
  try {
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    await runtime.trezor.startImport('Trezor dapp');
    await owner.manageAccounts({ kind: 'import-trezor', label: 'Trezor dapp' }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    const host = await runtime.openConnectionHost(), account = host.context().accounts.find(value => value.id === host.context().activeAccountId)!;
    const request = readDappMessageRequest('personal_sign', ['0x6162', account.address], account.address)!;
    const input = approveHardwareDappRequest(owner, host, request);
    fixture.holdSignature(async () => { entered.resolve(); await release.promise; });
    fixture.holdCancellation(async () => { cancelEntered.resolve(); await cancelRelease.promise; });
    let settled = false;
    const work = host.signMessage({ ...input, handoff: nonSuiteSigningHandoff }).finally(() => { settled = true; });
    const rejected = assert.rejects(work);
    await entered.promise;
    input.approval.retire();
    await cancelEntered.promise;
    release.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'retired caller waits for terminal device drainage');
    cancelRelease.resolve(); await rejected;
    assert.equal(fixture.signatures(), 1); assert.equal(rpc.rawTransactions.length, 0);
    assert.equal(fixture.sessions.getSnapshot(), null);
    assert.notEqual(runtime.trezor.getSnapshot().phase, 'resume');
    input.approval.dispose();
  } finally { release.resolve(); cancelRelease.resolve(); await owner.dispose(); await fixture.sessions.dispose(); disk.restoreNetwork(); }
});

test('Trezor runtime keeps a stable waiting snapshot and cannot save an import after lock', async () => {
  const fixture = trezorFixtureSessions();
  const disk = memoryDisk(undefined, undefined, undefined, fixture.sessions);
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    fixture.holdAddress(async () => { entered(); await held; });
    const pending = runtime.trezor.startImport('Cancelled Trezor');
    void pending.catch(() => undefined);
    await started; owner.lock();
    const waiting = runtime.trezor.getSnapshot();
    assert.equal(waiting.phase, 'waiting');
    assert.equal(runtime.trezor.getSnapshot(), waiting);
    release(); await assert.rejects(pending, /CANCELLED|no longer current/);
    await owner.unlock(PASSWORD);
    assert(!owner.getCatalogue()!.accounts.some(account => account.type === 'Trezor'));
    assert.equal(runtime.trezor.getSnapshot().phase, 'resume');
  } finally { release(); await owner.dispose(); await fixture.sessions.dispose(); }
});

test('Trezor runtime cancellation before identity admission never opens a device session', async () => {
  const fixture = trezorFixtureSessions();
  const disk = memoryDisk(undefined, undefined, undefined, fixture.sessions);
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    disk.onIdentity(async () => { entered(); await held; });
    const pending = runtime.trezor.startImport('Cancelled before device');
    void pending.catch(() => undefined);
    await started; await runtime.trezor.cancel(); release();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(fixture.paths.length, 0);
    assert.equal(fixture.sessions.getSnapshot(), null);
  } finally { release(); await owner.dispose(); await fixture.sessions.dispose(); }
});

for (const failure of ['none', 'retirement', 'cancellation']) test(`Trezor runtime waits for zero-step UTXO retirement with ${failure} failure`, async () => {
  const fixture = trezorFixtureSessions();
  const disk = memoryDisk(undefined, undefined, undefined, fixture.sessions, async () => { throw new Error('No network needed'); });
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    await owner.selectNetwork('bitcoin', owner.getSnapshot().revision, owner.getCatalogue()!.revision, () => {});
    await runtime.trezor.startImport('Bitcoin Trezor');
    await owner.manageAccounts({ kind: 'import-trezor', label: 'Bitcoin Trezor' }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    assert.equal(owner.getCatalogue()!.active.accountId, 'trezor:0:0');
    const calls = fixture.paths.length;
    await runtime.openUtxoSend!(() => undefined);
    await runtime.trezor.cancel();
    await runtime.openUtxoSend!(() => undefined);
    assert.equal(fixture.paths.length, calls);
    if (failure === 'cancellation') fixture.holdCancellation(async () => { throw new Error('Cancellation refused'); });
    fixture.holdRetirement(async () => { entered(); await held; if (failure === 'retirement') throw new Error('Retirement refused'); });
    const cancelled = runtime.trezor.cancel();
    void cancelled.catch(() => undefined);
    await started;
    const cancelledAgain = runtime.trezor.cancel();
    assert.equal(cancelledAgain, cancelled);
    let settled = false;
    const closing = runtime.storage.close().finally(() => { settled = true; });
    void closing.catch(() => undefined);
    await Promise.resolve(); assert.equal(settled, false); release();
    if (failure !== 'none') {
      await assert.rejects(cancelled);
      await assert.rejects(closing, /CLEANUP_FAILED/);
    } else { await cancelled; await closing; }
  } finally { release(); await owner.dispose().catch(() => undefined); await fixture.sessions.dispose(); }
});

test('Trezor runtime replays saved UTXO bytes without Suite or a new signature', async () => {
  const [{ UtxoSignedRecords }, { getUtxoNetwork }, { utxoSubmissionUrl }, { utils }, { metadata }] = await Promise.all([
    import('../../../source/wallet/utxoSignedRecords.ts'), import('../src/core/utxoNetworks.ts'),
    import('../../../source/wallet/utxoSignedBinding.ts'), import('syscoinjs-lib'), import('./publicWatchFixtures.ts'),
  ]);
  const fixture = trezorFixtureSessions();
  const sdk = await loadNativeKeyringSdk();
  let ring!: InstanceType<typeof sdk.HostKeyring>;
  class Host extends sdk.HostKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) { super(...args); ring = this; }
  }
  let broadcasts = 0;
  const network = getUtxoNetwork('bitcoin');
  const disk = memoryDisk(async () => ({ ...sdk, HostKeyring: Host }), undefined, undefined, fixture.sessions,
    async (url, init) => {
      if (String(url) === network.endpoint + '/api/v2/') {
        const response = Response.json(metadata(network)); Object.defineProperty(response, 'url', { value: String(url) }); return response;
      }
      if (String(url) === network.endpoint + '/api/v2/block-index/0') {
        const response = Response.json({ blockHash: network.genesisHash }); Object.defineProperty(response, 'url', { value: String(url) }); return response;
      }
      assert.equal(String(url), utxoSubmissionUrl(network.endpoint));
      assert.equal(init?.method, 'POST'); broadcasts++;
      const raw = utils.bitcoinjs.Transaction.fromHex(String(init?.body));
      const response = Response.json({ result: raw.getId() });
      Object.defineProperty(response, 'url', { value: String(url) });
      return response;
    });
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  try {
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    await owner.selectNetwork('bitcoin', owner.getSnapshot().revision, owner.getCatalogue()!.revision, () => {});
    await runtime.trezor.startImport('Bitcoin Trezor');
    await owner.manageAccounts({ kind: 'import-trezor', label: 'Bitcoin Trezor' }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    const account = owner.getCatalogue()!.accounts.find(account => account.type === 'Trezor')!;
    const previous = new utils.bitcoinjs.Transaction();
    previous.addInput(Buffer.alloc(32, 7), 0);
    previous.addOutput(utils.bitcoinjs.address.toOutputScript(account.address, network.addressNetwork), 1000n);
    const txid = previous.getId();
    const record = { operation: 'wallet' as const, rawTransaction: previous.toHex(), txid,
      url: utxoSubmissionUrl(network.endpoint), feeSatoshis: '10', virtualSize: previous.virtualSize(),
      outpoints: ['07'.repeat(32) + ':0'],
      owner: { chainId: network.chainId, genesisHash: network.genesisHash, slip44: network.slip44,
        account: { id: 0, type: 'Trezor', xpub: (disk.records.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord).groups.find(group => group.activeNetwork.slip44 === 0)!.accounts.Trezor[0]!.xpub } },
    };
    const records = new UtxoSignedRecords(disk.utxoPort, disk.utxoPort);
    const recordAccess = ring.getPrivateRecordAccess(['org.syscoin.pali.evm.signed.root.v1', 'org.syscoin.pali.evm.signed.chunk.v1',
      'org.syscoin.pali.utxo.signed.root.v1', 'org.syscoin.pali.utxo.signed.chunk.v1']);
    await records.admit({ keyring: recordAccess, assertCurrent() {} }, record, 'initial', async prepare => { await prepare(); });
    const calls = fixture.paths.length;
    const send = await runtime.openUtxoSend!(() => undefined);
    const review = await send.prepareRetry(txid);
    const result = await send.confirm(review, { method: 'pin', pin: PASSWORD });
    assert.equal(result.txid, txid); assert.equal(broadcasts, 1);
    assert.equal(fixture.paths.length, calls);
    assert.equal(runtime.trezor.getSnapshot().phase, 'idle');
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    disk.onIdentity(async () => { entered(); await held; });
    const preparing = send.prepare({ recipient: account.address, amount: '0.00001' });
    void preparing.catch(() => undefined);
    await reached; await runtime.trezor.cancel(); release();
    await assert.rejects(preparing, /CANCELLED/);
    assert.equal(fixture.sessions.getSnapshot(), null);
    assert.equal(fixture.paths.length, calls);
    disk.onIdentity();
  } finally { await owner.dispose(); await fixture.sessions.dispose(); }
});

test('Trezor runtime resumes a zero-step UTXO draft only through a fresh review and device signature', async () => {
  const [{ createTrezorSessions }, { getUtxoNetwork }, { getNetworkConfig }, { utils }, { metadata }] = await Promise.all([
    import('../src/hardware/trezorSessions.ts'), import('../src/core/utxoNetworks.ts'), import('@sidhujag/sysweb3-network'),
    import('syscoinjs-lib'), import('./publicWatchFixtures.ts'),
  ]);
  const network = getUtxoNetwork('bitcoin');
  const config = getNetworkConfig(0, 'btc');
  const hd = new utils.HDSigner('test test test test test test test test test test test junk', null, false,
    config.networks, 0, config.types.zPubType, 84);
  hd.createAccountAtIndex(0, 84);
  const address = utils.bitcoinjs.payments.p2wpkh({ pubkey: hd.getRootNode().derivePath("m/84'/0'/0'/0/0").publicKey,
    network: network.addressNetwork }).address!;
  const previous = new utils.bitcoinjs.Transaction();
  previous.addInput(Buffer.alloc(32, 7), 0);
  previous.addOutput(utils.bitcoinjs.address.toOutputScript(address, network.addressNetwork), 100000n);
  const recipient = utils.bitcoinjs.payments.p2wpkh({ hash: Buffer.alloc(20, 8), network: network.addressNetwork }).address!;
  const methods: string[] = [];
  let random = 0, requestId = 0, broadcasts = 0;
  const sessions = createTrezorSessions({
    randomBytes: length => new Uint8Array(length).fill(++random),
    async loadClient() {
      let settings!: Parameters<import('../src/hardware/trezorHost.ts').NativeTrezorClient['init']>[0];
      let resolve!: (value: unknown) => void;
      const pending = new Promise<unknown>(done => { resolve = done; });
      return {
        async init(value) { settings = value; },
        call({ method, ...params }) {
          const callback = new URL(settings.deeplinkCallbackUrl); callback.searchParams.set('id', `call-${++requestId}`);
          const url = new URL(settings.connectSrc + 'deeplink/1/');
          url.searchParams.set('method', String(method)); url.searchParams.set('params', JSON.stringify(params));
          url.searchParams.set('callback', callback.toString()); url.searchParams.set('appName', settings.manifest.appName);
          settings.deeplinkOpen(url.toString()); return pending;
        },
        cancel() { resolve(undefined); }, async dispose() {},
      };
    },
    async openURL(value) {
      const url = new URL(value), method = url.searchParams.get('method')!;
      const params = JSON.parse(url.searchParams.get('params')!);
      methods.push(method);
      let payload: unknown;
      if (method === 'getAccountInfo') payload = { descriptor: hd.getAccountXpub(), balance: '0', empty: true, history: { total: 0, unconfirmed: 0 } };
      else if (method === 'getFeatures') payload = { major_version: 2, minor_version: 8, patch_version: 0, model: 'T' };
      else if (method === 'signTransaction') {
        // Connect's existing fixPath normalizes its public address_n values to uint32.
        const pathText = (path: number[]) => 'm/' + path.map(value => {
          const index = value >>> 0;
          return index >= 0x80000000 ? `${index - 0x80000000}'` : String(index);
        }).join('/');
        const psbt = new utils.bitcoinjs.Psbt({ network: network.addressNetwork });
        psbt.setVersion(params.version); psbt.setLocktime(params.locktime);
        for (const input of params.inputs) {
          const path = pathText(input.address_n);
          const key = hd.getRootNode().derivePath(path);
          psbt.addInput({ hash: input.prev_hash, index: input.prev_index, sequence: input.sequence,
            witnessUtxo: previous.outs[input.prev_index],
            bip32Derivation: [{ path, masterFingerprint: hd.getMasterFingerprint(), pubkey: key.publicKey }],
          });
        }
        for (const output of params.outputs) {
          const destination = output.address ?? utils.bitcoinjs.payments.p2wpkh({
            pubkey: hd.getRootNode().derivePath(pathText(output.address_n)).publicKey, network: network.addressNetwork,
          }).address;
          psbt.addOutput({ address: destination, value: BigInt(output.amount) });
        }
        psbt.signAllInputsHD(hd.getRootNode()); psbt.finalizeAllInputs();
        payload = { serializedTx: psbt.extractTransaction().toHex(), signatures: [] };
      } else throw new Error(`Unexpected device method ${method}`);
      const callback = new URL(url.searchParams.get('callback')!);
      callback.searchParams.set('response', JSON.stringify({ success: true, payload }));
      assert.equal(sessions.receiveCallback(callback.toString()), true);
    },
  });
  const disk = memoryDisk(undefined, undefined, undefined, sessions, async (input, init) => {
    const url = String(input), route = url.slice(network.endpoint.length);
    let result: unknown;
    if (route === '/api/v2/') result = metadata(network);
    else if (route === '/api/v2/block-index/0') result = { blockHash: network.genesisHash };
    else if (route === '/api/v2/estimatefee/1') result = { result: '0.00001024' };
    else if (route.startsWith('/api/v2/xpub/')) result = { tokens: [] };
    else if (route.startsWith('/api/v2/utxo/')) result = [{ txid: previous.getId(), vout: 0, value: '100000', address, confirmations: 10, path: "m/84'/0'/0'/0/0" }];
    else if (route === '/api/v2/tx/' + previous.getId()) result = { hex: previous.toHex() };
    else if (route === '/api/v2/sendtx/' && init?.method === 'POST') { broadcasts++; result = { result: utils.bitcoinjs.Transaction.fromHex(String(init.body)).getId() }; }
    else throw new Error('Unexpected UTXO route ' + route);
    const response = Response.json(result); Object.defineProperty(response, 'url', { value: url }); return response;
  });
  const runtime = await disk.factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ async open() { return runtime; } });
  try {
    await owner.initialize(); await owner.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata();
    await owner.selectNetwork('bitcoin', owner.getSnapshot().revision, owner.getCatalogue()!.revision, () => {});
    await runtime.trezor.startImport('Bitcoin Trezor');
    await owner.manageAccounts({ kind: 'import-trezor', label: 'Bitcoin Trezor' }, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    const callCount = methods.length;
    const first = await runtime.openUtxoSend!(() => undefined);
    const review = await first.prepare({ recipient, amount: '0.0005', rbf: false });
    assert.equal(review.transactionOptions.rbf, false);
    assert.equal(methods.length, callCount);
    owner.lock(); await owner.unlock(PASSWORD);
    assert.equal(runtime.trezor.getSnapshot().phase, 'resume');
    await assert.rejects(first.confirm(review, { method: 'pin', pin: PASSWORD }), /CANCELLED|NOT_READY/);
    const intent = await runtime.trezor.resumeSend(); assert.equal(intent.kind, 'utxo');
    if (intent.kind !== 'utxo') throw new Error('Unexpected draft');
    assert.equal(intent.rbf, false, 'paused handoff retains the actual reviewed option');
    const fresh = await runtime.openUtxoSend!(() => undefined);
    const freshReview = await fresh.prepare(intent);
    assert.equal(freshReview.transactionOptions.rbf, false);
    assert.notEqual(freshReview, review); assert.equal(methods.length, callCount); assert.equal(broadcasts, 0);
    const beforeAuthentication = methods.filter(method => method === 'signTransaction').length;
    await assert.rejects(fresh.confirm(freshReview, { method: 'biometric' }), /DEVICE_UNLOCK_UNAVAILABLE/);
    assert.equal(methods.filter(method => method === 'signTransaction').length, beforeAuthentication,
      'declined authentication must preserve this reviewed operation without reaching Trezor');
    await fresh.confirm(freshReview, { method: 'pin', pin: PASSWORD });
    assert.equal(methods.filter(method => method === 'signTransaction').length, 1);
    assert.equal(broadcasts, 1);
  } finally { await owner.dispose(); await sessions.dispose(); }
});
