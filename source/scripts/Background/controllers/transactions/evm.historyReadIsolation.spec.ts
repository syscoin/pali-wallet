/* eslint-disable camelcase -- Ethereum RPC fixture fields. */
import { retryableFetch } from '@sidhujag/sysweb3-network';

import { isEvmHistoryIncomplete } from '../../../../shared/evmHistory';

import EvmTransactionsController from './evm';

const OWNER = `0x${'11'.repeat(20)}`;
const OTHER_OWNER = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const TOKEN = `0x${'44'.repeat(20)}`;
const CHAIN = 1;
const API = 'https://explorer.example/api';
let mockVault: any;
const mockActions: any[] = [];

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({ vault: mockVault }),
    dispatch: (action: any) => {
      mockActions.push(action);
      const { type, id } = mockVault.activeAccount;
      const { property, value } = action.payload;
      mockVault = {
        ...mockVault,
        accounts: {
          ...mockVault.accounts,
          [type]: {
            ...mockVault.accounts[type],
            [id]: { ...mockVault.accounts[type][id], [property]: value },
          },
        },
      };
    },
  },
}));
jest.mock('state/vault', () => ({
  setActiveAccountProperty: (payload: any) => ({
    type: 'setActiveAccountProperty',
    payload,
  }),
}));
jest.mock('@sidhujag/sysweb3-network', () => ({
  retryableFetch: jest.fn(),
  INetworkType: { Ethereum: 'ethereum' },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({}));
jest.mock('./smartAccountHistory', () => ({}));
jest.mock('./utils', () => ({
  findUserTxsInProviderByBlocksRange: jest.fn(),
  validateAndManageUserTransactions: (transactions: any) => transactions,
}));
jest.mock('utils/tokenDiscovery', () => ({
  isRoutescanApiUrl: () => false,
  fetchRoutescan: jest.fn(),
}));

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const transaction = (digit: string, extra: any = {}) => ({
  hash: hash(digit),
  from: OWNER,
  to: RECIPIENT,
  value: '1000000000000000000',
  blockNumber: '123',
  timeStamp: String(Math.floor(Date.now() / 1000)),
  confirmations: '1',
  nonce: '8',
  input: '0x',
  ...extra,
});
const response = (result: any[], status = 200) =>
  ({
    ok: status === 200,
    status,
    json: async () => ({ status: '1', message: 'OK', result }),
  } as Response);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};
const poll = (
  provider: any = {},
  current?: () => boolean,
  signal?: AbortSignal
) =>
  EvmTransactionsController().pollingEvmTransactions(
    provider,
    true,
    false,
    current,
    signal
  );
const routeReplies = (
  pending: () => Promise<Response>,
  beforeReply: () => Promise<unknown> = async () => undefined
) =>
  jest.mocked(retryableFetch).mockImplementation(async (endpoint) => {
    await beforeReply();
    const action = new URL(String(endpoint)).searchParams.get('action');
    if (action === 'pendingtxlist') return pending();
    return response([
      transaction(
        action === 'txlist' ? 'a' : 'b',
        action === 'tokentx' ? { contractAddress: TOKEN } : {}
      ),
    ]);
  });

beforeEach(() => {
  jest.mocked(retryableFetch).mockReset();
  mockActions.length = 0;
  mockVault = {
    activeAccount: { id: 0, type: 'HDAccount' },
    activeNetwork: {
      chainId: CHAIN,
      url: 'https://rpc.example',
      apiUrl: API,
    },
    accountTransactions: { HDAccount: { 0: { ethereum: {} } } },
    accounts: {
      HDAccount: {
        0: {
          address: OWNER,
          balances: { ethereum: '1' },
          evmTxCountByChainId: { [CHAIN]: 7 },
        },
        1: {
          address: OTHER_OWNER,
          balances: { ethereum: '1' },
          evmTxCountByChainId: { [CHAIN]: 17 },
        },
      },
    },
  };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('keeps native, token and pending history when all feeds are healthy', async () => {
  routeReplies(async () => response([transaction('c')]));
  const result = await poll();
  expect(result.map((tx) => tx.hash).sort()).toEqual([
    hash('a'),
    hash('b'),
    hash('c'),
  ]);
  expect(mockVault.accounts.HDAccount[0].evmTxCountByChainId[CHAIN]).toBe(7);
  expect(mockActions).toHaveLength(1);
  expect(isEvmHistoryIncomplete(result)).toBe(false);
});

it.each([
  'transaction',
  'receipt',
  'header',
  'from',
  'to',
  'height',
  'healthy',
])(
  'publishes mined pending history only for coherent observations (%s)',
  async (kind) => {
    mockVault.activeNetwork.apiUrl = undefined;
    mockVault.accountTransactions.HDAccount[0].ethereum[CHAIN] = [
      {
        hash: hash('a'),
        from: OWNER,
        to: RECIPIENT,
        nonce: 8,
        blockNumber: null,
      },
    ];
    const tx = {
      ...transaction('a'),
      blockNumber: 123,
      blockHash: hash('d'),
      ...(kind === 'transaction' ? { hash: hash('b') } : {}),
    };
    const provider = {
      getTransaction: jest.fn(async () => tx),
      getTransactionReceipt: jest.fn(async () => ({
        transactionHash: kind === 'receipt' ? hash('b') : hash('a'),
        from: kind === 'from' ? OTHER_OWNER : OWNER,
        to: kind === 'to' ? TOKEN : RECIPIENT,
        blockNumber: kind === 'height' ? 124 : 123,
        blockHash: hash('d'),
        status: 1,
      })),
      getBlockNumber: jest.fn(async () => 124),
      getBlock: jest.fn(async () => ({
        number: 123,
        hash: kind === 'header' ? hash('e') : hash('d'),
        timestamp: 100,
      })),
    };
    const scan = jest.requireMock('./utils').findUserTxsInProviderByBlocksRange;
    scan.mockResolvedValue([]);
    const result = await poll(provider);
    expect(result.length).toBe(kind === 'healthy' ? 1 : 0);
    if (kind === 'healthy')
      expect(result[0]).toMatchObject({
        hash: hash('a'),
        blockNumber: 123,
        txreceipt_status: '1',
      });
    expect(provider.getTransaction).toHaveBeenCalledTimes(1);
    if (kind === 'healthy') {
      expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(1);
      expect(provider.getBlock).toHaveBeenCalledTimes(1);
      expect(provider.getBlockNumber).toHaveBeenCalledTimes(1);
    }
  }
);

it('preserves Smart discovery incompleteness through the final array merge', async () => {
  const history = jest.requireMock('./smartAccountHistory');
  history.fetchSmartAccountUserOpTransactions = jest.fn(async () =>
    jest
      .requireActual('../../../../shared/evmHistory')
      .markEvmHistoryIncomplete([])
  );
  mockVault.accounts.HDAccount[0].isSmartAccount = true;
  routeReplies(async () => response([]));
  const result = await poll();
  expect(result.length).toBeGreaterThan(0);
  expect(isEvmHistoryIncomplete(result)).toBe(true);
});

it('retains confirmed history when the optional pending fetch rejects', async () => {
  routeReplies(async () => {
    throw new Error('Optional endpoint unavailable');
  });
  const result = await poll();
  expect(result.map((tx) => tx.hash).sort()).toEqual([hash('a'), hash('b')]);
});

it.each([200, 404])(
  'retains confirmed history when optional pending JSON is malformed at HTTP %s',
  async (status) => {
    routeReplies(
      async () =>
        ({
          ok: status === 200,
          status,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON');
          },
        } as unknown as Response)
    );
    const result = await poll();
    expect(result.map((tx) => tx.hash).sort()).toEqual([hash('a'), hash('b')]);
  }
);

it('does not write the old owner history hint onto the newly selected owner', async () => {
  const gate = deferred<void>();
  routeReplies(
    async () => response([]),
    () => gate.promise
  );
  const result = poll();
  mockVault.activeAccount = { id: 1, type: 'HDAccount' };
  gate.resolve(undefined);
  await result;
  expect(mockVault.accounts.HDAccount[1].evmTxCountByChainId[CHAIN]).toBe(17);
});

it('does not write the old owner nonce probe onto the newly selected owner', async () => {
  const count = deferred<number>();
  mockVault.accounts.HDAccount[0].evmTxCountByChainId[CHAIN] = 0;
  routeReplies(async () => response([]));
  const getTransactionCount = jest.fn(() => count.promise);
  const result = poll({ getTransactionCount });
  expect(getTransactionCount).toHaveBeenCalledWith(OWNER);
  mockVault.activeAccount = { id: 1, type: 'HDAccount' };
  count.resolve(9);
  await result;
  expect(mockVault.accounts.HDAccount[1].evmTxCountByChainId[CHAIN]).toBe(17);
});

it('starts no explorer requests after its held pagination hint is retired', async () => {
  const count = deferred<number>();
  const owner = new AbortController();
  mockVault.accounts.HDAccount[0].evmTxCountByChainId[CHAIN] = 0;
  routeReplies(async () => response([]));
  const result = poll(
    { getTransactionCount: jest.fn(() => count.promise) },
    () => !owner.signal.aborted,
    owner.signal
  );
  owner.abort();
  count.resolve(9);
  await expect(result).rejects.toThrow('History context changed');
  expect(retryableFetch).not.toHaveBeenCalled();
  expect(mockActions).toHaveLength(0);
});

it('binds all healthy explorer requests to their history owner', async () => {
  const owner = new AbortController();
  mockVault.accounts.HDAccount[0].evmTxCountByChainId[CHAIN] = 0;
  routeReplies(async () => response([]));
  await poll(
    { getTransactionCount: jest.fn(async () => 9) },
    () => true,
    owner.signal
  );
  expect(retryableFetch).toHaveBeenCalledTimes(3);
  const signal = jest.mocked(retryableFetch).mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(false);
  for (const [, options] of jest.mocked(retryableFetch).mock.calls)
    expect(options?.signal).toBe(signal);
});

it.each(['headers', 'body'])(
  'keeps the explorer deadline through %s consumption',
  async (stage) => {
    jest.useFakeTimers();
    let observed!: AbortSignal;
    const held = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    jest
      .mocked(retryableFetch)
      .mockImplementation(async (endpoint, options) => {
        observed = options!.signal!;
        if (new URL(String(endpoint)).searchParams.get('action') !== 'txlist')
          return response([]);
        if (stage === 'headers') return held(observed);
        return { ...response([]), json: () => held(observed) };
      });
    try {
      const result = poll().catch((error) => error);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(observed.aborted).toBe(true);
      expect(await result).toBeInstanceOf(Error);
    } finally {
      jest.useRealTimers();
    }
  }
);

it('keeps probing and using pending transactions after a malformed optional reply', async () => {
  let pendingReads = 0;
  routeReplies(async () => {
    pendingReads += 1;
    if (pendingReads === 1)
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response;
    return response([transaction('c')]);
  });
  expect((await poll()).map((tx) => tx.hash).sort()).toEqual([
    hash('a'),
    hash('b'),
  ]);
  expect((await poll()).map((tx) => tx.hash).sort()).toEqual([
    hash('a'),
    hash('b'),
    hash('c'),
  ]);
  expect(pendingReads).toBe(2);
  expect(retryableFetch).toHaveBeenCalledTimes(6);
});

it('does not borrow the active account count or balance for another requested address', async () => {
  routeReplies(async () => response([]));
  await EvmTransactionsController().fetchTransactionsFromAPI(
    OTHER_OWNER,
    CHAIN,
    API
  );
  expect(mockActions).toHaveLength(0);
  for (const [endpoint] of jest.mocked(retryableFetch).mock.calls) {
    const url = new URL(String(endpoint));
    expect(url.searchParams.get('address')).toBe(OTHER_OWNER);
    expect(url.searchParams.has('offset')).toBe(false);
  }
});

it('does not write an old hint into a replaced record at the same account slot and address', async () => {
  const gate = deferred<void>();
  routeReplies(
    async () => response([]),
    () => gate.promise
  );
  const result = poll();
  mockVault.accounts.HDAccount[0] = {
    ...mockVault.accounts.HDAccount[0],
    evmTxCountByChainId: { [CHAIN]: 31 },
  };
  gate.resolve(undefined);
  await result;
  expect(mockVault.accounts.HDAccount[0].evmTxCountByChainId[CHAIN]).toBe(31);
  expect(mockActions).toHaveLength(0);
});

it('updates healthy matching-account probe hints without dropping another chain count', async () => {
  mockVault.accounts.HDAccount[0].evmTxCountByChainId = {
    [CHAIN]: 0,
    57: 41,
  };
  routeReplies(async () => response([]));
  await poll({ getTransactionCount: jest.fn().mockResolvedValue(9) });
  expect(mockVault.accounts.HDAccount[0].evmTxCountByChainId).toEqual({
    [CHAIN]: 9,
    57: 41,
  });
  expect(mockActions).toHaveLength(2);
});

it.each(['txlist'])(
  'still surfaces malformed JSON in the required %s feed',
  async (requiredAction) => {
    routeReplies(async () => response([]));
    const original = jest.mocked(retryableFetch).getMockImplementation()!;
    jest
      .mocked(retryableFetch)
      .mockImplementation(async (endpoint, options) => {
        if (
          new URL(String(endpoint)).searchParams.get('action') ===
          requiredAction
        )
          return {
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError('Required feed malformed');
            },
          } as unknown as Response;
        return original(endpoint, options);
      });
    await expect(poll()).rejects.toThrow('Required feed malformed');
  }
);

it.each(['json', 'http', 'schema', 'api'])(
  'retains healthy base and pending history when the optional token feed fails (%s)',
  async (failure) => {
    routeReplies(async () => response([transaction('c')]));
    const original = jest.mocked(retryableFetch).getMockImplementation()!;
    jest.mocked(retryableFetch).mockImplementation(async (endpoint, options) =>
      new URL(String(endpoint)).searchParams.get('action') === 'tokentx'
        ? ({
            ok: failure !== 'http',
            status: failure === 'http' ? 503 : 200,
            json: async () => {
              if (failure === 'json') throw SyntaxError('Malformed token JSON');
              return failure === 'api'
                ? { status: '0', result: 'Rate limit' }
                : { status: '1', result: 'invalid' };
            },
          } as Response)
        : original(endpoint, options)
    );
    const result = await poll();
    expect(result.map((tx) => tx.hash).sort()).toEqual([hash('a'), hash('c')]);
    expect(isEvmHistoryIncomplete(result)).toBe(true);
    expect(Object.keys(result)).toEqual(['0', '1']);
  }
);
