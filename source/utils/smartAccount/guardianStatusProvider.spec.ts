import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring/cjs/providers';

import {
  paliGuardianRecoveryModuleInterface as recoveryInterface,
  paliSmartAccountInterface,
} from './contracts';
import { PALI_INFRASTRUCTURE_BY_ID } from './deployment';
import { readGuardianRecoveryObservation } from './guardianStatus';
import { guardianStatusProvider } from './guardianStatusProvider';

test('uses actual uncached keyring wire chain identity after a same-URL network change', async () => {
  const original = global.fetch;
  let chainId = '0xdee1';
  const fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    const result = (request) => ({
      jsonrpc: '2.0',
      id: request.id,
      result: chainId,
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify(Array.isArray(body) ? body.map(result) : result(body)),
      json: async () => (Array.isArray(body) ? body.map(result) : result(body)),
    };
  });
  global.fetch = fetch as any;
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://fixture.invalid',
    57057
  );
  try {
    expect(await provider.send('eth_chainId', [])).toBe('0xdee1');
    chainId = '0x1';
    // The existing provider intentionally caches the ordinary method.
    expect(await provider.send('eth_chainId', [])).toBe('0xdee1');
    const guarded = guardianStatusProvider(provider);
    expect(await guarded.send('eth_chainId', [])).toBe('0x1');
    await expect(
      readGuardianRecoveryObservation({
        provider: guarded,
        account: `0x${'11'.repeat(20)}`,
        moduleAddress: `0x${'22'.repeat(20)}`,
        chainId: 57057,
      })
    ).rejects.toThrow('network changed');
    expect(
      fetch.mock.calls.slice(1).every(([, options]) => {
        const body = JSON.parse(options.body);
        return (Array.isArray(body) ? body : [body]).every(
          (request) =>
            request.jsonrpc === '2.0' &&
            Number.isSafeInteger(request.id) &&
            ['eth_chainId', 'eth_getBlockByNumber'].includes(request.method)
        );
      })
    ).toBe(true);
  } finally {
    provider.destroy();
    global.fetch = original;
  }
});

test('refuses missing or malformed settled read capability', async () => {
  await expect(
    guardianStatusProvider({}).send('eth_chainId', [])
  ).rejects.toThrow('unavailable');
  await expect(
    guardianStatusProvider({ readMany: async () => [] }).send('eth_chainId', [])
  ).rejects.toThrow('Invalid');
});

test.each([
  [],
  [null],
  [{ status: 'unknown' }],
  [
    { status: 'fulfilled', value: '0x1' },
    { status: 'fulfilled', value: 'extra' },
  ],
])(
  'rejects malformed settled results without a single-call fallback: %j',
  async (...results) => {
    const readMany = jest.fn(async () => results as any);
    await expect(
      guardianStatusProvider({ readMany }).send('eth_chainId', [])
    ).rejects.toThrow('Invalid guardian recovery batch response');
    expect(readMany).toHaveBeenCalledTimes(1);
  }
);

test('retains settled member errors and provider receiver without constructing wire IDs', async () => {
  const failure = new Error('storage unavailable');
  const requests = [
    { method: 'eth_chainId' as const, params: [] },
    {
      method: 'eth_getStorageAt' as const,
      params: [`0x${'11'.repeat(20)}`, '0x0', 'latest'],
    },
  ];
  const provider = {
    async readMany(actual: typeof requests) {
      expect(this).toBe(provider);
      expect(actual).toEqual(requests);
      return [
        { status: 'fulfilled' as const, value: '0x1' },
        { status: 'rejected' as const, reason: failure },
      ];
    },
  };
  expect(await guardianStatusProvider(provider).readMany(requests)).toEqual([
    { status: 'fulfilled', value: '0x1' },
    { status: 'rejected', reason: failure },
  ]);
});

test('rejects a write before dispatch and preserves a failed member error', async () => {
  const failure = new Error('read rejected');
  const readMany = jest.fn(async () => [
    { status: 'rejected' as const, reason: failure },
  ]);
  const provider = guardianStatusProvider({ readMany });
  await expect(
    Reflect.apply(provider.send, provider, ['eth_sendRawTransaction', ['0x00']])
  ).rejects.toThrow('Unsupported');
  expect(readMany).not.toHaveBeenCalled();
  await expect(provider.send('eth_chainId', [])).rejects.toBe(failure);
  expect(readMany).toHaveBeenCalledTimes(1);
});

const ACCOUNT = `0x${'11'.repeat(20)}`;
const GUARDIAN = `0x${'22'.repeat(20)}`;
const OP = `0x${'33'.repeat(32)}`;
const OLD = `0x${'44'.repeat(32)}`;
const ZERO = `0x${'00'.repeat(32)}`;
const BLOCK = {
  number: '0x64',
  hash: `0x${'aa'.repeat(32)}`,
  timestamp: '0x6b49d200',
};
const TIME = Number(BigInt(BLOCK.timestamp));
const MODULE = PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule;
const CODE = `0x${MODULE.deployCalldata!.slice(-5662 * 2)}`;

