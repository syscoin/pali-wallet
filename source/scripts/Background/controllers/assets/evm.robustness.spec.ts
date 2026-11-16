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
  cleanTokenSymbol: jest.fn((value: string) => value),
}));
jest.mock('../balances/BatchBalanceController', () => ({
  BatchBalanceController: jest.fn(),
}));
jest.mock('utils/ethersV6Compat', () => ({
  ...jest.requireActual('utils/ethersV6Compat'),
  Contract: jest.fn(),
}));
jest.mock('../../../../shared/nftReads', () => ({
  verifyERC1155OwnershipHelper: jest.fn(),
}));

import { retryableFetch } from '@sidhujag/sysweb3-network';
import {
  cleanTokenSymbol,
  contractChecker,
  getTokenStandardMetadata,
} from '@sidhujag/sysweb3-utils';

import { verifyERC1155OwnershipHelper } from '../../../../shared/nftReads';
import { BatchBalanceController } from '../balances/BatchBalanceController';
import store from 'state/store';
import { Contract } from 'utils/ethersV6Compat';

import EvmAssetsController from './evm';

const TOKEN = `0x${'33'.repeat(20)}`;
const ACCOUNT = `0x${'11'.repeat(20)}`;
let network: any;
const originalFetch = global.fetch;
const response = (data: any, status = 200) => ({
  ok: status === 200,
  status,
  headers: { get: () => null },
  json: async () => data,
  text: async () => JSON.stringify(data),
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
  global.fetch = jest.fn();
  network = {
    chainId: 1,
    url: 'https://rpc.test',
    apiUrl: 'https://explorer.test/api',
  };
  (store.getState as jest.Mock).mockImplementation(() => ({
    vault: { activeNetwork: network },
  }));
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

it('recovers market reads when platform metadata arrives on the same controller', async () => {
  const controller = EvmAssetsController();
  await expect(controller.getOnlyMarketData(TOKEN)).resolves.toBeNull();
  expect(retryableFetch).not.toHaveBeenCalled();
  jest.advanceTimersByTime(24 * 60 * 60_000);
  network = { ...network, coingeckoPlatformId: 'ethereum' };
  jest
    .mocked(retryableFetch)
    .mockResolvedValue(response({ symbol: 'TST', price: 7 }) as any);
  await expect(controller.getOnlyMarketData(TOKEN)).resolves.toMatchObject({
    price: 7,
  });
  expect(retryableFetch).toHaveBeenCalledTimes(1);
  delete network.coingeckoPlatformId;
  await expect(controller.getOnlyMarketData(TOKEN)).resolves.toBeNull();
  expect(retryableFetch).toHaveBeenCalledTimes(1);
});

it('isolates market cache and pending completions by current platform metadata', async () => {
  network.coingeckoPlatformId = 'first-platform';
  const controller = EvmAssetsController();
  const first = deferred();
  jest.mocked(retryableFetch).mockReturnValueOnce(first.promise);
  const pending = controller.getOnlyMarketData(TOKEN);
  network = { ...network, coingeckoPlatformId: 'second-platform' };
  jest
    .mocked(retryableFetch)
    .mockResolvedValueOnce(response({ symbol: 'TST', price: 9 }) as any);
  await expect(controller.getOnlyMarketData(TOKEN)).resolves.toMatchObject({
    price: 9,
  });
  first.resolve(response({ symbol: 'TST', price: 7 }));
  await expect(pending).resolves.toBeNull();
  await expect(controller.getOnlyMarketData(TOKEN)).resolves.toMatchObject({
    price: 9,
  });
  expect(retryableFetch).toHaveBeenCalledTimes(2);
  network.coingeckoPlatformId = 'first-platform';
  jest
    .mocked(retryableFetch)
    .mockResolvedValueOnce(response({ symbol: 'TST', price: 11 }) as any);
  await expect(controller.getOnlyMarketData(TOKEN)).resolves.toMatchObject({
    price: 11,
  });
  expect(retryableFetch).toHaveBeenCalledTimes(3);
});

it.each(['synchronous', 'asynchronous'])(
  'cleans up a %s market failure so the same controller can retry',
  async (mode) => {
    network.coingeckoPlatformId = 'ethereum';
    const controller = EvmAssetsController();
    if (mode === 'synchronous')
      jest.mocked(retryableFetch).mockImplementationOnce(() => {
        throw new Error('Market offline');
      });
    else
      jest
        .mocked(retryableFetch)
        .mockRejectedValueOnce(new Error('Market offline'));
    await expect(controller.getOnlyMarketData(TOKEN)).resolves.toBeNull();
    jest
      .mocked(retryableFetch)
      .mockResolvedValueOnce(response({ symbol: 'TST', price: 7 }) as any);
    await expect(controller.getOnlyMarketData(TOKEN)).resolves.toMatchObject({
      price: 7,
    });
    expect(retryableFetch).toHaveBeenCalledTimes(2);
  }
);

it('expires token market data independently of descriptive metadata and shares a refresh', async () => {
  network.coingeckoPlatformId = 'ethereum';
  const controller = EvmAssetsController();
  const fetch = jest.mocked(retryableFetch);
  fetch.mockResolvedValue(
    response({
      symbol: 'TST',
      ['market_data']: { ['current_price']: { usd: 11 } },
    }) as any
  );
  expect(
    (await controller.getOnlyMarketData(TOKEN))?.market_data.current_price.usd
  ).toBe(11);
  jest.advanceTimersByTime(299999);
  expect(
    (await controller.getOnlyMarketData(TOKEN))?.market_data.current_price.usd
  ).toBe(11);
  expect(fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  const pending = deferred();
  fetch.mockReturnValueOnce(pending.promise);
  const first = controller.getOnlyMarketData(TOKEN);
  const second = controller.getOnlyMarketData(TOKEN);
  expect(fetch).toHaveBeenCalledTimes(2);
  pending.resolve(
    response({
      symbol: 'TST',
      ['market_data']: { ['current_price']: { usd: 22 } },
    })
  );
  const values = await Promise.all([first, second]);
  expect(values.map((value) => value?.market_data.current_price.usd)).toEqual([
    22, 22,
  ]);
});

it('enhanced token details refresh market prices while reusing descriptive metadata', async () => {
  network.coingeckoPlatformId = 'ethereum';
  (contractChecker as jest.Mock).mockResolvedValue({ type: 'ERC-20' });
  (getTokenStandardMetadata as jest.Mock).mockResolvedValue({
    tokenSymbol: 'TST',
    decimals: 6,
    balance: '1000000',
  });
  const quote = (price: number) => ({
    symbol: 'TST',
    ['market_data']: { ['current_price']: { usd: price } },
  });
  jest.mocked(retryableFetch).mockResolvedValue(response(quote(11)) as any);
  (Contract as unknown as jest.Mock).mockImplementation(() => ({
    decimals: async () => BigInt(6),
    balanceOf: async () => BigInt(1000000),
  }));
  const controller = EvmAssetsController();
  const first = await controller.getTokenDetailsWithMarketData(
    TOKEN,
    ACCOUNT,
    {} as any
  );
  expect(first?.market_data.current_price.usd).toBe(11);
  expect(first?.isVerified).toBe(true);
  jest.advanceTimersByTime(300000);
  jest.mocked(retryableFetch).mockResolvedValue(response(quote(22)) as any);
  const second = await controller.getTokenDetailsWithMarketData(
    TOKEN,
    ACCOUNT,
    {} as any
  );
  expect(second?.market_data.current_price.usd).toBe(22);
  expect(contractChecker).toHaveBeenCalledTimes(1);
  expect(retryableFetch).toHaveBeenCalledTimes(2);
});

describe('ERC20 shared metadata boundary', () => {
  const load = (
    overrides: Record<string, unknown> = {},
    contractAddress = TOKEN,
    accountAddress = ACCOUNT
  ) => {
    const fields = {
      name: 'Example token',
      symbol: 'EXAMPLE',
      decimals: BigInt(255),
      balanceOf: BigInt('9007199254740993'),
      ...overrides,
    };
    (Contract as unknown as jest.Mock).mockImplementation(() =>
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          jest.fn().mockResolvedValue(value),
        ])
      )
    );
    return EvmAssetsController().getERC20TokenInfo(
      contractAddress,
      accountAddress,
      {} as any
    );
  };
  it('shares exact unit and full uint8 precision validation with native token reads', async () => {
    await expect(load()).resolves.toEqual({
      name: 'Example token',
      symbol: 'EXAMPLE',
      decimals: 255,
      balance: '9007199254740993',
    });
  });
  it.each([{ decimals: BigInt(256) }, { balanceOf: 9007199254740992 }])(
    'rejects invalid numbers instead of defaulting or losing precision: %o',
    async (fields) => {
      await expect(load(fields)).rejects.toThrow('Invalid ERC20 data');
    }
  );
  it.each([
    { name: '', symbol: '' },
    { name: 'N'.repeat(1024), symbol: 'S'.repeat(1024) },
    { name: 'Existing\u202etoken', symbol: 'Existing\u200bsymbol' },
  ])(
    'keeps existing token text balance-verifiable without the native import text policy: %o',
    async (fields) => {
      await expect(load(fields)).resolves.toEqual({
        ...fields,
        decimals: 255,
        balance: '9007199254740993',
      });
    }
  );

  it.each([
    ['token.example.eth', 'holder.example.eth'],
    ['XE65GB6LDNXYOFTX0NSV3FUWKOWIXAMJK36', ACCOUNT.slice(2)],
    [`0x${'0'.repeat(40)}`, `0x${'0'.repeat(40)}`],
  ])(
    'preserves contract/holder resolution for %s and %s',
    async (target, holder) => {
      await load({}, target, holder);
      expect(Contract).toHaveBeenCalledWith(
        target,
        expect.any(Array),
        expect.anything()
      );
      const instance = (Contract as unknown as jest.Mock).mock.results[0].value;
      expect(instance.balanceOf).toHaveBeenCalledWith(holder);
    }
  );

  it('applies extension symbol presentation after shared field validation', async () => {
    (cleanTokenSymbol as jest.Mock).mockReturnValueOnce('DISPLAY');
    await expect(load({ symbol: 'Raw token symbol' })).resolves.toMatchObject({
      name: 'Example token',
      symbol: 'DISPLAY',
    });
    expect(cleanTokenSymbol).toHaveBeenCalledWith('Raw token symbol');
  });
});

