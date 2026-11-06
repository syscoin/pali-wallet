import { EvmAutoNonceAcceptance } from '../../../shared/evmAutoNonce';

import {
  assertNoObservedLegacyPending,
  planExtensionEvmNonce,
  reviewedExtensionNonce,
} from './evmAutoNonce';

const from = '0x1111111111111111111111111111111111111111';
const hash = `0x${'ab'.repeat(32)}`;
const chainId = '5700';
const endpoint = 'https://rpc.invalid';
const retained = { chainId, from, hash, nonce: 0, phase: 'signed' as const };

function fixture(latest: string, pending: string) {
  const abort = new AbortController();
  const acceptance = new EvmAutoNonceAcceptance();
  const replies = new Map([
    ['eth_getTransactionCount:latest', latest],
    ['eth_getTransactionCount:pending', pending],
    ['eth_getBalance:pending', '0x7'],
    ['eth_getBalance:latest', '0x7'],
  ]);
  const provider = {
    signal: abort.signal,
    verifyConfiguredChainId: jest.fn(async () => undefined),
    send: jest.fn(async (method: string, [, tag]: unknown[]) => {
      const value = replies.get(`${method}:${String(tag)}`);
      if (value === undefined) throw new Error(`Unexpected ${method}`);
      return value;
    }),
  };
  const input = {
    acceptance,
    assertCurrent: () => undefined,
    provider,
    scope: { chainId, endpoint, from },
    snapshot: {
      owner: 'wallet',
      retained: [] as (typeof retained)[],
      readMaximumCost: jest.fn(async () => BigInt(5)),
    },
  };
  return { abort, input, provider, replies };
}

it('advances across an exact acknowledged predecessor only if its cost and this send fit', async () => {
  const { input, replies } = fixture('0x0', '0x0');
  input.snapshot.retained.push(retained);
  input.acceptance.track(input.snapshot.owner, endpoint, retained)(hash);
  const approved = {
    ...input,
    minimumBalance: BigInt(3),
    reviewed: reviewedExtensionNonce(1, 'automatic'),
  };
  await expect(planExtensionEvmNonce(approved)).rejects.toMatchObject({
    message: 'Insufficient balance for pending transfers.',
    transactionNotBroadcast: true,
  });
  replies.set('eth_getBalance:pending', '0x8');
  await expect(planExtensionEvmNonce(approved)).resolves.toMatchObject({
    nonce: 1,
    state: 'pending',
    maximumPredecessorCost: BigInt(5),
  });
});

it('uses the canonical state if the two fresh reads report an older pending count', async () => {
  const { input, provider } = fixture('0x1', '0x0');
  await expect(
    planExtensionEvmNonce({ ...input, minimumBalance: BigInt(1) })
  ).resolves.toMatchObject({ nonce: 1, state: 'latest' });
  expect(provider.send).toHaveBeenCalledWith('eth_getBalance', [
    from,
    'latest',
  ]);
});

it('preserves an explicitly selected zero and never reuses an owned nonce', async () => {
  const { input } = fixture('0x0', '0x1');
  const explicit = { ...input, reviewed: reviewedExtensionNonce(0, 'manual') };
  await expect(planExtensionEvmNonce(explicit)).resolves.toMatchObject({
    nonce: 0,
    state: 'latest',
  });
  input.snapshot.retained.push(retained);
  await expect(planExtensionEvmNonce(explicit)).rejects.toMatchObject({
    message: expect.stringContaining('saved transaction'),
    transactionNotBroadcast: true,
  });
});

it('requires fresh review when the exact approved automatic nonce moved', async () => {
  const { input } = fixture('0x1', '0x2');
  await expect(
    planExtensionEvmNonce({
      ...input,
      reviewed: reviewedExtensionNonce(1, 'automatic'),
    })
  ).rejects.toMatchObject({
    message: expect.stringContaining('Review this transfer again'),
    transactionNotBroadcast: true,
  });
});

