import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openWalletConnectTransport,
  type WalletConnectSdk,
  type WalletConnectTransportEvent,
  type WalletConnectProposal,
  type WalletConnectRequest,
} from '../src/connections/walletConnect.ts';
import type { NativeConnectionRepository } from '../src/connections/storage.ts';

const TOPIC = 'a1'.repeat(32),
  PEER = 'b2'.repeat(32),
  PAIRING = 'c3'.repeat(32);
const metadata = {
  name: 'Pali',
  description: 'Wallet',
  url: 'https://paliwallet.com',
  icons: [],
};
const peerMetadata = {
  ...metadata,
  name: 'Example',
  url: 'https://reported.example/path',
};
const namespaces = {
  eip155: {
    accounts: ['eip155:1:0x' + '11'.repeat(20)],
    methods: ['personal_sign', 'eth_chainId'],
    events: ['accountsChanged', 'chainChanged'],
    chains: ['eip155:1'],
  },
};
const rawProposal = {
  id: 7,
  pairingTopic: PAIRING,
  proposer: { publicKey: PEER, metadata: peerMetadata },
  requiredNamespaces: {},
  optionalNamespaces: {},
};
const rawSession = {
  topic: TOPIC,
  peer: { publicKey: PEER, metadata: peerMetadata },
  expiry: Math.floor(Date.now() / 1000) + 3600,
  namespaces,
};

