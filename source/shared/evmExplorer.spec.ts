/** @jest-environment node */
import { buildAccountHistoryUrl, createRoutescanFetch } from './evmExplorer';

const API = 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
const ADDRESS = `0x${'12'.repeat(20)}`;
const response = {} as Response;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(60_001);
});
afterEach(() => jest.useRealTimers());

it.each(['txlist', 'tokentx', 'pendingtxlist'])(
  'bounds %s freshness to the dispatch-time 30-second cache window',
  async (action) => {
    const fetcher = jest.fn().mockResolvedValue(response);
    const read = createRoutescanFetch(fetcher);
    const signal = new AbortController().signal;
    const url = buildAccountHistoryUrl(API, ADDRESS, action, 1).toString();
    await read(url, { signal });
    const same = read(url, { signal });
    await jest.advanceTimersByTimeAsync(550);
    await same;
    const next = read(url, { signal });
    jest.setSystemTime(90_001);
    await jest.advanceTimersByTimeAsync(550);
    await next;
    const urls = fetcher.mock.calls.map(([value]) => new URL(value));
    expect(
      urls.map((value) => value.searchParams.get('_pali_refresh'))
    ).toEqual(['2', '2', '3']);
    for (const value of urls) {
      value.searchParams.delete('_pali_refresh');
      expect(value.toString()).toBe(url);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
  }
);

it('preserves query scope and API-key headers while replacing a supplied freshness value', async () => {
  const fetcher = jest.fn().mockResolvedValue(response);
  const read = createRoutescanFetch(fetcher);
  const url = buildAccountHistoryUrl(
    `${API}?apiKey=public-fixture-key&tenant=example`,
    ADDRESS,
    'txlist',
    2,
    20
  );
  url.searchParams.set('_pali_refresh', 'untrusted');
  await read(url.toString(), {
    signal: new AbortController().signal,
    headers: { Accept: 'application/json' },
  });
  const [input, init] = fetcher.mock.calls[0];
  const actual = new URL(input);
  expect(actual.searchParams.getAll('_pali_refresh')).toEqual(['2']);
  expect(actual.searchParams.get('tenant')).toBe('example');
  expect(actual.searchParams.get('address')).toBe(ADDRESS);
  expect(actual.searchParams.get('page')).toBe('2');
  expect(actual.searchParams.get('offset')).toBe('20');
  expect(actual.searchParams.has('apikey')).toBe(false);
  expect(actual.searchParams.has('apiKey')).toBe(false);
  expect(init.headers.get('apikey')).toBe('public-fixture-key');
  expect(init.headers.get('Accept')).toBe('application/json');
});

it.each([
  ['https://explorer.example/api?module=account&action=txlist', 'GET'],
  [
    'https://api.routescan.io.evil.example/v2/network/mainnet/evm/1/etherscan/api?module=account&action=txlist',
    'GET',
  ],
  [
    'https://api.routescan.io/v2/network/mainnet/evm/1/address/example/erc20-holdings',
    'GET',
  ],
  [API + '?module=proxy&action=eth_blockNumber', 'GET'],
  [API + '?module=account&action=balance', 'GET'],
  [API + '?module=account&action=tokenlist', 'GET'],
  [API + '?module=account&action=txlist', 'POST'],
])('does not alter unrelated transport request %s', async (url, method) => {
  const fetcher = jest.fn().mockResolvedValue(response);
  await createRoutescanFetch(fetcher)(url, {
    method,
    signal: new AbortController().signal,
  });
  expect(fetcher.mock.calls[0][0]).toBe(url);
});

it('keeps pacing and rejects a cancelled or retired owner before dispatch', async () => {
  const fetcher = jest.fn().mockResolvedValue(response);
  const read = createRoutescanFetch(fetcher);
  const url = buildAccountHistoryUrl(API, ADDRESS, 'txlist').toString();
  const first = new AbortController();
  await read(url, { signal: first.signal });
  const cancelled = new AbortController();
  const next = read(url, { signal: cancelled.signal });
  const rejected = expect(next).rejects.toThrow('timed out');
  cancelled.abort();
  await jest.advanceTimersByTimeAsync(550);
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
  const retired = read(url, { signal: first.signal }, () => {
    throw Error('Owner retired');
  });
  await expect(retired).rejects.toThrow('Owner retired');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([-600_000, 600_000])(
  'paces from elapsed time after a wall-clock change of %sms',
  async (change) => {
    const dispatches: number[] = [];
    const fetcher = jest.fn(async (url: string) => {
      expect(new URL(url).origin).toBe('https://api.routescan.io');
      dispatches.push(performance.now());
      return response;
    });
    const read = createRoutescanFetch(fetcher);
    const url = buildAccountHistoryUrl(API, ADDRESS, 'txlist').toString();
    await read(url);
    jest.setSystemTime(Date.now() + change);
    const next = read(url);
    await jest.advanceTimersByTimeAsync(549);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await next;
    expect(dispatches[1] - dispatches[0]).toBe(550);
    expect(
      new URL(fetcher.mock.calls[1][0]).searchParams.get('_pali_refresh')
    ).toBe(String(Math.floor(Date.now() / 30_000)));
    expect(jest.getTimerCount()).toBe(0);
  }
);

it('retires an aborted pacing wait immediately without changing dispatch spacing', async () => {
  const fetcher = jest.fn().mockResolvedValue(response);
  const read = createRoutescanFetch(fetcher);
  await read(API);
  const owner = new AbortController();
  let rejected = false;
  const cancelled = read(API, { signal: owner.signal }).catch(() => {
    rejected = true;
  });
  await jest.advanceTimersByTimeAsync(0);
  owner.abort();
  await jest.advanceTimersByTimeAsync(0);
  expect(rejected).toBe(true);
  await cancelled;
  expect(jest.getTimerCount()).toBe(0);
  const next = read(API);
  await jest.advanceTimersByTimeAsync(549);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  await next;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(['caller', 'deadline'])(
  'retires a queued %s without releasing an earlier physical request',
  async (kind) => {
    let finish!: (value: Response) => void;
    const physical = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const fetcher = jest
      .fn()
      .mockReturnValueOnce(physical)
      .mockResolvedValue(response);
    const read = createRoutescanFetch(fetcher);
    const first = read(API, { signal: new AbortController().signal });
    await jest.advanceTimersByTimeAsync(0);
    const owner = new AbortController();
    let rejected = false;
    const cancelled = read(
      API,
      kind === 'caller' ? { signal: owner.signal } : {}
    ).catch(() => {
      rejected = true;
    });
    const following = read(API, {
      signal: new AbortController().signal,
    });
    await jest.advanceTimersByTimeAsync(0);
    if (kind === 'caller') owner.abort();
    await jest.advanceTimersByTimeAsync(kind === 'caller' ? 0 : 15_000);
    expect(rejected).toBe(true);
    await cancelled;
    expect(fetcher).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(550);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(response);
    await first;
    await jest.advanceTimersByTimeAsync(0);
    await following;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  }
);
