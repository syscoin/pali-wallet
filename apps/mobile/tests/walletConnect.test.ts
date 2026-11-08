import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openWalletConnectTransport,
  isWalletConnectCleanupFailure,
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
const verification = (overrides: Record<string, unknown> = {}) => ({
  verified: {
    validation: 'VALID',
    origin: 'https://reported.example',
    verifyUrl: 'https://verify.walletconnect.com',
    ...overrides,
  },
});

function fixture() {
  let healthy = true,
    owner = true;
  let nextBarrier: Promise<void> | undefined;
  let initialize: () => Promise<void> = async () => undefined;
  let beforeRespond: () => Promise<void> = async () => undefined;
  let beforeAck: () => Promise<void> = async () => undefined;
  let beforeStorageWrite: () => Promise<void> = async () => undefined;
  let storageTail = Promise.resolve();
  let parseFailure: Error | undefined;
  const events: WalletConnectTransportEvent[] = [],
    calls: string[] = [];
  const responders: unknown[] = [];
  const protocolValues = new Map<string, unknown>();
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
    reconcileSessions: async () => undefined,
    retireAccount: async () => {
      throw new Error(
        'Account retirement does not belong to the transport adapter'
      );
    },
    dispose: async () => undefined,
    transport: {
      async getKeys() {
        await storageTail;
        const wait = nextBarrier;
        nextBarrier = undefined;
        if (wait) await wait;
        if (!healthy) throw new Error('private keychain failure');
        return [];
      },
      getEntries: async () => [],
      getItem: async <T>(key: string) =>
        protocolValues.get(key) as T | undefined,
      setItem: (key: string, value: unknown) => {
        const task = storageTail.then(async () => {
          await beforeStorageWrite();
          protocolValues.set(key, value);
        });
        storageTail = task.catch(() => undefined);
        return task;
      },
      removeItem: async (key: string) => {
        protocolValues.delete(key);
      },
    },
  } satisfies Omit<NativeConnectionRepository, 'calls'>;
  const core: ReturnType<WalletConnectSdk['createCore']> = {
    storage: repository.transport,
    pairing: {
      pairings: { getAll: () => [{ topic: PAIRING }] },
      async disconnect() {
        calls.push('pairing-disconnect');
      },
    },
    async dispose() {
      calls.push('core-dispose');
    },
  };
  const client: Awaited<ReturnType<WalletConnectSdk['initialize']>> = {
    core,
    async dispose() {
      calls.push('client-dispose');
    },
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
    requestExpirySeconds: { min: 300, max: 604800 },
    createCore(options) {
      assert.equal(process.env.DISABLE_GLOBAL_CORE, 'true');
      assert.notEqual(options.storage, repository.transport);
      core.storage = options.storage;
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
    protocolValues,
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
    setBeforeStorageWrite(value: () => Promise<void>) {
      beforeStorageWrite = value;
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

for (const [label, input, validation, isScam] of [
  ['missing', undefined, 'UNKNOWN', false],
  ['malformed', { verified: [] }, 'UNKNOWN', false],
  ['matching', verification(), 'VALID', false],
  [
    'different origin',
    verification({ origin: 'https://another.example' }),
    'INVALID',
    false,
  ],
  ['malformed origin', verification({ origin: 7 }), 'UNKNOWN', false],
  ['malformed verifier', verification({ verifyUrl: false }), 'UNKNOWN', false],
  [
    'explicit invalid',
    { verified: { validation: 'INVALID' } },
    'INVALID',
    false,
  ],
  [
    'scam with malformed auxiliary fields',
    { verified: { validation: 'VALID', isScam: true } },
    'UNKNOWN',
    true,
  ],
] as const) {
  test(`proposal verification remains scoped and preserves negative evidence (${label})`, async () => {
    const f = fixture(),
      transport = await openWalletConnectTransport(f.options);
    try {
      f.emit('session_proposal', {
        id: 7,
        params: structuredClone(rawProposal),
        verifyContext: input,
      });
      await settle();
      const event = f.events.find((entry) => entry.type === 'proposal');
      assert(event?.type === 'proposal');
      assert.deepEqual(event.proposal.verification, { validation, isScam });
      assert.equal(Object.isFrozen(event.proposal.verification), true);
      assert.equal(event.proposal.metadata.url, peerMetadata.url);
    } finally {
      await transport.close();
    }
  });
}

test('request verification is per-event and cannot inherit a valid proposal verdict', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  try {
    f.emit('session_proposal', {
      id: 7,
      params: structuredClone(rawProposal),
      verifyContext: verification(),
    });
    await settle();
    const pending = await request(f);
    assert.deepEqual(pending.verification, {
      validation: 'UNKNOWN',
      isScam: false,
    });
    assert.equal(Object.isFrozen(pending.verification), true);
    const params = { chainId: 'eip155:1', request: { method: 'eth_chainId' } };
    f.setPending(2, {
      id: 2,
      topic: TOPIC,
      params,
      verifyContext: verification(),
    });
    f.emit('session_request', {
      id: 2,
      topic: TOPIC,
      params,
      verifyContext: verification(),
    });
    await settle();
    const event = f.events.find(
      (entry) => entry.type === 'request' && entry.request.id === 2
    );
    assert(event?.type === 'request');
    assert.deepEqual(event.request.verification, {
      validation: 'VALID',
      isScam: false,
    });
    f.setPending(2, {
      id: 2,
      topic: TOPIC,
      params,
      verifyContext: verification({ validation: 'INVALID' }),
    });
    await assert.rejects(
      transport.respond(
        event.request.session.binding,
        2,
        { result: '0x1' },
        () => undefined,
        () => undefined
      )
    );
    assert.equal(f.responders.length, 0);
  } finally {
    await transport.close();
  }
});

test('request deadlines use the protocol default and are capped by the actual session expiry', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  try {
    const before = Date.now();
    const defaultRequest = await request(f);
    assert(defaultRequest.expiresAt >= before + 299000);
    assert(defaultRequest.expiresAt <= Date.now() + 300000);
    const sessionExpiry = Math.floor(Date.now() / 1000) + 30;
    f.sessions.set(TOPIC, { ...rawSession, expiry: sessionExpiry });
    const params = {
      chainId: 'eip155:1',
      request: { method: 'eth_chainId', expiryTimestamp: sessionExpiry + 60 },
    };
    f.setPending(2, { id: 2, topic: TOPIC, params });
    f.emit('session_request', { id: 2, topic: TOPIC, params });
    await settle();
    const event = f.events.find(
      (value) => value.type === 'request' && value.request.id === 2
    );
    assert(event?.type === 'request');
    assert.equal(event.request.expiresAt, sessionExpiry * 1000);
  } finally {
    await transport.close();
  }
});

for (const expiryTimestamp of [-1, Number.MAX_SAFE_INTEGER, '300', null]) {
  test(`an invalid protocol request expiry is rejected without publishing approval data (${expiryTimestamp})`, async () => {
    const f = fixture(),
      transport = await openWalletConnectTransport(f.options);
    try {
      const params = {
        chainId: 'eip155:1',
        request: { method: 'eth_chainId', expiryTimestamp },
      };
      f.setPending(1, { id: 1, topic: TOPIC, params });
      f.emit('session_request', { id: 1, topic: TOPIC, params });
      await settle();
      assert.equal(
        f.events.some((value) => value.type === 'request'),
        false
      );
      assert.equal(f.responders.length, 1);
    } finally {
      await transport.close();
    }
  });
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
  assert(f.calls.includes('core-dispose'));
  assert(f.calls.includes('client-dispose'));
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

test('the retained SDK storage wrapper rejects new writes after local close', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const retainedStorage = f.core.storage;
  await retainedStorage.setItem('before-close', { kept: true });
  assert.deepEqual(f.protocolValues.get('before-close'), { kept: true });
  await transport.close();
  await assert.rejects(
    retainedStorage.setItem('after-close', { forbidden: true })
  );
  await assert.rejects(retainedStorage.removeItem('before-close'));
  await assert.rejects(retainedStorage.getItem('before-close'));
  assert.equal(f.protocolValues.has('after-close'), false);
  assert.deepEqual(f.protocolValues.get('before-close'), { kept: true });
});

test('local close drains already-admitted protocol writes before a following snapshot', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const held = deferred();
  f.setBeforeStorageWrite(() => held.promise);
  const write = f.core.storage.setItem('admitted-before-close', true);
  const rejectedWrite = assert.rejects(write);
  let closed = false;
  const closing = transport.close().then(() => {
    closed = true;
  });
  await settle();
  assert.equal(closed, false);
  await assert.rejects(f.core.storage.setItem('after-close', true));
  held.release();
  await Promise.all([closing, rejectedWrite]);
  assert.equal(f.protocolValues.get('admitted-before-close'), true);
  assert.equal(f.protocolValues.has('after-close'), false);
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
      () => undefined,
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
      undefined as never,
      () => undefined
    )
  );
  await assert.rejects(
    transport.respond(
      pending.session.binding,
      pending.id,
      { result: 'signature' },
      () => {
        throw new Error('expired');
      },
      () => undefined
    )
  );
  assert.equal(f.calls.includes('respond'), false);
  await transport.respond(
    pending.session.binding,
    pending.id,
    { result: 'signature' },
    () => undefined,
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
      () => undefined,
      () => undefined
    )
  );
  await transport.close();
});

