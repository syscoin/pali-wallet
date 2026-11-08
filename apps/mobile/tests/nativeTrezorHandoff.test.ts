import assert from 'node:assert/strict';
import test from 'node:test';
import { DAPP_REQUEST_LIMITS } from '../../../source/utils/requestPayloadBudget.ts';
import {
  NativeTrezorHandoff,
  type NativeTrezorHandoffOwner,
  type NativeTrezorHandoffInvocation,
  type NativeTrezorHandoffCall,
} from '../src/hardware/trezorHandoff.ts';

const guard = () => undefined;
const admission = (sessionGeneration = 1) => ({
  sessionGeneration,
  assertCurrent: guard,
});
const owner = (): NativeTrezorHandoffOwner => ({
  walletFingerprint: 'aa'.repeat(32),
  accountId: 'trezor:60:0',
  accountIndex: 0,
  accountAddress: '0x' + '11'.repeat(20),
  network: {
    id: 'ethereum',
    kind: 'evm',
    chainId: '1',
    slip44: 60,
    registrationHash: '0x' + 'bb'.repeat(32),
  },
});
const addressParams = () => ({ path: "m/44'/60'/0'/0/0", showOnTrezor: false });
const response = () => ({
  success: true,
  payload: { address: '0x' + '11'.repeat(20) },
});
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve!: () => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function setup(
  workflow: 'import' | 'send' = 'import',
  retireTransport: () => void | Promise<void> = guard
) {
  let now = 1000,
    randomCalls = 0;
  const coordinator = new NativeTrezorHandoff({
    now: () => now,
    retireTransport,
    randomBytes: (length) => new Uint8Array(length).fill(++randomCalls),
  });
  const binding = owner();
  const tokens = coordinator.begin(binding, workflow, 91_000, admission());
  const call = (
    invocation: NativeTrezorHandoffInvocation = tokens.invocation,
    method = 'ethereumGetAddress' as const,
    params: unknown = addressParams()
  ) => {
    const prepared = coordinator.request(invocation, method, params, guard);
    if (prepared.dispatch)
      coordinator.bindRequestId(invocation, `request-${randomCalls}`, guard);
    return prepared;
  };
  const callback = (
    prepared: NativeTrezorHandoffCall,
    result: unknown = response()
  ) => {
    assert.ok(prepared.dispatch);
    const url = new URL(prepared.dispatch.callbackUrl);
    url.searchParams.set(
      'id',
      `request-${Number.parseInt(url.pathname.slice(1, 3), 16)}`
    );
    url.searchParams.set('response', JSON.stringify(result));
    return url.toString();
  };
  return {
    coordinator,
    binding,
    ...tokens,
    call,
    callback,
    expire: () => {
      now = 91_000;
    },
  };
}

test('one public job snapshots the exact owner and parameters without retaining caller objects', async () => {
  const f = setup();
  const params = addressParams();
  const call = f.call(f.invocation, 'ethereumGetAddress', params);
  params.path = 'changed';
  (f.binding.network as { chainId: string }).chainId = '2';
  assert.equal(call.dispatch!.params.path, "m/44'/60'/0'/0/0");
  assert.equal(f.coordinator.getSnapshot()!.owner.network.chainId, '1');
  assert.equal(Object.isFrozen(call.dispatch!.params), true);
  assert.throws(
    () => f.coordinator.begin(owner(), 'import', 90_000, admission()),
    /BUSY/
  );
  assert.equal(f.coordinator.receiveCallback(f.callback(call)), true);
  assert.deepEqual(plain(await call.result), response());
  f.coordinator.finish(f.invocation, guard);
  assert.equal(f.coordinator.getSnapshot(), null);
  await f.coordinator.dispose();
});

