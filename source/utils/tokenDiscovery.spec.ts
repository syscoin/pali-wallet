import {
  fetchOwnedTokenRows,
  fetchRoutescan,
  isRoutescanApiUrl,
  TokenDiscoveryError,
} from './tokenDiscovery';

const API = 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
const TOKEN = `0x${'33'.repeat(20)}`;
const originalFetch = global.fetch;
let account: string;
let testId = 0;
const response = (
  data: unknown,
  status = 200,
  retryAfter: string | null = null
) => ({
  ok: status === 200,
  status,
  headers: { get: () => retryAfter },
  json: async () => data,
});
const holding = {
  chainId: '1',
  tokenAddress: TOKEN,
  tokenName: 'Test token',
  tokenSymbol: 'TEST',
  tokenDecimals: 18,
  tokenQuantity: '700008531373791941118514',
};

beforeEach(() => {
  testId += 1;
  account = `0x${testId.toString(16).padStart(40, '0')}`;
  jest.useFakeTimers().setSystemTime(new Date(2033, 0, testId));
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

it.each(['apikey', 'apiKey'])(
  'sends a configured Routescan %s in the authentication header for history and validation',
  async (keyName) => {
    (fetch as jest.Mock).mockResolvedValue(response({ result: '0x123' }));
    await fetchRoutescan(
      `${API}?${keyName}=user-key&module=proxy&action=eth_blockNumber`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );
    const [endpoint, options] = (fetch as jest.Mock).mock.calls[0];
    const url = new URL(endpoint);
    expect(url.searchParams.has('apikey')).toBe(false);
    expect(url.searchParams.has('apiKey')).toBe(false);
    expect(url.searchParams.get('module')).toBe('proxy');
    expect(url.searchParams.get('action')).toBe('eth_blockNumber');
    expect(options.headers.get('apikey')).toBe('user-key');
    expect(options.headers.get('Accept')).toBe('application/json');
  }
);

it('normalizes Routescan holdings without losing raw balance precision or mixing chains', async () => {
  (fetch as jest.Mock).mockResolvedValue(
    response({
      items: [
        holding,
        null,
        { ...holding, chainId: '8453' },
        { ...holding, tokenDecimals: undefined },
        { ...holding, tokenQuantity: '1.23' },
      ],
      link: {},
    })
  );
  const rows = await fetchOwnedTokenRows(API, account, 1);
  expect(rows).toEqual([
    {
      contractAddress: TOKEN,
      name: 'Test token',
      symbol: 'TEST',
      decimals: 18,
      balance: '700008531373791941118514',
      type: 'ERC-20',
    },
  ]);
  const url = new URL((fetch as jest.Mock).mock.calls[0][0]);
  expect(url.pathname).toBe(
    `/v2/network/mainnet/evm/1/address/${account}/erc20-holdings`
  );
  expect(url.search).toBe('?limit=100');
});

it('preserves NFT discovery, aggregating unique ERC721 IDs and retaining ERC1155 ID zero', async () => {
  (fetch as jest.Mock).mockImplementation(async (endpoint) => {
    const url = new URL(endpoint);
    const common = { chainId: '1', tokenAddress: TOKEN };
    if (url.pathname.endsWith('/erc20-holdings'))
      return response({ items: [holding], link: {} });
    if (url.pathname.endsWith('/erc721-holdings')) {
      const item = {
        ...common,
        collectionName: 'NFT collection',
        collectionSymbol: 'NFT',
        tokenId: '900719925474099312345',
      };
      return url.searchParams.has('next')
        ? response({ items: [item, { ...item, tokenId: '0' }], link: {} })
        : response({ items: [item], link: { nextToken: 'nft-page-2' } });
    }
    return response({
      items: [{ ...common, tokenId: '0', balance: '1000000000000000000' }],
      link: {},
    });
  });
  const result = fetchOwnedTokenRows(API, account, 1, true);
  await jest.advanceTimersByTimeAsync(550 * 4);
  expect(await result).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'ERC-20',
        balance: holding.tokenQuantity,
      }),
      expect.objectContaining({
        type: 'ERC-721',
        balance: '2',
        name: 'NFT collection',
      }),
      expect.objectContaining({
        type: 'ERC-1155',
        id: '0',
        decimals: 0,
        balance: '1000000000000000000',
      }),
    ])
  );
  expect(fetch).toHaveBeenCalledTimes(4);
  const urls = (fetch as jest.Mock).mock.calls.map(([url]) => new URL(url));
  expect(urls[3].searchParams.has('next')).toBe(false);
});

