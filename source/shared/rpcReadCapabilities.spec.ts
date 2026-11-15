import { JsonRpcReadClient } from '@sidhujag/sysweb3-keyring/cjs/rpc-read-client.js';

import { createRpcReadCapabilitiesOwner } from './rpcReadCapabilities';

it('retains endpoint refusal across fresh clients without sharing results', async () => {
  const owner = createRpcReadCapabilitiesOwner();
  const url = 'https://capabilities.invalid';
  const widths: number[] = [];
  const fetch = jest.fn(async (_url, init) => {
    const body = JSON.parse(String(init.body));
    widths.push(Array.isArray(body) ? body.length : 1);
    return Response.json(
      Array.isArray(body)
        ? {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32600,
              message: 'Batch requests are not supported',
            },
          }
        : { jsonrpc: '2.0', id: body.id, result: '0x1' }
    );
  });
  for (let index = 0; index < 2; index++) {
    const client = new JsonRpcReadClient(url, {
      fetch,
      capabilities: owner.get('1', url),
    });
    try {
      const results = await client.readMany([
        {
          method: 'eth_getBalance',
          params: ['0x' + '11'.repeat(20), 'pending'],
        },
        {
          method: 'eth_getTransactionCount',
          params: ['0x' + '11'.repeat(20), 'pending'],
        },
      ]);
      expect(results.every((result) => result.status === 'fulfilled')).toBe(
        true
      );
    } finally {
      client.destroy();
    }
  }
  expect(widths).toEqual([2, 1, 1, 1, 1]);
  expect(owner.get('2', url)).not.toBe(owner.get('1', url));
  expect(owner.get('1', 'https://other.invalid')).not.toBe(owner.get('1', url));
  const beforeClear = owner.get('1', url);
  owner.clear();
  expect(owner.get('1', url)).not.toBe(beforeClear);
});

it('bounds endpoint configuration records', () => {
  const owner = createRpcReadCapabilitiesOwner();
  const first = owner.get('1', 'https://first.invalid');
  for (let index = 0; index < 32; index++)
    owner.get(String(index), `https://rpc${index}.invalid`);
  expect(owner.get('1', 'https://first.invalid')).not.toBe(first);
});