describe('discovery availability is not an empty wallet', () => {
  it.each([0, 6, 18, 80, 81, 100, 255])(
    'normalizes owned ERC20 precision %i with the shared full-range formatter',
    async (precision) => {
      network.apiUrl = `https://owned-erc20-precision.test/api?case=${precision}`;
      const rawBalance = '9007199254740993';
      jest.mocked(fetch).mockResolvedValue(
        response({
          status: '1',
          result: [
            {
              contractAddress: TOKEN,
              name: 'Full precision token',
              symbol: 'FULL',
              decimals: String(precision),
              balance: rawBalance,
              type: 'ERC-20',
            },
          ],
        }) as any
      );
      const result = await EvmAssetsController().getUserOwnedTokens(ACCOUNT);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ decimals: precision, rawBalance });
      expect(result[0].balance).toBe(Number(`${rawBalance}e-${precision}`));
      expect(result[0].balance).toBeGreaterThan(0);
    }
  );

  it('keeps valid zero/safe numeric API holdings and isolates malformed ERC20 rows', async () => {
    network.apiUrl = 'https://owned-erc20-validation.test/api';
    const base = {
      contractAddress: TOKEN,
      name: 'Validated token',
      symbol: 'VALID',
      type: 'ERC-20',
    };
    jest.mocked(fetch).mockResolvedValue(
      response({
        status: '1',
        result: [
          { ...base, decimals: 0, balance: 0 },
          { ...base, decimals: '255', balance: '1' },
          { ...base, decimals: '6', balance: '1000000' },
          { ...base, balance: '1000000' },
          { ...base, decimals: null, balance: '1000000' },
          { ...base, decimals: 6 },
          { ...base, decimals: 6, balance: null },
          { ...base, decimals: 256, balance: '1' },
          { ...base, decimals: -1, balance: '1' },
          { ...base, decimals: 1.5, balance: '1' },
          { ...base, decimals: '', balance: '1' },
          { ...base, decimals: 6, balance: Number.MAX_SAFE_INTEGER + 1 },
        ],
      }) as any
    );
    await expect(
      EvmAssetsController().getUserOwnedTokens(ACCOUNT)
    ).resolves.toMatchObject([
      { decimals: 0, balance: 0, rawBalance: '0' },
      { decimals: 255, balance: 1e-255, rawBalance: '1' },
      { decimals: 6, balance: 1, rawBalance: '1000000' },
    ]);
  });
  it.each([
    '0',
    '42',
    '9007199254740993',
    '115792089237316195423570985008687907853269984665640564039457584007913129639935',
  ])(
    'retains the exact ERC1155 owned balance %s for import and MAX',
    async (rawBalance) => {
      network.apiUrl = `https://owned-nft-precision.test/api?case=${rawBalance}`;
      (fetch as jest.Mock).mockResolvedValue(
        response({
          status: '1',
          result: [
            {
              contractAddress: TOKEN,
              type: 'ERC-1155',
              id: '7',
              name: 'Exact collection',
              symbol: 'EXACT',
              decimals: '0',
              balance: rawBalance,
            },
          ],
        })
      );
      const result = await EvmAssetsController().getUserOwnedTokens(ACCOUNT);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        tokenId: '7',
        balance: Number(rawBalance),
        rawBalance,
      });
    }
  );

  it.each([0, 42])(
    'retains safe numeric ERC1155 balance %s as an exact integer',
    async (balance) => {
      network.apiUrl = `https://owned-nft-safe-number.test/api?case=${balance}`;
      (fetch as jest.Mock).mockResolvedValue(
        response({
          status: '1',
          result: [
            {
              contractAddress: TOKEN,
              type: 'ERC-1155',
              id: '7',
              decimals: '0',
              balance,
            },
          ],
        })
      );
      const result = await EvmAssetsController().getUserOwnedTokens(ACCOUNT);
      expect(result[0]).toMatchObject({ balance, rawBalance: String(balance) });
    }
  );

  it('uses exact NFT IDs for owned collections and items', async () => {
    const max =
      '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    network.apiUrl = 'https://owned-nft-identity.test/api';
    const item = {
      contractAddress: TOKEN,
      type: 'ERC-1155',
      decimals: '0',
      balance: max,
    };
    (fetch as jest.Mock).mockResolvedValue(
      response({
        status: '1',
        result: [
          { ...item, id: 0 },
          { ...item, id: `0x${'f'.repeat(64)}` },
          { ...item, id: Number.MAX_SAFE_INTEGER + 1 },
          { ...item, id: `${max}0` },
          { ...item, id: undefined },
          { ...item, type: 'ERC-721', id: '7', balance: '2' },
        ],
      })
    );

    await expect(
      EvmAssetsController().getUserOwnedTokens(ACCOUNT)
    ).resolves.toMatchObject([
      { id: `${TOKEN}-1-0`, tokenId: '0', rawBalance: max },
      { id: `${TOKEN}-1-${max}`, tokenId: max, rawBalance: max },
      { id: `${TOKEN}-1`, tokenStandard: 'ERC-721', balance: 2 },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    Number('9007199254740993'),
    (BigInt(1) << BigInt(256)).toString(),
    '1e3',
    '1.5',
    undefined,
  ])('does not invent an exact ERC1155 balance from %s', async (balance) => {
    network.apiUrl = `https://owned-nft-inexact.test/api?case=${balance}`;
    (fetch as jest.Mock).mockResolvedValue(
      response({
        status: '1',
        result: [
          {
            contractAddress: TOKEN,
            type: 'ERC-1155',
            id: '7',
            decimals: '0',
            balance,
          },
        ],
      })
    );
    const result = await EvmAssetsController().getUserOwnedTokens(ACCOUNT);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('rawBalance');
  });

  it('converts Routescan raw holdings into the existing token search result', async () => {
    network.apiUrl =
      'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
    (fetch as jest.Mock).mockResolvedValue(
      response({
        items: [
          {
            chainId: '1',
            tokenAddress: TOKEN,
            tokenName: 'Routescan token',
            tokenSymbol: 'RST',
            tokenDecimals: 6,
            tokenQuantity: '1234567',
          },
        ],
        link: {},
      })
    );
    const result = EvmAssetsController().getUserOwnedTokens(ACCOUNT);
    await jest.advanceTimersByTimeAsync(1100);
    await expect(result).resolves.toEqual([
      {
        id: `${TOKEN}-1`,
        contractAddress: TOKEN,
        name: 'Routescan token',
        symbol: 'RST',
        decimals: 6,
        balance: 1.234567,
        rawBalance: '1234567',
        tokenStandard: 'ERC-20',
      },
    ]);
  });

  it('respects a longer server cooldown on the first rate limit', async () => {
    network.apiUrl = 'https://retry-after.test/api';
    (fetch as jest.Mock).mockResolvedValue({
      ...response({}, 429),
      headers: { get: () => '120' },
    });
    await expect(
      EvmAssetsController().getUserOwnedTokens(ACCOUNT)
    ).rejects.toThrow('API request failed');
    await jest.advanceTimersByTimeAsync(60_001);
    await expect(
      EvmAssetsController().getUserOwnedTokens(ACCOUNT)
    ).rejects.toThrow('temporarily unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    (fetch as jest.Mock).mockResolvedValue(
      response({ status: '1', result: [] })
    );
    await expect(
      EvmAssetsController().getUserOwnedTokens(ACCOUNT)
    ).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  // Unique endpoints avoid inter-test dependence on the intentionally shared cooldown.
  it.each([429, 503])(
    'rejects HTTP %i and cools down without another request',
    async (status) => {
      network.apiUrl = `https://http${status}.test/api`;
      (fetch as jest.Mock).mockResolvedValue(response({}, status));
      const controller = EvmAssetsController();
      await expect(controller.getUserOwnedTokens(ACCOUNT)).rejects.toThrow(
        'API request failed'
      );
      await expect(
        EvmAssetsController().getUserOwnedTokens(ACCOUNT)
      ).rejects.toThrow('temporarily unavailable');
      expect(fetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(60_001);
      (fetch as jest.Mock).mockResolvedValue(
        response({ status: '1', result: [] })
      );
      await expect(controller.getUserOwnedTokens(ACCOUNT)).resolves.toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  );
  it('rejects network failures and HTTP-200 NOTOK envelopes', async () => {
    for (const kind of ['network', 'notok']) {
      network.apiUrl = `https://${kind}.test/api`;
      if (kind === 'network')
        (fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
      else
        (fetch as jest.Mock).mockResolvedValueOnce(
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
    network.apiUrl = `https://empty${data.status}.test/api`;
    (fetch as jest.Mock).mockResolvedValue(response(data));
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
    (fetch as jest.Mock).mockResolvedValue(
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
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('uses RPC for tracked balances with a configured API and preserves a failed token', async () => {
  const second = `0x${'44'.repeat(20)}`;
  const balances = new Map([[TOKEN, { balance: 0, rawBalance: '0' }]]);
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
  expect(fetch).not.toHaveBeenCalled();
  expect(onBalanceRead).toHaveBeenCalledTimes(1);
  expect(onBalanceRead).toHaveBeenCalledWith({
    ...tokens[0],
    balance: 0,
    rawBalance: '0',
  });
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

it('reuses cold import metadata once and keeps balances out of the basic cache', async () => {
  const controller = EvmAssetsController();
  (contractChecker as jest.Mock).mockResolvedValue({ type: 'ERC-20' });
  (getTokenStandardMetadata as jest.Mock).mockResolvedValue({
    tokenSymbol: 'T',
    decimals: 6,
    balance: '1000000',
  });
  expect(
    await controller.getTokenDetailsWithBalance(TOKEN, ACCOUNT, {} as any)
  ).toMatchObject({ balance: 1, rawBalance: '1000000' });
  expect(getTokenStandardMetadata).toHaveBeenCalledTimes(1);
  expect(
    await controller.getTokenDetails(TOKEN, ACCOUNT, {} as any)
  ).toMatchObject({ balance: 0, decimals: 6 });
  expect(getTokenStandardMetadata).toHaveBeenCalledTimes(1);
});

it('reports a successful unchanged balance read even when the legacy result is an empty update', async () => {
  (BatchBalanceController as jest.Mock).mockImplementation(() => ({
    getBatchTokenBalances: async () =>
      new Map([[TOKEN, { balance: 0, rawBalance: '0' }]]),
  }));
  const token = {
    contractAddress: TOKEN,
    chainId: 1,
    balance: 0,
    rawBalance: '0',
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

it.each([
  ['0', 18, '0'],
  ['0.000001', 6, '1'],
  [
    '9007199254740993.123456789123456789',
    18,
    '9007199254740993123456789123456789',
  ],
])(
  'reports exact raw ERC20 balance for %s without a Number round trip',
  async (balance, decimals, rawBalance) => {
    (BatchBalanceController as jest.Mock).mockImplementation(() => ({
      getBatchTokenBalances: async () =>
        new Map([[TOKEN, { balance: Number(balance), rawBalance }]]),
    }));
    const read = jest.fn();
    const result = await EvmAssetsController().updateAllEvmTokens(
      { address: ACCOUNT } as any,
      1,
      {} as any,
      [
        {
          contractAddress: TOKEN,
          chainId: 1,
          balance: 9,
          rawBalance: '9',
          decimals,
          isNft: false,
          tokenSymbol: 'T',
        } as any,
      ],
      read
    );
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ balance: Number(balance), rawBalance })
    );
    expect(result[0].rawBalance).toBe(rawBalance);
  }
);

it.each(['ERC-721', 'ERC-1155'])(
  'reports actual numeric and exact raw %s balance to normal-read commits',
  async (tokenStandard) => {
    const rawBalance = '900719925474099312345';
    (Contract as jest.Mock).mockReturnValue({
      balanceOf: async () => BigInt(rawBalance),
    });
    (verifyERC1155OwnershipHelper as jest.Mock).mockResolvedValue([
      { verified: true, balance: Number(rawBalance), rawBalance },
    ]);
    const read = jest.fn();
    const pending = EvmAssetsController().updateAllEvmTokens(
      { address: ACCOUNT } as any,
      1,
      {} as any,
      [
        {
          contractAddress: TOKEN,
          chainId: 1,
          balance: 9,
          rawBalance: '9',
          decimals: 0,
          isNft: true,
          tokenStandard,
          tokenId: '1',
          tokenSymbol: 'NFT',
        } as any,
      ],
      read
    );
    await jest.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ balance: Number(rawBalance), rawBalance })
    );
    expect(result[0].rawBalance).toBe(rawBalance);
  }
);

it('reads each ERC721 collection once and fans exact balances out to every saved ID', async () => {
  const other = `0x${'44'.repeat(20)}`;
  const balanceOf = jest.fn(async () => BigInt(12));
  (Contract as jest.Mock).mockImplementation((address) => {
    if (address === other) throw new Error('Unavailable collection');
    return { balanceOf };
  });
  const assets = [
    ...Array.from({ length: 10 }, (_, index) => ({
      contractAddress:
        index % 2 ? TOKEN.toUpperCase().replace('0X', '0x') : TOKEN,
      chainId: 1,
      balance: 9,
      rawBalance: '9',
      decimals: 0,
      isNft: true,
      tokenStandard: 'ERC-721',
      tokenId: String(index),
      tokenSymbol: 'NFT',
    })),
    {
      contractAddress: other,
      chainId: 1,
      balance: 3,
      rawBalance: '3',
      decimals: 0,
      isNft: true,
      tokenStandard: 'ERC-721',
      tokenId: '0',
      tokenSymbol: 'OTHER',
    },
  ];
  const read = jest.fn();
  const pending = EvmAssetsController().updateAllEvmTokens(
    { address: ACCOUNT } as any,
    1,
    {} as any,
    assets as any,
    read
  );
  await jest.advanceTimersByTimeAsync(100);
  const result = await pending;
  expect(Contract).toHaveBeenCalledTimes(2);
  expect(balanceOf).toHaveBeenCalledTimes(1);
  expect(balanceOf).toHaveBeenCalledWith(ACCOUNT);
  expect(read).toHaveBeenCalledTimes(10);
  expect(read.mock.calls.map(([asset]) => asset.tokenId)).toEqual(
    assets.slice(0, 10).map((asset) => asset.tokenId)
  );
  expect(
    result.find((asset) => asset.contractAddress.toLowerCase() === TOKEN)
  ).toMatchObject({ balance: 12, rawBalance: '12' });
  expect(result.find((asset) => asset.contractAddress === other)).toEqual(
    assets[10]
  );
});

it('coalesces concurrent native price reads by market identity and currency', async () => {
  (store.getState as jest.Mock).mockImplementation(() => ({
    vault: { activeNetwork: network },
    vaultGlobal: {
      networks: {
        ethereum: {
          1: { coingeckoId: 'ethereum' },
          10: { coingeckoId: 'ethereum' },
        },
      },
    },
  }));
  const held = deferred();
  (global.fetch as jest.Mock).mockReturnValue(held.promise);
  const controller = EvmAssetsController();
  const first = controller.getTokenPriceData(1, 'usd');
  const second = controller.getTokenPriceData(10, 'usd');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  held.resolve(response({ ethereum: { usd: 12, eur: 11 } }));
  expect(await first).toEqual({
    available: true,
    price: 12,
    priceChange24h: undefined,
  });
  expect(await second).toEqual(await first);
  await controller.getTokenPriceData(1, 'usd');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await controller.getTokenPriceData(1, 'eur');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it('does not cache a failed native price read or hold later retries behind it', async () => {
  (store.getState as jest.Mock).mockImplementation(() => ({
    vault: { activeNetwork: network },
    vaultGlobal: { networks: { ethereum: { 1: { coingeckoId: 'ethereum' } } } },
  }));
  const controller = EvmAssetsController();
  (global.fetch as jest.Mock)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(response({ ethereum: { usd: 5 } }));
  expect(await controller.getTokenPriceData(1, 'usd')).toEqual({
    available: false,
    price: 0,
  });
  expect((await controller.getTokenPriceData(1, 'usd')).price).toBe(5);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it('passes the stable provider identity separately from the active asset read owner', async () => {
  const provider = {};
  const owner = {
    signal: new AbortController().signal,
    assertCurrent: jest.fn(),
  };
  (BatchBalanceController as jest.Mock).mockImplementation(() => ({
    getBatchTokenBalances: async () => new Map(),
  }));
  await EvmAssetsController().updateAllEvmTokens(
    { address: ACCOUNT } as any,
    1,
    provider as any,
    [
      {
        contractAddress: TOKEN,
        chainId: 1,
        decimals: 0,
        isNft: false,
        tokenSymbol: 'T',
      },
    ] as any,
    undefined,
    owner
  );
  expect(BatchBalanceController).toHaveBeenCalledWith(
    expect.anything(),
    owner,
    provider
  );
  expect((BatchBalanceController as jest.Mock).mock.calls[0][0]).not.toBe(
    provider
  );
});

it('keeps cold import balances private to each concurrent holder and skips symbol on warm reads', async () => {
  (contractChecker as jest.Mock).mockResolvedValue({ type: 'ERC-20' });
  const pending = deferred();
  (getTokenStandardMetadata as jest.Mock).mockReturnValue(pending.promise);
  const balanceOf = jest.fn(async () => BigInt(2000000));
  const decimals = jest.fn(async () => BigInt(6));
  (Contract as unknown as jest.Mock).mockImplementation(() => ({
    balanceOf,
    decimals,
  }));
  const controller = EvmAssetsController();
  const first = controller.getTokenDetailsWithBalance(
    TOKEN,
    ACCOUNT,
    {} as any
  );
  const otherHolder = `0x${'22'.repeat(20)}`;
  const second = controller.getTokenDetailsWithBalance(
    TOKEN,
    otherHolder,
    {} as any
  );
  await Promise.resolve();
  pending.resolve({ tokenSymbol: 'T', decimals: 6, balance: '1000000' });
  expect((await first)?.rawBalance).toBe('1000000');
  expect((await second)?.rawBalance).toBe('2000000');
  expect(balanceOf).toHaveBeenCalledTimes(1);
  expect(balanceOf).toHaveBeenCalledWith(otherHolder);
  expect(decimals).toHaveBeenCalledTimes(1);
  expect(getTokenStandardMetadata).toHaveBeenCalledTimes(1);
});

it('does not commit a grouped precision mismatch as a fresh balance', async () => {
  const RealBatch = jest.requireActual(
    '../balances/BatchBalanceController'
  ).BatchBalanceController;
  (BatchBalanceController as jest.Mock).mockImplementation(
    (...args) => new RealBatch(...args)
  );
  const provider = {
    getNetwork: async () => ({ chainId: 1 }),
    getCode: async () => '0x',
    readMany: async (requests) =>
      requests.map((request) => ({
        status: 'fulfilled',
        value: `0x${BigInt(
          request.params[0].data === '0x313ce567' ? 18 : '1000000000000000000'
        )
          .toString(16)
          .padStart(64, '0')}`,
      })),
  };
  const token = {
    contractAddress: TOKEN,
    chainId: 1,
    balance: 7,
    rawBalance: '7000000',
    decimals: 6,
    isNft: false,
    tokenSymbol: 'T',
  };
  const onBalanceRead = jest.fn();
  const result = await EvmAssetsController().updateAllEvmTokens(
    { address: ACCOUNT } as any,
    1,
    provider as any,
    [token],
    onBalanceRead
  );
  expect(result).toEqual([]);
  expect(onBalanceRead).not.toHaveBeenCalled();
  expect(token).toMatchObject({
    balance: 7,
    rawBalance: '7000000',
    decimals: 6,
  });
});
