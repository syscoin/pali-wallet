/** @jest-environment node */
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring/cjs/providers.js';

import { readPublicRpc } from './publicRpcBatch';

const request = (index: number) => ({
  method: 'eth_call' as const,
  params: [
    { to: `0x${index.toString(16).padStart(40, '0')}`, data: '0x12345678' },
    '0x100',
  ],
});

it('retains individually valid public reads when their first combined response exceeds the body limit', async () => {
  const value = `0x${'ab'.repeat(393216)}`;
  const seen: unknown[][] = [];
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://rpc.invalid',
    1,
    {
      fetch: async (_url, init) => {
        const input = JSON.parse(String(init.body));
        const requests = Array.isArray(input) ? input : [input];
        seen.push(requests);
        const responses = requests.map((row) => ({
          jsonrpc: '2.0',
          id: row.id,
          result: value,
        }));
        return Response.json(
          Array.isArray(input) ? responses.reverse() : responses[0]
        );
      },
    }
  );
  try {
    const requests = [request(1), request(2), request(3)];
    const results = await Promise.all(
      requests.map((input) =>
        readPublicRpc(
          provider,
          'selected',
          input,
          new AbortController().signal,
          () => undefined
        )
      )
    );
    expect(results).toHaveLength(3);
    results.forEach((result) => expect(result === value).toBe(true));
    expect(seen[0]).toHaveLength(3);
    expect(seen.flat().length).toBeLessThanOrEqual(6);
    for (const row of seen.flat() as { method: string; params: unknown[] }[])
      expect(requests).toContainEqual({
        method: row.method,
        params: row.params,
      });
  } finally {
    provider.destroy();
  }
});
