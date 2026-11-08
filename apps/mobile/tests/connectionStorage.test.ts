import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getBitcoinMainnetNetwork } from '../../../source/utils/defaultNetworks.ts';
import { XPUB } from './publicWatchFixtures.ts';
import {
  DAPP_REQUEST_LIMITS,
  assertProviderRequestBudget,
} from '../../../source/utils/requestPayloadBudget.ts';
import {
  createDappSessions,
  commitDappPermissionGrant,
} from '../../../source/wallet/dappSessions.ts';
import type {
  DappGrant,
  DappPermissionFrame,
} from '../../../source/shared/dappTypes.ts';
import type {
  INetwork,
  KeyringAccountType,
} from '../../../source/types/network.ts';
import {
  NATIVE_CONNECTION_STORAGE_KEY,
  openNativeConnectionRepository,
  type NativeConnectionBinding,
} from '../src/connections/storage.ts';
import { CONNECTION_RECORD_LIMITS } from '../src/storage/connectionRecordKey.ts';
import { ACCOUNT_RECORD_KEY } from '../src/storage/accountRecordKey.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
  type SqlHook,
} from './storageHelpers.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';

const WALLET = 'a1'.repeat(32);
const ORIGIN = 'https://reported.example';
const BINDING: NativeConnectionBinding = {
  peerPublicKey: 'b2'.repeat(32),
  topic: 'c3'.repeat(32),
  origin: ORIGIN,
};
const GRANT: DappGrant = {
  host: ORIGIN,
  accountId: 0,
  accountType: 'HDAccount' as KeyringAccountType,
  chain: 'ethereum' as INetwork['kind'],
  chainId: 1,
  date: 10,
};
const FRAME: DappPermissionFrame = {
  dapps: { [ORIGIN]: GRANT },
  pendingOrigins: [],
};
const current = () => undefined;

// Field shapes from WalletConnect Core 2.25.0 pairing.ts:158 and
// SignClient 2.25.0 engine.ts:509. Optional values are own undefined fields.
function protocolFixtures() {
  const metadata = {
    name: 'Pali',
    description: 'Wallet',
    url: 'https://paliwallet.com',
    icons: [],
  };
  const relay = { protocol: 'irn' };
  const namespaces = {
    eip155: {
      accounts: ['eip155:1:0x' + '11'.repeat(20)],
      methods: ['personal_sign'],
      events: ['accountsChanged', 'chainChanged'],
    },
  };
  const self = { publicKey: 'd4'.repeat(32), metadata };
  const pairing = {
    topic: BINDING.topic,
    relay,
    expiry: 1893456000,
    active: false,
    methods: undefined,
  };
  const session = {
    relay,
    namespaces,
    expiry: 1893456000,
    proposalRequestsResponses: undefined,
    topic: 'e5'.repeat(32),
    requiredNamespaces: {},
    optionalNamespaces: {},
    pairingTopic: BINDING.topic,
    acknowledged: false,
    self,
    peer: {
      publicKey: BINDING.peerPublicKey,
      metadata: { ...metadata, url: ORIGIN },
    },
    controller: self.publicKey,
    transportType: 'relay',
    authentication: undefined,
    walletPayResult: undefined,
  };
  return {
    pairing,
    sessions: [session, { ...session, topic: 'f6'.repeat(32) }],
  };
}

