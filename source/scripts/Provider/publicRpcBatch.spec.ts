/** @jest-environment node */
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring/cjs/providers.js';

import { readPublicRpc } from './publicRpcBatch';

const address = (index: number) => `0x${index.toString(16).padStart(40, '0')}`;
const request = (index: number) => ({
  method: 'eth_getBalance' as const,
  params: [address(index), 'latest'],
});
const check = () => undefined;

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
  await Promise.resolve();
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
  await Promise.resolve();
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