test('cancellation before the response handoff publishes neither a dispatch marker nor a signature', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const pending = await request(f),
    held = deferred();
  let current = true,
    dispatched = false;
  f.setBarrier(held.promise);
  const response = transport.respond(
    pending.session.binding,
    pending.id,
    { result: 'signature' },
    () => {
      if (!current) throw new Error('cancelled');
    },
    () => {
      dispatched = true;
    }
  );
  const rejected = assert.rejects(response);
  await Promise.resolve();
  current = false;
  held.release();
  await rejected;
  assert.equal(dispatched, false);
  assert.deepEqual(f.responders, []);
  await transport.close();
});

test('cancellation after the SDK handoff preserves successful delivery and cannot send a competing rejection', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const pending = await request(f),
    held = deferred();
  let current = true,
    dispatched = 0;
  f.setBeforeRespond(() => held.promise);
  const response = transport.respond(
    pending.session.binding,
    pending.id,
    { result: 'signature' },
    () => {
      if (!current) throw new Error('cancelled');
    },
    () => {
      dispatched++;
    }
  );
  await settle();
  assert.equal(dispatched, 1);
  assert.equal(f.responders.length, 1);
  current = false;
  held.release();
  await response;
  await assert.rejects(
    transport.respond(
      pending.session.binding,
      pending.id,
      { error: { code: 4001, message: 'Cancelled' } },
      () => undefined,
      () => {
        dispatched++;
      }
    )
  );
  assert.equal(dispatched, 1);
  assert.equal(f.responders.length, 1);
  await transport.close();
});