function deferred() {
  let release!: () => void;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  let healthy = true,
    owner = true;
  let nextBarrier: Promise<void> | undefined;
  let initialize: () => Promise<void> = async () => undefined;
  let beforeRespond: () => Promise<void> = async () => undefined;
  let beforeAck: () => Promise<void> = async () => undefined;
  let parseFailure: Error | undefined;
  const events: WalletConnectTransportEvent[] = [],
    calls: string[] = [];
  const responders: unknown[] = [];
  const sessions = new Map<string, unknown>([
    [TOPIC, structuredClone(rawSession)],
  ]);
  const proposals = new Map<number, unknown>([
    [7, structuredClone(rawProposal)],
  ]);
  const pending = new Map<number, unknown>();
  const listeners = new Map<string, (event: unknown) => void>();
  const repository = {
    assertHealthy() {
      if (!healthy) throw new Error('private storage error');
    },
    permissions() {
      throw new Error('permission logic must not live in transport');
    },
    bindings: () => [],
    retireAccount: async () => {
      throw new Error(
        'Account retirement does not belong to the transport adapter'
      );
    },
    dispose: async () => undefined,
    transport: {
      async getKeys() {
        const wait = nextBarrier;
        nextBarrier = undefined;
        if (wait) await wait;
        if (!healthy) throw new Error('private keychain failure');
        return [];
      },
      getEntries: async () => [],
      getItem: async () => undefined,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
  } satisfies NativeConnectionRepository;
  const core: ReturnType<WalletConnectSdk['createCore']> = {
    storage: repository.transport,
    pairing: {
      pairings: { getAll: () => [{ topic: PAIRING }] },
      async disconnect() {
        calls.push('pairing-disconnect');
      },
    },
    relayer: {
      async transportClose() {
        calls.push('transport-close');
      },
    },
    heartbeat: {
      stop() {
        calls.push('heartbeat-stop');
      },
    },
  };
  const client: Awaited<ReturnType<WalletConnectSdk['initialize']>> = {
    core,
    session: {
      get: (topic) => sessions.get(topic),
      getAll: () => [...sessions.values()],
    },
    proposal: {
      get: (id) => proposals.get(id),
      getAll: () => [...proposals.values()],
    },
    pendingRequest: { get: (id) => pending.get(id) },
    on(name, listener) {
      listeners.set(name, listener);
    },
    off(name) {
      calls.push('off:' + name);
      listeners.delete(name);
    },
    async emit() {
      calls.push('emit');
    },
    async pair() {
      calls.push('pair');
    },
    async approve() {
      calls.push('approve');
      return {
        topic: TOPIC,
        acknowledged: async () => {
          await beforeAck();
          return structuredClone(rawSession);
        },
      };
    },
    async reject() {
      calls.push('reject');
    },
    async respond(value) {
      calls.push('respond');
      responders.push(value);
      await beforeRespond();
    },
    async disconnect({ topic }) {
      calls.push('session-disconnect');
      sessions.delete(topic);
    },
  };
  const sdk: WalletConnectSdk = {
    createCore(options) {
      assert.equal(process.env.DISABLE_GLOBAL_CORE, 'true');
      assert.equal(options.storage, repository.transport);
      assert.equal(options.telemetryEnabled, false);
      assert.equal(options.logger, 'silent');
      calls.push('core');
      return core;
    },
    async initialize(options) {
      assert.equal(options.core, core);
      assert.equal(options.logger, 'silent');
      await initialize();
      calls.push('client');
      return client;
    },
    parseUri() {
      if (parseFailure) throw parseFailure;
      return {
        topic: PAIRING,
        symKey: 'd4'.repeat(32),
        version: 2,
        relay: { protocol: 'irn' },
      };
    },
  };
  const lifetime = new AbortController();
  const options = {
    signal: lifetime.signal,
    projectId: 'explicit-project-id',
    metadata,
    repository,
    supportedMethods: ['personal_sign', 'eth_chainId'],
    supportedEvents: ['accountsChanged', 'chainChanged'],
    async preparePlatform() {},
    assertOwner() {
      if (!owner) throw new Error('retired owner');
    },
    onEvent(event: WalletConnectTransportEvent) {
      events.push(event);
    },
    loadSdk: async () => sdk,
  };
  const request = (id = 1) => {
    const params = {
      chainId: 'eip155:1',
      request: {
        method: 'personal_sign',
        params: ['hello', '0x' + '11'.repeat(20)],
      },
    };
    pending.set(id, { id, topic: TOPIC, params });
    listeners.get('session_request')!({ id, topic: TOPIC, params });
  };
  return {
    options,
    abort: () => lifetime.abort(),
    events,
    calls,
    responders,
    client,
    core,
    sessions,
    proposals,
    request,
    setHealthy(value: boolean) {
      healthy = value;
    },
    setOwner(value: boolean) {
      owner = value;
    },
    setBarrier(value: Promise<void>) {
      nextBarrier = value;
    },
    setInitialize(value: () => Promise<void>) {
      initialize = value;
    },
    setBeforeRespond(value: () => Promise<void>) {
      beforeRespond = value;
    },
    setBeforeAck(value: () => Promise<void>) {
      beforeAck = value;
    },
    setParseFailure(value: Error | undefined) {
      parseFailure = value;
    },
    setPending(id: number, value: unknown) {
      pending.set(id, value);
    },
    emit: (name: string, event: unknown) => listeners.get(name)?.(event),
  };
}
async function proposal(
  f: ReturnType<typeof fixture>
): Promise<WalletConnectProposal> {
  f.emit('session_proposal', { id: 7, params: structuredClone(rawProposal) });
  await settle();
  const event = f.events.find((event) => event.type === 'proposal');
  assert(event?.type === 'proposal');
  return event.proposal;
}
async function request(
  f: ReturnType<typeof fixture>
): Promise<WalletConnectRequest> {
  f.request();
  await settle();
  const event = f.events.find((event) => event.type === 'request');
  assert(event?.type === 'request');
  return event.request;
}

test('direct official construction requires explicit protected storage and disables global reuse and logging', async () => {
  const f = fixture();
  const transport = await openWalletConnectTransport(f.options);
  assert.deepEqual(f.calls, ['core', 'client']);
  await transport.pair(
    'wc:' + PAIRING + '@2?relay-protocol=irn&symKey=' + 'd4'.repeat(32),
    () => undefined,
    () => undefined
  );
  assert.equal(f.calls.at(-1), 'pair');
  await transport.close();
  assert.equal(f.calls.includes('session-disconnect'), false);
  assert.equal(f.calls.includes('pairing-disconnect'), false);
  assert.equal(f.calls.at(-1), 'heartbeat-stop');
});

test('a chain-change payload uses an authorized session scope without granting its destination chain', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const session = (await transport.sessions())[0]!;
  const emitted: unknown[] = [];
  f.client.emit = async (value) => {
    emitted.push(value);
  };
  const event = { name: 'chainChanged', data: '0xa' };
  await transport.emit(session.binding, 'eip155:1', event, () => undefined);
  assert.deepEqual(emitted, [{ topic: TOPIC, chainId: 'eip155:1', event }]);
  await assert.rejects(
    transport.emit(session.binding, 'eip155:10', event, () => undefined),
    { message: 'CONNECTION_UNAVAILABLE' }
  );
  assert.equal(emitted.length, 1);
  assert.deepEqual((await transport.sessions())[0]!.namespaces, namespaces);
  await transport.close();
});

for (const stage of ['parse', 'SDK'] as const) {
  test(`a ${stage} pairing failure leaves the transport available for retry`, async () => {
    const f = fixture(),
      transport = await openWalletConnectTransport(f.options);
    const pair = f.client.pair;
    if (stage === 'parse') f.setParseFailure(new Error('invalid wc URI'));
    else
      f.client.pair = async () => {
        throw new Error('pairing rejected');
      };
    const uri =
      'wc:' + PAIRING + '@2?relay-protocol=irn&symKey=' + 'd4'.repeat(32);
    await assert.rejects(
      transport.pair(
        uri,
        () => undefined,
        () => undefined
      ),
      { message: 'CONNECTION_UNAVAILABLE' }
    );
    assert.equal(
      f.events.some((event) => event.type === 'unavailable'),
      false
    );
    f.setParseFailure(undefined);
    f.client.pair = pair;
    assert.equal(
      (
        await transport.pair(
          uri,
          () => undefined,
          () => undefined
        )
      ).topic,
      PAIRING
    );
    await transport.close();
  });
}

