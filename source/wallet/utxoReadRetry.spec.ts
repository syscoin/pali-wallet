jest.unmock('syscoinjs-lib');

import { utils as syscoinUtils } from 'syscoinjs-lib';

import { createOwnedUtxoBlockbookRead } from './utxoBlockbookReads';
import { fetchUtxoRead } from './utxoReadRetry';

const url = 'https://blockbook.invalid/api/v2/utxo/captured-address';
const current = () => undefined;
const options = (signal = new AbortController().signal) => ({
  method: 'GET',
  signal,
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('observes a response when transport aborts synchronously during dispatch', async () => {
  const controller = new AbortController();
  const response = new Response('{}');
  const cancel = jest.spyOn(response.body!, 'cancel');
  const transport = jest.fn(async () => {
    controller.abort();
    return response;
  });
  await expect(
    fetchUtxoRead(transport, url, options(controller.signal), current)
  ).rejects.toMatchObject({ name: 'AbortError' });
  await jest.advanceTimersByTimeAsync(0);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each([429, 503])(
  'retries only the same GET after HTTP %s and cancels its body',
  async (status) => {
    const refused = new Response('unavailable', { status });
    const cancel = jest.spyOn(refused.body!, 'cancel');
    const success = new Response('{}');
    const transport = jest
      .fn()
      .mockResolvedValueOnce(refused)
      .mockResolvedValue(success);
    const init = options();
    const pending = fetchUtxoRead(transport, url, init, current);
    await jest.advanceTimersByTimeAsync(999);
    expect(transport).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(success);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls).toEqual([
      [url, init],
      [url, init],
    ]);
  }
);

it('exhausts four attempts once even inside an actual SDK funding read', async () => {
  const cancelled: jest.SpyInstance[] = [];
  const transport = jest.fn(async () => {
    const response = new Response('busy', { status: 503 });
    cancelled.push(jest.spyOn(response.body!, 'cancel'));
    return response;
  });
  const init = options();
  const owned = createOwnedUtxoBlockbookRead(
    {
      kind: 'wallet',
      url: 'https://blockbook.invalid',
      address: 'captured-address',
      xpub: '',
    },
    init.signal,
    current,
    transport
  );
  const pending = syscoinUtils.fetchBackendUTXOS(
    'https://blockbook.invalid',
    'captured-address',
    undefined,
    owned
  );
  const rejected = expect(pending).rejects.toThrow(
    'Blockbook read unavailable'
  );
  await jest.advanceTimersByTimeAsync(7_000);
  await rejected;
  expect(transport).toHaveBeenCalledTimes(4);
  expect(cancelled.every((cancel) => cancel.mock.calls.length === 1)).toBe(
    true
  );
  await jest.advanceTimersByTimeAsync(30_000);
  expect(transport).toHaveBeenCalledTimes(4);
});

it.each([
  new Error('503 Service Unavailable'),
  Object.assign(new Error('Too many requests'), {
    status: 429,
    response: { status: 503 },
  }),
])(
  'does not interpret a thrown transport error as an HTTP retry response',
  async (error) => {
    const transport = jest.fn().mockRejectedValue(error);
    const init = options();
    await expect(
      syscoinUtils.retryWithBackoff(
        () => fetchUtxoRead(transport, url, init, current),
        0,
        init.signal
      )
    ).rejects.toThrow('Blockbook read unavailable');
    expect(transport).toHaveBeenCalledTimes(1);
  }
);

it('does not retry parsing errors or other HTTP statuses', async () => {
  for (const status of [200, 400, 401, 500, 502]) {
    const response = new Response('{', { status });
    const transport = jest.fn().mockResolvedValue(response);
    await expect(
      (await fetchUtxoRead(transport, url, options(), current)).json()
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  }
});

it('refuses POST, a missing signal, or a GET body without invoking transport', async () => {
  const transport = jest.fn();
  for (const init of [
    { ...options(), method: 'POST' },
    { method: 'GET' },
    { ...options(), body: 'raw bytes' },
  ])
    await expect(fetchUtxoRead(transport, url, init, current)).rejects.toThrow(
      'Invalid'
    );
  expect(transport).not.toHaveBeenCalled();
});

it('cancels a backoff at the existing owner deadline without restarting a timer', async () => {
  const controller = new AbortController();
  const transport = jest.fn(async () => new Response('busy', { status: 503 }));
  setTimeout(() => controller.abort(), 1_500);
  const pending = fetchUtxoRead(
    transport,
    url,
    options(controller.signal),
    current
  );
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  await jest.advanceTimersByTimeAsync(1_500);
  await rejected;
  await jest.advanceTimersByTimeAsync(10_000);
  expect(transport).toHaveBeenCalledTimes(2);
});

it('checks retirement before the next attempt without sending another request', async () => {
  let active = true;
  const transport = jest.fn(async () => new Response('busy', { status: 429 }));
  const pending = fetchUtxoRead(transport, url, options(), () => {
    if (!active) throw new Error('Owner retired');
  });
  const rejected = expect(pending).rejects.toThrow('Owner retired');
  await jest.advanceTimersByTimeAsync(0);
  active = false;
  await jest.advanceTimersByTimeAsync(1_000);
  await rejected;
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each(['abort', 'retire'])(
  'discards a late response after %s',
  async (operation) => {
    const controller = new AbortController();
    let active = true,
      resolve!: (response: Response) => void;
    const transport = jest.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        })
    );
    const pending = fetchUtxoRead(
      transport,
      url,
      options(controller.signal),
      () => {
        if (!active) throw new Error('Owner retired');
      }
    );
    const rejected = expect(pending).rejects.toThrow();
    if (operation === 'abort') controller.abort();
    else active = false;
    const late = new Response('{}');
    const cancel = jest.spyOn(late.body!, 'cancel');
    resolve(late);
    await rejected;
    await jest.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
  }
);