test('an uncertain SDK response failure retains the one-attempt handoff barrier', async () => {
  const f = fixture(),
    transport = await openWalletConnectTransport(f.options);
  const pending = await request(f);
  let attempts = 0,
    dispatched = 0;
  f.client.respond = async () => {
    attempts++;
    throw new Error('Uncertain relay acknowledgement');
  };
  await assert.rejects(
    transport.respond(
      pending.session.binding,
      pending.id,
      { result: 'signature' },
      () => undefined,
      () => {
        dispatched++;
      }
    )
  );
  await assert.rejects(
    transport.respond(
      pending.session.binding,
      pending.id,
      { error: { code: 4001, message: 'Cancelled' } },
      () => undefined,
      () => {
        dispatched++;
      }
    )
  );
  assert.equal(dispatched, 1);
  assert.equal(attempts, 1);
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
  assert.equal(f.calls.includes('core-dispose'), true);
  assert.equal(f.calls.includes('client-dispose'), true);
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
  assert.equal(f.calls.includes('core-dispose'), true);
  assert.equal(f.calls.includes('client-dispose'), true);
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
    () => undefined,
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
  assert(f.calls.includes('core-dispose'));
  assert(f.calls.includes('client-dispose'));
  assert.equal(
    f.events.some((event) => event.type === 'request'),
    false
  );
  await assert.rejects(transport.close(), {
    message: 'CONNECTION_UNAVAILABLE',
  });
});

