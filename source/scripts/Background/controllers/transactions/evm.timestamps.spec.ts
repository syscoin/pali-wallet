import { retryableFetch } from '@sidhujag/sysweb3-network';

import EvmTransactionsController from './evm';

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      vault: {
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: {
          HDAccount: {
            0: {
              balances: { ethereum: '1' },
              evmTxCountByChainId: { 1: 1 },
            },
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

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'22'.repeat(20)}`;
const HASH = `0x${'aa'.repeat(32)}`;
const API = 'https://explorer.invalid/api';
const NOW = Date.parse('2026-10-18T12:00:00Z') / 1000;
const HISTORICAL = Date.parse('2015-08-03T12:00:00Z') / 1000;
const RECENT = Date.parse('2024-08-03T12:00:00Z') / 1000;
const row = (timeStamp: string) => ({
  hash: HASH,
  from: ACCOUNT,
  to: TOKEN,
  contractAddress: TOKEN,
  value: '1000000',
  blockNumber: '123',
  timeStamp,
  confirmations: '3',
  nonce: '8',
  type: '2',
  input: '0x',
});
const respond = (endpoint: string, timeStamp: string) => {
  jest.mocked(retryableFetch).mockImplementation(async (url) => {
    const action = new URL(String(url)).searchParams.get('action');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: '1',
        message: 'OK',
        result: action === endpoint ? [row(timeStamp)] : [],
      }),
    } as Response;
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW * 1000);
  jest.mocked(retryableFetch).mockReset();
});
afterEach(() => jest.useRealTimers());

describe.each(['initial', 'page'] as const)(
  '%s explorer history dates',
  (mode) => {
    describe.each(['txlist', 'tokentx'])('%s endpoint', (endpoint) => {
      it.each([
        [String(HISTORICAL), HISTORICAL],
        [String(RECENT), RECENT],
        ['', NOW],
        ['invalid', NOW],
        ['0', NOW],
        ['-1', NOW],
        [String(NOW + 2 * 365 * 24 * 60 * 60), NOW],
      ])('normalizes timestamp %s to %s', async (input, expected) => {
        respond(endpoint, String(input));
        const controller = EvmTransactionsController();
        const result =
          mode === 'initial'
            ? await controller.fetchTransactionsFromAPI(ACCOUNT, 1, API, false)
            : await controller.fetchTransactionsPageFromAPI(
                ACCOUNT,
                1,
                API,
                2,
                30
              );
        expect(result.error).toBeUndefined();
        expect(result.transactions).toHaveLength(1);
        expect(result.transactions?.[0]).toMatchObject({
          hash: HASH,
          timestamp: expected,
          chainId: 1,
        });
        expect(jest.mocked(retryableFetch).mock.calls).toHaveLength(2);
        expect(
          jest
            .mocked(retryableFetch)
            .mock.calls.map(([url]) =>
              new URL(String(url)).searchParams.get('action')
            )
        ).toEqual(['txlist', 'tokentx']);
      });
    });
  }
);

it('preserves the separate pending timestamp path and pending block fields', async () => {
  respond('pendingtxlist', String(HISTORICAL));
  const result = await EvmTransactionsController().fetchTransactionsFromAPI(
    ACCOUNT,
    1,
    API,
    true
  );
  expect(result.error).toBeUndefined();
  expect(result.transactions).toHaveLength(1);
  expect(result.transactions?.[0]).toMatchObject({
    timestamp: HISTORICAL,
    blockNumber: null,
    blockHash: null,
    confirmations: 0,
  });
});
