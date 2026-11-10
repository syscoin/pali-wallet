import { createTestPrivateAuthentication } from './fixtures/privateAuthentication.ts';
import { storageOnlyPublicSession } from './fixtures/publicSessionRecord.ts';
import { prepareRecoveryPin } from './fixtures/recoveryPin.ts';
import { createPrivateVaultSession } from '../../../source/wallet/privateVault.ts';
import { withTestPinOperation } from './fixtures/pinOperation.ts';
import { createTestPinRecord } from './fixtures/pinRecord.ts';
import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HDNodeWallet, Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import type { EvmSignedBroadcast } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { openNativeConnectionRepository, NATIVE_CONNECTION_STORAGE_KEY } from '../src/connections/storage.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { NativeRecoveryFlow } from '../src/custody/recoveryFlow.ts';
import type { NativeTransferDispatchValidation } from '../src/custody/transfers.ts';
import { NativeWalletRemoval } from '../src/custody/walletRemoval.ts';
import { readRecoveryInventory } from '../src/custody/recoveryInventory.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { encodeStorageValue } from '../src/storage/json.ts';
import { getUtxoNetwork, getUtxoSdkNetwork, type UtxoNetworkId } from '../src/core/utxoNetworks.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { createUtxoBalanceReader } from '../src/core/utxoBalanceReader.ts';
import { metadata as utxoMetadata, UTXO_ADDRESSES } from './publicWatchFixtures.ts';
import { WALLET_CATALOGUE_KEY, type NativeAccountRecord } from '../src/custody/walletCatalogue.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { ACTIVITY_STORAGE_KEY } from '../src/activity/historyStore.ts';
import { createActivityScope } from '../src/activity/types.ts';
import { NATIVE_TOKEN_REGISTRY_KEY } from '../src/portfolio/tokenRegistry.ts';
import { readPrivateVaultBundle, envelopeHash } from '../../../source/wallet/privateVaultInspection.ts';
import { digest, INSTALLATION, nodeConnection, validPair, type SqlHook } from './storageHelpers.ts';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { UTXO_SIGNED_RECORD_KEY, UtxoSignedRecords } from '../../../source/wallet/utxoSignedRecords.ts';
import { ROOT_DOMAIN as UTXO_ROOT_DOMAIN } from '../../../source/wallet/utxoSignedBundle.ts';
import { utxoInputOutpoints } from '../../../source/utils/utxoAcknowledgedInputs.ts';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { createSentryKeyVault } from '../../../source/wallet/sentryKeyVault.ts';
import { SENTRY_SLOT_KEYS } from '../src/storage/sentryKeyDomain.ts';
import type { DeriveSentryPublicKey } from '../src/custody/sentryKeyManagement.ts';
import { parseSentrySettingsStorageKey } from '../../../source/shared/sentrySettings.ts';
import { OperationAuthentication, type OperationAuthenticationPrompt } from '../src/core/operationAuthentication.ts';

const pinCredential = createTestPinCredentialPort();

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WRONG = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OLD = '123456';
const NEXT = '654321';
const KEY = `0x${'11'.repeat(32)}`;
const KEY2 = `0x${'22'.repeat(32)}`;
const importedWallet = new Wallet(KEY);
const importedWallet2 = new Wallet(KEY2);
const sourceWallet = HDNodeWallet.fromPhrase(
  PHRASE,
  undefined,
  "m/44'/60'/0'/0/0"
);
const sdk = await loadNativeKeyringSdk();
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
let networkCalls = 0;
const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = (() => { networkCalls++; throw new Error('Network forbidden'); }) as typeof fetch; });
test.after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkCalls, 0);
});