test('background retirement cancels the old SDK promise, drains cleanup and requires fresh explicit acceptance', async () => {
  const f = setup(),
    cleanup = deferred();
  const call = f.call();
  const retirement = f.coordinator.retireInvocation(
    f.invocation,
    () => cleanup.promise
  );
  await assert.rejects(call.result, /CANCELLED/);
  assert.equal(f.coordinator.receiveCallback(f.callback(call)), true);
  assert.throws(
    () =>
      f.coordinator.acceptFresh(f.job, owner(), {
        ...admission(2),
        accepted: true,
      }),
    /CANCELLED/
  );
  cleanup.resolve();
  await retirement;
  assert.equal(f.coordinator.getSnapshot()!.phase, 'response-ready');
  assert.throws(
    () =>
      f.coordinator.acceptFresh(f.job, owner(), {
        ...admission(1),
        accepted: true,
      }),
    /CANCELLED/
  );
  assert.throws(
    () =>
      f.coordinator.acceptFresh(f.job, owner(), {
        ...admission(2),
        accepted: false as true,
      }),
    /CANCELLED/
  );
  const fresh = f.coordinator.acceptFresh(f.job, owner(), {
    ...admission(2),
    accepted: true,
  });
  assert.throws(() => f.call(f.invocation), /CANCELLED/);
  const replay = f.call(fresh);
  assert.equal(replay.dispatch, undefined);
  assert.deepEqual(plain(await replay.result), response());
  f.coordinator.finish(fresh, guard);
  await f.coordinator.dispose();
});

test('multi-step import replays an ordered prefix only and never opens a second call concurrently', async () => {
  const f = setup();
  const first = f.call();
  assert.throws(() => f.call(), /BUSY/);
  await f.coordinator.retireInvocation(f.invocation, guard);
  assert.equal(f.coordinator.receiveCallback(f.callback(first)), true);
  let fresh = f.coordinator.acceptFresh(f.job, owner(), {
    ...admission(2),
    accepted: true,
  });
  assert.throws(
    () =>
      f.coordinator.request(
        fresh,
        'ethereumGetPublicKey',
        addressParams(),
        guard
      ),
    /CANCELLED/
  );
  await f.call(fresh).result;
  const second = f.coordinator.request(
    fresh,
    'ethereumGetPublicKey',
    addressParams(),
    guard
  );
  f.coordinator.bindRequestId(fresh, 'public-key', guard);
  const secondUrl = new URL(second.dispatch!.callbackUrl);
  secondUrl.searchParams.set('id', 'public-key');
  secondUrl.searchParams.set(
    'response',
    JSON.stringify({
      success: true,
      payload: { publicKey: '04' + 'ab'.repeat(64) },
    })
  );
  await f.coordinator.retireInvocation(fresh, guard);
  assert.equal(f.coordinator.receiveCallback(secondUrl.toString()), true);
  fresh = f.coordinator.acceptFresh(f.job, owner(), {
    ...admission(3),
    accepted: true,
  });
  await f.call(fresh).result;
  const key = f.coordinator.request(
    fresh,
    'ethereumGetPublicKey',
    addressParams(),
    guard
  );
  assert.equal(key.dispatch, undefined);
  await key.result;
  assert.equal(f.coordinator.getSnapshot()!.completedSteps, 2);
  f.coordinator.finish(fresh, guard);
  await f.coordinator.dispose();
});

for (const field of [
  'walletFingerprint',
  'accountId',
  'accountIndex',
  'accountAddress',
  'network',
] as const) {
  test(`fresh acceptance rejects changed ${field}`, async () => {
    const f = setup(),
      call = f.call();
    await f.coordinator.retireInvocation(f.invocation, guard);
    f.coordinator.receiveCallback(f.callback(call));
    const changed = plain(owner()) as {
      -readonly [K in keyof NativeTrezorHandoffOwner]: NativeTrezorHandoffOwner[K];
    };
    if (field === 'walletFingerprint')
      changed.walletFingerprint = 'cc'.repeat(32);
    else if (field === 'accountId') changed.accountId = 'trezor:60:1';
    else if (field === 'accountIndex') changed.accountIndex = 1;
    else if (field === 'accountAddress')
      changed.accountAddress = '0x' + '22'.repeat(20);
    else
      changed.network = {
        ...changed.network,
        registrationHash: '0x' + 'cc'.repeat(32),
      };
    assert.throws(
      () =>
        f.coordinator.acceptFresh(f.job, changed, {
          ...admission(2),
          accepted: true,
        }),
      /CANCELLED/
    );
    await f.coordinator.cancel(f.job);
  });
}

