import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openWalletConnectTransport,
  type WalletConnectSdk,
  type WalletConnectTransportEvent,
} from '../src/connections/walletConnect.ts';
import type { NativeConnectionRepository } from '../src/connections/storage.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(holdKeychain = false, initializeSession = false) {
  const [
    { Core },
    { SignClient, SESSION_REQUEST_EXPIRY_BOUNDARIES },
    { parseUri },
  ] = await Promise.all([
    import('@walletconnect/core'),
    import('@walletconnect/sign-client'),
    import('@walletconnect/utils'),
  ]);
  const values = new Map<string, unknown>();
  const events: WalletConnectTransportEvent[] = [];
  const topic = 'a1'.repeat(32), peer = 'b2'.repeat(32), pairing = 'c3'.repeat(32);
  const readStarted = deferred(),
    held = deferred();
  let core: InstanceType<typeof Core> | undefined;
  let client: InstanceType<typeof SignClient> | undefined;
  let reads = 0,
    writes = 0;
  const repository = {
    assertHealthy() {},
    permissions() {
      throw Error('Unused permission path');
    },
    bindings: () => [],
    async reconcileSessions() {
      throw Error('Unused session reconciliation');
    },
    async retireAccount() {
      throw Error('Unused account removal');
    },
    async dispose() {},
    transport: {
      async getKeys() {
        return [...values.keys()];
      },
      async getEntries<T>() {
        return [...values.entries()] as [string, T][];
      },
      async getItem<T>(key: string) {
        reads++;
        if (holdKeychain && key.endsWith('//keychain')) {
          readStarted.resolve();
          await held.promise;
        }
        return values.get(key) as T | undefined;
      },
      async setItem<T>(key: string, value: T) {
        values.set(key, value);
        writes++;
      },
      async removeItem(key: string) {
        values.delete(key);
        writes++;
      },
    },
  } satisfies Omit<NativeConnectionRepository, 'calls'>;
  const sdk: WalletConnectSdk = {
    requestExpirySeconds: SESSION_REQUEST_EXPIRY_BOUNDARIES,
    parseUri,
    createCore(options) {
      core = new Core(options);
      return core;
    },
    async initialize(options) {
      client = await SignClient.init({
        ...options,
        core: core!,
        metadata: { ...options.metadata, icons: [...options.metadata.icons] },
      });
      if (initializeSession) {
        await client.session.set(topic, {
          topic, pairingTopic: pairing, relay: { protocol: 'irn' }, expiry: Math.floor(Date.now() / 1000) + 3600,
          acknowledged: true, controller: peer, requiredNamespaces: {}, optionalNamespaces: {},
          namespaces: { eip155: { accounts: ['eip155:1:0x' + '11'.repeat(20)], methods: ['personal_sign'], events: [] } },
          self: { publicKey: 'd4'.repeat(32), metadata: { name: 'Pali', description: '', url: 'https://paliwallet.com', icons: [] } },
          peer: { publicKey: peer, metadata: { name: 'Dapp', description: '', url: 'https://example.com', icons: [] } },
        });
        await core!.history.set(topic, { id: 17, jsonrpc: '2.0', method: 'wc_sessionRequest', params: {
          chainId: 'eip155:1', request: { method: 'personal_sign', params: ['cached'], expiryTimestamp: Math.floor(Date.now() / 1000) + 300 },
        } });
      }
      return client;
    },
  };
  const owner = new AbortController();
  const options = {
    projectId: '00000000000000000000000000000000',
    metadata: {
      name: 'Pali offline lifecycle test',
      description: '',
      url: 'https://paliwallet.com',
      icons: [],
    },
    repository,
    supportedMethods: ['personal_sign'],
    supportedEvents: ['accountsChanged'],
    signal: owner.signal,
    assertOwner() {
      if (owner.signal.aborted) throw Error('Retired');
    },
    async preparePlatform() {},
    onEvent(event: WalletConnectTransportEvent) { events.push(event); },
    loadSdk: async () => sdk,
  };
  return {
    options,
    events,
    topic,
    owner,
    held,
    readStarted,
    get core() {
      return core!;
    },
    get client() {
      return client;
    },
    get reads() {
      return reads;
    },
    get writes() {
      return writes;
    },
  };
}

test('actual reviewed Core and SignClient close through the production transport adapter', async () => {
  const f = await fixture();
  const transport = await openWalletConnectTransport(f.options);
  assert.deepEqual(await transport.sessions(), []);
  await transport.close();
  assert.equal(f.core.signal.aborted, true);
  assert.equal(f.client!.signal.aborted, true);
  assert.deepEqual(f.core.heartbeat.events.eventNames(), []);
  assert.deepEqual(f.core.relayer.events.eventNames(), []);
  const writes = f.writes;
  await assert.rejects(transport.sessions());
  await assert.rejects(f.core.start(), /disposed/);
  assert.equal(f.writes, writes);
});

test('actual SDK initialization retirement drains the admitted keychain read', async () => {
  const f = await fixture(true);
  let finished = false;
  const opening = openWalletConnectTransport(f.options);
  const refused = assert
    .rejects(opening, { message: 'CONNECTION_UNAVAILABLE' })
    .then(() => {
      finished = true;
    });
  await f.readStarted.promise;
  f.owner.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.core.signal.aborted, true);
  assert.equal(finished, false);
  f.held.resolve();
  await refused;
  assert.equal(f.client, undefined);
  assert.deepEqual(f.core.heartbeat.events.eventNames(), []);
  assert.deepEqual(f.core.relayer.events.eventNames(), []);
});

test('actual SDK public history proves fresh original-expiry requests and fences delayed/cross-protocol replay', async () => {
  const f = await fixture(false, true), transport = await openWalletConnectTransport(f.options);
  try {
    assert.deepEqual(f.client!.getPendingSessionRequests(), []);
    const emit = async (id: number, params: { chainId: string; request: { method: string; params: string[]; expiryTimestamp: number } }) => {
      const request = { id, topic: f.topic, params, verifyContext: { verified: {
        validation: 'UNKNOWN' as const, origin: 'https://example.com', verifyUrl: 'https://verify.walletconnect.com',
      } } };
      await f.client!.pendingRequest.set(id, request);
      f.client!.events.emit('session_request', request);
      await new Promise<void>(resolve => setImmediate(resolve));
      const event = f.events.find(value => value.type === 'request' && value.request.id === id);
      assert(event?.type === 'request'); return event.request;
    };
    const cached = await f.core.history.get(f.topic, 17);
    const original = cached.request.params as { chainId: string; request: { method: string; params: string[]; expiryTimestamp: number } };
    assert.equal((await emit(17, original)).freshness, 'unproven');
    const fresh = { ...original, request: { ...original.request, params: ['fresh'] } };
    await f.core.history.set(f.topic, { id: 18, jsonrpc: '2.0', method: 'wc_sessionRequest', params: fresh });
    const wire = await emit(18, fresh);
    assert.equal(wire.freshness, 'fresh'); assert.equal(wire.expiresAt, fresh.request.expiryTimestamp * 1000);
    assert.equal(await transport.pending(wire.session.binding, 18, () => {}), wire);
    await f.core.history.set(f.topic, { id: 19, jsonrpc: '2.0', method: 'wc_sessionPing', params: {} });
    await f.core.history.set(f.topic, { id: 19, jsonrpc: '2.0', method: 'wc_sessionRequest', params: fresh });
    assert.equal((await f.core.history.get(f.topic, 19)).request.method, 'wc_sessionPing');
    assert.equal((await emit(19, fresh)).freshness, 'unproven');
  } finally { await transport.close(); }
});
