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

it('bounds advertised account bytes before the SDK JSON parser runs', async () => {
  const response = new Response('{"balance":"1"}', {
    headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
  });
  const parse = jest.spyOn(response, 'json');
  global.fetch = jest.fn(async () => response);
  await expect(
    fetchBackendAccountCached(url, identifier, 'details=txs', true)
  ).rejects.toHaveProperty('name', 'ResponseSizeLimitError');
  expect(parse).not.toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('stops a streamed account body when it crosses the byte limit', async () => {
  const cancel = jest.fn();
  let chunks = 0;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        chunks++;
        controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
      },
      cancel,
    })
  );
  global.fetch = jest.fn(async () => response);
  await expect(
    fetchBackendAccountCached(url, identifier, 'details=txs', true)
  ).rejects.toHaveProperty('name', 'ResponseSizeLimitError');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(chunks).toBeLessThanOrEqual(4);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it.each([
  { redirected: true, url: `${url}/api/v2/xpub/${identifier}?details=txs` },
  { redirected: false, url: 'https://other-blockbook.test/account' },
])(
  'refuses a redirected or substituted account response (%j)',
  async (identity) => {
    const response = new Response('{"balance":"1"}');
    Object.defineProperties(response, {
      redirected: { value: identity.redirected },
      url: { value: identity.url },
    });
    const parse = jest.spyOn(response, 'json');
    const cancel = jest.spyOn(response.body!, 'cancel');
    global.fetch = jest.fn(async () => response);
    await expect(
      fetchBackendAccountCached(url, identifier, 'details=txs', true)
    ).rejects.toThrow('Blockbook');
    expect(parse).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  }
);

it.each(['http://localhost:3000/blockbook', 'https://custom.test/blockbook'])(
  'keeps custom endpoint paths and uses credential-free nonredirecting GETs (%s)',
  async (endpoint) => {
    global.fetch = jest.fn(async () => new Response('{"balance":"7"}'));
    await expect(
      fetchBackendAccountCached(
        endpoint,
        identifier,
        'details=basic&apikey=custom-test-token',
        true
      )
    ).resolves.toHaveProperty('balance', '7');
    expect(global.fetch).toHaveBeenCalledWith(
      `${endpoint}/api/v2/xpub/${identifier}?details=basic&apikey=custom-test-token`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      })
    );
  }
);

it.each([
  'https://user:secret@blockbook.test',
  'file:///private/account',
  `${url}/#fragment`,
])(
  'refuses unsupported or credential-bearing endpoints before HTTP (%s)',
  async (endpoint) => {
    global.fetch = jest.fn(async () => new Response('{"balance":"1"}'));
    await expect(
      fetchBackendAccountCached(endpoint, identifier, 'details=basic', true)
    ).rejects.toThrow('Blockbook');
    expect(global.fetch).not.toHaveBeenCalled();
  }
);

it('keeps the physical deadline over a body that ignores abort', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn();
  global.fetch = jest.fn(
    async () => new Response(new ReadableStream({ cancel }))
  );
  const pending = fetchBackendAccountCached(
    url,
    identifier,
    'details=txs',
    true
  );
  const rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError');
  await jest.advanceTimersByTimeAsync(30_000);
  await rejected;
  await jest.advanceTimersByTimeAsync(1);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('does not treat malformed JSON containing retry words as an HTTP retry', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async () => new Response('Service Unavailable 503'));
  await expect(
    fetchBackendAccountCached(url, identifier, 'details=txs', true)
  ).rejects.toThrow('Invalid Blockbook response');
  await jest.advanceTimersByTimeAsync(30_000);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('preserves the SDK retry owner for an actual rate limit and then parses the bounded response', async () => {
  jest.useFakeTimers();
  const busy = new Response('busy', { status: 429 });
  const cancel = jest.spyOn(busy.body!, 'cancel');
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(busy)
    .mockResolvedValueOnce(new Response('{"balance":"9"}'));
  const pending = fetchBackendAccountCached(
    url,
    identifier,
    'details=basic',
    true
  );
  await jest.advanceTimersByTimeAsync(1000);
  await expect(pending).resolves.toHaveProperty('balance', '9');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(30_000);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
