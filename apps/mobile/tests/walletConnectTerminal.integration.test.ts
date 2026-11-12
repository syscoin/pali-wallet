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

test('actual SDK account update requires its encrypted peer ACK and retains the original request wire', { timeout: 5000 }, async (t) => {
  const f = await fixture(false, true);
  t.signal.addEventListener('abort', () => f.owner.abort(), { once: true });
  f.options.supportedMethods.push('wallet_prepareSmartAccount');
  const transport = await openWalletConnectTransport(f.options);
  try {
    const client = f.client!, current = client.session.get(f.topic);
    const negotiated = {
      eip155: { ...current.namespaces.eip155!,
        accounts: [...current.namespaces.eip155!.accounts, 'eip155:137:0x' + '33'.repeat(20)],
        methods: [...current.namespaces.eip155!.methods, 'wallet_prepareSmartAccount'],
        chains: ['eip155:1', 'eip155:137'],
      },
    };
    await client.session.update(f.topic, { namespaces: negotiated, controller: current.self.publicKey });
    f.core.relayer.confirmOnlineStateOrThrow = async () => {};
    await f.core.crypto.setSymKey('e5'.repeat(32), f.topic);
    const engine = client.engine as unknown as { onRelayMessage(event: { topic: string; message: string; transportType: 'relay' }): Promise<void> };
    let peerAcks = 0;
    let ackFailure: unknown;
    const published: unknown[] = [];
    f.core.relayer.publish = async (topic, message) => {
      const payload = await f.core.crypto.decode(topic, message);
      published.push(payload);
      if (payload && 'method' in payload && payload.method === 'wc_sessionUpdate') {
        const response = await f.core.crypto.encode(topic, { id: payload.id, jsonrpc: '2.0', result: true });
        // A relay receives the ACK after publish returns. Awaiting receive
        // inside publish would deadlock the SDK's own mutation queue.
        setImmediate(() => {
          peerAcks++;
          void engine.onRelayMessage({ topic, message: response, transportType: 'relay' }).catch(error => {
            ackFailure = error; f.owner.abort();
          });
        });
      }
    };
    const id = 54, params = { chainId: 'eip155:1', request: {
      method: 'wallet_prepareSmartAccount', params: [{ authenticator: { id: 'ecdsa' } }], expiryTimestamp: Math.floor(Date.now() / 1000) + 300,
    } };
    await f.core.history.set(f.topic, { id, jsonrpc: '2.0', method: 'wc_sessionRequest', params });
    const historical = await f.core.history.get(f.topic, id);
    const request = { id, topic: f.topic, params, verifyContext: { verified: {
      validation: 'UNKNOWN' as const, origin: 'https://example.com', verifyUrl: 'https://verify.walletconnect.com',
    } } };
    await client.pendingRequest.set(id, request);
    client.events.emit('session_request', request);
    await new Promise<void>(resolve => setImmediate(resolve));
    const event = f.events.find(event => event.type === 'request' && event.request.id === id);
    assert(event?.type === 'request'); const wire = event.request;
    let committed = 0;
    const address = '0x' + '22'.repeat(20);
    const session = await transport.updateSessionAccount(wire.session.binding, id, address, new AbortController().signal, () => {}, () => { committed++; assert.equal(peerAcks, 1); });
    assert.deepEqual(session.namespaces, { eip155: { ...negotiated.eip155, accounts: [`eip155:1:${address}`, 'eip155:137:0x' + '33'.repeat(20)] } });
    assert.equal(committed, 1);
    assert.equal(ackFailure, undefined);
    assert.equal(await transport.pending(wire.session.binding, id, () => {}), wire);
    assert.equal(await f.core.history.get(f.topic, id), historical);
    assert.equal(wire.freshness, 'fresh');
    assert.deepEqual(wire.session.namespaces, negotiated);
    await transport.respond(wire.session.binding, id, { result: { address, chainId: '0x1' } }, () => {}, () => {});
    assert.equal(published.length, 2);
  } finally { await transport.close(); }
});

async function encryptedRequests() {
  const f = await fixture(false, true), transport = await openWalletConnectTransport(f.options);
  const published: unknown[] = [];
  // Only network boundaries are replaced. Receive, decrypt, history, validation,
  // pending storage, sendError and response serialization use the installed SDK.
  f.core.verify.resolve = async () => ({ origin: 'https://example.com' });
  f.core.relayer.confirmOnlineStateOrThrow = async () => {};
  f.core.relayer.publish = async (topic, message) => {
    published.push(await f.core.crypto.decode(topic, message));
  };
  await f.core.crypto.setSymKey('e5'.repeat(32), f.topic);
  const receive = async (id: number, chainId = 'eip155:1') => {
    const params = { chainId, request: { method: 'personal_sign', params: ['fresh'], expiryTimestamp: Math.floor(Date.now() / 1000) + 300 } };
    const message = await f.core.crypto.encode(f.topic, { id, jsonrpc: '2.0', method: 'wc_sessionRequest', params });
    // Exercise the actual encrypted receive entry without connecting a relay.
    const engine = f.client!.engine as unknown as { onRelayMessage(event: { topic: string; message: string; transportType: 'relay' }): Promise<void> };
    await engine.onRelayMessage({ topic: f.topic, message, transportType: 'relay' });
    await new Promise<void>(resolve => setImmediate(resolve));
  };
  return { ...f, transport, published, receive };
}

