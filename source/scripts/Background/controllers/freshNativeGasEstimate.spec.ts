import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';
import { getAddress } from 'ethers/address';

import { EvmAutoNonceAcceptance } from '../../../shared/evmAutoNonce';
import { BigNumber } from 'utils/ethersV6Compat';

import {
  captureReviewedNativeEvmTransfer,
  recheckReviewedNativeEvmTransfer,
} from './freshNativeGasEstimate';

const sender = `0x${'ab'.repeat(20)}`;
const recipient = `0x${'cd'.repeat(20)}`;
const chainId = 743_211;
const approved = {
  from: sender,
  to: recipient,
  chainId,
  value: '1000000000000000001',
  data: '0x',
  gasLimit: '25200',
  maxFeePerGas: '9007199254740999',
  maxPriorityFeePerGas: '0',
  nonce: 9,
};
const noncePlan = {
  canonicalBlock: { number: '0x64', hash: '0x' + '12'.repeat(32) },
  state: 'pending' as const,
  balanceState: 'pending' as const,
  nativeReservations: { canonical: BigInt(0), pending: BigInt(0) },
};
const maximum = (
  BigInt(approved.maxFeePerGas) * BigInt(approved.gasLimit)
).toString();
const hex = (value: string | number) => `0x${BigInt(value).toString(16)}`;
const capture = (input: Record<string, unknown> = approved) =>
  captureReviewedNativeEvmTransfer(
    input,
    false,
    maximum,
    sender,
    chainId,
    {},
    'fixture'
  );

it('keeps the ordinary native-send restriction on zero-address recipients', () => {
  expect(() => capture({ ...approved, to: `0x${'0'.repeat(40)}` })).toThrow(
    'Invalid reviewed native transfer'
  );
});

it('recaptures a canonical type2 review after automatic nonce allocation', () => {
  const first = capture({ ...approved, nonce: undefined });
  const second = capture({ ...first.transaction, nonce: 10 });
  expect(second.transaction).toEqual({ ...first.transaction, nonce: '10' });
  expect(second.transaction).toHaveProperty('accessList', []);
  expect(second.nonce).toBe(BigInt(10));
});

it('rejects nonempty and malformed access lists in ordinary reviews', () => {
  const accessorList: unknown[] = [];
  Object.defineProperty(accessorList, '0', {
    get() {
      throw new Error('Access list getter must not execute');
    },
  });
  for (const accessList of [
    [{ address: recipient, storageKeys: [] }],
    {},
    accessorList,
  ]) {
    expect(() => capture({ ...approved, accessList })).toThrow();
  }
  expect(() =>
    captureReviewedNativeEvmTransfer(
      { ...approved, accessList: [], gasPrice: '1' },
      true,
      '25200',
      sender,
      chainId,
      {},
      'fixture'
    )
  ).toThrow('Invalid reviewed native transfer');
});

function fixture() {
  const abort = new AbortController();
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const replies = new Map<string, unknown>([
    ['eth_chainId', hex(chainId)],
    ['eth_getBalance', hex('1000000000000000000000')],
    [
      'eth_getBlockByNumber',
      {
        hash: noncePlan.canonicalBlock.hash,
        baseFeePerGas: '0x3b9aca00',
        gasLimit: '0x1c9c380',
      },
    ],
    ['eth_estimateGas', '0x5208'],
  ]);
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
    const { id, method, params } = JSON.parse(String(init?.body));
    calls.push({ method, params });
    if (!replies.has(method)) throw new Error('Unexpected RPC call');
    const response = replies.get(method);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: typeof response === 'function' ? response(params) : response,
      })
    );
  });
  const provider = new CustomJsonRpcProvider(
    abort.signal,
    'https://rpc.invalid',
    chainId
  );
  return { abort, calls, provider, replies };
}

afterEach(() => jest.restoreAllMocks());

