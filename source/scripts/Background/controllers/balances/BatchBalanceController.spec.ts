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
  expect([...balances]).toEqual([[list[1].contractAddress, '0']]);
});

it('isolates a failed fallback token and uses constant pacing with three workers', async () => {
  (resolveMulticall3Address as jest.Mock).mockResolvedValue(null);
  const list = tokens(100);
  let running = 0;
  let peak = 0;
  (Contract as jest.Mock).mockImplementation((address) => ({
    balanceOf: async () => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running--;
      if (address === list[0].contractAddress) throw new Error('broken token');
      return BigInt(0);
    },
  }));
  let done = false;
  const promise = new BatchBalanceController(provider)
    .getBatchTokenBalances(list, 'owner')
    .then((value) => {
      done = true;
      return value;
    });
  await jest.advanceTimersByTimeAsync(3400);
  expect(done).toBe(true); // Old growing delays needed more than 50 seconds.
  const balances = await promise;
  expect(peak).toBeLessThanOrEqual(3);
  expect(balances.size).toBe(99);
  expect(balances.has(list[0].contractAddress)).toBe(false);
  expect(balances.get(list[1].contractAddress)).toBe('0');
});