for (const operation of ['pending', 'respond'] as const) test(`actual SDK answered duplicate cannot authorize ${operation} from its surviving pending row`, async () => {
  const f = await encryptedRequests();
  try {
    await f.receive(81);
    const event = f.events.find(value => value.type === 'request' && value.request.id === 81);
    assert(event?.type === 'request'); const wire = event.request;
    assert.equal(wire.freshness, 'fresh');
    assert.equal(await f.transport.pending(wire.session.binding, 81, () => {}), wire);
    const original = f.client!.pendingRequest.get(81);
    await f.receive(81, 'eip155:999');
    assert.deepEqual(f.client!.pendingRequest.get(81), original);
    const answered = await f.core.history.get(f.topic, 81);
    assert(answered.response && 'error' in answered.response);
    assert.equal(f.published.length, 1);
    let dispatched = 0;
    if (operation === 'pending') assert.equal(await f.transport.pending(wire.session.binding, 81, () => {}), null);
    await assert.rejects(f.transport.respond(wire.session.binding, 81, { result: 'must not escape' }, () => {}, () => { dispatched++; }));
    assert.equal(dispatched, 0); assert.equal(f.published.length, 1);
    assert.deepEqual(await f.core.history.get(f.topic, 81), answered);
  } finally { await f.transport.close(); }
});

test('actual SDK fresh encrypted request still permits one response and no repeat', async () => {
  const f = await encryptedRequests();
  try {
    await f.receive(82);
    const event = f.events.find(value => value.type === 'request' && value.request.id === 82);
    assert(event?.type === 'request'); const wire = event.request;
    let dispatched = 0;
    await f.transport.respond(wire.session.binding, 82, { result: 'approved' }, () => {}, () => { dispatched++; });
    assert.deepEqual(f.published, [{ id: 82, jsonrpc: '2.0', result: 'approved' }]);
    assert.equal(dispatched, 1);
    assert.equal(await f.transport.pending(wire.session.binding, 82, () => {}), null);
    await assert.rejects(f.transport.respond(wire.session.binding, 82, { result: 'repeat' }, () => {}, () => { dispatched++; }));
    assert.equal(dispatched, 1); assert.equal(f.published.length, 1);
  } finally { await f.transport.close(); }
});

for (const [operation, boundary] of [['pending', 'final-storage'], ['pending', 'history-lookup'], ['respond', 'history-lookup']] as const)
test(`actual SDK terminalization during ${boundary} cannot authorize ${operation}`, async () => {
  const f = await encryptedRequests(), entered = deferred(), held = deferred();
  try {
    await f.receive(83);
    const event = f.events.find(value => value.type === 'request' && value.request.id === 83);
    assert(event?.type === 'request'); const wire = event.request;
    if (boundary === 'final-storage') {
      const getKeys = f.options.repository.transport.getKeys;
      let reads = 0;
      f.options.repository.transport.getKeys = async () => {
        if (++reads === 2) { entered.resolve(); await held.promise; }
        return getKeys();
      };
    } else {
      const get = f.core.history.get;
      let reads = 0;
      f.core.history.get = async (topic, id) => {
        const value = await get(topic, id);
        if (++reads === 1) { entered.resolve(); await held.promise; }
        return value;
      };
    }
    let dispatched = false;
    const result = operation === 'pending'
      ? f.transport.pending(wire.session.binding, 83, () => {})
      : assert.rejects(f.transport.respond(wire.session.binding, 83, { result: 'must not escape' }, () => {}, () => { dispatched = true; }));
    await entered.promise;
    await f.receive(83, 'eip155:999');
    held.resolve();
    if (operation === 'pending') assert.equal(await result, null);
    else await result;
    assert.equal(dispatched, false);
    assert.equal(f.published.length, 1);
  } finally { held.resolve(); await f.transport.close(); }
});

for (const operation of ['pending', 'respond'] as const) test(`actual SDK replaced history object cannot authorize ${operation} from an older lookup`, async () => {
  const f = await encryptedRequests(), entered = deferred(), held = deferred();
  try {
    await f.receive(84);
    const event = f.events.find(value => value.type === 'request' && value.request.id === 84);
    assert(event?.type === 'request'); const wire = event.request;
    const original = await f.core.history.get(f.topic, 84), get = f.core.history.get;
    let reads = 0, dispatched = false;
    f.core.history.get = async (topic, id) => {
      const value = await get(topic, id);
      if (++reads === 1) { entered.resolve(); await held.promise; }
      return value;
    };
    const result = operation === 'pending'
      ? f.transport.pending(wire.session.binding, 84, () => {})
      : assert.rejects(f.transport.respond(wire.session.binding, 84, { result: 'must not escape' }, () => {}, () => { dispatched = true; }));
    await entered.promise;
    await f.core.history.delete(f.topic, 84);
    await f.core.history.set(f.topic, { id: 84, jsonrpc: '2.0', method: original.request.method, params: original.request.params });
    assert.notEqual(f.core.history.records.get(84), original);
    if (operation === 'pending') { held.resolve(); assert.equal(await result, null); }
    else { held.resolve(); await result; }
    assert.equal(dispatched, false); assert.deepEqual(f.published, []);
    assert.equal(f.client!.pendingRequest.get(84).id, 84);
  } finally { held.resolve(); await f.transport.close(); }
});
