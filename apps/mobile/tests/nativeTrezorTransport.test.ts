import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrezorConnection } from '@sidhujag/sysweb3-keyring/cjs/trezor/connect.js';
import { createTrezorSessions } from '../src/hardware/trezorSessions.ts';
import { createNativeTrezorCallbackRouter } from '../src/hardware/trezorCallbackRouter.ts';
import type { NativeTrezorClient } from '../src/hardware/trezorHost.ts';
import type { NativeTrezorHandoffOwner } from '../src/hardware/trezorHandoff.ts';

const guard = () => undefined;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const owner = (): NativeTrezorHandoffOwner => ({
  walletFingerprint: 'aa'.repeat(32),
  accountId: null,
  accountIndex: null,
  accountAddress: null,
  network: {
    id: 'evm-network',
    kind: 'evm',
    chainId: '57000',
    slip44: 60,
    registrationHash: 'bb'.repeat(32),
  },
});
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const addressRequest = { path: "m/44'/60'/0'/0/0", showOnTrezor: false };
const response = {
  success: true,
  payload: { address: '0x' + '11'.repeat(20) },
};

function fixture(
  config: {
    workflow?: 'import' | 'send';
    kind?: 'evm' | 'utxo';
    changeURL?: (url: URL) => void;
    opening?: Promise<unknown>;
    loading?: Promise<void>;
    cleanupError?: Error;
    cancelError?: Error;
    noDispatch?: boolean;
    vendorError?: Error;
    realClient?: boolean;
    now?: () => number;
    beforeSuiteOpen?(expiresAt: number, job: object): (opened: boolean) => void;
  } = {}
) {
  let loads = 0,
    inits = 0,
    cancels = 0,
    disposals = 0,
    randomness = 0;
  const urls: string[] = [];
  const order: string[] = [];
  const clients: NativeTrezorClient[] = [];
  const sessions = createTrezorSessions({
    now: config.now ?? (() => 1000),
    randomBytes: (length) => new Uint8Array(length).fill(++randomness),
    async loadClient() {
      loads++;
      if (config.loading) await config.loading;
      if (config.realClient) {
        const { TrezorConnectDeeplink } = await import(
          '@trezor/connect-mobile'
        );
        return new TrezorConnectDeeplink();
      }
      let settings: Parameters<NativeTrezorClient['init']>[0];
      const vendor = deferred<unknown>();
      const client: NativeTrezorClient = {
        async init(value) {
          inits++;
          settings = value;
        },
        call({ method, ...params }) {
          if (!config.noDispatch) {
            const callback = new URL(settings.deeplinkCallbackUrl);
            callback.searchParams.set('id', `request-${loads}`);
            const url = new URL(settings.connectSrc + 'deeplink/1/');
            url.searchParams.set('method', String(method));
            url.searchParams.set('params', JSON.stringify(params));
            url.searchParams.set('callback', callback.toString());
            url.searchParams.set('appName', settings.manifest.appName);
            config.changeURL?.(url);
            settings.deeplinkOpen(url.toString());
          }
          if (config.vendorError) return Promise.reject(config.vendorError);
          return vendor.promise;
        },
        cancel() {
          order.push('cancel');
          cancels++;
          vendor.resolve(undefined);
          if (config.cancelError) throw config.cancelError;
        },
        async dispose() {
          order.push('dispose');
          disposals++;
          if (config.cleanupError) throw config.cleanupError;
        },
      };
      clients.push(client);
      return client;
    },
    async openURL(url) {
      urls.push(url);
      if (config.opening) await config.opening;
    },
  });
  const binding: NativeTrezorHandoffOwner = config.workflow === 'send' ? {
    ...owner(), accountId: config.kind === 'utxo' ? 'trezor:0:0' : 'trezor:60:0',
    accountIndex: 0, accountAddress: response.payload.address,
    network: config.kind === 'utxo' ? { ...owner().network, id: 'bitcoin', kind: 'utxo', chainId: '0', slip44: 0 } : owner().network,
  } : owner();
  const generation = sessions.advanceSessionGeneration();
  const start = (assertCurrent = guard) =>
    sessions.start({
      owner: binding,
      workflow: config.workflow ?? 'import',
      expiresAt: 91_000,
      sessionGeneration: generation,
      beforeSuiteOpen: config.beforeSuiteOpen,
      assertCurrent,
    });
  const callback = (index = urls.length - 1, value: unknown = response) => {
    const url = new URL(new URL(urls[index]!).searchParams.get('callback')!);
    url.searchParams.set('response', JSON.stringify(value));
    return url.toString();
  };
  return {
    sessions,
    binding,
    start,
    urls,
    callback,
    clients,
    order,
    counts: () => ({ loads, inits, cancels, disposals }),
  };
}

