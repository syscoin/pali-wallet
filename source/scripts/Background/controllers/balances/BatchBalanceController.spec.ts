jest.mock('utils/ethersV6Compat', () => ({
  ...jest.requireActual('utils/ethersV6Compat'),
  Contract: jest.fn(),
}));
jest.mock('utils/smartAccount', () => ({
  resolveMulticall3Address: jest.fn(),
}));

import { Contract, defaultAbiCoder } from 'utils/ethersV6Compat';
import { resolveMulticall3Address } from 'utils/smartAccount';

import { BatchBalanceController } from './BatchBalanceController';

const tokens = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    chainId: 1,
    contractAddress: `0x${(i + 1).toString(16).padStart(40, '0')}`,
    decimals: 0,
    balance: 5,
    isNft: false,
    tokenSymbol: 'T',
  }));
const provider = { getNetwork: async () => ({ chainId: 1 }) } as any;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it('omits failed multicall results but records real zero balances', async () => {
  (resolveMulticall3Address as jest.Mock).mockResolvedValue('multicall');
  (Contract as jest.Mock).mockImplementation((address) =>
    address === 'multicall'
      ? {
          aggregate3: async () => [
            { success: false, returnData: '0x' },
            {
              success: true,
              returnData: defaultAbiCoder.encode(['uint256'], [0]),
            },
            { success: true, returnData: '0x12' },
          ],
        }
      : { interface: { encodeFunctionData: () => '0x70a08231' } }
  );
  const list = tokens(3);
  const balances = await new BatchBalanceController(
    provider
  ).getBatchTokenBalances(list, 'owner');
  expect([...balances]).toEqual([
    [list[1].contractAddress, { balance: 0, rawBalance: '0' }],
  ]);
});

it('uses settled JSON-RPC fallback reads and preserves successful members', async () => {
  (resolveMulticall3Address as jest.Mock).mockResolvedValue(null);
  const list = tokens(100);
  (Contract as jest.Mock).mockImplementation(() => ({
    interface: { encodeFunctionData: () => '0x70a08231' },
  }));
  const readMany = jest.fn(async (calls) =>
    calls.map((_, index) =>
      index === 0
        ? { status: 'rejected', reason: new Error('broken token') }
        : {
            status: 'fulfilled',
            value: defaultAbiCoder.encode(['uint256'], [index === 1 ? 0 : 17]),
          }
    )
  );
  const balances = await new BatchBalanceController({
    ...provider,
    readMany,
  }).getBatchTokenBalances(list, 'owner');
  expect(readMany).toHaveBeenCalledTimes(1);
  expect(readMany.mock.calls[0][0]).toHaveLength(100);
  expect(readMany.mock.calls[0][0][0]).toEqual({
    method: 'eth_call',
    params: [{ to: list[0].contractAddress, data: '0x70a08231' }, 'latest'],
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
  (Contract as jest.Mock).mockImplementation((address) => {
    if (address === list[0].contractAddress) throw new Error('invalid address');
    return { interface: { encodeFunctionData: () => '0x70a08231' } };
  });
  const readMany = jest.fn(async (calls: unknown[]) => {
    expect(calls).toHaveLength(2);
    return [
      { status: 'fulfilled', value: '0x12' },
      { status: 'fulfilled', value: defaultAbiCoder.encode(['uint256'], [17]) },
    ];
  });
  const balances = await new BatchBalanceController({
    ...provider,
    readMany,
  }).getBatchTokenBalances(list, 'owner');
  expect(readMany.mock.calls[0][0]).toHaveLength(2);
  expect([...balances]).toEqual([
    [list[2].contractAddress, { balance: 17, rawBalance: '17' }],
  ]);
});

it('does not repeat fallback reads after a transport failure', async () => {
  (resolveMulticall3Address as jest.Mock).mockResolvedValue(null);
  (Contract as jest.Mock).mockImplementation(() => ({
    interface: { encodeFunctionData: () => '0x70a08231' },
  }));
  const readMany = jest.fn().mockRejectedValue(new Error('Offline'));
  await expect(
    new BatchBalanceController({ ...provider, readMany }).getBatchTokenBalances(
      tokens(2),
      'owner'
    )
  ).rejects.toThrow('Offline');
  expect(readMany).toHaveBeenCalledTimes(1);
});
