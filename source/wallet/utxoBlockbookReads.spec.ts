import { createOwnedUtxoBlockbookRead } from './utxoBlockbookReads';

const url = 'https://blockbook.invalid';
const funding = `${url}/api/v2/utxo/selected-address`;
const raw = (hex: string) => `${url}/api/v2/tx/${hex.repeat(64)}`;
const scope = {
  address: 'selected-address',
  kind: 'wallet',
  url,
  xpub: 'selected-xpub',
} as const;

const reply = (source: string, body: string, status = 200) => {
  const response = new Response(body, { status });
  Object.defineProperty(response, 'url', { value: source });
  return response;
};

it('binds asset metadata to one canonical GUID and a 64 KiB response', async () => {
  const { signal } = new AbortController();
  const endpoint = `${url}/api/v2/asset/123456?details=basic`;
  const fetch = jest.fn(async (source: string) => reply(source, '{}'));
  const read = createOwnedUtxoBlockbookRead(
    { kind: 'asset', assetGuid: '123456', url },
    signal,
    () => undefined,
    fetch
  );
  for (const wrong of [
    funding,
    raw('a'),
    `${url}/api/v2/estimatefee/1`,
    endpoint.replace('123456', '123457'),
    endpoint.replace('basic', 'tokens'),
  ]) {
    await expect(read.fetch(wrong, { method: 'GET', signal })).rejects.toThrow(
      'route'
    );
  }
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    read.fetch(endpoint, { method: 'GET', signal })
  ).resolves.toBeDefined();
  fetch.mockResolvedValueOnce(reply(endpoint, 'x'.repeat(64 * 1024 + 1)));
  await expect(
    read.fetch(endpoint, { method: 'GET', signal })
  ).rejects.toMatchObject({ name: 'ResponseSizeLimitError' });
  expect(() =>
    createOwnedUtxoBlockbookRead(
      { kind: 'asset', assetGuid: '0123456', url },
      signal,
      () => undefined,
      fetch
    )
  ).toThrow('Invalid owned Blockbook asset');
});

it('admits only a captured GET with its exact account and signal', async () => {
  const { signal } = new AbortController();
  const fetch = jest.fn(async (request: string) => reply(request, '[]'));
  const read = createOwnedUtxoBlockbookRead(
    scope,
    signal,
    () => undefined,
    fetch
  );
  const options = { method: 'GET', signal };

  await expect(read.fetch(`${funding}-other`, options)).rejects.toThrow(
    'route'
  );
  await expect(
    read.fetch(funding, { ...options, method: 'POST' })
  ).rejects.toThrow('request');
  await expect(read.fetch(funding, { method: 'GET' })).rejects.toThrow(
    'request'
  );
  await expect(
    read.fetch(`https://other.invalid${new URL(funding).pathname}`, options)
  ).rejects.toThrow('endpoint');
  expect(fetch).not.toHaveBeenCalled();
  const response = await read.fetch(funding, options);
  await expect(response.json()).resolves.toEqual([]);
  expect(fetch).toHaveBeenCalledWith(
    funding,
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
    })
  );
});

