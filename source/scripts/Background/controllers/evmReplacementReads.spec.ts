/** @jest-environment node */
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring/cjs/providers.js';

import { readLiveEvmChainId } from './evmReplacementReads';

it('fresh replay identity bypasses the ordinary chain cache on the same endpoint', async () => {
  let chain = '0x1';
  const methods: string[] = [];
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://rpc.invalid',
    1,
    {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init.body));
        const rows = Array.isArray(body) ? body : [body];
        methods.push(...rows.map((row: any) => row.method));
        const replies = rows.map((row: any) => ({
          jsonrpc: '2.0',
          id: row.id,
          result: chain,
        }));
        return Response.json(Array.isArray(body) ? replies : replies[0]);
      },
    }
  );
  try {
    expect(await provider.send('eth_chainId', [])).toBe('0x1');
    chain = '0x2';
    expect(await provider.send('eth_chainId', [])).toBe('0x1');
    expect(await readLiveEvmChainId(provider, () => undefined)).toBe('0x2');
    expect(methods).toEqual(['eth_chainId', 'eth_chainId']);
  } finally {
    provider.destroy();
  }
});

it('does not publish fresh replay identity after authority changes', async () => {
  let valid = true;
  const provider = {
    readMany: jest.fn(async () => {
      valid = false;
      return [{ status: 'fulfilled' as const, value: '0x1' }];
    }),
  };
  await expect(
    readLiveEvmChainId(provider, () => {
      if (!valid) throw Error('retired');
    })
  ).rejects.toThrow('retired');
});