test('service creation, unlock and SDK init do not load Connect or open Suite', async () => {
  const f = fixture(),
    session = f.start();
  await session.host.init(guard);
  assert.deepEqual(f.counts(), {
    loads: 0,
    inits: 0,
    cancels: 0,
    disposals: 0,
  });
  assert.equal(f.urls.length, 0);
  await session.cancel();
  await f.sessions.dispose();
});

test('begin observers see the current opaque job token immediately', async () => {
  const f = fixture();
  const observed: unknown[] = [];
  const remove = f.sessions.subscribe(() =>
    observed.push(f.sessions.getSnapshot()?.job)
  );
  const first = f.start();
  assert.equal(observed[0], first.job);
  await first.cancel();
  const second = f.start();
  assert.equal(observed.at(-1), second.job);
  assert.notEqual(first.job, second.job);
  remove();
  await second.cancel();
  await f.sessions.dispose();
});

test('explicit SDK call binds its vendor ID before launch and returns only a validated callback', async () => {
  const f = fixture(),
    session = f.start();
  await session.host.init(guard);
  const result = session.host.ethereumGetAddress(guard, addressRequest);
  await tick();
  assert.equal(f.urls.length, 1);
  const bad = new URL(f.callback());
  bad.searchParams.set('id', 'other');
  assert.equal(f.sessions.receiveCallback(bad.toString()), false);
  assert.equal(f.sessions.receiveCallback(f.callback()), true);
  assert.deepEqual(JSON.parse(JSON.stringify(await result)), response);
  assert.deepEqual(f.counts(), {
    loads: 1,
    inits: 1,
    cancels: 1,
    disposals: 1,
  });
  assert.deepEqual(f.order, ['cancel', 'dispose']);
  await session.finish();
  assert.equal(f.sessions.getSnapshot(), null);
  assert.throws(
    () => session.host.ethereumGetAddress(guard, addressRequest),
    /cancelled/
  );
  await f.sessions.dispose();
});

test('official Connect 10 constructor and shared SDK use the same bounded native dispatch', async () => {
  const f = fixture({ realClient: true }),
    session = f.start();
  const connection = createTrezorConnection(session.host);
  await connection.init();
  const result = connection.ethereumGetAddress(addressRequest);
  // The real lazy module import can require several event-loop turns.
  for (let attempt = 0; attempt < 100 && !f.urls.length; attempt++)
    await tick();
  assert.equal(f.urls.length, 1);
  assert.equal(f.sessions.receiveCallback(f.callback()), true);
  assert.deepEqual(JSON.parse(JSON.stringify(await result)), response);
  await connection.retire();
  await session.finish();
  await f.sessions.dispose();
});

test('shared SDK wrapper retires before a fresh wrapper replays the public response', async () => {
  const f = fixture(),
    session = f.start();
  const connection = createTrezorConnection(session.host);
  await connection.init();
  const result = connection.ethereumGetAddress(addressRequest);
  await tick();
  const retirement = session.retire(async () => {
    await connection.retire();
  });
  await assert.rejects(result, /cancelled|CANCELLED/);
  await retirement;
  assert.equal(f.sessions.receiveCallback(f.callback()), true);
  await assert.rejects(
    connection.ethereumGetAddress(addressRequest),
    /initialized|cancelled/
  );
  const resumed = f.sessions.resume({
    job: session.job,
    owner: owner(),
    sessionGeneration: f.sessions.advanceSessionGeneration(),
    accepted: true,
    assertCurrent: guard,
  });
  const fresh = createTrezorConnection(resumed.host);
  await fresh.init();
  assert.deepEqual(
    JSON.parse(JSON.stringify(await fresh.ethereumGetAddress(addressRequest))),
    response
  );
  assert.equal(f.urls.length, 1);
  await fresh.retire();
  await resumed.finish();
  await f.sessions.dispose();
});

