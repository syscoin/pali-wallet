import { ethers } from 'ethers';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import { Queue } from '../transactions/queue';
import { ITokenEthProps } from 'types/tokens';

// Minimal ERC20 ABI for balance queries
const ERC20_BALANCE_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
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
    type: 'function',
  },
];

export class BatchBalanceController {
  private provider: CustomJsonRpcProvider;
  private multicallAddress: string | undefined;

  constructor(provider: CustomJsonRpcProvider) {
    this.provider = provider;
    this.multicallAddress = '0xcA11bde05977b3631167028862bE2a173976CA11';
  }

  /**
   * Fetch balances for multiple tokens in a single RPC call
   * Falls back to individual calls if multicall is not available
   */
  async getBatchTokenBalances(
    tokens: ITokenEthProps[],
    userAddress: string
  ): Promise<Map<string, string>> {
    const balances = new Map<string, string>();

    // If no tokens, return empty
    if (tokens.length === 0) {
      return balances;
    }

    try {
      // Prepare multicall
      const multicall = new ethers.Contract(
        this.multicallAddress!,
        MULTICALL3_ABI,
        this.provider
      );

      // Prepare calls
      const calls = tokens.map((token) => {
        const tokenContract = new ethers.Contract(
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
            const decoded = ethers.utils.defaultAbiCoder.decode(
              ['uint256'],
              result.returnData
            );
            const balance = decoded[0];
            const formattedBalance = ethers.utils.formatUnits(
              balance,
              token.decimals
            );
            balances.set(token.contractAddress.toLowerCase(), formattedBalance);
          } catch (decodeError) {
            console.error(
              `[BatchBalanceController] Failed to decode balance for ${token.tokenSymbol}:`,
              decodeError
            );
            balances.set(token.contractAddress.toLowerCase(), '0');
          }
        } else {
          // Token query failed, set balance to 0
          balances.set(token.contractAddress.toLowerCase(), '0');
        }
      });

      console.log(
        `[BatchBalanceController] Successfully fetched ${balances.size} balances`
      );
      return balances;
    } catch (error) {
      console.error('[BatchBalanceController] Multicall failed:', error);
      // Fall back to individual calls
      return await this.fallbackToIndividualCalls(tokens, userAddress);
    }
  }

  /**
   * Fallback method using individual RPC calls
   */
  private async fallbackToIndividualCalls(
    tokens: ITokenEthProps[],
    userAddress: string
  ): Promise<Map<string, string>> {
    console.log(
      '[BatchBalanceController] Falling back to individual balance calls'
    );
    const balances = new Map<string, string>();

    // Use Queue to limit concurrent requests to 3 to avoid rate limiting
    const queue = new Queue(3);

    // Add a small delay between requests to be respectful to public RPCs
    const DELAY_BETWEEN_REQUESTS = 100; // 100ms between each request
    let requestCount = 0;

    // Queue each token individually - this ensures only 3 run at a time
    tokens.forEach((token) => {
      queue.execute(async () => {
        // Add progressive delay for each request
        if (requestCount > 0) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              DELAY_BETWEEN_REQUESTS * Math.floor(requestCount / 3)
            )
          );
        }
        requestCount++;

        try {
          const contract = new ethers.Contract(
            token.contractAddress,
            ERC20_BALANCE_ABI,
            this.provider
          );
          const balance = await contract.balanceOf(userAddress);
          const formattedBalance = ethers.utils.formatUnits(
            balance,
            token.decimals
          );

          // Store the balance directly in our map
          balances.set(token.contractAddress.toLowerCase(), formattedBalance);

          return {
            success: true,
            address: token.contractAddress.toLowerCase(),
            balance: formattedBalance,
          };
        } catch (error) {
          console.error(
            `[BatchBalanceController] Failed to fetch balance for ${token.tokenSymbol}:`,
            error
          );

          // Store 0 balance on error
          balances.set(token.contractAddress.toLowerCase(), '0');

          return {
            success: false,
            address: token.contractAddress.toLowerCase(),
            balance: '0',
          };
        }
      });
    });

    // Wait for all queued operations to complete
    await queue.done();

    console.log(
      `[BatchBalanceController] Fetched ${balances.size} balances with rate limiting`
    );

    return balances;
  }

  /**
   * Check if multicall is supported on the current network
   */
  isMulticallSupported(): boolean {
    return !!this.multicallAddress;
  }
}
