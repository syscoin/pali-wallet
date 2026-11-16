jest.mock('utils/smartAccount', () => ({
  resolveMulticall3Address: jest.fn(),
}));

import fs from 'fs';
import path from 'path';

import { Interface, defaultAbiCoder } from 'utils/ethersV6Compat';
import { resolveMulticall3Address } from 'utils/smartAccount';

import { BatchBalanceController } from './BatchBalanceController';

const aggregateAbi = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[]) view returns ((bool success,bytes returnData)[])',
]);
const tokens = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    chainId: 1,
    contractAddress: `0x${(i + 1).toString(16).padStart(40, '0')}`,
    decimals: 0,
    balance: 5,
    isNft: false,
    tokenSymbol: 'T',
  }));
const owner = `0x${'11'.repeat(20)}`;
const multicall = `0x${'aa'.repeat(20)}`;
const word = (value: number) => defaultAbiCoder.encode(['uint256'], [value]);
const fulfilled = (value: string) => ({ status: 'fulfilled' as const, value });
const provider = { getNetwork: async () => ({ chainId: 1 }) } as any;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it('omits failed multicall results but records real zero balances', async () => {
  (resolveMulticall3Address as jest.Mock).mockResolvedValue(multicall);
  const readMany = jest.fn(async () => [
    fulfilled(
      aggregateAbi.encodeFunctionResult('aggregate3', [
        [
          { success: true, returnData: word(0) },
          { success: false, returnData: '0x' },
          { success: true, returnData: word(0) },
          { success: true, returnData: word(0) },
          { success: true, returnData: word(0) },
          { success: true, returnData: '0x12' },
        ],
      ])
    ),
  ]);
  const list = tokens(3);
  const balances = await new BatchBalanceController({
    ...provider,
    readMany,
  }).getBatchTokenBalances(list, owner);
  expect([...balances]).toEqual([
    [list[1].contractAddress, { balance: 0, rawBalance: '0' }],
  ]);
  expect(readMany).toHaveBeenCalledTimes(1);
});

it('uses settled JSON-RPC fallback reads and preserves successful members', async () => {
  (resolveMulticall3Address as jest.Mock).mockResolvedValue(null);
  const list = tokens(100);
  const readMany = jest.fn(async (calls) =>
    calls.map((call, index) =>
      index === 1
        ? { status: 'rejected', reason: new Error('broken token') }
        : fulfilled(
            word(call.params[0].data === '0x313ce567' || index === 3 ? 0 : 17)
          )
    )
  );
  const balances = await new BatchBalanceController({
    ...provider,
    readMany,
  }).getBatchTokenBalances(list, owner);
  expect(readMany).toHaveBeenCalledTimes(1);
  expect(readMany.mock.calls[0][0]).toHaveLength(200);
  expect(readMany.mock.calls[0][0][0]).toEqual({
    method: 'eth_call',
    params: [{ to: list[0].contractAddress, data: '0x313ce567' }, 'latest'],
  });
  expect(balances.size).toBe(99);
  expect(balances.has(list[0].contractAddress)).toBe(false);
  expect(balances.get(list[1].contractAddress)).toEqual({
    balance: 0,
    rawBalance: '0',
  });
});

it('isolates a malformed token request and a malformed successful response', async () => {
  (resolveMulticall3Address as jest.Mock).mockResolvedValue(null);
  const list = tokens(3);
  list[0].contractAddress = 'invalid address';
  const readMany = jest.fn(async (calls: unknown[]) => {
    expect(calls).toHaveLength(4);
    return [
      fulfilled(word(0)),
      fulfilled('0x12'),
      fulfilled(word(0)),
      fulfilled(word(17)),
    ];
  });
  const balances = await new BatchBalanceController({
    ...provider,
    readMany,
  }).getBatchTokenBalances(list, owner);
  expect(readMany.mock.calls[0][0]).toHaveLength(4);
  expect([...balances]).toEqual([
    [list[2].contractAddress, { balance: 17, rawBalance: '17' }],
  ]);
});

it('does not repeat fallback reads after a transport failure', async () => {
  (resolveMulticall3Address as jest.Mock).mockResolvedValue(null);
  const readMany = jest.fn().mockRejectedValue(new Error('Offline'));
  await expect(
    new BatchBalanceController({ ...provider, readMany }).getBatchTokenBalances(
      tokens(2),
      owner
    )
  ).rejects.toThrow('Offline');
  expect(readMany).toHaveBeenCalledTimes(1);
});

it('keeps actual Multicall capability probes isolated when endpoints share a chain', async () => {
  const resolver = jest.requireActual('utils/smartAccount/aggregate');
  resolver.clearMulticall3AddressCache();
  (resolveMulticall3Address as jest.Mock).mockImplementation(
    resolver.resolveMulticall3Address
  );
  const creation = fs
    .readFileSync(
      path.join(__dirname, '../../../../utils/smartAccount/deployment.ts'),
      'utf8'
    )
    .match(/const multicall3Bytecode =\s*'(0x[0-9a-f]+)'/)![1];
  const runtime = `0x${creation.slice(2 + 0x20 * 2, 2 + (0x20 + 0xee0) * 2)}`;
  const list = tokens(1);
  const first = {
    ...provider,
    _getConnection: () => ({ url: 'https://a.example' }),
    getCode: jest.fn().mockResolvedValue('0x'),
    readMany: jest
      .fn()
      .mockResolvedValue([fulfilled(word(0)), fulfilled(word(7))]),
  };
  const second = {
    ...provider,
    _getConnection: () => ({ url: 'https://b.example' }),
    getCode: jest.fn().mockResolvedValue(runtime),
    readMany: jest.fn().mockResolvedValue([
      fulfilled(
        aggregateAbi.encodeFunctionResult('aggregate3', [
          [
            { success: true, returnData: word(0) },
            { success: true, returnData: word(9) },
          ],
        ])
      ),
    ]),
  };
  expect(
    (
      await new BatchBalanceController(first).getBatchTokenBalances(list, owner)
    ).get(list[0].contractAddress)?.rawBalance
  ).toBe('7');
  expect(
    (
      await new BatchBalanceController(second).getBatchTokenBalances(
        list,
        owner
      )
    ).get(list[0].contractAddress)?.rawBalance
  ).toBe('9');
  expect(second.getCode).toHaveBeenCalledTimes(1);
  expect(second.readMany).toHaveBeenCalledTimes(1);
  await new BatchBalanceController(second).getBatchTokenBalances(list, owner);
  expect(second.getCode).toHaveBeenCalledTimes(1);
});

it('chunks large portfolios without exceeding the paired getter bound', async () => {
  (resolveMulticall3Address as jest.Mock).mockResolvedValue(null);
  const readMany = jest.fn(async (calls) =>
    calls.map((call) =>
      fulfilled(word(call.params[0].data === '0x313ce567' ? 0 : 7))
    )
  );
  const balances = await new BatchBalanceController({
    ...provider,
    readMany,
  }).getBatchTokenBalances(tokens(257), owner);
  expect(readMany.mock.calls.map(([calls]) => calls.length)).toEqual([512, 2]);
  expect(balances.size).toBe(257);
});
