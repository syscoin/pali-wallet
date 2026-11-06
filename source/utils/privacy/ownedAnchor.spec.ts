import { Interface, parseEther, toQuantity } from 'ethers';

import { verifySnapshotAnchor } from './client.ts';
import { createOwnedSnapshotAnchor } from './ownedAnchor.ts';
import type { PrivacyAnchorRead } from './publicSyncProtocol.ts';
import { getPrivacyPool } from './registry.ts';
import type { PrivacySnapshot } from './types.ts';

const poolId = 'eth-1';
const poolAddress = getPrivacyPool(poolId).address;
const rpcUrl = 'https://rpc.example/ethereum?network=main';
const word = (n: string) => `0x${n.padStart(64, '0')}`;
const snapshot: PrivacySnapshot = {
  version: 1,
  chainId: 1,
  poolAddress,
  asOfBlockNumber: 20_000_000,
  asOfBlockHash: word('abc'),
  leafCount: 1,
  root: word('1'),
  leaves: [word('1')],
  withdrawnNullifiers: [],
};
const abi = new Interface([
  'function nextIndex() view returns (uint32)',
  'function getLastRoot() view returns (bytes32)',
  'function levels() view returns (uint32)',
  'function denomination() view returns (uint256)',
  'function isKnownRoot(bytes32) view returns (bool)',
]);
const order: PrivacyAnchorRead[] = [
  'chainId',
  'block',
  'nextIndex',
  'getLastRoot',
  'levels',
  'denomination',
  'block',
  'isKnownRoot',
];
const block = {
  number: toQuantity(snapshot.asOfBlockNumber),
  hash: snapshot.asOfBlockHash,
  timestamp: '0x65000000',
};

function deferred() {
  let resolve: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: resolve! };
}

function resultFor(read: PrivacyAnchorRead): unknown {
  if (read === 'chainId') return '0x1';
  if (read === 'block') return block;
  return abi.encodeFunctionResult(read, [
    {
      nextIndex: snapshot.leafCount,
      getLastRoot: snapshot.root,
      levels: 20,
      denomination: parseEther('1'),
      isKnownRoot: true,
    }[read],
  ]);
}

function reply(id: number, result: unknown, bytes?: number) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
  return new Response(bytes ? payload.padEnd(bytes) : payload);
}

type Owner = Parameters<typeof createOwnedSnapshotAnchor>[3];
type Hooks = {
  beforeDispatch?: (
    read: PrivacyAnchorRead,
    signal: AbortSignal
  ) => Promise<void>;
  release?: (read: PrivacyAnchorRead) => Promise<void>;
  result?: (read: PrivacyAnchorRead, id: number) => Response;
};

function fixture(hooks: Hooks = {}) {
  const abort = new AbortController();
  const calls: PrivacyAnchorRead[] = [];
  const ids: number[] = [];
  const bindings: Parameters<Owner['prepare']>[0][] = [];
  const released: PrivacyAnchorRead[] = [];
  let active = false;
  let current = true;
  const prepare: Owner['prepare'] = (binding, read, id, signal) => {
    expect(active).toBe(false);
    active = true;
    bindings.push(binding);
    return {
      async start(check) {
        await hooks.beforeDispatch?.(read, signal);
        check();
        calls.push(read);
        ids.push(id);
        return hooks.result?.(read, id) ?? reply(id, resultFor(read));
      },
      async release() {
        await hooks.release?.(read);
        expect(active).toBe(true);
        active = false;
        released.push(read);
      },
    };
  };
  const options: Owner = {
    timeoutMs: 5_000,
    signal: abort.signal,
    assertCurrent() {
      if (!current) throw new Error('privacy_cancelled');
    },
    prepare: jest.fn(prepare),
  };
  return {
    options,
    abort,
    calls,
    ids,
    bindings,
    released,
    stale: () => {
      current = false;
    },
  };
}