function latch() {
  let release!: () => void, entered!: () => void;
  return { gate: new Promise<void>((resolve) => { release = resolve; }), reached: new Promise<void>((resolve) => { entered = resolve; }), release: () => release(), enter: () => entered() };
}
async function fixture(
  loadRuntimeSdk?: () => Promise<typeof sdk>,
  confirmed = true,
  clocks?: { wall: () => number; monotonic: () => number },
  readUtxoAccount?: Parameters<typeof createKeyringRuntimeFactory>[0]['readUtxoAccount'],
  utxoFetch?: typeof globalThis.fetch,
  deriveSentryPublicKey?: DeriveSentryPublicKey
) {
  let currentPin = OLD;
  let operationPin: string | undefined;
  let operationRequests = 0;
  const operationBroker = new OperationAuthentication();
  let refusedOperation = Promise.withResolvers<OperationAuthenticationPrompt>();
  const detachOperationBroker = operationBroker.attach(prompt => {
    if (prompt?.error) refusedOperation.resolve(prompt);
    else if (prompt && !prompt.busy) queueMicrotask(() => prompt.confirm({ method: 'pin', pin: operationPin! }));
  });
  const directory = await mkdtemp(
    path.join(tmpdir(), 'pali-preserving-recovery-')
  );
  const file = path.join(directory, 'wallet.sqlite');
  let leased = false,
    initialized = false,
    opens = 0,
    retires = 0;
  let hook: SqlHook | undefined;
  let afterHook: SqlHook | undefined;
  const dispatched: string[] = [];
  let dispatchHook: ((sql: string) => void) | undefined;
  let failurePause: ReturnType<typeof latch> | undefined;
  let closeFailure = false;
  let runtime!: KeyringRuntime;
  const liveKeyrings: InstanceType<typeof sdk.HostKeyring>[] = [];
  let store!: SqliteWalletStorage;
  const open = async (): Promise<OpenWalletStorage> => {
    assert.equal(leased, false, 'old authority must release its database lease'); leased = true; opens++;
    const owned = nodeConnection(file, { before: (...args) => hook?.(...args), after: (...args) => afterHook?.(...args) });
    const exec = owned.connection.execAsync.bind(owned.connection);
    owned.connection.execAsync = (sql) => { dispatched.push(sql); dispatchHook?.(sql); return exec(sql); };
    try { store = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, !initialized, clocks?.wall, clocks?.monotonic); initialized = true; }
    catch (error) { await owned.connection.closeAsync(); leased = false; throw error; }
    const local = store;
    const recovery = { ...store.recovery, async recordFailureForPair(fingerprint: string) {
      const pause = failurePause; failurePause = undefined;
      if (pause) { pause.enter(); await pause.gate; }
      await local.recovery.recordFailureForPair!(fingerprint);
    } };
    let closed = false;
    return { pin: local.pin,
      keyringStorage: local.keyringStorage, signedRecords: local.signedRecords, utxoSignedRecords: local.utxoSignedRecords, authGuard: local.authGuard, recovery, removal: local.removal, sentryKeys: local.sentryKeys,
      readState: () => local.readState(), getWalletFingerprint: () => local.getWalletFingerprint(), confirmBackup: (fp) => local.confirmBackup(fp),
      async close() { if (!closed) { await local.close(); if (closeFailure) throw new Error('synthetic close acknowledgement failure'); closed = true; leased = false; } } };
  };
  const factory = createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: async (request, signal, check, verify) => {
    operationRequests++; check();
    if (operationPin !== undefined) return operationBroker.request(request, signal, check, verify);
    const result = await verify({ method: 'pin', pin: currentPin }, check); if (!result.accepted) throw Error(result.reason);
  }, privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null,
    ensureCryptoReady: async () => undefined,
    openStorage: open,
    readUtxoAccount,
    utxoFetch,
    deriveSentryPublicKey,
    loadSdk: async () => {
      const module = await (loadRuntimeSdk?.() ?? sdk);
      class ObservedKeyring extends module.HostKeyring {
        constructor(
          ...options: ConstructorParameters<typeof module.HostKeyring>
        ) {
          super(...options);
          liveKeyrings.push(this);
        }
      }
      return { ...module, HostKeyring: ObservedKeyring };
    },
  });
  const newOwner = async () => {
    const authority = new NativeCustodyAuthority({
      async open() {
        runtime = (await factory.open()) as KeyringRuntime;
        return runtime;
      },
    });
    await authority.initialize();
    const unlock = authority.unlock.bind(authority);
    authority.unlock = async (pin) => { await unlock(pin); currentPin = pin; };
    return authority;
  };
  let owner = await newOwner();
  await owner.importPhrase(PHRASE, OLD);
  if (confirmed) { await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata(); }
  const coordinator = (loadSdk?: () => Promise<typeof sdk>, monotonicMilliseconds?: () => number) => new NativeRecoveryCoordinator({ pinCredential, owner,
    async retireControllers() { retires++; }, ensureCryptoReady: async () => undefined, openStorage: open, loadSdk, monotonicMilliseconds: monotonicMilliseconds ?? clocks?.monotonic });
  const read = () => {
    const db = new DatabaseSync(file, { readOnly: true });
    try { return { records: db.prepare('SELECT * FROM keyring_records UNION ALL SELECT * FROM sentry_key_records ORDER BY key').all() as { key: string; value: string }[],
      metadata: db.prepare('SELECT * FROM wallet_metadata ORDER BY key').all() as { key: string; value: string }[],
      notes: db.prepare('SELECT * FROM private_note_records ORDER BY profile_id').all(),
      signedRecords: db.prepare('SELECT * FROM evm_signed_records ORDER BY profile_id').all() }; }
    finally { db.close(); }
  };
  const write = (key: string, value: unknown) => {
    const db = new DatabaseSync(file);
    const table = Object.values(SENTRY_SLOT_KEYS).some((slot) => key === slot) ? 'sentry_key_records' : 'keyring_records';
    try { db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (?, ?)`).run(key, encodeStorageValue(value)); } finally { db.close(); }
  };
  return { notes(profile: string, value: unknown, binding: string) { const db = new DatabaseSync(file); try { db.prepare('INSERT OR REPLACE INTO private_note_records VALUES (?, ?, ?)').run(profile, binding, JSON.stringify(value)); } finally { db.close(); } },
    setOperationPin(pin?: string) { operationPin = pin; refusedOperation = Promise.withResolvers<OperationAuthenticationPrompt>(); },
    waitOperationRefusal: () => refusedOperation.promise,
    get operationRequests() { return operationRequests; },
    get owner() {
      return owner;
    },
    get runtime() {
      return runtime;
    },
    get keyring() {
      const ring = liveKeyrings.find((keyring) => keyring.hasPublicSession())!;
      const check = ring.capturePublicSessionGuard();
      const run = <T>(work: () => Promise<T>) => withTestPinOperation(store.pin, pinCredential, ring, currentPin, check, work);
      return {
        getPrivateRecordProfileId: () => run(() => ring.getPrivateRecordProfileId()),
        encryptPrivateRecord: (input: Parameters<typeof ring.encryptPrivateRecord>[0]) => run(() => ring.encryptPrivateRecord(input)),
        decryptPrivateRecord: (input: Parameters<typeof ring.decryptPrivateRecord>[0]) => run(() => ring.decryptPrivateRecord(input)),
      };
    },
    get store() {
      return store;
    },
    unlockedKeyrings: () => liveKeyrings.filter((keyring) => keyring.isUnlocked()).length,
    publicKeyrings: () => liveKeyrings.filter((keyring) => keyring.hasPublicSession()).length,
    open,
    read,
    write,
    writeUtxoBytes(value: string) { const db = new DatabaseSync(file); try { db.prepare('INSERT OR REPLACE INTO keyring_records VALUES (?, ?)').run(UTXO_SIGNED_RECORD_KEY, value); } finally { db.close(); } },
    coordinator,
    remove(key: string) { const db = new DatabaseSync(file); try { db.prepare('DELETE FROM keyring_records WHERE key = ?').run(key); } finally { db.close(); } },
    meta(key: string, value: unknown) {
      const db = new DatabaseSync(file);
      try { db.prepare('INSERT OR REPLACE INTO wallet_metadata VALUES (?, ?)').run(key, encodeStorageValue(value)); } finally { db.close(); }
    },
    metaHex(key: string, hex?: string) {
      const db = new DatabaseSync(file);
      try {
        if (hex !== undefined)
          db.prepare('INSERT OR REPLACE INTO wallet_metadata VALUES (?, CAST(? AS TEXT))').run(key, Buffer.from(hex, 'hex'));
        return db.prepare('SELECT hex(CAST(value AS BLOB)) AS value FROM wallet_metadata WHERE key = ?').get(key)?.value;
      } finally { db.close(); }
    },
    get opens() {
      return opens;
    },
    get retires() {
      return retires;
    },
    get leased() {
      return leased;
    },
    dispatched,
    failClose() {
      closeFailure = true;
    },
    setDispatch(value?: (sql: string) => void) {
      dispatchHook = value;
    },
    setHook(value?: SqlHook) {
      hook = value;
    },
    setAfter(value?: SqlHook) {
      afterHook = value;
    },
    pauseFailure(value: ReturnType<typeof latch>) {
      failurePause = value;
    },
    async reopen(quarantined = false) {
      if (quarantined) await assert.rejects(owner.dispose(), { code: 'CLEANUP_FAILED' });
      else await owner.dispose();
      owner = await newOwner();
      return owner;
    },
    async close() { detachOperationBroker(); hook = undefined; afterHook = undefined; await owner.dispose().catch(() => undefined); if (leased) await store.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}
function retained(
  state: ReturnType<Awaited<ReturnType<typeof fixture>>['read']>
) {
  return {
    records: state.records
      .filter((row) => !['vault', 'vault-keys', 'native-public-session-v1'].includes(row.key))
      .map((row) => {
        if (row.key !== WALLET_CATALOGUE_KEY) return row;
        const value = JSON.parse(row.value);
        delete value.revision;
        for (const group of value.groups)
          for (const accounts of Object.values(group.accounts) as any[])
            for (const account of Object.values(accounts) as any[])
              if (account.xprv) account.xprv = '<rewrapped>';
        return { ...row, value: JSON.stringify(value) };
      }),
    notes: state.notes,
    signedRecords: state.signedRecords,
  };
}

test('real SDK recovery preserves imported ciphertext, account IDs and three-chain signed bytes through repeated password changes', async () => {
  const f = await fixture(); let recovery: NativeRecoveryCoordinator | undefined;
  const collection = { contractAddress: `0x${'33'.repeat(20)}`, tokenStandard: 'ERC-721' as const };
  const item = { contractAddress: `0x${'44'.repeat(20)}`, tokenStandard: 'ERC-1155' as const, tokenId: ((1n << 256n) - 1n).toString() };
  try {
    await f.owner.manageAccounts({ kind: 'create', label: 'Second HD',}, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    await f.owner.importAccount({ privateKey: KEY, expectedAddress: importedWallet.address, label: 'Imported private account' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
    await f.owner.importAccount({ privateKey: KEY2, expectedAddress: importedWallet2.address, label: 'Second imported account' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
    await f.owner.manageAccounts({ kind: 'select', id: 'imported:60:1' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    const fingerprint = await f.store.getWalletFingerprint();
    const connections = await openNativeConnectionRepository({ storage: f.store.keyringStorage, walletBindingId: fingerprint, assertOwner() {} });
    await connections.transport.setItem('test-protocol-keychain', { key: 'test-only-session-secret' });
    await connections.dispose();
    const ethereum = getNativeNetwork('ethereum'), activityScope = createActivityScope(fingerprint, 'imported:60:1', importedWallet2.address, 'ethereum');
    f.write(NATIVE_TOKEN_REGISTRY_KEY, { version: 1, revision: 0, walletFingerprint: fingerprint, entries: [{ accountId: 'imported:60:1', address: importedWallet2.address,
      network: 'ethereum', chainId: '1', registrationHash: ethereum.registrationHash,
      metadata: { contractAddress: importedWallet.address, name: 'Public fixture token', symbol: 'FIX', decimals: 19 } }] });
    const draft = { ...item };
    const saving = f.runtime.tokens!.addCollectible(0, draft, () => undefined);
    draft.tokenId = '1';
    assert.deepEqual((await saving).collectibles, [item]);
    await f.runtime.tokens!.addCollectible(1, collection, () => undefined);
    await f.owner.manageAccounts({ kind: 'select', id: 'hd:60:0' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    assert.equal((await f.runtime.tokens!.load(() => undefined)).collectibles, undefined);
    await f.owner.manageAccounts({ kind: 'select', id: 'imported:60:1' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    f.write(ACTIVITY_STORAGE_KEY, { version: 1, revision: 0, walletFingerprint: fingerprint, truncated: false, archived: [],
      cached: [{ sourceId: activityScope.sourceId, scopeKey: activityScope.key, candidates: [{ hash: `0x${'a'.repeat(64)}`, blockNumber: '1', timestamp: 1, tokenHint: false }] }],
      views: [{ sourceId: activityScope.sourceId, view: { filter: 'sent', showZero: false, anchor: null, offset: 7 } }] });
    for (const id of ['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet']) {
      const network = getNativeNetwork(id);
      const raw = await sourceWallet.signTransaction({ type: 2, chainId: Number(network.chainId), nonce: 0, to: importedWallet.address, value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
      const transaction = Transaction.from(raw);
      await new EvmSignedRecords(f.store.signedRecords, () => 1000).append({ keyring: f.keyring, assertCurrent() {} }, {
        rawTransaction: raw, hash: transaction.hash!, from: sourceWallet.address, chainId: network.chainId, nonce: 0, type: 2,
        context: { account: { id: 0, type: 'HDAccount', address: sourceWallet.address }, operation: 'send',
          network: { kind: 'ethereum', chainId: Number(network.chainId), slip44: 60, url: network.rpcUrl } },
      });
    }
    const inventory = await readRecoveryInventory(f.store);
    assert.equal(inventory.status, 'needs-matching-phrase-verification', JSON.stringify({ inventory, keys: f.read().records.map((r) => r.key) }));
    assert.equal(inventory.counts?.tokenEntries, 3);
    assert.equal(JSON.stringify(inventory).includes(item.contractAddress), false);
    const before = f.read(); f.owner.lock(); recovery = f.coordinator();
    const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    assert.deepEqual(Object.keys(proof), []); assert.equal(f.owner.getSnapshot().phase, 'disposed'); assert.equal(f.retires, 1);
    assert.deepEqual(f.read(), before, 'preparation must not mutate live records');
    await assert.rejects(recovery.commit({}), { code: 'STATE_CHANGED' });
    assert.equal(await recovery.commit(proof), 'committed-locked');
    await assert.rejects(recovery.commit(proof), { code: 'STATE_CHANGED' });
    assert.deepEqual(retained(f.read()), retained(before));
    assert.equal(f.read().records.find((row) => row.key === NATIVE_CONNECTION_STORAGE_KEY)?.value, before.records.find((row) => row.key === NATIVE_CONNECTION_STORAGE_KEY)?.value);
    await f.reopen();
    assert.equal((await f.store.recovery.readIdentity())?.walletBindingId, fingerprint);
    assert.notEqual(await f.store.getWalletFingerprint(), fingerprint);
    await assert.rejects(f.owner.unlock(OLD));
    await f.owner.unlock(NEXT); assert.equal(f.owner.getSnapshot().phase, 'ready');
    assert.equal(f.owner.getCatalogue()!.accounts.length, 4);
    assert.equal(f.owner.getCatalogue()!.active.accountId, 'imported:60:1');
    const saved = await f.runtime.tokens!.load(() => undefined);
    assert.equal(saved.items.length, 1);
    assert.deepEqual(saved.collectibles, [item, collection]);
    const activity = await f.runtime.activity!.load(() => undefined);
    assert.equal(activity.saved.candidates.length, 1); assert.equal(activity.saved.view.filter, 'sent');
    assert.equal(await f.runtime.keyExport!.readSelected({ authorityRevision: f.owner.getSnapshot().revision, catalogueRevision: f.owner.getCatalogue()!.revision,
      accountId: 'imported:60:1', index: 1, address: importedWallet2.address, networkId: 'ethereum', registrationHash: ethereum.registrationHash }, new AbortController().signal, () => undefined, createTestPrivateAuthentication(() => undefined)), KEY2);
    const rootBinding = await f.store.recovery.readIdentity(); assert.equal(rootBinding?.root?.address, sourceWallet.address);
    f.owner.lock(); await recovery.dispose(); recovery = f.coordinator();
    const again = await prepareRecoveryPin(recovery, PHRASE, '456789', () => undefined); await recovery.commit(again);
    assert.deepEqual(retained(f.read()), retained(before));
    await f.reopen(); await f.owner.unlock('456789');
    assert.equal((await f.store.recovery.readIdentity())?.walletBindingId, fingerprint);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { await recovery?.dispose(); await f.close(); }
});

test('protected collectible operations revoke on lock and quarantine a lost SQL commit acknowledgement', async () => {
  const f = await fixture();
  const pause = latch();
  const item = { contractAddress: `0x${'33'.repeat(20)}`, tokenStandard: 'ERC-1155' as const, tokenId: '0' };
  const sibling = { ...item, tokenId: '1' };
  const current = () => undefined;
  const record = () => f.read().records.find(({ key }) => key === NATIVE_TOKEN_REGISTRY_KEY);
  try {
    const tokens = f.runtime.tokens!;
    await tokens.addCollectible(0, item, current);
    const before = record();
    f.setHook(async (kind, sql) => {
      if (kind !== 'get' || !sql.includes('keyring_records')) return;
      f.setHook(); pause.enter(); await pause.gate;
    });
    const pending = assert.rejects(tokens.removeCollectible(1, item, current), /CANCELLED|NOT_READY/);
    await pause.reached;
    await assert.rejects(f.owner.selectNetwork('base', f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, () => {}), /BUSY/);
    f.owner.lock();
    pause.release();
    await pending;
    assert.deepEqual(record(), before);
    await f.owner.unlock(OLD);
    assert.deepEqual((await tokens.load(current)).collectibles, [item]);

    f.setAfter((kind, sql) => {
      if (kind === 'exec' && sql === 'COMMIT') {
        f.setAfter(); throw new Error('lost acknowledgement');
      }
    });
    await assert.rejects(tokens.addCollectible(1, sibling, current), { code: 'CLEANUP_FAILED' });
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    assert.equal(f.unlockedKeyrings(), 0);
    await assert.rejects(tokens.removeCollectible(2, sibling, current), { code: 'CLEANUP_FAILED' });
    await f.reopen(true);
    await f.owner.unlock(OLD);
    assert.deepEqual((await f.runtime.tokens!.load(current)).collectibles, [item, sibling]);
    assert.deepEqual((await f.runtime.tokens!.removeCollectible(2, item, current)).collectibles, [sibling]);
  } finally { pause.release(); await f.close(); }
});

for (const mutation of ['root-ciphertext', 'missing-entry'] as const) test(`recovery refuses ${mutation} in a structurally valid signed bundle without replacing any bytes`, async () => {
  const f = await fixture(); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    const store = new EvmSignedRecords(f.store.signedRecords, () => 1000);
    for (const nonce of [0, 1]) {
      const rawTransaction = await sourceWallet.signTransaction({ type: 2, chainId: 1, nonce, to: importedWallet.address,
        value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
      const transaction = Transaction.from(rawTransaction);
      await store.append({ keyring: f.keyring, assertCurrent() {} }, {
        rawTransaction, hash: transaction.hash!, from: sourceWallet.address, chainId: '1', nonce, type: 2,
        context: { account: { id: 0, type: 'HDAccount', address: sourceWallet.address }, operation: 'send',
          network: { kind: 'ethereum', chainId: 1, slip44: 60, url: getNativeNetwork('ethereum').rpcUrl } },
      });
    }
    const profileId = (await f.store.recovery.readIdentity())!.root!.profileId;
    const beforeRaw = (await f.store.signedRecords.read(profileId))!;
    const changed = JSON.parse(beforeRaw);
    if (mutation === 'root-ciphertext') changed.root.ciphertext = (changed.root.ciphertext[0] === 'A' ? 'B' : 'A') + changed.root.ciphertext.slice(1);
    else changed.entries = changed.entries.slice(1);
    assert.equal(await f.store.signedRecords.compareAndSet(profileId, beforeRaw, JSON.stringify(changed), () => undefined), true);
    assert.equal((await readRecoveryInventory(f.store)).status, 'needs-matching-phrase-verification');
    const before = f.read(); f.owner.lock(); recovery = f.coordinator();
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'INVALID_SAVED_DATA' });
    assert.deepEqual(f.read(), before);
  } finally { await recovery?.dispose(); await f.close(); }
});

test('recovery authenticates captured UTXO bytes even if an ABA swap supplies a valid live row', async () => {
  const f = await fixture(); let recovery: NativeRecoveryCoordinator | undefined;
  let corrupt: string | undefined;
  try {
    const bitcoin = syscoinUtils.bitcoinjs;
    const key = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 13));
    const script = bitcoin.payments.p2wpkh({ pubkey: key.publicKey }).output;
    const parent = new bitcoin.Transaction();
    parent.addInput(Buffer.alloc(32, 14), 0);
    parent.addOutput(script, 10000n);
    const psbt = new bitcoin.Psbt();
    psbt.addInput({ hash: parent.getHash(), index: 0, witnessUtxo: { script, value: 10000n } });
    psbt.addOutput({ script, value: 9000n });
    const tx = psbt.signInput(0, key).finalizeAllInputs().extractTransaction();
    const owner = { chainId: 0, slip44: 0, genesisHash: getUtxoNetwork('bitcoin').genesisHash, account: { id: 0, type: 'HDAccount', xpub: 'synthetic-public-owner' } };
    const store = new UtxoSignedRecords(f.store.utxoSignedRecords, f.store.utxoSignedRecords);
    await store.persist({ keyring: f.keyring, assertCurrent: () => undefined }, {
      owner, operation: 'wallet', url: `${getUtxoNetwork('bitcoin').endpoint}/api/v2/sendtx/`, rawTransaction: tx.toHex(), txid: tx.getId(),
      virtualSize: tx.virtualSize(), feeSatoshis: '1000', outpoints: utxoInputOutpoints(tx.ins),
    });
    const valid = (await f.store.utxoSignedRecords.read((await f.store.recovery.readIdentity())!.root!.profileId))!;
    const changed = JSON.parse(valid);
    changed.root.ciphertext = (changed.root.ciphertext[0] === 'A' ? 'B' : 'A') + changed.root.ciphertext.slice(1);
    corrupt = JSON.stringify(changed);
    f.writeUtxoBytes(corrupt);
    f.owner.lock();
    class ProbeKeyring extends sdk.SoftwareKeyring {
      async decryptPrivateRecord(input: Parameters<InstanceType<typeof sdk.SoftwareKeyring>['decryptPrivateRecord']>[0]) {
        const output = await super.decryptPrivateRecord(input);
        // A live-row validation would authenticate B, then observe A at commit.
        if (input.domain === UTXO_ROOT_DOMAIN) f.writeUtxoBytes(corrupt!);
        return output;
      }
    }
    recovery = f.coordinator(async () => {
      f.writeUtxoBytes(valid);
      return { ...sdk, SoftwareKeyring: ProbeKeyring };
    });
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'INVALID_SAVED_DATA' });
    assert.equal(f.read().records.find(({ key: name }) => name === UTXO_SIGNED_RECORD_KEY)?.value, valid);
  } finally { if (corrupt) f.writeUtxoBytes(corrupt); await recovery?.dispose(); await f.close(); }
});

test('known wrong-root failure is charged once even when its request is cancelled before accounting finishes', async () => {
  const f = await fixture(); const pause = latch(); f.pauseFailure(pause); f.owner.lock(); const recovery = f.coordinator();
  try {
    const before = f.read(); const pending = prepareRecoveryPin(recovery, WRONG, NEXT, () => undefined);
    await pause.reached; recovery.cancel(); pause.release();
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.deepEqual(f.read().records, before.records);
    const auth = JSON.parse(f.read().metadata.find((row) => row.key === 'auth')!.value);
    assert.equal(auth.failures, 1);
  } finally { pause.release(); await recovery.dispose(); await f.close(); }
});

test('malformed input and a forged private envelope do not count as a wrong phrase or modify records', async () => {
  const f = await fixture();
  let recovery: NativeRecoveryCoordinator | undefined;
  try {
    await f.owner.importAccount({ privateKey: KEY, expectedAddress: importedWallet.address, label: 'Imported' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
    f.owner.lock();
    recovery = f.coordinator();
    const before = f.read(); await assert.rejects(prepareRecoveryPin(recovery, 'not a phrase', NEXT, () => undefined), { code: 'INVALID_INPUT' });
    assert.deepEqual(f.read(), before);
    const catalogue = JSON.parse(
      before.records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value
    );
    const envelope = catalogue.recovery[0].envelope;
    envelope.ciphertext = (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1);
    f.write(WALLET_CATALOGUE_KEY, catalogue);
    const corrupt = f.read();
    await assert.rejects(
      prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined),
      { code: 'INVALID_SAVED_DATA' }
    );
    assert.deepEqual(f.read(), corrupt);
  } finally {
    await recovery?.dispose();
    await f.close();
  }
});

test('late successful staging after cancel is discarded without replacing the pair', async () => {
  const f = await fixture();
  const pause = latch();
  f.owner.lock();
  class Delayed extends sdk.SoftwareKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
      super(...args);
      const original = this.deriveEvmHdRuntimeAccount.bind(this);
      this.deriveEvmHdRuntimeAccount = async (...args) => {
        const result = await original(...args);
        pause.enter();
        await pause.gate;
        return result;
      };
    }
  }
  const recovery = f.coordinator(async () => ({
    ...sdk,
    SoftwareKeyring: Delayed,
  }));
  try {
    const before = f.read(); const pending = prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    await pause.reached; recovery.cancel(); pause.release(); await assert.rejects(pending, { code: 'CANCELLED' });
    assert.deepEqual(f.read(), before);
  } finally { pause.release(); await recovery.dispose(); await f.close(); }
});

for (const fault of ['before-write', 'commit-not-applied', 'commit-applied'] as const) {
  test(`recovery ${fault} has one complete old/new state and never compensates by deletion`, async () => {
    const f = await fixture(); const recovery = f.coordinator();
    try {
      const enrollment = f.store.deviceUnlockEnrollment;
      assert.equal(await enrollment.compareAndSet((await enrollment.read())!, 'b2'.repeat(16), () => undefined), true);
      f.owner.lock();
      const before = f.read(), proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined); let injected = false;
      const fail = (_kind: unknown, sql: string) => {
        if (!injected && (fault === 'before-write' ? sql.startsWith('UPDATE keyring_records') : sql === 'COMMIT')) { injected = true; throw new Error('Injected commit fault'); }
      };
      if (fault === 'commit-applied') f.setAfter(fail); else f.setHook(fail);
      if (fault === 'commit-applied') assert.equal(await recovery.commit(proof), 'committed-locked');
      else await assert.rejects(recovery.commit(proof));
      f.setHook(); f.setAfter(); assert.equal(injected, true);
      assert.deepEqual(retained(f.read()), retained(before));
      if (fault !== 'commit-applied') assert.deepEqual(f.read(), before);
      else assert.equal(f.read().metadata.some((row) => row.key === 'device-unlock-enrollment'), false);
      await f.reopen(); await f.owner.unlock(fault === 'commit-applied' ? NEXT : OLD);
      assert.equal(f.owner.getSnapshot().phase, 'ready');
    } finally { f.setHook(); f.setAfter(); await recovery.dispose(); await f.close(); }
  });
}

test('changed snapshot and unknown data refuse replacement without overwriting the competing row', async () => {
  const f = await fixture();
  f.owner.lock();
  const recovery = f.coordinator();
  try {
    const before = f.read(),
      proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    const catalogue = JSON.parse(
      before.records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value
    );
    catalogue.groups[0].accounts.HDAccount[0].label = 'Changed elsewhere';
    f.write(WALLET_CATALOGUE_KEY, catalogue);
    const changed = f.read();
    await assert.rejects(recovery.commit(proof), { code: 'STATE_CHANGED' });
    assert.deepEqual(f.read(), changed);
    f.write('unsupported-private-note-domain', {});
    const unknown = f.read();
    await assert.rejects(
      prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined),
      { code: 'INVALID_SAVED_DATA' }
    );
    assert.deepEqual(f.read(), unknown);
  } finally {
    await recovery.dispose();
    await f.close();
  }
});

test('mobile dispatch rejects missing or changed approval before retaining or broadcasting signed bytes', async () => {
  const f = await fixture();
  try {
    const approval = {
      type: 2 as const, accessList: [], chainId: '1', nonce: '0', from: sourceWallet.address,
      to: importedWallet.address, value: '1', gasLimit: '21000', data: '0x',
      maxFeePerGas: '2', maxPriorityFeePerGas: '1',
    };
    const raw = await sourceWallet.signTransaction({
      type: approval.type, chainId: approval.chainId, nonce: Number(approval.nonce),
      to: approval.to, value: approval.value, gasLimit: approval.gasLimit,
      maxFeePerGas: approval.maxFeePerGas, maxPriorityFeePerGas: approval.maxPriorityFeePerGas,
    });
    const hash = Transaction.from(raw).hash!;
    const transfers = f.runtime.transfers!;
    const before = f.read().signedRecords;
    let broadcasts = 0;
    const broadcast: EvmSignedBroadcast<string> = ({ rawTransaction: approvedBytes, admit }) => admit(async () => {
      broadcasts++;
      assert.equal(approvedBytes, raw);
      assert.equal(f.read().signedRecords.length, before.length + 1);
      const record = await new EvmSignedRecords(f.store.signedRecords).readExact(
        { keyring: f.keyring, assertCurrent: guard }, approval.chainId, approval.from, hash
      );
      assert.equal(record?.rawTransaction, raw);
      return hash;
    });
    const guard = () => undefined;
    const verifyDispatch: NativeTransferDispatchValidation = async (planner, assertCurrent) => {
      const plan = await planner({ latest: 0, pending: 0, readPending: async () => null, assertCurrent });
      assert.equal(plan.kind, 'ready');
      if (plan.kind === 'ready') assert.equal(plan.nonce, Number(approval.nonce));
    };
    await assert.rejects(transfers.submit(raw, hash, guard, { broadcast: broadcast, verifyChain: async () => undefined }, undefined, undefined as never));
    await assert.rejects(transfers.submit(raw, hash, guard, { broadcast: broadcast, verifyChain: async () => undefined }, undefined, approval));
    await assert.rejects(
      transfers.submit(raw, hash, guard, { broadcast: broadcast, verifyChain: async () => undefined }, undefined, { ...approval, nonce: '1' }, undefined, verifyDispatch),
      { transactionNotBroadcast: true }
    );
    assert.deepEqual(f.read().signedRecords, before);
    assert.equal(broadcasts, 0);
    await transfers.submit(raw, hash, guard, { broadcast: broadcast, verifyChain: async () => undefined }, undefined, approval, undefined, verifyDispatch);
    assert.equal(broadcasts, 1);
  } finally {
    await f.close();
  }
});

test('retired imported signed bytes survive recovery without resurrecting an account or granting replay', async () => {
  const f = await fixture();
  let recovery: NativeRecoveryCoordinator | undefined;
  try {
    const network = getNativeNetwork('ethereum');
    const raw = await importedWallet.signTransaction({ type: 2, chainId: 1, nonce: 0, to: sourceWallet.address, value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
    const transaction = Transaction.from(raw);
    const records = new EvmSignedRecords(f.store.signedRecords, () => 1000);
    await records.append({ keyring: f.keyring, assertCurrent() {} }, {
      rawTransaction: raw, hash: transaction.hash!, from: importedWallet.address, chainId: '1', nonce: 0, type: 2,
      context: { account: { id: 0, type: 'Imported', address: importedWallet.address }, operation: 'send',
        network: { kind: 'ethereum', chainId: 1, slip44: 60, url: network.rpcUrl } },
    });
    f.owner.lock();
    recovery = f.coordinator();
    const state = f.read();
    const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    assert.deepEqual(
      f.read(),
      state,
      'verification does not rewrite the retained bundle'
    );
    await recovery.commit(proof);
    assert.deepEqual(f.read().signedRecords, state.signedRecords);
    assert.equal(state.signedRecords.length, 1);
    await f.reopen();
    await f.owner.unlock(NEXT);
    assert.equal(f.owner.getCatalogue()!.accounts.some((account) => account.type === 'Imported'), false);
    const restored = await new EvmSignedRecords(f.store.signedRecords).readExact({ keyring: f.keyring, assertCurrent() {} }, '1', importedWallet.address, transaction.hash!);
    assert.equal(restored?.rawTransaction, raw);
    let broadcasts = 0;
    await assert.rejects(f.runtime.transfers!.submit(raw, transaction.hash!, () => undefined,
      { broadcast: ({ admit }) => admit(async () => { broadcasts++; return transaction.hash!; }), verifyChain: async () => undefined }, undefined, {
        type: 2, accessList: [], chainId: '1', nonce: '0', from: importedWallet.address, to: sourceWallet.address,
        value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1',
      }));
    assert.equal(broadcasts, 0, 'historical attribution does not select or authorize a missing account');
  } finally {
    await recovery?.dispose();
    await f.close();
  }
});

test('a live imported account missing its recovery envelope still blocks preserving recovery', async () => {
  const f = await fixture();
  let recovery: NativeRecoveryCoordinator | undefined;
  try {
    await f.owner.importAccount({ privateKey: KEY, expectedAddress: importedWallet.address, label: 'Live imported' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined));
    const catalogue = JSON.parse(f.read().records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value);
    catalogue.recovery = [];
    f.write(WALLET_CATALOGUE_KEY, catalogue);
    f.owner.lock();
    recovery = f.coordinator();
    const before = f.read();
    await assert.rejects(
      prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined),
      { code: 'INVALID_SAVED_DATA' }
    );
    assert.deepEqual(f.read(), before);
  } finally {
    await recovery?.dispose();
    await f.close();
  }
});

test('recovery waits for a locked old owner to drain an admitted real SDK secret operation', async () => {
  const pause = latch(); let hold = false;
  class DelayedOperation extends sdk.HostKeyring {
    override withSecretOperation<T>(
      credential: Parameters<InstanceType<typeof sdk.HostKeyring>['withSecretOperation']>[0],
      options: Parameters<InstanceType<typeof sdk.HostKeyring>['withSecretOperation']>[1],
      work: (secret: string) => T | Promise<T>
    ): Promise<T> {
      return super.withSecretOperation(credential, options, async secret => {
        if (hold) { pause.enter(); await pause.gate; }
        return work(secret);
      });
    }
  }
  const f = await fixture(async () => ({ ...sdk, HostKeyring: DelayedOperation }));
  f.owner.lock(); hold = true;
  const oldUnlock = f.owner.unlock(OLD).catch((error) => error);
  await pause.reached; f.owner.lock(); const recovery = f.coordinator();
  try {
    const pending = prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.opens, 1, 'recovery cannot acquire the old lease early');
    hold = false; pause.release(); await oldUnlock;
    const proof = await pending; assert.equal(f.opens, 2);
    await recovery.commit(proof); await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { pause.release(); await recovery.dispose(); await f.close(); }
});

for (const boundary of ['write', 'committed'] as const) {
  test(`cancellation at ${boundary} discards completion while preserving an atomic old or new state`, async () => {
    const f = await fixture(); f.owner.lock(); const recovery = f.coordinator(); const pause = latch();
    try {
      const before = f.read(), proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined); let held = false;
      const pauseOnce: SqlHook = async (_kind, sql) => {
        if (!held && (boundary === 'write' ? sql.startsWith('UPDATE keyring_records') : sql === 'COMMIT')) { held = true; pause.enter(); await pause.gate; }
      };
      if (boundary === 'write') f.setHook(pauseOnce); else f.setAfter(pauseOnce);
      const pending = recovery.commit(proof); await pause.reached;
      recovery.cancel(); pause.release(); await assert.rejects(pending, { code: 'CANCELLED' });
      f.setHook(); f.setAfter();
      assert.deepEqual(retained(f.read()), retained(before));
      if (boundary === 'write') assert.deepEqual(f.read(), before);
      await f.reopen(); await f.owner.unlock(boundary === 'write' ? OLD : NEXT);
      assert.equal(f.owner.getSnapshot().phase, 'ready');
    } finally { pause.release(); f.setHook(); f.setAfter(); await recovery.dispose(); await f.close(); }
  });
}

test('normal unlock verifies the declared profile and stale data operations reject a changed pair with the same binding', async () => {
  const f = await fixture();
  f.owner.lock();
  const recovery = f.coordinator();
  try {
    const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined); await recovery.commit(proof);
    await f.reopen(); await f.owner.unlock(NEXT);
    const identity = (await f.store.recovery.readIdentity())!;
    const before = await f.store.recovery.readSnapshot(), pair = validPair(77);
    const write = await f.store.recovery.prepareReplacement!(before, { publicSession: storageOnlyPublicSession(identity.walletBindingId), vault: pair.vault, keys: pair['vault-keys'], pin: await createTestPinRecord(f.store, { vault: pair.vault, keys: pair['vault-keys'] }, identity.walletBindingId) }, identity.root!);
    await f.store.recovery.commitReplacement!(write, () => undefined);
    await f.store.removal!.settlePinCredential(record => pinCredential.remove(record));
    await assert.rejects(f.runtime.tokens!.load(() => undefined), { code: 'CANCELLED' });
  } finally { await recovery.dispose(); await f.close(); }

  const g = await fixture();
  try {
    const identity = await g.store.recovery.readIdentity();
    const catalogue = JSON.parse(g.read().records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value);
    g.meta('identity', {
      version: 1,
      walletBindingId: identity!.walletBindingId,
      pairFingerprint: identity!.pairFingerprint,
      root: {
        address: catalogue.groups[0].accounts.HDAccount[0].address,
        publicKey: catalogue.groups[0].accounts.HDAccount[0].xpub,
        profileId: `0x${'f'.repeat(64)}`,
      },
    });
    g.owner.lock();
    await assert.rejects(g.owner.unlock(OLD));
    assert.equal(g.owner.getSnapshot().phase, 'locked');
    await assert.rejects(g.runtime.transfers!.journal(() => undefined));
  } finally {
    await g.close();
  }
});

test('operational SDK failure is sanitized and never charged as a wrong phrase', async () => {
  const f = await fixture();
  f.owner.lock();
  class Failed extends sdk.SoftwareKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
      super(...args);
      this.deriveEvmHdRuntimeAccount = async () => {
        throw new Error('private diagnostic must not escape');
      };
    }
  }
  const recovery = f.coordinator(async () => ({
    ...sdk,
    SoftwareKeyring: Failed,
  }));
  try {
    const before = f.read(); await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
    assert.deepEqual(f.read(), before);
  } finally { await recovery.dispose(); await f.close(); }
});

test('five wrong phrases retain throttling and successful recovery does not invent an unconfirmed backup', async () => {
  const f = await fixture(undefined, false); f.owner.lock(); const recovery = f.coordinator();
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(prepareRecoveryPin(recovery, WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    assert.equal(JSON.parse(f.read().metadata.find((row) => row.key === 'auth')!.value).failures, 5);
  } finally { await recovery.dispose(); await f.close(); }

  const g = await fixture(undefined, false); g.owner.lock(); const unconfirmed = g.coordinator();
  try {
    const proof = await prepareRecoveryPin(unconfirmed, PHRASE, NEXT, () => undefined); await unconfirmed.commit(proof);
    await g.reopen(); await g.owner.unlock(NEXT);
    assert.equal(g.owner.getSnapshot().phase, 'backup-required');
    assert.equal(g.read().metadata.some((row) => row.key === 'backup'), false);
  } finally { await unconfirmed.dispose(); await g.close(); }
});

test('missing required vault keys refuse recovery without recreating or erasing the remaining data', async () => {
  const f = await fixture(); f.owner.lock(); f.remove('vault-keys'); const recovery = f.coordinator();
  try {
    const before = f.read(); await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'UNAVAILABLE' });
    assert.deepEqual(f.read(), before);
  } finally { await recovery.dispose(); await f.close(); }
});

test('recovery retry cooldown elapses on the owned connection despite wall-clock changes', async () => {
  let monotonic = 0, wall = 1_000_000;
  const f = await fixture(undefined, false, { wall: () => wall, monotonic: () => monotonic });
  f.owner.lock(); const recovery = f.coordinator();
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(prepareRecoveryPin(recovery, WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    const saved = f.read(); monotonic = 29999; wall += 86400000;
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    assert.deepEqual(f.read(), saved);
    assert.equal(f.opens, 2, 'retryable attempts must retain one recovery-owned connection');
    monotonic = 30000; wall = 1;
    const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    await recovery.commit(proof); await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
    assert.equal(JSON.parse(f.read().metadata.find((row) => row.key === 'auth')!.value).failures, 0);
  } finally { await recovery.dispose(); await f.close(); }
});

test('recovery can wait out failures inherited from ordinary password authentication', async () => {
  let monotonic = 0;
  const f = await fixture(undefined, true, { wall: () => 1_000_000, monotonic: () => monotonic });
  f.owner.lock(); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(f.owner.unlock('000000'), { code: 'INVALID_CREDENTIAL' });
    recovery = f.coordinator();
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    monotonic = 29999;
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    assert.equal(f.opens, 2);
    monotonic = 30000; const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    await recovery.commit(proof); await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { await recovery?.dispose(); await f.close(); }
});

test('another wrong phrase after waiting preserves escalation and cannot reset the throttle', async () => {
  let monotonic = 0;
  const f = await fixture(undefined, true, { wall: () => 1_000_000, monotonic: () => monotonic });
  f.owner.lock(); const recovery = f.coordinator();
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(prepareRecoveryPin(recovery, WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    monotonic = 30000;
    await assert.rejects(prepareRecoveryPin(recovery, WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    const saved = f.read(); assert.equal(JSON.parse(saved.metadata.find((row) => row.key === 'auth')!.value).failures, 6);
    monotonic = 89999;
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    assert.deepEqual(f.read(), saved); assert.equal(f.opens, 2);
    monotonic = 90000; const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    await recovery.commit(proof);
  } finally { await recovery.dispose(); await f.close(); }
});

test('cancel drains a retained recovery connection and a fresh owner still enforces restart cooldown', async () => {
  let monotonic = 0;
  const f = await fixture(undefined, true, { wall: () => 1_000_000, monotonic: () => monotonic });
  f.owner.lock(); const recovery = f.coordinator();
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(prepareRecoveryPin(recovery, WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    assert.equal(f.leased, true); const before = f.read();
    recovery.cancel(); await recovery.dispose(); assert.equal(f.leased, false); assert.deepEqual(f.read(), before);
    await f.reopen(); await assert.rejects(f.owner.unlock(OLD), { code: 'AUTH_THROTTLED' });
    monotonic = 30000; await f.owner.unlock(OLD); assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { await recovery.dispose(); await f.close(); }
});

test('expiry closes a retryable recovery lease without another submission', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let monotonic = 0;
  const f = await fixture(undefined, true, { wall: () => 1_000_000, monotonic: () => monotonic });
  f.owner.lock(); const recovery = f.coordinator();
  try {
    await assert.rejects(prepareRecoveryPin(recovery, WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    assert.equal(f.leased, true); const before = f.read();
    monotonic = 600001; context.mock.timers.tick(600001);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.leased, false); assert.deepEqual(f.read(), before);
  } finally { await recovery.dispose(); await f.close(); context.mock.timers.reset(); }
});

test('retained recovery close failure quarantines retries without changing saved bytes', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  try {
    await assert.rejects(prepareRecoveryPin(recovery, WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    const before = f.read(); f.failClose(); recovery.cancel();
    await assert.rejects(recovery.dispose(), { code: 'REOPEN_REQUIRED' });
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'NOT_READY' });
    assert.deepEqual(f.read(), before); assert.equal(f.opens, 2);
  } finally { await recovery.dispose().catch(() => undefined); await f.close(); }
});

test('an old recovery coordinator cannot charge or replace a newer recovered pair', async () => {
  const f = await fixture(); f.owner.lock(); const old = f.coordinator(); let next: NativeRecoveryCoordinator | undefined;
  try {
    await assert.rejects(prepareRecoveryPin(old, WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    old.cancel(); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.leased, false);
    await f.reopen(); next = f.coordinator();
    await next.commit(await prepareRecoveryPin(next, PHRASE, NEXT, () => undefined));
    const committed = f.read();
    await assert.rejects(prepareRecoveryPin(old, PHRASE, '456789', () => undefined), { code: 'STATE_CHANGED' });
    assert.deepEqual(f.read(), committed);
  } finally { await old.dispose(); await next?.dispose(); await f.close(); }
});

test('a reentrant cancellation from the final commit guard rolls back before COMMIT', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  let metadataWrites = 0, expectedWrites = Infinity, finalChecks = 0, cancelled = false;
  const guard = () => {
    if (metadataWrites === expectedWrites && ++finalChecks === 2) { cancelled = true; recovery.cancel(); }
  };
  try {
    const before = f.read(), proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, guard);
    expectedWrites = before.metadata.filter(row => ['identity', 'auth', 'backup', 'local-pin-v1'].includes(String(row.key))).length;
    f.setAfter((_kind, sql) => { if (sql.startsWith('INSERT INTO wallet_metadata')) metadataWrites++; });
    await assert.rejects(recovery.commit(proof), { code: 'CANCELLED' });
    assert.equal(cancelled, true);
    assert.deepEqual(f.read(), before);
  } finally { f.setAfter(); await recovery.dispose(); await f.close(); }
});

for (const boundary of ['cancellation', 'expiry'] as const) {
  test(`microtask ${boundary} after the operation guard stops before COMMIT dispatch`, async () => {
    const f = await fixture(); f.owner.lock(); let time = 0;
    const recovery = f.coordinator(undefined, () => time);
    let metadataWrites = 0, expectedWrites = Infinity, queued = false, revoked = false;
    const guard = () => {
      if (metadataWrites === expectedWrites && !queued) {
        queued = true;
        queueMicrotask(() => { revoked = true; if (boundary === 'cancellation') recovery.cancel(); else time = 600001; });
      }
    };
    try {
      const before = f.read(), proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, guard);
    expectedWrites = before.metadata.filter(row => ['identity', 'auth', 'backup', 'local-pin-v1'].includes(String(row.key))).length;
      f.dispatched.length = 0;
      f.setAfter((_kind, sql) => { if (sql.startsWith('INSERT INTO wallet_metadata')) metadataWrites++; });
      await assert.rejects(recovery.commit(proof), { code: 'CANCELLED' });
      assert.equal(revoked, true);
      assert.equal(f.dispatched.includes('COMMIT'), false, 'revoked recovery must not dispatch a commit');
      assert.equal(f.dispatched.includes('ROLLBACK'), true);
      assert.deepEqual(f.read(), before);
    } finally { f.setAfter(); await recovery.dispose(); await f.close(); }
  });
}

test('cancellation after COMMIT dispatch reconciles the complete new pair without compensation', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  let queued = false;
  try {
    const before = f.read(), proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    f.dispatched.length = 0;
    f.setDispatch((sql) => { if (sql === 'COMMIT' && !queued) { queued = true; queueMicrotask(() => recovery.cancel()); } });
    await assert.rejects(recovery.commit(proof), { code: 'CANCELLED' });
    f.setDispatch();
    assert.equal(queued, true);
    assert.equal(f.dispatched.filter((sql) => sql === 'COMMIT').length, 1);
    assert.deepEqual(retained(f.read()), retained(before));
    assert.notDeepEqual(f.read().records.filter((row) => ['vault', 'vault-keys'].includes(row.key)),
      before.records.filter((row) => ['vault', 'vault-keys'].includes(row.key)));
    await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { f.setDispatch(); await recovery.dispose(); await f.close(); }
});

test('cancellation before the first snapshot cannot let an old helper adopt a newer pair', async () => {
  const f = await fixture(); f.owner.lock(); const old = f.coordinator();
  let next: NativeRecoveryCoordinator | undefined, cancelled = false;
  try {
    f.setAfter((_kind, sql) => {
      if (!cancelled && sql.includes('ORDER BY source, key')) { cancelled = true; old.cancel(); }
    });
    await assert.rejects(prepareRecoveryPin(old, PHRASE, NEXT, () => undefined), { code: 'CANCELLED' });
    f.setAfter(); assert.equal(cancelled, true);
    await f.reopen(); next = f.coordinator();
    await next.commit(await prepareRecoveryPin(next, PHRASE, NEXT, () => undefined));
    const newer = f.read();
    await assert.rejects(prepareRecoveryPin(old, PHRASE, '456789', () => undefined), { code: 'STATE_CHANGED' });
    assert.deepEqual(f.read(), newer);
  } finally { f.setAfter(); await old.dispose(); await next?.dispose(); await f.close(); }
});

test('the first in-flight recovery retains its original pair across retirement and a newer recovery', async () => {
  const f = await fixture(); f.owner.lock(); const pause = latch();
  const old = new NativeRecoveryCoordinator({ pinCredential, owner: f.owner, async retireControllers() {}, openStorage: f.open,
    ensureCryptoReady: async () => { pause.enter(); await pause.gate; } });
  let next: NativeRecoveryCoordinator | undefined;
  try {
    const pending = prepareRecoveryPin(old, PHRASE, '456789', () => undefined);
    await pause.reached;
    await f.reopen(); next = f.coordinator();
    await next.commit(await prepareRecoveryPin(next, PHRASE, NEXT, () => undefined));
    const newer = f.read(); pause.release();
    await assert.rejects(pending, { code: 'STATE_CHANGED' });
    assert.deepEqual(f.read(), newer);
    await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { pause.release(); await old.dispose(); await next?.dispose(); await f.close(); }
});

test('original-pair capture drains runtime work outside authority pending before releasing its lease', async () => {
  const pause = latch();
  let hold = false;
  class DelayedPhrase extends sdk.HostKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...args); const read = this.getSeed.bind(this);
      this.getSeed = async (password) => { const phrase = await read(password); if (hold) { pause.enter(); await pause.gate; } return phrase; };
    }
  }
  const f = await fixture(async () => ({
    ...sdk,
    HostKeyring: DelayedPhrase,
  }));
  const original = await f.store.getWalletFingerprint();
  hold = true;
  const reading = f.runtime
    .backup!.readPhrase(OLD)
    .catch((error: unknown) => error);
  await pause.reached;
  const owned = f.store,
    readPair = owned.getWalletFingerprint.bind(owned);
  let captures = 0;
  owned.getWalletFingerprint = async () => { captures++; assert.equal(hold, false); assert.equal(f.opens, 1); const pair = await readPair(); assert.equal(pair, original); return pair; };
  f.owner.lock();
  const recovery = f.coordinator();
  try {
    const pending = prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(captures, 0);
    assert.equal(f.opens, 1);
    await assert.rejects(
      f.open(),
      /old authority must release its database lease/
    );
    hold = false;
    pause.release();
    assert.ok(
      (await reading) instanceof Error,
      'the retired reader cannot disclose its phrase'
    );
    const proof = await pending;
    assert.equal(captures, 1);
    assert.equal(f.opens, 2);
    await recovery.commit(proof);
    await f.reopen();
    await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally {
    hold = false;
    pause.release();
    await recovery.dispose();
    await f.close();
  }
});

test('failure to capture the original pair still closes its lease and returns no recovery proof', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  const before = f.read();
  f.store.getWalletFingerprint = async () => { throw Error('private capture diagnostic'); };
  try {
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
    assert.deepEqual(f.read(), before);
    // A failed retirement remains failed; a fresh owner must qualify a new lease.
    const replacement = new NativeCustodyAuthority(createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: async (_request, _signal, check, verify) => { check(); const result = await verify({ method: 'pin', pin: OLD }, check); if (!result.accepted) throw Error(result.reason); }, privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null, ensureCryptoReady: async () => undefined, openStorage: f.open }));
    try { await replacement.initialize(); await replacement.unlock(OLD); assert.equal(replacement.getSnapshot().phase, 'ready'); }
    finally { await replacement.dispose(); }
  } finally { await recovery.dispose(); await f.close(); }
});

test('recovery view model drives the real SDK and SQLite coordinator then requires explicit fresh-owner unlock', async () => {
  const f = await fixture(); f.owner.lock(); let coordinator: NativeRecoveryCoordinator | undefined;
  const before = f.read(); let completed = false;
  const flow = new NativeRecoveryFlow({
    readInventory: () => readRecoveryInventory(f.store), isCurrent: () => true,
    createCoordinator() { coordinator = f.coordinator(); return coordinator; },
    async finish(outcome) {
      assert.equal(outcome.kind, 'success');
      await coordinator!.dispose(); await f.owner.dispose(); await f.reopen();
      assert.equal(f.owner.getSnapshot().phase, 'locked'); completed = true;
    },
  });
  const waitFor = async (condition: () => boolean) => {
    const deadline = performance.now() + 20000;
    while (!condition() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert(condition(), `unexpected recovery phase: ${flow.getSnapshot().phase}`);
  };
  try {
    flow.start(); await waitFor(() => flow.getSnapshot().phase === 'scope'); flow.enter();
    assert.equal(flow.submit({ phrase: PHRASE }), true);
    await waitFor(() => flow.getSnapshot().phase === 'review');
    assert.equal(f.owner.getSnapshot().phase, 'disposed'); assert.deepEqual(f.read(), before);
    assert(!JSON.stringify(flow.getSnapshot()).includes(PHRASE)); assert(!JSON.stringify(flow.getSnapshot()).includes(NEXT));
    flow.commit(); assert.equal(flow.submitPin(NEXT), true); await waitFor(() => completed && flow.getSnapshot().phase === 'closed');
    assert.deepEqual(retained(f.read()), retained(before));
    await assert.rejects(f.owner.unlock(OLD)); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { flow.cancel(); await coordinator?.dispose(); await f.close(); }
});

/** Synthetic bearer notes only; real released SDK encryption, no private SDK fields. */
async function noteBundle(count = 17) {
  const values = new Map<string, unknown>();
  const keyring = new sdk.SoftwareKeyring(sdk.createKeyringHost({
    async get(key) { return values.get(key); }, async set(key, value) { values.set(key, value); }, async deleteItem(key) { values.delete(key); },
    async createManyIfAbsent(items) { if (Object.keys(items).some((key) => values.has(key))) return false; Object.entries(items).forEach(([k, v]) => values.set(k, v)); return true; },
  }), { captureEvmSubmission: null });
  await keyring.initializeSession(PHRASE, `Pali#1:${'ab'.repeat(32)}`);
  const profile = await keyring.getPrivateRecordProfileId(); let seq = 0;
  const id = () => `00000000-0000-4000-8000-${(++seq).toString().padStart(12, '0')}`;
  const notes = Array.from({ length: count }, (_, i) => ({ id: id(), createdAt: 1, note: `tornado-eth-1-1-0x${(i + 1).toString(16).padStart(124, '0')}` }));
  const shards = [];
  for (let i = 0; i < notes.length; i += 16) shards.push(await keyring.encryptPrivateRecord({ domain: 'org.syscoin.pali.privacy.notes.shard.v2', recordId: id(), plaintext: new TextEncoder().encode(JSON.stringify({ version: 1, notes: notes.slice(i, i + 16) })) }));
  if (!shards.length) shards.push(await keyring.encryptPrivateRecord({ domain: 'org.syscoin.pali.privacy.notes.shard.v2', recordId: id(), plaintext: new TextEncoder().encode(JSON.stringify({ version: 1, notes: [] })) }));
  const root = await keyring.encryptPrivateRecord({ domain: 'org.syscoin.pali.privacy.notes.v1', recordId: id(), plaintext: new TextEncoder().encode(JSON.stringify({
    format: 'pali-private-note-vault', version: 1, noteCount: count, capacity: count > 128 ? 512 : 128, restore: { version: 1 },
    shards: shards.map((shard, i) => ({ recordId: shard.recordId, hash: envelopeHash(shard), count: Math.min(16, count - i * 16) })),
  })) });
  return { keyring, profile, bundle: { format: 'pali-private-note-vault', version: 1, root, shards } };
}

test('real SDK recovery retires the exact enrollment and preserves multi-shard notes and retained records', async () => {
  const f = await fixture(), data = await noteBundle(); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    const enrollment = f.store.deviceUnlockEnrollment;
    const old = (await enrollment.read())!;
    const id = 'a1'.repeat(16);
    assert.equal(await enrollment.compareAndSet(old, id, () => undefined), true);
    const active = (await enrollment.read())!;
    assert.equal(active.enrollmentId, id);
    f.notes(data.profile, data.bundle, await f.store.getWalletFingerprint());
    const original = f.read(); const inventory = await readRecoveryInventory(f.store);
    assert.equal(inventory.privateNotes, 'requires-matching-phrase-verification');
    assert.equal(JSON.stringify(inventory).includes(data.profile), false);
    assert.equal(JSON.stringify(inventory).includes(id), false);
    f.owner.lock(); recovery = f.coordinator(); const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    assert.equal(await recovery.commit(proof), 'committed-locked');
    assert.deepEqual(f.read().notes, original.notes); assert.deepEqual(retained(f.read()), retained(original));
    assert.equal(f.read().metadata.some((row) => row.key === 'device-unlock-enrollment'), false);
    await f.reopen(); await f.owner.unlock(NEXT);
    const newEnrollment = f.store.deviceUnlockEnrollment;
    const fresh = (await newEnrollment.read())!;
    assert.equal(fresh.enrollmentId, null);
    assert.equal(fresh.walletBindingId, old.walletBindingId);
    assert.notEqual(fresh.pairFingerprint, old.pairFingerprint);
    await assert.rejects(newEnrollment.compareAndSet(active, id, () => undefined), { code: 'STORAGE_CHANGED' });
    const result = await readPrivateVaultBundle(data.bundle, createPrivateVaultSession({ keyring: data.keyring, generation: 1, assertCurrent() {} }));
    assert.equal(result.manifest.notes.length, 17);
  } finally { await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});

for (const [shape, bytes] of [
  ['oversized text', '78'.repeat(300)],
  ['embedded NUL', '610062'],
  ['invalid UTF-8', '8061'],
] as const) {
  test(`enrollment with ${shape} cannot block password unlock or matching-phrase recovery`, async () => {
    const f = await fixture(); let recovery: NativeRecoveryCoordinator | undefined;
    const metadataKey = 'device-unlock-enrollment';
    try {
      f.metaHex(metadataKey, bytes);
      await f.reopen(); await f.owner.unlock(OLD);
      assert.equal(f.owner.getSnapshot().phase, 'ready');
      const enrollment = f.store.deviceUnlockEnrollment;
      const inactive = (await enrollment.read())!;
      assert.equal(inactive.enrollmentId, null);
      if (shape === 'oversized text')
        await assert.rejects(enrollment.compareAndSet(inactive, 'a1'.repeat(16), () => undefined), { code: 'STORAGE_CHANGED' });
      assert.equal(f.metaHex(metadataKey), bytes.toUpperCase());
      const original = f.read(); f.owner.lock(); recovery = f.coordinator();
      const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
      assert.equal(await recovery.commit(proof), 'committed-locked');
      assert.deepEqual(retained(f.read()), retained(original));
      assert.equal(f.metaHex(metadataKey), undefined);
      await f.reopen(); await f.owner.unlock(NEXT);
      assert.equal(f.owner.getSnapshot().phase, 'ready');
      assert.equal((await f.store.deviceUnlockEnrollment.read())?.enrollmentId, null);
    } finally { await recovery?.dispose(); await f.close(); }
  });
}

test('matching phrase plus damaged retained note AEAD refuses recovery without any rewrite', async () => {
  const f = await fixture(), data = await noteBundle(1); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    data.bundle.shards[0]!.ciphertext = (data.bundle.shards[0]!.ciphertext[0] === 'A' ? 'B' : 'A') + data.bundle.shards[0]!.ciphertext.slice(1);
    // Authenticate a root which references the damaged shard, so this reaches
    // the SDK AEAD rejection rather than only the outer shard-hash check.
    const rootBytes = await data.keyring.decryptPrivateRecord({ domain: data.bundle.root.domain, recordId: data.bundle.root.recordId, envelope: data.bundle.root });
    const root = JSON.parse(new TextDecoder().decode(rootBytes)); rootBytes.fill(0);
    root.shards[0].hash = envelopeHash(data.bundle.shards[0]!);
    data.bundle.root = await data.keyring.encryptPrivateRecord({ domain: data.bundle.root.domain, recordId: data.bundle.root.recordId, plaintext: new TextEncoder().encode(JSON.stringify(root)) });
    f.notes(data.profile, data.bundle, await f.store.getWalletFingerprint()); f.owner.lock(); recovery = f.coordinator(); const before = f.read();
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined), { code: 'INVALID_SAVED_DATA' }); assert.deepEqual(f.read(), before);
  } finally { await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});

