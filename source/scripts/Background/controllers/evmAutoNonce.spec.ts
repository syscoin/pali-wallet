import { EvmAutoNonceAcceptance } from '../../../shared/evmAutoNonce';

import { inspectWorkerAssetState } from './evmAssetState';
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
    send: jest.fn(
      async (method: string, params: unknown[]): Promise<unknown> => {
        if (method === 'eth_getBlockByNumber')
          return {
            number: params[0] === 'latest' ? '0xa' : params[0],
            hash: '0x' + '12'.repeat(32),
          };
        const tag = params[1] === '0xa' ? 'latest' : params[1];
        const value = replies.get(`${method}:${String(tag)}`);
        if (value === undefined) throw new Error(`Unexpected ${method}`);
        return value;
      }
    ),
  };
  const input = {
    acceptance,
    assertCurrent: () => undefined,
    provider,
    scope: { chainId, endpoint, from },
    snapshot: {
      owner: 'wallet',
      minimumNonce: 0,
      retained: [] as (typeof retained)[],
      readMaximumCost: jest.fn<Promise<bigint>, [string]>(async () =>
        BigInt(5)
      ),
      readAssetDebit: jest.fn(async () => BigInt(0)),
    },
  };
  return { abort, input, provider, replies };
}

it('refuses a new send when a costlier retained prefix alternative exceeds canonical funds', async () => {
  const f = fixture('0x0', '0x1');
  f.input.snapshot.retained.push(
    { ...retained, phase: 'submitted' as typeof retained.phase },
    { ...retained, hash: '0x' + 'cd'.repeat(32) }
  );
  f.input.snapshot.readMaximumCost.mockImplementation(async (value: string) =>
    BigInt(value === hash ? 121000 : 142000)
  );
  f.replies.set('eth_getBalance:latest', '0xf4240');
  f.replies.set('eth_getBalance:pending', '0xd6998');
  await expect(
    planExtensionEvmNonce({ ...f.input, minimumBalance: BigInt(871000) })
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  await expect(
    planExtensionEvmNonce({ ...f.input, minimumBalance: BigInt(737000) })
  ).resolves.toMatchObject({
    nonce: 1,
    nativeReservations: { canonical: BigInt(142000), pending: BigInt(142000) },
  });
});

it('retains external pending debits while reviewing a manual external replacement', async () => {
  const f = fixture('0x0', '0x2');
  f.replies.set('eth_getBalance:latest', '0xf4240');
  f.replies.set('eth_getBalance:pending', '0x74f18'); // 479000
  const input = { ...f.input, reviewed: reviewedExtensionNonce(1, 'manual') };
  await expect(
    planExtensionEvmNonce({ ...input, minimumBalance: BigInt(800000) })
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  await expect(
    planExtensionEvmNonce({ ...input, minimumBalance: BigInt(479000) })
  ).resolves.toMatchObject({
    nonce: 1,
    state: 'latest',
    balanceState: 'pending',
  });
});
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
  replies.set('eth_getBalance:latest', '0x8');
  await expect(planExtensionEvmNonce(approved)).resolves.toMatchObject({
    nonce: 1,
    state: 'pending',
    nativeReservations: { canonical: BigInt(5), pending: BigInt(5) },
  });
});

