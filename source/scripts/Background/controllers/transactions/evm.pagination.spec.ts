import { retryableFetch } from '@sidhujag/sysweb3-network';

import { EVM_TRANSACTION_HISTORY_SOURCE } from 'utils/evmNonce';

import EvmTransactionsController from './evm';

let mockHint: number | undefined;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      vault: {
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: {
          HDAccount: {
            0: { evmTxCountByChainId: { 1: mockHint } },
          },
        },
      },
    }),
    dispatch: jest.fn(),
  },
}));
jest.mock('state/vault', () => ({ setActiveAccountProperty: jest.fn() }));
jest.mock('@sidhujag/sysweb3-network', () => ({
  retryableFetch: jest.fn(),
  INetworkType: { Ethereum: 'ethereum' },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({}));
jest.mock('./smartAccountHistory', () => ({}));
jest.mock('./utils', () => ({}));
jest.mock('utils/tokenDiscovery', () => ({
  isRoutescanApiUrl: () => false,
  fetchRoutescan: jest.fn(),
}));

const ADDRESS = `0x${'11'.repeat(20)}`;
const SENDER = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const API = 'https://explorer.example/api?apikey=synthetic-key';
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const event = (digit: string, fields: any = {}) => ({
  hash: hash(digit),
  from: SENDER,
  to: ADDRESS,
  contractAddress: TOKEN,
  value: '1000000',
  blockNumber: '123',
  timeStamp: String(Math.floor(Date.now() / 1000)),
  confirmations: '1',
  nonce: '8',
  type: '2',
  input: '0x',
  ...fields,
});
const response = (result: any, fields: any = {}, status = 200) =>
  ({
    ok: status === 200,
    status,
    json: async () => ({ status: '1', message: 'OK', result, ...fields }),
  } as Response);
const replies = (base: Response, token: Response) => {
  jest
    .mocked(retryableFetch)
    .mockImplementation(async (endpoint) =>
      new URL(String(endpoint)).searchParams.get('action') === 'txlist'
        ? base
        : token
    );
};
const fetchPage = (offset = 2) =>
  EvmTransactionsController().fetchTransactionsPageFromAPI(
    ADDRESS,
    1,
    API,
    2,
    offset
  );

beforeEach(() => {
  jest.mocked(retryableFetch).mockReset();
  mockHint = 1;
});

it.each([0, undefined])(
  'honors explicit Load More parameters when the ordinary-transaction hint is %p',
  async (hint) => {
    mockHint = hint;
    replies(response([]), response([event('a'), event('b')]));
    await fetchPage();
    expect(retryableFetch).toHaveBeenCalledTimes(2);
    for (const [endpoint] of jest.mocked(retryableFetch).mock.calls) {
      const url = new URL(String(endpoint));
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('offset')).toBe('2');
      expect(url.searchParams.get('address')).toBe(ADDRESS);
      expect(url.searchParams.get('apikey')).toBe('synthetic-key');
    }
  }
);

it('returns received-only token rows and continues when the token page is full', async () => {
  replies(response([]), response([event('a'), event('b')]));
  const result = await fetchPage();
  expect(result.error).toBeUndefined();
  expect(result.hasMore).toBe(true);
  expect(result.transactions).toHaveLength(2);
  expect(result.transactions?.[0]).toMatchObject({
    hash: hash('a'),
    to: TOKEN,
    tokenRecipient: ADDRESS,
    chainId: 1,
    historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer,
    nonce: 8,
  });
});

it('merges mixed pages in date order, retaining the real base body over overlapping token events', async () => {
  const now = Math.floor(Date.now() / 1000);
  const base = event('a', {
    to: TOKEN,
    input: '0xa9059cbb',
    timeStamp: String(now - 1),
  });
  replies(
    response([base]),
    response([
      event('a', { hash: hash('a').toUpperCase() }),
      event('b'),
      event('b'),
    ])
  );
  const result = await fetchPage();
  expect(result.hasMore).toBe(true);
  expect(result.transactions?.map((row) => row.hash)).toEqual([
    hash('b'),
    hash('a'),
  ]);
  expect(result.transactions?.[1]).toMatchObject({
    to: TOKEN,
    tokenRecipient: ADDRESS,
    input: '0xa9059cbb',
    historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
  });
});

it('keeps the last partial token page and then reports exhaustion', async () => {
  replies(response([]), response([event('a')]));
  const result = await fetchPage();
  expect(result.transactions).toHaveLength(1);
  expect(result.hasMore).toBe(false);
});

it('accepts both explicit no-transactions responses as a genuine empty page', async () => {
  const empty = response([], { status: '0', message: 'No transactions found' });
  replies(empty, empty);
  await expect(fetchPage()).resolves.toEqual({
    transactions: [],
    hasMore: false,
  });
});

it('retains token-only HTTP fallback and its continuation count', async () => {
  replies(response(null, {}, 503), response([event('a'), event('b')]));
  const result = await fetchPage();
  expect(result.transactions).toHaveLength(2);
  expect(result.hasMore).toBe(true);
  expect(result.error).toBeUndefined();
});

it('retains nonempty base history when the token endpoint is unavailable', async () => {
  replies(response([event('a')]), response(null, {}, 503));
  const result = await fetchPage();
  expect(result.transactions).toHaveLength(1);
  expect(result.error).toBeUndefined();
});

it.each(['http', 'api'])(
  'does not call an empty txlist plus a token %s error an exhausted token page',
  async (failure) => {
    replies(
      response([], { status: '0', message: 'No transactions found' }),
      failure === 'http'
        ? response(null, {}, 503)
        : response('Invalid API key', { status: '0', message: 'NOTOK' })
    );
    const result = await fetchPage();
    expect(result.transactions).toBeNull();
    expect(result.error).toContain(
      failure === 'http' ? '503' : 'Invalid API key'
    );
  }
);

it('surfaces the txlist API error when token history cannot recover any rows', async () => {
  replies(
    response('Rate limit exceeded', { status: '0', message: 'NOTOK' }),
    response([])
  );
  const result = await fetchPage();
  expect(result.transactions).toBeNull();
  expect(result.error).toContain('Rate limit exceeded');
});