test('proposal approval binds the returned session to the authenticated peer and rejects unsupported methods', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const approved = await proposal(f);
  await assert.rejects(
    transport.approve(
      approved,
      { eip155: { ...namespaces.eip155, methods: ['eth_sign'] } },
      () => undefined
    )
  );
  assert.equal(f.calls.includes('approve'), false);
  await assert.rejects(
    transport.approve({ ...approved }, namespaces, () => undefined)
  );
  const session = await transport.approve(
    approved,
    namespaces,
    () => undefined
  );
  assert.equal(session.binding.peerPublicKey, PEER);
  assert.equal(session.binding.topic, TOPIC);
  assert.equal(session.binding.origin, 'https://reported.example');
  assert(Object.isFrozen(approved.requiredNamespaces));
  await transport.close();
});

test('another peer claiming the same metadata origin cannot respond to the session', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const pending = await request(f);
  await assert.rejects(
    transport.respond(
      { ...pending.session.binding, peerPublicKey: 'f6'.repeat(32) },
      pending.id,
      { result: 'signature' },
      () => undefined
    )
  );
  assert.equal(f.calls.includes('respond'), false);
  await transport.close();
});

test('a response requires its exact pending request and an explicit current approval guard', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const pending = await request(f);
  await assert.rejects(
    transport.respond(
      pending.session.binding,
      pending.id,
      { result: 'signature' },
      undefined as never
    )
  );
  await assert.rejects(
    transport.respond(
      pending.session.binding,
      pending.id,
      { result: 'signature' },
      () => {
        throw new Error('expired');
      }
    )
  );
  assert.equal(f.calls.includes('respond'), false);
  await transport.respond(
    pending.session.binding,
    pending.id,
    { result: 'signature' },
    () => undefined
  );
  assert.deepEqual(f.responders, [
    { topic: TOPIC, response: { id: 1, jsonrpc: '2.0', result: 'signature' } },
  ]);
  await assert.rejects(
    transport.respond(
      pending.session.binding,
      pending.id,
      { result: 'signature' },
      () => undefined
    )
  );
  await transport.close();
});

test('owner retirement during the storage barrier suppresses the request event', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const held = deferred();
  f.setBarrier(held.promise);
  f.request();
  await Promise.resolve();
  f.setOwner(false);
  held.release();
  await settle();
  assert.equal(
    f.events.some((event) => event.type === 'request'),
    false
  );
  assert(f.events.some((event) => event.type === 'unavailable'));
  await transport.close();
});

test('SDK initialization cannot conceal a failed protected write', async () => {
  const f = fixture();
  f.setInitialize(async () => {
    f.setHealthy(false);
  });
  await assert.rejects(openWalletConnectTransport(f.options), {
    message: 'CONNECTION_UNAVAILABLE',
  });
  assert.equal(f.calls.includes('transport-close'), true);
  assert.equal(f.calls.includes('heartbeat-stop'), true);
});

test('local closing suppresses queued callbacks and never waits for remote disconnect acknowledgements', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  f.client.disconnect = async () => {
    f.calls.push('session-disconnect');
    throw new Error('private failure');
  };
  const held = deferred();
  f.setBarrier(held.promise);
  f.request();
  await Promise.resolve();
  const closing = transport.close();
  held.release();
  await closing;
  await settle();
  assert.equal(
    f.events.some((event) => event.type === 'request'),
    false
  );
  assert.equal(f.calls.includes('pairing-disconnect'), false);
  assert.equal(f.calls.includes('transport-close'), true);
  assert.equal(f.calls.includes('heartbeat-stop'), true);
});

test('a valid request without params is delivered and can receive its bound response', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const params = { chainId: 'eip155:1', request: { method: 'eth_chainId' } };
  f.setPending(3, { id: 3, topic: TOPIC, params });
  f.emit('session_request', { id: 3, topic: TOPIC, params });
  await settle();
  const event = f.events.find((event) => event.type === 'request');
  assert(event?.type === 'request');
  assert.equal(event.request.params, undefined);
  await transport.respond(
    event.request.session.binding,
    3,
    { result: '0x1' },
    () => undefined
  );
  await transport.close();
});

