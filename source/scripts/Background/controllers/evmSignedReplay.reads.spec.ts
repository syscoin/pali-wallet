/** @jest-environment node */
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { createExtensionEvmReplaySession } from './evmSignedReplay';

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
      _send: jest.fn(async () => [{ jsonrpc: '2.0', id: 0, result: '0x1' }]),
      send: jest.fn(async () => Transaction.from(raw).hash),
      readMany: jest.fn(async () => [
        scenario === 'failed-nonce'
          ? { status: 'rejected' as const, reason: failure }
          : { status: 'fulfilled' as const, value: '0x0' },
        scenario === 'failed-block'
          ? { status: 'rejected' as const, reason: failure }
          : { status: 'fulfilled' as const, value: block },
      ]),
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
      expect(provider._send).toHaveBeenCalledTimes(2);
      expect(provider.send).toHaveBeenCalledWith('eth_sendRawTransaction', [
        raw,
      ]);
    } else {
      await expect(dispatch).rejects.toBe(failure);
      expect(provider._send).toHaveBeenCalledTimes(1);
      expect(provider.send).not.toHaveBeenCalled();
    }
    expect(provider.readMany).toHaveBeenCalledTimes(1);
    expect(provider.readMany).toHaveBeenCalledWith([
      { method: 'eth_getTransactionCount', params: [signer.address, 'latest'] },
      { method: 'eth_getBlockByNumber', params: ['latest', false] },
    ]);
  }
);
