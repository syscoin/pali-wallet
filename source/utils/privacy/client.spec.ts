import { Interface, parseEther, toQuantity } from 'ethers';

import {
  fetchPrivacySnapshot,
  validateSnapshot,
  verifySnapshotAnchor,
} from './client';
import { advanceMerkleWork, createMerkleWork } from './merkle';
import { getPrivacyPool } from './registry';
import { PrivacySnapshot } from './types';

const id = 'eth-0.1';
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const leaves = [hash(1), hash(2)];
const snapshot: PrivacySnapshot = {
  withdrawnNullifiers: [],
  version: 1,
  chainId: 1,
  poolAddress: getPrivacyPool(id).address,
  asOfBlockNumber: 20000000,
  asOfBlockHash: hash(99),
  leafCount: 2,
  leaves,
  root: advanceMerkleWork(createMerkleWork(), leaves).root!,
};
const abi = new Interface([
  'function nextIndex() view returns (uint32)',
  'function getLastRoot() view returns (bytes32)',
  'function levels() view returns (uint32)',
  'function denomination() view returns (uint256)',
  'function isKnownRoot(bytes32) view returns (bool)',
]);
const signal = () => new AbortController().signal;
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function mockRpc(
  options: {
    chain?: string;
    changedHash?: boolean;
    changedTimestamp?: boolean;
    count?: number;
    expired?: boolean;
    timestamp?: unknown;
    transactions?: number;
    wrongId?: boolean;
  } = {}
) {
  let headers = 0;
  const fetch = jest.fn(async (_url, init) => {
    const request = JSON.parse(init.body);
    let result: unknown;
    if (request.method === 'eth_chainId') result = options.chain || '0x1';
    else if (request.method === 'eth_getBlockByNumber') {
      headers++;
      result = {
        number: toQuantity(snapshot.asOfBlockNumber),
        timestamp:
          options.changedTimestamp && headers > 1
            ? '0x65000001'
            : Object.prototype.hasOwnProperty.call(options, 'timestamp')
            ? options.timestamp
            : '0x65000000',
        hash:
          options.changedHash && headers > 1
            ? hash(100)
            : snapshot.asOfBlockHash,
        transactions: Array.from(
          { length: options.transactions || 0 },
          (_, index) => hash(index)
        ),
      };
    } else if (request.method === 'eth_call') {
      const fn = abi.parseTransaction({ data: request.params[0].data })!.name;
      const values = {
        nextIndex: options.count ?? 2,
        getLastRoot: snapshot.root,
        levels: 20,
        denomination: parseEther('0.1'),
        isKnownRoot: !options.expired,
      };
      result = abi.encodeFunctionResult(fn, [values[fn]]);
    } else throw new Error('Unexpected RPC method');
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: options.wrongId ? request.id + 1 : request.id,
        result,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  });
  global.fetch = fetch;
  return fetch;
}

test('validates the entire fixed-pool snapshot, not a server-selected address', () => {
  expect(validateSnapshot(id, snapshot)).toEqual(snapshot);
  expect(() =>
    validateSnapshot(id, { ...snapshot, poolAddress: '0x' + '11'.repeat(20) })
  ).toThrow();
});

test('server-added progress or endpoint fields cannot change snapshot interpretation', () => {
  const clean = validateSnapshot(id, {
    ...snapshot,
    phase: 'syncing',
    rpcUrl: 'https://attacker.example',
  });
  expect(clean).toEqual(snapshot);
  expect(clean).not.toHaveProperty('phase');
  expect(clean).not.toHaveProperty('rpcUrl');
});

test.each([
  { chainId: 57 },
  { version: 2 },
  { leafCount: 1 },
  { leafCount: 2 ** 20 + 1 },
  { asOfBlockNumber: 1 },
  { asOfBlockHash: 'bad' },
  { root: hash(0).toUpperCase() },
  { leaves: [hash(1), '0x' + 'ff'.repeat(32)] },
  { leaves: null },
  { withdrawnNullifiers: undefined },
  { withdrawnNullifiers: null },
  { withdrawnNullifiers: [hash(1), hash(2), hash(3)] },
  { withdrawnNullifiers: [hash(1), hash(1)] },
  { withdrawnNullifiers: [hash(1).toUpperCase()] },
  { withdrawnNullifiers: ['0x' + 'ff'.repeat(32)] },
  { withdrawnNullifiers: [hash(1) + '\n'] },
  { withdrawnNullifiers: [hash(1) + '\r'] },
  { withdrawnNullifiers: [123] },
  { leaves: [hash(1), hash(2) + '\n'] },
  { root: snapshot.root + '\n' },
])('rejects malformed or cross-context data: %j', (change) => {
  expect(() => validateSnapshot(id, { ...snapshot, ...change })).toThrow(
    'privacy_data_invalid'
  );
});

test('only sends a public pool identifier to Sysnode, without cookies or wallet data', async () => {
  const fetch = jest.fn<
    ReturnType<typeof global.fetch>,
    Parameters<typeof global.fetch>
  >(async () => new Response(JSON.stringify(snapshot)));
  global.fetch = fetch;
  expect(await fetchPrivacySnapshot(id, signal())).toEqual(snapshot);
  expect(fetch).toHaveBeenCalledWith(
    'https://sysnode.info/api/privacy/v1/pools/eth-0.1/snapshot',
    expect.objectContaining({ credentials: 'omit', redirect: 'error' })
  );
  expect(fetch.mock.calls[0][1]).not.toHaveProperty('body');
});