describe('legacy pending observation at the automatic candidate', () => {
  const pendingTx = {
    hash,
    from,
    nonce: '0x0',
    chainId: '0x1644',
    blockHash: null,
    blockNumber: null,
    transactionIndex: null,
  };
  const observation = (result: unknown, hashes = [hash]) => {
    const { input, provider } = fixture('0x0', '0x0');
    provider.send.mockImplementation(async (method: string) => {
      if (method === 'eth_getTransactionByHash') return result as any;
      throw Error('Unexpected RPC');
    });
    return {
      provider,
      request: {
        provider,
        scope: input.scope,
        nonce: 0,
        hashes,
        assertCurrent: input.assertCurrent,
      },
    };
  };
  it('blocks only an exact pending identity observed on the same endpoint', async () => {
    const { provider, request } = observation(pendingTx);
    await expect(assertNoObservedLegacyPending(request)).rejects.toMatchObject({
      message:
        'A previous transaction is still pending. Check Activity before trying again.',
      transactionNotBroadcast: true,
    });
    expect(provider.send).toHaveBeenCalledWith('eth_getTransactionByHash', [
      hash,
    ]);
    expect(provider.verifyConfiguredChainId).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['missing type', undefined],
    ['hex legacy type', '0x0'],
    ['numeric legacy type', 0],
  ])(
    'accepts a same-endpoint unprotected chain-zero pending identity with %s',
    async (_label, type) => {
      const { request } = observation({ ...pendingTx, chainId: '0x0', type });
      await expect(
        assertNoObservedLegacyPending(request)
      ).rejects.toMatchObject({
        message:
          'A previous transaction is still pending. Check Activity before trying again.',
        transactionNotBroadcast: true,
      });
    }
  );
  it('rejects a typed transaction with chain ID zero as unverifiable', async () => {
    const { request } = observation({
      ...pendingTx,
      chainId: '0x0',
      type: '0x2',
    });
    await expect(assertNoObservedLegacyPending(request)).rejects.toMatchObject({
      message:
        'Unable to check previous transactions. Refresh Activity and try again.',
      transactionNotBroadcast: true,
    });
  });
  it.each([
    ['missing', null],
    ['wrong hash', { ...pendingTx, hash: `0x${'cd'.repeat(32)}` }],
    ['wrong sender', { ...pendingTx, from: `0x${'2'.repeat(40)}` }],
    ['wrong nonce', { ...pendingTx, nonce: '0x1' }],
    ['wrong chain', { ...pendingTx, chainId: '0x1' }],
    [
      'mined',
      {
        ...pendingTx,
        blockHash: `0x${'3'.repeat(64)}`,
        blockNumber: '0x1',
        transactionIndex: '0x0',
      },
    ],
  ])('does not block on %s', async (_name, result) => {
    await expect(
      assertNoObservedLegacyPending(observation(result).request)
    ).resolves.toBeUndefined();
  });
  it.each([
    ['missing hash', { ...pendingTx, hash: undefined }],
    ['missing sender', { ...pendingTx, from: undefined }],
    ['missing nonce', { ...pendingTx, nonce: undefined }],
    ['bad nonce hex', { ...pendingTx, nonce: '0x00' }],
    ['bad chain hex', { ...pendingTx, chainId: '0xzz' }],
    ['missing pending metadata', { ...pendingTx, blockNumber: undefined }],
    ['mixed pending metadata', { ...pendingTx, blockNumber: '0x1' }],
    [
      'bad block hash',
      {
        ...pendingTx,
        blockHash: '0xff',
        blockNumber: '0x1',
        transactionIndex: '0x0',
      },
    ],
    ['invalid response', 'bad'],
  ])('fails closed on %s', async (_name, result) => {
    await expect(
      assertNoObservedLegacyPending(observation(result).request)
    ).rejects.toMatchObject({
      message:
        'Unable to check previous transactions. Refresh Activity and try again.',
      transactionNotBroadcast: true,
    });
  });
  it.each([
    ['missing', null],
    [
      'mined',
      {
        ...pendingTx,
        blockHash: `0x${'3'.repeat(64)}`,
        blockNumber: '0x1',
        transactionIndex: '0x0',
      },
    ],
  ])(
    'rejects a chain change after a %s legacy lookup',
    async (_name, result) => {
      const { provider, request } = observation(result);
      provider.verifyConfiguredChainId.mockRejectedValueOnce(
        new Error('Chain changed')
      );
      await expect(assertNoObservedLegacyPending(request)).rejects.toThrow(
        'Chain changed'
      );
      expect(provider.send).toHaveBeenCalledWith('eth_getTransactionByHash', [
        hash,
      ]);
    }
  );
  it('fails closed when the candidate RPC read fails', async () => {
    const { provider, request } = observation(null);
    provider.send.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(assertNoObservedLegacyPending(request)).rejects.toMatchObject({
      code: 'EVM_LEGACY_VERIFICATION_UNAVAILABLE',
      transactionNotBroadcast: true,
    });
  });
  it('fails closed if the candidate count exceeds the bounded read budget', async () => {
    const hashes = Array.from(
      { length: 17 },
      (_, i) => `0x${i.toString(16).padStart(64, '0')}`
    );
    const { provider, request } = observation(null, hashes);
    await expect(assertNoObservedLegacyPending(request)).rejects.toMatchObject({
      message:
        'Unable to check previous transactions. Refresh Activity and try again.',
      transactionNotBroadcast: true,
    });
    expect(provider.send).not.toHaveBeenCalled();
  });
});