test('a zero-step SDK session can resume before its first explicit Suite dispatch', async () => {
  const f = fixture(),
    session = f.start();
  const original = createTrezorConnection(session.host);
  await original.init();
  await session.retire(async () => {
    await original.retire();
  });
  assert.equal(f.sessions.getSnapshot()?.phase, 'response-ready');
  assert.equal(f.counts().loads, 0);
  assert.throws(() =>
    f.sessions.resume({
      job: session.job,
      owner: owner(),
      sessionGeneration: 1,
      accepted: true,
      assertCurrent: guard,
    })
  );
  const generation = f.sessions.advanceSessionGeneration();
  assert.throws(() =>
    f.sessions.resume({
      job: session.job,
      owner: { ...owner(), walletFingerprint: 'cc'.repeat(32) },
      sessionGeneration: generation,
      accepted: true,
      assertCurrent: guard,
    })
  );
  const resumed = f.sessions.resume({
    job: session.job,
    owner: owner(),
    sessionGeneration: generation,
    accepted: true,
    assertCurrent: guard,
  });
  const fresh = createTrezorConnection(resumed.host);
  await fresh.init();
  assert.equal(f.counts().loads, 0);
  const result = fresh.ethereumGetAddress(addressRequest);
  await tick();
  assert.equal(f.urls.length, 1);
  assert.equal(f.sessions.receiveCallback(f.callback()), true);
  assert.deepEqual(JSON.parse(JSON.stringify(await result)), response);
  await fresh.retire();
  await resumed.finish();
  await f.sessions.dispose();
});

test('background retirement discards the old worker and fresh explicit resume replays without opening Suite', async () => {
  const f = fixture(),
    session = f.start();
  await session.host.init(guard);
  const result = session.host.ethereumGetAddress(guard, addressRequest);
  await tick();
  let sdkRetirements = 0;
  const retirement = session.retire(async () => {
    sdkRetirements++;
  });
  await assert.rejects(result, /cancelled|CANCELLED/);
  await retirement;
  assert.equal(sdkRetirements, 1);
  assert.equal(f.sessions.getSnapshot()?.phase, 'locked');
  assert.equal(f.sessions.receiveCallback(f.callback()), true);
  assert.throws(() =>
    f.sessions.resume({
      job: session.job,
      owner: owner(),
      sessionGeneration: 1,
      accepted: true,
      assertCurrent: guard,
    })
  );
  const fresh = f.sessions.resume({
    job: session.job,
    owner: owner(),
    sessionGeneration: f.sessions.advanceSessionGeneration(),
    accepted: true,
    assertCurrent: guard,
  });
  await fresh.host.init(guard);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(await fresh.host.ethereumGetAddress(guard, addressRequest))
    ),
    response
  );
  assert.equal(f.urls.length, 1);
  assert.equal(f.counts().loads, 1);
  await fresh.finish();
  await f.sessions.dispose();
});

test('a fresh worker must replay the exact public request', async () => {
  const f = fixture(),
    session = f.start();
  await session.host.init(guard);
  const result = session.host.ethereumGetAddress(guard, addressRequest);
  await tick();
  await session.retire(async () => undefined);
  await assert.rejects(result);
  f.sessions.receiveCallback(f.callback());
  const fresh = f.sessions.resume({
    job: session.job,
    owner: owner(),
    sessionGeneration: f.sessions.advanceSessionGeneration(),
    accepted: true,
    assertCurrent: guard,
  });
  await fresh.host.init(guard);
  assert.throws(() =>
    fresh.host.ethereumGetAddress(guard, {
      ...addressRequest,
      path: "m/44'/60'/0'/0/1",
    })
  );
  assert.equal(f.urls.length, 1);
  await fresh.cancel();
  await f.sessions.dispose();
});

