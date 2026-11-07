import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';
import { getAddress } from 'ethers/address';

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
  state: 'pending' as const,
  additionalNativeCost: BigInt(0),
};
const maximum = (
  BigInt(approved.maxFeePerGas) * BigInt(approved.gasLimit)
).toString();
const hex = (value: string | number) => `0x${BigInt(value).toString(16)}`;
const capture = (input = approved) =>
  captureReviewedNativeEvmTransfer(
    input,
    false,
    maximum,
    sender,
    chainId,
    {},
    'fixture'
  );

function fixture() {
  const abort = new AbortController();
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const replies = new Map<string, unknown>([
    ['eth_chainId', hex(chainId)],
    ['eth_getBalance', hex('1000000000000000000000')],
    [
      'eth_getBlockByNumber',
      {
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
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id, result: replies.get(method) })
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
        'eth_estimateGas',
      ]);
      expect(calls.at(-1)?.params).toEqual([
        {
          from: getAddress(sender),
          to: getAddress(recipient),
          value: hex(approved.value),
          data: '0x',
          type: '0x2',
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