it('uses the canonical state if the two fresh reads report an older pending count', async () => {
  const { input, provider } = fixture('0x1', '0x0');
  await expect(
    planExtensionEvmNonce({ ...input, minimumBalance: BigInt(1) })
  ).resolves.toMatchObject({ nonce: 1, state: 'latest' });
  expect(provider.send).toHaveBeenCalledWith('eth_getBalance', [from, '0xa']);
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

async function assetFixture(amountUnits = '1', balanceHex = '64') {
  const f = fixture('0x0', '0x0');
  const token = '0x' + '33'.repeat(20);
  const blockHash = '0x' + 'ab'.repeat(32);
  const original = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(
    async (method: string, params: unknown[]) => {
      if (method === 'eth_getBlockByNumber')
        return { number: '0x1', hash: blockHash };
      if (method === 'eth_getCode') return '0x6000';
      if (method === 'eth_getTransactionCount' && params[1] === '0x1')
        return '0x0';
      if (method === 'eth_call') {
        const call = params[0] as { from?: string };
        return `0x${(call.from ? '1' : balanceHex).padStart(64, '0')}`;
      }
      return original(method, params);
    }
  );
  const asset = {
    type: 'ERC20' as const,
    transaction: {
      networkUrl: endpoint,
      tokenAddress: token,
      receiver: '0x' + '22'.repeat(20),
      tokenAmountUnits: amountUnits,
      gasLimit: '42000',
      isLegacy: false as const,
      maxFeePerGas: '3',
      maxPriorityFeePerGas: '1',
    },
  };
  const basis = await inspectWorkerAssetState(
    f.provider as any,
    asset,
    Number(chainId),
    from,
    f.input.assertCurrent
  );
  return { ...f, basis, token };
}

it('awaits legacy work and enforces final asset checks before returning', async () => {
  const ordinary = fixture('0x0', '0x0');
  await expect(planExtensionEvmNonce(ordinary.input)).resolves.toMatchObject({
    nonce: 0,
  });
  expect(ordinary.provider.verifyConfiguredChainId).toHaveBeenCalledTimes(2);
  const asset = await assetFixture();
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let returned = false;
  const beforeAssetFinal = jest.fn(async (nonce: number) => {
    expect(nonce).toBe(0);
    entered();
    await held;
  });
  const operation = planExtensionEvmNonce({
    ...asset.input,
    assetBasis: asset.basis,
    beforeAssetFinal,
  }).then((result) => {
    returned = true;
    return result;
  });
  await started;
  expect(returned).toBe(false);
  expect(asset.provider.verifyConfiguredChainId).toHaveBeenCalledTimes(1);
  release();
  await expect(operation).resolves.toMatchObject({ nonce: 0 });
  expect(beforeAssetFinal).toHaveBeenCalledTimes(1);
  expect(asset.provider.verifyConfiguredChainId).toHaveBeenCalledTimes(2);
  expect(asset.provider.verifyConfiguredChainId).toHaveBeenNthCalledWith(
    2,
    true
  );
});

it('queues a reviewed token transfer behind an accepted predecessor and reserves its known debit', async () => {
  const f = await assetFixture('60');
  f.replies.set('eth_getTransactionCount:pending', '0x1');
  f.input.snapshot.retained.push({ ...retained, phase: 'submitted' as any });
  f.input.snapshot.readAssetDebit.mockResolvedValue(BigInt(40));
  await expect(
    planExtensionEvmNonce({
      ...f.input,
      assetBasis: f.basis,
      beforeAssetFinal: async () => {},
    })
  ).resolves.toMatchObject({ nonce: 1 });
  expect(f.input.snapshot.readAssetDebit).toHaveBeenCalledWith(
    hash,
    f.basis.asset
  );
  expect(f.provider.send).toHaveBeenCalledWith('eth_call', [
    expect.objectContaining({ from, nonce: '0x1' }),
    'pending',
  ]);
});

it('preserves an explicit asset nonce and simulates against the canonical state', async () => {
  const f = await assetFixture('60');
  f.replies.set('eth_getTransactionCount:pending', '0x2');
  await expect(
    planExtensionEvmNonce({
      ...f.input,
      reviewed: reviewedExtensionNonce(0, 'manual'),
      assetBasis: f.basis,
      beforeAssetFinal: async () => {},
    })
  ).resolves.toMatchObject({ nonce: 0 });
  expect(f.provider.send).toHaveBeenCalledWith('eth_call', [
    expect.objectContaining({ from, nonce: '0x0' }),
    '0x1',
  ]);
});

it('rejects known pending asset overcommit before simulating another send', async () => {
  const f = await assetFixture('60');
  f.replies.set('eth_getTransactionCount:pending', '0x1');
  f.input.snapshot.retained.push({ ...retained, phase: 'submitted' as any });
  f.input.snapshot.readAssetDebit.mockResolvedValue(BigInt(41));
  await expect(
    planExtensionEvmNonce({
      ...f.input,
      assetBasis: f.basis,
      beforeAssetFinal: async () => {},
    })
  ).rejects.toMatchObject({
    code: 'EVM_ASSET_REVIEW_REQUIRED',
    transactionNotBroadcast: true,
  });
  expect(
    f.provider.send.mock.calls.some(
      ([method, params]) =>
        method === 'eth_call' && Boolean((params[0] as any).from)
    )
  ).toBe(false);
});

it('rejects an indirect predecessor effect reported by pending-state simulation', async () => {
  const f = await assetFixture('60');
  f.replies.set('eth_getTransactionCount:pending', '0x1');
  const original = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) => {
    if (
      method === 'eth_call' &&
      (params[0] as any).from &&
      params[1] === 'pending'
    )
      return `0x${'0'.repeat(64)}`;
    return original(method, params);
  });
  await expect(
    planExtensionEvmNonce({
      ...f.input,
      assetBasis: f.basis,
      beforeAssetFinal: async () => {},
    })
  ).rejects.toMatchObject({
    code: 'EVM_ASSET_REVIEW_REQUIRED',
    transactionNotBroadcast: true,
  });
});

