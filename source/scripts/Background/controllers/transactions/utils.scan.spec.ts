import { findUserTxsInProviderByBlocksRange } from './utils';

let scope: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: scope }) },
}));
const hash = (number: number, fork = 0) =>
  `0x${BigInt(number + 1 + fork * 10000)
    .toString(16)
    .padStart(64, '0')}`;
const hex = (number: number) => `0x${number.toString(16)}`;
const fixture = () => {
  let tip = 20;
  let fork = 0;
  let stalled = false;
  const abort = new AbortController();
  const provider = {
    signal: abort.signal,
    readMany: jest.fn(async (requests: any[], options: any) => {
      if (stalled)
        return new Promise<any[]>((_, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(options.signal.reason),
            { once: true }
          );
        });
      return requests.map(({ method, params }) => {
        if (method === 'eth_chainId')
          return { status: 'fulfilled', value: '0x1' };
        const number = params[0] === 'latest' ? tip : Number(BigInt(params[0]));
        return {
          status: 'fulfilled',
          value: {
            number: hex(number),
            hash: hash(number, fork),
            parentHash: hash(number - 1, fork),
            timestamp: hex(1700000000 + number),
            transactions: params[1]
              ? [
                  {
                    hash: hash(number + 100),
                    from: 'owner',
                    to: 'other',
                    chainId: '0x1',
                    blockNumber: hex(number),
                    nonce: '0x0',
                  },
                ]
              : [],
          },
        };
      });
    }),
  };
  const scan = (depth = 10, current?: () => boolean) =>
    findUserTxsInProviderByBlocksRange(provider as any, depth, current);
  const fullReads = () =>
    provider.readMany.mock.calls
      .flatMap(([requests]) => requests)
      .filter(
        ({ method, params }) => method === 'eth_getBlockByNumber' && params[1]
      );
  return {
    provider,
    scan,
    fullReads,
    abort,
    advance: () => {
      tip++;
    },
    reorg: () => {
      fork++;
    },
    stall: () => {
      stalled = true;
    },
  };
};
beforeEach(() => {
  jest.useFakeTimers();
  scope = {
    isBitcoinBased: false,
    activeNetwork: { chainId: 1, url: 'https://rpc.example/' },
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: { HDAccount: { 0: { address: 'owner' } } },
  };
});
afterEach(() => jest.useRealTimers());

it('reuses a canonical same-head window and fetches only a new block on advance', async () => {
  const f = fixture();
  expect(await f.scan()).toHaveLength(11);
  expect(f.fullReads()).toHaveLength(11);
  expect(await f.scan()).toHaveLength(11);
  expect(f.fullReads()).toHaveLength(11);
  f.advance();
  const rows = await f.scan();
  expect(rows).toHaveLength(11);
  expect(f.fullReads()).toHaveLength(12);
  expect(rows[0].confirmations).toBe(10);
});
it('invalidates bodies on a reorg and fills a deeper requested range', async () => {
  const f = fixture();
  await f.scan(5);
  await f.scan(10);
  expect(f.fullReads()).toHaveLength(11);
  f.reorg();
  await f.scan(10);
  expect(f.fullReads()).toHaveLength(22);
});
it('does not reuse another network or account scope', async () => {
  const f = fixture();
  await f.scan();
  scope.activeNetwork = {
    ...scope.activeNetwork,
    url: 'https://other.example/',
  };
  await f.scan();
  expect(f.fullReads()).toHaveLength(22);
  scope.activeAccount = { type: 'HDAccount', id: 1 };
  scope.accounts.HDAccount[1] = { address: 'other-owner' };
  await f.scan();
  expect(f.fullReads()).toHaveLength(33);
});
it('rejects a changed owner during the read without caching its result', async () => {
  const f = fixture();
  let current = true;
  const original = f.provider.readMany.getMockImplementation()!;
  f.provider.readMany.mockImplementation(async (...args) => {
    const result = await original(...args);
    current = false;
    return result;
  });
  await expect(f.scan(10, () => current)).rejects.toThrow(
    'History context changed'
  );
  f.provider.readMany.mockImplementation(original);
  expect(await f.scan()).toHaveLength(11);
});
it('rejects per-item failures without accepting incomplete history', async () => {
  const f = fixture();
  const original = f.provider.readMany.getMockImplementation()!;
  f.provider.readMany.mockImplementation(async (...args) => {
    const results = await original(...args);
    if (args[0].some(({ params }) => params[1]))
      results[0] = { status: 'rejected', reason: new Error('rate limited') };
    return results;
  });
  await expect(f.scan()).rejects.toThrow('rate limited');
});
it('aborts stalled reads at the total deadline and on provider cancellation', async () => {
  const f = fixture();
  f.stall();
  const first = expect(f.scan()).rejects.toThrow('History refresh timed out');
  await jest.advanceTimersByTimeAsync(20000);
  await first;
  const second = expect(f.scan()).rejects.toThrow('provider closed');
  f.abort.abort(new Error('provider closed'));
  await second;
  expect(jest.getTimerCount()).toBe(0);
});

it('refreshes expired bodies and rejects a chain change before accepting cached observations', async () => {
  const f = fixture();
  await f.scan();
  await jest.advanceTimersByTimeAsync(60000);
  await f.scan();
  expect(f.fullReads()).toHaveLength(22);
  const original = f.provider.readMany.getMockImplementation()!;
  f.provider.readMany.mockImplementation(async (...args) => {
    const rows = await original(...args);
    if (args[0][0].method === 'eth_chainId')
      return [{ status: 'fulfilled', value: '0x2' }];
    return rows;
  });
  await expect(f.scan()).rejects.toThrow('History network changed');
});

it('rejects a reorg after the full block bodies were read', async () => {
  const f = fixture();
  const original = f.provider.readMany.getMockImplementation()!;
  let switched = false;
  f.provider.readMany.mockImplementation(async (...args) => {
    const rows = await original(...args);
    if (!switched && args[0].some(({ params }) => params[1])) {
      switched = true;
      f.reorg();
    }
    return rows;
  });
  await expect(f.scan()).rejects.toThrow('History block chain changed');
});

it('treats failed reads as retryable next refresh without retaining partial coverage', async () => {
  const f = fixture();
  const original = f.provider.readMany.getMockImplementation()!;
  let fail = true;
  f.provider.readMany.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (fail && args[0].some(({ params }) => params[1])) {
      fail = false;
      result[0] = {
        status: 'rejected',
        reason: new Error('temporary failure'),
      };
    }
    return result;
  });
  await expect(f.scan()).rejects.toThrow('temporary failure');
  expect(await f.scan()).toHaveLength(11);
  expect(f.fullReads()).toHaveLength(16);
});
