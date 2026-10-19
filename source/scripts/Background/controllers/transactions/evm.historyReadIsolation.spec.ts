import { retryableFetch } from '@sidhujag/sysweb3-network';

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
const poll = (provider: any = {}) =>
  EvmTransactionsController().pollingEvmTransactions(provider, true);
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

it.each(['txlist', 'tokentx'])(
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
