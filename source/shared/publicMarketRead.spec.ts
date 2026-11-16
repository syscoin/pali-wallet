import { readPublicJson, readPublicMarketJson } from './publicMarketRead';

const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

it('shares identical public JSON while cancelling only the retired subscriber', async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let cancellations = 0;
  let physical!: AbortSignal;
  const fetcher = jest.fn(async (_url, init) => {
    physical = init.signal;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
        },
        cancel() {
          cancellations++;
        },
      })
    );
  });
  const a = new AbortController(),
    b = new AbortController();
  const first = readPublicJson(fetcher, url, 1024, a.signal);
  const rejected = expect(first).rejects.toThrow('cancelled');
  const second = readPublicJson(fetcher, url, 1024, b.signal);
  await flush();
  a.abort();
  await rejected;
  expect(physical.aborted).toBe(false);
  body.enqueue(new TextEncoder().encode('{"price":2}'));
  body.close();
  await expect(second).resolves.toEqual({ price: 2 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(cancellations).toBeLessThanOrEqual(1);
});

it('cancels a held body after the last owner leaves and admits new-source work', async () => {
  let cancelled = false;
  let physical!: AbortSignal;
  const fetcher = jest.fn(async (_url, init) => {
    physical = init.signal;
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      })
    );
  });
  const owner = new AbortController();
  const first = readPublicJson(fetcher, url, 1024, owner.signal);
  const rejected = expect(first).rejects.toThrow('cancelled');
  await flush();
  owner.abort();
  await rejected;
  await flush();
  expect(physical.aborted).toBe(true);
  expect(cancelled).toBe(true);
  fetcher.mockResolvedValueOnce(new Response('{"price":4}'));
  await expect(
    readPublicJson(fetcher, url + '&new=1', 1024, new AbortController().signal)
  ).resolves.toEqual({ price: 4 });
});

it('bounds the body duration and preserves the restricted market entry point', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  let cancelled = false;
  const fetcher = jest.fn(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        })
      )
  );
  try {
    const pending = readPublicJson(
      fetcher,
      url,
      1024,
      new AbortController().signal
    );
    const rejected = expect(pending).rejects.toThrow();
    await flush();
    await jest.advanceTimersByTimeAsync(8001);
    await rejected;
    await flush();
    expect(cancelled).toBe(true);
    await expect(
      readPublicMarketJson(fetcher, url, 1024, new AbortController().signal)
    ).rejects.toThrow('Invalid market URL');
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
