import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

import { ownedAssetProvider } from '../assets/utils';
import EvmBalanceController from '../balances/evm';

import { ensureEvmDisplayIdentity } from './evmDisplayIdentity';

const address = `0x${'11'.repeat(20)}`;
const nft = `0x${'22'.repeat(20)}`;

it('shares one cold display identity across native and asset reads, then rejects chain drift before reading addresses', async () => {
  const control = new AbortController();
  let chain = '0x39';
  let now = 100;
  const calls: string[] = [];
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  const provider = new CustomJsonRpcProvider(
    control.signal,
    'https://display.invalid',
    57,
    {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init.body));
        const reply = (item: { id: number; method: string }) => {
          calls.push(item.method);
          return {
            jsonrpc: '2.0',
            id: item.id,
            result:
              item.method === 'eth_chainId'
                ? chain
                : item.method === 'eth_getBalance'
                ? '0xde0b6b3a7640000'
                : '0x' + '1'.padStart(64, '0'),
          };
        };
        return Response.json(
          Array.isArray(body) ? body.map(reply) : reply(body)
        );
      },
    }
  );
  const owner = {
    signal: control.signal,
    assertCurrent() {
      if (control.signal.aborted) throw new Error('Retired');
    },
  };
  const assets = ownedAssetProvider(provider, owner);
  const balance = () =>
    EvmBalanceController(provider).getEvmBalanceForAccount(
      { address } as any,
      owner
    );
  try {
    const [native, count] = await Promise.all([
      balance(),
      assets.call({
        to: nft,
        data: '0x70a08231' + address.slice(2).padStart(64, '0'),
      }),
    ]);
    expect(native).toBe('1.0');
    expect(count).toBe('0x' + '1'.padStart(64, '0'));
    expect(calls.filter((method) => method === 'eth_chainId')).toHaveLength(1);
    calls.length = 0;
    await balance();
    expect(calls).toEqual(['eth_getBalance']);
    now += 600_000;
    chain = '0x1';
    calls.length = 0;
    await expect(balance()).rejects.toThrow('Display RPC chain changed');
    expect(calls).toEqual(['eth_chainId']);
    chain = '0x39';
    await balance();
    expect(calls.filter((method) => method === 'eth_getBalance')).toHaveLength(
      1
    );
    calls.length = 0;
    chain = '0x1';
    await expect(
      ensureEvmDisplayIdentity(provider, 57, control.signal, 'new-session')
    ).rejects.toThrow('Display RPC chain changed');
    expect(calls).toEqual(['eth_chainId']);
  } finally {
    provider.destroy();
    jest.restoreAllMocks();
  }
});

it('keeps a shared identity request alive when one display consumer cancels', async () => {
  let resolve!: (result: Response) => void;
  let request!: { id: number };
  let physicalSignal!: AbortSignal;
  const lifetime = new AbortController();
  const provider = new CustomJsonRpcProvider(
    lifetime.signal,
    'https://display-owned.invalid',
    57,
    {
      fetch: async (_url, init) => {
        request = JSON.parse(String(init.body));
        physicalSignal = init.signal as AbortSignal;
        return new Promise<Response>((done) => {
          resolve = done;
        });
      },
    }
  );
  const first = new AbortController();
  const second = new AbortController();
  try {
    const a = ensureEvmDisplayIdentity(provider, 57, first.signal);
    const b = ensureEvmDisplayIdentity(provider, 57, second.signal);
    const rejected = expect(a).rejects.toHaveProperty('name', 'AbortError');
    while (!resolve) await new Promise((done) => setImmediate(done));
    first.abort();
    await rejected;
    expect(physicalSignal.aborted).toBe(false);
    resolve(Response.json({ jsonrpc: '2.0', id: request.id, result: '0x39' }));
    await b;
  } finally {
    provider.destroy();
  }
});