it('aborts transport during a held response and discards late bytes', async () => {
  const controller = new AbortController();
  let finish!: (response: Response) => void;
  const fetch = jest.fn<Promise<Response>, [string, RequestInit]>(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  const read = createOwnedUtxoBlockbookRead(
    scope,
    controller.signal,
    () => undefined,
    fetch
  );
  const pending = read.fetch(funding, {
    method: 'GET',
    signal: controller.signal,
  });
  const reject = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await reject;
  expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  const response = reply(funding, '[]');
  const cancel = jest.spyOn(response.body!, 'cancel');
  finish(response);
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('refuses a different response URL or an oversized response before JSON parsing', async () => {
  const { signal } = new AbortController();
  const fetch = jest
    .fn<Promise<Response>, []>()
    .mockResolvedValueOnce(reply(`${funding}-other`, '[]'))
    .mockResolvedValueOnce(reply(funding, 'x'.repeat(1024 * 1024 + 1)));
  const read = createOwnedUtxoBlockbookRead(
    scope,
    signal,
    () => undefined,
    fetch
  );
  const request = () => read.fetch(funding, { method: 'GET', signal });
  await expect(request()).rejects.toThrow('does not match');
  await expect(request()).rejects.toMatchObject({
    name: 'ResponseSizeLimitError',
  });
});

it('binds detail reads to one txid and bounds the decoded body', async () => {
  const { signal } = new AbortController();
  const fetch = jest
    .fn(async (request: string) => reply(request, '{"hex":"abc123"}'))
    .mockResolvedValueOnce(reply(raw('a'), 'x'.repeat(1024 * 1024 + 1)));
  const read = createOwnedUtxoBlockbookRead(
    { kind: 'detail', txid: 'a'.repeat(64), url },
    signal,
    () => undefined,
    fetch
  );
  const request = (endpoint: string) =>
    read.fetch(endpoint, { method: 'GET', signal });
  await expect(request(funding)).rejects.toThrow('route');
  await expect(request(`${url}/api/v2/estimatefee/1`)).rejects.toThrow('route');
  await expect(request(raw('b'))).rejects.toThrow('route');
  expect(fetch).not.toHaveBeenCalled();
  await expect(request(raw('a'))).rejects.toMatchObject({
    name: 'ResponseSizeLimitError',
  });
  const response = await request(raw('a'));
  await expect(response.json()).resolves.toEqual({ hex: 'abc123' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('cancels an in-flight detail body when its wallet operation is retired', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const firstRead = new Promise<void>((resolve) => {
    started = resolve;
  });
  const cancel = jest.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        cancel,
        pull() {
          started();
          return new Promise<void>((resolve) => {
            controller.signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });
        },
      },
      { highWaterMark: 0 }
    )
  );
  Object.defineProperty(response, 'url', { value: raw('a') });
  const fetch = jest.fn<Promise<Response>, [string, RequestInit]>(
    async () => response
  );
  const read = createOwnedUtxoBlockbookRead(
    { kind: 'detail', txid: 'a'.repeat(64), url },
    controller.signal,
    () => undefined,
    fetch
  );
  const pending = read.fetch(raw('a'), {
    method: 'GET',
    signal: controller.signal,
  });
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  await firstRead;
  controller.abort();
  await rejected;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
});

it('shares overlapping raw responses and refuses all cache use once authority changes', async () => {
  const { signal } = new AbortController();
  const options = { method: 'GET', signal };
  const endpoint = raw('a');
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  const fetch = jest.fn(() => pending);
  let current = true;
  const read = createOwnedUtxoBlockbookRead(
    scope,
    signal,
    () => {
      if (!current) throw new Error('Revoked');
    },
    fetch
  );
  const first = read.fetch(endpoint, options);
  const second = read.fetch(endpoint, options);
  resolve(reply(endpoint, '{"hex":"abc123"}'));
  const responses = await Promise.all([first, second]);
  await expect(
    Promise.all(responses.map((response) => response.json()))
  ).resolves.toEqual([{ hex: 'abc123' }, { hex: 'abc123' }]);
  const late = read.fetch(endpoint, options);
  current = false;
  await expect(late).rejects.toThrow('Revoked');
  await expect(read.fetch(endpoint, options)).rejects.toThrow('Revoked');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not retain failed raw reads or reuse a response across owners', async () => {
  const endpoint = raw('a');
  const fetch = jest
    .fn(async () => reply(endpoint, '{}'))
    .mockResolvedValueOnce(reply(endpoint, '', 503))
    .mockRejectedValueOnce(new Error('Offline'));
  const open = () =>
    createOwnedUtxoBlockbookRead(
      scope,
      new AbortController().signal,
      () => undefined,
      fetch
    );
  const request = (read: ReturnType<typeof open>) =>
    read.fetch(endpoint, { method: 'GET', signal: read.signal });
  const first = open();
  await expect(request(first)).resolves.toHaveProperty('status', 503);
  await expect(request(first)).rejects.toThrow('Offline');
  await expect(request(first)).resolves.toHaveProperty('status', 200);
  await expect(request(first)).resolves.toHaveProperty('status', 200);
  await expect(request(open())).resolves.toHaveProperty('status', 200);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('continues to charge distinct raw response bodies against the same operation budget', async () => {
  const { signal } = new AbortController();
  const options = { method: 'GET', signal };
  const body = 'x'.repeat(750 * 1024);
  const fetch = jest.fn(async (request: string) => reply(request, body));
  const read = createOwnedUtxoBlockbookRead(
    scope,
    signal,
    () => undefined,
    fetch
  );
  await expect(read.fetch(raw('a'), options)).resolves.toHaveProperty(
    'status',
    200
  );
  await expect(read.fetch(raw('a'), options)).resolves.toHaveProperty(
    'status',
    200
  );
  await expect(read.fetch(raw('b'), options)).resolves.toHaveProperty(
    'status',
    200
  );
  await expect(read.fetch(raw('c'), options)).rejects.toMatchObject({
    name: 'ResponseSizeLimitError',
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});
