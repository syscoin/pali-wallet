import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

import { findUserTxsInProviderByBlocksRange } from './utils';

const hash = (height: number) =>
  `0x${BigInt(height + 1)
    .toString(16)
    .padStart(64, '0')}`;
const wire: any[] = [];
let rejectBatches = false;
let rateLimit = false;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      vault: {
        isBitcoinBased: false,
        activeNetwork: { chainId: 1, url: 'https://wire.example/' },
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: { HDAccount: { 0: { address: `0x${'11'.repeat(20)}` } } },
      },
    }),
  },
}));
const originalFetch = global.fetch;
beforeEach(() => {
  wire.length = 0;
  rejectBatches = false;
  rateLimit = false;
  global.fetch = jest.fn(async (_url, options) => {
    const input = JSON.parse(options!.body as string);
    wire.push(input);
    const response = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (rateLimit) return response({ error: 'Too many requests' }, 429);
    if (Array.isArray(input) && rejectBatches)
      return response({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Batch requests are not supported' },
      });
    const one = (call: any) => {
      if (call.method === 'eth_chainId')
        return { jsonrpc: '2.0', id: call.id, result: '0x1' };
      if (call.method !== 'eth_getBlockByNumber')
        throw new Error('Unexpected RPC');
      const height =
        call.params[0] === 'latest' ? 20 : Number(BigInt(call.params[0]));
      return {
        jsonrpc: '2.0',
        id: call.id,
        result: {
          number: `0x${height.toString(16)}`,
          hash: hash(height),
          parentHash: hash(height - 1),
          timestamp: '0x6553f100',
          transactions: [],
        },
      };
    };
    return response(
      Array.isArray(input) ? input.map(one).reverse() : one(input)
    );
  }) as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});
const create = () =>
  new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://wire.example/',
    1
  );

it('uses the packed SDK batch parser and only headers on a same-head refresh', async () => {
  const provider = create();
  try {
    expect(await findUserTxsInProviderByBlocksRange(provider, 10)).toEqual([]);
    expect(wire.filter(Array.isArray)).toHaveLength(2);
    expect(wire.flat().filter((call) => call.params[1] === true)).toHaveLength(
      11
    );
    wire.length = 0;
    expect(await findUserTxsInProviderByBlocksRange(provider, 10)).toEqual([]);
    expect(wire.flat().filter((call) => call.params[1] === true)).toHaveLength(
      0
    );
    expect(
      wire.flat().filter((call) => call.method === 'eth_chainId')
    ).toHaveLength(2);
  } finally {
    provider.destroy();
  }
});
it('falls back from an explicit batch refusal to bounded single JSON objects', async () => {
  rejectBatches = true;
  const provider = create();
  try {
    expect(await findUserTxsInProviderByBlocksRange(provider, 10)).toEqual([]);
    expect(wire.filter(Array.isArray)).toHaveLength(1);
    expect(
      wire.filter((call) => !Array.isArray(call) && call.params[1] === true)
    ).toHaveLength(11);
  } finally {
    provider.destroy();
  }
});
it('terminates on rate limits without continuing the history scan', async () => {
  rateLimit = true;
  const provider = create();
  try {
    await expect(
      findUserTxsInProviderByBlocksRange(provider, 10)
    ).rejects.toThrow();
    expect(wire.length).toBeLessThanOrEqual(2);
  } finally {
    provider.destroy();
  }
});
