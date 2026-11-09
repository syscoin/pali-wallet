import {
  createNativeSentryNodeManagement,
  createNativeSentryCollateral,
} from '../src/custody/sentryNodeManagement.ts';
import { createSentryCollateralCoordinator } from '../../../source/wallet/sentryCollateral.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageInitialWallet } from '../../../source/wallet/accountRecovery.ts';
import {
  SENTRY_NETWORKS,
  type SentryNetwork,
} from '../../../source/shared/sentryNetworks.ts';
import {
  createNativeAccountRecord,
  sentryRootPublicIdentity,
  WALLET_CATALOGUE_KEY,
} from '../src/custody/walletCatalogue.ts';
import { getUtxoSdkNetwork } from '../src/core/utxoNetworks.ts';
import {
  emptySentryNodeStore,
  SENTRY_NODE_SLOTS,
  SENTRY_NODE_LIMITS,
  type SentryNodeStore,
} from '../src/storage/sentryNodeDomain.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import type { SentryStorageScope } from '../src/storage/types.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
  type SqlHook,
} from './storageHelpers.ts';
import { sentryNodeResponse } from './sentryNodeFixtures.ts';
const current = () => undefined;
const changed = { code: 'STORAGE_CHANGED' };
let stages: Promise<Awaited<ReturnType<typeof stageInitialWallet>>[]>;
const fixtureStages = () =>
  (stages ??= Promise.all(
    [
      {
        kind: 'ethereum',
        chainId: 1,
        slip44: 60,
        url: 'https://fixture.invalid',
        currency: 'ETH',
        label: 'Ethereum',
      },
      getUtxoSdkNetwork('syscoin'),
      getUtxoSdkNetwork('utxo:5700'),
    ].map((network) =>
      stageInitialWallet(
        {
          key: String(network.slip44),
          network: network as any,
          password: 'Synthetic Sentry node storage password 1!',
          phrase:
            'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        },
        { assertCurrent: current }
      )
    )
  ));
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const [evm, ...utxo] = await fixtureStages(),
    first = evm!.groups[0]!.accounts.HDAccount[0]!;
  const root = {
    address: first.address,
    publicKey: first.xpub.toLowerCase(),
    profileId: evm!.profileId,
  };
  const directory = await mkdtemp(join(tmpdir(), 'pali-sentry-node-storage-')),
    file = join(directory, 'wallet.sqlite');
  let owned = nodeConnection(file, hooks),
    storage = await SqliteWalletStorage.open(
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
  async function bind(
    network: SentryNetwork = 'mainnet',
    check: () => void = current,
    patch: Partial<SentryStorageScope> = {}
  ) {
    const identity = (await storage.recovery.readIdentity())!;
    const scope = {
      network,
      profileId: root.profileId,
      walletBindingId: identity.walletBindingId,
      pairFingerprint: identity.pairFingerprint,
      vaultId: createHash('sha256')
        .update(sentryRootPublicIdentity(catalogue, network))
        .digest('hex'),
      ...patch,
    };
    return {
      scope,
      rootPublicIdentity: sentryRootPublicIdentity(catalogue, network),
      port: storage.sentryNodes!.bind(scope, check),
      empty: emptySentryNodeStore(scope),
    };
  }
  return {
    root,
    bind,
    get storage() {
      return storage;
    },
    get db() {
      return owned.database;
    },
    raw(network: SentryNetwork = 'mainnet') {
      return owned.database
        .prepare('SELECT value FROM sentry_node_records WHERE key = ?')
        .get(SENTRY_NODE_SLOTS[network])?.value as string | undefined;
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
      try {
        owned.database.close();
      } catch {}
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const linked = (empty: SentryNodeStore): SentryNodeStore => {
  const node = sentryNodeResponse(
    SENTRY_NETWORKS[empty.network].genesisHash
  ).node;
  return {
    ...empty,
    linkedNodes: [node],
    collateral: [{ ...node.collateralOutpoint, proTxHash: node.proTxHash }],
  };
};

test('atomic node+collateral commits preserve existing wallet bytes and cold reload in both slots', async () => {
  const f = await fixture();
  try {
    const wallet = f.db
      .prepare('SELECT * FROM keyring_records ORDER BY key')
      .all();
    for (const network of ['mainnet', 'testnet'] as const) {
      const { port, empty } = await f.bind(network);
      assert.equal(await port.read(), undefined);
      await port.compareAndSet(undefined, linked(empty), current);
    }
    assert.deepEqual(
      f.db.prepare('SELECT * FROM keyring_records ORDER BY key').all(),
      wallet
    );
    const main = f.raw(),
      testnet = f.raw('testnet');
    await f.reopen();
    assert.equal(f.raw(), main);
    assert.equal(f.raw('testnet'), testnet);
    for (const network of ['mainnet', 'testnet'] as const) {
      const { port, empty } = await f.bind(network);
      assert.deepEqual(await port.read(), linked(empty));
    }
  } finally {
    await f.close();
  }
});

test('CAS refuses forged, consumed and conflicting node-domain snapshots', async () => {
  const f = await fixture();
  try {
    const { port, empty } = await f.bind();
    await port.compareAndSet(undefined, linked(empty), current);
    const first = await port.read(),
      second = await port.read();
    await assert.rejects(
      port.compareAndSet(structuredClone(first), empty, current),
      changed
    );
    await port.compareAndSet(first, { ...first!, collateral: [] }, current);
    await assert.rejects(port.compareAndSet(second, empty, current), changed);
    await assert.rejects(port.compareAndSet(first, empty, current), changed);
    assert.equal((await port.read())!.linkedNodes.length, 1);
    assert.equal((await port.read())!.collateral.length, 0);
  } finally {
    await f.close();
  }
});

test('owner retirement after held SQL rolls back the whole node+collateral commit', async () => {
  let held = false,
    enter!: () => void,
    release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve)),
    drain = new Promise<void>((resolve) => (release = resolve));
  const f = await fixture({
    async after(kind, sql) {
      if (
        held &&
        kind === 'run' &&
        sql.startsWith('INSERT INTO sentry_node_records')
      ) {
        held = false;
        enter();
        await drain;
      }
    },
  });
  try {
    let active = true;
    const { port, empty } = await f.bind('mainnet', () => {
      if (!active) throw Error('Retired session');
    });
    held = true;
    const write = port.compareAndSet(undefined, linked(empty), current);
    await entered;
    active = false;
    release();
    await assert.rejects(write, changed);
    assert.equal(f.raw(), undefined);
  } finally {
    release?.();
    await f.close();
  }
});

test('profile, vault, wallet binding, pair and network swaps cannot read or overwrite an owned domain', async () => {
  const f = await fixture();
  try {
    const { port, empty } = await f.bind();
    await port.compareAndSet(undefined, linked(empty), current);
    for (const patch of [
      { profileId: '0x' + 'fe'.repeat(32) },
      { vaultId: 'fe'.repeat(32) },
      { walletBindingId: 'fe'.repeat(32) },
      { pairFingerprint: 'fe'.repeat(32) },
    ]) {
      const foreign = await f.bind('mainnet', current, patch);
      await assert.rejects(foreign.port.read(), changed);
      await assert.rejects(
        foreign.port.compareAndSet(undefined, foreign.empty, current),
        changed
      );
    }
    f.db
      .prepare('INSERT INTO sentry_node_records (key,value) VALUES (?,?)')
      .run(SENTRY_NODE_SLOTS.testnet, f.raw()!);
    await assert.rejects((await f.bind('testnet')).port.read(), {
      code: 'STORAGE_CORRUPT',
    });
    await assert.rejects(f.storage.recovery.readSnapshot(), {
      code: 'STORAGE_CORRUPT',
    });
    await assert.rejects(f.reopen());
  } finally {
    await f.close();
  }
});

test('native domain refuses malformed/oversized records and never treats null collateral as absence', async () => {
  const f = await fixture();
  try {
    const { port, empty } = await f.bind(),
      good = linked(empty);
    for (const value of [
      { ...good, collateral: null },
      { ...good, genesisHash: 'fe'.repeat(32) },
      { ...good, linkedNodes: [{ ...good.linkedNodes[0], unknown: true }] },
      { ...good, collateral: [...good.collateral, ...good.collateral] },
      {
        ...good,
        linkedNodes: [
          {
            ...good.linkedNodes[0],
            collateralOutpoint: { txid: 'ff'.repeat(32), vout: 1 },
          },
        ],
      },
      { ...good, collateral: [{ ...good.collateral[0], unknown: true }] },
      { ...good, linkedNodes: Array(1001).fill(good.linkedNodes[0]) },
    ]) {
      await assert.rejects(
        port.compareAndSet(undefined, value as any, current)
      );
      assert.equal(f.raw(), undefined);
    }
    assert.throws(() =>
      f.db
        .prepare('INSERT INTO sentry_node_records (key,value) VALUES (?,?)')
        .run(
          SENTRY_NODE_SLOTS.mainnet,
          ' '.repeat(SENTRY_NODE_LIMITS.valueBytes + 1)
        )
    );
    for (const guard of [undefined, async () => undefined, () => true])
      await assert.rejects(port.compareAndSet(undefined, good, guard as any));
    assert.equal(f.raw(), undefined);
  } finally {
    await f.close();
  }
});

test('matching recovery preserves both domains, stale removal refuses, and Forget Wallet deletes nodes atomically', async () => {
  const f = await fixture();
  try {
    const main = await f.bind(),
      testnet = await f.bind('testnet');
    await main.port.compareAndSet(undefined, linked(main.empty), current);
    await testnet.port.compareAndSet(undefined, linked(testnet.empty), current);
    const bytes = [f.raw(), f.raw('testnet')],
      old = await f.storage.recovery.readSnapshot();
    const observed = await main.port.read();
    await main.port.compareAndSet(
      observed,
      { ...observed!, collateral: [] },
      current
    );
    await assert.rejects(f.storage.removal.commit(old, current), changed);
    await main.port.compareAndSet(
      await main.port.read(),
      linked(main.empty),
      current
    );
    const candidate = validPair(2),
      pair = { vault: candidate.vault, keys: candidate['vault-keys'] },
      snapshot = await f.storage.recovery.readSnapshot();
    await assert.rejects(
      f.storage.recovery.prepareReplacement!(snapshot, pair, {
        ...f.root,
        profileId: '0x' + 'fe'.repeat(32),
      }),
      changed
    );
    const matching = await f.storage.recovery.readSnapshot();
    const plan = await f.storage.recovery.prepareReplacement!(
      matching,
      pair,
      f.root
    );
    await f.storage.recovery.commitReplacement!(plan, current);
    assert.deepEqual([f.raw(), f.raw('testnet')], bytes);
    await assert.rejects(main.port.read(), changed);
    await f.reopen();
    const removal = await f.storage.recovery.readSnapshot();
    assert.equal(
      removal.records.filter((row) =>
        Object.values(SENTRY_NODE_SLOTS).includes(row.key as any)
      ).length,
      2
    );
    assert.deepEqual(await f.storage.removal.commit(removal, current), {
      status: 'wallet-records-removed',
    });
    assert.equal(f.raw(), undefined);
    assert.equal(f.raw('testnet'), undefined);
    await f.reopen();
    assert.equal((await f.storage.recovery.readSnapshot()).records.length, 0);
  } finally {
    await f.close();
  }
});

async function nodeManager(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    network?: SentryNetwork;
    check?: () => void;
    authenticate?: (password: string, check: () => void) => Promise<void>;
    fetch?: typeof fetch;
    readSettings?: () => Promise<unknown>;
  } = {}
) {
  const check = options.check ?? current,
    network = options.network ?? 'mainnet',
    bound = await f.bind(network, check),
    lifetime = new AbortController();
  let authCalls = 0;
  const manager = createNativeSentryNodeManagement({
    scope: bound.scope,
    rootPublicIdentity: bound.rootPublicIdentity,
    storage: bound.port,
    coordinator: createSentryCollateralCoordinator(),
    assertCurrent: check,
    lifetime: lifetime.signal,
    run: async (operation) => operation(),
    readSettings:
      options.readSettings ??
      (async () => ({
        serviceUrl: 'https://sentry.test',
        maxFeeSatoshis: '1000',
      })),
    async authenticate(password, guard) {
      authCalls++;
      guard();
      if (options.authenticate) return options.authenticate(password, guard);
      assert.equal(password, 'confirmed');
    },
    fetch:
      options.fetch ??
      (async () =>
        Response.json(
          sentryNodeResponse(SENTRY_NETWORKS[network].genesisHash)
        )),
  });
  return {
    manager,
    bound,
    lifetime,
    get authCalls() {
      return authCalls;
    },
  };
}

test('native manager uses shared fresh link workflow, atomic storage and exact acknowledged protection release', async () => {
  const f = await fixture();
  try {
    const n = await nodeManager(f),
      identity = await f.storage.recovery.readIdentity();
    const empty = await n.manager.list();
    assert.deepEqual(empty.linkedNodes, []);
    assert.deepEqual(empty.collateral, []);
    const cancelled = await n.manager.prepareLink({ version: 1, proTxHash: sentryNodeResponse(SENTRY_NETWORKS.mainnet.genesisHash).node.proTxHash, genesisHash: SENTRY_NETWORKS.mainnet.genesisHash }, 'Pali Wallet');
    n.manager.cancelLink(cancelled.id);
    await assert.rejects(n.manager.confirmLink(cancelled));
    const review = await n.manager.prepareLink({ version: 1, proTxHash: sentryNodeResponse(SENTRY_NETWORKS.mainnet.genesisHash).node.proTxHash, genesisHash: SENTRY_NETWORKS.mainnet.genesisHash }, 'Pali Wallet');
    assert(
      Object.isFrozen(review) && Object.isFrozen(review.node.collateralOutpoint)
    );
    await assert.rejects(n.manager.confirmLink({ ...review }));
    assert.equal(f.raw(), undefined);
    await n.manager.confirmLink(review);
    const listed = await n.manager.list();
    assert.equal(listed.linkedNodes.length, 1);
    assert.equal(listed.collateral.length, 1);
    assert.equal(n.authCalls, 0);
    const reservation = listed.collateral[0]!;
    await assert.rejects(
      n.manager.releaseCollateral({
        reservation,
        password: 'confirmed',
        acknowledgeNodeStops: false,
      } as any)
    );
    assert.equal(n.authCalls, 0);
    await assert.rejects(
      n.manager.releaseCollateral({
        reservation,
        password: 'wrong',
        acknowledgeNodeStops: true,
      })
    );
    assert.equal((await n.manager.list()).collateral.length, 1);
    await n.manager.releaseCollateral({
      reservation,
      password: 'confirmed',
      acknowledgeNodeStops: true,
    });
    assert.equal((await n.manager.list()).collateral.length, 0);
    assert.equal((await n.manager.list()).linkedNodes.length, 1);
    assert.deepEqual(await f.storage.recovery.readIdentity(), identity);
    n.manager.dispose();
    await f.reopen();
    const reopened = await nodeManager(f);
    assert.equal((await reopened.manager.list()).linkedNodes.length, 1);
    assert.equal((await reopened.manager.list()).collateral.length, 0);
    reopened.manager.dispose();
  } finally {
    await f.close();
  }
});

test('native shared workflow refuses a changed trusted source/node and owner cancellation before commit', async () => {
  const f = await fixture();
  try {
    let url = 'https://sentry.test',
      active = true,
      modified = false;
    const n = await nodeManager(f, {
      check: () => {
        if (!active) throw Error('CANCELLED');
      },
      readSettings: async () => ({ serviceUrl: url, maxFeeSatoshis: '1000' }),
      fetch: async () => {
        const response = sentryNodeResponse(
          SENTRY_NETWORKS.mainnet.genesisHash
        );
        if (modified) response.node.service = '192.0.2.11:8369';
        return Response.json(response);
      },
    });
    const id = sentryNodeResponse(SENTRY_NETWORKS.mainnet.genesisHash).node
      .proTxHash;
    const first = await n.manager.prepareLink({ version: 1, proTxHash: id, genesisHash: SENTRY_NETWORKS.mainnet.genesisHash }, 'Pali Wallet');
    url = 'https://other.test';
    await assert.rejects(n.manager.confirmLink(first));
    assert.equal(f.raw(), undefined);
    url = 'https://sentry.test';
    const second = await n.manager.prepareLink({ version: 1, proTxHash: id, genesisHash: SENTRY_NETWORKS.mainnet.genesisHash }, 'Pali Wallet');
    modified = true;
    await assert.rejects(n.manager.confirmLink(second));
    assert.equal(f.raw(), undefined);
    modified = false;
    const third = await n.manager.prepareLink({ version: 1, proTxHash: id, genesisHash: SENTRY_NETWORKS.mainnet.genesisHash }, 'Pali Wallet');
    active = false;
    await assert.rejects(n.manager.confirmLink(third));
    assert.equal(f.raw(), undefined);
    n.manager.dispose();
  } finally {
    await f.close();
  }
});

test('native manager cancellation during atomic link SQL rolls back both public registries', async () => {
  let held = false,
    enter!: () => void,
    release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve)),
    drain = new Promise<void>((resolve) => (release = resolve));
  const f = await fixture({
    async after(kind, sql) {
      if (
        held &&
        kind === 'run' &&
        sql.startsWith('INSERT INTO sentry_node_records')
      ) {
        held = false;
        enter();
        await drain;
      }
    },
  });
  try {
    const n = await nodeManager(f),
      review = await n.manager.prepareLink({ version: 1, proTxHash: sentryNodeResponse(SENTRY_NETWORKS.mainnet.genesisHash).node.proTxHash, genesisHash: SENTRY_NETWORKS.mainnet.genesisHash }, 'Pali Wallet');
    held = true;
    const pending = n.manager.confirmLink(review);
    await entered;
    n.lifetime.abort();
    release();
    await assert.rejects(pending);
    assert.equal(f.raw(), undefined);
  } finally {
    release?.();
    await f.close();
  }
});

