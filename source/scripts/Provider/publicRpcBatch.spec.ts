/** @jest-environment node */
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring/cjs/providers.js';
import { MessageChannel } from 'node:worker_threads';

import { readPublicRpc } from './publicRpcBatch';

const address = (index: number) => `0x${index.toString(16).padStart(40, '0')}`;
const request = (index: number) => ({
  method: 'eth_getBalance' as const,
  params: [address(index), 'latest'],
});
const check = () => undefined;

it('returns independent copies of a supported large public response in a mixed batch', async () => {
  const value = {
    oldestBlock: '0x1',
    baseFeePerGas: Array(1025).fill('0x1'),
    gasUsedRatio: Array(1024).fill(0.5),
    reward: Array.from({ length: 1024 }, () => Array(10).fill('0x1')),
  };
  const request = {
    method: 'eth_feeHistory' as const,
    params: ['0x400', 'latest', Array.from({ length: 10 }, (_, i) => i)],
  };
  const wire: unknown[] = [];
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://rpc.invalid',
    1,
    {
      fetch: async (_url, init) => {
        const rows = JSON.parse(String(init.body));
        wire.push(rows);
        return Response.json(
          rows.map((row: { id: number; method: string }) => ({
            jsonrpc: '2.0',
            id: row.id,
            ...(row.method === 'eth_feeHistory'
              ? { result: value }
              : { error: { code: -32000, message: 'Unavailable' } }),
          }))
        );
      },
    }
  );
  try {
    const first = readPublicRpc(
      provider,
      'selected',
      request,
      new AbortController().signal,
      check
    );
    const second = readPublicRpc(
      provider,
      'selected',
      request,
      new AbortController().signal,
      check
    );
    const failed = expect(
      readPublicRpc(
        provider,
        'selected',
        { method: 'eth_blockNumber', params: [] },
        new AbortController().signal,
        check
      )
    ).rejects.toThrow('Unavailable');
    const results = (await Promise.all([first, second])) as (typeof value)[];
    await failed;
    results[0]!.reward[0]![0] = 'changed';
    expect(results[1]).toEqual(value);
    expect(wire).toHaveLength(1);
    expect(wire[0]).toHaveLength(2);
  } finally {
    provider.destroy();
  }
});

it('sends twenty distinct same-scope public reads in one actual SDK batch', async () => {
  const wire: unknown[] = [];
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://rpc.invalid',
    1,
    {
      fetch: async (_url, init) => {
        const rows = JSON.parse(init.body as string);
        wire.push(rows);
        return new Response(
          JSON.stringify(
            rows.map((row: any, index: number) => ({
              jsonrpc: '2.0',
              id: row.id,
              result: `0x${index.toString(16)}`,
            }))
          ),
          { headers: { 'content-type': 'application/json' } }
        );
      },
    }
  );
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        readPublicRpc(
          provider,
          'selected',
          request(index),
          new AbortController().signal,
          check
        )
      )
    );
    expect(results).toEqual(
      Array.from({ length: 20 }, (_, index) => `0x${index.toString(16)}`)
    );
    expect(wire).toHaveLength(1);
    expect(wire[0]).toHaveLength(20);
  } finally {
    provider.destroy();
  }
});

it('keeps independent request cancellation and copies results through caller policy', async () => {
  let release!: (value: PromiseSettledResult<unknown>[]) => void;
  const provider = {
    send: jest.fn(),
    readMany: jest.fn(
      (requests: readonly unknown[], options: { signal: AbortSignal }) =>
        new Promise<PromiseSettledResult<unknown>[]>((resolve) => {
          expect(requests).toHaveLength(2);
          expect(options.signal.aborted).toBe(false);
          release = resolve;
        })
    ),
  };
  const first = new AbortController();
  const second = new AbortController();
  const a = readPublicRpc(
    provider,
    'selected',
    request(1),
    first.signal,
    check
  );
  const rejected = expect(a).rejects.toMatchObject({ code: 4001 });
  const b = readPublicRpc(
    provider,
    'selected',
    request(2),
    second.signal,
    check
  );
  await new Promise((resolve) => setTimeout(resolve, 8));
  first.abort();
  await rejected;
  expect(provider.readMany.mock.calls[0][1].signal.aborted).toBe(false);
  release([
    { status: 'fulfilled', value: '0x1' },
    { status: 'fulfilled', value: '0x2' },
  ]);
  await expect(b).resolves.toBe('0x2');
  expect(provider.send).not.toHaveBeenCalled();
});

it('aborts the physical batch after its last subscriber cancels', async () => {
  const provider = {
    send: jest.fn(),
    readMany: jest.fn(
      (requests: readonly unknown[], options: { signal: AbortSignal }) => {
        expect(requests).toHaveLength(1);
        expect(options.signal.aborted).toBe(false);
        return new Promise<PromiseSettledResult<unknown>[]>(() => undefined);
      }
    ),
  };
  const controller = new AbortController();
  const pending = readPublicRpc(
    provider,
    'selected',
    request(1),
    controller.signal,
    check
  );
  const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
  await new Promise((resolve) => setTimeout(resolve, 8));
  controller.abort();
  await rejected;
  expect(provider.readMany.mock.calls[0][1].signal.aborted).toBe(true);
});

