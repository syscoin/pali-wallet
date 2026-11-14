import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { deriveSentryClassicalPublicKey } from '@sidhujag/sysweb3-sentry/classical-public-key';
import { SENTRY_NETWORKS, type SentryNetwork } from '../../../source/shared/sentryNetworks.ts';
import { sentrySettingsStorageKey } from '../../../source/shared/sentrySettings.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { assertNativeRecordDomains, inspectRecoveryInventory, readRecoveryInventory } from '../src/custody/recoveryInventory.ts';
import { createSentryClassicalExecutor } from '../src/crypto/sentryClassicalExecutor.ts';
import { STORAGE_LIMITS } from '../src/storage/json.ts';
import { SENTRY_SLOT_KEYS, sentrySlotNetwork } from '../src/storage/sentryKeyDomain.ts';
import { SENTRY_NODE_SLOTS, SENTRY_NODE_LIMITS, sentryNodeSlotNetwork } from '../src/storage/sentryNodeDomain.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { createTestCredentialPort } from './fixtures/credential.ts';
import { createTestPrivateAuthentication } from './fixtures/privateAuthentication.ts';
import { metadata } from './publicWatchFixtures.ts';
import { sentryNodeResponse } from './sentryNodeFixtures.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';
import { resolveUtxoNetwork } from '../src/core/utxoNetworks.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const current = () => undefined;
const sdk = await loadNativeKeyringSdk();
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