test('canonical parameter matching accepts reordered keys and rejects changed, missing or extra values', async () => {
  const f = setup(),
    call = f.call();
  await f.coordinator.retireInvocation(f.invocation, guard);
  f.coordinator.receiveCallback(f.callback(call));
  const fresh = f.coordinator.acceptFresh(f.job, owner(), {
    ...admission(2),
    accepted: true,
  });
  for (const params of [
    { ...addressParams(), showOnTrezor: true },
    { path: addressParams().path },
    { ...addressParams(), extra: false },
  ])
    assert.throws(
      () => f.call(fresh, 'ethereumGetAddress', params),
      /CANCELLED/
    );
  await f.call(fresh, 'ethereumGetAddress', {
    showOnTrezor: false,
    path: addressParams().path,
  }).result;
  f.coordinator.finish(fresh, guard);
});

for (const mutate of [
  (url: URL) => {
    url.href = url.href.replace('pali:', 'https:');
  },
  (url: URL) => {
    url.host = 'other';
  },
  (url: URL) => {
    url.username = 'spoof';
  },
  (url: URL) => {
    url.pathname += '/extra';
  },
  (url: URL) => {
    url.pathname = '/' + '00'.repeat(32);
  },
  (url: URL) => {
    url.hash = 'fragment';
  },
  (url: URL) => {
    url.searchParams.set('id', 'unknown');
  },
  (url: URL) => {
    url.searchParams.append('id', 'request-1');
  },
  (url: URL) => {
    url.searchParams.append('response', '{}');
  },
  (url: URL) => {
    url.searchParams.set('redirect', 'https://example.com');
  },
]) {
  test('unrelated or ambiguous callbacks cannot replace the pending response', async () => {
    const f = setup(),
      call = f.call();
    const bad = new URL(f.callback(call));
    mutate(bad);
    assert.equal(f.coordinator.receiveCallback(bad.toString()), false);
    assert.equal(f.coordinator.receiveCallback(f.callback(call)), true);
    await call.result;
    await f.coordinator.cancel(f.job);
  });
}

test('cold, duplicate and retired-job callbacks cannot satisfy a later job', async () => {
  const f = setup(),
    call = f.call();
  const url = f.callback(call);
  const cold = new NativeTrezorHandoff({
    retireTransport: guard,
    randomBytes: (length) => new Uint8Array(length).fill(8),
  });
  assert.equal(cold.receiveCallback(url), false);
  assert.equal(f.coordinator.receiveCallback(url), true);
  assert.equal(f.coordinator.receiveCallback(url), false);
  await call.result;
  await f.coordinator.cancel(f.job);
  const next = f.coordinator.begin(owner(), 'import', 90_000, admission(2));
  const later = f.call(next.invocation);
  assert.equal(f.coordinator.receiveCallback(url), false);
  await f.coordinator.cancel(next.job);
  await assert.rejects(later.result, /CANCELLED/);
  await cold.dispose();
});

for (const invalid of [
  null,
  {},
  { success: true },
  { success: true, payload: {}, error: {} },
  { success: false, error: 'denied' },
  { success: false, error: { code: 1, message: 'denied' } },
  { success: true, payload: {}, id: 'injected' },
  { success: true, payload: {}, device: [] },
]) {
  test('malformed matching response cancels safely rather than entering the transcript', async () => {
    const f = setup(),
      call = f.call();
    assert.equal(
      f.coordinator.receiveCallback(f.callback(call, invalid)),
      false
    );
    assert.equal(f.coordinator.getSnapshot(), null);
    await assert.rejects(call.result, /CANCELLED/);
  });
}

test('Connect failure envelopes retain error codes and complete without a fabricated success', async () => {
  const f = setup(),
    call = f.call();
  const failed = {
    success: false,
    error: { code: 'Method_Cancel', message: 'Cancelled' },
  };
  assert.equal(f.coordinator.receiveCallback(f.callback(call, failed)), true);
  assert.deepEqual(plain(await call.result), failed);
  await f.coordinator.cancel(f.job);
});