it('preserves scope isolation, member failure and single-attempt control calls', async () => {
  const failure = new Error('member failed');
  const provider = {
    send: jest.fn(async () => false),
    readMany: jest.fn(async () => [
      { status: 'rejected' as const, reason: failure },
    ]),
  };
  const a = readPublicRpc(
    provider,
    'account-a',
    request(1),
    new AbortController().signal,
    check
  );
  const b = readPublicRpc(
    provider,
    'account-b',
    request(2),
    new AbortController().signal,
    check
  );
  await expect(a).rejects.toBe(failure);
  await expect(b).rejects.toBe(failure);
  expect(provider.readMany).toHaveBeenCalledTimes(2);
  await expect(
    readPublicRpc(
      provider,
      'account-a',
      { method: 'eth_uninstallFilter', params: ['filter'] },
      new AbortController().signal,
      check
    )
  ).resolves.toBe(false);
  expect(provider.send).toHaveBeenCalledTimes(1);
});

it('rejects a malformed batch count and does not publish after context changes', async () => {
  const provider = {
    send: jest.fn(),
    readMany: jest.fn(async () => [] as PromiseSettledResult<unknown>[]),
  };
  await expect(
    readPublicRpc(
      provider,
      'selected',
      request(1),
      new AbortController().signal,
      check
    )
  ).rejects.toThrow('Invalid public RPC response');
  let current = true;
  const guard = () => {
    if (!current) throw new Error('context changed');
  };
  provider.readMany.mockImplementationOnce(async () => {
    current = false;
    return [{ status: 'fulfilled', value: '0x1' }];
  });
  await expect(
    readPublicRpc(
      provider,
      'selected',
      request(1),
      new AbortController().signal,
      guard
    )
  ).rejects.toThrow('context changed');
  expect(provider.send).not.toHaveBeenCalled();
});

it.each([false, true])(
  'collects separate message events and joins identical reads (%s)',
  async (identical) => {
    const wire: any[] = [];
    const provider = new CustomJsonRpcProvider(
      new AbortController().signal,
      'https://rpc.invalid',
      1,
      {
        fetch: async (_url, init) => {
          const body = JSON.parse(init.body as string);
          const rows = Array.isArray(body) ? body : [body];
          wire.push(body);
          const results = rows.map((row: any) => ({
            jsonrpc: '2.0',
            id: row.id,
            result: '0x1',
          }));
          return Response.json(Array.isArray(body) ? results : results[0]);
        },
      }
    );
    const channel = new MessageChannel();
    const pending: Promise<unknown>[] = [];
    try {
      await new Promise<void>((resolve) => {
        channel.port1.on('message', (index: number) => {
          pending.push(
            readPublicRpc(
              provider,
              'document',
              request(identical ? 0 : index),
              new AbortController().signal,
              check
            )
          );
          if (pending.length === 4) resolve();
        });
        for (let index = 0; index < 4; index++)
          channel.port2.postMessage(index);
      });
      expect(await Promise.all(pending)).toEqual(['0x1', '0x1', '0x1', '0x1']);
      expect(wire).toHaveLength(1);
      expect(Array.isArray(wire[0]) ? wire[0].length : 1).toBe(
        identical ? 1 : 4
      );
    } finally {
      channel.port1.close();
      channel.port2.close();
      provider.destroy();
    }
  }
);

it('joins held reads after collection, clones each result and retires completed values', async () => {
  let release!: (value: PromiseSettledResult<unknown>[]) => void;
  const provider = {
    send: jest.fn(),
    readMany: jest.fn(
      () =>
        new Promise<PromiseSettledResult<unknown>[]>((resolve) => {
          release = resolve;
        })
    ),
  };
  const first = readPublicRpc(
    provider,
    'selected',
    request(1),
    new AbortController().signal,
    check
  );
  await new Promise((resolve) => setTimeout(resolve, 8));
  const second = readPublicRpc(
    provider,
    'selected',
    request(1),
    new AbortController().signal,
    check
  );
  const source = { values: ['original'] };
  release([{ status: 'fulfilled', value: source }]);
  const values = (await Promise.all([first, second])) as (typeof source)[];
  values[0]!.values[0] = 'changed';
  expect(values[1]).toEqual({ values: ['original'] });
  expect(source).toEqual({ values: ['original'] });
  expect(provider.readMany).toHaveBeenCalledTimes(1);
  provider.readMany.mockResolvedValueOnce([
    { status: 'fulfilled', value: 'fresh' },
  ]);
  await expect(
    readPublicRpc(
      provider,
      'selected',
      request(1),
      new AbortController().signal,
      check
    )
  ).resolves.toBe('fresh');
  expect(provider.readMany).toHaveBeenCalledTimes(2);
});