test('a changed note row after proof invalidates the whole replacement CAS', async () => {
  const f = await fixture(), data = await noteBundle(1); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    const binding = await f.store.getWalletFingerprint(); f.notes(data.profile, data.bundle, binding); f.owner.lock(); recovery = f.coordinator();
    const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    data.bundle.root.ciphertext = (data.bundle.root.ciphertext[0] === 'A' ? 'B' : 'A') + data.bundle.root.ciphertext.slice(1); f.notes(data.profile, data.bundle, binding); const changed = f.read();
    await assert.rejects(recovery.commit(proof), { code: 'STATE_CHANGED' }); assert.deepEqual(f.read(), changed);
  } finally { await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});

test('shared actualSDK inspector accepts512unique notes and rejects a duplicated shard identity', async () => {
  const data = await noteBundle(512);
  try {
    const session = createPrivateVaultSession({ keyring: data.keyring, generation: 1, assertCurrent() {} });
    const result = await readPrivateVaultBundle(data.bundle, session); assert.equal(result.manifest.notes.length, 512); assert.equal(result.capacity, 512);
    assert.equal(new Set(result.manifest.notes.map((note) => note.id)).size, 512);
    assert.equal(new Set(result.manifest.notes.map((note) => note.note)).size, 512);
    const forged = { ...data.bundle, shards: [...data.bundle.shards, data.bundle.shards[0]!] };
    await assert.rejects(readPrivateVaultBundle(forged, session));
  } finally { await data.keyring.lockWallet(); }
});

