import { createOwnedUtxoBlockbookRead } from './utxoBlockbookReads';

const url = 'https://blockbook.invalid';
const funding = `${url}/api/v2/utxo/selected-address`;
const scope = {
  address: 'selected-address',
  kind: 'wallet',
  url,
  xpub: 'selected-xpub',
} as const;

const reply = (source: string, body: string) => {
  const response = new Response(body);
  Object.defineProperty(response, 'url', { value: source });
  return response;
};

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