function wireFixture(active: string) {
  const original = global.fetch;
  const batches: any[][] = [];
  let storageReads = 0;
  let beforeReply = async (request: any) => {
    void request;
  };
  let block = { ...BLOCK };
  global.fetch = jest.fn(async (_url, options: any) => {
    const payload = JSON.parse(options.body);
    const requests = Array.isArray(payload) ? payload : [payload];
    batches.push(requests);
    const replies = await Promise.all(
      requests.map(async (request: any) => {
        await beforeReply(request);
        let result: any;
        switch (request.method) {
          case 'eth_chainId':
            result = '0xdee1';
            break;
          case 'eth_getBlockByNumber':
            result = { ...block };
            break;
          case 'eth_getCode':
            result = CODE;
            break;
          case 'eth_getStorageAt':
            result =
              ++storageReads === 1
                ? active
                : `0x${(TIME - 100).toString(16).padStart(64, '0')}`;
            break;
          case 'eth_call': {
            const data = request.params[0].data;
            if (
              data.startsWith(
                paliSmartAccountInterface.getFunction('isModuleInstalled')
                  .selector
              )
            ) {
              result = paliSmartAccountInterface.encodeFunctionResult(
                'isModuleInstalled',
                [true]
              );
            } else {
              const parsed = recoveryInterface.parseTransaction({ data })!;
              const values: Record<string, any[]> = {
                config: [[600, 1200, 1, true]],
                guardians: [[GUARDIAN]],
                policyEpoch: [7],
              };
              result = recoveryInterface.encodeFunctionResult(
                parsed.name,
                values[parsed.name]
              );
            }
            break;
          }
          default:
            throw new Error(`Unexpected RPC ${request.method}`);
        }
        return { jsonrpc: '2.0', id: request.id, result };
      })
    );
    // Real keyring transport must correlate responses rather than trust order.
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify(
          Array.isArray(payload) ? [...replies].reverse() : replies[0]
        ),
      json: async () =>
        Array.isArray(payload) ? [...replies].reverse() : replies[0],
    } as unknown as Response;
  }) as any;
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://fixture.invalid',
    57057
  );
  return {
    batches,
    read: (knownOperationId?: string) =>
      readGuardianRecoveryObservation({
        provider: guardianStatusProvider(provider),
        account: ACCOUNT,
        moduleAddress: MODULE.address,
        chainId: 57057,
        now: () => TIME * 1000,
        knownOperationId,
      }),
    beforeReply: (callback: typeof beforeReply) => {
      beforeReply = callback;
    },
    reorg: () => {
      block = { ...block, hash: OLD };
    },
    close: () => {
      provider.destroy();
      global.fetch = original;
    },
  };
}

test.each([
  [ZERO, undefined, [2, 6, 2]],
  [OP, undefined, [2, 6, 1, 2]],
  [OP, OP, [2, 6, 1, 2]],
  [OP, OLD, [2, 6, 2, 2]],
] as const)(
  'uses bounded HTTP batches for active=%s known=%s',
  async (active, known, sizes) => {
    const fixture = wireFixture(active);
    try {
      const result = await fixture.read(known);
      expect(result.pending?.operationId ?? null).toBe(
        active === ZERO ? null : OP
      );
      expect(fixture.batches.map((batch) => batch.length)).toEqual(sizes);
      const calls = fixture.batches.flat();
      expect(new Set(calls.map(({ id }) => id)).size).toBe(calls.length);
      expect(
        calls.every(({ method }) => !/sendRaw|sendTransaction/.test(method))
      ).toBe(true);
    } finally {
      fixture.close();
    }
  }
);

test('post-read anchor is dispatched after a held schedule and rejects its intervening reorg', async () => {
  const fixture = wireFixture(OP);
  let release!: () => void;
  let reached!: () => void;
  const atSchedule = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  fixture.beforeReply(async (request) => {
    if (request.method === 'eth_getStorageAt' && fixture.batches.length === 3) {
      reached();
      await held;
      fixture.reorg();
    }
  });
  try {
    const read = fixture.read();
    const rejected = expect(read).rejects.toThrow('block changed');
    await atSchedule;
    expect(fixture.batches).toHaveLength(3);
    expect(
      fixture.batches[2].every(({ method }) => method === 'eth_getStorageAt')
    ).toBe(true);
    release();
    await rejected;
    expect(fixture.batches[3].map(({ method }) => method)).toEqual([
      'eth_getBlockByNumber',
      'eth_chainId',
    ]);
  } finally {
    release?.();
    fixture.close();
  }
});
