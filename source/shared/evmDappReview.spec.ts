import {
  prepareEvmDappQuote,
  type EvmDappBlock,
  type EvmGasPolicy,
  type EvmDappTransactionRequest,
} from './evmDappPreparation';
import { prepareEvmDappReview } from './evmDappReview';
import { NATIVE_EVM_FEE_FUNDING } from './evmFeeApproval';

const from = `0x${'11'.repeat(20)}`;
const to = `0x${'22'.repeat(20)}`;
const hash = `0x${'aa'.repeat(32)}`;

function fixture(legacy = false) {
  let current = true;
  let now = 1;
  let estimate = 21_000;
  let chain = '1';
  let pendingHeader: 'valid' | 'null' | 'malformed' = 'valid';
  const requests: Array<{ method: string; params: readonly unknown[] }> = [];
  const check = () => {
    if (!current) throw new Error('retired');
  };
  const planner = jest.fn();
  const sign = jest.fn(async () => ({ rawTransaction: '0x1234', hash }));
  const ports = {
    chainId: '1',
    scope: 'owned-network-registration',
    gasPolicy: { kind: 'estimate' } as EvmGasPolicy,
    funding: NATIVE_EVM_FEE_FUNDING,
    assertCurrent: check,
    now: () => now,
    async verifyChain() {
      if (chain !== '1') throw new Error('wrong chain');
    },
    async verifyBlock() {
      check();
    },
    async nonce(_block: EvmDappBlock, requested: number | undefined) {
      return { nonce: BigInt(requested ?? 4), state: 'pending' as const };
    },
    async balance() {
      return BigInt('1000000000000000000');
    },
    async fees() {
      return {
        gasPrice: BigInt(2),
        maxFeePerGas: BigInt(3),
        maxPriorityFeePerGas: BigInt(1),
        ...(legacy ? {} : { baseFeePerGas: BigInt(1) }),
      };
    },
    async read(
      method: 'eth_getBlockByNumber' | 'eth_estimateGas',
      params: readonly unknown[]
    ) {
      requests.push({ method, params });
      if (method === 'eth_estimateGas') return `0x${estimate.toString(16)}`;
      if (params[0] === 'pending' && pendingHeader !== 'valid')
        return pendingHeader === 'null' ? null : { gasLimit: 'invalid' };
      return {
        number: '0x10',
        hash,
        gasLimit: '0x1c9c380',
        ...(legacy ? {} : { baseFeePerGas: '0x1' }),
      };
    },
  };
  const prepare = jest.fn(
    (
      request: EvmDappTransactionRequest,
      guard: () => void,
      _planner: typeof planner,
      approved?: Parameters<typeof prepareEvmDappQuote>[2]
    ) =>
      prepareEvmDappQuote(request, { ...ports, assertCurrent: guard }, approved)
  );
  const submit = jest.fn(
    async (transaction, signed, guard, refresh, onBroadcast) => {
      await refresh(planner, guard);
      guard();
      onBroadcast(signed.hash);
      return signed.hash;
    }
  );
  const review = (
    input: unknown = { from, to, data: '0x1234', value: '0x0' }
  ) =>
    prepareEvmDappReview(input, {
      chainId: '1',
      scope: ports.scope,
      signal: new AbortController().signal,
      nonceContext: planner,
      assertCurrent: check,
      now: ports.now,
      prepare,
      async send(transaction, guard, refresh, onBroadcast) {
        const signed = await sign();
        guard();
        return submit(transaction, signed, guard, refresh, onBroadcast);
      },
    });
  return {
    review,
    prepare,
    ports,
    requests,
    sign,
    submit,
    check,
    expire() {
      now += 90_000;
    },
    retire() {
      current = false;
    },
    growEstimate() {
      estimate = 40_000;
    },
    switchChain() {
      chain = '2';
    },
    pendingHeader(value: typeof pendingHeader) {
      pendingHeader = value;
    },
  };
}