test('the selected local privacy service receives the same public-only request', async () => {
  const fetch = jest.fn<
    ReturnType<typeof global.fetch>,
    Parameters<typeof global.fetch>
  >(async () => new Response(JSON.stringify(snapshot)));
  global.fetch = fetch;
  expect(
    await fetchPrivacySnapshot(id, signal(), 'http://127.0.0.1:8800')
  ).toEqual(snapshot);
  expect(fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8800/api/privacy/v1/pools/eth-0.1/snapshot',
    expect.objectContaining({ credentials: 'omit', redirect: 'error' })
  );
  expect(fetch.mock.calls[0][1]).not.toHaveProperty('body');
});

test('accepts bounded cold-index progress, not an incomplete empty snapshot', async () => {
  const data = {
    phase: 'syncing',
    startBlock: 9116966,
    scannedBlock: 9116965,
    targetBlock: 9116965,
  };
  global.fetch = jest.fn(
    async () => new Response(JSON.stringify(data), { status: 202 })
  );
  expect(await fetchPrivacySnapshot(id, signal())).toEqual(data);
});

test('declared oversized and invalid JSON responses are refused', async () => {
  global.fetch = jest.fn(
    async () =>
      new Response('{}', {
        headers: { 'Content-Length': String(100 * 1024 * 1024) },
      })
  );
  await expect(fetchPrivacySnapshot(id, signal())).rejects.toThrow(
    'privacy_data_invalid'
  );
  global.fetch = jest.fn(async () => new Response('<html>not JSON</html>'));
  await expect(fetchPrivacySnapshot(id, signal())).rejects.toThrow();
});

test('independently checks block hash, leaf count, pool parameters and accepted root', async () => {
  const fetch = mockRpc();
  expect(
    await verifySnapshotAnchor(id, snapshot, 'https://rpc.example/', signal())
  ).toEqual({
    blockTimestamp: Number(BigInt('0x65000000')) * 1000,
  });
  expect(
    fetch.mock.calls.every(([url]) => url === 'https://rpc.example/')
  ).toBe(true);
  const calls = fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(
    calls.filter((item) => item.method === 'eth_getBlockByNumber')
  ).toHaveLength(2);
  expect(calls.filter((item) => item.method === 'eth_call')).toHaveLength(5);
  expect(calls.some((item) => item.method === 'eth_sendRawTransaction')).toBe(
    false
  );
});

test('verifies busy block anchors whose transaction hashes exceed 64 KiB', async () => {
  mockRpc({ transactions: 1100 });
  await expect(
    verifySnapshotAnchor(id, snapshot, 'https://rpc.example/', signal())
  ).resolves.toEqual({
    blockTimestamp: Number(BigInt('0x65000000')) * 1000,
  });
});

test.each(['eth_chainId', 'eth_call'])(
  'keeps the 64 KiB bound for scalar %s replies',
  async (method) => {
    const healthy = mockRpc();
    global.fetch = jest.fn(async (url, init) => {
      if (JSON.parse(init!.body as string).method === method)
        return new Response(' '.repeat(64 * 1024 + 1));
      return healthy(url, init);
    });
    await expect(
      verifySnapshotAnchor(id, snapshot, 'https://rpc.example/', signal())
    ).rejects.toThrow('privacy_data_invalid');
  }
);

test.each([true, false])(
  'rejects oversized block replies with declared length=%s',
  async (declared) => {
    const healthy = mockRpc();
    global.fetch = jest.fn(async (url, init) => {
      if (JSON.parse(init!.body as string).method === 'eth_getBlockByNumber')
        return new Response(' '.repeat(4 * 1024 * 1024 + 1), {
          headers: declared
            ? { 'Content-Length': String(4 * 1024 * 1024 + 1) }
            : {},
        });
      return healthy(url, init);
    });
    await expect(
      verifySnapshotAnchor(id, snapshot, 'https://rpc.example/', signal())
    ).rejects.toThrow('privacy_data_invalid');
  }
);

test.each([
  [{ chain: '0x39' }, 'privacy_wrong_chain'],
  [{ count: 3 }, 'privacy_verification_failed'],
  [{ changedHash: true }, 'privacy_anchor_changed'],
  [{ expired: true }, 'privacy_snapshot_stale'],
  [{ wrongId: true }, 'privacy_rpc_unavailable'],
] as const)(
  'rejects invalid independent chain evidence: %j',
  async (options, error) => {
    mockRpc(options);
    await expect(
      verifySnapshotAnchor(id, snapshot, 'https://rpc.example/', signal())
    ).rejects.toThrow(error);
  }
);

test.each([
  undefined,
  null,
  1700000000,
  '',
  '0x',
  '0x0',
  '0x01',
  '0xABC',
  '0x65000000\n',
  '0x65000000 ',
  '0x20000000000000',
])(
  'rejects malformed block timestamps instead of inventing freshness: %p',
  async (timestamp) => {
    mockRpc({ timestamp });
    await expect(
      verifySnapshotAnchor(id, snapshot, 'https://rpc.example/', signal())
    ).rejects.toThrow('privacy_rpc_unavailable');
  }
);

test('a changed timestamp at the same block/hash invalidates its anchor', async () => {
  mockRpc({ changedTimestamp: true });
  await expect(
    verifySnapshotAnchor(id, snapshot, 'https://rpc.example/', signal())
  ).rejects.toThrow('privacy_anchor_changed');
});