function latch() {
  let release!: () => void, enter!: () => void;
  return {
    gate: new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached: new Promise<void>((resolve) => {
      enter = resolve;
    }),
    release: () => release(),
    enter: () => enter(),
  };
}
async function fixture() {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'pali-connection-storage-')
  );
  const file = path.join(directory, 'wallet.sqlite');
  let before: SqlHook | undefined;
  let owned = nodeConnection(file, { before: (...args) => before?.(...args) });
  let storage = await SqliteWalletStorage.open(
    owned.connection,
    digest,
    INSTALLATION,
    true
  );
  await storage.keyringStorage.createManyIfAbsent(validPair());
  return {
    get storage() {
      return storage;
    },
    setBefore(value?: SqlHook) {
      before = value;
    },
    async reopen() {
      await storage.close();
      owned = nodeConnection(file, { before: (...args) => before?.(...args) });
      storage = await SqliteWalletStorage.open(
        owned.connection,
        digest,
        INSTALLATION,
        false
      );
    },
    async close() {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function publish(
  repository: Awaited<ReturnType<typeof openNativeConnectionRepository>>,
  binding = BINDING,
  frame = FRAME
) {
  const port = repository.permissions(binding);
  await port.exclusive(async () => {
    await port.write(frame);
    port.publish(frame);
  });
  return port;
}

test('one protected record persists detached protocol values and peer-scoped grants across reopen', async () => {
  const f = await fixture();
  try {
    let repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    const secret = {
      keychain: { symmetricKey: 'test-only-session-secret' },
      list: [1, false, null],
    };
    await repository.transport.setItem('protocol-keychain', secret);
    secret.keychain.symmetricKey = 'caller-mutated';
    const port = await publish(repository);
    const other = { ...BINDING, peerPublicKey: 'd4'.repeat(32) };
    assert.equal(repository.permissions(other).read().dapps[ORIGIN], undefined);
    assert.throws(
      () =>
        repository.permissions({
          ...BINDING,
          origin: 'https://different.example',
        }),
      { code: 'INVALID_CONNECTION_STATE' }
    );
    const copy = await repository.transport.getItem<typeof secret>(
      'protocol-keychain'
    );
    assert.equal(copy?.keychain.symmetricKey, 'test-only-session-secret');
    copy!.keychain.symmetricKey = 'read-mutated';
    assert.equal(
      (await repository.transport.getEntries<typeof secret>())[0]?.[1].keychain
        .symmetricKey,
      'test-only-session-secret'
    );
    assert.equal(
      port.read().dapps[ORIGIN],
      GRANT,
      'unrelated transport updates preserve exact live grant identity'
    );
    assert.equal(
      JSON.stringify(repository.bindings()).includes('symmetricKey'),
      false
    );
    assert.deepEqual(await repository.transport.getKeys(), [
      'protocol-keychain',
    ]);
    await repository.dispose();
    await f.reopen();
    repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    assert.deepEqual(repository.permissions(BINDING).read(), FRAME);
    assert.deepEqual(await repository.transport.getItem('protocol-keychain'), {
      keychain: { symmetricKey: 'test-only-session-secret' },
      list: [1, false, null],
    });
    await repository.transport.removeItem('protocol-keychain');
    assert.deepEqual(await repository.transport.getKeys(), []);
    await assert.rejects(
      openNativeConnectionRepository({
        storage: f.storage.keyringStorage,
        walletBindingId: 'e5'.repeat(32),
        assertOwner: current,
      }),
      { code: 'INVALID_CONNECTION_STATE' }
    );
  } finally {
    await f.close();
  }
});

test('official pairing and shared-metadata session shapes follow SDK JSON storage semantics', async () => {
  const f = await fixture();
  try {
    const repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    const { pairing, sessions } = protocolFixtures();
    await repository.transport.setItem('wc@2:core:0.3//pairing', [pairing]);
    await repository.transport.setItem('wc@2:client:0.3//session', sessions);
    await repository.transport.setItem('array-optionals', [
      undefined,
      { optional: undefined },
    ]);
    assert.deepEqual(
      await repository.transport.getItem('wc@2:core:0.3//pairing'),
      JSON.parse(JSON.stringify([pairing]))
    );
    assert.deepEqual(
      await repository.transport.getItem('wc@2:client:0.3//session'),
      JSON.parse(JSON.stringify(sessions))
    );
    assert.deepEqual(await repository.transport.getItem('array-optionals'), [
      null,
      {},
    ]);
    repository.assertHealthy();
  } finally {
    await f.close();
  }
});

test('the connection-only capacity retains a full admitted request in the SDK duplicate stores', async () => {
  const f = await fixture();
  try {
    const repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    const request = {
      method: 'eth_sendTransaction',
      params: [
        {
          from: '0x' + '11'.repeat(20),
          to: '0x' + '22'.repeat(20),
          data: '0x' + 'a'.repeat(DAPP_REQUEST_LIMITS.bytes - 512),
        },
      ],
    };
    assertProviderRequestBudget(request);
    const payload = {
      id: 1,
      jsonrpc: '2.0',
      method: 'wc_sessionRequest',
      params: { chainId: 'eip155:1', request },
    };
    // AEAD framing plus Base64, without pretending these fixture bytes are ciphertext.
    const wire = 'A'.repeat(
      Math.ceil((JSON.stringify(payload).length + 64) / 3) * 4
    );
    const messages = { [BINDING.topic]: { ['f'.repeat(64)]: wire } };
    await repository.transport.setItem('messages', messages);
    await repository.transport.setItem('messages_withoutClientAck', messages);
    await repository.transport.setItem('history', [
      { id: 1, topic: BINDING.topic, request: payload, expiry: 1893456000 },
    ]);
    await repository.transport.setItem('pendingRequest', [
      {
        id: 1,
        topic: BINDING.topic,
        params: payload.params,
        verifyContext: {},
      },
    ]);
    assert.deepEqual(await repository.transport.getItem('pendingRequest'), [
      {
        id: 1,
        topic: BINDING.topic,
        params: payload.params,
        verifyContext: {},
      },
    ]);
    const snapshot = await f.storage.recovery.readSnapshot();
    const bytes = Buffer.byteLength(
      snapshot.records.find(({ key }) => key === NATIVE_CONNECTION_STORAGE_KEY)!
        .value
    );
    assert(
      bytes > 4 * 1024 * 1024 && bytes < CONNECTION_RECORD_LIMITS.valueBytes
    );
    const vault = await f.storage.keyringStorage.get('vault');
    await assert.rejects(async () =>
      f.storage.keyringStorage.set('vault', 'x'.repeat(65536))
    );
    assert.equal(await f.storage.keyringStorage.get('vault'), vault);
  } finally {
    await f.close();
  }
});

test('the shared Bitcoin default chain zero retains its UTXO permission across reopen', async () => {
  const f = await fixture();
  try {
    const network = getBitcoinMainnetNetwork();
    const grant: DappGrant = {
      ...GRANT,
      chain: network.kind,
      chainId: network.chainId,
      utxoAccount: { slip44: network.slip44, xpub: XPUB },
    };
    const repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    await publish(repository, BINDING, {
      dapps: { [ORIGIN]: grant },
      pendingOrigins: [],
    });
    await repository.dispose();
    const reopened = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    assert.deepEqual(reopened.permissions(BINDING).read().dapps[ORIGIN], grant);
    const port = reopened.permissions(BINDING);
    await assert.rejects(
      publish(reopened, BINDING, {
        dapps: { [ORIGIN]: { ...GRANT, chainId: network.chainId } },
        pendingOrigins: [],
      }),
      { code: 'INVALID_CONNECTION_STATE' }
    );
    assert.equal(port.read().dapps[ORIGIN]?.chain, network.kind);
  } finally {
    await f.close();
  }
});

test('shared permission staging and concurrent transport writes use one queue without lost updates or deadlock', async () => {
  const f = await fixture();
  try {
    const repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    const port = repository.permissions(BINDING);
    const entered = latch();
    const permission = port.exclusive(async () => {
      port.publish({ dapps: {}, pendingOrigins: [ORIGIN] });
      await port.write({ dapps: FRAME.dapps, pendingOrigins: [ORIGIN] });
      entered.enter();
      await entered.gate;
      port.publish(FRAME);
      await port.write(FRAME);
    });
    await entered.reached;
    let transportCompleted = false;
    const transport = repository.transport
      .setItem('client-session', { topic: BINDING.topic })
      .then(() => {
        transportCompleted = true;
      });
    await Promise.resolve();
    assert.equal(transportCompleted, false);
    entered.release();
    await Promise.all([permission, transport]);
    const stored = (await f.storage.keyringStorage.get(
      NATIVE_CONNECTION_STORAGE_KEY
    )) as { sessions: unknown[]; transport: unknown[] };
    assert.equal(stored.sessions.length, 1);
    assert.equal(stored.transport.length, 1);
    assert.equal(port.read().dapps[ORIGIN], GRANT);
    await assert.rejects(port.write(FRAME), {
      code: 'CONNECTION_STORAGE_UNAVAILABLE',
    });
    await port.exclusive(async () => {
      await port.write({ dapps: {}, pendingOrigins: [] });
      port.publish({ dapps: {}, pendingOrigins: [] });
    });
    assert.deepEqual(repository.bindings(), []);
    assert.deepEqual(await repository.transport.getKeys(), ['client-session']);
  } finally {
    await f.close();
  }
});

test('the actual shared session engine retains marker semantics through the native repository', async () => {
  const f = await fixture();
  try {
    const repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    const network = {
      kind: GRANT.chain,
      chainId: 1,
      slip44: 60,
      url: 'https://rpc.example',
      currency: 'ETH',
      label: 'Fixture',
    } as INetwork;
    const account = { address: '0x' + '11'.repeat(20), xpub: 'public-fixture' };
    const engine = createDappSessions({
      wallet: () => ({
        network,
        generation: 1,
        activeSlip44: 60,
        unlocked: true,
        isBitcoinBased: false,
      }),
      account: () => account,
      canPublishAccount: () => true,
      isAccountAvailable: () => true,
      permissions: repository.permissions(BINDING),
      resolveDelivery: async () => null,
      providerAvailability: async () => undefined,
      clearProviderCache() {},
      notifyConnection() {},
      now: () => 10,
      reportError() {},
    });
    await engine.connect(GRANT, { ...account, network });
    assert.equal(engine.getAccount(ORIGIN)?.address, account.address);
    await engine.revoke(ORIGIN, { allowAlreadyDisconnected: false });
    assert.equal(engine.isConnected(ORIGIN), false);
    assert.deepEqual(repository.bindings(), []);
  } finally {
    await f.close();
  }
});

test('a staged grant with lost acknowledgement stays denied after reopen and ordinary transport saves', async () => {
  const f = await fixture();
  try {
    const storage = f.storage.keyringStorage;
    const repository = await openNativeConnectionRepository({
      storage: {
        ...storage,
        async createManyIfAbsent(items, guard) {
          await storage.createManyIfAbsent(items, guard);
          throw new Error(
            'simulated acknowledgement lost after the committed write'
          );
        },
      },
      walletBindingId: WALLET,
      assertOwner: current,
    });
    const port = repository.permissions(BINDING);
    await assert.rejects(
      commitDappPermissionGrant(
        port,
        {
          grant: GRANT,
          previous: undefined,
          isCurrent: () => true,
          isSameWallet: () => true,
          restoredPrevious: () => undefined,
          isPreviousRetired: () => false,
        },
        () => undefined
      ),
      { code: 'CONNECTION_STORAGE_UNAVAILABLE' }
    );
    await repository.dispose();
    const reopened = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    assert.deepEqual(reopened.permissions(BINDING).read(), {
      dapps: {},
      pendingOrigins: [ORIGIN],
    });
    await reopened.transport.setItem('unrelated-sdk-setting', true);
    await reopened.dispose();
    const again = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    assert.deepEqual(again.permissions(BINDING).read(), {
      dapps: {},
      pendingOrigins: [ORIGIN],
    });
  } finally {
    await f.close();
  }
});

test('owner cancellation while SQL waits rolls back and leaves wallet and connection records intact', async () => {
  const f = await fixture();
  try {
    let active = true;
    const repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner() {
        if (!active) throw new Error('retired');
      },
    });
    await repository.transport.setItem('session', { value: 'before' });
    const vault = await f.storage.keyringStorage.get('vault');
    const writing = latch();
    f.setBefore(async (kind, sql) => {
      if (kind === 'run' && sql.startsWith('UPDATE keyring_records')) {
        writing.enter();
        await writing.gate;
      }
    });
    const update = repository.transport.setItem('session', { value: 'after' });
    const rejected = assert.rejects(update, {
      code: 'CONNECTION_STORAGE_UNAVAILABLE',
    });
    await writing.reached;
    active = false;
    writing.release();
    await rejected;
    f.setBefore();
    assert.equal(await f.storage.keyringStorage.get('vault'), vault);
    assert.throws(() => repository.bindings(), {
      code: 'CONNECTION_STORAGE_UNAVAILABLE',
    });
    const reopened = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    assert.deepEqual(await reopened.transport.getItem('session'), {
      value: 'before',
    });
  } finally {
    await f.close();
  }
});

