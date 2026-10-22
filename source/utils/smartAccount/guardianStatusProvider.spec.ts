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
      fetch.mock.calls
        .slice(1)
        .every(([, options]) => Array.isArray(JSON.parse(options.body)))
    ).toBe(true);
  } finally {
    provider.destroy();
    global.fetch = original;
  }
});

test('refuses missing or malformed live-chain batch capability', async () => {
  await expect(
    guardianStatusProvider({}).send('eth_chainId', [])
  ).rejects.toThrow('unavailable');
  await expect(
    guardianStatusProvider({ _send: async () => [] }).send('eth_chainId', [])
  ).rejects.toThrow('Invalid');
});

test.each([
  [
    { jsonrpc: '2.0', id: 0, result: '0x1' },
    { jsonrpc: '2.0', id: 0, result: '0x2' },
  ],
  [
    { jsonrpc: '2.0', id: 0, result: '0x1' },
    { jsonrpc: '2.0', id: 2, result: '0x2' },
  ],
  [
    { jsonrpc: '2.0', id: 0, result: '0x1' },
    { jsonrpc: '2.0', id: '1', result: '0x2' },
  ],
  [
    { jsonrpc: '2.0', id: 0, result: '0x1' },
    { jsonrpc: '2.0', id: 1, error: { message: 'unavailable' } },
  ],
  [
    { jsonrpc: '2.0', id: 0, result: '0x1' },
    { jsonrpc: '2.0', id: 1, result: '0x2', error: {} },
  ],
  [
    { jsonrpc: '2.0', id: 0, result: '0x1' },
    { id: 1, result: '0x2' },
  ],
  [{ jsonrpc: '2.0', id: 0, result: '0x1' }],
])(
  'rejects malformed mixed responses without a single-call fallback: %j',
  async (...responses) => {
    const _send = jest.fn(async () => responses);
    await expect(
      guardianStatusProvider({ _send }).batch([
        { method: 'eth_chainId', params: [] },
        { method: 'eth_getBlockByNumber', params: ['latest', false] },
      ])
    ).rejects.toThrow('Invalid guardian recovery batch response');
    expect(_send).toHaveBeenCalledTimes(1);
  }
);

test('mixed batches preserve the provider receiver and require its correlated response order', async () => {
  const provider = {
    async _send() {
      expect(this).toBe(provider);
      return [
        { jsonrpc: '2.0', id: 0, result: 'chain' },
        { jsonrpc: '2.0', id: 1, result: 'block' },
      ];
    },
  };
  await expect(
    guardianStatusProvider(provider).batch([
      { method: 'eth_chainId', params: [] },
      { method: 'eth_getBlockByNumber', params: ['latest', false] },
    ])
  ).resolves.toEqual(['chain', 'block']);
});

test('rejects a write before dispatch and does not retry a failed batch', async () => {
  const _send = jest.fn(async () => {
    throw new Error('batch rejected');
  });
  const provider = guardianStatusProvider({ _send });
  await expect(
    provider.send('eth_sendRawTransaction', ['0x00'])
  ).rejects.toThrow('Unsupported');
  expect(_send).not.toHaveBeenCalled();
  await expect(provider.send('eth_chainId', [])).rejects.toThrow(
    'batch rejected'
  );
  expect(_send).toHaveBeenCalledTimes(1);
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
    const requests = JSON.parse(options.body);
    expect(Array.isArray(requests)).toBe(true);
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
      json: async () => replies.reverse(),
    } as Response;
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