it('detaches one identical subscriber without cancelling a surviving subscriber', async () => {
  let release!: (value: PromiseSettledResult<unknown>[]) => void;
  const provider = {
    send: jest.fn(),
    readMany: jest.fn(
      (_requests: readonly unknown[], _options: { signal: AbortSignal }) =>
        new Promise<PromiseSettledResult<unknown>[]>((resolve) => {
          expect(_requests).toHaveLength(1);
          expect(_options.signal.aborted).toBe(false);
          release = resolve;
        })
    ),
  };
  const controller = new AbortController();
  const first = readPublicRpc(
    provider,
    'selected',
    request(1),
    controller.signal,
    check
  );
  const rejected = expect(first).rejects.toMatchObject({ code: 4001 });
  const second = readPublicRpc(
    provider,
    'selected',
    request(1),
    new AbortController().signal,
    check
  );
  await new Promise((resolve) => setTimeout(resolve, 8));
  controller.abort();
  await rejected;
  expect(provider.readMany.mock.calls[0]![1].signal.aborted).toBe(false);
  release([{ status: 'fulfilled', value: '0x1' }]);
  await expect(second).resolves.toBe('0x1');
  expect(provider.readMany.mock.calls[0]![0]).toHaveLength(1);
});

it('keeps every call field and block selector in the join key', async () => {
  const provider = {
    send: jest.fn(),
    readMany: jest.fn(async (rows: readonly unknown[]) =>
      rows.map(() => ({ status: 'fulfilled' as const, value: '0x' }))
    ),
  };
  const transaction = {
    to: address(1),
    from: address(2),
    data: '0x1234',
    value: '0x1',
    gas: '0x5208',
    gasPrice: '0x1',
  };
  const requests = [
    { ...transaction },
    {
      gasPrice: '0x1',
      gas: '0x5208',
      value: '0x1',
      data: '0x1234',
      from: address(2),
      to: address(1),
    },
    ...Object.entries({
      to: address(3),
      from: address(4),
      data: '0xabcd',
      value: '0x2',
      gas: '0x5300',
      gasPrice: '0x2',
    }).map(([field, value]) => ({ ...transaction, [field]: value })),
  ].map((call) => ({
    method: 'eth_call' as const,
    params: [call, 'latest'],
  }));
  requests.push({ method: 'eth_call', params: [transaction, 'pending'] });
  const calls = requests.map((query) =>
    readPublicRpc(
      provider,
      'selected',
      query,
      new AbortController().signal,
      check
    )
  );
  await Promise.all(calls);
  expect(provider.readMany).toHaveBeenCalledTimes(1);
  expect(provider.readMany.mock.calls[0]![0]).toHaveLength(requests.length - 1);
});

it('starts at most one bounded collection interval and excludes cancelled queued requests', async () => {
  jest.useFakeTimers();
  const provider = {
    send: jest.fn(),
    readMany: jest.fn(async (rows: readonly unknown[]) =>
      rows.map(() => ({ status: 'fulfilled' as const, value: '0x1' }))
    ),
  };
  try {
    const cancelled = new AbortController();
    const first = readPublicRpc(
      provider,
      'selected',
      request(0),
      cancelled.signal,
      check
    );
    const rejected = expect(first).rejects.toMatchObject({ code: 4001 });
    cancelled.abort();
    await rejected;
    const second = readPublicRpc(
      provider,
      'selected',
      request(1),
      new AbortController().signal,
      check
    );
    await jest.advanceTimersByTimeAsync(3);
    const third = readPublicRpc(
      provider,
      'selected',
      request(2),
      new AbortController().signal,
      check
    );
    expect(provider.readMany).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(await Promise.all([second, third])).toEqual(['0x1', '0x1']);
    expect(provider.readMany).toHaveBeenCalledTimes(1);
    expect(provider.readMany.mock.calls[0]![0]).toHaveLength(2);
  } finally {
    jest.useRealTimers();
  }
});

it('bounds retained subscribers across scope keys and frees capacity after cancellation', async () => {
  const provider = { send: jest.fn(), readMany: jest.fn(async () => []) };
  const controllers = Array.from({ length: 128 }, () => new AbortController());
  const pending = controllers.map((controller, index) =>
    readPublicRpc(
      provider,
      `scope-${index}`,
      request(1),
      controller.signal,
      check
    ).catch((error) => error)
  );
  await expect(
    readPublicRpc(
      provider,
      'overflow',
      request(1),
      new AbortController().signal,
      check
    )
  ).rejects.toThrow('Too many public reads');
  controllers.forEach((controller) => controller.abort());
  await Promise.all(pending);
  provider.readMany.mockResolvedValueOnce([
    { status: 'fulfilled', value: '0x1' },
  ] as never);
  await expect(
    readPublicRpc(
      provider,
      'fresh',
      request(1),
      new AbortController().signal,
      check
    )
  ).resolves.toBe('0x1');
});