describe('shared generic per-call fee review', () => {
  test.each([false, true])(
    'quotes and refreshes the same fee-sensitive execution, legacy=%s',
    async (legacy) => {
      const f = fixture(legacy);
      const read = f.ports.read;
      f.ports.read = async (method, params) => {
        const result = await read(method, params);
        if (method !== 'eth_estimateGas') return result;
        // A real Anvil type-2 transfer estimates 21000 without its fee fields
        // and 21001 with them. Requoting must not repeat the lower envelope.
        return Object.hasOwn(params[0] as object, 'type') ? '0x5209' : '0x5208';
      };
      const fees = legacy
        ? { type: '0x0', gasPrice: '0x2' }
        : { type: '0x2', maxFeePerGas: '0x3', maxPriorityFeePerGas: '0x1' };
      const review = await f.review({
        from,
        to,
        data: '0x1234',
        gas: '0x5208',
        ...fees,
      });
      expect(review.transaction.gasLimit).toBe('25202');
      await expect(review.submit(f.check, jest.fn())).resolves.toBe(hash);
      const estimates = f.requests.filter(
        ({ method }) => method === 'eth_estimateGas'
      );
      expect(estimates).toHaveLength(3);
      for (const { params } of estimates) {
        expect(params).toEqual([
          {
            from,
            to,
            value: '0x0',
            data: '0x1234',
            nonce: '0x4',
            chainId: '0x1',
            ...fees,
            ...(legacy ? {} : { accessList: [] }),
          },
          'pending',
        ]);
        expect(params[0]).not.toHaveProperty('gas');
        expect(params[0]).not.toHaveProperty('gasLimit');
      }
      expect(f.sign).toHaveBeenCalledTimes(1);
    }
  );

  test.each([false, true])(
    'quotes exact generic execution before any signing, legacy=%s',
    async (legacy) => {
      const f = fixture(legacy);
      const review = await f.review();
      expect(review.transaction.data).toBe('0x1234');
      expect(review.transaction.type).toBe(legacy ? 0 : 2);
      expect(review.transaction.gasLimit).toBe('25200');
      expect(review.maximumFeeUnits).toBe(legacy ? '50400' : '75600');
      expect(f.sign).not.toHaveBeenCalled();
      expect(f.submit).not.toHaveBeenCalled();
      const onBroadcast = jest.fn();
      await expect(review.submit(f.check, onBroadcast)).resolves.toBe(hash);
      expect(onBroadcast).toHaveBeenCalledWith(hash);
      expect(f.sign).toHaveBeenCalledTimes(1);
      expect(f.prepare).toHaveBeenCalledTimes(3);
      await expect(review.submit(f.check, onBroadcast)).rejects.toThrow(
        'REVIEW_REQUIRED'
      );
    }
  );

  test.each(['expire', 'retire', 'switchChain', 'growEstimate'] as const)(
    '%s requires a fresh review before signing',
    async (change) => {
      const f = fixture();
      const review = await f.review();
      f[change]();
      await expect(review.submit(f.check, jest.fn())).rejects.toThrow();
      expect(f.sign).not.toHaveBeenCalled();
      expect(f.submit).not.toHaveBeenCalled();
    }
  );

  test('copies caller data and access list before preparation', async () => {
    const f = fixture();
    const input = {
      from,
      to,
      data: '0x1234',
      nonce: '0x7',
      accessList: [{ address: to, storageKeys: [`0x${'33'.repeat(32)}`] }],
    };
    const pending = f.review(input);
    input.data = '0x5678';
    input.accessList[0].storageKeys[0] = `0x${'44'.repeat(32)}`;
    const review = await pending;
    expect(review.transaction.data).toBe('0x1234');
    expect(review.transaction.nonce).toBe('7');
    expect(
      review.transaction.type === 2 &&
        review.transaction.accessList[0].storageKeys[0]
    ).toBe(`0x${'33'.repeat(32)}`);
  });

  test('contract creation preserves a missing destination through quote and refresh', async () => {
    const f = fixture();
    const review = await f.review({ from, data: '0x60006000' });
    expect(review.transaction.to).toBeNull();
    await review.submit(f.check, jest.fn());
    for (const request of f.requests.filter(
      ({ method }) => method === 'eth_estimateGas'
    )) {
      expect(request.params[0]).not.toHaveProperty('to');
      expect(request.params[1]).toBe('pending');
    }
  });

  test('rejects an asynchronous approval guard before preparation', async () => {
    const f = fixture();
    const review = await f.review();
    await expect(
      review.submit(async () => undefined, jest.fn())
    ).rejects.toThrow('synchronous');
    expect(f.sign).not.toHaveBeenCalled();
  });

  test('a null pending header preserves the canonical fee bounds and pending execution', async () => {
    const f = fixture();
    f.pendingHeader('null');
    const review = await f.review();
    expect(review.maximumFeeUnits).toBe('75600');
    await review.submit(f.check, jest.fn());
    for (const request of f.requests.filter(
      ({ method }) => method === 'eth_estimateGas'
    ))
      expect(request.params[1]).toBe('pending');
  });

  test('a malformed pending header cannot downgrade to canonical-only fee data', async () => {
    const f = fixture();
    f.pendingHeader('malformed');
    await expect(f.review()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(f.sign).not.toHaveBeenCalled();
  });
});

describe('internal fixed-gas fee approval', () => {
  test('keeps the exact qualified budget through refresh without disclosing calldata to estimation', async () => {
    const f = fixture();
    f.ports.gasPolicy = { kind: 'fixed', gasLimit: '650000' };
    const request = {
      from,
      to,
      data: '0x1234',
      value: '0',
      gasLimit: '650000',
    };
    const first = await prepareEvmDappQuote(request, f.ports);
    const refreshed = await prepareEvmDappQuote(request, f.ports, first);
    expect(first.transaction.gasLimit).toBe('650000');
    expect(refreshed.transaction).toEqual(first.transaction);
    expect(
      f.requests.every(({ method }) => method === 'eth_getBlockByNumber')
    ).toBe(true);
  });

  test.each(['21000', undefined])(
    'refuses a request outside its fixed budget (%s)',
    async (gasLimit) => {
      const f = fixture();
      f.ports.gasPolicy = { kind: 'fixed', gasLimit: '650000' };
      await expect(
        prepareEvmDappQuote(
          { from, to, data: '0x1234', value: '0', gasLimit },
          f.ports
        )
      ).rejects.toThrow('REVIEW_REQUIRED');
      expect(
        f.requests.some(({ method }) => method === 'eth_estimateGas')
      ).toBe(false);
    }
  );

  test('retains fee, block-limit and owner checks for fixed gas', async () => {
    const f = fixture();
    f.ports.gasPolicy = { kind: 'fixed', gasLimit: '650000' };
    const request = {
      from,
      to,
      data: '0x1234',
      value: '0',
      gasLimit: '650000',
    };
    const quote = await prepareEvmDappQuote(request, f.ports);
    f.retire();
    await expect(prepareEvmDappQuote(request, f.ports, quote)).rejects.toThrow(
      'retired'
    );
  });
});

test('captures fixed gas policy before an awaited chain read', async () => {
  const f = fixture();
  const policy = { kind: 'fixed' as const, gasLimit: '650000' };
  f.ports.gasPolicy = policy;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.ports.verifyChain = async () => {
    await held;
  };
  const pending = prepareEvmDappQuote(
    { from, to, data: '0x1234', value: '0', gasLimit: '650000' },
    f.ports
  );
  policy.gasLimit = '21000';
  (policy as { kind: string }).kind = 'estimate';
  release();
  const quote = await pending;
  expect(quote.transaction.gasLimit).toBe('650000');
  expect(f.requests.some(({ method }) => method === 'eth_estimateGas')).toBe(
    false
  );
});

test.each([
  undefined,
  { kind: 'other' },
  { kind: 'fixed', gasLimit: '0' },
  { kind: 'fixed', gasLimit: '01' },
  { kind: 'fixed', gasLimit: '0x9eb10' },
])('refuses an invalid gas policy before RPC (%j)', async (policy) => {
  const f = fixture();
  f.ports.gasPolicy = policy as EvmGasPolicy;
  await expect(
    prepareEvmDappQuote(
      { from, to, data: '0x1234', value: '0', gasLimit: '650000' },
      f.ports
    )
  ).rejects.toThrow();
  expect(f.requests).toEqual([]);
});