test('account retirement publishes both records before a queued transport write and preserves other account grants', async () => {
  const f = await fixture();
  const repository = await openNativeConnectionRepository({
    storage: f.storage.keyringStorage,
    walletBindingId: WALLET,
    assertOwner: current,
  });
  try {
    const before = { revision: 1 },
      after = { revision: 2 };
    await f.storage.keyringStorage.set(ACCOUNT_RECORD_KEY, before);
    await publish(repository);
    const otherBinding = { ...BINDING, topic: 'd5'.repeat(32) };
    const otherGrant = { ...GRANT, accountId: 1 };
    await publish(repository, otherBinding, {
      dapps: { [ORIGIN]: otherGrant },
      pendingOrigins: [],
    });
    const committing = latch();
    const removal = repository.retireAccount(
      { accountId: 0, accountType: GRANT.accountType, slip44: 60 },
      async (commit) => {
        assert.equal(
          await commit(ACCOUNT_RECORD_KEY, before, after, current),
          true
        );
        assert.equal(
          repository.permissions(BINDING).read().dapps[ORIGIN],
          undefined
        );
        committing.enter();
        await committing.gate;
      },
      current
    );
    await committing.reached;
    let transportFinished = false;
    const transportWrite = repository.transport
      .setItem('protocol-keychain', { secret: 'retained-test-secret' })
      .then(() => {
        transportFinished = true;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(transportFinished, false);
    committing.release();
    await removal;
    await transportWrite;
    await repository.dispose();
    await f.reopen();
    const reopened = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    assert.deepEqual(
      await f.storage.keyringStorage.get(ACCOUNT_RECORD_KEY),
      after
    );
    assert.equal(reopened.permissions(BINDING).read().dapps[ORIGIN], undefined);
    assert.deepEqual(
      reopened.permissions(otherBinding).read().dapps[ORIGIN],
      otherGrant
    );
    assert.deepEqual(await reopened.transport.getItem('protocol-keychain'), {
      secret: 'retained-test-secret',
    });
    await reopened.dispose();
  } finally {
    await repository.dispose();
    await f.close();
  }
});

test('an escaped account-removal commit cannot write after its queue ownership ended', async () => {
  const f = await fixture();
  try {
    const repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    await f.storage.keyringStorage.set(ACCOUNT_RECORD_KEY, { revision: 1 });
    let escaped!: Parameters<Parameters<typeof repository.retireAccount>[1]>[0];
    await assert.rejects(
      repository.retireAccount(
        { accountId: 0, accountType: GRANT.accountType, slip44: 60 },
        async (commit) => {
          escaped = commit;
        },
        current
      )
    );
    await assert.rejects(
      escaped(ACCOUNT_RECORD_KEY, { revision: 1 }, { revision: 2 }, current)
    );
    assert.deepEqual(await f.storage.keyringStorage.get(ACCOUNT_RECORD_KEY), {
      revision: 1,
    });
    await repository.dispose();
  } finally {
    await f.close();
  }
});

test('an unrelated synchronous grant revocation cancels a held account-removal transaction', async () => {
  const f = await fixture();
  try {
    const repository = await openNativeConnectionRepository({
      storage: f.storage.keyringStorage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    await f.storage.keyringStorage.set(ACCOUNT_RECORD_KEY, { revision: 1 });
    await publish(repository);
    const otherBinding = { ...BINDING, topic: 'e6'.repeat(32) };
    const other = await publish(repository, otherBinding, {
      dapps: { [ORIGIN]: { ...GRANT, accountId: 1 } },
      pendingOrigins: [],
    });
    const writing = latch();
    f.setBefore(async (kind, sql) => {
      if (kind === 'run' && sql.startsWith('UPDATE keyring_records')) {
        writing.enter();
        await writing.gate;
      }
    });
    const removal = repository.retireAccount(
      { accountId: 0, accountType: GRANT.accountType, slip44: 60 },
      async (commit) => {
        assert.equal(
          await commit(
            ACCOUNT_RECORD_KEY,
            { revision: 1 },
            { revision: 2 },
            current
          ),
          true
        );
      },
      current
    );
    const rejected = assert.rejects(removal);
    await writing.reached;
    other.publish({ dapps: {}, pendingOrigins: [] });
    writing.release();
    await rejected;
    f.setBefore();
    assert.throws(() => repository.assertHealthy());
    assert.deepEqual(await f.storage.keyringStorage.get(ACCOUNT_RECORD_KEY), {
      revision: 1,
    });
    const persisted = (await f.storage.keyringStorage.get(
      NATIVE_CONNECTION_STORAGE_KEY
    )) as { sessions: { permissions: DappPermissionFrame }[] };
    assert.equal(
      persisted.sessions.length,
      2,
      'neither row was committed from the stale retirement snapshot'
    );
    await repository.dispose();
  } finally {
    await f.close();
  }
});

for (const failure of ['conflict', 'acknowledgement-loss'] as const) {
  test(`${failure} closes the connection repository without deleting other wallet records`, async () => {
    const rows = new Map<string, unknown>([
      ['vault', 'retained-wallet-record'],
    ]);
    const storage: KeyringStoragePort = {
      get: async (key) => structuredClone(rows.get(key)),
      set: async (key, value) => {
        rows.set(key, value);
      },
      deleteItem: async (key) => {
        rows.delete(key);
      },
      createManyIfAbsent: async (items, guard) => {
        guard?.();
        for (const [key, value] of Object.entries(items))
          rows.set(key, structuredClone(value));
        return true;
      },
      compareAndSet: async (key, _before, value, _remove, guard) => {
        guard?.();
        if (failure === 'conflict') return false;
        rows.set(key, structuredClone(value));
        throw new Error('private transport error must not escape');
      },
      compareAndSetMany: async () => {
        throw new Error(
          'Account retirement is outside this transport failure fixture'
        );
      },
    };
    const repository = await openNativeConnectionRepository({
      storage,
      walletBindingId: WALLET,
      assertOwner: current,
    });
    await repository.transport.setItem('session', 1);
    await assert.rejects(repository.transport.setItem('session', 2), {
      code: 'CONNECTION_STORAGE_UNAVAILABLE',
      message: 'CONNECTION_STORAGE_UNAVAILABLE',
    });
    await assert.rejects(async () => repository.transport.getKeys(), {
      code: 'CONNECTION_STORAGE_UNAVAILABLE',
    });
    assert.equal(rows.get('vault'), 'retained-wallet-record');
    assert.equal(rows.has(NATIVE_CONNECTION_STORAGE_KEY), true);
  });
}

for (const kind of ['getter', 'oversized', 'cycle', 'serializer']) {
  test(`a rejected protocol mutation latches failure before writes (${kind})`, async () => {
    const f = await fixture();
    try {
      const repository = await openNativeConnectionRepository({
        storage: f.storage.keyringStorage,
        walletBindingId: WALLET,
        assertOwner: current,
      });
      let getterCalls = 0;
      const cycle: { self?: unknown } = {};
      cycle.self = cycle;
      const value =
        kind === 'oversized'
          ? 'x'.repeat(CONNECTION_RECORD_LIMITS.valueBytes)
          : kind === 'cycle'
          ? cycle
          : kind === 'serializer'
          ? {
              toJSON() {
                getterCalls++;
                return {};
              },
            }
          : {
              get secret() {
                getterCalls++;
                return 'no';
              },
            };
      await assert.rejects(repository.transport.setItem('invalid', value), {
        code: 'CONNECTION_STORAGE_UNAVAILABLE',
      });
      assert.equal(getterCalls, 0);
      assert.equal(
        await f.storage.keyringStorage.get(NATIVE_CONNECTION_STORAGE_KEY),
        undefined
      );
      assert.throws(() => repository.assertHealthy(), {
        code: 'CONNECTION_STORAGE_UNAVAILABLE',
      });
      await assert.rejects(repository.transport.setItem('healthy', false), {
        code: 'CONNECTION_STORAGE_UNAVAILABLE',
      });
      const reopened = await openNativeConnectionRepository({
        storage: f.storage.keyringStorage,
        walletBindingId: WALLET,
        assertOwner: current,
      });
      await reopened.transport.setItem('healthy', false);
      assert.equal(await reopened.transport.getItem('healthy'), false);
    } finally {
      await f.close();
    }
  });
}