test('only transaction signing is available, only for send, and only once', async () => {
  const f = setup();
  for (const method of [
    'ethereumSignMessage',
    'ethereumSignTypedData',
    'signMessage',
    'ethereumSignTransaction',
    'signTransaction',
  ])
    assert.throws(
      () =>
        f.coordinator.request(f.invocation, method as 'getFeatures', {}, guard),
      /INVALID/
    );
  await f.coordinator.cancel(f.job);
  const send = f.coordinator.begin(owner(), 'send', 90_000, admission(2));
  const signed = f.coordinator.request(
    send.invocation,
    'ethereumSignTransaction',
    { path: "m/44'/60'/0'/0/0", transaction: { nonce: '0x0' } },
    guard
  );
  f.coordinator.bindRequestId(send.invocation, 'sign', guard);
  const url = new URL(signed.dispatch!.callbackUrl);
  url.searchParams.set('id', 'sign');
  url.searchParams.set(
    'response',
    JSON.stringify({ success: true, payload: { r: 'ab', s: 'cd', v: '1b' } })
  );
  f.coordinator.receiveCallback(url.toString());
  await signed.result;
  assert.throws(
    () => f.coordinator.request(send.invocation, 'getFeatures', {}, guard),
    /LIMIT/
  );
  f.coordinator.finish(send.invocation, guard);
});

test('shared JSON budgets reject secrets, accessors, buffers, oversized and non-JSON parameters', async () => {
  const f = setup();
  let getterCalled = false;
  const getter = Object.defineProperty({}, 'path', {
    enumerable: true,
    get() {
      getterCalled = true;
      return 'bad';
    },
  });
  for (const value of [
    getter,
    new Uint8Array(2),
    { password: 'never retain' },
    { nested: { privateKey: 'never retain' } },
    { value: undefined },
    { value: Infinity },
    { value: 'a'.repeat(DAPP_REQUEST_LIMITS.bytes) },
  ])
    assert.throws(() => f.call(f.invocation, 'ethereumGetAddress', value));
  assert.equal(getterCalled, false);
  assert.equal(f.coordinator.getSnapshot()!.completedSteps, 0);
  await f.coordinator.cancel(f.job);
});

test('aggregate transcript budget and step count remain bounded', async () => {
  const f = setup();
  for (let index = 0; index < 8; index++) {
    const call = f.coordinator.request(
      f.invocation,
      'getFeatures',
      { index },
      guard
    );
    f.coordinator.bindRequestId(f.invocation, `request-${index + 1}`, guard);
    f.coordinator.receiveCallback(
      f.callback(call, { success: true, payload: {} })
    );
    await call.result;
  }
  assert.throws(
    () => f.coordinator.request(f.invocation, 'getFeatures', {}, guard),
    /LIMIT/
  );
  await f.coordinator.cancel(f.job);
  const next = f.coordinator.begin(owner(), 'import', 90_000, admission(2));
  const call = f.coordinator.request(
    next.invocation,
    'getFeatures',
    { publicData: 'a'.repeat(DAPP_REQUEST_LIMITS.bytes / 2) },
    guard
  );
  f.coordinator.bindRequestId(next.invocation, 'request-9', guard);
  assert.equal(
    f.coordinator.receiveCallback(
      f.callback(call, {
        success: true,
        payload: 'b'.repeat(DAPP_REQUEST_LIMITS.bytes / 2),
      })
    ),
    false
  );
  await assert.rejects(call.result, /CANCELLED/);
});

test('expiry clears pending results, blocks stale acceptance and does not extend on callback', async () => {
  const f = setup(),
    call = f.call();
  await f.coordinator.retireInvocation(f.invocation, guard);
  f.coordinator.receiveCallback(f.callback(call));
  f.expire();
  assert.equal(f.coordinator.getSnapshot(), null);
  assert.throws(
    () =>
      f.coordinator.acceptFresh(f.job, owner(), {
        ...admission(2),
        accepted: true,
      }),
    /CANCELLED/
  );
  assert.equal(f.coordinator.receiveCallback(f.callback(call)), false);
});

