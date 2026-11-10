import { storageOnlyPublicSession } from './fixtures/publicSessionRecord.ts';
import { createTestPinRecord } from './fixtures/pinRecord.ts';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SigningKey } from 'ethers/crypto';
import { computeAddress } from 'ethers/transaction';

import type { SentryNetwork } from '../../../source/shared/sentryNetworks.ts';
import type { INetworkType } from '../../../source/types/network.ts';
import { stageInitialWallet } from '../../../source/wallet/accountRecovery.ts';
import {
  createSentryKeyVault,
  sentryKeyVaultStorageKey,
  type ISentryKeyStore,
} from '../../../source/wallet/sentryKeyVault.ts';
import { getUtxoSdkNetwork } from '../src/core/utxoNetworks.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { createNativeSentryKeyManagement } from '../src/custody/sentryKeyManagement.ts';
import {
  createNativeAccountRecord,
  sentryRootPublicIdentity,
  WALLET_CATALOGUE_KEY,
} from '../src/custody/walletCatalogue.ts';
import { SENTRY_SLOT_KEYS } from '../src/storage/sentryKeyDomain.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { WalletStorageError } from '../src/storage/types.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
  type SqlHook,
} from './storageHelpers.ts';

const makeRoot = (digit: string) => {
  const publicKey = SigningKey.computePublicKey('0x' + digit.repeat(64), true);
  return {
    address: computeAddress(publicKey),
    publicKey,
    profileId: '0x' + digit.repeat(64),
  };
};
const seed =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const marker = 'fc'.repeat(64);
const slot = (network: SentryNetwork) => SENTRY_SLOT_KEYS[network];
const current = () => undefined;
const scopeChanged = { code: 'STORAGE_CHANGED' };
const key = (index: number) => ({
  role: 'operator' as const,
  scheme: 'slh-dsa-shake-128s' as const,
  publicKey: index.toString(16).padStart(64, '0'),
  secretKey: marker,
});

test('Sentry management rejects asynchronous and nonvoid owner guards before any secret or storage work', async () => {
  for (const guard of [
    async () => undefined,
    async () => { throw new Error('Synthetic asynchronous owner failure'); },
    () => true,
  ]) {
    let calls = 0;
    const unavailable = async () => { calls++; throw new Error('Unexpected work'); };
    assert.throws(() => createNativeSentryKeyManagement({
      assertCurrent: guard,
      authenticate: unavailable,
      derivePublicKey: unavailable,
      lifetime: new AbortController().signal,
      network: 'mainnet',
      readSeed: unavailable,
      run: async (operation) => operation(),
      vaultHost: { crypto: () => webcrypto as unknown as Crypto, read: unavailable, write: unavailable },
      vaultId: 'ab'.repeat(32),
      readSettings: unavailable,
      writeSettings: unavailable,
    }), { code: 'CANCELLED' });
    await Promise.resolve();
    assert.equal(calls, 0);
  }
});

const eth = getNativeNetwork('ethereum');
const fixtureNetwork = {
  kind: 'ethereum' as INetworkType.Ethereum,
  chainId: Number(eth.chainId),
  slip44: eth.slip44,
  currency: eth.symbol,
  label: eth.name,
  url: eth.rpcUrl,
};
let stages:
  | Promise<Awaited<ReturnType<typeof stageInitialWallet>>[]>
  | undefined;
function stageFixture() {
  return (stages ??= Promise.all(
    [
      fixtureNetwork,
      getUtxoSdkNetwork('syscoin'),
      getUtxoSdkNetwork('utxo:5700'),
    ].map((network) =>
      stageInitialWallet(
        {
          key: String(network.slip44),
          network,
          password: 'Synthetic Sentry testing password 1!',
          phrase: seed,
        },
        { assertCurrent: current }
      )
    )
  ));
}