test('cancellation during actualSDK note decrypt discards successful stale work and preserves bytes', async () => {
  const f = await fixture(), data = await noteBundle(1), pause = latch(); let recovery: NativeRecoveryCoordinator | undefined;
  class Delayed extends sdk.SoftwareKeyring {
    override async decryptPrivateRecord(params: Parameters<typeof data.keyring.decryptPrivateRecord>[0]) { pause.enter(); await pause.gate; return super.decryptPrivateRecord(params); }
  }
  try {
    f.notes(data.profile, data.bundle, await f.store.getWalletFingerprint()); f.owner.lock(); recovery = f.coordinator(async () => ({ ...sdk, SoftwareKeyring: Delayed }));
    const before = f.read(), pending = prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined); await pause.reached; recovery.cancel(); pause.release();
    await assert.rejects(pending, { code: 'CANCELLED' }); assert.deepEqual(f.read(), before);
  } finally { pause.release(); await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});

test('wrong valid phrase with retained notes counts one failure and leaves every note byte intact', async () => {
  const f = await fixture(), data = await noteBundle(1); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    f.notes(data.profile, data.bundle, await f.store.getWalletFingerprint()); f.owner.lock(); recovery = f.coordinator(); const before = f.read();
    await assert.rejects(prepareRecoveryPin(recovery, WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    assert.deepEqual(f.read().notes, before.notes); assert.deepEqual(f.read().records, before.records);
    assert.equal(JSON.parse(f.read().metadata.find((row) => row.key === 'auth')!.value).failures, 1);
  } finally { await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});


test('shared actualSDK inspector rejects an authenticated bundle containing513unique notes', async () => {
  const data = await noteBundle(513);
  try {
    const rootBytes = await data.keyring.decryptPrivateRecord({ domain: data.bundle.root.domain, recordId: data.bundle.root.recordId, envelope: data.bundle.root });
    const root = JSON.parse(new TextDecoder().decode(rootBytes)); rootBytes.fill(0);
    assert.equal(root.noteCount, 513); assert.equal(root.capacity, 512); assert.equal(root.shards.length, 33);
    const ids = new Set<string>(), notes = new Set<string>();
    assert.equal(new Set(data.bundle.shards.map((shard) => shard.recordId)).size, 33);
    for (const [index, shard] of data.bundle.shards.entries()) {
      assert.equal(root.shards[index].hash, envelopeHash(shard));
      const bytes = await data.keyring.decryptPrivateRecord({ domain: shard.domain, recordId: shard.recordId, envelope: shard });
      const plain = JSON.parse(new TextDecoder().decode(bytes)); bytes.fill(0);
      assert.equal(plain.notes.length, root.shards[index].count);
      for (const note of plain.notes) { ids.add(note.id); notes.add(note.note); }
    }
    assert.equal(ids.size, 513); assert.equal(notes.size, 513);
    await assert.rejects(readPrivateVaultBundle(data.bundle, createPrivateVaultSession({ keyring: data.keyring, generation: 1, assertCurrent() {} })), { message: 'privacy_vault_corrupt' });
  } finally { await data.keyring.lockWallet(); }
});


type RecoveryFixture = Awaited<ReturnType<typeof fixture>>;
const selectNetwork = (f: RecoveryFixture, id: string) => f.owner.selectNetwork(
  id, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision
, () => {});
const accountRecord = async (f: RecoveryFixture) =>
  await f.store.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;

test('Sentry buckets survive cold unlock and recovery, then explicit wallet removal clears them', async () => {
  const f = await fixture();
  const current = () => undefined;
  let recovery: NativeRecoveryCoordinator | undefined;
  let removal: NativeWalletRemoval | undefined;
  let cleared = 0;
  const removalForCurrentOwner = () =>
    new NativeWalletRemoval({
      owner: f.owner,
      source: () => ({ runtime: f.runtime, storage: f.store }),
      reopen: f.open,
      clearNativeSelection: async () => {
        cleared++;
      },
      beforeSnapshot: async (check) => { check(); },
      assertActive: current,
    });
  try {
    const scopes: {
      network: 'mainnet' | 'testnet';
      vaultId: string;
      id: string;
    }[] = [];
    const networks = [
      ['syscoin', 'mainnet'],
      ['utxo:5700', 'testnet'],
    ] as const;
    for (const [networkId] of networks) await selectNetwork(f, networkId);
    removal = removalForCurrentOwner();
    const ticket = await removal.authorize(OLD, current);
    for (const [networkId, network] of networks) {
      const registration = getUtxoNetwork(networkId);
      const catalogue = await accountRecord(f);
      const first = catalogue.groups.find(
        (group) => group.key === String(registration.slip44)
      )!.accounts.HDAccount[0]!;
      const vaultId = createHash('sha256').update(first.xpub).digest('hex');
      const identity = (await f.store.recovery.readIdentity())!;
      const bind = f.store.sentryKeys.bind;
      const owner = {
        network,
        vaultId,
        ...identity,
        profileId: identity.root!.profileId,
      };
      const vault = createSentryKeyVault({
        ...bind(owner, current),
        crypto: () => webcrypto as unknown as Crypto,
      });
      const foreign = 'f'.repeat(64);
      const foreignVault = createSentryKeyVault({
        ...bind({ ...owner, vaultId: foreign }, current),
        crypto: () => webcrypto as unknown as Crypto,
      });
      await assert.rejects(foreignVault.listSentryKeys(foreign, network), {
        code: 'STORAGE_CHANGED',
      });
      const [summary] = await vault.saveSentryKeys({
        network,
        vaultId,
        seed: PHRASE,
        assertCurrent: current,
        entries: [
          {
            label: 'Synthetic key',
            key: {
              role: 'operator',
              scheme: 'bls-basic',
              publicKey: '12'.repeat(48),
              secretKey: '34'.repeat(32),
            },
          },
        ],
      });
      scopes.push({ network, vaultId, id: summary!.id });
    }
    const sentryRows = () =>
      f
        .read()
        .records.filter(({ key }) =>
          Object.values(SENTRY_SLOT_KEYS).some((slot) => key === slot)
        );
    const saved = sentryRows();
    assert.equal(saved.length, 2);
    await assert.rejects(removal.confirm(ticket, current), {
      code: 'STATE_CHANGED',
    });
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    assert.equal(cleared, 0);
    await removal.dispose();
    removal = undefined;
    await f.reopen();
    await f.owner.unlock(OLD);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    assert.equal(
      (await readRecoveryInventory(f.store)).status,
      'needs-matching-phrase-verification'
    );

    removal = removalForCurrentOwner();
    await removal.authorize(OLD, current);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    assert.equal(cleared, 0);
    await removal.dispose();
    removal = undefined;

    f.owner.lock();
    recovery = f.coordinator();
    const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, current);
    assert.equal(await recovery.commit(proof), 'committed-locked');
    assert.deepEqual(sentryRows(), saved);
    await f.reopen();
    await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    for (const { network, vaultId, id } of scopes) {
      const identity = (await f.store.recovery.readIdentity())!;
      const vault = createSentryKeyVault({
        ...f.store.sentryKeys.bind(
          {
            network,
            vaultId,
            ...identity,
            profileId: identity.root!.profileId,
          },
          current
        ),
        crypto: () => webcrypto as unknown as Crypto,
      });
      assert.equal(
        (
          await vault.loadSentryKey({
            network,
            vaultId,
            id,
            seed: PHRASE,
            assertCurrent: current,
          })
        ).publicKey,
        '12'.repeat(48)
      );
    }

    // A valid-shaped bucket with damaged ciphertext cannot earn a recovery proof.
    const testnet = saved.find(({ key }) => key === SENTRY_SLOT_KEYS.testnet)!;
    const broken = JSON.parse(testnet.value);
    const ciphertext = broken.keys[0].ciphertext as string;
    broken.keys[0].ciphertext =
      (ciphertext[0] === 'a' ? 'b' : 'a') + ciphertext.slice(1);
    f.write(testnet.key, broken);
    const beforeRejected = f.read();
    await recovery.dispose();
    f.owner.lock();
    recovery = f.coordinator();
    await assert.rejects(prepareRecoveryPin(recovery, PHRASE, OLD, current), {
      code: 'INVALID_SAVED_DATA',
    });
    assert.deepEqual(f.read(), beforeRejected);
    f.write(testnet.key, JSON.parse(testnet.value));
    await recovery.dispose();
    recovery = undefined;
    await f.reopen();
    await f.owner.unlock(NEXT);
    removal = removalForCurrentOwner();
    const confirmed = await removal.authorize(NEXT, current);
    assert.equal(await removal.confirm(confirmed, current), 'wallet-records-removed');
    assert.equal(cleared, 1);
    assert.deepEqual(f.read().records, []);
    assert.deepEqual(f.read().notes, []);
    assert.deepEqual(f.read().signedRecords, []);
  } finally {
    await removal?.dispose();
    await recovery?.dispose();
    await f.close();
  }
});

test('Sentry key management keeps approvals public and bound to the selected wallet and network', async (t) => {
  const guard = () => undefined;
  let hold: ReturnType<typeof latch> | undefined;
  const calls: { bytes: Uint8Array<ArrayBuffer>; signal: AbortSignal }[] = [];
  const derive: DeriveSentryPublicKey = async (_role, scheme, bytes, signal) => {
    assert.equal(bytes.byteLength, scheme === 'slh-dsa-shake-128s' ? 64 : 32);
    assert.equal(bytes.byteOffset, 0);
    assert.equal(bytes.buffer.byteLength, bytes.byteLength);
    assert.equal(signal.aborted, false);
    calls.push({ bytes, signal });
    // Take a synchronous copy before yielding, as the native executor must.
    const owned = bytes.slice();
    try {
      const gate = hold;
      if (gate) {
        gate.enter();
        await gate.gate;
      }
      const digest = createHash('sha384').update(owned).digest('hex');
      if (scheme === 'bls-basic') return digest;
      const pub = digest.slice(0, 64);
      return scheme === 'secp256k1' ? '02' + pub : pub;
    } finally {
      owned.fill(0);
    }
  };
  const dormant = await fixture();
  try {
    await selectNetwork(dormant, 'syscoin');
    assert.equal(dormant.runtime.openSentryKeyManagement, undefined);
    assert.equal(dormant.runtime.getSentryKeyNetwork, undefined);
  } finally {
    await dormant.close();
  }
  const f = await fixture(
    undefined,
    true,
    undefined,
    undefined,
    undefined,
    derive
  );
  const scope = new AbortController();
  const mainRow = () =>
    f.read().records.find(({ key }) => key === SENTRY_SLOT_KEYS.mainnet);
  try {
    const open = () => f.runtime.openSentryKeyManagement!(scope.signal, guard);
    await assert.rejects(open(), { code: 'NOT_READY' });
    assert.equal(f.runtime.getSentryKeyNetwork!(), undefined);
    await selectNetwork(f, 'syscoin');
    assert.equal(f.runtime.getSentryKeyNetwork!(), 'mainnet');
    const manager = await open();
    const shakeKey = '13'.repeat(16) + '24'.repeat(16) + '35'.repeat(16) + '46'.repeat(16);
    for (const offset of [0, 32]) {
      const privateLabel = shakeKey.slice(offset, offset + 32).toUpperCase();
      await assert.rejects(
        manager.prepareImport(`Node ${privateLabel} | 0x${shakeKey}`, 'operator', 'slh-dsa-shake-128s'),
        { code: 'INVALID_INPUT' }
      );
    }
    assert.equal(calls.at(-1), undefined);
    assert.equal(mainRow(), undefined);
    const secret = '00'.repeat(31) + '02';
    const input = 'Primary node | 0x' + secret;
    await assert.rejects(manager.prepareImport(input, 'voting', 'bls-basic'), {
      code: 'INVALID_INPUT',
    });
    const firstReview = await manager.prepareImport(
      input,
      'operator',
      'bls-basic'
    );
    const firstCall = calls.at(-1)!;
    assert.notEqual(firstCall.signal, scope.signal);
    assert.equal(firstCall.signal.aborted, false);
    assert(firstCall.bytes.every((byte) => byte === 0));
    f.setOperationPin(NEXT);
    const rejectedImport = assert.rejects(manager.confirmImport(firstReview), { code: 'CANCELLED' });
    const refusedImport = await f.waitOperationRefusal();
    assert.match(refusedImport.error!, /PIN not accepted/);
    assert.equal(mainRow(), undefined);
    refusedImport.cancel(); await rejectedImport;
    f.setOperationPin();
    assert.equal(firstCall.signal.aborted, true);
    assert.equal(mainRow(), undefined);
    await assert.rejects(manager.confirmImport(firstReview), {
      code: 'CANCELLED',
    });
    const invalidReview = await manager.prepareImport(input, 'operator', 'bls-basic');
    const invalidCall = calls.at(-1)!;
    const invalidPin = '000000';
    const erased: Uint8Array[] = [];
    const fill = Uint8Array.prototype.fill;
    const observeWipe = t.mock.method(Uint8Array.prototype, 'fill', function (
      this: Uint8Array, value: number, start?: number, end?: number
    ) {
      if (value === 0 && this.length === 32 && this[31] === 2 &&
          this.subarray(0, 31).every((byte) => byte === 0))
        erased.push(this);
      return fill.call(this, value, start, end);
    });
    try {
      f.setOperationPin(invalidPin);
      const rejected = assert.rejects(manager.confirmImport(invalidReview), { code: 'CANCELLED' });
      const refused = await f.waitOperationRefusal();
      assert.match(refused.error!, /PIN not accepted/);
      refused.cancel(); await rejected;
    } finally { f.setOperationPin(); observeWipe.mock.restore(); }
    assert.equal(invalidCall.signal.aborted, true);
    assert.equal(erased.length, 1);
    assert(erased[0]!.every((byte) => byte === 0));
    assert.equal(mainRow(), undefined);
    await assert.rejects(manager.confirmImport(invalidReview), { code: 'CANCELLED' });

    const preview = await manager.prepareImport(input, 'operator', 'bls-basic');
    assert.deepEqual(Object.keys(preview.keys[0]!).sort(), [
      'label',
      'publicKey',
      'role',
      'scheme',
    ]);
    assert(!JSON.stringify(preview).includes(secret));
    assert.equal(mainRow(), undefined);
    await assert.rejects(manager.confirmImport(structuredClone(preview)), {
      code: 'CANCELLED',
    });
    const beforeImportProofs = f.operationRequests;
    const saved = await manager.confirmImport(preview);
    assert.equal(f.operationRequests, beforeImportProofs + 1);
    assert.equal(saved.length, 1);
    assert.deepEqual(await manager.list(), saved);
    assert(!JSON.stringify(saved).includes(secret));
    assert(!mainRow()!.value.includes(secret));
    const encryptedKeysBeforeSettings = mainRow()!.value;
    const settings = { serviceUrl: 'https://sentry.example', maxFeeSatoshis: '250000' };
    const beforeSettingsProofs = f.operationRequests;
    assert.deepEqual(await manager.saveSettings(settings, guard), settings);
    assert.equal(f.operationRequests, beforeSettingsProofs + 1);
    assert.deepEqual(await manager.getSettings(guard), settings);
    assert.equal(mainRow()!.value, encryptedKeysBeforeSettings);
    const { vaultId } = JSON.parse(mainRow()!.value);
    const identity = (await f.store.recovery.readIdentity())!;
    const vault = createSentryKeyVault({
      ...f.store.sentryKeys.bind(
        { ...identity, vaultId, network: 'mainnet', profileId: identity.root!.profileId },
        guard
      ),
      crypto: () => webcrypto as unknown as Crypto,
    });
    const recovered = await vault.loadSentryKey({
      vaultId,
      network: 'mainnet',
      id: saved[0]!.id,
      seed: PHRASE,
      assertCurrent: guard,
    });
    assert.equal(recovered.secretKey, secret);
    assert.equal(recovered.publicKey, preview.keys[0]!.publicKey);
    await assert.rejects(manager.confirmImport(preview), {
      code: 'CANCELLED',
    });
    await assert.rejects(
      manager.prepareImport(input, 'operator', 'bls-basic'),
      { code: 'DUPLICATE' }
    );

    const remove = await manager.prepareRemoval(saved[0]!.id);
    await assert.rejects(manager.confirmRemoval(remove, false), {
      code: 'BACKUP_REQUIRED',
    });
    assert.equal((await manager.list()).length, 1);
    assert.deepEqual(await manager.confirmRemoval(remove, true), {
      removedKeyId: saved[0]!.id,
    });
    assert.deepEqual(await manager.list(), []);
    await assert.rejects(manager.confirmRemoval(remove, true), {
      code: 'CANCELLED',
    });

    const wif = syscoinUtils.bitcoinjs.ECPair.fromPrivateKey(
      Buffer.alloc(32, 1),
      {
        network: syscoinUtils.syscoinNetworks.mainnet,
      }
    ).toWIF();
    const wifPreview = await manager.prepareImport(
      'Voting | ' + wif,
      'voting',
      'secp256k1'
    );
    assert(!JSON.stringify(wifPreview).includes(wif));
    await selectNetwork(f, 'utxo:5700');
    await assert.rejects(manager.confirmImport(wifPreview), {
      code: 'CANCELLED',
    });
    const next = await open();
    await assert.rejects(
      next.prepareImport('Voting | ' + wif, 'voting', 'secp256k1'),
      { code: 'INVALID_INPUT' }
    );
    for (const retirement of ['cancel', 'expiry', 'lock', 'background']) {
      const currentManager = retirement === 'cancel' ? next : await open();
      if (retirement === 'expiry') t.mock.timers.enable({ apis: ['setTimeout'] });
      hold = latch();
      const shake = retirement === 'background';
      const draft = shake
        ? 'First | ' + '32'.repeat(64) + '\nSecond | ' + '42'.repeat(64)
        : input;
      const pending = currentManager.prepareImport(
        draft,
        'operator',
        shake ? 'slh-dsa-shake-128s' : 'bls-basic'
      );
      const cancelled = assert.rejects(pending, { code: 'CANCELLED' });
      await hold.reached;
      const heldCall = calls.at(-1)!;
      assert.notEqual(heldCall.signal, scope.signal);
      assert.equal(heldCall.signal.aborted, false);
      assert(heldCall.bytes.every((byte) => byte === 0));
      const priorCalls = calls.length;
      if (retirement === 'cancel') currentManager.cancel();
      else if (retirement === 'expiry') t.mock.timers.tick(90_000);
      else if (retirement === 'lock') f.owner.lock();
      else scope.abort();
      assert.equal(heldCall.signal.aborted, true);
      await assert.rejects(open(), { code: 'BUSY' });
      await assert.rejects(
        currentManager.prepareImport(input, 'operator', 'bls-basic'),
        { code: 'BUSY' }
      );
      assert.equal(calls.length, priorCalls);
      hold.release();
      await cancelled;
      assert.equal(calls.length, priorCalls);
      hold = undefined;
      if (retirement === 'expiry') t.mock.timers.reset();
      if (retirement === 'lock') await f.owner.unlock(OLD);
    }
    assert.deepEqual(JSON.parse(mainRow()!.value).keys, []);
    assert.equal(
      f.read().records.some(({ key }) => key === SENTRY_SLOT_KEYS.testnet),
      false
    );
  } finally {
    t.mock.timers.reset();
    scope.abort();
    hold?.release();
    await f.close();
  }
});

test('Sentry approval retired before SQLite COMMIT leaves the vault unchanged', async () => {
  const derive: DeriveSentryPublicKey = async (_role, _scheme, bytes) =>
    createHash('sha384').update(bytes).digest('hex');
  const f = await fixture(undefined, true, undefined, undefined, undefined, derive);
  const scope = new AbortController();
  const gate = latch();
  const input = 'Operator | ' + '02'.repeat(32);
  try {
    await selectNetwork(f, 'syscoin');
    const manager = await f.runtime.openSentryKeyManagement!(
      scope.signal,
      () => undefined
    );
    const approval = await manager.prepareImport(input, 'operator', 'bls-basic');
    f.setAfter(async (kind, sql) => {
      if (kind === 'run' && sql.startsWith('INSERT INTO sentry_key_records')) {
        gate.enter();
        await gate.gate;
      }
    });
    const pending = manager.confirmImport(approval);
    const refused = assert.rejects(pending, { code: 'CANCELLED' });
    await gate.reached;
    const afterInsert = f.dispatched.length;
    manager.cancel();
    gate.release();
    await refused;
    assert(!f.dispatched.slice(afterInsert).includes('COMMIT'));
    assert(!f.read().records.some(({ key }) => key === SENTRY_SLOT_KEYS.mainnet));
    await assert.rejects(manager.confirmImport(approval), { code: 'CANCELLED' });

    f.setAfter();
    const fresh = await manager.prepareImport(input, 'operator', 'bls-basic');
    assert.equal((await manager.confirmImport(fresh)).length, 1);
  } finally {
    scope.abort();
    gate.release();
    await f.close();
  }
});

test('Sentry public settings preserve each network through cold unlock and password recovery', async () => {
  const f = await fixture(undefined, true, undefined, undefined, undefined, async () => { throw Error('Unexpected key derivation'); });
  const guard = () => undefined;
  let recovery: NativeRecoveryCoordinator | undefined;
  try {
    for (const [network, serviceUrl, fee] of [
      ['syscoin', 'https://sentry-main.example', '200000'],
      ['utxo:5700', 'http://127.0.0.1:8800', '300000'],
    ] as const) {
      await selectNetwork(f, network);
      const manager = await f.runtime.openSentryKeyManagement!(new AbortController().signal, guard);
      assert.deepEqual(await manager.getSettings(guard), {
        serviceUrl: network === 'syscoin' ? 'https://sysnode.info' : '', maxFeeSatoshis: '100000',
      });
      f.setOperationPin(NEXT);
      const rejected = assert.rejects(manager.saveSettings({ serviceUrl, maxFeeSatoshis: fee }, guard), { code: 'CANCELLED' });
      const refused = await f.waitOperationRefusal();
      assert.match(refused.error!, /PIN not accepted/);
      assert.equal(f.read().records.filter(({ key }) => parseSentrySettingsStorageKey(key)).length, network === 'syscoin' ? 0 : 1);
      refused.cancel(); await rejected;
      f.setOperationPin();
      assert.equal(f.read().records.filter(({ key }) => parseSentrySettingsStorageKey(key)).length, network === 'syscoin' ? 0 : 1);
      await manager.saveSettings({ serviceUrl, maxFeeSatoshis: fee }, guard);
      manager.dispose();
    }
    const saved = f.read().records.filter(({ key }) => parseSentrySettingsStorageKey(key));
    assert.equal(saved.length, 2);
    assert.equal((await readRecoveryInventory(f.store)).status, 'needs-matching-phrase-verification');
    await f.reopen();
    await f.owner.unlock(OLD);
    assert.deepEqual(f.read().records.filter(({ key }) => parseSentrySettingsStorageKey(key)), saved);
    f.owner.lock();
    recovery = f.coordinator();
    const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, guard);
    assert.equal(await recovery.commit(proof), 'committed-locked');
    await f.reopen();
    await f.owner.unlock(NEXT);
    assert.deepEqual(f.read().records.filter(({ key }) => parseSentrySettingsStorageKey(key)), saved);
    const manager = await f.runtime.openSentryKeyManagement!(new AbortController().signal, guard);
    assert.deepEqual(await manager.getSettings(guard), { serviceUrl: 'http://127.0.0.1:8800', maxFeeSatoshis: '300000' });
    manager.dispose();
  } finally { await recovery?.dispose(); await f.close(); }
});

