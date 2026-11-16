jest.mock('syscoinjs-lib', () => ({
  utils: jest.requireActual('syscoinjs-lib/utils'),
}));

import { createBlockbookAccountHistory } from '../../../../shared/blockbookAccountHistory';

import {
  clearFetchBackendAccountCache,
  fetchBackendAccountCached,
} from './fetchBackendAccountWrapper';

const originalFetch = global.fetch;
const url = 'https://blockbook.test';
const identifier = 'zpub-public-read';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

afterEach(() => {
  clearFetchBackendAccountCache();
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('joins slow SJS HTTP reads until completion and keeps each subscriber independent', async () => {
  jest.useFakeTimers();
  const held = deferred<Response>();
  global.fetch = jest.fn(() => held.promise);
  const firstOwner = new AbortController(),
    secondOwner = new AbortController();
  const first = fetchBackendAccountCached(
    url,
    identifier,
    'details=txs',
    true,
    firstOwner.signal
  );
  await jest.advanceTimersByTimeAsync(6000);
  const second = fetchBackendAccountCached(
    url,
    identifier,
    'details=basic',
    true,
    secondOwner.signal
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const physical = (global.fetch as jest.Mock).mock.calls[0][1]
    .signal as AbortSignal;
  firstOwner.abort();
  await expect(first).rejects.toHaveProperty('name', 'AbortError');
  expect(physical.aborted).toBe(false);
  held.resolve(
    new Response(JSON.stringify({ balance: '1' }), {
      headers: { 'content-type': 'application/json' },
    })
  );
  expect(await second).toHaveProperty('balance', '1');
});

it('cache retirement reaches SJS retry backoff and prevents another HTTP request', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async () => new Response('', { status: 429 }));
  const pending = fetchBackendAccountCached(
    url,
    identifier,
    'details=txs',
    true
  );
  const rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError');
  await jest.advanceTimersByTimeAsync(1);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  clearFetchBackendAccountCache();
  await rejected;
  await jest.advanceTimersByTimeAsync(30_000);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(
    true
  );
});

it('the physical deadline rejects an uncooperative fetch and ignores its late response', async () => {
  jest.useFakeTimers();
  const held = deferred<Response>();
  global.fetch = jest.fn(() => held.promise);
  const pending = fetchBackendAccountCached(
    url,
    identifier,
    'details=txs',
    true
  );
  const rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError');
  await jest.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(
    true
  );
  const cancel = jest.fn(async () => undefined);
  held.resolve({ body: { cancel } } as unknown as Response);
  await jest.advanceTimersByTimeAsync(1);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('cancelled account history does not restart through the txs fallback', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async () => new Response('', { status: 429 }));
  const history = createBlockbookAccountHistory(fetchBackendAccountCached);
  const pending = history.fetchAccountHistory(
    url,
    identifier,
    'details=txsummary&pageSize=30'
  );
  const rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError');
  await jest.advanceTimersByTimeAsync(1);
  clearFetchBackendAccountCache();
  await rejected;
  await jest.advanceTimersByTimeAsync(30_000);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
