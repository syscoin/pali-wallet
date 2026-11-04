import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeTokens,
  type NativeTokenRuntime,
} from '../src/portfolio/nativeTokens.ts';
import type { Erc20Reader } from '../src/portfolio/erc20ReadRpc.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const metadata = {
  contractAddress: '0x3333333333333333333333333333333333333333',
  decimals: 255,
  name: 'Token',
  symbol: 'TOKEN',
};
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture(
  options: { items?: (typeof metadata)[]; reader?: Erc20Reader } = {}
) {
  let state: CustodySnapshot = {
    phase: 'ready',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: { address: A, network: 'ethereum' },
    error: null,
  };
  const listeners = new Set<(snapshot: CustodySnapshot) => void>();
  const mutations: { kind: string; address: string }[] = [];
  let items = options.items ?? [];
  let revision = 0;
  const source = {
    getSnapshot: () => state,
    subscribe: (listener: (snapshot: CustodySnapshot) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const runtime: NativeTokenRuntime = {
    async load(guard) {
      guard();
      return { revision, items };
    },
    async add(expected, token, guard) {
      guard();
      assert.equal(expected, revision);
      mutations.push({ kind: 'add', address: state.account!.address });
      items = [...items, token];
      return { revision: ++revision, items };
    },
    async remove(expected, contract, guard) {
      guard();
      assert.equal(expected, revision);
      mutations.push({ kind: 'remove', address: state.account!.address });
      items = items.filter((item) => item.contractAddress !== contract);
      return { revision: ++revision, items };
    },
  };
  const reader = options.reader ?? {
    async readToken() {
      return { metadata, units: '0' };
    },
    async readBalance() {
      return { units: '0' };
    },
  };
  const model = new NativeTokens(
    source,
    () => runtime,
    reader,
    () => 123
  );
  const change = (
    address: string | null,
    notify = true,
    network: 'ethereum' | 'base' = 'ethereum'
  ) => {
    state = {
      ...state,
      revision: state.revision + 1,
      phase: address ? 'ready' : 'locked',
      account: address ? { address, network } : null,
    };
    if (notify) for (const listener of [...listeners]) listener(state);
  };
  return {
    model,
    source,
    change,
    mutations,
    listenerCount: () => listeners.size,
  };
}
test('connected token import persists only after confirmation, zero is available, removal works', async () => {
  const f = fixture();
  const disconnect = f.model.connect();
  await tick();
  assert.equal(f.model.getSnapshot().status, 'ready');
  assert.deepEqual(f.model.getSnapshot().items, []);
  await f.model.preview(metadata.contractAddress);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.model.getSnapshot().preview?.units, '0');
  await f.model.confirmPreview();
  await tick();
  assert.deepEqual(f.mutations, [{ kind: 'add', address: A }]);
  assert.equal(f.model.getSnapshot().items[0]?.status, 'available');
  assert.equal(f.model.getSnapshot().items[0]?.units, '0');
  await f.model.remove(metadata.contractAddress);
  await tick();
  assert.deepEqual(f.model.getSnapshot().items, []);
  disconnect();
});
for (const mutation of ['confirm', 'remove'] as const)
  test(`silent account switch cannot apply old ${mutation} to the new account`, async () => {
    const f = fixture({ items: mutation === 'remove' ? [metadata] : [] });
    f.model.connect();
    await tick();
    if (mutation === 'confirm') await f.model.preview(metadata.contractAddress);
    f.change(B, false);
    if (mutation === 'confirm') await f.model.confirmPreview();
    else await f.model.remove(metadata.contractAddress);
    assert.equal(f.mutations.length, 0);
    assert.equal(f.model.getSnapshot().account?.address, B);
  });
test('lock and A-B-A discard late previews even when the reader ignores cancellation', async () => {
  const pending = deferred<{ metadata: typeof metadata; units: string }>();
  const f = fixture({
    reader: {
      readToken: () => pending.promise,
      async readBalance() {
        return { units: '0' };
      },
    },
  });
  f.model.connect();
  await tick();
  const preview = f.model.preview(metadata.contractAddress);
  f.change(B);
  f.change(A);
  await tick();
  pending.resolve({ metadata, units: '999' });
  await preview;
  assert.equal(f.model.getSnapshot().preview, null);
  f.change(null);
  assert.equal(f.model.getSnapshot().account, null);
  assert.deepEqual(f.model.getSnapshot().items, []);
});
test('read failure is unavailable, not zero, and unmount clears observations', async () => {
  const f = fixture({
    items: [metadata],
    reader: {
      async readToken() {
        throw Error('RAW_SECRET_ERROR');
      },
      async readBalance() {
        throw Error('RAW_SECRET_ERROR');
      },
    },
  });
  const disconnect = f.model.connect();
  await tick();
  const snapshot = f.model.getSnapshot();
  assert.equal(snapshot.items[0]?.status, 'error');
  assert.equal(snapshot.items[0]?.units, null);
  assert(!JSON.stringify(snapshot).includes('RAW_SECRET_ERROR'));
  disconnect();
  assert.equal(f.model.getSnapshot().status, 'unavailable');
  assert.equal(f.listenerCount(), 0);
});
test('observer context switch during preview admission cannot redirect the request', async () => {
  const calls: string[] = [];
  const f = fixture({
    reader: {
      async readToken(_network, address) {
        calls.push(address);
        return { metadata, units: '0' };
      },
      async readBalance() {
        return { units: '0' };
      },
    },
  });
  f.model.connect();
  await tick();
  let changed = false;
  f.model.subscribe(() => {
    if (!changed && f.model.getSnapshot().previewStatus === 'loading') {
      changed = true;
      f.change(B);
    }
  });
  await f.model.preview(metadata.contractAddress);
  assert.deepEqual(calls, []);
  assert.equal(f.model.getSnapshot().preview, null);
});
test('reentrant source subscription cannot steal replacement cleanup', async () => {
  const f = fixture();
  const old = f.source.subscribe;
  let recurse = true;
  let replacement!: () => void;
  f.source.subscribe = (listener) => {
    if (recurse) {
      recurse = false;
      replacement = f.model.connect();
    }
    return old(listener);
  };
  const stale = f.model.connect();
  await tick();
  stale();
  assert.equal(f.listenerCount(), 1);
  replacement();
  assert.equal(f.listenerCount(), 0);
  assert.equal(f.model.getSnapshot().status, 'unavailable');
});
test('new refresh cannot resurrect a removed row from an old balance read', async () => {
  const pending = deferred<{ units: string }>();
  let calls = 0;
  const f = fixture({
    items: [metadata],
    reader: {
      async readToken() {
        return { metadata, units: '0' };
      },
      readBalance() {
        return ++calls === 1
          ? pending.promise
          : Promise.resolve({ units: '0' });
      },
    },
  });
  f.model.connect();
  await tick();
  await f.model.remove(metadata.contractAddress);
  await tick();
  pending.resolve({ units: '123' });
  await tick();
  assert.deepEqual(f.model.getSnapshot().items, []);
});

test('connection replay drains an old registry read before starting the new scope', async () => {
  const f = fixture();
  const hold = deferred<void>();
  let calls = 0;
  let active = 0;
  let maximum = 0;
  const runtime: NativeTokenRuntime = {
    async load(guard) {
      active++;
      maximum = Math.max(maximum, active);
      const call = ++calls;
      try {
        if (call === 1) await hold.promise;
        guard();
        return { revision: 0, items: [] };
      } finally {
        active--;
      }
    },
    async add() {
      throw Error('unused');
    },
    async remove() {
      throw Error('unused');
    },
  };
  const model = new NativeTokens(f.source, () => runtime);
  const first = model.connect();
  await tick();
  f.change(B);
  const second = model.connect();
  first();
  await tick();
  assert.equal(calls, 1);
  hold.resolve();
  await tick();
  assert.equal(maximum, 1);
  assert.equal(model.getSnapshot().status, 'ready');
  assert.equal(model.getSnapshot().account?.address, B);
  second();
});

test('list deadline preserves unattempted rows as unknown and selected refresh preserves other observations', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const items = Array.from({ length: 12 }, (_, i) => ({
    ...metadata,
    contractAddress: '0x' + (i + 1).toString(16).padStart(40, '0'),
  }));
  const f = fixture({
    items,
    reader: {
      async readToken() {
        return { metadata, units: '0' };
      },
      async readBalance() {
        if (++calls <= 2) return new Promise(() => undefined);
        return { units: '42' };
      },
    },
  });
  const disconnect = f.model.connect();
  await tick();
  assert.equal(calls, 2);
  t.mock.timers.tick(15_000);
  await tick();
  const prior = f.model.getSnapshot();
  assert.equal(prior.items.filter((item) => item.status === 'error').length, 2);
  assert.equal(
    prior.items.filter((item) => item.status === 'unknown').length,
    10
  );
  await f.model.refresh(items[11]!.contractAddress);
  assert.equal(calls, 3);
  assert.equal(f.model.getSnapshot().items[11]!.units, '42');
  assert.deepEqual(
    f.model.getSnapshot().items.slice(0, 11),
    prior.items.slice(0, 11)
  );
  disconnect();
});