test('Sentry service settings cancelled while SQL waits never commit', async () => {
  const f = await fixture(undefined, true, undefined, undefined, undefined, async () => { throw Error('Unexpected key derivation'); });
  const gate = latch();
  let live = true;
  const guard = () => { if (!live) throw Error('CANCELLED'); };
  try {
    await selectNetwork(f, 'syscoin');
    const manager = await f.runtime.openSentryKeyManagement!(new AbortController().signal, () => undefined);
    f.setAfter(async (kind, sql) => {
      if (kind === 'run' && sql.startsWith('INSERT INTO keyring_records')) { gate.enter(); await gate.gate; }
    });
    const saving = manager.saveSettings({ serviceUrl: 'https://sentry.example', maxFeeSatoshis: '200000' }, guard);
    const refused = assert.rejects(saving, { code: 'CANCELLED' });
    await gate.reached;
    const before = f.dispatched.length;
    live = false;
    gate.release();
    await refused;
    assert(!f.dispatched.slice(before).includes('COMMIT'));
    assert.equal(f.read().records.filter(({ key }) => parseSentrySettingsStorageKey(key)).length, 0);
    manager.dispose();
  } finally { live = false; gate.release(); await f.close(); }
});

test('nonprimary UTXO HD accounts keep unresolved saved transfers reachable until confirmed', async () => {
  const bitcoin = syscoinUtils.bitcoinjs, network = getUtxoNetwork('bitcoin');
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32, 7), 0);
  let account!: NativeAccountRecord['groups'][number]['accounts']['HDAccount'][number];
  let posted: { raw: string; txid: string } | undefined;
  let confirmed = false;
  const observationPaths: string[] = [];
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert(url.startsWith(network.endpoint));
    const path = url.slice(network.endpoint.length);
    const reply = (value: unknown) => {
      const response = Response.json(value);
      Object.defineProperty(response, 'url', { value: url });
      return response;
    };
    if (path === '/api/v2/' || path === '/api/v2/block-index/0') {
      assert.equal(init?.method, 'GET');
      observationPaths.push(path);
      return reply(path === '/api/v2/'
        ? utxoMetadata(network.id) : { blockHash: network.genesisHash });
    }
    if (path === '/api/v2/estimatefee/1') return reply({ result: '0.00001024' });
    if (path === `/api/v2/xpub/${account.xpub}?tokens=used&details=tokens`) return reply({ tokens: [] });
    if (path === `/api/v2/utxo/${account.xpub}`) return reply([{
      txid: previous.getId(), vout: 0, value: '100000', address: account.address,
      confirmations: 10, path: "m/84'/0'/1'/0/0",
    }]);
    if (path === `/api/v2/tx/${previous.getId()}`) return reply({ hex: previous.toHex() });
    if (path === '/api/v2/sendtx/' && init?.method === 'POST') {
      assert.equal(typeof init.body, 'string');
      const raw = init.body as string;
      posted = { raw, txid: bitcoin.Transaction.fromHex(raw).getId() };
      return reply({ result: posted.txid });
    }
    if (posted && path === `/api/v2/tx/${posted.txid}`) {
      assert.equal(init?.method, 'GET');
      observationPaths.push(path);
      return reply({ txid: posted.txid, hex: posted.raw, confirmations: confirmed ? 1 : 0,
        ...(confirmed && { blockHash: 'a'.repeat(64) }) });
    }
    throw Error(`Unexpected fixture route ${path}`);
  };
  const f = await fixture(undefined, true, undefined, undefined, fetcher);
  const manage = (request: Parameters<NativeCustodyAuthority['manageAccounts']>[0]) =>
    f.owner.manageAccounts(request, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
  const current = () => undefined;
  const primary = 'hd:0:0', sending = 'hd:0:1';
  const remove = { kind: 'remove', id: sending,} as const;
  try {
    await selectNetwork(f, network.id);
    await manage({ kind: 'create', label: 'Bitcoin spending',});
    assert.equal(f.owner.getCatalogue()!.active.accountId, sending);
    account = (await accountRecord(f)).groups.find((group) => group.key === '0')!.accounts.HDAccount[1]!;
    previous.addOutput(bitcoin.address.toOutputScript(account.address, network.addressNetwork), 100000n);
    const recipient = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 9), network: network.addressNetwork }).address!;
    let send = await f.runtime.openUtxoSend!(current);
    const { txid } = await send.confirm(await send.prepare({ amount: '0.0004', recipient }), { method: 'pin', pin: OLD });
    assert.equal(txid, posted?.txid);
    const observation = ['/api/v2/', '/api/v2/block-index/0', `/api/v2/tx/${txid}`];
    assert.equal(await send.check(txid), 'seen');
    assert.deepEqual(observationPaths, observation);

    await manage({ kind: 'select', id: primary });
    await assert.rejects(manage(remove), { code: 'PENDING_TRANSFER' });
    await f.owner.unlock(OLD);
    assert.equal(f.owner.getCatalogue()!.active.accountId, primary);
    assert(f.owner.getCatalogue()!.accounts.some(({ id }) => id === sending));

    await manage({ kind: 'select', id: sending });
    send = await f.runtime.openUtxoSend!(current);
    assert.deepEqual((await send.list()).map((entry) => entry.txid), [txid]);
    confirmed = true;
    assert.equal(await send.check(txid), 'confirmed');
    assert.deepEqual(observationPaths, [...observation, ...observation]);
    await manage({ kind: 'select', id: primary });
    await manage(remove);
    assert.equal(f.owner.getCatalogue()!.accounts.some(({ id }) => id === sending), false);
  } finally {
    await f.close();
  }
});

