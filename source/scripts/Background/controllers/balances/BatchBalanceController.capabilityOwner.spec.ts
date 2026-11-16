jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));

import fs from 'fs';
import path from 'path';

import { ownedAssetProvider } from '../assets/utils';
import { Interface } from 'utils/ethersV6Compat';
import { clearMulticall3AddressCache } from 'utils/smartAccount/aggregate';

import { BatchBalanceController } from './BatchBalanceController';

const creation = fs
  .readFileSync(
    path.join(__dirname, '../../../../utils/smartAccount/deployment.ts'),
    'utf8'
  )
  .match(/const multicall3Bytecode =\s*'(0x[0-9a-f]+)'/)![1];
const runtime = `0x${creation.slice(2 + 0x20 * 2, 2 + (0x20 + 0xee0) * 2)}`;
const abi = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[]) view returns ((bool success,bytes returnData)[])',
]);
const balanceAbi = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

it.each([true, false])(
  'preserves unavailable precision mismatches in grouped reads (deployed=%s)',
  async (deployed) => {
    clearMulticall3AddressCache();
    const provider = {
      getNetwork: async () => ({ chainId: 1 }),
      getCode: async () => (deployed ? runtime : '0x'),
      call: async () =>
        abi.encodeFunctionResult('aggregate3', [
          [
            {
              success: true,
              returnData: balanceAbi.encodeFunctionResult('decimals', [18]),
            },
            {
              success: true,
              returnData: balanceAbi.encodeFunctionResult('balanceOf', [
                BigInt('1000000000000000000'),
              ]),
            },
          ],
        ]),
      readMany: async (requests) =>
        requests.map(({ params }) => ({
          status: 'fulfilled',
          value:
            params[0].to.toLowerCase() ===
            '0xca11bde05977b3631167028862be2a173976ca11'
              ? abi.encodeFunctionResult('aggregate3', [
                  [
                    {
                      success: true,
                      returnData: balanceAbi.encodeFunctionResult('decimals', [
                        18,
                      ]),
                    },
                    {
                      success: true,
                      returnData: balanceAbi.encodeFunctionResult('balanceOf', [
                        BigInt('1000000000000000000'),
                      ]),
                    },
                  ],
                ])
              : params[0].data === balanceAbi.encodeFunctionData('decimals')
              ? balanceAbi.encodeFunctionResult('decimals', [18])
              : balanceAbi.encodeFunctionResult('balanceOf', [
                  BigInt('1000000000000000000'),
                ]),
        })),
    };
    const result = await new BatchBalanceController(
      provider as any
    ).getBatchTokenBalances(
      [
        {
          contractAddress: `0x${'12'.repeat(20)}`,
          decimals: 6,
          tokenSymbol: 'T',
        },
      ] as any,
      `0x${'11'.repeat(20)}`
    );
    expect(result.size).toBe(0);
  }
);

it.each([true, false])(
  'reuses endpoint capability across actual owned balance refreshes (deployed=%s)',
  async (deployed) => {
    clearMulticall3AddressCache();
    const methods: string[][] = [];
    const provider = {
      _getConnection: () => ({ url: 'https://asset.test' }),
      getNetwork: async () => ({ chainId: 1 }),
      getRpcTransaction: (value: unknown) => value,
      readMany: async (requests: { method: string; params: any[] }[]) => {
        methods.push(requests.map((request) => request.method));
        return requests.map((request) => ({
          status: 'fulfilled',
          value:
            request.method === 'eth_chainId'
              ? '0x1'
              : request.method === 'eth_getCode'
              ? deployed
                ? runtime
                : '0x'
              : deployed
              ? abi.encodeFunctionResult('aggregate3', [
                  Array.from({ length: 8 }, (_, index) => ({
                    success: true,
                    returnData: balanceAbi.encodeFunctionResult('balanceOf', [
                      index % 2 === 0 ? 0 : 7,
                    ]),
                  })),
                ])
              : balanceAbi.encodeFunctionResult('balanceOf', [
                  request.params[0].data === '0x313ce567' ? 0 : 7,
                ]),
        }));
      },
    };
    const tokens = Array.from({ length: 4 }, (_, index) => ({
      contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      decimals: 0,
      tokenSymbol: 'T',
    }));
    const counts: number[] = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      const signal = new AbortController().signal;
      const owner = {
        signal,
        assertCurrent() {
          if (signal.aborted) throw Error('retired');
        },
      };
      const balances = await new BatchBalanceController(
        ownedAssetProvider(provider as any, owner),
        owner,
        provider as any
      ).getBatchTokenBalances(tokens as any, `0x${'11'.repeat(20)}`);
      expect(balances.size).toBe(4);
      counts.push(
        methods
          .splice(0)
          .flat()
          .filter((method) => method === 'eth_getCode').length
      );
    }
    expect(counts).toEqual(deployed ? [1, 0, 0] : [2, 0, 0]);
  }
);