test('lock during lazy loading revokes the old guard before any vendor initialization or launch', async () => {
  const loading = deferred(),
    f = fixture({ loading: loading.promise });
  let live = true;
  const session = f.start(() => {
    if (!live) throw new Error('old guard invoked');
  });
  await session.host.init(guard);
  const result = session.host.ethereumGetAddress(guard, addressRequest);
  await tick();
  live = false;
  const retirement = session.retire(async () => undefined);
  loading.resolve();
  await assert.rejects(result, /cancelled/);
  await retirement;
  assert.equal(f.counts().inits, 0);
  assert.equal(f.urls.length, 0);
  await f.sessions.cancel(session.job);
  await f.sessions.dispose();
});

test('cancel waits for an already-started OS launch and prevents another job until it drains', async () => {
  const opening = deferred(),
    f = fixture({ opening: opening.promise }),
    session = f.start();
  await session.host.init(guard);
  const result = session.host.ethereumGetAddress(guard, addressRequest);
  await tick();
  let closed = false;
  const closing = session.cancel().then(() => {
    closed = true;
  });
  await tick();
  assert.equal(closed, false);
  assert.throws(() => f.start(), /BUSY/);
  opening.resolve();
  await assert.rejects(result);
  await closing;
  const next = f.start();
  await next.cancel();
  await f.sessions.dispose();
});

for (const changeURL of [
  (url: URL) => {
    url.hostname = 'attacker.example';
  },
  (url: URL) => {
    url.searchParams.set('params', '{}');
  },
  (url: URL) => {
    url.searchParams.append('callback', url.searchParams.get('callback')!);
  },
  (url: URL) => {
    const callback = new URL(url.searchParams.get('callback')!);
    callback.pathname = '/wrong';
    url.searchParams.set('callback', callback.toString());
  },
  (url: URL) => {
    const callback = new URL(url.searchParams.get('callback')!);
    callback.searchParams.append('id', 'extra');
    url.searchParams.set('callback', callback.toString());
  },
])
  test('unmatched vendor dispatch is refused before OS launch', async () => {
    const f = fixture({ changeURL }),
      session = f.start();
    await session.host.init(guard);
    await assert.rejects(
      session.host.ethereumGetAddress(guard, addressRequest),
      /Invalid/
    );
    assert.equal(f.urls.length, 0);
    assert.equal(f.counts().disposals, 1);
    await session.cancel();
    await f.sessions.dispose();
  });

test('vendor call without a dispatch cannot leave the SDK waiting', async () => {
  const f = fixture({ noDispatch: true }),
    session = f.start();
  await session.host.init(guard);
  await assert.rejects(
    session.host.ethereumGetAddress(guard, addressRequest),
    /Invalid/
  );
  await session.cancel();
  await f.sessions.dispose();
});

test('vendor rejection stops the worker without granting a callback response', async () => {
  const f = fixture({ vendorError: new Error('vendor failed') }),
    session = f.start();
  await session.host.init(guard);
  await assert.rejects(
    session.host.ethereumGetAddress(guard, addressRequest),
    /vendor failed/
  );
  await session.cancel();
  await f.sessions.dispose();
});

test('resource cleanup failure remains an admission barrier even after the request settled', async () => {
  const f = fixture({ cleanupError: new Error('vendor cleanup failed') }),
    session = f.start();
  await session.host.init(guard);
  const result = session.host.ethereumGetAddress(guard, addressRequest);
  await tick();
  f.sessions.receiveCallback(f.callback());
  await assert.rejects(result, /vendor cleanup failed/);
  await assert.rejects(session.cancel(), /vendor cleanup failed/);
  assert.throws(() => f.start(), /BUSY/);
  await assert.rejects(f.sessions.dispose(), /vendor cleanup failed/);
});

test('a throwing vendor cancel still attempts disposal and fails closed', async () => {
  const f = fixture({ cancelError: new Error('cancel failed') }),
    session = f.start();
  await session.host.init(guard);
  const result = session.host.ethereumGetAddress(guard, addressRequest);
  await tick();
  f.sessions.receiveCallback(f.callback());
  await assert.rejects(result, /cancel failed/);
  assert.equal(f.counts().disposals, 1);
  await assert.rejects(session.cancel(), /cancel failed/);
  await assert.rejects(f.sessions.dispose(), /cancel failed/);
});