async function fixture(hooks?: { before?: SqlHook; after?: SqlHook }) {
  const [evm, ...utxo] = await stageFixture();
  const first = evm!.groups[0]!.accounts.HDAccount[0]!;
  const root = {
    address: first.address,
    publicKey: first.xpub.toLowerCase(),
    profileId: evm!.profileId,
  };
  const dir = await mkdtemp(join(tmpdir(), 'pali-sentry-storage-'));
  const file = join(dir, 'wallet.sqlite');
  let owned = nodeConnection(file, hooks);
  let storage = await SqliteWalletStorage.open(
    owned.connection,
    digest,
    INSTALLATION,
    true
  );
  await storage.keyringStorage.createManyIfAbsent(validPair());
  const binding = await storage.getWalletFingerprint();
  await storage.recovery.bindIdentity(binding, root, current);
  const catalogue = createNativeAccountRecord(
    { ...evm!, groups: [evm!, ...utxo].flatMap((stage) => stage.groups) },
    binding
  );
  await storage.keyringStorage.set(WALLET_CATALOGUE_KEY, catalogue);
  const bind = async (
    network: SentryNetwork,
    guard: () => void = current,
    overrides = {}
  ) => {
    const identity = (await storage.recovery.readIdentity())!;
    const xpub = sentryRootPublicIdentity(catalogue, network);
    const vaultId = createHash('sha256').update(xpub).digest('hex');
    const args = { vaultId, network, seed, assertCurrent: guard };
    const bound = storage.sentryKeys.bind(
      {
        network,
        profileId: root.profileId,
        vaultId,
        pairFingerprint: identity.pairFingerprint,
        walletBindingId: identity.walletBindingId,
        ...overrides,
      },
      guard
    );
    const vault = createSentryKeyVault({
      ...bound,
      crypto: () => webcrypto as unknown as Crypto,
    });
    assert.equal(await vault.getSentryVaultId(xpub), vaultId);
    return {
      args,
      vault,
      bound,
      key: sentryKeyVaultStorageKey(vaultId, network),
    };
  };
  return {
    bind,
    root,
    get storage() {
      return storage;
    },
    get db() {
      return owned.database;
    },
    raw(network: SentryNetwork): string | undefined {
      return owned.database
        .prepare('SELECT value FROM sentry_key_records WHERE key = ?')
        .get(slot(network))?.value as string | undefined;
    },
    async reopenExistingWalletSchema() {
      await storage.close();
      owned = nodeConnection(file, hooks);
      const schema = () =>
        owned.database
          .prepare("SELECT sql FROM sqlite_master WHERE name = 'keyring_records'")
          .get()?.sql;
      const records = () =>
        owned.database.prepare('SELECT * FROM keyring_records ORDER BY key').all();
      const originalSchema = schema();
      const originalRecords = records();
      assert.match(String(originalSchema), /ELSE 65536 END/);
      assert(!String(originalSchema).includes('sentry'));
      assert.equal(
        owned.database.prepare('SELECT COUNT(*) AS total FROM sentry_key_records').get()?.total,
        0
      );
      // This is the current wallet schema, before the new typed domain exists.
      owned.database.exec('DROP TABLE sentry_key_records');
      storage = await SqliteWalletStorage.open(
        owned.connection,
        digest,
        INSTALLATION,
        false
      );
      assert.equal(schema(), originalSchema);
      assert.deepEqual(records(), originalRecords);
      assert.equal(
        owned.database.prepare('SELECT COUNT(*) AS total FROM sentry_key_records').get()?.total,
        0
      );
    },
    async reopen() {
      await storage.close();
      owned = nodeConnection(file, hooks);
      storage = await SqliteWalletStorage.open(
        owned.connection,
        digest,
        INSTALLATION,
        false
      );
    },
    async close() {
      await storage.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('opens the current wallet schema and preserves 100 maximum-size encrypted Sentry keys across reopen', async () => {
  const f = await fixture();
  try {
    await f.reopenExistingWalletSchema();
    const { args, vault } = await f.bind('mainnet');
    // Every UTF-16 code unit encodes as a six-byte JSON escape.
    const label = '\0'.repeat(80);
    const entries = Array.from({ length: 100 }, (_, i) => ({
      label,
      key: key(i + 1),
    }));
    for (let start = 0; start < entries.length; start += 20) {
      const saved = await vault.saveSentryKeys({
        ...args,
        entries: entries.slice(start, start + 20),
      });
      assert.equal(saved.length, 20);
      assert(saved.every((entry) => !Object.hasOwn(entry, 'secretKey')));
    }
    const raw = f.raw('mainnet')!;
    const stored = JSON.parse(raw) as ISentryKeyStore;
    assert.equal(stored.keys.length, 100);
    assert(stored.keys.every((entry) => entry.ciphertext.length === 574));
    assert.equal(Buffer.byteLength(raw), 131919);
    assert(!raw.includes(marker) && !raw.includes(seed));
    await assert.rejects(
      vault.saveSentryKeys({ ...args, entries: [{ label, key: key(101) }] }),
      /key limit/
    );
    await f.reopen();
    const restored = await f.bind('mainnet');
    const summaries = await restored.vault.listSentryKeys(
      args.vaultId,
      args.network
    );
    assert.equal(summaries.length, 100);
    assert.deepEqual(
      await restored.vault.loadSentryKey({
        ...restored.args,
        id: summaries[99]!.id,
      }),
      key(100)
    );
    assert.equal(f.raw('mainnet'), raw);
  } finally {
    await f.close();
  }
});

test('held SQL rolls back on owner retirement and exact CAS rejects a conflicting writer', async () => {
  let hold = false;
  let entered!: () => void;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const drain = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture({
    async after(kind, sql) {
      if (
        hold &&
        kind === 'run' &&
        sql.startsWith('INSERT INTO sentry_key_records') &&
        sql.includes('ON CONFLICT')
      ) {
        hold = false;
        entered();
        await drain;
      }
    },
  });
  try {
    let active = true;
    const retiring = await f.bind('mainnet', () => {
      if (!active) throw Error('route retired');
    });
    const stale = retiring.vault.saveSentryKeys({
      ...retiring.args,
      entries: [{ label: 'Held', key: key(1) }],
    });
    hold = true;
    await held;
    active = false;
    release();
    await assert.rejects(stale, scopeChanged);
    assert.equal(f.raw('mainnet'), undefined);

    const first = await f.bind('mainnet');
    const competing = await f.bind('mainnet');
    const results = await Promise.allSettled([
      first.vault.saveSentryKeys({
        ...first.args,
        entries: [{ label: 'First', key: key(1) }],
      }),
      competing.vault.saveSentryKeys({
        ...competing.args,
        entries: [{ label: 'Other', key: key(2) }],
      }),
    ]);
    assert.equal(
      results.filter(({ status }) => status === 'fulfilled').length,
      1
    );
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    assert.equal(failed?.reason.code, 'STORAGE_CHANGED');
    const store = (await first.bound.read(first.key)) as ISentryKeyStore;
    await assert.rejects(
      first.bound.write(first.key, structuredClone(store), store, current),
      scopeChanged
    );
    await assert.rejects(
      first.bound.write(
        first.key,
        store,
        {
          ...store,
          keys: store.keys.map((entry) => ({ ...entry, secretKey: marker })),
        },
        current
      ),
      { code: 'STORAGE_CORRUPT' }
    );
    assert(!f.raw('mainnet')!.includes(marker));
    const observed = (await first.bound.read(first.key)) as ISentryKeyStore;
    const unsupported = structuredClone(observed);
    unsupported.keys[0]!.summary.role = 'collateral';
    await assert.rejects(
      first.bound.write(first.key, observed, unsupported, current),
      { code: 'STORAGE_CORRUPT' }
    );
    assert.throws(() => f.storage.keyringStorage.get(slot('mainnet')), {
      code: 'STORAGE_CORRUPT',
    });
    assert.throws(() => f.storage.keyringStorage.set(slot('mainnet'), store), {
      code: 'STORAGE_CORRUPT',
    });
    assert.throws(() => f.storage.keyringStorage.deleteItem(slot('mainnet')), {
      code: 'STORAGE_CORRUPT',
    });
    assert.throws(() => f.storage.keyringStorage.compareAndSetMany([
      { key: slot('mainnet'), expected: store, value: undefined },
    ], current), { code: 'STORAGE_CORRUPT' });

    await first.vault.removeSentryKey(
      first.args.vaultId,
      'mainnet',
      store.keys[0]!.summary.id,
      current
    );
    const before = (await first.bound.read(first.key)) as ISentryKeyStore;
    const emptyRaw = f.raw('mainnet');
    const [transient] = await competing.vault.saveSentryKeys({
      ...competing.args,
      entries: [{ label: 'Transient', key: key(3) }],
    });
    await competing.vault.removeSentryKey(
      competing.args.vaultId,
      'mainnet',
      transient!.id,
      current
    );
    assert.equal(f.raw('mainnet'), emptyRaw);
    await assert.rejects(
      first.bound.write(first.key, before, before, current),
      scopeChanged
    );
  } finally {
    release();
    await f.close();
  }
});

test('wallet removal detects a late Sentry edit and rolls back nonempty keys when its owner retires', async () => {
  let hold = false;
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  const drain = new Promise<void>((resolve) => { release = resolve; });
  const f = await fixture({
    async after(kind, sql) {
      if (hold && kind === 'run' && sql === 'DELETE FROM sentry_key_records') {
        entered();
        await drain;
      }
    },
  });
  try {
    const owner = await f.bind('mainnet');
    await owner.vault.saveSentryKeys({
      ...owner.args, entries: [{ label: 'First', key: key(1) }],
    });
    const stale = await f.storage.recovery.readSnapshot();
    await owner.vault.saveSentryKeys({
      ...owner.args, entries: [{ label: 'Later', key: key(2) }],
    });
    const raw = f.raw('mainnet');
    await assert.rejects(f.storage.removal.commit(stale, current), scopeChanged);
    assert.equal(f.raw('mainnet'), raw);

    const snapshot = await f.storage.recovery.readSnapshot();
    let active = true;
    hold = true;
    const removing = assert.rejects(
      f.storage.removal.commit(snapshot, () => { if (!active) throw new WalletStorageError('STORAGE_CHANGED'); }),
      scopeChanged
    );
    await reached;
    active = false;
    release();
    await removing;
    hold = false;
    assert.equal(f.raw('mainnet'), raw);
    await f.reopen();
    assert.equal(f.raw('mainnet'), raw);
    assert.equal(JSON.parse(raw!).keys.length, 2);
  } finally {
    release();
    await f.close();
  }
});

test('a lost Sentry commit acknowledgement quarantines the connection and preserves the exact new bucket', async () => {
  let loseCommit = false;
  const f = await fixture({
    after(kind, sql) {
      if (loseCommit && kind === 'exec' && sql === 'COMMIT') {
        loseCommit = false;
        throw Error('Lost synthetic acknowledgement');
      }
    },
  });
  try {
    const owner = await f.bind('mainnet');
    loseCommit = true;
    await assert.rejects(
      owner.vault.saveSentryKeys({
        ...owner.args,
        entries: [{ label: 'Committed', key: key(1) }],
      }),
      { code: 'STORAGE_REOPEN_REQUIRED' }
    );
    const raw = f.raw('mainnet')!;
    assert.equal(JSON.parse(raw).keys.length, 1);
    await assert.rejects(owner.bound.read(owner.key), {
      code: 'STORAGE_REOPEN_REQUIRED',
    });
    await f.reopen();
    const reopened = await f.bind('mainnet');
    assert.equal(
      (await reopened.vault.listSentryKeys(reopened.args.vaultId, 'mainnet'))
        .length,
      1
    );
    assert.equal(f.raw('mainnet'), raw);
  } finally {
    await f.close();
  }
});

test('scoped slots reject swaps and preserve both encrypted buckets through matching recovery', async () => {
  const f = await fixture();
  try {
    const main = await f.bind('mainnet');
    const testnet = await f.bind('testnet');
    const [mainKey] = await main.vault.saveSentryKeys({
      ...main.args,
      entries: [{ label: 'Main', key: key(1) }],
    });
    await testnet.vault.saveSentryKeys({
      ...testnet.args,
      entries: [{ label: 'Test', key: key(2) }],
    });
    const mainRaw = f.raw('mainnet')!;
    const testRaw = f.raw('testnet')!;
    const update = f.db.prepare(
      'UPDATE sentry_key_records SET value = ? WHERE key = ?'
    );
    await assert.rejects(main.bound.read(testnet.key), scopeChanged);
    await assert.rejects(
      (
        await f.bind('mainnet', current, { walletBindingId: 'f'.repeat(64) })
      ).bound.read(main.key),
      scopeChanged
    );
    await assert.rejects(
      (
        await f.bind('mainnet', current, { profileId: makeRoot('2').profileId })
      ).bound.read(main.key),
      scopeChanged
    );
    update.run(mainRaw, slot('testnet'));
    await assert.rejects(testnet.bound.read(testnet.key), {
      code: 'STORAGE_CORRUPT',
    });
    await assert.rejects(f.storage.recovery.readSnapshot(), {
      code: 'STORAGE_CORRUPT',
    });
    update.run(testRaw, slot('testnet'));

    // Rewriting the copied bucket's public header still cannot authenticate its ciphertext.
    const reflected = JSON.parse(mainRaw) as ISentryKeyStore;
    reflected.vaultId = testnet.args.vaultId;
    reflected.network = 'testnet';
    reflected.keys[0]!.summary.network = 'testnet';
    update.run(JSON.stringify(reflected), slot('testnet'));
    await assert.rejects(
      testnet.vault.loadSentryKey({ ...testnet.args, id: mainKey!.id })
    );
    update.run(testRaw, slot('testnet'));

    const candidate = validPair(2);
    const pair = { publicSession: storageOnlyPublicSession((await f.storage.recovery.readIdentity())!.walletBindingId), vault: candidate.vault, keys: candidate['vault-keys'], pin: await createTestPinRecord(f.storage, { vault: candidate.vault, keys: candidate['vault-keys'] }, (await f.storage.recovery.readIdentity())!.walletBindingId) };
    const foreign = await f.storage.recovery.readSnapshot();
    await assert.rejects(
      f.storage.recovery.prepareReplacement!(foreign, pair, makeRoot('2')),
      scopeChanged
    );
    const matching = await f.storage.recovery.readSnapshot();
    const plan = await f.storage.recovery.prepareReplacement!(
      matching,
      pair,
      f.root
    );
    await f.storage.recovery.commitReplacement!(plan, current);
    assert.equal(f.raw('mainnet'), mainRaw);
    assert.equal(f.raw('testnet'), testRaw);
    await assert.rejects(main.bound.read(main.key), scopeChanged);
    await assert.rejects(testnet.bound.read(testnet.key), scopeChanged);
    await f.reopen();
    const removal = await f.storage.recovery.readSnapshot();
    assert.equal(f.raw('mainnet'), mainRaw);
    assert.equal(f.raw('testnet'), testRaw);
    assert.deepEqual(await f.storage.removal.commit(removal, current), {
      status: 'wallet-records-removed',
    });
    assert.equal(f.raw('mainnet'), undefined);
    assert.equal(f.raw('testnet'), undefined);
  } finally {
    await f.close();
  }
});