test('the timer expires an idle job without another API call', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup(),
    call = f.call();
  t.mock.timers.tick(90_000);
  assert.equal(f.coordinator.getSnapshot(), null);
  await assert.rejects(call.result, /CANCELLED/);
});

test('cancel and disposal drain exactly once; old tokens cannot clean up newer work', async () => {
  const cleanup = deferred();
  let cleanups = 0;
  const f = setup('import', () => {
    cleanups++;
    return cleanups === 1 ? cleanup.promise : undefined;
  });
  const call = f.call();
  const close = f.coordinator.cancel(f.job);
  assert.equal(f.coordinator.cancel(f.job), close);
  await assert.rejects(call.result, /CANCELLED/);
  assert.throws(
    () => f.coordinator.begin(owner(), 'import', 90_000, admission(2)),
    /BUSY/
  );
  cleanup.resolve();
  await close;
  const next = f.coordinator.begin(owner(), 'import', 90_000, admission(2));
  await f.coordinator.cancel(f.job);
  assert.equal(cleanups, 1);
  assert.ok(f.coordinator.getSnapshot());
  const disposal = f.coordinator.dispose();
  assert.equal(f.coordinator.dispose(), disposal);
  await disposal;
  assert.equal(cleanups, 2);
  assert.equal(f.coordinator.getSnapshot(), null);
  assert.throws(
    () =>
      f.coordinator.acceptFresh(next.job, owner(), {
        ...admission(3),
        accepted: true,
      }),
    /CANCELLED/
  );
});

test(
  'transport cleanup may reenter disposal without waiting on itself',
  { timeout: 1000 },
  async () => {
    let coordinator!: NativeTrezorHandoff;
    let calls = 0;
    coordinator = new NativeTrezorHandoff({
      now: () => 1000,
      randomBytes: (length) => new Uint8Array(length).fill(1),
      retireTransport: () => {
        calls++;
        return coordinator.dispose();
      },
    });
    const tokens = coordinator.begin(owner(), 'import', 90_000, admission());
    const close = coordinator.cancel(tokens.job);
    await close;
    assert.equal(coordinator.dispose(), close);
    assert.equal(calls, 1);
  }
);

for (const closeWith of ['cancel', 'dispose', 'retire'] as const) {
  test(
    `invocation cleanup may reenter ${closeWith} without a dependency cycle`,
    { timeout: 1000 },
    async () => {
      const f = setup();
      const call = f.call();
      const retirement = f.coordinator.retireInvocation(f.invocation, () => {
        if (closeWith === 'cancel') return f.coordinator.cancel(f.job);
        if (closeWith === 'dispose') return f.coordinator.dispose();
        return f.coordinator.retireInvocation(f.invocation, () => {
          throw new Error('duplicate cleanup');
        });
      });
      await assert.rejects(call.result, /CANCELLED/);
      await retirement;
      await f.coordinator.dispose();
      assert.equal(f.coordinator.getSnapshot(), null);
    }
  );
}

test('failed retirement prevents fresh use and a new job', async () => {
  const f = setup(),
    call = f.call();
  await assert.rejects(
    f.coordinator.retireInvocation(f.invocation, () =>
      Promise.reject(new Error('cleanup failed'))
    ),
    /cleanup failed/
  );
  await assert.rejects(call.result, /CANCELLED/);
  assert.equal(f.coordinator.getSnapshot(), null);
  assert.throws(
    () => f.coordinator.begin(owner(), 'import', 90_000, admission(2)),
    /BUSY/
  );
});

