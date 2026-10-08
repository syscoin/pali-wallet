jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('@sidhujag/sysweb3-network', () => ({ retryableFetch: jest.fn() }));
jest.mock('@sidhujag/sysweb3-utils', () => ({
  contractChecker: jest.fn(),
  getErc21Abi: jest.fn(),
  getTokenStandardMetadata: jest.fn(),
  getNftStandardMetadata: jest.fn(),
  getERC721StandardBalance: jest.fn(),
  cleanTokenSymbol: (value: string) => value,
}));
jest.mock('../balances/BatchBalanceController', () => ({
  BatchBalanceController: jest.fn(),
}));

import { retryableFetch } from '@sidhujag/sysweb3-network';
import {
  contractChecker,
  getTokenStandardMetadata,
} from '@sidhujag/sysweb3-utils';

import { BatchBalanceController } from '../balances/BatchBalanceController';
import store from 'state/store';

import EvmAssetsController from './evm';

const TOKEN = `0x${'33'.repeat(20)}`;
const ACCOUNT = `0x${'11'.repeat(20)}`;
let network: any;
const response = (data: any, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data,
});
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2030-01-01'));
  network = {
    chainId: 1,
    url: 'https://rpc.test',
    apiUrl: 'https://explorer.test/api',
  };
  (store.getState as jest.Mock).mockImplementation(() => ({
    vault: { activeNetwork: network },
  }));
});
afterEach(() => jest.useRealTimers());

describe('discovery availability is not an empty wallet', () => {
  // Unique endpoints avoid inter-test dependence on the intentionally shared cooldown.
  it.each([429, 503])(
    'rejects HTTP %i and cools down without another request',
    async (status) => {
      network.apiUrl = `https://http${status}.test/api`;
      (retryableFetch as jest.Mock).mockResolvedValue(response({}, status));
      const controller = EvmAssetsController();
      await expect(controller.getUserOwnedTokens(ACCOUNT)).rejects.toThrow(
        'API request failed'
      );
      await expect(
        EvmAssetsController().getUserOwnedTokens(ACCOUNT)
      ).rejects.toThrow('temporarily unavailable');
      expect(retryableFetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(60_001);
      (retryableFetch as jest.Mock).mockResolvedValue(
        response({ status: '1', result: [] })
      );
      await expect(controller.getUserOwnedTokens(ACCOUNT)).resolves.toEqual([]);
      expect(retryableFetch).toHaveBeenCalledTimes(2);
    }
  );
  it('rejects network failures and HTTP-200 NOTOK envelopes', async () => {
    for (const kind of ['network', 'notok']) {
      network.apiUrl = `https://${kind}.test/api`;
      if (kind === 'network')
        (retryableFetch as jest.Mock).mockRejectedValueOnce(
          new Error('offline')
        );
      else
        (retryableFetch as jest.Mock).mockResolvedValueOnce(
          response({ status: '0', message: 'NOTOK', result: 'rate limit' })
        );
      await expect(
        EvmAssetsController().getUserOwnedTokens(ACCOUNT)
      ).rejects.toThrow();
    }
  });
  it.each([
    { status: '1', result: [] },
    { status: '0', message: 'No tokens found', result: [] },
  ])('accepts a genuine empty list', async (data) => {
    network.apiUrl = 'https://empty.test/api';
    (retryableFetch as jest.Mock).mockResolvedValue(response(data));
    await expect(
      EvmAssetsController().getUserOwnedTokens(ACCOUNT)
    ).resolves.toEqual([]);
  });
  it('isolates malformed rows, preserving valid zero-decimal and zero balances', async () => {
    network.apiUrl = 'https://rows.test/api';
    const valid = {
      contractAddress: TOKEN,
      decimals: '0',
      balance: '0',
      symbol: 'OK',
      name: 'Good',
    };
    (retryableFetch as jest.Mock).mockResolvedValue(
      response({
        status: '1',
        result: [
          null,
          { ...valid, balance: 'not-a-number' },
          { ...valid, decimals: '6garbage' },
          { ...valid, decimals: '-1' },
          { ...valid, contractAddress: 'broken' },
          valid,
        ],
      })
    );
    const result = await EvmAssetsController().getUserOwnedTokens(ACCOUNT);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      balance: 0,
      decimals: 0,
      contractAddress: TOKEN,
    });
  });
  it('has no RPC-based generic discovery when no API is configured', async () => {
    delete network.apiUrl;
    await expect(
      EvmAssetsController().getUserOwnedTokens(ACCOUNT)
    ).resolves.toEqual([]);
    expect(retryableFetch).not.toHaveBeenCalled();
  });
});

it('uses RPC for tracked balances with a configured API and preserves a failed token', async () => {
  const second = `0x${'44'.repeat(20)}`;
  const balances = new Map([[TOKEN, '0']]);
  (BatchBalanceController as jest.Mock).mockImplementation(() => ({
    getBatchTokenBalances: async () => balances,
  }));
  const tokens = [TOKEN, second].map((contractAddress) => ({
    contractAddress,
    chainId: 1,
    balance: 9,
    decimals: 0,
    isNft: false,
    tokenSymbol: 'T',
  }));
  const onBalanceRead = jest.fn();
  const result = await EvmAssetsController().updateAllEvmTokens(
    { address: ACCOUNT } as any,
    1,
    {} as any,
    tokens,
    onBalanceRead
  );
  expect(result.find((token) => token.contractAddress === TOKEN)?.balance).toBe(
    0
  );
  expect(
    result.find((token) => token.contractAddress === second)?.balance
  ).toBe(9);
  expect(retryableFetch).not.toHaveBeenCalled();
  expect(onBalanceRead).toHaveBeenCalledTimes(1);
  expect(onBalanceRead).toHaveBeenCalledWith(tokens[0]);
});

it('deduplicates same-chain metadata but not a switched chain; old results cannot be relabelled', async () => {
  const old = deferred();
  (contractChecker as jest.Mock).mockResolvedValue({ type: 'ERC-20' });
  (getTokenStandardMetadata as jest.Mock)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({ tokenSymbol: 'NEW', decimals: 6 });
  const controller = EvmAssetsController();
  const first = controller.getTokenDetails(TOKEN, ACCOUNT, {} as any);
  const duplicate = controller.getTokenDetails(
    TOKEN.toUpperCase().replace('0X', '0x'),
    ACCOUNT,
    {} as any
  );
  await Promise.resolve();
  network = { ...network, chainId: 2, url: 'https://new-rpc.test' };
  const next = await controller.getTokenDetails(TOKEN, ACCOUNT, {} as any);
  old.resolve({ tokenSymbol: 'OLD', decimals: 18 });
  expect(await first).toBeNull();
  expect(await duplicate).toBeNull();
  expect(next).toMatchObject({ symbol: 'NEW', chainId: 2 });
  expect(getTokenStandardMetadata).toHaveBeenCalledTimes(2);
});

it('reports a successful unchanged balance read even when the legacy result is an empty update', async () => {
  (BatchBalanceController as jest.Mock).mockImplementation(() => ({
    getBatchTokenBalances: async () => new Map([[TOKEN, '0']]),
  }));
  const token = {
    contractAddress: TOKEN,
    chainId: 1,
    balance: 0,
    decimals: 0,
    isNft: false,
    tokenSymbol: 'T',
  };
  const read = jest.fn();
  const result = await EvmAssetsController().updateAllEvmTokens(
    { address: ACCOUNT } as any,
    1,
    {} as any,
    [token],
    read
  );
  expect(result).toEqual([]);
  expect(read).toHaveBeenCalledWith(token);
});