it('rejects a stale form amount after the predecessor is included and leaves only forty units', async () => {
  await expect(assetFixture('60', '28')).rejects.toMatchObject({
    code: 'EVM_ASSET_REVIEW_REQUIRED',
    transactionNotBroadcast: true,
  });
});

it('rejects forged, copied, swapped and reused asset bases', async () => {
  const f = await assetFixture();
  const valid = {
    ...f.input,
    assetBasis: f.basis,
    beforeAssetFinal: async () => {},
  };
  const otherProvider = fixture('0x0', '0x0').provider;
  for (const changed of [
    { assetBasis: { ...f.basis } },
    { provider: otherProvider },
    { scope: { ...f.input.scope, from: '0x' + '22'.repeat(20) } },
    { scope: { ...f.input.scope, chainId: '1' } },
    { scope: { ...f.input.scope, endpoint: 'https://other.invalid' } },
    {
      assetBasis: {
        ...f.basis,
        asset: { ...f.basis.asset, contractAddress: '0x' + '44'.repeat(20) },
      },
    },
    { assertCurrent: () => undefined },
  ])
    await expect(
      planExtensionEvmNonce({ ...valid, ...changed })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
  await expect(planExtensionEvmNonce(valid)).resolves.toMatchObject({
    nonce: 0,
  });
  await expect(planExtensionEvmNonce(valid)).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
});

it('does not return a plan after a legacy callback abort or final chain failure', async () => {
  const aborted = await assetFixture();
  const input = {
    ...aborted.input,
    assetBasis: aborted.basis,
    beforeAssetFinal: async () => {
      aborted.abort.abort(new Error('cancelled'));
    },
  };
  await expect(planExtensionEvmNonce(input)).rejects.toThrow('cancelled');
  await expect(planExtensionEvmNonce(input)).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  const changed = await assetFixture();
  changed.provider.verifyConfiguredChainId.mockRejectedValueOnce(
    new Error('chain changed')
  );
  await expect(
    planExtensionEvmNonce({
      ...changed.input,
      assetBasis: changed.basis,
      beforeAssetFinal: async () => {},
    })
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
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

it.each(['automatic', 'manual'] as const)(
  'reserves a future nonce before admitting an %s native gap fill',
  async (source) => {
    const { input, replies } = fixture('0x0', '0x0');
    input.snapshot.retained.push({ ...retained, nonce: 1 });
    const request = {
      ...input,
      minimumBalance: BigInt(3),
      reviewed: reviewedExtensionNonce(0, source),
    };
    await expect(planExtensionEvmNonce(request)).rejects.toMatchObject({
      message: 'Insufficient balance for pending transfers.',
      transactionNotBroadcast: true,
    });
    replies.set('eth_getBalance:pending', '0x8');
    replies.set('eth_getBalance:latest', '0x8');
    await expect(planExtensionEvmNonce(request)).resolves.toMatchObject({
      nonce: 0,
      nativeReservations: { canonical: BigInt(5), pending: BigInt(5) },
    });
  }
);