it('reports unavailable NFT discovery instead of returning a partial owned-token list', async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(response({ items: [holding], link: {} }))
    .mockResolvedValueOnce(response({}, 503));
  const result = expect(
    fetchOwnedTokenRows(API, account, 1, true)
  ).rejects.toThrow('503');
  await jest.advanceTimersByTimeAsync(550);
  await result;
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('uses bounded same-host cursor pagination and spaces requests', async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(
      response({
        items: [holding],
        link: {
          next: 'https://attacker.test/steal',
          nextToken: 'cursor+/=',
        },
      })
    )
    .mockResolvedValueOnce(
      response({ items: [{ ...holding, tokenAddress: account }], link: {} })
    );
  const result = fetchOwnedTokenRows(API, account, 1);
  await jest.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(549);
  expect(fetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toHaveLength(2);
  const next = new URL((fetch as jest.Mock).mock.calls[1][0]);
  expect(next.origin).toBe('https://api.routescan.io');
  expect(next.searchParams.get('next')).toBe('cursor+/=');
});

it('paces different wallets through the same provider queue', async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ items: [], link: {} }));
  const first = fetchOwnedTokenRows(API, account, 1);
  const second = fetchOwnedTokenRows(API, TOKEN, 1);
  await jest.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(550);
  await Promise.all([first, second]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('coalesces concurrent loads, caches success, and refreshes after one minute', async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ items: [], link: {} }));
  const first = fetchOwnedTokenRows(API, account, 1);
  expect(fetchOwnedTokenRows(API, account, 1)).toBe(first);
  await first;
  await fetchOwnedTokenRows(API, account, 1);
  expect(fetch).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(60_001);
  await fetchOwnedTokenRows(API, account, 1);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('preserves legacy API paths, chain parameters, and API keys', async () => {
  (fetch as jest.Mock).mockResolvedValue(
    response({ status: '1', result: [holding] })
  );
  await fetchOwnedTokenRows(
    'https://explorer.test/v2/api?chain_id=1&apiKey=secret',
    account,
    1
  );
  const url = new URL((fetch as jest.Mock).mock.calls[0][0]);
  expect(url.pathname).toBe('/v2/api');
  expect(url.searchParams.get('chain_id')).toBe('1');
  expect(Object.fromEntries(url.searchParams)).toEqual(
    expect.objectContaining({
      apikey: 'secret',
      module: 'account',
      action: 'tokenlist',
      address: account,
    })
  );
});

it.each([403, 429, 503])(
  'fails HTTP %i immediately without automatic retries or caching failure',
  async (status) => {
    (fetch as jest.Mock).mockResolvedValueOnce(response({}, status, '120'));
    await expect(
      fetchOwnedTokenRows('https://failed.test/api', account, 1)
    ).rejects.toMatchObject({
      retryAfterMs: 120_000,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    (fetch as jest.Mock).mockResolvedValueOnce(
      response({ status: '1', result: [] })
    );
    await expect(
      fetchOwnedTokenRows('https://failed.test/api', account, 1)
    ).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  }
);

it('honors HTTP-date Retry-After and caps excessive cooldowns', async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(
    response({}, 429, new Date(Date.now() + 90_000).toUTCString())
  );
  await expect(
    fetchOwnedTokenRows('https://date.test/api', account, 1)
  ).rejects.toMatchObject({ retryAfterMs: 90_000 });
  (fetch as jest.Mock).mockResolvedValueOnce(response({}, 429, '99999999'));
  await expect(
    fetchOwnedTokenRows('https://cap.test/api', account, 1)
  ).rejects.toMatchObject({ retryAfterMs: 900_000 });
});

it.each([
  { error: 'unavailable' },
  { items: [], link: { next: 'https://attacker.test/page' } },
  { items: [], link: { nextToken: { invalid: true } } },
])(
  'rejects malformed holdings or pagination rather than reporting an empty wallet',
  async (data) => {
    (fetch as jest.Mock).mockResolvedValue(response(data));
    await expect(fetchOwnedTokenRows(API, account, 1)).rejects.toBeInstanceOf(
      TokenDiscoveryError
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

it('rejects cursor loops without returning a partial list', async () => {
  (fetch as jest.Mock).mockResolvedValue(
    response({ items: [holding], link: { nextToken: 'loop' } })
  );
  const result = expect(fetchOwnedTokenRows(API, account, 1)).rejects.toThrow(
    'pagination limit'
  );
  await jest.advanceTimersByTimeAsync(550);
  await result;
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('caps a provider that produces endless distinct pages', async () => {
  let cursor = 0;
  (fetch as jest.Mock).mockImplementation(async () =>
    response({
      items: [holding],
      link: { nextToken: `page-${cursor++}` },
    })
  );
  const result = expect(fetchOwnedTokenRows(API, account, 1)).rejects.toThrow(
    'pagination limit'
  );
  await jest.advanceTimersByTimeAsync(550 * 10);
  await result;
  expect(fetch).toHaveBeenCalledTimes(10);
});

it('aborts a stalled request after the overall deadline without retrying', async () => {
  (fetch as jest.Mock).mockImplementation(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      })
  );
  const result = expect(fetchOwnedTokenRows(API, account, 1)).rejects.toThrow(
    'aborted'
  );
  await jest.advanceTimersByTimeAsync(15_000);
  await result;
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('rejects mismatched networks and invalid addresses before requesting', async () => {
  await expect(fetchOwnedTokenRows(API, account, 8453)).rejects.toThrow(
    'does not match'
  );
  await expect(fetchOwnedTokenRows(API, '../../secret', 1)).rejects.toThrow(
    'Invalid'
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(isRoutescanApiUrl(API, 1)).toBe(true);
  expect(
    isRoutescanApiUrl(
      'https://api.routescan.io.attacker.test/v2/network/mainnet/evm/1',
      1
    )
  ).toBe(false);
});