test('native registry CAS keeps an exact raw observation when another coordinator commits first', async () => {
  const f = await fixture();
  try {
    let reads = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const make = async () => {
      const bound = await f.bind();
      return createNativeSentryCollateral({
        scope: bound.scope,
        rootPublicIdentity: bound.rootPublicIdentity,
        assertCurrent: current,
        coordinator: createSentryCollateralCoordinator(),
        storage: {
          async read() {
            const value = await bound.port.read();
            if (++reads === 2) release();
            await barrier;
            return value;
          },
          compareAndSet: bound.port.compareAndSet,
        },
      });
    };
    const [a, b] = await Promise.all([make(), make()]);
    const reserve = async (access: typeof a, digit: string) =>
      access.registry.reserveSentryCollateral({
        ...access.scope,
        assertCurrent: current,
        admission: await access.registry.captureSentryCollateralAdmission(
          access.scope
        ),
        reservation: {
          txid: digit.repeat(64),
          vout: 0,
          proTxHash: digit.repeat(64),
        },
      });
    const results = await Promise.allSettled([
      reserve(a, 'a'),
      reserve(b, 'b'),
    ]);
    assert.equal(
      results.filter((item) => item.status === 'fulfilled').length,
      1
    );
    assert.equal(
      results.filter((item) => item.status === 'rejected').length,
      1
    );
    const stored = await (await f.bind()).port.read();
    assert.equal(stored!.collateral.length, 1);
  } finally {
    await f.close();
  }
});

test('Forget Wallet keeps node+collateral records when its owner retires during the held delete', async () => {
  let held = false,
    enter!: () => void,
    release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve)),
    drain = new Promise<void>((resolve) => (release = resolve));
  const f = await fixture({
    async after(kind, sql) {
      if (held && kind === 'run' && sql === 'DELETE FROM sentry_node_records') {
        held = false;
        enter();
        await drain;
      }
    },
  });
  try {
    const { port, empty } = await f.bind();
    await port.compareAndSet(undefined, linked(empty), current);
    const original = f.raw(),
      snapshot = await f.storage.recovery.readSnapshot();
    let active = true;
    held = true;
    const pending = f.storage.removal.commit(snapshot, () => {
      if (!active) throw Error('CANCELLED');
    });
    await entered;
    active = false;
    release();
    await assert.rejects(pending);
    assert.equal(f.raw(), original);
  } finally {
    release?.();
    await f.close();
  }
});