// Real SDK and SQLite own every wallet/record transition. Only OS credentials
// and the public node/chain read transport are replaced at their host seams.
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pali-native-sentry-recovery-'));
  const file = join(directory, 'wallet.sqlite');
  const credentialPort = createTestCredentialPort();
  let initialized = false;
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  let posts = 0;
  const openStorage = async () => {
    storage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, !initialized);
    initialized = true;
    return storage;
  };
  const factory = createKeyringRuntimeFactory({
    isAuthenticationActive: () => false, credentialPort,
    privacyServiceSettings: null, passkeys: null, slhExecution: null, readEvmRetirement: null,
    ensureCryptoReady: async () => undefined, openStorage, loadSdk: async () => sdk,
    deriveSentryPublicKey: createSentryClassicalExecutor(deriveSentryClassicalPublicKey),
    utxoFetch: async (input, init) => {
      if (init?.method && init.method !== 'GET') { posts++; throw Error('Unexpected submission'); }
      const url = String(input), parsed = new URL(url), pathname = parsed.pathname;
      const network = url.startsWith(resolveUtxoNetwork('utxo:5700').endpoint)
        ? resolveUtxoNetwork('utxo:5700') : resolveUtxoNetwork('syscoin');
      const body = pathname === '/api/v2/' ? metadata(network)
        : pathname === '/api/v2/block-index/0' ? { blockHash: network.genesisHash }
        : sentryNodeResponse(parsed.searchParams.get('network') === 'testnet'
          ? SENTRY_NETWORKS.testnet.genesisHash : SENTRY_NETWORKS.mainnet.genesisHash);
      const response = Response.json(body);
      Object.defineProperty(response, 'url', { value: url });
      return response;
    },
  });
  const newOwner = async () => {
    const next = new NativeCustodyAuthority({ async open() {
      runtime = await factory.open() as KeyringRuntime;
      return runtime;
    } });
    await next.initialize();
    return next;
  };
  let owner = await newOwner();
  await owner.importPhrase(PHRASE);
  await runtime.backup.confirm(await runtime.backup.fingerprint());
  await owner.refreshAuthenticatedMetadata();
  const retained = () => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare('SELECT * FROM sentry_key_records UNION ALL SELECT * FROM sentry_node_records ORDER BY key').all();
    } finally { db.close(); }
  };
  return {
    get owner() { return owner; }, get storage() { return storage; }, get posts() { return posts; },
    retained,
    replaceNode(value: string) {
      const db = new DatabaseSync(file);
      try { db.prepare('UPDATE sentry_node_records SET value = ? WHERE key = ?').run(value, SENTRY_NODE_SLOTS.mainnet); }
      finally { db.close(); }
    },
    async link(network: SentryNetwork) {
      await owner.selectNetwork(network === 'mainnet' ? 'syscoin' : 'utxo:5700', owner.getSnapshot().revision, owner.getCatalogue()!.revision, current);
      const lifetime = new AbortController(), authentication = createTestPrivateAuthentication(current);
      try {
        const keys = await runtime.openSentryKeyManagement!(lifetime.signal, current, authentication);
        await keys.confirmImport(await keys.prepareImport('02'.padStart(64, '0'), 'voting', 'secp256k1'));
        await keys.saveSettings({ serviceUrl: 'https://sentry.test', maxFeeSatoshis: '100000' }, current);
        const nodes = await runtime.openSentryNodeManagement!(lifetime.signal, current, authentication);
        const review = await nodes.prepareLink({ version: 1, proTxHash: sentryNodeResponse(SENTRY_NETWORKS[network].genesisHash).node.proTxHash,
          genesisHash: SENTRY_NETWORKS[network].genesisHash }, 'Pali Wallet');
        await nodes.confirmLink(review);
        assert.equal((await nodes.list()).linkedNodes.length, 1);
        assert.equal((await nodes.list()).collateral.length, 1);
      } finally { lifetime.abort(); }
    },
    async reopen() { await owner.dispose(); owner = await newOwner(); },
    coordinator: () => new NativeRecoveryCoordinator({ isAuthenticationActive: () => false, credentialPort, owner,
      retireControllers: async () => undefined, ensureCryptoReady: async () => undefined, openStorage, loadSdk: async () => sdk }),
    async close() { await owner.dispose().catch(() => undefined); await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}

test('normal Sentry linking preserves both domains through lock, cold reopen and matching-phrase recovery', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('Ambient network forbidden'); });
  const f = await fixture();
  let recovery: NativeRecoveryCoordinator | undefined;
  try {
    await f.owner.lock(); await f.owner.unlock();
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    for (const network of ['mainnet', 'testnet'] as const) await f.link(network);
    const saved = f.retained();
    assert.equal(saved.length, 4);
    assert.equal((await readRecoveryInventory(f.storage)).status, 'needs-matching-phrase-verification');
    const identity = await f.storage.recovery.readIdentity();
    await f.owner.lock(); await f.owner.unlock();
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    assert.deepEqual(f.retained(), saved);
    await f.reopen();
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    assert.deepEqual(f.retained(), saved);
    await f.owner.lock();
    recovery = f.coordinator();
    const proof = await recovery.prepare(PHRASE, current);
    assert.deepEqual(f.retained(), saved);
    assert.equal(await recovery.commit(proof), 'committed-locked');
    assert.deepEqual(f.retained(), saved);
    await f.reopen();
    assert.equal(f.owner.getSnapshot().phase, 'ready');
    assert.deepEqual(f.retained(), saved);
    const recovered = await f.storage.recovery.readIdentity();
    assert.equal(recovered?.walletBindingId, identity?.walletBindingId);
    assert.deepEqual(recovered?.root, identity?.root);
    assert.notEqual(recovered?.pairFingerprint, identity?.pairFingerprint);
    assert.equal((await readRecoveryInventory(f.storage)).status, 'needs-matching-phrase-verification');
    assert.equal(f.posts, 0);
  } finally { await recovery?.dispose(); await f.close(); }
});