it.each([100000, 150000])(
  'final funding reserves an ambiguous prefix with original cap %s',
  async (originalCap) => {
    const { provider, replies } = fixture();
    let pendingBalance = 600000;
    replies.set('eth_getBalance', (params: unknown[]) =>
      hex(params[1] === 'pending' ? pendingBalance : 1000000)
    );
    replies.set('eth_getBlockByNumber', {
      hash: noncePlan.canonicalBlock.hash,
      baseFeePerGas: '0x1',
      gasLimit: '0x1c9c380',
    });
    const originalHash = '0x' + 'ab'.repeat(32);
    const result = await new EvmAutoNonceAcceptance().plan({
      chainId: String(chainId),
      from: sender,
      endpoint: 'https://rpc.invalid',
      latest: 0,
      pending: 2,
      assertCurrent: () => undefined,
      readPending: async () => {
        throw new Error('Unexpected extra read');
      },
      snapshot: {
        owner: 'fixture',
        minimumNonce: 0,
        retained: [
          {
            chainId: String(chainId),
            from: sender,
            hash: originalHash,
            nonce: 0,
            phase: 'submitted',
          },
          {
            chainId: String(chainId),
            from: sender,
            hash: '0x' + 'cd'.repeat(32),
            nonce: 0,
            phase: 'signed',
          },
        ],
        readMaximumCost: async (hash) =>
          BigInt(hash === originalHash ? originalCap : 200000),
        readAssetDebit: async () => BigInt(0),
      },
    });
    if (result.kind !== 'ready') throw new Error('Missing plan');
    const plan = {
      ...noncePlan,
      nativeReservations: result.nativeReservations,
      balanceState: result.balanceState,
    };
    const review = (value: string) =>
      captureReviewedNativeEvmTransfer(
        {
          ...approved,
          nonce: 2,
          value,
          gasLimit: '21000',
          maxFeePerGas: '1',
        },
        false,
        '21000',
        sender,
        chainId,
        {},
        'fixture'
      );
    try {
      await expect(
        recheckReviewedNativeEvmTransfer(
          review('529000'),
          provider,
          () => undefined,
          plan
        )
      ).rejects.toThrow('Insufficient funds for reviewed EVM transfer');
      await expect(
        recheckReviewedNativeEvmTransfer(
          review('379000'),
          provider,
          () => undefined,
          plan
        )
      ).resolves.toMatchObject({ value: '379000', nonce: '2' });
      pendingBalance = 900000;
      await expect(
        recheckReviewedNativeEvmTransfer(
          review('529000'),
          provider,
          () => undefined,
          plan
        )
      ).resolves.toMatchObject({ value: '529000', nonce: '2' });
      pendingBalance = 600000;
      const singleVariantPlan = {
        ...plan,
        nativeReservations: {
          canonical: BigInt(originalCap),
          pending: BigInt(0),
        },
      };
      await expect(
        recheckReviewedNativeEvmTransfer(
          review('529000'),
          provider,
          () => undefined,
          singleVariantPlan
        )
      ).resolves.toMatchObject({ value: '529000', nonce: '2' });
    } finally {
      provider.destroy();
    }
  }
);
it('manual final funding retains a separate external predecessor', async () => {
  const { provider, replies } = fixture();
  replies.set('eth_getBalance', (params: unknown[]) =>
    hex(params[1] === 'pending' ? 479000 : 1000000)
  );
  replies.set('eth_getBlockByNumber', {
    hash: noncePlan.canonicalBlock.hash,
    baseFeePerGas: '0x1',
    gasLimit: '0x1c9c380',
  });
  const plan = { ...noncePlan, state: 'latest' as const };
  const review = (value: string) =>
    captureReviewedNativeEvmTransfer(
      {
        ...approved,
        nonce: 1,
        value,
        gasLimit: '21000',
        maxFeePerGas: '1',
      },
      false,
      '21000',
      sender,
      chainId,
      {},
      'fixture'
    );
  try {
    await expect(
      recheckReviewedNativeEvmTransfer(
        review('779000'),
        provider,
        () => undefined,
        plan
      )
    ).rejects.toThrow('Insufficient funds for reviewed EVM transfer');
    await expect(
      recheckReviewedNativeEvmTransfer(
        review('458000'),
        provider,
        () => undefined,
        plan
      )
    ).resolves.toMatchObject({ value: '458000', nonce: '1' });
  } finally {
    provider.destroy();
  }
});
it('rechecks the canonical balance block after a gas estimate completes', async () => {
  const { provider, replies } = fixture();
  replies.set('eth_estimateGas', () => {
    replies.set('eth_getBlockByNumber', {
      hash: '0x' + '34'.repeat(32),
      baseFeePerGas: '0x3b9aca00',
      gasLimit: '0x1c9c380',
    });
    return '0x5208';
  });
  try {
    await expect(
      recheckReviewedNativeEvmTransfer(
        capture(),
        provider,
        () => undefined,
        noncePlan
      )
    ).rejects.toThrow('Canonical balance changed');
  } finally {
    provider.destroy();
  }
});

