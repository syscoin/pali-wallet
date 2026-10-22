import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring/cjs/providers';

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
  const send = jest.fn();
  await expect(
    guardianStatusProvider({ send }).send('eth_chainId', [])
  ).rejects.toThrow('unavailable');
  await expect(
    guardianStatusProvider({ send, sendBatch: async () => [] }).send(
      'eth_chainId',
      []
    )
  ).rejects.toThrow('Invalid');
  expect(send).not.toHaveBeenCalled();
});