test('import workflows and secret parameters cannot load a signing client', async () => {
  const f = fixture(),
    session = f.start();
  await session.host.init(guard);
  assert.throws(
    () =>
      session.host.ethereumSignMessage(guard, {
        path: addressRequest.path,
        message: 'message',
      }),
    /INVALID/
  );
  assert.throws(() =>
    session.host.ethereumGetAddress(guard, {
      ...addressRequest,
      seed: 'secret',
    } as typeof addressRequest)
  );
  assert.equal(f.counts().loads, 0);
  await session.cancel();
  await f.sessions.dispose();
});

test('retiring after cancellation still destroys the private SDK worker exactly once', async () => {
  const f = fixture(),
    session = f.start();
  await session.cancel();
  let count = 0;
  await session.retire(async () => { count++; });
  await session.retire(async () => { count++; });
  assert.equal(count, 1);
  await f.start().cancel();
  await f.sessions.dispose();
});

test('expiry retires the old SDK once and permits a new Trezor job after draining', async () => {
  let now = 1000;
  const f = fixture({ now: () => now }), session = f.start();
  await session.host.init(guard);
  now = 91_000;
  assert.equal(f.sessions.getSnapshot(), null);
  const sdk = deferred();
  let count = 0, settled = false;
  const retirement = session.retire(async () => { count++; await sdk.promise; });
  void retirement.then(() => { settled = true; });
  await tick();
  assert.equal(settled, false);
  sdk.resolve();
  await retirement;
  await session.retire(async () => { count++; });
  assert.equal(count, 1);
  now = 1000;
  await f.start().cancel();
  await f.sessions.dispose();
});

test('expiry does not hide actual transport cleanup failure', async () => {
  let now = 1000;
  const f = fixture({ now: () => now, cleanupError: new Error('expired cleanup failed') });
  const session = f.start();
  await session.host.init(guard);
  const request = assert.rejects(session.host.ethereumGetAddress(guard, addressRequest));
  await tick();
  now = 91_000;
  let count = 0;
  await assert.rejects(session.retire(async () => { count++; }), /expired cleanup failed/);
  await request;
  assert.equal(count, 1);
  assert.throws(() => f.start(), /BUSY/);
  await assert.rejects(f.sessions.dispose(), /expired cleanup failed/);
});

test('callback router owns one subscription and ignores delivery after disposal', async () => {
  const initial = deferred<string | null>(),
    seen: unknown[] = [];
  let listener!: (event: { url: string }) => void,
    removals = 0;
  const router = createNativeTrezorCallbackRouter(
    {
      receiveCallback(url) {
        seen.push(url);
        return false;
      },
    },
    {
      getInitialURL: () => initial.promise,
      addEventListener(_name, receive) {
        listener = receive;
        return {
          remove() {
            removals++;
          },
        };
      },
    }
  );
  listener({ url: 'pali://unrelated' });
  router.dispose();
  router.dispose();
  initial.resolve('pali://late');
  listener({ url: 'pali://later' });
  await router.ready;
  assert.deepEqual(seen, ['pali://unrelated']);
  assert.equal(removals, 1);
});


test('verified Suite marker runs before opening and reports a failed launch without granting signing authority', async () => {
  const opening = deferred(), markers: unknown[] = [];
  const f = fixture({ opening: opening.promise, beforeSuiteOpen: (expiresAt, job) => {
    assert.equal(f.urls.length, 0); markers.push({ expiresAt, job }); return opened => { markers.push(opened); };
  } });
  const session = f.start(); await session.host.init(guard); const pending = session.host.ethereumGetAddress(guard, addressRequest), rejected = assert.rejects(pending);
  await tick(); assert.equal(markers.length, 1); assert.equal(f.urls.length, 1);
  opening.reject(Error('Suite launch failed')); await rejected;
  assert.deepEqual(markers.slice(1), [false]); await f.sessions.dispose();
});

test('an invalid Suite dispatch never reaches the intentional-background marker', async () => {
  let markers = 0;
  const f = fixture({ changeURL: url => { url.searchParams.set('params', '{}'); }, beforeSuiteOpen: () => { markers++; return () => {}; } });
  const session = f.start(); await session.host.init(guard); await assert.rejects(session.host.ethereumGetAddress(guard, addressRequest));
  assert.equal(markers, 0); assert.equal(f.urls.length, 0); await f.sessions.dispose();
});


