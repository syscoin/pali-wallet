/** @jest-environment node */
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring/cjs/providers.js';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import {
  createExtensionEvmReplaySession,
  readLiveEvmChainId,
} from './evmSignedReplay';

const signer = new Wallet('0x' + '1'.padStart(64, '0'));
const receiver = '0x' + '2'.repeat(40);
const block = { gasLimit: '0x100000', baseFeePerGas: '0x1' };

it.each(['healthy', 'failed-nonce', 'failed-block'] as const)(
  'batches speed-up admission reads without retrying a failed member: %s',
  async (scenario) => {
    const raw = await signer.signTransaction({
      chainId: 1,
      nonce: 0,
      to: receiver,
      value: 1,
      gasLimit: 21000,
      gasPrice: 2,
      type: 0,
    });
    const failure = new Error('read failed');
    const provider = {
      send: jest.fn(async () => Transaction.from(raw).hash),
      readMany: jest.fn(async (requests) =>
        requests[0]?.method === 'eth_chainId'
          ? [{ status: 'fulfilled' as const, value: '0x1' }]
          : [
              scenario === 'failed-nonce'
                ? { status: 'rejected' as const, reason: failure }
                : { status: 'fulfilled' as const, value: '0x0' },
              scenario === 'failed-block'
                ? { status: 'rejected' as const, reason: failure }
                : { status: 'fulfilled' as const, value: block },
            ]
      ),
    };
    const session = createExtensionEvmReplaySession({
      provider,
      context: {
        account: { address: signer.address, id: 0, type: 'HDAccount' },
        network: { chainId: 1 },
      },
      assertCurrent: () => undefined,
      recordSession: {} as any,
      authorizeReplay: jest.fn(),
    } as any);
    const dispatch = session.dispatch(
      raw,
      async (send, preflight) => {
        await preflight!();
        return send();
      },
      {
        operation: 'speed-up',
        from: signer.address,
        chainId: '1',
        nonce: 0,
        hash: Transaction.from(raw).hash!,
      }
    );
    if (scenario === 'healthy') {
      await expect(dispatch).resolves.toBe(Transaction.from(raw).hash);
      expect(provider.readMany).toHaveBeenCalledTimes(3);
      expect(provider.send).toHaveBeenCalledWith('eth_sendRawTransaction', [
        raw,
      ]);
    } else {
      await expect(dispatch).rejects.toBe(failure);
      expect(provider.readMany).toHaveBeenCalledTimes(2);
      expect(provider.send).not.toHaveBeenCalled();
    }
    expect(provider.readMany).toHaveBeenNthCalledWith(2, [
      { method: 'eth_getTransactionCount', params: [signer.address, 'latest'] },
      { method: 'eth_getBlockByNumber', params: ['latest', false] },
    ]);
  }
);

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