test('approval cancellation while acknowledgement waits disconnects the unadmitted session', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const proposed = await proposal(f);
  await assert.rejects(
    transport.approve(proposed, namespaces, undefined as never)
  );
  assert.equal(f.calls.includes('approve'), false);
  let current = true;
  const held = deferred();
  f.setBeforeAck(() => held.promise);
  const approving = transport.approve(proposed, namespaces, () => {
    if (!current) throw new Error('cancelled');
  });
  await settle();
  current = false;
  held.release();
  await assert.rejects(approving, { message: 'CONNECTION_UNAVAILABLE' });
  assert(f.calls.includes('session-disconnect'));
  assert.equal(
    f.events.some((event) => event.type === 'unavailable'),
    false
  );
  await transport.close();
});

test('a malformed correlated peer request is rejected without closing healthy sessions', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const params = {
    chainId: 'eip155:1',
    request: { method: 'personal_sign', params: [() => 'malformed'] },
  };
  f.setPending(8, { id: 8, topic: TOPIC, params });
  f.emit('session_request', { id: 8, topic: TOPIC, params });
  await settle();
  assert.equal(
    f.events.some((event) => event.type === 'unavailable'),
    false
  );
  assert.equal(
    f.events.some((event) => event.type === 'request'),
    false
  );
  assert.deepEqual(f.responders, [
    {
      topic: TOPIC,
      response: {
        id: 8,
        jsonrpc: '2.0',
        error: { code: -32602, message: 'Invalid or unavailable request' },
      },
    },
  ]);
  assert.equal((await transport.sessions()).length, 1);
  await transport.close();
});

test('per-peer pending requests remain bounded while another peer can still submit', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  for (let id = 1; id <= 5; id++) f.request(id);
  await settle();
  assert.equal(f.events.filter((event) => event.type === 'request').length, 4);
  assert.equal(f.responders.length, 1);
  const otherTopic = 'd4'.repeat(32);
  f.sessions.set(otherTopic, {
    ...rawSession,
    topic: otherTopic,
    peer: { ...rawSession.peer, publicKey: 'e5'.repeat(32) },
  });
  const params = { chainId: 'eip155:1', request: { method: 'eth_chainId' } };
  f.setPending(10, { id: 10, topic: otherTopic, params });
  f.emit('session_request', { id: 10, topic: otherTopic, params });
  await settle();
  assert.equal(f.events.filter((event) => event.type === 'request').length, 5);
  assert.equal(
    f.events.some((event) => event.type === 'unavailable'),
    false
  );
  await transport.close();
});

test('a fatal storage failure automatically retires listeners and network resources', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  f.setHealthy(false);
  f.request();
  await settle();
  await settle();
  assert(f.events.some((event) => event.type === 'unavailable'));
  assert(f.calls.includes('transport-close'));
  assert(f.calls.includes('heartbeat-stop'));
  assert.equal(
    f.events.some((event) => event.type === 'request'),
    false
  );
  await assert.rejects(transport.close(), {
    message: 'CONNECTION_UNAVAILABLE',
  });
});

test('owner retirement releases local initialization without waiting for a pending SDK startup', async () => {
  const f = fixture(),
    held = deferred();
  f.setInitialize(async () => {
    await held.promise;
    f.calls.push('late-heartbeat-start');
  });
  const opening = openWalletConnectTransport(f.options);
  await settle();
  f.abort();
  await assert.rejects(opening, { message: 'CONNECTION_UNAVAILABLE' });
  assert(f.calls.includes('transport-close'));
  assert(f.calls.includes('heartbeat-stop'));
  held.release();
  await settle();
  assert(
    f.calls.lastIndexOf('transport-close') >
      f.calls.indexOf('late-heartbeat-start')
  );
  assert(
    f.calls.lastIndexOf('heartbeat-stop') >
      f.calls.indexOf('late-heartbeat-start')
  );
  assert.deepEqual(f.events, []);
});

test('pair cancellation exposes its scoped handle before a delayed SDK completion', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options),
    held = deferred();
  f.client.pair = async () => {
    await held.promise;
  };
  let current = true;
  let cancel: (() => Promise<void>) | undefined;
  const pairing = transport.pair(
    'wc:' + PAIRING + '@2?relay-protocol=irn&symKey=' + 'd4'.repeat(32),
    () => {
      if (!current) throw new Error('cancelled');
    },
    (handle) => {
      cancel = handle.cancel;
    }
  );
  await settle();
  assert(cancel);
  current = false;
  await cancel();
  held.release();
  await assert.rejects(pairing, { message: 'CONNECTION_UNAVAILABLE' });
  assert.equal(f.calls.includes('session-disconnect'), false);
  assert.equal(f.calls.includes('pairing-disconnect'), true);
  await transport.close();
});