test('UTXO custody uses SDK groups, preserves EVM selection and survives real password recovery', async () => {
  const f = await fixture();
  let recovery: NativeRecoveryCoordinator | undefined;
  const manage = (request: Parameters<NativeCustodyAuthority['manageAccounts']>[0]) =>
    f.owner.manageAccounts(request, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
  try {
    await manage({ kind: 'create', label: 'EVM account two',});
    const evm = f.owner.getSnapshot().account!;
    assert.equal(f.owner.getCatalogue()?.active.accountId, 'hd:60:1');
    const originalRoot = (await f.store.recovery.readIdentity())!;
    await assert.rejects(selectNetwork(f, 'utxo:999999'), { code: 'INVALID_INPUT' });
    assert.deepEqual(f.owner.getSnapshot().account, evm);
    for (const id of ['syscoin', 'utxo:5700', 'bitcoin'] as const) {
      await selectNetwork(f, id);
      const network = getUtxoNetwork(id);
      const account = f.owner.getSnapshot().account!;
      assert.equal(account.network, id);
      assert.equal(f.owner.getCatalogue()?.active.accountId, `hd:${network.slip44}:0`);
      assert.equal(f.unlockedKeyrings(), 0);
      assert.equal(f.publicKeyrings(), 1);
      const group = (await accountRecord(f)).groups.find((value) => value.key === String(network.slip44))!;
      const first = group.accounts.HDAccount[0]!;
      assert.equal(group.activeNetwork.chainId, network.chainId);
      assert.equal(parseUtxoPublicIdentifier(first.xpub, id).address, account.address);
      assert.equal(first.address, account.address);
      assert(!JSON.stringify(f.owner.getCatalogue()).includes(first.xpub));
      assert(!JSON.stringify(f.owner.getSnapshot()).includes(first.xpub));
    }
    await manage({ kind: 'create', label: 'Bitcoin account two',});
    const gap = f.owner.getSnapshot().account!;
    assert.equal(f.owner.getCatalogue()?.active.accountId, 'hd:0:1');
    await manage({ kind: 'create', label: 'Bitcoin account three',});
    await manage({ kind: 'remove', id: 'hd:0:1',});
    await manage({ kind: 'create', label: 'Bitcoin gap reused',});
    assert.equal(f.owner.getCatalogue()?.active.accountId, 'hd:0:1');
    assert.deepEqual(f.owner.getSnapshot().account, gap);
    assert.deepEqual(f.owner.getCatalogue()?.accounts.map((account) => account.id), ['hd:0:0', 'hd:0:1', 'hd:0:2']);
    await assert.rejects(f.owner.importAccount({ privateKey: KEY, expectedAddress: importedWallet.address, label: 'EVM only' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision, new AbortController().signal, createTestPrivateAuthentication(() => undefined)), { code: 'NOT_READY' });
    await selectNetwork(f, 'syscoin-nevm-testnet');
    assert.equal(getNativeNetwork('syscoin-nevm-testnet').chainId, '5700');
    assert.equal(f.owner.getSnapshot().account?.address, evm.address);
    assert.equal(f.owner.getCatalogue()?.active.accountId, 'hd:60:1');
    await selectNetwork(f, 'utxo:5700');
    assert.notEqual(f.owner.getSnapshot().account?.address, evm.address);
    await selectNetwork(f, 'bitcoin');
    assert.deepEqual(f.owner.getSnapshot().account, gap);

    await f.reopen();
    await f.owner.unlock(OLD);
    assert.deepEqual(f.owner.getSnapshot().account, gap);
    assert.equal(f.unlockedKeyrings(), 0);
    assert.equal(f.publicKeyrings(), 1);
    assert.deepEqual((await accountRecord(f)).groups.map((group) => group.key), ['60', '57', '1', '0']);
    const inventory = await readRecoveryInventory(f.store);
    assert.equal(inventory.counts?.hdAccounts, 7);
    const before = f.read();
    f.owner.lock();
    recovery = f.coordinator();
    const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    assert.equal(await recovery.commit(proof), 'committed-locked');
    assert.deepEqual(retained(f.read()), retained(before));
    await f.reopen();
    await f.owner.unlock(NEXT);
    assert.deepEqual(f.owner.getSnapshot().account, gap);
    assert.deepEqual((await f.store.recovery.readIdentity())?.root, originalRoot.root);
    assert.equal((await f.store.recovery.readIdentity())?.walletBindingId, originalRoot.walletBindingId);
    await selectNetwork(f, 'ethereum');
    assert.deepEqual(f.owner.getSnapshot().account, evm);
    assert.equal(f.unlockedKeyrings(), 0);
    assert.equal(f.publicKeyrings(), 1);
  } finally {
    await recovery?.dispose();
    await f.close();
  }
});

test('UTXO custody balance sends the selected account key only after verified Blockbook status and genesis', async () => {
  const calls: string[] = [];
  const hold = latch();
  let wrongGenesis = true;
  let holdStatus = false;
  let expectedXpub = '';
  let activeSignal: AbortSignal | undefined;
  const read: NonNullable<Parameters<typeof createKeyringRuntimeFactory>[0]['readUtxoAccount']> = (id, xpub, signal, guard) =>
    createUtxoBalanceReader({ fetch: async (url, init) => {
      guard();
      calls.push(url);
      assert.equal(init.method, 'GET');
      const network = id;
      if (url === `${network.endpoint}/api/v2/`) {
        if (holdStatus) {
          activeSignal = init.signal ?? undefined;
          hold.enter();
          await hold.gate;
        }
        return Response.json(utxoMetadata(id.id));
      }
      if (url === `${network.endpoint}/api/v2/block-index/0`)
        return Response.json({ blockHash: wrongGenesis ? 'a'.repeat(64) : network.genesisHash });
      assert.equal(url, `${network.endpoint}/api/v2/xpub/${expectedXpub}?details=tokenBalances&tokens=nonzero`);
      assert.equal(xpub, expectedXpub);
      return Response.json({ address: xpub, balance: '9007199254740993', unconfirmedBalance: '-123', unconfirmedTxs: 1 });
    } }).readAccount(id, xpub, signal);
  const f = await fixture(undefined, true, undefined, read);
  try {
    const id = 'bitcoin' satisfies UtxoNetworkId;
    await selectNetwork(f, id);
    const address = f.owner.getSnapshot().account!.address;
    expectedXpub = (await accountRecord(f)).groups.find((group) => group.key === '0')!.accounts.HDAccount[0]!.xpub;
    const readBalance = (value = address) =>
      f.runtime.readUtxoBalance!(id, value, new AbortController().signal);
    await assert.rejects(readBalance('bc1invalid'), { code: 'CANCELLED' });
    assert.equal(calls.length, 0);
    await assert.rejects(readBalance(), { code: 'NETWORK_MISMATCH' });
    assert.equal(calls.length, 2);
    assert(calls.every((url) => !url.includes(expectedXpub)));
    wrongGenesis = false;
    calls.length = 0;
    const balance = await readBalance();
    assert.equal(balance.confirmedUnits, '9007199254740993');
    assert.equal(balance.pendingDeltaUnits, '-123');
    assert.equal(calls.length, 3);
    assert(!JSON.stringify(balance).includes(expectedXpub));

    calls.length = 0;
    holdStatus = true;
    const pending = readBalance();
    const denied = assert.rejects(pending, { code: 'CANCELLED' });
    await hold.reached;
    await selectNetwork(f, 'ethereum');
    assert.equal(activeSignal?.aborted, true);
    hold.release();
    await denied;
    assert.equal(calls.length, 1);
    assert(!calls[0]!.includes(expectedXpub));
  } finally {
    hold.release();
    await f.close();
  }
});

test('UTXO custody lock revokes the sole staged owner before a held derivation returns', async () => {
  const hold = latch();
  class HeldKeyring extends sdk.HostKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...options);
      const createFirstAccount = this.createFirstAccount;
      this.createFirstAccount = async (...args) => {
        const account = await createFirstAccount(...args);
        if (account.address.startsWith('bc1')) {
          hold.enter();
          await hold.gate;
        }
        return account;
      };
    }
  }
  const f = await fixture(async () => ({ ...sdk, HostKeyring: HeldKeyring }));
  try {
    const before = await accountRecord(f);
    const pending = selectNetwork(f, 'bitcoin');
    const denied = assert.rejects(pending, { code: 'CANCELLED' });
    await hold.reached;
    assert.equal(f.unlockedKeyrings(), 1);
    assert.equal(f.publicKeyrings(), 1);
    assert.equal(f.owner.getSnapshot().account, null);
    f.owner.lock();
    assert.equal(f.unlockedKeyrings(), 0);
    hold.release();
    await denied;
    assert.deepEqual(await accountRecord(f), before);
    await f.reopen();
    await f.owner.unlock(OLD);
    assert.equal(f.owner.getSnapshot().account?.network, 'ethereum');
    await selectNetwork(f, 'bitcoin');
    assert.equal(f.owner.getCatalogue()?.active.accountId, 'hd:0:0');
  } finally {
    hold.release();
    await f.close();
  }
});