test('disposal after expiry waits for invocation cleanup even when transport retirement fails', async () => {
  const transport = deferred(),
    invocation = deferred();
  let now = 1000;
  const coordinator = new NativeTrezorHandoff({
    now: () => now,
    randomBytes: (length) => new Uint8Array(length).fill(1),
    retireTransport: () => transport.promise,
  });
  const tokens = coordinator.begin(owner(), 'import', 90_000, admission());
  const retirement = coordinator.retireInvocation(
    tokens.invocation,
    () => invocation.promise
  );
  now = 90_000;
  assert.equal(coordinator.getSnapshot(), null);
  let settled = false;
  const disposal = coordinator.dispose();
  assert.equal(disposal, coordinator.cancel(tokens.job));
  const rejected = assert
    .rejects(disposal, /transport cleanup failed/)
    .then(() => {
      settled = true;
    });
  transport.reject(new Error('transport cleanup failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  invocation.resolve();
  await retirement;
  await rejected;
  assert.equal(settled, true);
});

test('expiry holds replacement admission until transport cleanup finishes', async () => {
  const cleanup = deferred();
  let now = 1000;
  const coordinator = new NativeTrezorHandoff({
    now: () => now,
    randomBytes: (length) => new Uint8Array(length).fill(1),
    retireTransport: () => cleanup.promise,
  });
  const tokens = coordinator.begin(owner(), 'import', 90_000, admission());
  now = 90_000;
  assert.equal(coordinator.getSnapshot(), null);
  assert.throws(
    () => coordinator.begin(owner(), 'import', 180_000, admission(2)),
    /BUSY/
  );
  cleanup.resolve();
  await coordinator.cancel(tokens.job);
  coordinator.begin(owner(), 'import', 180_000, admission(2));
  await coordinator.dispose();
});

test('synchronous current guards are required and stale guards cannot admit work', async () => {
  const f = setup();
  assert.throws(
    () =>
      f.coordinator.request(
        f.invocation,
        'getFeatures',
        {},
        () => Promise.resolve() as unknown as void
      ),
    /CANCELLED/
  );
  assert.throws(
    () =>
      f.coordinator.request(f.invocation, 'getFeatures', {}, () => {
        throw Error('stale');
      }),
    /stale/
  );
  await f.coordinator.cancel(f.job);
});

test('pending import does not allocate an account and send requires a complete account identity', async () => {
  const pending = {
    ...owner(),
    accountId: null,
    accountIndex: null,
    accountAddress: null,
  };
  const coordinator = new NativeTrezorHandoff({
    now: () => 1000,
    randomBytes: (length) => new Uint8Array(length).fill(1),
    retireTransport: guard,
  });
  for (const binding of [
    { ...pending, accountId: 'reserved' },
    { ...pending, accountIndex: 0 },
  ])
    assert.throws(
      () => coordinator.begin(binding, 'import', 90_000, admission()),
      /INVALID/
    );
  assert.throws(
    () => coordinator.begin(pending, 'send', 90_000, admission()),
    /INVALID/
  );
  assert.throws(
    () =>
      coordinator.begin(
        { ...pending, accountAddress: owner().accountAddress },
        'send',
        90_000,
        admission()
      ),
    /INVALID/
  );
  const tokens = coordinator.begin(pending, 'import', 90_000, admission());
  assert.deepEqual(plain(coordinator.getSnapshot()!.owner), pending);
  await coordinator.cancel(tokens.job);
  await coordinator.dispose();
});

test('a retired zero-step job requires a fresh explicit owner before its first dispatch', async () => {
  const f = setup();
  await f.coordinator.retireInvocation(f.invocation, guard);
  assert.equal(f.coordinator.getSnapshot()?.phase, 'response-ready');
  assert.equal(f.coordinator.getSnapshot()?.completedSteps, 0);
  assert.throws(
    () =>
      f.coordinator.acceptFresh(f.job, owner(), {
        ...admission(1),
        accepted: true,
      }),
    /CANCELLED/
  );
  assert.throws(
    () =>
      f.coordinator.acceptFresh(
        f.job,
        {
          ...owner(),
          accountId: 'trezor:60:9',
          accountIndex: 9,
        },
        { ...admission(2), accepted: true }
      ),
    /CANCELLED/
  );
  const fresh = f.coordinator.acceptFresh(f.job, owner(), {
    ...admission(2),
    accepted: true,
  });
  const call = f.call(fresh);
  assert.ok(call.dispatch);
  assert.equal(f.coordinator.receiveCallback(f.callback(call)), true);
  assert.deepEqual(plain(await call.result), response());
  await f.coordinator.finish(fresh, guard);
  await f.coordinator.dispose();
});