test('Sentry node admission requires the exact slot, complete record and matching wallet/root', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('Ambient network forbidden'); });
  const f = await fixture();
  try {
    await f.link('mainnet');
    const snapshot = await f.storage.recovery.readSnapshot();
    const row = snapshot.records.find(({ key }) => key === SENTRY_NODE_SLOTS.mainnet)!;
    const node = JSON.parse(row.value);
    const admit = (value: string, key: string = row.key) => assertNativeRecordDomains([{ key, value }], snapshot.identity);
    assert.doesNotThrow(() => admit(row.value));
    for (const identity of [null, { ...snapshot.identity!, root: null }])
      assert.throws(() => assertNativeRecordDomains([row], identity));
    for (const key of [row.key + ':extra', row.key.toUpperCase(), row.key.replace('mainnet', 'other'), 'pali-native-sentry-nodes-v1:'])
      assert.throws(() => admit(row.value, key), /NATIVE_STORAGE_UNSUPPORTED_RECORD/);
    for (const changed of [
      { ...node, profileId: '0x' + 'fe'.repeat(32) },
      { ...node, walletBindingId: 'fe'.repeat(32) },
      { ...node, network: 'testnet', genesisHash: SENTRY_NETWORKS.testnet.genesisHash },
      { ...node, collateral: null },
      { ...node, linkedNodes: [{ ...node.linkedNodes[0], unknown: true }] },
      { ...node, unknown: true },
    ]) assert.throws(() => admit(JSON.stringify(changed)));
    for (const value of ['{', 'null', ' '.repeat(SENTRY_NODE_LIMITS.valueBytes + 1)])
      assert.throws(() => admit(value));

    // SQLite remains responsible for derived-vault binding as well as its
    // existing profile/wallet/network checks. Failed reads never repair data.
    for (const changed of [
      { ...node, profileId: '0x' + 'fe'.repeat(32) },
      { ...node, walletBindingId: 'fe'.repeat(32) },
      { ...node, vaultId: 'fe'.repeat(32) },
      { ...node, genesisHash: SENTRY_NETWORKS.testnet.genesisHash },
      { ...node, collateral: null },
    ]) {
      const value = JSON.stringify(changed);
      f.replaceNode(value);
      const before = f.retained();
      await assert.rejects(f.storage.recovery.readSnapshot(), { code: 'STORAGE_CORRUPT' });
      assert.equal((await readRecoveryInventory(f.storage)).status, 'unavailable');
      assert.deepEqual(f.retained(), before);
      f.replaceNode(row.value);
    }
    assert.equal((await readRecoveryInventory(f.storage)).status, 'needs-matching-phrase-verification');
  } finally { await f.close(); }
});

test('recovery admits 64 ordinary records plus two key and two node slots without exempting aliases', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('Ambient network forbidden'); });
  const f = await fixture();
  try {
    for (const network of ['mainnet', 'testnet'] as const) await f.link(network);
    const initial = await f.storage.recovery.readSnapshot();
    const ordinary = ({ key }: { key: string }) => !sentrySlotNetwork(key) && !sentryNodeSlotNetwork(key);
    const count = initial.records.filter(ordinary).length;
    for (let i = count; i < STORAGE_LIMITS.records; i++) {
      await f.storage.keyringStorage.set(sentrySettingsStorageKey(i.toString(16).padStart(64, '0'), 'mainnet'),
        { serviceUrl: 'https://sentry.test', maxFeeSatoshis: '100000' });
    }
    const full = await f.storage.recovery.readSnapshot();
    assert.equal(full.records.length, 68);
    assert.equal(full.records.filter(ordinary).length, 64);
    assert.equal(inspectRecoveryInventory(full).status, 'needs-matching-phrase-verification');
    const extra = { key: sentrySettingsStorageKey('ff'.repeat(32), 'mainnet'), value: JSON.stringify({ serviceUrl: 'https://sentry.test', maxFeeSatoshis: '100000' }) };
    // At only 67 total rows, 65 ordinary records still exceed their own limit.
    const fewerSentry = full.records.filter(({ key }) => key !== SENTRY_SLOT_KEYS.testnet && key !== SENTRY_NODE_SLOTS.testnet);
    assert.equal(inspectRecoveryInventory({ ...full, records: [...fewerSentry, extra] }).reason, 'invalid-record');
    const node = full.records.find(({ key }) => key === SENTRY_NODE_SLOTS.mainnet)!;
    const key = full.records.find(({ key }) => key === SENTRY_SLOT_KEYS.mainnet)!;
    assert.equal(inspectRecoveryInventory({ ...full, records: [...full.records, node] }).reason, 'invalid-record');
    assert.equal(inspectRecoveryInventory({ ...full, records: [...full.records, key] }).reason, 'invalid-record');
    const alias = { ...node, key: node.key + ':other' };
    assert.equal(inspectRecoveryInventory({ ...full, records: [...full.records, alias] }).reason, 'invalid-record');
    const withinLimit = full.records.filter(({ key }) => key !== extra.key && key !== sentrySettingsStorageKey(count.toString(16).padStart(64, '0'), 'mainnet'));
    assert.equal(inspectRecoveryInventory({ ...full, records: [...withinLimit, alias] }).reason, 'unsupported-record');
    assert.equal((await readRecoveryInventory(f.storage)).status, 'needs-matching-phrase-verification');
  } finally { await f.close(); }
});