it.each([0, 9])(
  'uses the installed provider and preserves the nonce override %s',
  async (nonce) => {
    const { calls, provider } = fixture();
    try {
      const review = capture({ ...approved, nonce } as typeof approved);
      const transaction = await recheckReviewedNativeEvmTransfer(
        review,
        provider,
        () => undefined,
        noncePlan
      );
      expect(transaction).toEqual({
        ...approved,
        accessList: [],
        from: getAddress(sender),
        to: getAddress(recipient),
        type: 2,
        chainId: String(chainId),
        nonce: nonce === 0 ? '0' : '9',
      });
      expect(calls.map(({ method }) => method)).toEqual([
        'eth_chainId',
        'eth_getBlockByNumber',
        'eth_getBalance',
        'eth_getBalance',
        'eth_estimateGas',
        'eth_getBlockByNumber',
      ]);
      expect(calls.at(-2)?.params).toEqual([
        {
          from: getAddress(sender),
          to: getAddress(recipient),
          value: hex(approved.value),
          data: '0x',
          type: '0x2',
          accessList: [],
          chainId: hex(chainId),
          nonce: nonce === 0 ? '0x0' : '0x9',
          maxFeePerGas: hex(approved.maxFeePerGas),
          maxPriorityFeePerGas: '0x0',
        },
        'pending',
      ]);
    } finally {
      provider.destroy();
    }
  }
);

it('rejects a configured SDK gas floor before it can raise the reviewed cost', () => {
  expect(() =>
    captureReviewedNativeEvmTransfer(
      approved,
      false,
      maximum,
      sender,
      chainId,
      {
        minGasLimit: BigNumber.from(30_000) as any,
      },
      'fixture'
    )
  ).toThrow('gas limit is no longer sufficient');
});

it('rejects a pending balance shortfall and a larger fresh estimate', async () => {
  const { calls, provider, replies } = fixture();
  try {
    replies.set('eth_getBalance', '0x1');
    await expect(
      recheckReviewedNativeEvmTransfer(
        capture(),
        provider,
        () => undefined,
        noncePlan
      )
    ).rejects.toThrow('Insufficient funds');
    expect(calls.some(({ method }) => method === 'eth_estimateGas')).toBe(
      false
    );
    replies.set('eth_getBalance', hex('1000000000000000000000'));
    replies.set('eth_estimateGas', hex(25201));
    await expect(
      recheckReviewedNativeEvmTransfer(
        capture(),
        provider,
        () => undefined,
        noncePlan
      )
    ).rejects.toThrow('gas limit is no longer sufficient');
  } finally {
    provider.destroy();
  }
});

it.each([false, true])(
  'keeps the approved gas limit when the raw estimate rises inside its margin (legacy=%s)',
  async (legacy) => {
    const { provider, replies } = fixture();
    try {
      const request = legacy
        ? {
            from: approved.from,
            to: approved.to,
            chainId,
            value: approved.value,
            data: approved.data,
            gasLimit: approved.gasLimit,
            gasPrice: approved.maxFeePerGas,
            nonce: approved.nonce,
          }
        : approved;
      const review = captureReviewedNativeEvmTransfer(
        request,
        legacy,
        maximum,
        sender,
        chainId,
        {},
        'fixture'
      );
      replies.set('eth_getBlockByNumber', {
        hash: noncePlan.canonicalBlock.hash,
        baseFeePerGas: '0x1',
        gasLimit: hex(25200),
      });
      for (const raw of [21000, 22000, 25200]) {
        replies.set('eth_estimateGas', hex(raw));
        const result = await recheckReviewedNativeEvmTransfer(
          review,
          provider,
          () => undefined,
          noncePlan
        );
        expect(result.gasLimit).toBe('25200');
        expect(result.value).toBe(approved.value);
      }
      replies.set('eth_estimateGas', hex(25201));
      await expect(
        recheckReviewedNativeEvmTransfer(
          review,
          provider,
          () => undefined,
          noncePlan
        )
      ).rejects.toThrow('gas limit is no longer sufficient');
    } finally {
      provider.destroy();
    }
  }
);

it('checks authority before any I/O and after the chain read', async () => {
  const { calls, provider } = fixture();
  try {
    let isCurrent = false;
    const guard = () => {
      if (!isCurrent || calls.length > 0)
        throw new Error('Stale reviewed context');
    };
    await expect(
      recheckReviewedNativeEvmTransfer(capture(), provider, guard, noncePlan)
    ).rejects.toThrow('Stale reviewed context');
    expect(calls).toHaveLength(0);
    isCurrent = true;
    await expect(
      recheckReviewedNativeEvmTransfer(capture(), provider, guard, noncePlan)
    ).rejects.toThrow('Stale reviewed context');
    expect(calls.map(({ method }) => method)).toEqual(['eth_chainId']);
  } finally {
    provider.destroy();
  }
});