test('owner retirement drains pending SDK initialization and disposes its late client', async () => {
  const f = fixture(),
    held = deferred();
  f.setInitialize(async () => {
    await held.promise;
  });
  let finished = false;
  const opening = openWalletConnectTransport(f.options);
  const rejected = assert
    .rejects(opening, { message: 'CONNECTION_UNAVAILABLE' })
    .then(() => {
      finished = true;
    });
  await settle();
  f.abort();
  await settle();
  assert(f.calls.includes('core-dispose'));
  assert.equal(finished, false);
  held.release();
  await rejected;
  assert(f.calls.indexOf('client-dispose') > f.calls.indexOf('client'));
  assert.deepEqual(f.events, []);
});

test('close joins both public terminal disposals and preserves cleanup failure', async () => {
  const f = fixture(),
    coreClosed = deferred(),
    clientClosed = deferred();
  f.core.dispose = async () => {
    f.calls.push('core-dispose');
    await coreClosed.promise;
    throw Error('private cleanup failure');
  };
  f.client.dispose = async () => {
    f.calls.push('client-dispose');
    await clientClosed.promise;
  };
  const transport = await openWalletConnectTransport(f.options);
  let finished = false;
  const closing = transport.close();
  assert.equal(transport.close(), closing);
  const rejected = assert
    .rejects(closing, { message: 'CONNECTION_UNAVAILABLE' })
    .then(() => {
      finished = true;
    });
  await settle();
  assert(f.calls.includes('core-dispose'));
  assert(f.calls.includes('client-dispose'));
  coreClosed.release();
  await settle();
  assert.equal(finished, false);
  clientClosed.release();
  await rejected;
  assert.equal(finished, true);
});

test('failed initialization retains a private cleanup failure brand', async () => {
  const f = fixture();
  f.setInitialize(async () => {
    throw new Error('private initialization failure');
  });
  f.core.dispose = async () => {
    throw new Error('private cleanup failure');
  };
  await assert.rejects(openWalletConnectTransport(f.options), (error) => {
    assert(error instanceof Error);
    assert.equal(error.message, 'CONNECTION_UNAVAILABLE');
    assert.equal(isWalletConnectCleanupFailure(error), true);
    assert.equal('cause' in error, false);
    assert.equal(JSON.stringify(error).includes('private'), false);
    return true;
  });
  assert.equal(
    isWalletConnectCleanupFailure(
      Object.assign(new Error('CONNECTION_UNAVAILABLE'), {
        cleanupFailed: true,
      })
    ),
    false
  );
  assert.equal(
    isWalletConnectCleanupFailure(
      new Proxy(
        {},
        {
          get() {
            throw new Error('Untrusted field access');
          },
        }
      )
    ),
    false
  );
});

test('successful cleanup of failed initialization permits a new transport', async () => {
  const f = fixture();
  let attempts = 0;
  f.setInitialize(async () => {
    if (++attempts === 1) throw new Error('private initialization failure');
  });
  await assert.rejects(openWalletConnectTransport(f.options), (error) => {
    assert.equal(isWalletConnectCleanupFailure(error), false);
    return true;
  });
  assert(f.calls.includes('core-dispose'));
  const transport = await openWalletConnectTransport(f.options);
  assert.equal(attempts, 2);
  await transport.close();
});

test('retirement during Core construction disposes the unpublished Core', async () => {
  const f = fixture();
  const sdk = await f.options.loadSdk();
  const create = sdk.createCore;
  f.options.loadSdk = async () => ({
    ...sdk,
    createCore: (input) => {
      const core = create(input);
      f.abort();
      return core;
    },
  });
  await assert.rejects(openWalletConnectTransport(f.options), {
    message: 'CONNECTION_UNAVAILABLE',
  });
  assert(f.calls.includes('core-dispose'));
  assert.equal(f.calls.includes('client'), false);
});

test('the terminal contract is required before accepting a client', async () => {
  const f = fixture();
  f.client.dispose = undefined as never;
  await assert.rejects(openWalletConnectTransport(f.options), {
    message: 'CONNECTION_UNAVAILABLE',
  });
  assert(f.calls.includes('core-dispose'));
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