const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = jest.fn(async () => {
    throw new Error('ambient fetch forbidden');
  });
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('uses the actual verifier twice with exact order, bounded replies and one captured binding', async () => {
  const f = fixture({
    result: (read, id) =>
      reply(
        id,
        resultFor(read),
        read === 'block' ? 4 * 1024 * 1024 : 64 * 1024
      ),
  });
  const input = { ...snapshot };
  const owner = createOwnedSnapshotAnchor(poolId, input, rpcUrl, f.options);
  const signal = () => new AbortController().signal;
  try {
    await expect(owner.verify(signal())).resolves.toEqual({
      blockTimestamp: 1694498816000,
    });
    input.asOfBlockNumber++;
    input.asOfBlockHash = word('eee');
    input.root = word('ddd');
    input.leafCount++;
    await expect(owner.verify(signal())).resolves.toEqual({
      blockTimestamp: 1694498816000,
    });
    await expect(owner.verify(signal())).rejects.toThrow('privacy_cancelled');
    expect(f.calls).toEqual([...order, ...order]);
    expect(f.released).toEqual(f.calls);
    expect(new Set(f.ids).size).toBe(16);
    expect(new Set(f.bindings).size).toBe(1);
    expect(Object.isFrozen(f.bindings[0])).toBe(true);
    expect(f.bindings[0]).toEqual({
      rpcUrl,
      poolAddress,
      blockNumber: snapshot.asOfBlockNumber,
      root: snapshot.root,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {
    owner.close();
  }
});

it.each([
  [
    'wrong JSON-RPC ID',
    'privacy_rpc_unavailable',
    (id: number) => reply(id + 1, resultFor('nextIndex')),
  ],
  ['malformed ABI', 'invalid length', (id: number) => reply(id, '0x01')],
  [
    'oversized reply',
    'privacy_data_invalid',
    (id: number) => reply(id, resultFor('nextIndex'), 64 * 1024 + 1),
  ],
] as const)(
  'rejects %s through the shared parser without starting any scalar sibling',
  async (_name, error, badReply) => {
    const f = fixture({
      result: (read, id) =>
        read === 'nextIndex' ? badReply(id) : reply(id, resultFor(read)),
    });
    const owner = createOwnedSnapshotAnchor(
      poolId,
      snapshot,
      rpcUrl,
      f.options
    );
    await expect(owner.verify(new AbortController().signal)).rejects.toThrow(
      error
    );
    expect(f.calls).toEqual(order.slice(0, 3));
    expect(f.released).toEqual(f.calls);
    expect(global.fetch).not.toHaveBeenCalled();
  }
);

it('rejects a second block bracket mismatch using the existing verifier', async () => {
  let blocks = 0;
  const f = fixture({
    result: (read, id) =>
      reply(
        id,
        read === 'block' && ++blocks === 2
          ? { ...block, hash: word('def') }
          : resultFor(read)
      ),
  });
  const owner = createOwnedSnapshotAnchor(poolId, snapshot, rpcUrl, f.options);
  await expect(owner.verify(new AbortController().signal)).rejects.toThrow(
    'privacy_anchor_changed'
  );
  expect(f.calls).toEqual(order.slice(0, -1));
  expect(f.released).toEqual(f.calls);
});

it('rechecks the owner at a late native start and retires without issuing another read', async () => {
  const entered = deferred();
  const resume = deferred();
  const f = fixture({
    async beforeDispatch(read) {
      if (read !== 'nextIndex') return;
      entered.resolve();
      await resume.promise;
    },
  });
  const owner = createOwnedSnapshotAnchor(poolId, snapshot, rpcUrl, f.options);
  const pending = owner.verify(new AbortController().signal);
  await entered.promise;
  f.stale();
  resume.resolve();
  await expect(pending).rejects.toThrow('privacy_cancelled');
  expect(f.calls).toEqual(['chainId', 'block']);
  expect(f.released).toEqual(order.slice(0, 3));
});

it('holds the slot during release and checks the owner again before a sibling can start', async () => {
  const entered = deferred();
  const resume = deferred();
  const f = fixture({
    async release(read) {
      if (read !== 'nextIndex') return;
      entered.resolve();
      await resume.promise;
    },
  });
  const owner = createOwnedSnapshotAnchor(poolId, snapshot, rpcUrl, f.options);
  const signal = new AbortController().signal;
  const pending = owner.verify(signal);
  await entered.promise;
  await expect(owner.verify(signal)).rejects.toThrow('privacy_cancelled');
  expect(f.calls).toEqual(order.slice(0, 3));
  f.stale();
  resume.resolve();
  await expect(pending).rejects.toThrow('privacy_cancelled');
  expect(f.released).toEqual(f.calls);
});

it.each(['request abort', 'aggregate timeout'] as const)(
  'handles %s during a held start, releases the exact handle and ignores its late result',
  async (mode) => {
    jest.useFakeTimers();
    const entered = deferred();
    const resume = deferred();
    const released = deferred();
    const f = fixture({
      async beforeDispatch(read) {
        if (read !== 'nextIndex') return;
        entered.resolve();
        await resume.promise;
      },
      async release(read) {
        if (read === 'nextIndex') released.resolve();
      },
    });
    const owner = createOwnedSnapshotAnchor(poolId, snapshot, rpcUrl, {
      ...f.options,
      timeoutMs: 10,
    });
    const request = new AbortController();
    const rejected = expect(owner.verify(request.signal)).rejects.toThrow(
      'privacy_cancelled'
    );
    await entered.promise;
    if (mode === 'request abort') request.abort();
    else await jest.advanceTimersByTimeAsync(10);
    await rejected;
    await released.promise;
    resume.resolve();
    await expect(owner.verify(new AbortController().signal)).rejects.toThrow(
      'privacy_cancelled'
    );
    expect(f.calls).toEqual(order.slice(0, 2));
    expect(f.released).toEqual(order.slice(0, 3));
  }
);

it('expires independently while release is held and never reopens that owner', async () => {
  jest.useFakeTimers();
  const entered = deferred();
  const resume = deferred();
  const f = fixture({
    async release(read) {
      if (read !== 'nextIndex') return;
      entered.resolve();
      await resume.promise;
    },
  });
  const owner = createOwnedSnapshotAnchor(poolId, snapshot, rpcUrl, {
    ...f.options,
    timeoutMs: 10,
  });
  const signal = new AbortController().signal;
  const rejected = expect(owner.verify(signal)).rejects.toThrow(
    'privacy_cancelled'
  );
  await entered.promise;
  await jest.advanceTimersByTimeAsync(10);
  await rejected;
  await expect(owner.verify(signal)).rejects.toThrow('privacy_cancelled');
  expect(f.calls).toEqual(order.slice(0, 3));
  expect(f.released).toEqual(order.slice(0, 2));
  resume.resolve();
  await jest.advanceTimersByTimeAsync(0);
  expect(f.released).toEqual(f.calls);
});

it('does not reset the aggregate deadline between verifier passes', async () => {
  jest.useFakeTimers();
  const f = fixture();
  const owner = createOwnedSnapshotAnchor(poolId, snapshot, rpcUrl, {
    ...f.options,
    timeoutMs: 10,
  });
  const signal = new AbortController().signal;
  await owner.verify(signal);
  await jest.advanceTimersByTimeAsync(10);
  await expect(owner.verify(signal)).rejects.toThrow('privacy_cancelled');
  expect(f.calls).toEqual(order);
});

it('refuses unsafe endpoints and nonmatching snapshot identity before transport', async () => {
  const f = fixture();
  expect(() =>
    createOwnedSnapshotAnchor(poolId, snapshot, 'http://localhost', f.options)
  ).toThrow('privacy_rpc_unavailable');
  expect(() =>
    createOwnedSnapshotAnchor(
      poolId,
      { ...snapshot, poolAddress: word('2') },
      rpcUrl,
      f.options
    )
  ).toThrow('privacy_data_invalid');
  expect(f.options.prepare).not.toHaveBeenCalled();
  const owner = createOwnedSnapshotAnchor(poolId, snapshot, rpcUrl, {
    ...f.options,
    async assertCurrent() {
      throw new Error('async guard');
    },
  });
  await expect(owner.verify(new AbortController().signal)).rejects.toThrow(
    'privacy_cancelled'
  );
  expect(f.options.prepare).not.toHaveBeenCalled();
});

it('still sends all four default extension scalar requests in parallel while the first is held', async () => {
  const entered = deferred();
  const resume = deferred();
  const calls: PrivacyAnchorRead[] = [];
  global.fetch = jest.fn(async (url, init) => {
    expect(url).toBe(rpcUrl);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
    });
    const request = JSON.parse(String(init?.body));
    const read =
      request.method === 'eth_chainId'
        ? 'chainId'
        : request.method === 'eth_getBlockByNumber'
        ? 'block'
        : (abi.parseTransaction({ data: request.params[0].data })!
            .name as PrivacyAnchorRead);
    calls.push(read);
    if (read === 'nextIndex') {
      entered.resolve();
      await resume.promise;
    }
    return reply(request.id, resultFor(read));
  });
  const result = verifySnapshotAnchor(
    poolId,
    snapshot,
    rpcUrl,
    new AbortController().signal
  );
  await entered.promise;
  expect(calls).toEqual(order.slice(0, 6));
  resume.resolve();
  await expect(result).resolves.toEqual({ blockTimestamp: 1694498816000 });
  expect(calls).toEqual(order);
});
