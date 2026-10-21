import { fetchFunctionSignature } from './ethUtil';
import { retryableFetch, retryWithBackoff } from './retryableFetch';

const previousFetch = global.fetch;
let mockFetch: jest.Mock;
const response = (status: number, text: string) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'Synthetic HTTP response',
  text: jest.fn().mockResolvedValue(text),
  json: jest
    .fn()
    .mockResolvedValue(
      JSON.parse('{"results":[{"text_signature":"known()"}]}')
    ),
});
const caught = async (promise: Promise<unknown>) => {
  const result = promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  await jest.runAllTimersAsync();
  return result;
};

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch = jest.fn();
  global.fetch = mockFetch;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.fetch = previousFetch;
});

describe('HTTP status precedence in read-only fetch retries', () => {
  it.each(['0x00000503', '0x00000429'])(
    'does not retry a real signature lookup404 that echoes selector %s',
    async (selector) => {
      mockFetch.mockResolvedValue(response(404, `No record for ${selector}`));
      const started = Date.now();
      const lookup = fetchFunctionSignature(selector);
      await jest.runAllTimersAsync();
      await expect(lookup).resolves.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(
        `https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`
      );
      expect(Date.now() - started).toBe(0);
    }
  );

  it.each([400, 401, 403, 404, 500, 502, 504])(
    'keeps definite HTTP %s authoritative despite retry phrases in the body',
    async (status) => {
      const body = '503 Service Unavailable; 429 Too many requests; rate limit';
      mockFetch.mockResolvedValue(response(status, body));
      const result = await caught(
        retryableFetch('https://synthetic.invalid/read')
      );
      expect((result as any).error.status).toBe(status);
      expect((result as any).error.message).toBe(
        `HTTP error! Status: ${status}. Details: ${body}`
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  );

  it('retains status and original body text on an ordinary non-retry HTTP error', async () => {
    mockFetch.mockResolvedValue(response(404, 'No matching signature'));
    const result = await caught(
      retryableFetch('https://synthetic.invalid/read')
    );
    expect((result as any).error.status).toBe(404);
    expect((result as any).error.message).toBe(
      'HTTP error! Status: 404. Details: No matching signature'
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps an Axios404 authoritative over both its body and a conflicting top-level status', async () => {
    const error = Object.assign(new Error('Missing item 503'), {
      response: { status: 404 },
      status: 429,
    });
    const read = jest.fn().mockRejectedValue(error);
    const result = await caught(retryWithBackoff(read));
    expect((result as any).error).toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps a top-level HTTP404 authoritative over a retry phrase', async () => {
    const error = Object.assign(new Error('Service Unavailable 503'), {
      status: 404,
    });
    const read = jest.fn().mockRejectedValue(error);
    const result = await caught(retryWithBackoff(read));
    expect((result as any).error).toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('recovers HTTP429 after the unchanged first backoff with the same URL/options', async () => {
    const limited = response(429, 'Do not consume retryable error body');
    const success = response(200, '');
    mockFetch.mockResolvedValueOnce(limited).mockResolvedValue(success);
    const options = { method: 'GET', headers: { Accept: 'application/json' } };
    const result = retryableFetch('https://synthetic.invalid/read', options);
    await jest.advanceTimersByTimeAsync(999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(success);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://synthetic.invalid/read',
      'https://synthetic.invalid/read',
    ]);
    expect(
      mockFetch.mock.calls.every(
        ([, init]) =>
          init.method === options.method && init.headers === options.headers
      )
    ).toBe(true);
    expect(limited.text).not.toHaveBeenCalled();
  });

  it('retains exactly three HTTP503 retries with 1s/2s/4s delays and the final status', async () => {
    mockFetch.mockResolvedValue(response(503, 'Unavailable'));
    const result = retryableFetch('https://synthetic.invalid/read').then(
      () => undefined,
      (error) => error
    );
    await jest.advanceTimersByTimeAsync(999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1999);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(3999);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect((await result).status).toBe(503);
    expect((await result).message).toBe('HTTP 503: Synthetic HTTP response');
  });

  it.each([
    '503',
    '429',
    'Service Unavailable',
    'Too many requests',
    'rate limit',
  ])('retains legacy status-less recovery for %s', async (message) => {
    const read = jest
      .fn()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValue('recovered');
    const result = retryWithBackoff(read);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe('recovered');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, '404', 0, NaN])(
    'retains message fallback when no known HTTP status is supplied: %s',
    async (status) => {
      const error = Object.assign(new Error('rate limit'), { status });
      const read = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('recovered');
      const result = retryWithBackoff(read);
      await jest.advanceTimersByTimeAsync(1000);
      await expect(result).resolves.toBe('recovered');
      expect(read).toHaveBeenCalledTimes(2);
    }
  );

  it('preserves an unrelated status-less error without any retry', async () => {
    const error = new Error('Connection refused');
    const read = jest.fn().mockRejectedValue(error);
    const result = await caught(retryWithBackoff(read));
    expect((result as any).error).toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