const messageCases = [
  { method: 'ethereumSignMessage', kind: 'evm', params: { path: addressRequest.path, message: '6162', hex: true } },
  { method: 'ethereumSignTypedData', kind: 'evm', params: {
    path: addressRequest.path, data: {
      types: { EIP712Domain: [], Notice: [{ name: 'text', type: 'string' }] },
      primaryType: 'Notice', domain: {}, message: { text: 'Reviewed message' },
    }, metamask_v4_compat: true, domain_separator_hash: 'ab'.repeat(32), message_hash: 'cd'.repeat(32),
  } },
  { method: 'signMessage', kind: 'utxo', params: { path: "m/84'/0'/0'", coin: 'btc', message: 'Reviewed message' } },
] as const;

for (const { method, kind, params } of messageCases) {
  test(`native ${method} replays the exact Suite callback through a fresh owned SDK without reopening Suite`, async () => {
    const f = fixture({ workflow: 'send', kind });
    const session = f.start(), connection = createTrezorConnection(session.host);
    const authority = () => ({ signal: new AbortController().signal, assertCurrent: guard });
    const invoke = (sdk: ReturnType<typeof createTrezorConnection>) => sdk.withOwnedSigning(authority(), async owned => {
      await owned.init();
      return Reflect.apply(owned[method], owned, [params]);
    });
    try {
      const result = invoke(connection), rejected = assert.rejects(result, /cancelled|CANCELLED/);
      await tick(); assert.equal(f.urls.length, 1);
      const wire = new URL(f.urls[0]!);
      assert.equal(wire.searchParams.get('method'), method);
      assert.deepEqual(JSON.parse(wire.searchParams.get('params')!), params);
      const retirement = session.retire(() => connection.retire().then(() => undefined));
      await rejected; await retirement;
      const signed = { success: true, payload: { address: response.payload.address, signature: 'ab'.repeat(65) } };
      const callback = f.callback(0, signed), wrong = new URL(callback);
      wrong.searchParams.set('id', 'wrong-device-request');
      assert.equal(f.sessions.receiveCallback(wrong.toString()), false);
      assert.equal(f.sessions.receiveCallback(callback), true);
      assert.equal(f.sessions.getSnapshot()?.phase, 'response-ready');
      const resumed = f.sessions.resume({ job: session.job, owner: f.binding,
        sessionGeneration: f.sessions.advanceSessionGeneration(), accepted: true, assertCurrent: guard });
      const fresh = createTrezorConnection(resumed.host);
      assert.deepEqual(JSON.parse(JSON.stringify(await invoke(fresh))), signed);
      assert.equal(f.urls.length, 1); assert.equal(f.counts().loads, 1);
      await fresh.retire(); await resumed.finish();
      assert.equal(f.sessions.getSnapshot(), null);
      assert.equal(f.sessions.receiveCallback(callback), false);
    } finally { await f.sessions.dispose(); }
  });

  test(`native ${method} mismatch cannot reuse a response and explicit cancellation discards its transcript`, async () => {
    const f = fixture({ workflow: 'send', kind }), session = f.start();
    try {
      await session.host.init(guard);
      const original = Reflect.apply(session.host[method], session.host, [guard, params]);
      const rejected = assert.rejects(original);
      await tick();
      await session.retire(async () => undefined); await rejected;
      const callback = f.callback(0, { success: true, payload: { signature: 'ab'.repeat(65) } });
      assert.equal(f.sessions.receiveCallback(callback), true);
      const resumed = f.sessions.resume({ job: session.job, owner: f.binding,
        sessionGeneration: f.sessions.advanceSessionGeneration(), accepted: true, assertCurrent: guard });
      await resumed.host.init(guard);
      assert.throws(() => Reflect.apply(resumed.host[method], resumed.host, [guard, { ...params, path: "m/44'/60'/0'/0/1" }]), /CANCELLED/);
      assert.equal(f.urls.length, 1);
      await resumed.cancel();
      assert.equal(f.sessions.getSnapshot(), null);
      assert.equal(f.sessions.receiveCallback(callback), false);
      assert.throws(() => Reflect.apply(resumed.host[method], resumed.host, [guard, params]), /cancelled|CANCELLED/);
    } finally { await f.sessions.dispose(); }
  });
}
