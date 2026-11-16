import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

import {
  formatErc20Balance,
  parseErc20BalancePair,
} from '../../../../shared/erc20';
import {
  createErc20BalanceBatch,
  Erc20BalanceCall,
} from '../../../../shared/erc20BalanceBatch';
import { ITokenEthProps } from 'types/tokens';
import { Interface, getAddress } from 'utils/ethersV6Compat';
import { resolveMulticall3Address } from 'utils/smartAccount';

import type { AssetReadOwner } from '../assets/types';

const tokenAbi = new Interface([
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
]);
type TokenBalances = Map<string, ReturnType<typeof formatErc20Balance>>;

export class BatchBalanceController {
  constructor(
    private readonly provider: CustomJsonRpcProvider,
    private readonly owner?: AssetReadOwner,
    private readonly capabilityProvider = provider
  ) {}

  async getBatchTokenBalances(
    tokens: ITokenEthProps[],
    userAddress: string
  ): Promise<TokenBalances> {
    this.owner?.assertCurrent();
    const balances: TokenBalances = new Map();
    if (!tokens.length) return balances;
    const network = await this.provider.getNetwork();
    this.owner?.assertCurrent();
    const multicallAddress = await resolveMulticall3Address(
      this.provider,
      Number(network.chainId),
      this.capabilityProvider
    );
    this.owner?.assertCurrent();
    const balanceData = tokenAbi.encodeFunctionData('balanceOf', [userAddress]);
    const selected = tokens.flatMap((token) => {
      try {
        return [{ token, target: getAddress(token.contractAddress) }];
      } catch {
        return [];
      }
    });
    const readMany = async (
      requests: readonly { method: string; params: readonly unknown[] }[]
    ) => {
      this.owner?.assertCurrent();
      const result = await this.provider.readMany(
        requests.map(({ method, params }) => ({ method, params: [...params] })),
        this.owner ? { signal: this.owner.signal } : undefined
      );
      this.owner?.assertCurrent();
      return result;
    };
    const read = async (
      method: 'eth_getCode' | 'eth_call',
      params: readonly unknown[]
    ) => {
      const [result] = await readMany([{ method, params }]);
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    };
    const aggregate = createErc20BalanceBatch();
    // Two getters per token keep each invocation within the shared 512-call cap.
    for (let offset = 0; offset < selected.length; offset += 256) {
      const chunk = selected.slice(offset, offset + 256);
      const calls: Erc20BalanceCall[] = chunk.flatMap(({ target }) => [
        { target, data: tokenAbi.encodeFunctionData('decimals') },
        { target, data: balanceData },
      ]);
      const results = await aggregate(
        { read, readMany },
        calls,
        'latest',
        multicallAddress
      );
      chunk.forEach(({ token }, index) => {
        const precision = results[index * 2];
        const balance = results[index * 2 + 1];
        if (
          precision?.status !== 'fulfilled' ||
          balance?.status !== 'fulfilled'
        )
          return;
        try {
          const units = parseErc20BalancePair(
            precision.value,
            balance.value,
            token.decimals
          );
          balances.set(
            token.contractAddress.toLowerCase(),
            formatErc20Balance(units, token.decimals)
          );
        } catch {
          // Preserve the previous balance when precision or either getter is unavailable.
        }
      });
    }
    return balances;
  }
}