for (const fault of ['CAS miss', 'lost COMMIT acknowledgement']) {
  test(`UTXO custody ${fault} leaves the durable selection for cold reopen`, async () => {
    const f = await fixture();
    try {
      const before = await accountRecord(f);
      let injected = false;
      if (fault === 'CAS miss') {
        f.setHook((kind, sql) => {
          if (!injected && kind === 'exec' && sql === 'BEGIN IMMEDIATE') {
            injected = true;
            f.write(WALLET_CATALOGUE_KEY, { ...before, revision: before.revision + 1 });
          }
        });
      } else {
        let updatingCatalogue = false;
        f.setHook((kind, sql) => {
          if (kind === 'run' && sql === 'UPDATE keyring_records SET value = ? WHERE key = ?')
            updatingCatalogue = true;
        });
        f.setAfter((kind, sql) => {
          if (updatingCatalogue && kind === 'exec' && sql === 'COMMIT') {
            injected = true;
            throw new Error('Commit acknowledgement lost');
          }
        });
      }
      await assert.rejects(selectNetwork(f, 'bitcoin'));
      assert.equal(injected, true);
      assert.equal(f.unlockedKeyrings(), 0);
      assert.equal(f.owner.getSnapshot().account, null);
      f.setHook(); f.setAfter();
      await f.reopen(fault === 'lost COMMIT acknowledgement');
      await f.owner.unlock(OLD);
      assert.equal(f.owner.getSnapshot().account?.network, fault === 'CAS miss' ? 'ethereum' : 'bitcoin');
      assert.equal((await accountRecord(f)).groups.length, fault === 'CAS miss' ? 1 : 2);
      assert.equal(f.unlockedKeyrings(), 0);
      assert.equal(f.publicKeyrings(), 1);
    } finally {
      f.setHook(); f.setAfter();
      await f.close();
    }
  });
}



