import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

import { formatErc20Balance } from '../../../../shared/erc20';
import { ITokenEthProps } from 'types/tokens';
import { defaultAbiCoder } from 'utils/ethersV6Compat';
import { Contract } from 'utils/ethersV6Compat';
import { resolveMulticall3Address } from 'utils/smartAccount';

// Minimal ERC20 ABI for balance queries
const ERC20_BALANCE_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Multicall3 ABI (only the aggregate3 function we need)
const MULTICALL3_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'aggregate3',
    outputs: [
      {
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

type TokenBalances = Map<string, ReturnType<typeof formatErc20Balance>>;

export class BatchBalanceController {
  private provider: CustomJsonRpcProvider;

  constructor(provider: CustomJsonRpcProvider) {
    this.provider = provider;
  }

  /**
   * Fetch balances for multiple tokens in a single RPC call
   * Falls back to individual calls if multicall is not available
   */
  async getBatchTokenBalances(
    tokens: ITokenEthProps[],
    userAddress: string
  ): Promise<TokenBalances> {
    const balances: TokenBalances = new Map();

    // If no tokens, return empty
    if (tokens.length === 0) {
      return balances;
    }

    try {
      // Resolve the canonical Multicall3 deployment, or the Pali CREATE2
      // infrastructure deployment on chains without it (cached per chain).
      const network = await this.provider.getNetwork();
      const multicallAddress = await resolveMulticall3Address(
        this.provider,
        Number(network.chainId)
      );
      if (!multicallAddress) {
        return this.fallbackToRpcReads(tokens, userAddress);
      }

      // Prepare multicall
      const multicall = new Contract(
        multicallAddress,
        MULTICALL3_ABI,
        this.provider
      );

      // Prepare calls
      const calls = tokens.map((token) => {
        const tokenContract = new Contract(
          token.contractAddress,
          ERC20_BALANCE_ABI,
          this.provider
        );
        return {
          target: token.contractAddress,
          allowFailure: true, // Don't fail entire batch if one token fails
          callData: tokenContract.interface.encodeFunctionData('balanceOf', [
            userAddress,
          ]),
        };
      });

      // Execute multicall
      console.log(
        `[BatchBalanceController] Fetching ${tokens.length} token balances in single call`
      );
      const results = await multicall.aggregate3(calls);

      // Process results
      results.forEach((result: any, index: number) => {
        const token = tokens[index];
        if (result.success && result.returnData !== '0x') {
          try {
            const decoded = defaultAbiCoder.decode(
              ['uint256'],
              result.returnData
            );
            balances.set(
              token.contractAddress.toLowerCase(),
              formatErc20Balance(decoded[0], token.decimals)
            );
          } catch (decodeError) {
            console.error(
              `[BatchBalanceController] Failed to decode balance for ${token.tokenSymbol}:`,
              decodeError
            );
          }
        } else {
          // SYSCOIN: Missing means unknown, not zero; callers preserve old balances.
        }
      });

      console.log(
        `[BatchBalanceController] Successfully fetched ${balances.size} balances`
      );
      return balances;
    } catch (error) {
      console.error('[BatchBalanceController] Multicall failed:', error);
      // Fall back to individual calls
      return this.fallbackToRpcReads(tokens, userAddress);
    }
  }

  /** The shared transport bounds and splits fallback reads for this endpoint. */
  private async fallbackToRpcReads(
    tokens: ITokenEthProps[],
    userAddress: string
  ): Promise<TokenBalances> {
    const balances: TokenBalances = new Map();
    const requests = tokens.flatMap((token) => {
      try {
        const contract = new Contract(
          token.contractAddress,
          ERC20_BALANCE_ABI,
          this.provider
        );
        return [
          {
            token,
            method: 'eth_call',
            params: [
              {
                to: token.contractAddress,
                data: contract.interface.encodeFunctionData('balanceOf', [
                  userAddress,
                ]),
              },
              'latest',
            ],
          },
        ];
      } catch {
        return [];
      }
    });
    if (!requests.length) return balances;
    const results = await this.provider.readMany(
      requests.map(({ method, params }) => ({ method, params }))
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') return;
      try {
        const decoded = defaultAbiCoder.decode(
          ['uint256'],
          result.value as string
        );
        const token = requests[index].token;
        balances.set(
          token.contractAddress.toLowerCase(),
          formatErc20Balance(decoded[0], token.decimals)
        );
      } catch {
        // An unavailable or malformed token result preserves its prior balance.
      }
    });
    return balances;
  }
}