test('UTXO custody reopens and recovers using current defaults when saved endpoints change', async () => {
  const bitcoin = getUtxoNetwork('bitcoin');
  const retiredEndpoint = 'https://previous-provider.invalid/';
  const requests: string[] = [];
  const recoveryEndpoints = new Map<number, string>();
  class ObservedRecoverySigner extends sdk.SoftwareKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
      super(...options);
      const encrypt = this.getEncryptedXprv;
      this.getEncryptedXprv = (signer) => {
        recoveryEndpoints.set(signer.Signer.SLIP44, signer.blockbookURL);
        return encrypt(signer);
      };
    }
  }
  const f = await fixture(undefined, true, undefined, (id, xpub, signal, guard) =>
    createUtxoBalanceReader({ fetch: async (url) => {
      guard();
      requests.push(url);
      if (url === `${bitcoin.endpoint}/api/v2/`) return Response.json(utxoMetadata(id.id));
      if (url === `${bitcoin.endpoint}/api/v2/block-index/0`)
        return Response.json({ blockHash: bitcoin.genesisHash });
      assert.equal(url, `${bitcoin.endpoint}/api/v2/xpub/${xpub}?details=tokenBalances&tokens=nonzero`);
      return Response.json({ address: xpub, balance: '123', unconfirmedBalance: '0', unconfirmedTxs: 0 });
    } }).readAccount(id, xpub, signal)
  );
  let recovery: NativeRecoveryCoordinator | undefined;
  try {
    await selectNetwork(f, 'syscoin');
    await selectNetwork(f, bitcoin.id);
    const account = f.owner.getSnapshot().account!;
    const root = (await f.store.recovery.readIdentity())!.root;
    const before = await accountRecord(f);
    const changed = {
      ...before,
      groups: before.groups.map((group) => group.activeNetwork.kind === 'syscoin'
        ? { ...group, activeNetwork: { ...group.activeNetwork, url: retiredEndpoint } }
        : group),
    };
    f.write(WALLET_CATALOGUE_KEY, changed);
    await f.reopen();
    await f.owner.unlock(OLD);
    assert.deepEqual(f.owner.getSnapshot().account, account);
    assert.deepEqual(await accountRecord(f), changed, 'unlock must not rewrite the account row');
    const observed = await f.runtime.readUtxoBalance!(
      bitcoin.id, account.address, new AbortController().signal
    );
    assert.equal(observed.confirmedUnits, '123');
    assert.equal(requests.length, 3);
    assert(requests.every((url) => url.startsWith(bitcoin.endpoint + '/')));

    f.owner.lock();
    recovery = f.coordinator(async () => ({ ...sdk, SoftwareKeyring: ObservedRecoverySigner }));
    const proof = await prepareRecoveryPin(recovery, PHRASE, NEXT, () => undefined);
    assert.equal(await recovery.commit(proof), 'committed-locked');
    assert.deepEqual(recoveryEndpoints, new Map([
      [57, getUtxoSdkNetwork('syscoin').url],
      [0, getUtxoSdkNetwork('bitcoin').url],
    ]));
    assert.equal(requests.length, 3, 'recovery must remain local');
    await f.reopen();
    await f.owner.unlock(NEXT);
    assert.deepEqual(f.owner.getSnapshot().account, account);
    assert.deepEqual((await f.store.recovery.readIdentity())?.root, root);
    assert.deepEqual((await accountRecord(f)).groups.map((group) => group.activeNetwork.url),
      before.groups.map((group) => group.activeNetwork.url));
  } finally {
    await recovery?.dispose();
    await f.close();
  }
});

for (const field of ['chain', 'account'] as const) {
  test(`UTXO endpoint rotation still refuses a wrong saved ${field} identity`, async () => {
    const f = await fixture();
    try {
      await selectNetwork(f, 'bitcoin');
      const before = await accountRecord(f);
      const changed = {
        ...before,
        groups: before.groups.map((group) => {
          if (group.key !== '0') return group;
          if (field === 'chain') return {
            ...group, activeNetwork: { ...group.activeNetwork, chainId: 57 },
          };
          return {
            ...group,
            accounts: { ...group.accounts,
              HDAccount: { 0: { ...group.accounts.HDAccount[0]!, address: UTXO_ADDRESSES.bitcoin } } },
          };
        }),
      };
      f.write(WALLET_CATALOGUE_KEY, changed);
      await f.reopen();
      await assert.rejects(f.owner.unlock(OLD), { code: 'OPERATION_FAILED' });
      assert.equal(f.owner.getSnapshot().account, null);
      assert.equal(f.unlockedKeyrings(), 0);
      assert.deepEqual(await accountRecord(f), changed);
    } finally {
      await f.close();
    }
  });
}

test('cancel closes the prepared recovery database even when staged PIN deletion fails', async () => {
  const f = await fixture();
  f.owner.lock();
  const before = f.read();
  const recovery = new NativeRecoveryCoordinator({
    pinCredential: { ...pinCredential, async remove() { throw Error('Synthetic OS cleanup refusal'); } },
    owner: f.owner, async retireControllers() {}, async ensureCryptoReady() {}, openStorage: f.open,
  });
  try {
    const proof = await recovery.prepare(PHRASE, () => undefined);
    await recovery.setPin(proof, NEXT);
    assert.equal(f.leased, true);
    recovery.cancel();
    await assert.rejects(recovery.dispose(), { code: 'REOPEN_REQUIRED' });
    assert.equal(f.leased, false);
    assert.deepEqual(f.read(), before);
  } finally { await recovery.dispose().catch(() => undefined); await f.close(); }
});
